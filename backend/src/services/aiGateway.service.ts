import { AiRequestLog, AiRequestPurpose } from '../models/AiRequestLog';
import { AiProviderConnection } from '../models/AiProviderConnection';
import { debitWallet } from './wallet.service';

const GATEWAY_COST_CREDITS = 2;
const COST_PER_TOKEN_USD = 0.000002;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CacheEntry {
  content: string;
  expiresAt: number;
}

const responseCache = new Map<string, CacheEntry>();

export interface GatewayCallInput {
  workspaceId: string;
  purpose: AiRequestPurpose;
  prompt: string;
  /** Structured context the deterministic generator can use directly, alongside the raw prompt string. */
  context?: Record<string, unknown>;
}

export interface GatewayCallResult {
  content: string;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costEstimate: number;
  latencyMs: number;
  cacheHit: boolean;
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/**
 * Deterministic, template-based content generation per purpose. This is the one place a real
 * hosted LLM call would slot in; every earlier phase's "stub the AI call" now routes through
 * `callGateway` below instead of its own bespoke stub, which is the load-bearing part of the
 * Phase 7 retrofit — swapping this function body for a real provider call later does not
 * require touching any call site.
 */
function generateContent(purpose: AiRequestPurpose, prompt: string, context: Record<string, unknown>): string {
  switch (purpose) {
    case 'nextBestAction': {
      const stage = String(context.lifecycleStage ?? 'Lead');
      const temperature = String(context.temperature ?? 'Cold');
      const score = Number(context.leadScore ?? 0);
      if (stage === 'Customer' || stage === 'Evangelist') {
        return `This contact is already a ${stage}. Next best action: check in for an upsell or referral opportunity — they're a warm advocate candidate.`;
      }
      if (temperature === 'Hot' || score >= 60) {
        return `This is a hot lead (score ${score}). Next best action: reach out today with a direct call or a personalized message — momentum is high.`;
      }
      if (temperature === 'Warm') {
        return `This is a warming lead (score ${score}). Next best action: send a helpful follow-up (case study or answer to their last question) to move them toward Hot.`;
      }
      return `This lead is still Cold (score ${score}). Next best action: send a low-pressure nurture touch — a useful resource, not a sales pitch — to start building engagement.`;
    }
    case 'storeBuilder': {
      const topic = prompt.trim() || 'a general online store';
      const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24) || 'store';
      const titleCased = topic
        .split(' ')
        .slice(0, 3)
        .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
        .join(' ');
      return JSON.stringify({
        storeName: `${titleCased} Store`,
        tagline: `Everything you need for ${topic}, in one place.`,
        suggestedCollections: ['Best Sellers', 'New Arrivals', `${topic} Essentials`],
        suggestedProducts: [
          { name: `${topic} Starter Kit`, priceHint: 999 },
          { name: `${topic} Pro Bundle`, priceHint: 2499 },
        ],
        seoSlug: slug,
      });
    }
    case 'formBuilder': {
      const lower = prompt.toLowerCase();
      const fields: { label: string; type: string; required: boolean }[] = [
        { label: 'Name', type: 'name', required: true },
        { label: 'Email', type: 'email', required: true },
      ];
      if (lower.includes('call') || lower.includes('demo') || lower.includes('phone') || lower.includes('book')) {
        fields.push({ label: 'Phone', type: 'phone', required: true });
      }
      if (lower.includes('company') || lower.includes('business') || lower.includes('b2b')) {
        fields.push({ label: 'Company', type: 'short_text', required: false });
      }
      if (lower.includes('message') || lower.includes('question') || lower.includes('support')) {
        fields.push({ label: 'Message', type: 'long_text', required: false });
      }
      fields.push({ label: 'Submit', type: 'submit', required: false });
      const name = prompt.trim() ? `${prompt.trim().slice(0, 40)} Form` : 'AI Generated Form';
      return JSON.stringify({ name, fields });
    }
    case 'emailCompose': {
      const topic = prompt.trim() || 'our latest update';
      return JSON.stringify({
        subject: `${topic.charAt(0).toUpperCase()}${topic.slice(1)} — don't miss this`,
        bodyPreview: `Hi {{contact.name}},\n\nWe wanted to share something about ${topic}. ${String(context.detail ?? "It's designed to make your week easier.")}\n\nTalk soon,\n{{workspace.name}}`,
      });
    }
    case 'brainChat': {
      const docs = String(context.matchedContent ?? '');
      if (!docs) {
        return "I don't have enough seeded information to answer that yet — it's been logged as an unanswered question so the team can add knowledge for it.";
      }
      return `Based on what's on file: ${docs}`;
    }
    case 'agentInvoke': {
      const tone = String(context.tone ?? 'helpful');
      const skill = String(context.skill ?? 'general assistance');
      return `[${tone} tone — ${skill}]\n\n${prompt.trim() || 'Here is a draft based on what you described.'}\n\nThis is a draft for your review — nothing has been sent or published.`;
    }
    default:
      return 'No response generated.';
  }
}

export async function callGateway(input: GatewayCallInput): Promise<GatewayCallResult> {
  const context = input.context ?? {};
  const cacheKey = `${input.workspaceId}:${input.purpose}:${input.prompt}`;

  const cached = responseCache.get(cacheKey);
  const now = Date.now();
  let content: string;
  let cacheHit = false;

  if (cached && cached.expiresAt > now) {
    content = cached.content;
    cacheHit = true;
  } else {
    content = generateContent(input.purpose, input.prompt, context);
    responseCache.set(cacheKey, { content, expiresAt: now + CACHE_TTL_MS });
  }

  const promptTokens = estimateTokens(input.prompt);
  const completionTokens = estimateTokens(content);
  const totalTokens = promptTokens + completionTokens;
  const costEstimate = Number((totalTokens * COST_PER_TOKEN_USD).toFixed(6));
  const latencyMs = cacheHit ? 5 : 150 + promptTokens;

  const byok = await AiProviderConnection.findOne({ workspaceId: input.workspaceId, connected: true }).lean();
  const provider = byok?.provider ?? 'internal';
  const model = byok ? `${byok.provider}-byok` : 'pmc-gateway-v1';

  if (!byok && !cacheHit) {
    await debitWallet(input.workspaceId, GATEWAY_COST_CREDITS, 'ai_gateway_usage', `AI gateway — ${input.purpose}`);
  }

  await AiRequestLog.create({
    workspaceId: input.workspaceId,
    purpose: input.purpose,
    provider,
    modelName: model,
    promptTokens,
    completionTokens,
    totalTokens,
    costEstimate,
    latencyMs,
    cacheHit,
    success: true,
  });

  return { content, provider, model, promptTokens, completionTokens, totalTokens, costEstimate, latencyMs, cacheHit };
}

export function _clearGatewayCacheForTests(): void {
  responseCache.clear();
}
