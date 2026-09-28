import { useState } from 'react';
import {
  Menu,
  Grid3x3,
  Rocket,
  Shield,
  Mic,
  ChevronDown,
  Megaphone,
  ExternalLink,
  MoreHorizontal,
} from 'lucide-react';
import { useAuthStore } from '../../stores/authStore';
import { GlobalSearchBar } from './GlobalSearchBar';
import { NotificationBell } from './NotificationBell';

interface TopBarProps {
  onOpenMobileDrawer: () => void;
}

export function TopBar({ onOpenMobileDrawer }: TopBarProps) {
  const user = useAuthStore((s) => s.user);
  const [profileOpen, setProfileOpen] = useState(false);

  const iconButtonClass =
    'flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-muted)] hover:text-[var(--color-text)]';

  return (
    <header className="flex h-14 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3">
      <button type="button" className={`${iconButtonClass} md:hidden`} aria-label="Open menu" onClick={onOpenMobileDrawer}>
        <Menu className="h-5 w-5" />
      </button>

      <button type="button" className="flex items-center gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-sm font-medium hover:bg-[var(--color-surface-muted)]">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary)] text-xs font-semibold text-[var(--color-primary-fg)]">
          {user?.name?.[0]?.toUpperCase() ?? 'P'}
        </span>
        <span className="hidden sm:inline">{user?.name ?? 'Account Owner'}</span>
        <ChevronDown className="h-4 w-4" aria-hidden />
      </button>

      <GlobalSearchBar />

      <div className="ml-auto flex items-center gap-1">
        <button type="button" className={iconButtonClass} aria-label="Apps grid">
          <Grid3x3 className="h-5 w-5" />
        </button>
        <button type="button" className={iconButtonClass} aria-label="App launcher">
          <Rocket className="h-5 w-5" />
        </button>
        <button type="button" className={iconButtonClass} aria-label="Security and compliance">
          <Shield className="h-5 w-5" />
        </button>
        <button type="button" className={iconButtonClass} aria-label="Voice assistant">
          <Mic className="h-5 w-5" />
        </button>

        <button type="button" className={`${iconButtonClass} relative`} aria-label="Announcements">
          <Megaphone className="h-5 w-5" />
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-[var(--color-danger)] px-1 text-[10px] font-semibold text-white">
            9+
          </span>
        </button>

        <NotificationBell />

        <div className="hidden items-center gap-1 lg:flex">
          <button type="button" className={iconButtonClass} aria-label="Quick link 1">
            <ExternalLink className="h-4 w-4" />
          </button>
          <button type="button" className={iconButtonClass} aria-label="Quick link 2">
            <ExternalLink className="h-4 w-4" />
          </button>
          <button type="button" className={iconButtonClass} aria-label="Quick link 3">
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>

        <button type="button" className={iconButtonClass} aria-label="More options">
          <MoreHorizontal className="h-5 w-5" />
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setProfileOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={profileOpen}
            aria-label="Profile menu"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-surface-muted)] text-sm font-semibold"
          >
            {user?.name?.[0]?.toUpperCase() ?? 'P'}
          </button>
        </div>
      </div>
    </header>
  );
}
