// 后台账务中心（Phase 4：底层账务总控）
// 完全管住系统账务：总览 / 充值订单 / 对账 / 单用户账本 / 充值套餐 CRUD
import { useState, useEffect, type ReactNode, type ChangeEvent } from 'react';
import {
  Wallet, Coins, TrendingUp, Gift, Clock, AlertTriangle, Plus, Trash2, Pencil,
  Check, X, Loader2, ArrowLeft,
} from 'lucide-react';
import {
  apiAdminFinanceOverview, apiAdminFinanceRecharges, apiAdminFinanceReconcile,
  apiAdminFinanceLedger, apiAdminFinancePackages, apiAdminFinanceCreatePackage,
  apiAdminFinanceUpdatePackage, apiAdminFinanceDeletePackage,
} from '@/services/api';

type Pkg = {
  id: string; name: string; credits: number; price: number; bonus: number;
  sortOrder: number; enabled: boolean; remark: string;
};

export default function FinancePage() {
  const [overview, setOverview] = useState<any>(null);
  const [recharges, setRecharges] = useState<any[]>([]);
  const [rechTotal, setRechTotal] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [reconcile, setReconcile] = useState<any>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [packages, setPackages] = useState<Pkg[]>([]);
  const [ledger, setLedger] = useState<any>(null);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Pkg | null>(null);
  const [form, setForm] = useState({ name: '', credits: 0, price: 0, bonus: 0, sortOrder: 0, enabled: true, remark: '' });
  const [saving, setSaving] = useState(false);

  async function loadAll() {
    const ov = await apiAdminFinanceOverview(); setOverview(ov);
    const pk = await apiAdminFinancePackages(); setPackages(pk.items);
    await reloadRecharges();
  }
  async function reloadRecharges() {
    const r = await apiAdminFinanceRecharges({ status: statusFilter || undefined });
    setRecharges(r.items); setRechTotal(r.total);
  }
  useEffect(() => { loadAll().catch(() => {}); }, []);
  useEffect(() => { reloadRecharges().catch(() => {}); }, [statusFilter]);

  async function runReconcile() {
    setReconLoading(true);
    const r = await apiAdminFinanceReconcile();
    setReconcile(r);
    setReconLoading(false);
  }

  function openNew() {
    setEditing(null);
    setForm({ name: '', credits: 0, price: 0, bonus: 0, sortOrder: packages.length, enabled: true, remark: '' });
    setShowForm(true);
  }
  function openEdit(p: Pkg) {
    setEditing(p);
    setForm({ name: p.name, credits: p.credits, price: p.price, bonus: p.bonus, sortOrder: p.sortOrder, enabled: p.enabled, remark: p.remark });
    setShowForm(true);
  }
  async function savePkg() {
    setSaving(true);
    if (editing) {
      const r = await apiAdminFinanceUpdatePackage(editing.id, form);
      if (!r.ok) alert(r.error || '保存失败');
    } else {
      const r = await apiAdminFinanceCreatePackage(form);
      if (!r.ok) alert(r.error || '创建失败');
    }
    setSaving(false); setShowForm(false);
    const pk = await apiAdminFinancePackages(); setPackages(pk.items);
  }
  async function delPkg(id: string) {
    if (!confirm('确认删除该套餐？')) return;
    const r = await apiAdminFinanceDeletePackage(id);
    if (!r.ok) alert(r.error || '删除失败');
    const pk = await apiAdminFinancePackages(); setPackages(pk.items);
  }
  async function togglePkg(p: Pkg) {
    await apiAdminFinanceUpdatePackage(p.id, { enabled: !p.enabled });
    const pk = await apiAdminFinancePackages(); setPackages(pk.items);
  }
  async function viewLedger(userId: string) {
    const r = await apiAdminFinanceLedger(userId);
    setLedger(r);
    if (r) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-7">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
            <Wallet className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-white">账务中心</h1>
            <p className="text-xs text-zinc-500">系统账务总览 · 充值订单 · 对账 · 套餐配置</p>
          </div>
        </div>

        {/* KPI 概览 */}
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi icon={Coins} label="系统总积分余额" value={overview?.totalCreditsInSystem ?? '—'} accent />
          <Kpi icon={TrendingUp} label="累计充值(成功)" value={`¥${overview?.totalRechargePaid ?? 0}`} sub={`${overview?.rechargePaidCount ?? 0} 笔`} />
          <Kpi icon={Wallet} label="累计消费" value={overview?.totalConsumed ?? 0} sub="commit 流水" />
          <Kpi icon={Gift} label="累计发放" value={overview?.totalGranted ?? 0} sub="grant 流水" />
          <Kpi icon={Clock} label="待支付订单" value={overview?.rechargePendingCount ?? 0} sub={`¥${overview?.totalRechargePending ?? 0}`} warn={!!overview?.rechargePendingCount} />
          <Kpi icon={AlertTriangle} label="失败订单" value={overview?.rechargeFailedCount ?? 0} sub="需排查" danger={!!overview?.rechargeFailedCount} />
          <Kpi icon={Coins} label="用户数" value={overview?.totalUsers ?? 0} />
          <Kpi icon={TrendingUp} label="手动调整净额" value={overview?.totalAdjusted ?? 0} sub="adjust 流水" />
        </div>

        {/* 双池余额（赠送 / 充值） */}
        <div className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-md">
          <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-200">双池余额（赠送积分 / 充值积分）</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi icon={Gift} label="赠送池总余额" value={overview?.rewardBalance ?? 0} accent sub="reward" />
            <Kpi icon={Wallet} label="充值池总余额" value={overview?.rechargeBalance ?? 0} sub="recharge" />
            <Kpi icon={Gift} label="累计赠送发放" value={overview?.grantedByPool?.reward ?? 0} sub="grant·reward" />
            <Kpi icon={Wallet} label="累计充值到账" value={overview?.grantedByPool?.recharge ?? 0} sub="grant·recharge" />
          </div>
        </div>

        {/* 近 30 天时序 */}
        {overview?.series && (
          <div className="mb-6 rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-md">
            <h2 className="mb-4 text-sm font-semibold tracking-wide text-zinc-200">近 30 天资金流（充值 / 消费 / 发放）</h2>
            <div className="flex h-28 items-end gap-1 overflow-x-auto">
              {overview.series.map((s: any, i: number) => {
                const max = Math.max(1, ...overview.series.map((x: any) => Math.max(x.rechargePaid, x.consumed, x.granted)));
                const v = Math.max(s.rechargePaid, s.consumed, s.granted);
                const h = Math.max(3, Math.round((v / max) * 100));
                return (
                  <div key={i} className="flex shrink-0 flex-col items-center justify-end" title={`${s.day} 充${s.rechargePaid}/消${s.consumed}/发${s.granted}`}>
                    <div className="w-2.5 rounded-t bg-emerald-400/70" style={{ height: `${h}px` }} />
                  </div>
                );
              })}
            </div>
            <div className="mt-2 flex gap-4 text-[11px] text-zinc-500">
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-400/70" />充值到账</span>
              <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-zinc-500" />消费 / 发放合并柱高</span>
            </div>
          </div>
        )}

        {/* 充值订单 + 对账 */}
        <div className="mb-6 grid gap-5 lg:grid-cols-3">
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-md lg:col-span-2">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold tracking-wide text-zinc-200">充值订单（{rechTotal}）</h2>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-2 py-1 text-xs text-zinc-300 outline-none"
              >
                <option value="">全部状态</option>
                <option value="pending">待支付</option>
                <option value="paid">已支付</option>
                <option value="failed">失败</option>
              </select>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase text-zinc-500">
                  <tr>
                    <th className="pb-2 pr-3 font-medium">用户</th>
                    <th className="pb-2 pr-3 font-medium">渠道</th>
                    <th className="pb-2 pr-3 font-medium">金额</th>
                    <th className="pb-2 pr-3 font-medium">状态</th>
                    <th className="pb-2 pr-3 font-medium">时间</th>
                    <th className="pb-2 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {recharges.length === 0 && (
                    <tr><td colSpan={6} className="py-6 text-center text-zinc-500">暂无订单</td></tr>
                  )}
                  {recharges.map((o) => (
                    <tr key={o.id} className="border-t border-zinc-800/60">
                      <td className="py-2 pr-3 text-zinc-300">{o.user || '—'}</td>
                      <td className="py-2 pr-3 text-zinc-400">{o.channel === 'alipay' ? '支付宝' : '微信'}</td>
                      <td className="py-2 pr-3 tabular-nums text-white">¥{o.amount}</td>
                      <td className="py-2 pr-3">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          o.status === 'paid' ? 'bg-emerald-400/10 text-emerald-400'
                          : o.status === 'failed' ? 'bg-red-400/10 text-red-400'
                          : 'bg-amber-400/10 text-amber-400'
                        }`}>{o.status === 'paid' ? '已支付' : o.status === 'failed' ? '失败' : '待支付'}</span>
                        {o.status === 'failed' && o.meta?.reason && (
                          <div className="mt-1 max-w-[160px] truncate text-[10px] text-red-300/70" title={o.meta.reason}>{o.meta.reason}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-xs text-zinc-500">{fmt(o.createdAt)}</td>
                      <td className="py-2">
                        <button onClick={() => viewLedger(o.userId)} className="text-[11px] text-emerald-400 hover:underline">账本</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 对账 */}
          <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-md">
            <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-wide text-zinc-200">
              <AlertTriangle className="size-4 text-amber-400" /> 账实对账
            </h2>
            <button
              onClick={runReconcile}
              disabled={reconLoading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500/15 py-2.5 text-sm font-medium text-amber-300 transition-colors hover:bg-amber-500/25 disabled:opacity-50"
            >
              {reconLoading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
              运行对账
            </button>
            {reconcile && (
              <div className="mt-4 space-y-3">
                <div className={`rounded-xl border p-3 text-xs ${
                  reconcile.ok ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300' : 'border-red-500/30 bg-red-500/10 text-red-300'
                }`}>
                  已核对 {reconcile.checkedUsers} 个用户 · 异常 {reconcile.alertCount} 个 · {reconcile.ok ? '账实相符 ✓' : '发现不一致 ⚠'}
                </div>
                {reconcile.alerts.map((a: any, i: number) => (
                  <div key={i} className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-zinc-200">用户 {a.userId}</span>
                      <span className="text-red-300">{a.status === 'mismatch' ? '账实不符' : '无快照'}</span>
                    </div>
                    <div className="mt-1 text-zinc-500">余额 {a.real}{a.expected != null ? ` · 重建 ${a.expected}` : ''} · {a.note}</div>
                  </div>
                ))}
              </div>
            )}
            {!reconcile && <p className="mt-3 text-xs text-zinc-500">定期对账，确保所有用户余额与流水重建完全一致。</p>}
          </div>
        </div>

        {/* 单用户账本 */}
        {ledger && (
          <div className="mb-6 rounded-3xl border border-emerald-500/20 bg-zinc-900/40 p-6 backdrop-blur-md">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => setLedger(null)} className="text-zinc-400 hover:text-white"><ArrowLeft className="size-4" /></button>
                <h2 className="text-sm font-semibold tracking-wide text-zinc-200">
                  账本 · {ledger.user.displayName || ledger.user.email}
                </h2>
                <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] text-emerald-300">期末 {ledger.endingBalance}</span>
              </div>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {ledger.transactions.map((t: any) => {
                const negative = t.kind === 'reserve' || t.kind === 'commit' || (t.kind === 'adjust' && t.amount < 0);
                return (
                  <div key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-white/5">
                    <span className="w-16 shrink-0 text-[11px] text-zinc-500">{t.kind}</span>
                    <span className={`w-16 shrink-0 text-right font-semibold tabular-nums ${negative ? 'text-red-400' : 'text-emerald-400'}`}>
                      {negative ? '-' : '+'}{Math.abs(t.amount)}
                    </span>
                    <span className="w-20 shrink-0 text-right text-xs text-zinc-500">余 {t.balanceAfter ?? '—'}</span>
                    <span className="flex-1 truncate text-[11px] text-zinc-600">{t.ref || ''}</span>
                    <span className="shrink-0 text-[11px] text-zinc-500">{fmt(t.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 充值套餐管理 */}
        <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-md">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-200">充值套餐配置</h2>
            <button onClick={openNew} className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-black hover:bg-emerald-400">
              <Plus className="size-3.5" /> 新增套餐
            </button>
          </div>

          {showForm && (
            <div className="mb-4 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Field label="名称"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inp} placeholder="如 月卡" /></Field>
                <Field label="售价(元)"><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: num(e) })} className={inp} /></Field>
                <Field label="基础积分"><input type="number" value={form.credits} onChange={(e) => setForm({ ...form, credits: num(e) })} className={inp} /></Field>
                <Field label="赠送积分"><input type="number" value={form.bonus} onChange={(e) => setForm({ ...form, bonus: num(e) })} className={inp} /></Field>
                <Field label="排序"><input type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: num(e) })} className={inp} /></Field>
                <Field label="启用">
                  <button onClick={() => setForm({ ...form, enabled: !form.enabled })} className={`flex h-9 w-full items-center gap-2 rounded-xl border px-3 text-sm ${form.enabled ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300' : 'border-zinc-800 text-zinc-500'}`}>
                    {form.enabled ? <Check className="size-4" /> : <X className="size-4" />}{form.enabled ? '已启用' : '已停用'}
                  </button>
                </Field>
                <div className="col-span-2 sm:col-span-3">
                  <Field label="备注"><input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className={inp} placeholder="可选" /></Field>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button onClick={savePkg} disabled={saving} className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400 disabled:opacity-50">
                  {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} 保存
                </button>
                <button onClick={() => setShowForm(false)} className="rounded-xl border border-zinc-800 px-4 py-2 text-sm text-zinc-400 hover:bg-white/5">取消</button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase text-zinc-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">名称</th>
                  <th className="pb-2 pr-3 font-medium">售价</th>
                  <th className="pb-2 pr-3 font-medium">积分</th>
                  <th className="pb-2 pr-3 font-medium">赠送</th>
                  <th className="pb-2 pr-3 font-medium">排序</th>
                  <th className="pb-2 pr-3 font-medium">状态</th>
                  <th className="pb-2 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {packages.length === 0 && (
                  <tr><td colSpan={7} className="py-6 text-center text-zinc-500">暂无套餐，新增后前端充值弹窗将自动读取</td></tr>
                )}
                {packages.map((p) => (
                  <tr key={p.id} className="border-t border-zinc-800/60">
                    <td className="py-2 pr-3 text-zinc-200">{p.name || '—'}</td>
                    <td className="py-2 pr-3 tabular-nums text-white">¥{p.price}</td>
                    <td className="py-2 pr-3 tabular-nums text-zinc-300">{p.credits}</td>
                    <td className="py-2 pr-3 tabular-nums text-amber-300">+{p.bonus}</td>
                    <td className="py-2 pr-3 text-zinc-500">{p.sortOrder}</td>
                    <td className="py-2 pr-3">
                      <button onClick={() => togglePkg(p)} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${p.enabled ? 'bg-emerald-400/10 text-emerald-400' : 'bg-zinc-700/40 text-zinc-400'}`}>
                        {p.enabled ? '启用' : '停用'}
                      </button>
                    </td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button onClick={() => openEdit(p)} className="text-zinc-400 hover:text-emerald-400"><Pencil className="size-4" /></button>
                        <button onClick={() => delPkg(p.id)} className="text-zinc-400 hover:text-red-400"><Trash2 className="size-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

const inp = 'w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50';

function Kpi({ icon: Icon, label, value, sub, accent, warn, danger }: { icon: any; label: string; value: any; sub?: string; accent?: boolean; warn?: boolean; danger?: boolean }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4">
      <div className="mb-2 flex items-center gap-2 text-zinc-400">
        <Icon className={`size-4 ${accent ? 'text-emerald-400' : warn ? 'text-amber-400' : danger ? 'text-red-400' : 'text-zinc-500'}`} />
        <span className="text-[11px]">{label}</span>
      </div>
      <div className={`text-xl font-bold tabular-nums ${accent ? 'text-emerald-400' : danger ? 'text-red-400' : 'text-white'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>}
    </div>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-zinc-500">{label}</span>
      {children}
    </label>
  );
}
function fmt(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function num(e: ChangeEvent<HTMLInputElement>) {
  return Math.floor(Number(e.target.value) || 0);
}
