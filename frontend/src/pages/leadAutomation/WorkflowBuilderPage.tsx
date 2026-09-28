import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  addEdge,
  type Node,
  type Edge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ArrowLeft, Save, Rocket, Play, Tag, ArrowUpRight, Mail, MessageCircle, AlertTriangle } from 'lucide-react';
import { getWorkflow, updateWorkflow, publishWorkflow, unpublishWorkflow, runWorkflowOnce, listWorkflowRuns, listTriggers } from '../../lib/api/workflows';
import { listContacts } from '../../lib/api/contacts';
import { TriggerNode, ActionNode, ACTION_META } from '../../components/automation/nodes';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { Input } from '../../components/ui/Input';
import { Card } from '../../components/ui/Card';
import { SkeletonList } from '../../components/ui/Skeleton';
import { toast } from '../../stores/toastStore';
import type { ActionKind, WorkflowRunDoc } from '../../types/automation';

const nodeTypes = { trigger: TriggerNode, action: ActionNode };
const NODE_WIDTH = 224;
const NODE_HEIGHT = 110;

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['workflow', id], queryFn: () => getWorkflow(id!), enabled: Boolean(id) });
  const { data: triggers } = useQuery({ queryKey: ['triggers'], queryFn: listTriggers });
  const { data: contactsData } = useQuery({ queryKey: ['contacts', { archived: false }], queryFn: () => listContacts({ archived: false }) });

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [runOnceOpen, setRunOnceOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState('');
  const [logsOpen, setLogsOpen] = useState(false);

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((prev) => prev.filter((n) => n.id !== nodeId));
      setEdges((prev) => prev.filter((e) => e.source !== nodeId && e.target !== nodeId));
    },
    [setNodes, setEdges],
  );

  useEffect(() => {
    if (!data) return;
    const triggerLabel = triggers?.find((t) => t.key === data.workflow.triggerKey)?.label ?? data.workflow.triggerKey;
    const rfNodes: Node[] = data.workflow.nodes.map((n) =>
      n.kind === 'trigger'
        ? { id: n.id, type: 'trigger', position: n.position, width: NODE_WIDTH, height: NODE_HEIGHT, data: { label: triggerLabel } }
        : {
            id: n.id,
            type: 'action',
            position: n.position,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            data: { kind: n.kind as ActionKind, data: n.data, onEdit: setEditingNodeId, onDelete: deleteNode },
          },
    );
    const rfEdges: Edge[] = data.workflow.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, animated: true, style: { stroke: 'var(--color-primary)' } }));
    setNodes(rfNodes);
    setEdges(rfEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, triggers]);

  const onConnect = useCallback((connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: 'var(--color-primary)' } }, eds)), [setEdges]);

  function addActionNode(kind: ActionKind) {
    const id2 = `action-${Date.now()}`;
    setNodes((prev) => [
      ...prev,
      {
        id: id2,
        type: 'action',
        position: { x: 300 + prev.length * 40, y: 100 + prev.length * 60 },
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        data: { kind, data: {}, onEdit: setEditingNodeId, onDelete: deleteNode },
      },
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      updateWorkflow(id!, {
        nodes: nodes.map((n) => ({
          id: n.id,
          kind: n.type === 'trigger' ? 'trigger' : (n.data as { kind: ActionKind }).kind,
          position: n.position,
          data: n.type === 'trigger' ? { triggerKey: data?.workflow.triggerKey } : ((n.data as { data: Record<string, unknown> }).data ?? {}),
        })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      }),
    onSuccess: (res) => {
      queryClient.setQueryData(['workflow', id], res);
      toast('Workflow saved', { variant: 'success' });
    },
    onError: () => toast('Could not save workflow', { variant: 'error' }),
  });

  const publishMutation = useMutation({
    mutationFn: () => (data?.workflow.status === 'published' ? unpublishWorkflow(id!) : publishWorkflow(id!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow', id] });
      toast(data?.workflow.status === 'published' ? 'Workflow unpublished' : 'Workflow published', { variant: 'success' });
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Could not publish';
      toast(message, { variant: 'error' });
    },
  });

  const runOnceMutation = useMutation({
    mutationFn: () => runWorkflowOnce(id!, selectedContactId),
    onSuccess: (run) => {
      toast(`Run ${run.status}`, { variant: run.status === 'success' ? 'success' : 'error', description: `${run.steps.length} step(s) executed` });
      setRunOnceOpen(false);
    },
  });

  const editingNode = nodes.find((n) => n.id === editingNodeId);

  if (isLoading || !data) return <SkeletonList rows={6} />;

  return (
    <div className="space-y-3">
      <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-lg font-semibold">{data.workflow.name}</h1>
        <Badge tone={data.workflow.status === 'published' ? 'success' : 'neutral'}>{data.workflow.status}</Badge>
        {data.issues.length > 0 ? (
          <Badge tone="danger" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> Issues — {data.issues.length} error{data.issues.length > 1 ? 's' : ''}
          </Badge>
        ) : (
          <Badge tone="success">No issues</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setLogsOpen(true)}>
            Execution Logs
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setRunOnceOpen(true)}>
            <Play className="h-4 w-4" /> Run Once
          </Button>
          <Button variant="secondary" size="sm" className="gap-1.5" loading={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            <Save className="h-4 w-4" /> Save
          </Button>
          <Button size="sm" className="gap-1.5" loading={publishMutation.isPending} onClick={() => publishMutation.mutate()}>
            <Rocket className="h-4 w-4" /> {data.workflow.status === 'published' ? 'Unpublish' : 'Publish'}
          </Button>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <Card className="space-y-2">
          <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Add Action</p>
          <PaletteButton icon={Tag} label="Add Tag" onClick={() => addActionNode('add_tag')} />
          <PaletteButton icon={ArrowUpRight} label="Update Stage" onClick={() => addActionNode('update_lifecycle_stage')} />
          <PaletteButton icon={Mail} label="Send Email" onClick={() => addActionNode('send_email')} />
          <PaletteButton icon={MessageCircle} label="Send WhatsApp" onClick={() => addActionNode('send_whatsapp')} />
        </Card>

        <div style={{ height: 520 }} className="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]" data-testid="workflow-canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      {editingNode && editingNode.type === 'action' && (
        <NodeConfigModal
          node={editingNode as Node & { data: { kind: ActionKind; data: Record<string, unknown> } }}
          onClose={() => setEditingNodeId(null)}
          onSave={(newData) => {
            setNodes((prev) => prev.map((n) => (n.id === editingNode.id ? { ...n, data: { ...n.data, data: newData } } : n)));
            setEditingNodeId(null);
          }}
        />
      )}

      <Modal
        open={runOnceOpen}
        onClose={() => setRunOnceOpen(false)}
        title="Run Once"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRunOnceOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!selectedContactId} loading={runOnceMutation.isPending} onClick={() => runOnceMutation.mutate()}>
              Run
            </Button>
          </>
        }
      >
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[var(--color-text-muted)]">Test contact</span>
          <select
            className="h-8 flex-1 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
            value={selectedContactId}
            onChange={(e) => setSelectedContactId(e.target.value)}
          >
            <option value="">Select a contact…</option>
            {contactsData?.contacts.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </Modal>

      <ExecutionLogsModal open={logsOpen} onClose={() => setLogsOpen(false)} workflowId={id!} />
    </div>
  );
}

