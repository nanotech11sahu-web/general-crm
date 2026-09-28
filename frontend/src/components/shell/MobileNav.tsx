import { NavLink } from 'react-router-dom';
import clsx from 'clsx';
import { NAV_ITEMS } from '../../config/navigation';

const PRIMARY_MOBILE_ITEMS = NAV_ITEMS.filter((item) =>
  ['dashboard', 'lead-management', 'inbox', 'calendar', 'settings'].includes(item.key),
);

export function MobileNav() {
  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[var(--color-border)] bg-[var(--color-surface)] md:hidden"
    >
      {PRIMARY_MOBILE_ITEMS.map((item) => (
        <NavLink
          key={item.key}
          to={item.to}
          className={({ isActive }) =>
            clsx(
              'flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium',
              isActive ? 'text-[var(--color-primary)]' : 'text-[var(--color-text-muted)]',
            )
          }
        >
          <item.icon className="h-5 w-5" aria-hidden />
          {item.label.split(' ')[0]}
        </NavLink>
      ))}
    </nav>
  );
}
