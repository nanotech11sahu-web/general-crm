import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import clsx from 'clsx';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { MobileNav } from './MobileNav';
import { MobileDrawer } from './MobileDrawer';
import { FloatingButtons } from './FloatingButtons';
import { CommandPalette } from './CommandPalette';

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const isHub = useLocation().pathname === '/';

  return (
    <div className="flex h-screen w-full overflow-hidden">
      {!isHub && <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenMobileDrawer={() => setDrawerOpen(true)} />
        <main className={clsx('flex-1 overflow-y-auto', isHub ? '' : 'p-4 pb-20 md:pb-4')}>
          <Outlet />
        </main>
      </div>
      {!isHub && <MobileNav />}
      {!isHub && <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />}
      <FloatingButtons />
      <CommandPalette />
    </div>
  );
}
