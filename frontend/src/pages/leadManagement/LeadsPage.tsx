import { useState } from 'react';
import { LayoutGrid, List, Plus, UploadCloud } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
        <div className="relative flex items-center gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-muted)] p-1 w-fit">
          {(['kanban', 'list'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              className={`relative z-10 flex items-center gap-1.5 rounded-[var(--radius-sm)] px-3 py-1.5 text-sm font-medium transition-colors duration-200 ${
                view === option ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text)]'
              }`}
            >
              {view === option && (
                <motion.span
                  layoutId="leads-view-indicator"
                  className="absolute inset-0 -z-10 rounded-[var(--radius-sm)] bg-[var(--color-surface)] shadow-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              {option === 'kanban' ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
              {option === 'kanban' ? 'Kanban' : 'List'}
            </button>
          ))}
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

      <AnimatePresence mode="wait">
        <motion.div
          key={view}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {view === 'kanban' ? <KanbanBoard onAddLead={() => setAddOpen(true)} /> : <ContactsTable />}
        </motion.div>
      </AnimatePresence>
      <AddContactModal open={addOpen} onClose={() => setAddOpen(false)} />
    </div>
  );
}
