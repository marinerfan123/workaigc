import { Outlet, useOutletContext, useLocation } from 'react-router-dom';
import { useState, useEffect, useMemo } from 'react';
import { NavigationDock, MobileDockBar } from '@/components/NavigationDock';
import { BottomNav } from '@/components/BottomNav';
import { workspaceDockConfig } from '@/components/navigationDockConfigs';
import { useMediaCounts } from '@/hooks/useMediaCounts';
import { useAuth } from '@/services/authStore';

/** 子路由（LibraryPage / WorkspacePage 等）通过 useOutletContext 拿到，删除/生成后立刻刷新侧边栏计数 */
export type LayoutOutletCtx = {
  refreshMediaCounts: () => Promise<void>;
  /** 移动端：打开左侧导航抽屉（页面自带 TopBar 时，由 TopBar 的左上角汉堡触发，外壳不再重复渲染顶栏） */
  onOpenMobileDock: () => void;
};
export function useLayoutOutlet() {
  return useOutletContext<LayoutOutletCtx>();
}

export function Layout() {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const [mobileDockOpen, setMobileDockOpen] = useState(false);
  const { counts, refresh } = useMediaCounts();

  // 路由变化或抽屉状态变化时锁 body 滚动（抽屉打开时防止背景跟随滚）
  useEffect(() => {
    if (mobileDockOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [mobileDockOpen]);

  const dockProps = workspaceDockConfig(counts, user?.role);
  const outletCtx = useMemo<LayoutOutletCtx>(
    () => ({ refreshMediaCounts: refresh, onOpenMobileDock: () => setMobileDockOpen(true) }),
    [refresh],
  );

  // 自带顶栏的页面：移动端隐藏外壳汉堡顶栏，避免与页面顶栏形成双层顶栏；
  // 由页面内汉堡承担打开抽屉的职责。
  const hideShellBar =
    pathname.startsWith('/workspace') || pathname.startsWith('/characters') || pathname.startsWith('/edit');

  return (
    <div className="flex h-screen w-full overflow-hidden bg-black text-white">
      {/* 桌面端：inline aside；移动端（< md）由 NavigationDock 内部 fixed drawer 渲染 */}
      <NavigationDock
        {...dockProps}
        mobileOpen={mobileDockOpen}
        onMobileClose={() => setMobileDockOpen(false)}
      />
      <div className="flex flex-1 flex-col min-w-0">
        {/* 移动端顶部汉堡：仅 < md 显示；自带 TopBar 的页面由页面内汉堡替代，这里隐藏 */}
        {!hideShellBar && <MobileDockBar title="墨灵AI" onOpen={() => setMobileDockOpen(true)} />}
        <main className="flex-1 min-h-0 overflow-hidden pb-24 md:pb-0">
          <Outlet context={outletCtx} />
        </main>
        <BottomNav />
      </div>
    </div>
  );
}
