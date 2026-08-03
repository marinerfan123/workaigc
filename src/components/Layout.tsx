import { Outlet, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import { useMediaCounts } from '@/hooks/useMediaCounts';
import { useAuth, logout } from '@/services/authStore';
import { ProductSwitcher } from '@/components/ProductSwitcher';

export function Layout() {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { counts } = useMediaCounts();
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-black text-white">
      {/* 全局产品切换条（与其他模块共用 ProductSwitcher） */}
      <header className="flex shrink-0 items-center justify-between gap-4 border-b border-zinc-800 px-5 py-3">
        <ProductSwitcher />
        <div className="flex items-center gap-3">
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">{user.credits} 积分</span>
              <div className="flex size-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-emerald-300">
                {(user.displayName || user.email).slice(0, 1).toUpperCase()}
              </div>
              <button
                onClick={() => logout()}
                className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
              >
                退出
              </button>
            </div>
          ) : (
            <button
              onClick={() => navigate('/login')}
              className="rounded-2xl bg-emerald-500 px-3 py-1.5 text-xs font-medium text-black hover:bg-emerald-400 transition-colors"
            >
              登录
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapsed={() => setSidebarCollapsed(!sidebarCollapsed)}
          counts={counts}
        />
        <main className="flex-1 min-h-0 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
