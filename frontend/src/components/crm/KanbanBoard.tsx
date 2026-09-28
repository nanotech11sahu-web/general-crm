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
      animate={{ opacity: isDragging ? 0.4 : 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className="cursor-grab rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-sm active:cursor-grabbing"
      {...listeners}
      {...attributes}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium">{opportunity.name}</p>
        <GripVertical className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden />
      </div>
      {opportunity.productInterest && <p className="mt-1 text-xs text-[var(--color-text-muted)]">{opportunity.productInterest}</p>}
      {typeof opportunity.value === 'number' && (
        <Badge tone="success" className="mt-2">
          ₹{opportunity.value.toLocaleString()}
        </Badge>
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

function KanbanColumn({ stage, opportunities }: { stage: PipelineStage; opportunities: Opportunity[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.key });
  const shouldVirtualize = opportunities.length > VIRTUALIZE_THRESHOLD;

  return (
    <div
      ref={setNodeRef}
      className={`flex w-72 shrink-0 flex-col rounded-[var(--radius-lg)] border border-[var(--color-border)] p-2 transition-colors ${
        isOver ? 'bg-[var(--color-primary)]/5' : 'bg-[var(--color-surface-muted)]'
      }`}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <p className="text-sm font-semibold">{stage.label}</p>
        <Badge>{opportunities.length}</Badge>
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
          className="h-9 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-sm"
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
          className="ml-auto flex items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3 py-2 text-sm font-medium text-[var(--color-primary-fg)]"
        >
          <Plus className="h-4 w-4" /> Add Lead
        </button>
      </div>

      {oppsLoading ? (
        <SkeletonList rows={4} />
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {activePipeline?.stages
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((stage) => (
                <KanbanColumn key={stage.key} stage={stage} opportunities={opportunitiesByStage.get(stage.key) ?? []} />
              ))}
          </div>
          <DragOverlay>{activeOpportunity ? <KanbanCard opportunity={activeOpportunity} /> : null}</DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
