// 电商商城 Layout 壳（M6 电商模块 / Phase 5）
// 顶部导航：品牌 + 分类/搜索 + 购物车 + 用户菜单；Outlet 渲染各电商子页。
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { ShoppingBag, Search, ShoppingCart } from 'lucide-react';
import { useAuth, logout } from '@/services/authStore';
import { cn } from '@/components/skeleton';
import { ProductSwitcher } from '@/components/ProductSwitcher';

const SHOP_CATS = [
  { to: '/shop', label: '全部', end: true },
  { to: '/shop?cat=art', label: '艺术周边' },
  { to: '/shop?cat=figure', label: '手办模型' },
  { to: '/shop?cat=digital', label: '数字藏品' },
  { to: '/shop?cat=book', label: '出版物' },
];

export function ShopLayout() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      {/* 商城顶栏 */}
      <header className="sticky top-0 z-30 border-b border-zinc-800 bg-black/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-3">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2"
          >
            <ShoppingBag className="size-5 text-emerald-400" />
            <span className="text-sm font-semibold text-white">AI 市集</span>
          </button>

          <ProductSwitcher className="hidden lg:flex" />

          {/* 搜索 */}
          <div className="relative hidden flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              placeholder="搜索商品 / 自然语言搜（search_agent）"
              className="w-full rounded-2xl border border-zinc-800 bg-zinc-900 pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none transition-colors"
            />
          </div>

          <button
            onClick={() => navigate('/cart')}
            className="relative flex size-9 items-center justify-center rounded-xl text-zinc-300 hover:bg-zinc-800/60 transition-colors"
            title="购物车"
          >
            <ShoppingCart className="size-5" />
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-emerald-400" />
          </button>

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

        {/* 分类条 */}
        <div className="mx-auto flex max-w-6xl items-center gap-1 overflow-x-auto px-5 pb-2">
          {SHOP_CATS.map((c) => (
            <NavLink
              key={c.label}
              to={c.to}
              end={c.end}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-full px-3 py-1.5 text-xs transition-colors',
                  isActive
                    ? 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30'
                    : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-white',
                )
              }
            >
              {c.label}
            </NavLink>
          ))}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6">
        <Outlet />
      </main>
    </div>
  );
}
