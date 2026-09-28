import { AiAgent } from '../models/AiAgent';
import { AiMessage } from '../models/AiMessage';
import { getAgentTemplate } from '../constants/agentTemplates';
import { callGateway } from './aiGateway.service';
import { HttpError } from '../middleware/errorHandler';

export async function listAgents(workspaceId: string) {
  return AiAgent.find({ workspaceId }).sort({ createdAt: -1 }).lean();
}

export async function installTemplate(workspaceId: string, templateKey: string) {
  const template = getAgentTemplate(templateKey);
  if (!template) throw new HttpError(404, 'Unknown agent template');

  return AiAgent.create({
    workspaceId,
    name: template.name,
    templateKey: template.key,
    tone: template.tone,
    systemInstructions: template.systemInstructions,
    guardrails: template.guardrails,
    includedSkills: template.includedSkills,
    status: 'active',
  });
}

export async function invokeAgent(workspaceId: string, agentId: string, input: string) {
  const agent = await AiAgent.findOne({ _id: agentId, workspaceId });
  if (!agent) throw new HttpError(404, 'Agent not found');

  const threadKey = `agent:${agentId}`;
  await AiMessage.create({ workspaceId, threadKey, role: 'user', content: input });

  const result = await callGateway({
    workspaceId,
    purpose: 'agentInvoke',
    prompt: input,
    context: { tone: agent.tone, skill: agent.includedSkills[0] ?? 'general assistance' },
  });

  await AiMessage.create({ workspaceId, threadKey, role: 'assistant', content: result.content });

  return { agent, reply: result.content };
}

export async function listAgentMessages(workspaceId: string, agentId: string) {
  return AiMessage.find({ workspaceId, threadKey: `agent:${agentId}` }).sort({ createdAt: 1 }).lean();
}
