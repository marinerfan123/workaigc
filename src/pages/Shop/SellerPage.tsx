// 卖家中心（骨架，M6 / shops + products）
import { Store, Plus } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder, TabBar } from '@/components/skeleton';
import { useState } from 'react';

export default function SellerPage() {
  const [tab, setTab] = useState<'shop' | 'products' | 'orders'>('products');

  return (
    <div className="space-y-6">
      <PageHeader
        title="卖家中心"
        subtitle="M6 · 店铺经营：上架走 product_writer，详情走 product_designer"
        phase={{ status: 'planning', label: 'Phase 5' }}
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
          <Placeholder label="店铺信息 + 经营数据" height="h-40" />
        </SectionCard>
      )}
      {tab === 'products' && (
        <SectionCard title="products / product_skus" hint="title / price_cents / stock / ai_fields">
          <Placeholder label="商品列表 + 编辑 + AI 生成详情" height="h-40" />
        </SectionCard>
      )}
      {tab === 'orders' && (
        <SectionCard title="orders + shipments" hint="pay_status / carrier / tracking_no">
          <Placeholder label="订单发货与物流跟踪" height="h-40" />
        </SectionCard>
      )}
    </div>
  );
}
