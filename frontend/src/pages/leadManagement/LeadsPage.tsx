import { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { ContactsTable } from '../../components/crm/ContactsTable';
import { KanbanBoard } from '../../components/crm/KanbanBoard';
import { AddContactModal } from '../../components/crm/AddContactModal';

export function LeadsPage() {
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [addOpen, setAddOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] p-1 w-fit">
        <button
          type="button"
          onClick={() => setView('kanban')}
          aria-pressed={view === 'kanban'}
          className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium ${
            view === 'kanban' ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)]'
          }`}
        >
          <LayoutGrid className="h-4 w-4" /> Kanban
        </button>
        <button
          type="button"
          onClick={() => setView('list')}
          aria-pressed={view === 'list'}
          className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium ${
            view === 'list' ? 'bg-[var(--color-primary)] text-[var(--color-primary-fg)]' : 'text-[var(--color-text-muted)]'
          }`}
        >
          <List className="h-4 w-4" /> List
        </button>
      </div>

      {view === 'kanban' ? <KanbanBoard onAddLead={() => setAddOpen(true)} /> : <ContactsTable />}
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
