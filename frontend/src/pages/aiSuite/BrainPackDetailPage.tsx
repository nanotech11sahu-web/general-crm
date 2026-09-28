import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Send, Plus, CheckCircle2, Lightbulb, Sparkles } from 'lucide-react';
import { getBrainPackDetail, chatWithBrain, addBrainKnowledge, resolveUnansweredQuestion } from '../../lib/api/aiSuite';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { EmptyState } from '../../components/ui/EmptyState';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { AiKnowledgeDocDoc } from '../../types/aiSuite';

const FILTER_CHIPS = ['All', 'Memory', 'Documents', 'FAQs', 'Health'] as const;
type FilterChip = (typeof FILTER_CHIPS)[number];

const CHIP_TO_TYPE: Partial<Record<FilterChip, AiKnowledgeDocDoc['type']>> = {
  Memory: 'memory',
  Documents: 'document',
  FAQs: 'faq',
};

export function BrainPackDetailPage() {
  const { key } = useParams<{ key: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterChip>('All');
  const [question, setQuestion] = useState('');
  const [chatLog, setChatLog] = useState<{ role: 'user' | 'assistant'; content: string; grounded?: boolean }[]>([]);
  const [addOpen, setAddOpen] = useState(false);

  const { data, isLoading } = useQuery({ queryKey: ['ai-brain-pack', key], queryFn: () => getBrainPackDetail(key!), enabled: Boolean(key) });

  const chatMutation = useMutation({
    mutationFn: (q: string) => chatWithBrain(key!, q),
    onSuccess: (res, q) => {
      setChatLog((log) => [...log, { role: 'user', content: q }, { role: 'assistant', content: res.answer, grounded: res.grounded }]);
      setQuestion('');
      queryClient.invalidateQueries({ queryKey: ['ai-brain-pack', key] });
      queryClient.invalidateQueries({ queryKey: ['ai-brain-packs'] });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveUnansweredQuestion(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-brain-pack', key] });
      toast('Marked as resolved', { variant: 'success' });
    },
  });

  if (isLoading || !data) return <SkeletonList rows={5} />;

  const docs = filter === 'All' || filter === 'Health' ? data.docs : data.docs.filter((d) => d.type === CHIP_TO_TYPE[filter]);

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => navigate('/ai-suite')} className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-4 w-4" /> Back to AI Suite
      </button>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{data.pack?.name}</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4" /> Add Knowledge
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <h3 className="font-semibold">Chat with Brain</h3>
          <div className="min-h-32 max-h-72 space-y-2 overflow-y-auto">
            {!chatLog.length && <p className="text-sm text-[var(--color-text-muted)]">Ask a question grounded in this pack's seeded data.</p>}
            {chatLog.map((msg, i) => (
              <div
                key={i}
                className={clsx('rounded-[var(--radius-md)] p-2 text-sm', msg.role === 'user' ? 'bg-[var(--color-primary)]/10' : 'bg-[var(--color-surface-muted)]')}
              >
                <p>{msg.content}</p>
                {msg.role === 'assistant' && (
                  <Badge tone={msg.grounded ? 'success' : 'warning'} className="mt-1">
                    {msg.grounded ? 'Grounded' : 'Unanswered — logged for training'}
                  </Badge>
                )}
              </div>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (question.trim()) chatMutation.mutate(question.trim());
            }}
          >
            <Input aria-label="Ask the brain a question" placeholder="Ask a question…" value={question} onChange={(e) => setQuestion(e.target.value)} className="flex-1" />
            <Button type="submit" size="sm" className="gap-1.5" loading={chatMutation.isPending} disabled={!question.trim()}>
              <Send className="h-4 w-4" /> Ask
            </Button>
          </form>
          <button
            type="button"
            className="flex items-center gap-1.5 self-start text-xs text-[var(--color-primary)] hover:underline"
            onClick={() => setQuestion(data.dailyTrainingQuestion)}
          >
            <Lightbulb className="h-3.5 w-3.5" /> Daily training question: {data.dailyTrainingQuestion}
          </button>
        </Card>

        <Card>
          <nav className="mb-3 flex flex-wrap gap-1.5">
            {FILTER_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => setFilter(chip)}
                className={clsx(
                  'rounded-full border px-2.5 py-1 text-xs font-medium',
                  filter === chip ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]',
                )}
              >
                {chip}
              </button>
            ))}
          </nav>

          {filter === 'Health' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2">
                  <p className="text-lg font-semibold">{data.docs.length}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Docs seeded</p>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-2">
                  <p className="text-lg font-semibold">{data.unanswered.filter((q) => !q.resolved).length}</p>
                  <p className="text-xs text-[var(--color-text-muted)]">Open unanswered</p>
                </div>
              </div>
              <h4 className="text-sm font-semibold">Unanswered Questions</h4>
              {!data.unanswered.length ? (
                <p className="text-sm text-[var(--color-text-muted)]">No unanswered questions yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {data.unanswered.map((q) => (
                    <div key={q._id} className="flex items-center justify-between gap-2 text-sm">
                      <span className={q.resolved ? 'text-[var(--color-text-muted)] line-through' : ''}>{q.question}</span>
                      {!q.resolved && (
                        <Button size="sm" variant="ghost" className="gap-1" onClick={() => resolveMutation.mutate(q._id)}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : !docs.length ? (
            <EmptyState icon={Sparkles} title="No knowledge here yet" description="Seeded docs appear automatically; add Memory, Documents, or FAQs manually." />
          ) : (
            <div className="space-y-2">
              {docs.map((doc) => (
                <div key={doc._id} className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">{doc.title}</p>
                    <Badge>{doc.type}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-[var(--color-text-muted)]">{doc.content}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <AddKnowledgeModal packKey={key!} open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}

function AddKnowledgeModal({ packKey, open, onClose }: { packKey: string; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [type, setType] = useState<'memory' | 'document' | 'faq'>('memory');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const mutation = useMutation({
    mutationFn: () => addBrainKnowledge(packKey, { type, title, content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-brain-pack', packKey] });
      queryClient.invalidateQueries({ queryKey: ['ai-brain-packs'] });
      toast('Knowledge added', { variant: 'success' });
      setTitle('');
      setContent('');
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title="Add Knowledge">
      <div className="space-y-3">
        <fieldset className="flex gap-3 text-sm">
          {(['memory', 'document', 'faq'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5">
              <input type="radio" checked={type === t} onChange={() => setType(t)} /> {t === 'faq' ? 'FAQ' : t.charAt(0).toUpperCase() + t.slice(1)}
            </label>
          ))}
        </fieldset>
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Content</span>
          <textarea className="min-h-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 text-sm" value={content} onChange={(e) => setContent(e.target.value)} />
        </label>
        <Button disabled={!title || !content} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          Add
        </Button>
      </div>
    </Modal>
  );
}
