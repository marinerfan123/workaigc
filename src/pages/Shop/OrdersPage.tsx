// 我的订单（Phase 5 / AI 市集）— 接真实后端 GET /api/orders
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, Package, Store } from 'lucide-react';
import { PageHeader, SectionCard, cn } from '@/components/skeleton';
import { apiGetOrders, apiGetOrder, type ShopOrder } from '@/services/api';
import { useAuth, setAuthModalOpen } from '@/services/authStore';

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: '待支付', cls: 'bg-amber-500/10 text-amber-300' },
  paid: { label: '已支付', cls: 'bg-emerald-500/10 text-emerald-300' },
  shipped: { label: '已发货', cls: 'bg-sky-500/10 text-sky-300' },
  done: { label: '已完成', cls: 'bg-zinc-700 text-zinc-200' },
};

export default function OrdersPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orders, setOrders] = useState<ShopOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [items, setItems] = useState<Record<string, any[]>>({});

  useEffect(() => {
    if (!user) { setLoading(false); return; }
    setLoading(true);
    apiGetOrders().then((r) => { setOrders(r); setLoading(false); });
  }, [user]);

  async function toggle(o: ShopOrder) {
    if (expanded === o.id) { setExpanded(null); return; }
    setExpanded(o.id);
    if (!items[o.id]) {
      const d = await apiGetOrder(o.id);
      if (d) setItems((m) => ({ ...m, [o.id]: d.items }));
    }
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <PageHeader title="我的订单" subtitle="Phase 5 · orders / order_items / shipments" />
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Package className="size-10 text-zinc-600" />
            <p className="text-sm text-zinc-400">登录后查看你的订单</p>
            <button onClick={() => setAuthModalOpen(true)} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400">去登录</button>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="我的订单" subtitle="Phase 5 · orders / order_items / shipments" />

      {loading ? (
        <p className="text-sm text-zinc-500">加载中…</p>
      ) : orders.length === 0 ? (
        <SectionCard>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <Package className="size-10 text-zinc-600" />
            <p className="text-sm text-zinc-400">还没有订单</p>
            <button onClick={() => navigate('/shop')} className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-medium text-black hover:bg-emerald-400">去市集逛逛</button>
          </div>
        </SectionCard>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => {
            const st = STATUS[o.payStatus] || { label: o.payStatus, cls: 'bg-zinc-700 text-zinc-200' };
            const open = expanded === o.id;
            return (
              <div key={o.id} className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900/50">
                <button onClick={() => toggle(o)} className="flex w-full items-center justify-between gap-3 p-4 text-left">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-zinc-500">订单号 {o.orderNo}</span>
                      <span className={cn('rounded-full px-2 py-0.5 text-[11px]', st.cls)}>{st.label}</span>
                    </div>
                    <div className="mt-1 text-sm text-white">{o.itemCount ?? '?'} 件商品 · {o.totalCredits} 积分</div>
                  </div>
                  <ChevronDown className={cn('size-4 shrink-0 text-zinc-500 transition-transform', open && 'rotate-180')} />
                </button>
                {open && (
                  <div className="space-y-2 border-t border-zinc-800 p-4">
                    {(items[o.id] || []).map((it: any, i: number) => (
                      <div key={i} className="flex items-center gap-3 text-sm">
                        <Store className="size-4 shrink-0 text-zinc-600" />
                        <span className="min-w-0 flex-1 truncate text-white">{it.title}</span>
                        <span className="text-zinc-500">×{it.qty}</span>
                        <span className="w-20 text-right text-emerald-400">{it.unitCreditPrice} 积分</span>
                      </div>
                    ))}
                    {!items[o.id] && <p className="text-xs text-zinc-600">加载中…</p>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
