// 创作工作室 Layout 壳（M5 创意生产流水线 / Phase 4）
// 外层壳：品牌条 + 返回前台 + 用户菜单；项目头与五阶段 Tab 由 StudioStagePage 内部渲染。
import { Outlet, useNavigate } from 'react-router-dom';
import { Clapperboard, ArrowLeft } from 'lucide-react';
import { useAuth, logout } from '@/services/authStore';

export function StudioLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-black text-white">
      {/* 顶部品牌条 */}
      <header className="flex shrink-0 items-center justify-between border-b border-zinc-800 px-5 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/')}
            className="flex size-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors"
            title="返回前台"
          >
            <ArrowLeft className="size-4" />
          </button>
          <div className="flex items-center gap-2">
            <Clapperboard className="size-5 text-emerald-400" />
            <span className="text-sm font-semibold text-white">创作工作室</span>
            <span className="text-[11px] text-zinc-500">Studio · M5 流水线</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/studio')}
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            项目列表
          </button>
          {user ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-zinc-500">
                {user.credits} 积分
              </span>
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

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
