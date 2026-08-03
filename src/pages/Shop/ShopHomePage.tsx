// 商城首页（骨架，M6 / Phase 5）
// products: title / subtitle / cover_url / price_cents / credit_price / stock / ai_fields / status
import { useNavigate } from 'react-router-dom';
import { ShoppingBag } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder } from '@/components/skeleton';

// 骨架占位商品；真实列表经 GET /api/shop/products。
const SAMPLE = [
  { id: '1', title: '东方古典美人·艺术微喷', price: 19900 },
  { id: '2', title: '赛博长安·数字藏品', price: 9900 },
  { id: '3', title: '非遗文创·手办模型', price: 39900 },
  { id: '4', title: 'AI 摄影画册', price: 5900 },
];

export default function ShopHomePage() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="rounded-3xl border border-zinc-800 bg-gradient-to-br from-emerald-500/10 via-zinc-900 to-black p-8">
        <div className="flex items-center gap-2 text-emerald-400">
          <ShoppingBag className="size-5" />
          <span className="text-sm font-medium">AI 市集</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-white">把 AI 创作变成可收藏的周边</h1>
        <p className="mt-2 max-w-xl text-sm text-zinc-400">
          艺术微喷、数字藏品、手办模型与出版物——每个商品页都内嵌智能体协助面板。
        </p>
      </div>

      <PageHeader title="精选商品" subtitle="M6 · 高并发读（Redis 缓存 + CDN + 只读副本）" />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {SAMPLE.map((p) => (
          <button
            key={p.id}
            onClick={() => navigate(`/product/${p.id}`)}
            className="group overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/50 text-left transition-all duration-300 hover:border-emerald-500/40 hover:bg-zinc-900"
          >
            <div className="aspect-square w-full bg-zinc-800/60" />
            <div className="p-4">
              <h3 className="truncate text-sm font-medium text-white group-hover:text-emerald-300 transition-colors">
                {p.title}
              </h3>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-base font-semibold text-emerald-400">¥{(p.price / 100).toFixed(2)}</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      <SectionCard title="product_skus" hint="specs / price_cents / stock" className="opacity-80">
        <Placeholder
          label="真实商品网格经 GET /api/shop/products（按 shop_id + status 索引）"
          note="搜索走 search_agent；推荐位走 recommender"
          height="h-20"
        />
      </SectionCard>
    </div>
  );
}
