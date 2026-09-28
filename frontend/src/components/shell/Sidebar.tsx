import { NavLink, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink as ExternalLinkIcon, ChevronsLeft, ChevronsRight, LayoutGrid } from 'lucide-react';
import clsx from 'clsx';
import { NAV_ITEMS, EXTERNAL_LINKS } from '../../config/navigation';
import { findVerticalForPath } from '../../config/verticals';
import { getBranding } from '../../lib/api/settings';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const NAV_TO_BY_KEY: Record<string, string> = Object.fromEntries(NAV_ITEMS.map((item) => [item.key, item.to]));

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const { data: branding } = useQuery({ queryKey: ['branding'], queryFn: getBranding, staleTime: 60_000 });
  const location = useLocation();
  const activeVertical = findVerticalForPath(location.pathname, NAV_TO_BY_KEY);
  const visibleNavItems = activeVertical
    ? NAV_ITEMS.filter((item) => activeVertical.navKeys.includes(item.key))
    : NAV_ITEMS;

  return (
    <aside
      className={clsx(
        'hidden shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)] transition-[width] duration-200 md:flex',
        collapsed ? 'w-[76px]' : 'w-64',
      )}
      style={branding ? ({ '--color-primary': branding.primaryColor } as React.CSSProperties) : undefined}
      aria-label="Primary navigation"
    >
      {!collapsed && branding && (
        <div className="border-b border-[var(--color-border)] px-4 py-3">
          <p className="truncate text-sm font-semibold text-[var(--color-primary)]">{branding.experienceName}</p>
        </div>
      )}
      <nav className="flex-1 overflow-y-auto px-2 py-4">
        {activeVertical && (
          <NavLink
            to="/"
            className="mb-3 flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
          >
            <LayoutGrid className="h-5 w-5 shrink-0" aria-hidden />
            {!collapsed && <span>All workspaces</span>}
          </NavLink>
        )}
        <ul className="space-y-1">
          {visibleNavItems.map((item) => (
            <li key={item.key}>
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  clsx(
                    'group flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 text-sm font-medium transition-colors duration-150',
                    isActive
                      ? 'bg-[var(--color-primary)] text-white'
                      : 'text-[var(--color-text-muted)] hover:text-[var(--color-primary)]',
                  )
                }
              >
                <item.icon className="h-5 w-5 shrink-0" aria-hidden />
                {!collapsed && <span>{item.label}</span>}
              </NavLink>
            </li>
          ))}
        </ul>

        {!collapsed && (
          <div className="mt-6 border-t border-[var(--color-border)] pt-4">
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
              External Links
            </p>
            <ul className="space-y-1">
              {EXTERNAL_LINKS.map((link) => (
                <li key={link.key}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]"
                  >
                    <ExternalLinkIcon className="h-4 w-4 shrink-0" aria-hidden />
                    <span className="truncate">{link.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="flex items-center justify-center gap-2 border-t border-[var(--color-border)] py-3 text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
      >
        {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
      </button>
    </aside>
  );
}
