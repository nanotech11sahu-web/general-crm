import { Router } from 'express';
import { z } from 'zod';
import { authenticate, AuthenticatedRequest } from '../middleware/auth';
import { requirePermission } from '../middleware/requirePermission';
import { HttpError } from '../middleware/errorHandler';
import { computeAiDashboard } from '../services/aiDashboard.service';
import { listPacksWithStats, getPackDetail, addKnowledge, chatWithBrain, resolveUnanswered } from '../services/aiBrain.service';
import { listAgents, installTemplate, invokeAgent, listAgentMessages } from '../services/aiAgent.service';
import { AGENT_TEMPLATES } from '../constants/agentTemplates';
import { AiProviderConnection, AI_PROVIDERS } from '../models/AiProviderConnection';

export const aiSuiteRouter = Router();

aiSuiteRouter.use(authenticate);

aiSuiteRouter.get('/dashboard', requirePermission('aiSuite', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const days = Number(req.query.days ?? 7);
    const dashboard = await computeAiDashboard(req.auth!.workspaceId, [7, 30, 90].includes(days) ? days : 7);
    res.json(dashboard);
  } catch (err) {
    next(err);
  }
});

// --- AI Brain ---
aiSuiteRouter.get('/brain/packs', requirePermission('aiSuite', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const packs = await listPacksWithStats(req.auth!.workspaceId);
    res.json({ packs });
  } catch (err) {
    next(err);
  }
});

aiSuiteRouter.get('/brain/packs/:key', requirePermission('aiSuite', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const detail = await getPackDetail(req.auth!.workspaceId, req.params.key);
    res.json(detail);
  } catch (err) {
    next(err);
  }
});

const chatSchema = z.object({ question: z.string().min(1) });

aiSuiteRouter.post('/brain/packs/:key/chat', requirePermission('aiSuite', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = chatSchema.parse(req.body);
    const result = await chatWithBrain(req.auth!.workspaceId, req.params.key, body.question);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

const addKnowledgeSchema = z.object({ type: z.enum(['memory', 'document', 'faq']), title: z.string().min(1), content: z.string().min(1) });

aiSuiteRouter.post('/brain/packs/:key/knowledge', requirePermission('aiSuite', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = addKnowledgeSchema.parse(req.body);
    const doc = await addKnowledge(req.auth!.workspaceId, req.params.key, body.type, body.title, body.content);
    res.status(201).json({ doc });
  } catch (err) {
    next(err);
  }
});

aiSuiteRouter.post('/brain/unanswered/:id/resolve', requirePermission('aiSuite', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const question = await resolveUnanswered(req.auth!.workspaceId, req.params.id);
    if (!question) throw new HttpError(404, 'Question not found');
    res.json({ question });
  } catch (err) {
    next(err);
  }
});

// --- AI Agents ---
aiSuiteRouter.get('/agent-templates', requirePermission('aiSuite', 'read'), async (_req, res) => {
  res.json({ templates: AGENT_TEMPLATES });
});

aiSuiteRouter.get('/agents', requirePermission('aiSuite', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const agents = await listAgents(req.auth!.workspaceId);
    res.json({ agents });
  } catch (err) {
    next(err);
  }
});

const installSchema = z.object({ templateKey: z.string().min(1) });

aiSuiteRouter.post('/agents/install', requirePermission('aiSuite', 'create'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = installSchema.parse(req.body);
    const agent = await installTemplate(req.auth!.workspaceId, body.templateKey);
    res.status(201).json({ agent });
  } catch (err) {
    next(err);
  }
});

const invokeSchema = z.object({ input: z.string().min(1) });

aiSuiteRouter.post('/agents/:id/invoke', requirePermission('aiSuite', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const body = invokeSchema.parse(req.body);
    const result = await invokeAgent(req.auth!.workspaceId, req.params.id, body.input);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

aiSuiteRouter.get('/agents/:id/messages', requirePermission('aiSuite', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const messages = await listAgentMessages(req.auth!.workspaceId, req.params.id);
    res.json({ messages });
  } catch (err) {
    next(err);
  }
});

// --- BYOK provider connections (stub connect-state, same pattern as Zoom/Razorpay) ---
aiSuiteRouter.get('/provider-connections', requirePermission('aiSuite', 'read'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const connections = await AiProviderConnection.find({ workspaceId: req.auth!.workspaceId }).lean();
    const providers = AI_PROVIDERS.map((p) => {
      const existing = connections.find((c) => c.provider === p);
      return { provider: p, connected: existing?.connected ?? false, apiKeyMasked: existing?.apiKeyMasked };
    });
    res.json({ providers });
  } catch (err) {
    next(err);
  }
});

const connectSchema = z.object({ apiKey: z.string().min(4) });

aiSuiteRouter.post('/provider-connections/:provider/connect', requirePermission('aiSuite', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const provider = req.params.provider;
    if (!AI_PROVIDERS.includes(provider as (typeof AI_PROVIDERS)[number])) throw new HttpError(404, 'Unknown provider');
    const body = connectSchema.parse(req.body);
    const masked = `${'*'.repeat(Math.max(body.apiKey.length - 4, 0))}${body.apiKey.slice(-4)}`;
    const connection = await AiProviderConnection.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, provider },
      { $set: { connected: true, apiKeyMasked: masked, connectedAt: new Date() } },
      { upsert: true, new: true },
    );
    res.json({ provider: connection.provider, connected: connection.connected, apiKeyMasked: connection.apiKeyMasked });
  } catch (err) {
    next(err);
  }
});

aiSuiteRouter.post('/provider-connections/:provider/disconnect', requirePermission('aiSuite', 'edit'), async (req: AuthenticatedRequest, res, next) => {
  try {
    const connection = await AiProviderConnection.findOneAndUpdate(
      { workspaceId: req.auth!.workspaceId, provider: req.params.provider },
      { $set: { connected: false } },
      { new: true },
    );
    if (!connection) throw new HttpError(404, 'Not connected');
    res.json({ provider: connection.provider, connected: connection.connected });
  } catch (err) {
    next(err);
  }
});
