// 商城首页（Phase 5 / AI 市集）— 接真实后端 GET /api/shop/products
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShoppingBag, Search, Package, Sparkles, Image as ImageIcon, Store, Wrench, GraduationCap } from 'lucide-react';
import { PageHeader, SectionCard } from '@/components/skeleton';
import { apiGetShopProducts, type ShopProduct } from '@/services/api';

const CATEGORIES: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: '全部', icon: <ShoppingBag className="size-4" /> },
  { key: 'prompt', label: '提示词', icon: <Sparkles className="size-4" /> },
  { key: 'model', label: '模型', icon: <Package className="size-4" /> },
  { key: 'asset', label: '素材', icon: <ImageIcon className="size-4" /> },
  { key: 'service', label: '服务', icon: <Wrench className="size-4" /> },
  { key: 'course', label: '课程', icon: <GraduationCap className="size-4" /> },
];

const CAT_GRADIENT: Record<string, string> = {
  prompt: 'from-fuchsia-500/30 to-violet-600/20',
  model: 'from-emerald-500/30 to-teal-600/20',
  asset: 'from-sky-500/30 to-blue-600/20',
  service: 'from-amber-500/30 to-orange-600/20',
  course: 'from-rose-500/30 to-pink-600/20',
};

export default function ShopHomePage() {
  const navigate = useNavigate();
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [items, setItems] = useState<ShopProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    apiGetShopProducts({ cat: cat === 'all' ? undefined : cat, q: q.trim() || undefined, limit: 60 })
      .then((r) => {
        if (!alive) return;
        setItems(r.items || []);
        setTotal(r.total || 0);
      })
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [cat, q]);

  const heroCat = useMemo(() => CATEGORIES.find((c) => c.key === cat) ?? CATEGORIES[0], [cat]);

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
          提示词、模型、素材、服务与课程——每个商品页都内嵌智能体协助面板。
        </p>
        <div className="mt-4 flex items-center gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 px-3 py-2">
          <Search className="size-4 text-zinc-500" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索商品…"
            className="w-full bg-transparent text-sm text-white placeholder-zinc-600 outline-none"
          />
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCat(c.key)}
            className={
              'flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-all duration-200 ' +
              (cat === c.key
                ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                : 'border-zinc-800 text-zinc-400 hover:border-zinc-600 hover:text-white')
            }
          >
            {c.icon}
            {c.label}
          </button>
        ))}
      </div>

      <PageHeader title={`精选商品${total ? ` · ${total}` : ''}`} subtitle="Phase 5 · 高并发读（按 shop_id + status 索引）" />

      {loading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/50">
              <div className="aspect-square w-full animate-pulse bg-zinc-800/60" />
              <div className="space-y-2 p-4">
                <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <SectionCard>
          <p className="py-8 text-center text-sm text-red-400">加载失败：{error}</p>
        </SectionCard>
      ) : items.length === 0 ? (
        <SectionCard>
          <p className="py-8 text-center text-sm text-zinc-500">暂无商品，换个分类或搜索词试试。</p>
        </SectionCard>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/shop/product/${p.id}`)}
              className="group overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/50 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-emerald-500/40 hover:bg-zinc-900"
            >
              <div className={`relative flex aspect-square w-full items-center justify-center bg-gradient-to-br ${CAT_GRADIENT[p.category] || 'from-zinc-800/60 to-zinc-900'}`}>
                {p.coverUrl ? (
                  <img src={p.coverUrl} alt={p.title} className="size-full object-cover" loading="lazy" />
                ) : (
                  <Store className="size-12 text-white/30" />
                )}
                <span className="absolute left-3 top-3 rounded-full bg-black/40 px-2 py-0.5 text-[11px] text-white/80 backdrop-blur">
                  {heroCat.label}
                </span>
              </div>
              <div className="p-4">
                <h3 className="truncate text-sm font-medium text-white group-hover:text-emerald-300 transition-colors">
                  {p.title}
                </h3>
                {p.subtitle && <p className="mt-0.5 truncate text-xs text-zinc-500">{p.subtitle}</p>}
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-base font-semibold text-emerald-400">{p.creditPrice} 积分</span>
                  {p.priceCents > 0 && <span className="text-xs text-zinc-500">¥{(p.priceCents / 100).toFixed(0)}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
