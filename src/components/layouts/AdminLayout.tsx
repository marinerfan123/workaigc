// 后台管理 Layout 壳（Phase 2 管理后台 + M3 总控台 + M4 智能体层）
// 左侧：总控台 / 智能体 / 用户 / 积分流水 / 技能注册 / 电商后台 + 返回前台 + 用户菜单
// 软 admin 守卫：骨架阶段展示权限提示横幅，但保留骨架可见性便于开发预览。
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  Bot,
  Users,
  Receipt,
  Boxes,
  Store,
  ArrowLeft,
  ShieldAlert,
  LogOut,
  Cpu,
  Activity,
  ScrollText,
  Library,
  Wallet,
  CreditCard,
} from 'lucide-react';
import { useAuth, logout } from '@/services/authStore';
import { cn } from '@/components/skeleton';

const ADMIN_NAV = [
  { to: '/admin', label: '运营总控台', icon: LayoutDashboard, end: true, desc: 'M3 实时态势' },
  { to: '/admin/monitor', label: 'API 活动流', icon: Activity, end: false, desc: '全站 HTTP 监控' },
  { to: '/admin/logs', label: '实时日志', icon: ScrollText, end: false, desc: 'PG/Redis/控制台' },
  { to: '/admin/agents', label: '智能体层', icon: Bot, end: false, desc: 'M4 看板+管理' },
  { to: '/admin/users', label: '用户管理', icon: Users, end: false, desc: '列表+手动充值' },
  { to: '/admin/samples', label: '示例库', icon: Library, end: false, desc: '推送顾客' },
  { to: '/admin/models', label: '模型管理', icon: Cpu, end: false, desc: '沿用 ModelHub' },
  { to: '/admin/finance', label: '账务中心', icon: Wallet, end: false, desc: 'Phase4 总览/对账' },
  { to: '/admin/payment-settings', label: '支付设置', icon: CreditCard, end: false, desc: '通道/启停' },
  { to: '/admin/transactions', label: '积分流水', icon: Receipt, end: false, desc: 'M2 流水' },
  { to: '/admin/skills', label: '技能注册', icon: Boxes, end: false, desc: 'skill_registry' },
  { to: '/admin/ecommerce', label: '电商后台', icon: Store, end: false, desc: 'M6 后台' },
];

export function AdminLayout() {
  const { user, ready } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isAdmin = user?.role === 'admin';

  return (
    <div className="flex h-screen w-full overflow-hidden bg-black text-white">
      {/* 后台侧栏 */}
      <aside className="flex w-[240px] shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex items-center gap-2 px-4 py-4">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/20">
            <ShieldAlert className="size-4" />
          </div>
          <div>
            <div className="text-sm font-semibold text-white">管理后台</div>
            <div className="text-[11px] text-zinc-500">Admin Console</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-2">
          {ADMIN_NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.end
                ? location.pathname === item.to
                : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={cn(
                  'flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-200',
                  active
                    ? 'bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/20'
                    : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* 返回前台 + 用户 */}
        <div className="space-y-1 border-t border-zinc-800 px-2 py-2">
          <button
            onClick={() => navigate('/')}
            className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors"
          >
            <ArrowLeft className="size-4 shrink-0" />
            返回前台
          </button>
          {user && (
            <div className="flex items-center gap-2 rounded-2xl px-3 py-2">
              <div className="flex size-8 items-center justify-center rounded-full bg-zinc-800 text-xs font-semibold text-emerald-300">
                {(user.displayName || user.email).slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs text-white">{user.displayName || user.email}</div>
                <div className="text-[10px] text-zinc-500">
                  {isAdmin ? '管理员' : '普通用户'} · {user.credits} 积分
                </div>
              </div>
              <button
                onClick={() => logout()}
                title="退出登录"
                className="text-zinc-500 hover:text-red-400 transition-colors"
              >
                <LogOut className="size-4" />
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* 主区 */}
      <div className="flex flex-1 flex-col min-w-0">
        {!ready ? (
          <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
            正在校验会话…
          </div>
        ) : !user ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <ShieldAlert className="size-8 text-zinc-600" />
            <p className="text-sm text-zinc-400">请先登录后再访问管理后台</p>
            <button
              onClick={() => navigate('/login')}
              className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 transition-colors"
            >
              前往登录
            </button>
          </div>
        ) : !isAdmin ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
            <ShieldAlert className="size-10 text-zinc-600" />
            <div>
              <p className="text-base font-medium text-zinc-200">无权限访问管理后台</p>
              <p className="mt-1 text-sm text-zinc-500">仅管理员账号可进入，请联系平台管理员获取权限。</p>
            </div>
            <button
              onClick={() => navigate('/')}
              className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 transition-colors"
            >
              返回前台
            </button>
          </div>
        ) : (
          <main className="flex-1 overflow-y-auto">
            <Outlet />
          </main>
        )}
      </div>
    </div>
  );
}
