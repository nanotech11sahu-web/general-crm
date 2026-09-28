import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Plus, Sparkles, Send } from 'lucide-react';
import { listAgents, listAgentTemplates, installAgentTemplate, invokeAgent, listAgentMessages } from '../../lib/api/aiSuite';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { AiAgentDoc } from '../../types/aiSuite';

export function AgentsTab() {
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [activeAgent, setActiveAgent] = useState<AiAgentDoc | null>(null);
  const { data: agents, isLoading } = useQuery({ queryKey: ['ai-agents'], queryFn: listAgents });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--color-text-muted)]">{agents?.length ?? 0} custom agent{agents?.length === 1 ? '' : 's'}</h2>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Search agents" placeholder="Search" className="w-40" />
          <Button size="sm" variant="secondary" onClick={() => toast('Multi-select lands in a later phase', { variant: 'info' })}>
            Select
          </Button>
          <Button size="sm" variant="secondary" className="gap-1.5" onClick={() => setTemplatesOpen(true)}>
            <Sparkles className="h-4 w-4" /> Templates
          </Button>
          <Button size="sm" variant="secondary" onClick={() => toast('Custom folders land in a later phase', { variant: 'info' })}>
            New Folder
          </Button>
          <Button size="sm" className="gap-1.5" onClick={() => toast('Building a fully custom agent from scratch lands in a later phase — install a template to get started', { variant: 'info' })}>
            <Plus className="h-4 w-4" /> New Agent
          </Button>
        </div>
      </div>

      {isLoading ? (
        <SkeletonList rows={3} />
      ) : !agents?.length ? (
        <EmptyState icon={Bot} title="No custom agents yet" description="Install a starter template to get your first agent running." actionLabel="Browse Templates" onAction={() => setTemplatesOpen(true)} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {agents.map((agent) => (
            <Card key={agent._id} className="cursor-pointer space-y-2 transition-shadow hover:shadow-md" onClick={() => setActiveAgent(agent)}>
              <div className="flex items-start justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                  <Bot className="h-4.5 w-4.5" />
                </div>
                <Badge tone={agent.status === 'active' ? 'success' : 'neutral'}>{agent.status}</Badge>
              </div>
              <p className="font-medium">{agent.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{agent.includedSkills.join(' · ')}</p>
            </Card>
          ))}
        </div>
      )}

      <TemplatesModal open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
      {activeAgent && <AgentChatModal agent={activeAgent} onClose={() => setActiveAgent(null)} />}
    </div>
  );
}

function TemplatesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [previewKey, setPreviewKey] = useState<string | null>(null);
  const { data: templates } = useQuery({ queryKey: ['agent-templates'], queryFn: listAgentTemplates, enabled: open });
  const { data: agents } = useQuery({ queryKey: ['ai-agents'], queryFn: listAgents, enabled: open });

  const installMutation = useMutation({
    mutationFn: (templateKey: string) => installAgentTemplate(templateKey),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: ['ai-agents'] });
      toast(`${agent.name} installed`, { variant: 'success' });
    },
  });

  const preview = templates?.find((t) => t.key === previewKey);
  const installedKeys = new Set((agents ?? []).map((a) => a.templateKey));

  return (
    <Modal open={open} onClose={onClose} title={preview ? preview.name : 'Agent Templates'}>
      {preview ? (
        <div className="space-y-3">
          <button type="button" className="text-xs text-[var(--color-primary)] hover:underline" onClick={() => setPreviewKey(null)}>
            ← Back to templates
          </button>
          <p className="text-sm text-[var(--color-text-muted)]">{preview.description}</p>
          <div>
            <h4 className="text-sm font-semibold">Tone</h4>
            <p className="text-sm text-[var(--color-text-muted)]">{preview.tone}</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold">System Instructions</h4>
            <p className="text-sm text-[var(--color-text-muted)]">{preview.systemInstructions}</p>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Guardrails</h4>
            <ul className="list-disc pl-5 text-sm text-[var(--color-text-muted)]">
              {preview.guardrails.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Included Skills</h4>
            <div className="flex flex-wrap gap-1.5">
              {preview.includedSkills.map((s) => (
                <Badge key={s}>{s}</Badge>
              ))}
            </div>
          </div>
          <Button
            disabled={installedKeys.has(preview.key)}
            loading={installMutation.isPending}
            onClick={() => installMutation.mutate(preview.key)}
          >
            {installedKeys.has(preview.key) ? 'Already installed' : 'Install'}
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {templates?.map((t) => (
            <Card key={t.key} className="space-y-2">
              <p className="font-medium">{t.name}</p>
              <p className="text-xs text-[var(--color-text-muted)]">{t.description}</p>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => setPreviewKey(t.key)}>
                  Preview
                </Button>
                <Button size="sm" disabled={installedKeys.has(t.key)} loading={installMutation.isPending} onClick={() => installMutation.mutate(t.key)}>
                  {installedKeys.has(t.key) ? 'Installed' : 'Install'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </Modal>
  );
}

function AgentChatModal({ agent, onClose }: { agent: AiAgentDoc; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState('');
  const { data: messages } = useQuery({ queryKey: ['agent-messages', agent._id], queryFn: () => listAgentMessages(agent._id) });

  const invokeMutation = useMutation({
    mutationFn: (text: string) => invokeAgent(agent._id, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-messages', agent._id] });
      setInput('');
    },
  });

  return (
    <Modal open onClose={onClose} title={agent.name}>
      <div className="space-y-3">
        <div className="min-h-32 max-h-72 space-y-2 overflow-y-auto">
          {!messages?.length && <p className="text-sm text-[var(--color-text-muted)]">Describe what you'd like drafted — {agent.includedSkills.join(', ')}.</p>}
          {messages?.map((m) => (
            <div key={m._id} className={`rounded-[var(--radius-md)] p-2 text-sm ${m.role === 'user' ? 'bg-[var(--color-primary)]/10' : 'bg-[var(--color-surface-muted)]'}`}>
              {m.content}
            </div>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) invokeMutation.mutate(input.trim());
          }}
        >
          <Input aria-label="Message the agent" placeholder="What should it draft?" value={input} onChange={(e) => setInput(e.target.value)} className="flex-1" />
          <Button type="submit" size="sm" className="gap-1.5" loading={invokeMutation.isPending} disabled={!input.trim()}>
            <Send className="h-4 w-4" /> Send
          </Button>
        </form>
      </div>
    </Modal>
  );
}
