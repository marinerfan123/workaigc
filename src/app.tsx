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

// 后台（M3 总控台 / M4 智能体 / M2 流水 / 用户 / 技能 / 电商后台）
import { AdminLayout } from '@/components/layouts/AdminLayout';
import ConsolePage from '@/pages/Admin/ConsolePage';
import AgentsPage from '@/pages/Admin/AgentsPage';
import UsersPage from '@/pages/Admin/UsersPage';
import TransactionsPage from '@/pages/Admin/TransactionsPage';
import SkillsPage from '@/pages/Admin/SkillsPage';
import EcommerceAdminPage from '@/pages/Admin/EcommerceAdminPage';
import MonitorPage from '@/pages/Admin/MonitorPage';

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
          <Route path="workspace" element={<WorkspacePage />} />
          <Route path="library/:category?" element={<LibraryPage />} />
          <Route path="characters" element={<CharactersPage />} />
          <Route path="model-hub" element={<RequireAdmin><ModelHubPage /></RequireAdmin>} />
          <Route path="edit/:id" element={<ImageEditorPage />} />
          <Route path="account" element={<AccountPage />} />
          <Route path="user/:id" element={<UserPage />} />
        </Route>

        {/* 管理后台壳 */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<ConsolePage />} />
          <Route path="agents" element={<AgentsPage />} />
          <Route path="users" element={<UsersPage />} />
          <Route path="models" element={<ModelHubPage />} />
          <Route path="transactions" element={<TransactionsPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="ecommerce" element={<EcommerceAdminPage />} />
          <Route path="monitor" element={<MonitorPage />} />
        </Route>

        {/* 创作工作室壳 */}
        <Route path="/studio" element={<StudioLayout />}>
          <Route index element={<StudioListPage />} />
          <Route path=":projectId" element={<StudioStagePage />} />
        </Route>

        {/* 电商商城壳 */}
        <Route path="/shop" element={<ShopLayout />}>
          <Route index element={<ShopHomePage />} />
          <Route path="product/:id" element={<ProductDetailPage />} />
          <Route path="cart" element={<CartPage />} />
          <Route path="checkout" element={<CheckoutPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="seller" element={<SellerPage />} />
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <AuthModal />
    </>
  );
}
