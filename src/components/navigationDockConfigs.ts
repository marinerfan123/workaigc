// src/components/navigationDockConfigs.ts — 各模块导航台预设配置

import type { LucideIcon } from 'lucide-react';
import {
  LayoutGrid,
  Image as ImageIcon,
  Video,
  User,
  FolderOpen,
  Sparkles,
  MoreHorizontal,
  Upload,
  Clapperboard,
  ShoppingBag,
  ShieldAlert,
  Wrench,
  Settings2,
  LayoutDashboard,
  Bot,
  Users,
  Receipt,
  Boxes,
  Store,
  Activity,
  ScrollText,
  XCircle,
  Database,
  Library,
  Palette,
  Wallet,
  CreditCard,
  Cpu,
  Home,
  ShoppingCart,
  Package,
} from 'lucide-react';
import type { MediaCounts } from '@/services/api';
import type { NavigationDockProps, NavSection } from '@/components/NavigationDock';

// ───────────────────────────────────────────────
// 全站跨模块导航（每个导航台底部都带，方便任意页面跳转）
// ───────────────────────────────────────────────
function globalNavSection(
  userRole?: string,
  opts?: { collapsible?: boolean; excludeWorkspace?: boolean },
): NavSection {
  const items = [
    ...(opts?.excludeWorkspace
      ? []
      : [{ key: 'global-workspace', label: '工作台', icon: LayoutGrid, path: '/workspace', end: true }]),
    { key: 'global-studio', label: '创作工作室', icon: Clapperboard, path: '/studio', end: true },
    { key: 'global-shop', label: 'AI 市集', icon: ShoppingBag, path: '/shop', end: true },
    ...(userRole === 'admin'
      ? [{ key: 'global-admin', label: '管理后台', icon: ShieldAlert, path: '/admin', end: true }]
      : []),
  ];
  return {
    title: '全站',
    items,
    ...(opts?.collapsible ? { collapsible: true } : {}),
  };
}

// ───────────────────────────────────────────────
// 1. 工作台 / 前台素材壳（对应用户截图）
// ───────────────────────────────────────────────
export function workspaceDockConfig(
  counts: MediaCounts | null,
  userRole?: string,
): NavigationDockProps {
  return {
    storageKey: 'workspace',
    // 不再按项目分栏：头部改为通用模块标题，去掉「重命名/删除项目」等项目级菜单
    header: {
      title: '工作台',
      backTo: '/',
      backLabel: '返回主页',
    },
    showSearch: true,
    searchPlaceholder: '搜索',
    sections: [
      {
        // 置顶常驻：工作台首页入口（始终可见，不折叠）
        items: [
          {
            key: 'workspace',
            label: '工作台',
            icon: LayoutGrid,
            path: '/workspace',
            end: true,
            count: counts?.total,
          },
        ],
      },
      {
        // 主要大类：手风琴，默认展开；点标题展开小类，其余大类自动折叠
        title: '素材库',
        collapsible: true,
        defaultExpanded: true,
        items: [
          { key: 'lib-all', label: '全部', icon: LayoutGrid, path: '/library', end: true, count: counts?.total },
          { key: 'lib-image', label: '图片', icon: ImageIcon, path: '/library/image', end: true, count: counts?.image },
          { key: 'lib-video', label: '视频', icon: Video, path: '/library/video', end: true, count: counts?.video },
          { key: 'lib-character', label: '角色', icon: User, path: '/library/character', end: true, count: counts?.character },
          { key: 'lib-scene', label: '场景', icon: FolderOpen, path: '/library/scene', end: true, count: counts?.scene },
          { key: 'lib-prop', label: '道具', icon: Sparkles, path: '/library/prop', end: true, count: counts?.prop },
          { key: 'lib-other', label: '其他', icon: MoreHorizontal, path: '/library/other', end: true, count: counts?.other },
          { key: 'lib-upload', label: '上传的内容', icon: Upload, path: '/library/upload', end: true, count: counts?.upload },
        ],
      },
      // 管理板块：创作者的资源管理，手风琴折叠
      {
        title: '管理',
        collapsible: true,
        items: [
          { key: 'characters', label: '角色管理', icon: User, path: '/characters', end: true },
          ...(userRole === 'admin'
            ? [{ key: 'model-hub', label: '模型 Hub', icon: Cpu, path: '/model-hub', end: true }]
            : []),
          { key: 'account', label: '账户设置', icon: Settings2, path: '/account', end: true },
        ],
      },
      // 全站跨模块跳转：手风琴，不重复放置置顶「工作台」项
      globalNavSection(userRole, { collapsible: true, excludeWorkspace: true }),
    ],
  };
}

