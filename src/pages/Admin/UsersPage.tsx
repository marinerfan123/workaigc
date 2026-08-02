// 用户管理（骨架，Phase 2 管理后台）
// 列表：GET /admin/users（§C.8）；手动充值：POST /admin/users/:id/credits（§C.7，M2 后台调整流水）。
import { Users, Plus } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder } from '@/components/skeleton';

export default function UsersPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="用户管理"
        subtitle="M1 多用户 · 列表检索 + 管理员手动充值（credit_transactions 后台调整）"
        phase={{ status: 'building', label: 'Phase 2' }}
        icon={<Users className="size-5" />}
        actions={
          <button className="flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400 transition-colors">
            <Plus className="size-4" /> 手动充值
          </button>
        }
      />

      <SectionCard
        title="用户列表"
        hint="users: id / email / displayName / role / credits"
      >
        <Placeholder
          label="用户表格：检索 + 角色筛选 + 余额列 + 充值入口"
          note="GET /api/admin/users（分页 / 关键字）；POST /api/admin/users/:id/credits"
          height="h-64"
        />
      </SectionCard>
    </div>
  );
}
