import { api } from '../apiClient';
import type { AiBrainPack, AiPackDetail, AgentTemplate, AiAgentDoc, AiMessageDoc, AiProviderConnectionInfo, AiDashboard } from '../../types/aiSuite';

export async function getAiDashboard(days: 7 | 30 | 90 = 7) {
  const res = await api.get('/ai-suite/dashboard', { params: { days } });
  return res.data as AiDashboard;
}

export async function listBrainPacks() {
  const res = await api.get('/ai-suite/brain/packs');
  return res.data.packs as AiBrainPack[];
}

export async function getBrainPackDetail(key: string) {
  const res = await api.get(`/ai-suite/brain/packs/${key}`);
  return res.data as AiPackDetail;
}

export async function chatWithBrain(key: string, question: string) {
  const res = await api.post(`/ai-suite/brain/packs/${key}/chat`, { question });
  return res.data as { answer: string; grounded: boolean };
}

export async function addBrainKnowledge(key: string, payload: { type: 'memory' | 'document' | 'faq'; title: string; content: string }) {
  const res = await api.post(`/ai-suite/brain/packs/${key}/knowledge`, payload);
  return res.data.doc;
}

export async function resolveUnansweredQuestion(id: string) {
  const res = await api.post(`/ai-suite/brain/unanswered/${id}/resolve`);
  return res.data.question;
}

export async function listAgentTemplates() {
  const res = await api.get('/ai-suite/agent-templates');
  return res.data.templates as AgentTemplate[];
}

export async function listAgents() {
  const res = await api.get('/ai-suite/agents');
  return res.data.agents as AiAgentDoc[];
}

export async function installAgentTemplate(templateKey: string) {
  const res = await api.post('/ai-suite/agents/install', { templateKey });
  return res.data.agent as AiAgentDoc;
}

export async function invokeAgent(agentId: string, input: string) {
  const res = await api.post(`/ai-suite/agents/${agentId}/invoke`, { input });
  return res.data as { agent: AiAgentDoc; reply: string };
}

export async function listAgentMessages(agentId: string) {
  const res = await api.get(`/ai-suite/agents/${agentId}/messages`);
  return res.data.messages as AiMessageDoc[];
}

export async function listProviderConnections() {
  const res = await api.get('/ai-suite/provider-connections');
  return res.data.providers as AiProviderConnectionInfo[];
}

export async function connectProvider(provider: string, apiKey: string) {
  const res = await api.post(`/ai-suite/provider-connections/${provider}/connect`, { apiKey });
  return res.data as AiProviderConnectionInfo;
}

export async function disconnectProvider(provider: string) {
  const res = await api.post(`/ai-suite/provider-connections/${provider}/disconnect`);
  return res.data as { provider: string; connected: boolean };
}
