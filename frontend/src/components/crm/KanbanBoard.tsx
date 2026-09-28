import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useDroppable } from '@dnd-kit/core';
import { useDraggable } from '@dnd-kit/core';
import { FixedSizeList } from 'react-window';
import { motion, AnimatePresence } from 'framer-motion';
import { GripVertical, Plus } from 'lucide-react';
import { listPipelines, listOpportunities, moveOpportunity } from '../../lib/api/pipelines';
import { SkeletonList } from '../ui/Skeleton';
import { Badge } from '../ui/Badge';
import type { Opportunity, PipelineStage } from '../../types/crm';
import { toast } from '../../stores/toastStore';

const STAGE_ACCENTS = ['#6366f1', '#0891b2', '#d97706', '#16a34a', '#e11d48', '#7c3aed'];

function stageAccent(index: number) {
  return STAGE_ACCENTS[index % STAGE_ACCENTS.length];
}

function initials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function KanbanCard({ opportunity }: { opportunity: Opportunity }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: opportunity._id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 20 }
    : undefined;

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: isDragging ? 0.45 : 1, y: 0, scale: isDragging ? 1.03 : 1 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className={`group cursor-grab rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-shadow duration-200 active:cursor-grabbing ${
        isDragging ? 'shadow-[var(--shadow-pop)] ring-2 ring-[var(--color-primary)]/40' : 'shadow-sm hover:shadow-[var(--shadow-card-hover)]'
      }`}
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[image:var(--gradient-primary)] text-[11px] font-semibold text-white">
            {initials(opportunity.name) || '•'}
          </span>
          <p className="text-sm font-medium leading-tight">{opportunity.name}</p>
        </div>
        <GripVertical
          className="h-4 w-4 shrink-0 text-[var(--color-text-muted)] opacity-0 transition-opacity duration-150 group-hover:opacity-100"
          aria-hidden
        />
      </div>
      {opportunity.productInterest && <p className="mt-1.5 pl-9 text-xs text-[var(--color-text-muted)]">{opportunity.productInterest}</p>}
      {typeof opportunity.value === 'number' && (
        <div className="mt-2 pl-9">
          <Badge tone="success">₹{opportunity.value.toLocaleString()}</Badge>
        </div>
      )}
    </motion.div>
  );
}

// Above this many cards in one stage, Framer Motion's per-card mount/unmount animation and
// a plain unbounded map() both become a real render bottleneck (verified under Phase 12 load
// testing with 1,000+ opportunities in one stage) — switch to a windowed list so only the
// visible rows ever mount, at the cost of the enter/exit animation for that column only.
const VIRTUALIZE_THRESHOLD = 50;
const CARD_ROW_HEIGHT = 96;
const VIRTUAL_LIST_HEIGHT = 560;

function KanbanColumn({
  stage,
  opportunities,
  accent,
}: {
  stage: PipelineStage;
  opportunities: Opportunity[];
  accent: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  const shouldVirtualize = opportunities.length > VIRTUALIZE_THRESHOLD;

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-[var(--radius-lg)] border p-2 transition-all duration-200 ${
        isOver
          ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary-soft)] shadow-[var(--shadow-card-hover)]'
          : 'border-[var(--color-border)] bg-[var(--color-surface-muted)]'
      }`}
    >
      <div className="mb-2 flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} aria-hidden />
          <p className="text-sm font-semibold">{stage.label}</p>
        </div>
        <Badge className="tabular-nums">{opportunities.length}</Badge>
      </div>
      <div className="mb-2 h-0.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]/60">
        <div className="h-full rounded-full transition-all duration-300" style={{ backgroundColor: accent, width: '100%' }} />
      </div>
      {shouldVirtualize ? (
        <FixedSizeList
          height={VIRTUAL_LIST_HEIGHT}
          width="100%"
          itemCount={opportunities.length}
          itemSize={CARD_ROW_HEIGHT}
          itemData={opportunities}
        >
          {({ index, style, data }) => (
            <div style={style} className="pb-2">
              <KanbanCard opportunity={data[index]} />
            </div>
          )}
        </FixedSizeList>
      ) : (
        <div className="flex flex-1 flex-col gap-2">
          <AnimatePresence>
            {opportunities.map((opp) => (
              <KanbanCard key={opp._id} opportunity={opp} />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

export function KanbanBoard({ onAddLead }: { onAddLead: () => void }) {
  const queryClient = useQueryClient();
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const { data: pipelines, isLoading: pipelinesLoading } = useQuery({
    queryKey: ['pipelines'],
    queryFn: listPipelines,
  });

  const activePipeline = pipelines?.find((p) => p._id === (pipelineId ?? pipelines[0]?._id));

  const { data: opportunities, isLoading: oppsLoading } = useQuery({
    queryKey: ['opportunities', activePipeline?._id],
    queryFn: () => listOpportunities(activePipeline!._id),
    enabled: Boolean(activePipeline),
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const opportunitiesByStage = useMemo(() => {
    const map = new Map<string, Opportunity[]>();
    for (const stage of activePipeline?.stages ?? []) map.set(stage.key, []);
    for (const opp of opportunities ?? []) {
      map.get(opp.stageKey)?.push(opp);
    }
    for (const list of map.values()) list.sort((a, b) => a.order - b.order);
    return map;
  }, [activePipeline, opportunities]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  async function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || !activePipeline) return;
    const opportunityId = String(active.id);
    const targetStage = String(over.id);
    const opportunity = opportunities?.find((o) => o._id === opportunityId);
    if (!opportunity || opportunity.stageKey === targetStage) return;

    const targetCount = opportunitiesByStage.get(targetStage)?.length ?? 0;
    try {
      await moveOpportunity(opportunityId, targetStage, targetCount);
      queryClient.invalidateQueries({ queryKey: ['opportunities', activePipeline._id] });
      toast('Stage updated', { variant: 'success', description: opportunity.name });
    } catch {
      toast('Could not move card', { variant: 'error' });
    }
  }

  if (pipelinesLoading) return <SkeletonList rows={4} />;
  if (!pipelines || pipelines.length === 0) return null;

  const activeOpportunity = opportunities?.find((o) => o._id === activeId);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select
          aria-label="Select pipeline"
          className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm transition-colors duration-150 hover:border-[var(--color-primary)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          value={activePipeline?._id}
          onChange={(e) => setPipelineId(e.target.value)}
        >
          {pipelines.map((p) => (
            <option key={p._id} value={p._id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onAddLead}
          className="ml-auto flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[image:var(--gradient-primary)] px-3 py-2 text-sm font-medium text-[var(--color-primary-fg)] shadow-sm transition-all duration-150 ease-[var(--ease-snappy)] hover:shadow-md active:scale-[0.97]"
        >
          <Plus className="h-4 w-4" /> Add Lead
        </button>
      </div>

      {oppsLoading ? (
        <SkeletonList rows={4} />
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="scrollbar-thin flex gap-3 overflow-x-auto pb-2">
            {activePipeline?.stages
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((stage, index) => (
                <KanbanColumn
                  key={stage.key}
                  stage={stage}
                  opportunities={opportunitiesByStage.get(stage.key) ?? []}
                  accent={stageAccent(index)}
                />
              ))}
          </div>
          <DragOverlay>{activeOpportunity ? <KanbanCard opportunity={activeOpportunity} /> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
