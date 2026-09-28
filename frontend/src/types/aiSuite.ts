export interface AiBrainPack {
  key: string;
  name: string;
  hasLiveData: boolean;
  docCount: number;
  unansweredCount: number;
}

export interface AiKnowledgeDocDoc {
  _id: string;
  packKey: string;
  type: 'seeded' | 'memory' | 'document' | 'faq';
  title: string;
  content: string;
  createdAt: string;
}

export interface AiUnansweredQuestionDoc {
  _id: string;
  packKey: string;
  question: string;
  resolved: boolean;
  createdAt: string;
}

export interface AiPackDetail {
  pack: { key: string; name: string; hasLiveData: boolean };
  docs: AiKnowledgeDocDoc[];
  unanswered: AiUnansweredQuestionDoc[];
  dailyTrainingQuestion: string;
}

export interface AgentTemplate {
  key: string;
  name: string;
  description: string;
  tone: string;
  systemInstructions: string;
  guardrails: string[];
  includedSkills: string[];
}

export interface AiAgentDoc {
  _id: string;
  name: string;
  templateKey: string;
  tone: string;
  systemInstructions: string;
  guardrails: string[];
  includedSkills: string[];
  status: 'active' | 'draft';
  createdAt: string;
}

export interface AiMessageDoc {
  _id: string;
  threadKey: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface AiProviderConnectionInfo {
  provider: 'gemini' | 'openai' | 'claude' | 'deepseek' | 'xai';
  connected: boolean;
  apiKeyMasked?: string;
}

export interface AiDashboard {
  kpis: {
    totalTokens: number;
    activeAgents: number;
    totalRequests: number;
    avgResponseTimeMs: number;
    successRate: number;
    estCost: number;
    conversations: number;
    cacheHitRate: number;
  };
  tokenUsageChart: { date: string; tokens: number }[];
  avgTokensPerRequest: number;
  modelBreakdown: { model: string; provider: string; requests: number; tokens: number; avgResponseTimeMs: number }[];
  providerBreakdown: { provider: string; requests: number }[];
  mostUsedModels: { model: string; provider: string; requests: number; tokens: number; avgResponseTimeMs: number }[];
}
