import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { globalSearch } from '../../lib/api/search';

export function GlobalSearchBar() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['global-search', query],
    queryFn: () => globalSearch(query),
    enabled: query.trim().length > 1,
  });

  function goTo(link: string) {
    setOpen(false);
    setQuery('');
    navigate(link);
  }

  return (
    <div ref={containerRef} className="relative hidden w-64 md:block lg:w-80">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" aria-hidden />
      <input
        type="search"
        placeholder="Search contacts, projects, forms…"
        aria-label="Global search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="h-9 w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-muted)] pl-9 pr-3 text-sm outline-none focus:border-[var(--color-primary)]"
      />
      {open && query.trim().length > 1 && (
        <div className="absolute left-0 top-11 z-40 max-h-80 w-full overflow-y-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-card)]">
          {!data || data.length === 0 ? (
            <p className="px-3 py-2 text-sm text-[var(--color-text-muted)]">No matches yet.</p>
          ) : (
            data.map((result) => (
              <button
                key={`${result.type}-${result.id}`}
                type="button"
                onMouseDown={() => goTo(result.link)}
                className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-[var(--color-surface-muted)]"
              >
                <span className="font-medium">{result.label}</span>
                <span className="text-xs text-[var(--color-text-muted)]">
                  {result.type}
                  {result.subtitle ? ` · ${result.subtitle}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
