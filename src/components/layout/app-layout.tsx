import { Outlet } from 'react-router-dom';
import { cn } from '@/shared/lib/utils';
import { SidebarProvider, useSidebar } from './sidebar-context';
import { IconRail } from './icon-rail';
import { SecondaryPanel } from './secondary-panel';

function AppLayoutInner() {
  const { secondaryOpen } = useSidebar();

  return (
    <div className="bg-sidebar flex h-screen overflow-hidden">
      <IconRail />
      <SecondaryPanel />
      <div
        className={cn(
          'bg-background my-2 mr-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl shadow-sm transition-[margin] duration-200',
          !secondaryOpen && 'ml-2'
        )}
      >
        <Outlet />
      </div>
    </div>
  );
}

export function AppLayout() {
  return (
    <SidebarProvider>
      <AppLayoutInner />
    </SidebarProvider>
  );
}