function PaletteButton({ icon: Icon, label, onClick }: { icon: typeof Tag; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 py-1.5 text-sm hover:bg-[var(--color-surface-muted)]"
    >
      <Icon className="h-4 w-4 text-[var(--color-text-muted)]" /> {label}
    </button>
  );
}

function NodeConfigModal({
  node,
  onClose,
  onSave,
}: {
  node: Node & { data: { kind: ActionKind; data: Record<string, unknown> } };
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}) {
  const kind = node.data.kind;
  const [value, setValue] = useState<string>(
    String((node.data.data ?? {}).tagName ?? (node.data.data ?? {}).stage ?? (node.data.data ?? {}).subject ?? (node.data.data ?? {}).message ?? ''),
  );
  const meta = ACTION_META[kind];
  const fieldKey = kind === 'add_tag' ? 'tagName' : kind === 'update_lifecycle_stage' ? 'stage' : kind === 'send_email' ? 'subject' : 'message';

  return (
    <Modal
      open
      onClose={onClose}
      title={`Configure ${meta.label}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave({ [fieldKey]: value })}>Save</Button>
        </>
      }
    >
      {kind === 'update_lifecycle_stage' ? (
        <label className="flex items-center justify-between gap-2 text-sm">
          <span className="text-[var(--color-text-muted)]">Stage</span>
          <select className="h-8 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm" value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select…</option>
            {['Lead', 'MQL', 'SQL', 'Opportunity', 'Customer', 'Evangelist'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <Input
          label={kind === 'add_tag' ? 'Tag name' : kind === 'send_email' ? 'Email subject' : 'WhatsApp message'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      )}
    </Modal>
  );
}

function ExecutionLogsModal({ open, onClose, workflowId }: { open: boolean; onClose: () => void; workflowId: string }) {
  const { data: runs, isLoading } = useQuery({ queryKey: ['workflow-runs', workflowId], queryFn: () => listWorkflowRuns(workflowId), enabled: open });
  return (
    <Modal open={open} onClose={onClose} title="Execution Logs">
      {isLoading && <SkeletonList rows={3} />}
      {!isLoading && runs?.length === 0 && <p className="text-sm text-[var(--color-text-muted)]">No executions yet.</p>}
      <div className="max-h-96 space-y-2 overflow-y-auto">
        {runs?.map((run: WorkflowRunDoc) => (
          <Card key={run._id}>
            <div className="flex items-center justify-between">
              <Badge tone={run.status === 'success' ? 'success' : run.status === 'partial' ? 'warning' : 'danger'}>{run.status}</Badge>
              <span className="text-xs text-[var(--color-text-muted)]">
                {run.isTestRun ? 'Test run' : 'Live'} · {new Date(run.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="mt-2 space-y-1">
              {run.steps.map((s, i) => (
                <p key={i} className="text-xs text-[var(--color-text-muted)]">
                  {s.kind}: {s.message}
                </p>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </Modal>
  );
}

