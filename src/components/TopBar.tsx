import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  HelpCircle,
  Settings,
  MoreVertical,
  Download,
  ExternalLink,
  Info,
  Play,
  MessageSquareWarning,
  Flag,
  ShieldCheck,
  List,
  User,
  MonitorPlay,
  LogIn,
  LogOut,
  RefreshCw,
  Wallet,
} from 'lucide-react';
import { useAuth, logout, setAuthModalOpen, refreshUser } from '@/services/authStore';
import RechargeModal from '@/components/RechargeModal';

interface TopBarProps {
  onSettingsOpen: () => void;
  onMediaPickerOpen: () => void;
}

export default function TopBar({ onSettingsOpen, onMediaPickerOpen }: TopBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rechargeOpen, setRechargeOpen] = useState(false);
  const { user } = useAuth();
  const navigate = useNavigate();

  const moreItems = [
    { icon: Download, label: '下载项目' },
    { icon: ExternalLink, label: '产品帮助' },
    { icon: HelpCircle, label: 'Flow 帮助中心' },
    { icon: List, label: '查看所有更新日志' },
    { icon: MonitorPlay, label: 'Google Flow TV' },
    { icon: Info, label: '关于 Flow' },
    { icon: Play, label: '了解 Flow' },
    { icon: MessageSquareWarning, label: '发送应用反馈' },
    { icon: Flag, label: '举报法律问题' },
    { icon: ShieldCheck, label: '隐私声明' },
  ];

  return (
    <header className="flex h-14 items-center justify-between px-4 border-b border-zinc-800 bg-black/80 backdrop-blur-md z-20 sticky top-0">
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <button
          onClick={onMediaPickerOpen}
          className="flex h-9 w-9 items-center justify-center rounded-2xl text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors"
          title="新建"
        >
          <Plus className="size-4" />
        </button>
        <button
          className="flex h-9 w-9 items-center justify-center rounded-2xl text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors"
          title="帮助"
        >
          <HelpCircle className="size-4" />
        </button>
        <button
          onClick={onSettingsOpen}
          className="flex h-9 w-9 items-center justify-center rounded-2xl text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors"
          title="设置"
        >
          <Settings className="size-4" />
        </button>
        <div className="relative">
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="flex h-9 w-9 items-center justify-center rounded-2xl text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors"
            title="更多"
          >
            <MoreVertical className="size-4" />
          </button>
          {moreOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-56 rounded-[1.5rem] bg-zinc-900 p-2 border border-zinc-800">
                {moreItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.label}
                      onClick={() => setMoreOpen(false)}
                      className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-sm text-white hover:bg-zinc-800/70 transition-colors"
                    >
                      <Icon className="size-4 text-zinc-500" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {user ? (
          <div className="relative ml-2">
            <button
              onClick={() => setRechargeOpen(true)}
              className="mr-1.5 flex h-9 items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
              title="充值积分"
            >
              <Wallet className="size-3.5" /> 充值
            </button>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 rounded-full bg-zinc-800/60 py-1 pl-2 pr-1 hover:bg-zinc-800 transition-colors"
              title="账户"
            >
              <span className="shrink-0 rounded-full border border-amber-500/20 bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">
                {user.credits} 积分
              </span>
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 text-xs font-bold text-black">
                {(user.displayName || user.email || 'U')[0]?.toUpperCase() || 'U'}
              </span>
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-2xl border border-zinc-800 bg-zinc-900 p-2 shadow-2xl">
                  <div className="truncate px-3 py-2 text-sm font-medium text-white">
                    {user.displayName || user.email}
                  </div>
                  <div className="truncate px-3 pb-2 text-xs text-zinc-500">{user.email}</div>
                  <button
                    onClick={async () => { await refreshUser().catch(() => {}); }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                  >
                    <RefreshCw className="size-4 text-zinc-500" /> 刷新积分
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); navigate('/account'); }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                  >
                    <Settings className="size-4 text-zinc-500" /> 账户设置
                  </button>
                  <button
                    onClick={() => { setMenuOpen(false); navigate(`/user/${user.id}`); }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-zinc-300 hover:bg-zinc-800/70 transition-colors"
                  >
                    <User className="size-4 text-zinc-500" /> 我的主页
                  </button>
                  <button
                    onClick={async () => { await logout(); setMenuOpen(false); }}
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-red-400 hover:bg-zinc-800/70 transition-colors"
                  >
                    <LogOut className="size-4" /> 退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <button
            onClick={() => setAuthModalOpen(true)}
            className="ml-2 flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-colors"
          >
            <LogIn className="size-3.5" /> 登录
          </button>
        )}
      </div>
      <RechargeModal open={rechargeOpen} onClose={() => setRechargeOpen(false)} />
    </header>
  );
}
