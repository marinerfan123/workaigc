// 结算（Phase 5 / AI 市集）— 接真实后端 POST /api/orders（纯积分抵现 + 防超卖）
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, CheckCircle2, AlertTriangle, ShoppingBag } from 'lucide-react';
import { PageHeader, SectionCard } from '@/components/skeleton';
import { apiGetCart, apiCreateOrder, type CartItem } from '@/services/api';
import { useAuth, refreshUser, setAuthModalOpen } from '@/services/authStore';

export default function CheckoutPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; orderNo?: string; text: string } | null>(null);

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    apiGetCart().then((r) => { setItems(r); setLoading(false); });
  }, [user]);

  const total = items.reduce((s, i) => s + i.subtotal, 0);
  const credits = user?.credits ?? 0;
  const insufficient = credits < total;

  async function submit() {
    if (!user) { setAuthModalOpen(true); return; }
    if (items.length === 0 || insufficient) return;
    setSubmitting(true);
    setResult(null);
    const r = await apiCreateOrder(crypto.randomUUID());
    setSubmitting(false);
    if (r.ok && r.order) {
      await refreshUser(); // 扣费后刷新积分显示
      setResult({ ok: true, orderNo: r.order.orderNo, text: `下单成功！订单号 ${r.order.orderNo}` });
      setItems([]);
    } else {
      const is402 = (r.error || '').includes('402');
      setResult({ ok: false, text: is402 ? '积分不足，无法完成支付' : (r.error || '下单失败，请重试') });
    }
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader title="结算" subtitle="Phase 5 · 下单含积分抵现 + 防超卖" />
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShoppingBag className="size-10 text-zinc-600" />
            <p className="text-sm text-zinc-400">请先登录再结算</p>
            <button onClick={() => setAuthModalOpen(true)} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400">去登录</button>
          </div>
        </SectionCard>
      </div>
    );
  }

  if (result?.ok) {
    return (
      <div className="space-y-6">
        <PageHeader title="结算成功" subtitle="Phase 5" />
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="size-12 text-emerald-400" />
            <p className="text-sm text-white">{result.text}</p>
            <div className="flex gap-2">
              <button onClick={() => navigate('/shop/orders')} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400">查看我的订单</button>
              <button onClick={() => navigate('/shop')} className="rounded-2xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800">继续逛逛</button>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="结算" subtitle="Phase 5 · 下单含积分抵现 + 防超卖" />

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : items.length === 0 ? (
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShoppingBag className="size-10 text-zinc-600" />
            <p className="text-sm text-zinc-400">购物车为空，无法结算</p>
            <button onClick={() => navigate('/shop')} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400">去商城</button>
          </div>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            <SectionCard title="订单商品">
              <div className="space-y-3">
                {items.map((it) => (
                  <div key={it.id} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1 truncate text-white">{it.title}</span>
                    <span className="text-zinc-500">×{it.qty}</span>
                    <span className="w-20 text-right text-emerald-400">{it.subtotal} 积分</span>
                  </div>
                ))}
              </div>
            </SectionCard>
          </div>

          <SectionCard title="订单摘要">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-zinc-400"><span>商品积分合计</span><span className="text-white">{total} 积分</span></div>
              <div className="flex justify-between text-zinc-400"><span>当前可用积分</span><span className="text-white">{credits}</span></div>
              {insufficient && (
                <div className="flex items-center gap-1.5 text-xs text-amber-400">
                  <AlertTriangle className="size-3.5" /> 积分不足，还差 {total - credits} 积分
                </div>
              )}
              <div className="flex justify-between border-t border-zinc-800 pt-2 font-medium">
                <span className="text-white">应付积分</span>
                <span className="text-emerald-400">{total}</span>
              </div>
            </div>
            <button
              onClick={submit}
              disabled={submitting || insufficient}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-2.5 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {insufficient ? '积分不足' : '提交订单（纯积分支付）'}
            </button>
            {result && !result.ok && <p className="mt-2 text-xs text-red-400">{result.text}</p>}
          </SectionCard>
        </div>
      )}
    </div>
  );
}
