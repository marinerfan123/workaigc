import { useState } from 'react';
import {
  LayoutGrid,
  Image as ImageIcon,
  Video,
  User,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Search,
  MoreVertical,
  Settings2,
  Wrench,
  Sparkles,
  FolderOpen,
  Upload,
  MoreHorizontal,
} from 'lucide-react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { MediaCounts } from '@/services/api';

interface SidebarProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  counts: MediaCounts | null;
}

const NAV_ITEMS = [
  { path: '/', label: '所有媒体内容', icon: LayoutGrid, countKey: 'total' as const },
];

const LIBRARY_CATEGORIES = [
  { path: '/library', label: '全部', icon: LayoutGrid, countKey: 'total' as const },
  { path: '/library/image', label: '图片', icon: ImageIcon, countKey: 'image' as const },
  { path: '/library/video', label: '视频', icon: Video, countKey: 'video' as const },
  { path: '/library/character', label: '角色', icon: User, countKey: 'character' as const },
  { path: '/library/scene', label: '场景', icon: FolderOpen, countKey: 'scene' as const },
  { path: '/library/prop', label: '道具', icon: Sparkles, countKey: 'prop' as const },
  { path: '/library/other', label: '其他', icon: MoreHorizontal, countKey: 'other' as const },
  { path: '/library/upload', label: '上传的内容', icon: Upload, countKey: 'upload' as const },
];

const BOTTOM_ITEMS = [
  { key: 'tools', label: '工具', icon: Wrench },
  { key: 'trash', label: '回收站', icon: Trash2 },
];

export default function Sidebar({ collapsed, onToggleCollapsed, counts }: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [projectName] = useState('东方古典美人项目');

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(`${path}/`);
  };

  return (
    <aside
      className={`flex h-full flex-col border-r border-zinc-800 bg-black transition-all duration-300 ${
        collapsed ? 'w-[64px]' : 'w-[220px]'
      }`}
    >
      {/* 顶部：返回 + 项目名 */}
      <div className="flex items-center gap-2 px-3 py-3">
        <button className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-colors">
          <ChevronLeft className="size-4" />
        </button>
        {!collapsed && (
          <div className="relative flex-1 min-w-0">
            <button
              onClick={() => setProjectMenuOpen(!projectMenuOpen)}
              className="flex w-full items-center justify-between gap-1 rounded-2xl px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800/50 transition-colors"
            >
              <span className="truncate">{projectName}</span>
              <MoreVertical className="size-3.5 shrink-0 text-zinc-500" />
            </button>
            {projectMenuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setProjectMenuOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-[1.5rem] bg-zinc-900 p-2 border border-zinc-800">
                  <button className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm text-white hover:bg-zinc-800/70 transition-colors">
                    <Settings2 className="size-4 text-emerald-400" />
                    重命名
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm text-white hover:bg-zinc-800/70 transition-colors">
                    <Trash2 className="size-4 text-zinc-400" />
                    查看回收站
                  </button>
                  <button className="flex w-full items-center gap-2 rounded-2xl px-3 py-2 text-sm text-red-400 hover:bg-zinc-800/70 transition-colors">
                    <Trash2 className="size-4" />
                    删除
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* 搜索框 */}
      {!collapsed && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
            <input
              type="search"
              placeholder="搜索"
              className="w-full rounded-2xl bg-zinc-900 pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-800 focus:outline-none focus:border-emerald-500/50 transition-colors"
            />
          </div>
        </div>
      )}

      {/* 导航菜单项 */}
      <nav className="flex-1 space-y-0.5 px-2 py-2 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          const n = counts?.[item.countKey];
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === '/'}
              className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-300 ${
                active
                  ? 'bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20'
                  : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white border border-transparent'
              } ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-4 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && n != null && n > 0 && (
                <span
                  className={`ml-auto text-[10px] font-semibold tabular-nums px-1.5 min-w-[20px] text-center rounded-full ${
                    active
                      ? 'bg-emerald-500/25 text-emerald-300'
                      : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {n > 99 ? '99+' : n}
                </span>
              )}
            </NavLink>
          );
        })}

        {/* 素材库分组 */}
        {!collapsed && (
          <div className="mt-3 mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
            素材库
          </div>
        )}
        {LIBRARY_CATEGORIES.slice(0, collapsed ? 0 : LIBRARY_CATEGORIES.length).map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          const n = counts?.[item.countKey];
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end
              className={`flex items-center gap-3 rounded-2xl px-3 py-2 text-xs transition-all duration-300 ${
                active
                  ? 'bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20'
                  : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-white border border-transparent'
              } ${collapsed ? 'justify-center' : ''}`}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="size-3.5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
              {!collapsed && n != null && n > 0 && (
                <span
                  className={`ml-auto text-[10px] font-semibold tabular-nums px-1.5 min-w-[20px] text-center rounded-full ${
                    active
                      ? 'bg-emerald-500/25 text-emerald-300'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {n > 99 ? '99+' : n}
                </span>
              )}
            </NavLink>
          );
        })}

        {/* 角色管理 */}
        {!collapsed && (
          <div className="mt-3 mb-1 px-3 text-[10px] font-bold uppercase tracking-widest text-zinc-600">
            管理
          </div>
        )}
        <NavLink
          to="/characters"
          end
          className={`flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition-all duration-300 ${
            isActive('/characters')
              ? 'bg-emerald-500/10 text-emerald-400 font-medium border border-emerald-500/20'
              : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-white border border-transparent'
          } ${collapsed ? 'justify-center' : ''}`}
          title={collapsed ? '角色管理' : undefined}
        >
          <User className="size-4 shrink-0" />
          {!collapsed && <span className="truncate">角色管理</span>}
        </NavLink>
      </nav>

      {/* 底部分隔 + 工具/回收站 + 收起按钮 */}
      <div className="border-t border-zinc-800 px-2 py-2 space-y-1">
        {/* 工具下拉 */}
        <div className="relative">
          <button
            onClick={() => setToolsMenuOpen(!toolsMenuOpen)}
            className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-all duration-300 ${
              collapsed ? 'justify-center' : ''
            }`}
            title={collapsed ? '工具' : undefined}
          >
            <Wrench className="size-4 shrink-0" />
            {!collapsed && (
              <>
                <span className="truncate flex-1 text-left">工具</span>
                <ChevronDown className={`size-3 transition-transform ${toolsMenuOpen ? 'rotate-180' : ''}`} />
              </>
            )}
          </button>
          {toolsMenuOpen && !collapsed && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setToolsMenuOpen(false)} />
              <div className="absolute left-0 bottom-full z-40 mb-1 w-48 rounded-2xl bg-zinc-900 border border-zinc-800 p-1.5">
                <button
                  onClick={() => {
                    navigate('/model-hub');
                    setToolsMenuOpen(false);
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white hover:bg-zinc-800/70 transition-colors"
                >
                  <Settings2 className="size-4 text-emerald-400" />
                  模型 Hub
                </button>
                <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-white hover:bg-zinc-800/70 transition-colors">
                  <Trash2 className="size-4 text-zinc-400" />
                  回收站
                </button>
              </div>
            </>
          )}
        </div>

        <button
          onClick={onToggleCollapsed}
          className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm text-zinc-400 hover:bg-zinc-800/50 hover:text-white transition-all duration-300 ${
            collapsed ? 'justify-center' : ''
          }`}
          title={collapsed ? '展开' : '收起'}
        >
          {collapsed ? (
            <ChevronRight className="size-4 shrink-0" />
          ) : (
            <>
              <ChevronLeft className="size-4 shrink-0" />
              <span className="truncate">收起</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
