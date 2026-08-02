// 购物车（骨架，M6 / cart_items）
// cart_items: user_id / product_id / sku_id / qty
import { useNavigate } from 'react-router-dom';
import { ShoppingCart } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder } from '@/components/skeleton';

const SAMPLE = [
  { id: '1', title: '东方古典美人·艺术微喷', price: 19900, qty: 1 },
  { id: '2', title: 'AI 摄影画册', price: 5900, qty: 2 },
];

export default function CartPage() {
  const navigate = useNavigate();
  const total = SAMPLE.reduce((s, i) => s + i.price * i.qty, 0);

  return (
    <div className="space-y-6">
      <PageHeader title="购物车" subtitle="M6 · cart_items（按 user_id 索引）" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {SAMPLE.map((i) => (
            <div key={i.id} className="flex items-center gap-4 rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
              <div className="size-16 rounded-xl bg-zinc-800/60" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-white">{i.title}</div>
                <div className="mt-1 text-sm text-emerald-400">¥{(i.price / 100).toFixed(2)}</div>
              </div>
              <div className="flex items-center rounded-xl border border-zinc-800">
                <button className="px-2.5 py-1 text-zinc-400">−</button>
                <span className="w-7 text-center text-sm text-white">{i.qty}</span>
                <button className="px-2.5 py-1 text-zinc-400">+</button>
              </div>
            </div>
          ))}
        </div>

        <SectionCard title="结算摘要">
          <div className="flex items-center justify-between text-sm">
            <span className="text-zinc-400">小计</span>
            <span className="text-white">¥{(total / 100).toFixed(2)}</span>
          </div>
          <button
            onClick={() => navigate('/checkout')}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-500 py-2.5 text-sm font-medium text-black hover:bg-emerald-400 transition-colors"
          >
            <ShoppingCart className="size-4" /> 去结算
          </button>
        </SectionCard>
      </div>

      <SectionCard title="cart_items" className="opacity-80">
        <Placeholder label="真实购物车经 GET /api/cart（user_id）" height="h-20" />
      </SectionCard>
    </div>
  );
}
