import { Routes, Route } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import LandingPage from '@/pages/LandingPage/LandingPage';
import WorkspacePage from '@/pages/WorkspacePage/WorkspacePage';
import ImageEditorPage from '@/pages/ImageEditorPage/ImageEditorPage';
import LibraryPage from '@/pages/LibraryPage/LibraryPage';
import CharactersPage from '@/pages/CharactersPage/CharactersPage';
import ModelHubPage from '@/pages/ModelHubPage/ModelHubPage';
import AccountPage from '@/pages/AccountPage/AccountPage';
import UserPage from '@/pages/UserPage/UserPage';
import NotFoundPage from '@/pages/NotFoundPage/NotFoundPage';
import AuthModal from '@/components/AuthModal';
import { RequireAdmin } from '@/components/RequireAdmin';
import { RequireAuth } from '@/components/RequireAuth';

// 后台（M3 总控台 / M4 智能体 / M2 流水 / 用户 / 技能 / 电商后台）
import { AdminLayout } from '@/components/layouts/AdminLayout';
import ConsolePage from '@/pages/Admin/ConsolePage';
import AgentsPage from '@/pages/Admin/AgentsPage';
import UsersPage from '@/pages/Admin/UsersPage';
import TransactionsPage from '@/pages/Admin/TransactionsPage';
import SkillsPage from '@/pages/Admin/SkillsPage';
import EcommerceAdminPage from '@/pages/Admin/EcommerceAdminPage';
import MonitorPage from '@/pages/Admin/MonitorPage';
import LogsPage from '@/pages/Admin/LogsPage';

// 创作工作室（M5 流水线）
import { StudioLayout } from '@/components/layouts/StudioLayout';
import StudioListPage from '@/pages/Studio/StudioListPage';
import StudioStagePage from '@/pages/Studio/StudioStagePage';

// 电商（M6）
import { ShopLayout } from '@/components/layouts/ShopLayout';
import ShopHomePage from '@/pages/Shop/ShopHomePage';
import ProductDetailPage from '@/pages/Shop/ProductDetailPage';
import CartPage from '@/pages/Shop/CartPage';
import CheckoutPage from '@/pages/Shop/CheckoutPage';
import OrdersPage from '@/pages/Shop/OrdersPage';
import SellerPage from '@/pages/Shop/SellerPage';

// 登录 / 注册
import AuthPage from '@/pages/Auth/AuthPage';

export default function App() {
  return (
    <>
      <Routes>
        {/* 独立承接页 */}
        <Route path="/" element={<LandingPage />} />

        {/* 登录 / 注册（独立全屏，不走前台壳） */}
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />

        {/* 前台工作台壳（原有素材/角色/模型功能） */}
        <Route element={<Layout />}>
          <Route path="workspace" element={<RequireAuth><WorkspacePage /></RequireAuth>} />
          <Route path="library/:category?" element={<RequireAuth><LibraryPage /></RequireAuth>} />
          <Route path="characters" element={<RequireAuth><CharactersPage /></RequireAuth>} />
          <Route path="model-hub" element={<RequireAdmin><ModelHubPage /></RequireAdmin>} />
          <Route path="edit/:id" element={<RequireAuth><ImageEditorPage /></RequireAuth>} />
          <Route path="account" element={<RequireAuth><AccountPage /></RequireAuth>} />
          {/* 创作者公开主页（无需登录，可分享） */}
          <Route path="user/:id" element={<UserPage />} />
        </Route>

        {/* 管理后台壳（整区需管理员） */}
        <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
          <Route index element={<ConsolePage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="models" element={<ModelHubPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="ecommerce" element={<EcommerceAdminPage />} />
          <Route path="monitor" element={<MonitorPage />} />
          <Route path="logs" element={<LogsPage />} />
        </Route>

        {/* 创作工作室壳（需登录） */}
        <Route path="/studio" element={<RequireAuth><StudioLayout /></RequireAuth>}>
          <Route index element={<StudioListPage />} />
          <Route path=":projectId" element={<StudioStagePage />} />
        </Route>

        {/* 电商商城壳（首页/商品详情公开浏览；下单相关需登录） */}
        <Route path="/shop" element={<ShopLayout />}>
          <Route index element={<ShopHomePage />} />
          <Route path="product/:id" element={<ProductDetailPage />} />
          <Route path="cart" element={<RequireAuth><CartPage /></RequireAuth>} />
          <Route path="checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
          <Route path="orders" element={<RequireAuth><OrdersPage /></RequireAuth>} />
          <Route path="seller" element={<RequireAuth><SellerPage /></RequireAuth>} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <AuthModal />
    </>
  );
}