// ───────────────────────────────────────────────
// 2. 管理后台壳
// ───────────────────────────────────────────────
export function adminDockConfig(userRole?: string): NavigationDockProps {
  return {
    storageKey: 'admin',
    header: {
      title: '管理后台',
      backTo: '/workspace',
      backLabel: '返回前台',
    },
    showSearch: true,
    searchPlaceholder: '搜索管理项',
    sections: [
      {
        items: [
          { key: 'admin-console', label: '运营总控台', icon: LayoutDashboard, path: '/admin', end: true },
          { key: 'admin-monitor', label: 'API 活动流', icon: Activity, path: '/admin/monitor' },
          { key: 'admin-logs', label: '实时日志', icon: ScrollText, path: '/admin/logs' },
          { key: 'admin-errors', label: '核心错误', icon: XCircle, path: '/admin/errors' },
          { key: 'admin-monitoring', label: '全局监控', icon: Database, path: '/admin/monitoring' },
        ],
      },
      {
        title: '业务',
        items: [
          { key: 'admin-agents', label: '智能体层', icon: Bot, path: '/admin/agents' },
          { key: 'admin-users', label: '用户管理', icon: Users, path: '/admin/users' },
          { key: 'admin-samples', label: '示例库', icon: Library, path: '/admin/samples' },
          { key: 'admin-reference-styles', label: '参考样式审核', icon: Palette, path: '/admin/reference-styles' },
          { key: 'admin-models', label: '模型价格', icon: Cpu, path: '/admin/models' },
        ],
      },
      {
        title: '财务与电商',
        items: [
          { key: 'admin-finance', label: '账务中心', icon: Wallet, path: '/admin/finance' },
          { key: 'admin-payment-settings', label: '支付设置', icon: CreditCard, path: '/admin/payment-settings' },
          { key: 'admin-transactions', label: '积分流水', icon: Receipt, path: '/admin/transactions' },
          { key: 'admin-skills', label: '技能注册', icon: Boxes, path: '/admin/skills' },
          { key: 'admin-ecommerce', label: '电商后台', icon: Store, path: '/admin/ecommerce' },
        ],
      },
      globalNavSection(userRole),
    ],
    bottomActions: [
      {
        key: 'tools',
        label: '工具',
        icon: Wrench,
        children: [
          { key: 'model-hub', label: '模型 Hub', icon: Settings2, path: '/model-hub' },
        ],
      },
    ],
  };
}

// ───────────────────────────────────────────────
// 3. 创作工作室壳
// ───────────────────────────────────────────────
export function studioDockConfig(userRole?: string): NavigationDockProps {
  return {
    storageKey: 'studio',
    header: {
      title: '创作工作室',
      backTo: '/workspace',
      backLabel: '返回前台',
    },
    showSearch: true,
    searchPlaceholder: '搜索项目',
    sections: [
      {
        items: [
          { key: 'studio-projects', label: '项目列表', icon: Clapperboard, path: '/studio', end: true },
        ],
      },
      {
        title: '当前项目',
        items: [
          { key: 'studio-stage', label: '流水线阶段', icon: LayoutGrid, path: '/studio', end: true },
          { key: 'studio-assets', label: '项目资产', icon: FolderOpen, path: '/studio' },
          { key: 'studio-roles', label: '角色设定', icon: User, path: '/studio' },
        ],
      },
      globalNavSection(userRole),
    ],
    // 底部只显示收起/展开按钮，保持工作室界面清爽
  };
}

// ───────────────────────────────────────────────
// 4. AI 市集 / 电商壳
// ───────────────────────────────────────────────
export function shopDockConfig(userRole?: string): NavigationDockProps {
  return {
    storageKey: 'shop',
    header: {
      title: 'AI 市集',
      backTo: '/workspace',
      backLabel: '返回前台',
    },
    showSearch: true,
    searchPlaceholder: '搜索商品',
    sections: [
      {
        items: [
          { key: 'shop-home', label: '全部商品', icon: ShoppingBag, path: '/shop', end: true },
        ],
      },
      {
        title: '分类',
        items: [
          { key: 'shop-art', label: '艺术周边', icon: Sparkles, path: '/shop?cat=art' },
          { key: 'shop-figure', label: '手办模型', icon: User, path: '/shop?cat=figure' },
          { key: 'shop-digital', label: '数字藏品', icon: ImageIcon, path: '/shop?cat=digital' },
          { key: 'shop-book', label: '出版物', icon: Package, path: '/shop?cat=book' },
        ],
      },
      {
        title: '我的',
        items: [
          { key: 'shop-cart', label: '购物车', icon: ShoppingCart, path: '/shop/cart' },
          { key: 'shop-orders', label: '我的订单', icon: Receipt, path: '/shop/orders' },
          { key: 'shop-seller', label: '卖家中心', icon: Store, path: '/shop/seller' },
        ],
      },
      globalNavSection(userRole),
    ],
    // 底部只显示收起/展开按钮
  };
}
