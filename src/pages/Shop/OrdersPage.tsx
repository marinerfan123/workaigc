// 我的订单（骨架，M6 / orders + order_items + shipments）
// orders: order_no / total_cents / credit_used / pay_channel / pay_status(pending|paid) / paid_at
import { PageHeader, SectionCard, Placeholder } from '@/components/skeleton';

const STATUS: Record<string, string> = { pending: '待支付', paid: '已支付', shipped: '已发货' };

export default function OrdersPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="我的订单" subtitle="M6 · orders / order_items / shipments" />

      <div className="space-y-3">
        {['1', '2'].map((id) => (
          <div key={id} className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-zinc-500">订单号 #ORD-{id}</span>
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-300">
                {STATUS.paid}
              </span>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="size-12 rounded-xl bg-zinc-800/60" />
              <div className="text-sm text-white">商品名称</div>
              <div className="ml-auto text-sm text-emerald-400">¥199.00</div>
            </div>
          </div>
        ))}
      </div>

      <SectionCard title="orders / order_items" className="opacity-80">
        <Placeholder label="真实订单经 GET /api/orders（user_id + created_at 索引）" height="h-20" />
      </SectionCard>
    </div>
  );
}
