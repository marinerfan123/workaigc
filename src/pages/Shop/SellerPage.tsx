// 卖家中心（Phase 5 / AI 市集）— 商品管理接真实 GET /api/shop/products（只读预览）
// 说明：当前市集为单一官方店铺，商户「上架/编辑/订单处理」端点尚未实现，标记为规划中。
import { useEffect, useState } from 'react';
import { Store, Plus, Package } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder, TabBar, PhaseBadge } from '@/components/skeleton';
import { apiGetShopProducts, type ShopProduct } from '@/services/api';

export default function SellerPage() {
  const [tab, setTab] = useState<'shop' | 'products' | 'orders'>('products');
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tab === 'products') {
      setLoading(true);
      apiGetShopProducts({ limit: 100 }).then((r) => { setProducts(r.items || []); setLoading(false); });
    }
  }, [tab]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="卖家中心"
        subtitle="Phase 5 · 店铺经营：上架走 product_writer，详情走 product_designer"
        phase={{ status: 'building', label: 'Phase 5（商户端规划中）' }}
        icon={<Store className="size-5" />}
        actions={
          <button className="flex items-center gap-1.5 rounded-2xl bg-emerald-500 px-3 py-2 text-sm font-medium text-black hover:bg-emerald-400 transition-colors">
            <Plus className="size-4" /> 上架商品
          </button>
        }
      />

      <TabBar
        tabs={[
          { key: 'shop', label: '我的店铺' },
          { key: 'products', label: '商品管理' },
          { key: 'orders', label: '订单处理' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'shop' && (
        <SectionCard title="shops" hint="owner_id / name / status">
          <Placeholder label="店铺信息 + 经营数据" note="商户端端点（GET /api/shop/mine 等）待实现" height="h-40" />
        </SectionCard>
      )}

      {tab === 'products' && (
        <SectionCard title={`商品管理 · ${products.length}`} hint="products / product_skus" actions={<PhaseBadge status="building" label="只读预览" />}>
          {loading ? (
            <p className="text-sm text-zinc-500">加载中…</p>
          ) : (
            <div className="space-y-2">
              {products.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3">
                  <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-zinc-800/60 text-zinc-500">
                    <Package className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-white">{p.title}</div>
                    <div className="text-xs text-zinc-500">{p.creditPrice} 积分 · 库存 {p.stock} · {p.status}</div>
                  </div>
                  <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">{p.category}</span>
                </div>
              ))}
              {products.length === 0 && <p className="text-sm text-zinc-600">暂无商品</p>}
            </div>
          )}
        </SectionCard>
      )}

      {tab === 'orders' && (
        <SectionCard title="orders + shipments" hint="pay_status / carrier / tracking_no">
          <Placeholder label="订单发货与物流跟踪" note="商户订单端点待实现" height="h-40" />
        </SectionCard>
      )}
    </div>
  );
}
