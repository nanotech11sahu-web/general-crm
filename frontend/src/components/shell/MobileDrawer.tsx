import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { NAV_ITEMS, EXTERNAL_LINKS } from '../../config/navigation';

interface MobileDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 md:hidden">
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="relative z-10 flex h-full w-72 flex-col bg-[var(--color-surface)] p-3"
            role="dialog"
            aria-label="Navigation drawer"
          >
            <button type="button" onClick={onClose} aria-label="Close navigation" className="self-end p-2 text-[var(--color-text-muted)]">
              <X className="h-5 w-5" />
            </button>
            <nav className="flex-1 overflow-y-auto">
              <ul className="space-y-1">
                {NAV_ITEMS.map((item) => (
                  <li key={item.key}>
                    <NavLink
                      to={item.to}
                      onClick={onClose}
                      className="flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-muted)]"
                    >
                      <item.icon className="h-5 w-5" aria-hidden />
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
              <div className="mt-4 border-t border-[var(--color-border)] pt-3">
                <p className="px-3 pb-2 text-xs font-semibold uppercase text-[var(--color-text-muted)]">External Links</p>
                {EXTERNAL_LINKS.map((link) => (
                  <a
                    key={link.key}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                    className="block rounded-[var(--radius-md)] px-3 py-2 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)]"
                  >
                    {link.name}
                  </a>
                ))}
              </div>
            </nav>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
