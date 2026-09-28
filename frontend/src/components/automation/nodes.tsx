import { Handle, Position } from '@xyflow/react';
import { Zap, Tag, ArrowUpRight, Mail, MessageCircle, Trash2 } from 'lucide-react';
import type { ActionKind } from '../../types/automation';

const ACTION_META: Record<ActionKind, { icon: typeof Tag; label: string; summary: (data: Record<string, unknown>) => string }> = {
  add_tag: { icon: Tag, label: 'Add Tag', summary: (d) => (d.tagName ? `Tag: ${d.tagName}` : 'No tag set') },
  update_lifecycle_stage: { icon: ArrowUpRight, label: 'Update Lifecycle Stage', summary: (d) => (d.stage ? `Stage: ${d.stage}` : 'No stage set') },
  send_email: { icon: Mail, label: 'Send Email', summary: (d) => (d.subject ? `Subject: ${d.subject}` : 'No subject set') },
  send_whatsapp: { icon: MessageCircle, label: 'Send WhatsApp', summary: (d) => (d.message ? `${String(d.message).slice(0, 24)}…` : 'No message set') },
};

export function TriggerNode({ data }: { data: { label: string } }) {
  return (
    <div className="w-56 rounded-[var(--radius-lg)] border-2 border-[var(--color-primary)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)]">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-primary)] text-[var(--color-primary-fg)]">
          <Zap className="h-4 w-4" />
        </span>
        <div>
          <p className="text-xs font-semibold uppercase text-[var(--color-primary)]">Trigger</p>
          <p className="text-sm font-medium">{data.label}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-[var(--color-primary)]" />
    </div>
  );
}

export function ActionNode({
  id,
  data,
}: {
  id: string;
  data: { kind: ActionKind; data: Record<string, unknown>; onEdit: (id: string) => void; onDelete: (id: string) => void };
}) {
  const meta = ACTION_META[data.kind];
  const Icon = meta.icon;
  const nodeData = data.data ?? {};
  return (
    <div className="w-56 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-card)]">
      <Handle type="target" position={Position.Left} className="!bg-[var(--color-text-muted)]" />
      <div className="flex items-start gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--color-surface-muted)] text-[var(--color-text)]">
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase text-[var(--color-text-muted)]">Action</p>
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="text-xs text-[var(--color-text-muted)]">{meta.summary(nodeData)}</p>
        </div>
        <button type="button" aria-label="Delete node" onClick={() => data.onDelete(id)} className="text-[var(--color-text-muted)] hover:text-[var(--color-danger)]">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <button type="button" onClick={() => data.onEdit(id)} className="mt-2 text-xs font-medium text-[var(--color-primary)] hover:underline">
        Configure
      </button>
      <Handle type="source" position={Position.Right} className="!bg-[var(--color-text-muted)]" />
    </div>
  );
}

export { ACTION_META };
