import { AiRequestLog } from '../models/AiRequestLog';
import { AiAgent } from '../models/AiAgent';
import { AiMessage } from '../models/AiMessage';

export async function computeAiDashboard(workspaceId: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const logs = await AiRequestLog.find({ workspaceId, createdAt: { $gte: since } }).lean();

  const totalTokens = logs.reduce((s, l) => s + l.totalTokens, 0);
  const totalRequests = logs.length;
  const avgResponseTimeMs = totalRequests > 0 ? logs.reduce((s, l) => s + l.latencyMs, 0) / totalRequests : 0;
  const successCount = logs.filter((l) => l.success).length;
  const successRate = totalRequests > 0 ? successCount / totalRequests : 0;
  const estCost = logs.reduce((s, l) => s + l.costEstimate, 0);
  const cacheHits = logs.filter((l) => l.cacheHit).length;
  const cacheHitRate = totalRequests > 0 ? cacheHits / totalRequests : 0;
  const avgTokensPerRequest = totalRequests > 0 ? totalTokens / totalRequests : 0;

  const [activeAgents, conversationThreads] = await Promise.all([
    AiAgent.countDocuments({ workspaceId, status: 'active' }),
    AiMessage.distinct('threadKey', { workspaceId, createdAt: { $gte: since } }),
  ]);

  const tokenUsageByDay = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    tokenUsageByDay.set(d.toISOString().slice(0, 10), 0);
  }
  for (const log of logs) {
    const day = log.createdAt.toISOString().slice(0, 10);
    if (tokenUsageByDay.has(day)) {
      tokenUsageByDay.set(day, (tokenUsageByDay.get(day) ?? 0) + log.totalTokens);
    }
  }
  const tokenUsageChart = Array.from(tokenUsageByDay.entries()).map(([date, tokens]) => ({ date, tokens }));

  const byModel = new Map<string, { model: string; provider: string; requests: number; tokens: number; totalLatency: number }>();
  const byProvider = new Map<string, number>();
  for (const log of logs) {
    const key = log.modelName;
    if (!byModel.has(key)) byModel.set(key, { model: log.modelName, provider: log.provider, requests: 0, tokens: 0, totalLatency: 0 });
    const entry = byModel.get(key)!;
    entry.requests += 1;
    entry.tokens += log.totalTokens;
    entry.totalLatency += log.latencyMs;
    byProvider.set(log.provider, (byProvider.get(log.provider) ?? 0) + 1);
  }

  const modelBreakdown = Array.from(byModel.values())
    .sort((a, b) => b.requests - a.requests)
    .map((m) => ({ model: m.model, provider: m.provider, requests: m.requests, tokens: m.tokens, avgResponseTimeMs: m.totalLatency / m.requests }));

  const providerBreakdown = Array.from(byProvider.entries()).map(([provider, requests]) => ({ provider, requests }));

  return {
    kpis: {
      totalTokens,
      activeAgents,
      totalRequests,
      avgResponseTimeMs,
      successRate,
      estCost,
      conversations: conversationThreads.length,
      cacheHitRate,
    },
    tokenUsageChart,
    avgTokensPerRequest,
    modelBreakdown,
    providerBreakdown,
    mostUsedModels: modelBreakdown.slice(0, 5),
  };
}
