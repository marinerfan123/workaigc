import { NavLink } from 'react-router-dom';
import { Sparkles, Images, Boxes, ShoppingBag, User } from 'lucide-react';
import { cn } from '@/lib/utils';

/** 移动端底部 Tab 导航：仅 < md 显示（桌面由 NavigationDock 侧栏承载）。
 *  覆盖高频核心入口，其余入口（创作/角色/管理后台等）仍走顶部汉堡抽屉。 */
const TABS = [
  { to: '/workspace', label: '工作台', icon: Sparkles },
  { to: '/library', label: '素材', icon: Images },
  { to: '/model-hub', label: '模型', icon: Boxes },
  { to: '/shop', label: '商城', icon: ShoppingBag },
  { to: '/account', label: '我的', icon: User },
] as const;

export function BottomNav() {
  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t border-zinc-800 bg-black/95 backdrop-blur supports-[backdrop-filter]:bg-black/80 pb-[env(safe-area-inset-bottom)]"
      aria-label="底部导航"
    >
      <div className="flex items-stretch" style={{ height: 56 }}>
        {TABS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-medium transition-colors',
                isActive ? 'text-emerald-400' : 'text-zinc-400 hover:text-zinc-200',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="size-5" strokeWidth={isActive ? 2.2 : 1.8} />
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
