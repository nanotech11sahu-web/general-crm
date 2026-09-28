import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { CornerDownLeft, Search } from 'lucide-react';
import { NAV_ITEMS } from '../../config/navigation';
import { globalSearch } from '../../lib/api/search';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const matchingNav = useMemo(
    () => NAV_ITEMS.filter((item) => item.label.toLowerCase().includes(query.toLowerCase())),
    [query],
  );

  const { data: searchResults } = useQuery({
    queryKey: ['command-palette-search', query],
    queryFn: () => globalSearch(query),
    enabled: open && query.trim().length > 1,
  });

  function goTo(to: string) {
    setOpen(false);
    navigate(to);
  }

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-start justify-center pt-24">
        <motion.div
          className="absolute inset-0 bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setOpen(false)}
          aria-hidden
        />
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          initial={{ opacity: 0, scale: 0.97, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -8 }}
          transition={{ duration: 0.15 }}
          className="relative z-10 w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-card)]"
        >
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4 py-3">
            <Search className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Jump to a module, or search contacts/projects/forms…"
              aria-label="Command palette input"
              className="h-8 flex-1 bg-transparent text-sm outline-none"
            />
            <kbd className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-muted)]">Esc</kbd>
          </div>
          <div className="max-h-96 overflow-y-auto py-1">
            {matchingNav.length > 0 && (
              <div className="px-2 py-1">
                <p className="px-2 py-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">Go to</p>
                {matchingNav.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => goTo(item.to)}
                    className="flex w-full items-center justify-between rounded-[var(--radius-md)] px-2 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
                  >
                    <span className="flex items-center gap-2">
                      <item.icon className="h-4 w-4 text-[var(--color-text-muted)]" aria-hidden />
                      {item.label}
                    </span>
                    <CornerDownLeft className="h-3.5 w-3.5 text-[var(--color-text-muted)]" aria-hidden />
                  </button>
                ))}
              </div>
            )}
            {searchResults && searchResults.length > 0 && (
              <div className="border-t border-[var(--color-border)] px-2 py-1">
                <p className="px-2 py-1 text-xs font-semibold uppercase text-[var(--color-text-muted)]">Results</p>
                {searchResults.map((result) => (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    onClick={() => goTo(result.link)}
                    className="flex w-full flex-col items-start rounded-[var(--radius-md)] px-2 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
                  >
                    <span className="font-medium">{result.label}</span>
                    <span className="text-xs text-[var(--color-text-muted)]">{result.type}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim().length > 1 && matchingNav.length === 0 && (!searchResults || searchResults.length === 0) && (
              <p className="px-4 py-6 text-center text-sm text-[var(--color-text-muted)]">No matches.</p>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body,
  );
}
