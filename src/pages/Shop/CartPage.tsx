// 购物车（Phase 5 / AI 市集）— 接真实后端 GET/POST/PUT/DELETE /api/cart
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingCart, Trash2, Minus, Plus, Loader2 } from 'lucide-react';
import { PageHeader, SectionCard } from '@/components/skeleton';
import { apiGetCart, apiUpdateCartItem, apiRemoveCartItem, type CartItem } from '@/services/api';
import { useAuth, setAuthModalOpen } from '@/services/authStore';

export default function CartPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<number | string | null>(null);

  async function load() {
    setLoading(true);
    setItems(await apiGetCart());
    setLoading(false);
  }
  useEffect(() => {
    if (user) load();
    else { setLoading(false); setItems([]); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  async function changeQty(it: CartItem, delta: number) {
    const next = Math.max(1, it.qty + delta);
    if (next === it.qty) return;
    setUpdating(it.id);
    await apiUpdateCartItem(it.id, next);
    setUpdating(null);
    load();
  }
  async function remove(it: CartItem) {
    setUpdating(it.id);
    await apiRemoveCartItem(it.id);
    setUpdating(null);
    load();
  }

  const total = items.reduce((s, i) => s + i.subtotal, 0);

  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader title="购物车" subtitle="Phase 5 · cart_items（按 user_id 索引）" />
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShoppingCart className="size-10 text-zinc-600" />
            <p className="text-sm text-zinc-400">登录后查看你的购物车</p>
            <button onClick={() => setAuthModalOpen(true)} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400">
              去登录
            </button>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="购物车" subtitle="Phase 5 · cart_items（按 user_id 索引）" />

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : items.length === 0 ? (
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <ShoppingCart className="size-10 text-zinc-600" />
            <p className="text-sm text-zinc-400">购物车是空的</p>
            <button onClick={() => navigate('/shop')} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400">
              去逛逛
            </button>
          </div>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-2">
            {items.map((it) => (
              <div key={it.id} className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className={`flex size-16 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-zinc-800/60 to-zinc-900 text-xs text-zinc-500`}>
                  {it.coverUrl ? <img src={it.coverUrl} alt={it.title} className="size-full rounded-xl object-cover" /> : '图'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white">{it.title}</div>
                  <div className="mt-1 text-sm text-emerald-400">{it.unitCreditPrice} 积分</div>
                </div>
                <div className="flex items-center rounded-xl border border-zinc-800">
                  <button className="px-2.5 py-1 text-zinc-400 hover:text-white disabled:opacity-40" disabled={updating === it.id || it.qty <= 1} onClick={() => changeQty(it, -1)}>
                    {updating === it.id ? <Loader2 className="size-4 animate-spin" /> : <Minus className="size-4" />}
                  </button>
                  <span className="w-7 text-center text-sm text-white">{it.qty}</span>
                  <button className="px-2.5 py-1 text-zinc-400 hover:text-white disabled:opacity-40" disabled={updating === it.id} onClick={() => changeQty(it, 1)}>
                    <Plus className="size-4" />
                  </button>
                </div>
                <button onClick={() => remove(it)} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-red-400" title="移除">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
          </div>

          <SectionCard title="结算摘要">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-400">小计（{items.length} 件）</span>
              <span className="text-white">{total} 积分</span>
            </div>
            <button
              onClick={() => navigate('/shop/checkout')}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-2.5 text-sm font-medium text-black hover:bg-emerald-400 transition-colors"
            >
              <ShoppingCart className="size-4" /> 去结算
            </button>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
