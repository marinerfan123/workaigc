import { useState } from 'react';
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
  MonitorPlay,
} from 'lucide-react';

interface TopBarProps {
  onSettingsOpen: () => void;
  onMediaPickerOpen: () => void;
}

export default function TopBar({ onSettingsOpen, onMediaPickerOpen }: TopBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);

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
        <div className="ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 text-xs font-bold text-black">
          ∞
        </div>
      </div>
    </header>
  );
}
