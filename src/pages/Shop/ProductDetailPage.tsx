// 商品详情（Phase 5 / AI 市集）— 接真实后端 GET /api/products/:id
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Star, Sparkles, ShoppingCart, Zap, Store } from 'lucide-react';
import { PageHeader, SectionCard } from '@/components/skeleton';
import { apiGetProduct, apiAddToCart, type ShopProductDetail } from '@/services/api';
import { useAuth, setAuthModalOpen } from '@/services/authStore';
import { cn } from '@/components/skeleton';

export default function ProductDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [data, setData] = useState<ShopProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    setError('');
    apiGetProduct(id)
      .then((r) => alive && setData(r))
      .catch((e) => alive && setError(String(e?.message || e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [id]);

  const p = data?.product;
  const reviews = data?.reviews || [];
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const tags = (p?.aiFields as any)?.tags as string[] | undefined;

  async function addToCart(thenCheckout = false) {
    if (!user) { setAuthModalOpen(true); return; }
    if (!p) return;
    setBusy(true);
    setMsg(null);
    const r = await apiAddToCart(p.id, qty);
    setBusy(false);
    if (r.ok) {
      setMsg({ ok: true, text: thenCheckout ? '已加入，前往结算…' : '已加入购物车' });
      navigate(thenCheckout ? '/shop/checkout' : '/shop/cart');
    } else {
      setMsg({ ok: false, text: r.error || '加入失败' });
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title={`商品 #${id}`} subtitle="加载中…" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="aspect-[4/3] w-full animate-pulse rounded-2xl bg-zinc-800/60" />
          <div className="space-y-3">
            <div className="h-6 w-2/3 animate-pulse rounded bg-zinc-800" />
            <div className="h-4 w-1/3 animate-pulse rounded bg-zinc-800" />
            <div className="h-10 w-full animate-pulse rounded bg-zinc-800" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !p) {
    return (
      <div className="space-y-6">
        <PageHeader title="商品不存在" subtitle="Phase 5" />
        <SectionCard>
          <p className="py-8 text-center text-sm text-red-400">{error || '未找到该商品'}</p>
        </SectionCard>
      </div>
    );
  }

  const soldOut = p.stock <= 0;

  return (
    <div className="space-y-6">
      <PageHeader title={p.title} subtitle={`Phase 5 · 商品 #${p.id}`} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 左：图区 */}
        <SectionCard title="图区" hint={p.coverUrl ? 'cover_url' : '无主图'} bodyClassName="p-0">
          <div className="space-y-3 p-5">
            <div className={`flex aspect-[4/3] w-full items-center justify-center rounded-2xl bg-gradient-to-br from-zinc-800/60 to-zinc-900`}>
              {p.coverUrl ? <img src={p.coverUrl} alt={p.title} className="size-full object-cover rounded-2xl" /> : <Store className="size-16 text-white/20" />}
            </div>
            <p className="text-xs text-zinc-600">主图占位（示例商品暂未配置封面）</p>
          </div>
        </SectionCard>

        {/* 右上：信息区 */}
        <div className="space-y-4">
          <SectionCard>
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-white">{p.title}</h2>
              {p.subtitle && <p className="text-sm text-zinc-500">{p.subtitle}</p>}
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-emerald-400">{p.creditPrice} 积分</span>
                {p.priceCents > 0 && <span className="text-sm text-zinc-500">¥{(p.priceCents / 100).toFixed(2)}</span>}
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="flex items-center gap-0.5">
                  <Star className="size-3 fill-amber-400 text-amber-400" /> {avg ? avg.toFixed(1) : '—'}
                </span>
                <span className="text-zinc-700">·</span>
                <span>库存 {p.stock}</span>
                <span className="text-zinc-700">·</span>
                <span>{p.shopName || '官方市集'}</span>
              </div>

              {tags && tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => (
                    <span key={t} className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">{t}</span>
                  ))}
                </div>
              )}

              {/* 数量 + 操作 */}
              <div className="flex items-center gap-3 pt-1">
                <div className="flex items-center rounded-xl border border-zinc-800">
                  <button className="px-3 py-1.5 text-zinc-400 hover:text-white disabled:opacity-40" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                  <span className="w-8 text-center text-sm text-white">{qty}</span>
                  <button className="px-3 py-1.5 text-zinc-400 hover:text-white disabled:opacity-40" disabled={qty >= p.stock} onClick={() => setQty((q) => Math.min(p.stock, q + 1))}>+</button>
                </div>
                <button
                  onClick={() => addToCart(false)}
                  disabled={busy || soldOut}
                  className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-zinc-800 py-2.5 text-sm font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-40"
                >
                  <ShoppingCart className="size-4" /> {soldOut ? '已售罄' : '加入购物车'}
                </button>
                <button
                  onClick={() => addToCart(true)}
                  disabled={busy || soldOut}
                  className="flex-1 rounded-2xl bg-emerald-500 py-2.5 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
                >
                  立即购买
                </button>
              </div>
              {msg && <p className={cn('text-xs', msg.ok ? 'text-emerald-400' : 'text-red-400')}>{msg.text}</p>}
            </div>
          </SectionCard>

          {/* 智能体协助面板（规划中占位） */}
          <SectionCard title="智能体协助面板" hint="DESIGN §15" className="ring-1 ring-emerald-500/20">
            <div className="grid grid-cols-2 gap-2">
              {['改写卖点', '写种草文案', '配图建议', '问答预测'].map((label) => (
                <div key={label} className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-500">
                  <Sparkles className="size-4" /> {label}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-zinc-600">agent 返回输出区（可一键「应用到详情」）· 规划中</p>
          </SectionCard>
        </div>
      </div>

      {/* AI 结构化图文 */}
      <SectionCard title="AI 结构化图文" hint="ai_fields">
        {p.description ? <p className="text-sm leading-relaxed text-zinc-300">{p.description}</p> : <p className="text-sm text-zinc-600">暂无详情（示例商品）</p>}
      </SectionCard>

      {/* 评价 */}
      <SectionCard title="评价" hint="reviews: rating(1-5) / content">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-3xl font-semibold text-white">{avg ? avg.toFixed(1) : '—'}</span>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} className={cn('size-4', i <= Math.round(avg) ? 'fill-amber-400 text-amber-400' : 'text-zinc-700')} />
            ))}
          </div>
          <span className="text-xs text-zinc-500">{reviews.length} 条评价</span>
        </div>
        {reviews.length === 0 ? (
          <p className="text-sm text-zinc-600">还没有评价。</p>
        ) : (
          <div className="space-y-3">
            {reviews.map((r) => (
              <div key={r.id} className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star key={i} className={cn('size-3', i <= r.rating ? 'fill-amber-400 text-amber-400' : 'text-zinc-700')} />
                    ))}
                  </div>
                  <span className="text-xs text-zinc-500">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : ''}</span>
                </div>
                {r.content && <p className="mt-1.5 text-sm text-zinc-300">{r.content}</p>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
