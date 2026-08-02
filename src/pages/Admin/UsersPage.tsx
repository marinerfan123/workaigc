// 用户管理（真实数据）
// 列表：GET /api/admin/users（§C.8）；手动充值：POST /api/admin/users/:id/credits（§C.7）
import { Users, Plus, Search } from 'lucide-react';
import { PageHeader, SectionCard, cn } from '@/components/skeleton';
import { useCallback, useEffect, useState } from 'react';
import { apiAdminUsers, apiAdminRecharge, type AdminUser } from '@/services/api';

const ROLE_OPTS = ['', 'admin', 'user', 'creator', 'seller', 'cs'];

export default function UsersPage() {
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await apiAdminUsers({ q: q || undefined, role: role || undefined, limit: 100 });
    setItems(r.items);
    setTotal(r.total);
    setLoading(false);
  }, [q, role]);

  useEffect(() => { load(); }, [load]);

  const onRecharge = async (u: AdminUser) => {
    const raw = window.prompt(`为 ${u.email} 充值 / 调整积分\n输入正数=充值，负数=扣减（余额不为负）`, '100');
    if (raw === null) return;
    const amount = Math.floor(Number(raw));
    if (!Number.isFinite(amount) || amount === 0) { window.alert('请输入非零整数'); return; }
    setBusy(u.id);
    const r = await apiAdminRecharge(u.id, amount, `后台${amount > 0 ? '充值' : '扣减'}`);
    setBusy(null);
    if (r.ok) { window.alert(`操作成功，当前余额 ${r.credits}`); load(); }
    else window.alert('失败：' + (r.error || '未知错误'));
  };

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="用户管理"
        subtitle="M1 多用户 · 列表检索 + 管理员手动充值（credit_transactions 后台调整）"
        phase={{ status: 'ready', label: 'Phase 2 · 真实数据' }}
        icon={<Users className="size-5" />}
        actions={
          <span className="rounded-2xl bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-300">
            共 {total} 人
          </span>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-1 items-center gap-2 rounded-2xl bg-white/5 px-3 py-2">
          <Search className="size-4 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索邮箱 / 昵称"
            className="w-full bg-transparent text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
          />
        </div>
        <select
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="rounded-2xl bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none"
        >
          {ROLE_OPTS.map((r) => (
            <option key={r} value={r} className="bg-zinc-900">{r === '' ? '全部角色' : r}</option>
          ))}
        </select>
        <button onClick={load} className="rounded-2xl bg-white/10 px-3 py-2 text-sm text-zinc-200 hover:bg-white/15">刷新</button>
      </div>

      <SectionCard title="用户列表" hint="users: id / email / displayName / role / credits">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="py-2 pr-4 font-medium">用户</th>
                <th className="py-2 pr-4 font-medium">角色</th>
                <th className="py-2 pr-4 font-medium">积分</th>
                <th className="py-2 pr-4 font-medium">注册时间</th>
                <th className="py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {loading && (
                <tr><td colSpan={5} className="py-6 text-center text-xs text-zinc-500">加载中…</td></tr>
              )}
              {!loading && items.length === 0 && (
                <tr><td colSpan={5} className="py-6 text-center text-xs text-zinc-500">无匹配用户</td></tr>
              )}
              {!loading && items.map((u) => (
                <tr key={u.id} className="text-zinc-200">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-zinc-100">{u.displayName || '—'}</div>
                    <div className="text-xs text-zinc-500">{u.email}</div>
                  </td>
                  <td className="py-2.5 pr-4">
                    <span className={cn('rounded-full px-2 py-0.5 text-xs', u.role === 'admin' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-zinc-300')}>
                      {u.role}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 font-medium text-emerald-300">{u.credits}</td>
                  <td className="py-2.5 pr-4 text-xs text-zinc-500">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="py-2.5">
                    <button
                      disabled={busy === u.id}
                      onClick={() => onRecharge(u)}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-500 px-2.5 py-1.5 text-xs font-medium text-black hover:bg-emerald-400 disabled:opacity-50"
                    >
                      <Plus className="size-3.5" /> {busy === u.id ? '处理中' : '充值'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
