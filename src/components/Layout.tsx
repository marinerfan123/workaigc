import { Outlet } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Menu } from 'lucide-react';
import Sidebar from '@/components/Sidebar';
import { useMediaCounts } from '@/hooks/useMediaCounts';

export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // 移动端抽屉：< md 断点时使用，桌面端始终 false
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { counts } = useMediaCounts();

  // 路由变化或抽屉状态变化时锁 body 滚动（抽屉打开时防止背景跟随滚）
  useEffect(() => {
    if (mobileSidebarOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileSidebarOpen]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-black text-white">
      {/* 桌面端：inline aside；移动端（< md）由 Sidebar 内部 fixed drawer 渲染 */}
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
        counts={counts}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
      />
      <div className="flex flex-1 flex-col min-w-0">
        {/* 移动端顶部汉堡：仅 < md 显示，避免遮挡桌面布局 */}
        <div className="md:hidden flex items-center gap-2 border-b border-zinc-800 px-3 py-2 shrink-0">
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            aria-label="打开菜单"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-300 hover:bg-zinc-800/60 hover:text-white transition-colors"
          >
            <Menu className="size-5" />
          </button>
          <span className="text-sm font-semibold text-zinc-200">工作台</span>
        </div>
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
