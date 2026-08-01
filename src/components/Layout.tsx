import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { useMediaCounts } from '@/hooks/useMediaCounts';

export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { counts } = useMediaCounts();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-black text-white">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
        counts={counts}
      />
      <div className="flex flex-1 flex-col min-w-0">
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
