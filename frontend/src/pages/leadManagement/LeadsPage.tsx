import { useState } from 'react';
import { LayoutGrid, List, Plus, UploadCloud } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ContactsTable } from '../../components/crm/ContactsTable';
import { KanbanBoard } from '../../components/crm/KanbanBoard';
import { AddContactModal } from '../../components/crm/AddContactModal';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';

export function LeadsPage() {
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [addOpen, setAddOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-1 w-fit">
          <button
            type="button"
            onClick={() => setView('kanban')}
            aria-pressed={view === 'kanban'}
            className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors ${
              view === 'kanban' ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)]'
            }`}
          >
            <LayoutGrid className="h-4 w-4" /> Kanban
          </button>
          <button
            type="button"
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            className={`flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors ${
              view === 'list' ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm' : 'text-[var(--color-text-muted)]'
            }`}
          >
            <List className="h-4 w-4" /> List
          </button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => navigate('/lead-management/import')}>
            <UploadCloud className="h-4 w-4" /> Import Leads
          </Button>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4" /> Add Lead
          </Button>
        </div>
      </Card>

      {view === 'kanban' ? <KanbanBoard onAddLead={() => setAddOpen(true)} /> : <ContactsTable />}
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
