// 商品详情（骨架，M6 / §G.2 详情页字段清单）
// 左图区 / 右上信息区 / 右智能体协助面板 / 下 AI 结构化图文 / 下评价
import { useParams } from 'react-router-dom';
import { Star, Sparkles, ShoppingCart, Zap } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder, cn } from '@/components/skeleton';

export default function ProductDetailPage() {
  const { id } = useParams();

  const agentActions = [
    { label: '改写卖点', icon: <Sparkles className="size-4" /> },
    { label: '写种草文案', icon: <Zap className="size-4" /> },
    { label: '配图建议', icon: <Sparkles className="size-4" /> },
    { label: '问答预测', icon: <Sparkles className="size-4" /> },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title={`商品 #${id}`} subtitle="M6 详情页 · 内嵌智能体协助面板（product_designer 等）" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* 左：图区 */}
        <SectionCard title="图区" hint="cover_url + ai_fields.gallery[]" bodyClassName="p-0">
          <div className="space-y-3 p-5">
            <div className="aspect-[4/3] w-full rounded-2xl bg-zinc-800/60" />
            <div className="flex gap-2">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="size-14 rounded-xl bg-zinc-800/60" />
              ))}
            </div>
            <p className="text-xs text-zinc-600">主图轮播 + 缩略图条 + 放大镜 / 3D 预览占位</p>
          </div>
        </SectionCard>

        {/* 右上：信息区 */}
        <div className="space-y-4">
          <SectionCard>
            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-white">商品标题</h2>
              <p className="text-sm text-zinc-500">副标题</p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold text-emerald-400">¥199.00</span>
                <span className="text-sm text-zinc-500">积分价 1990</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span>销量 1.2k</span>
                <span className="text-zinc-700">·</span>
                <span className="flex items-center gap-0.5">
                  <Star className="size-3 fill-amber-400 text-amber-400" /> 4.8
                </span>
                <span className="text-zinc-700">·</span>
                <span>库存 99</span>
              </div>
              {/* SKU 选择器 */}
              <div className="flex gap-2">
                {['规格A', '规格B', '规格C'].map((s, i) => (
                  <button
                    key={s}
                    className={cn(
                      'rounded-xl border px-3 py-1.5 text-xs transition-colors',
                      i === 0
                        ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                        : 'border-zinc-800 text-zinc-400 hover:border-zinc-600',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {/* 数量 + 操作 */}
              <div className="flex items-center gap-3 pt-1">
                <div className="flex items-center rounded-xl border border-zinc-800">
                  <button className="px-3 py-1.5 text-zinc-400 hover:text-white">−</button>
                  <span className="w-8 text-center text-sm text-white">1</span>
                  <button className="px-3 py-1.5 text-zinc-400 hover:text-white">+</button>
                </div>
                <button className="flex flex-1 items-center justify-center gap-2 rounded-2xl bg-zinc-800 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 transition-colors">
                  <ShoppingCart className="size-4" /> 加入购物车
                </button>
                <button className="flex-1 rounded-2xl bg-emerald-500 py-2.5 text-sm font-medium text-black hover:bg-emerald-400 transition-colors">
                  立即购买
                </button>
              </div>
            </div>
          </SectionCard>

          {/* 右：智能体协助面板 */}
          <SectionCard title="智能体协助面板" hint="DESIGN §15 mockup" className="ring-1 ring-emerald-500/20">
            <div className="grid grid-cols-2 gap-2">
              {agentActions.map((a) => (
                <button
                  key={a.label}
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-300 hover:border-emerald-500/40 hover:text-emerald-300 transition-colors"
                >
                  {a.icon} {a.label}
                </button>
              ))}
            </div>
            <Placeholder
              label="agent 返回输出区（可一键「应用到详情」）"
              note="product_writer / product_designer / copywriter / smart_cs"
              height="h-24"
            />
          </SectionCard>
        </div>
      </div>

      {/* 下：AI 结构化图文 */}
      <SectionCard title="AI 结构化图文" hint="ai_fields（product_designer 生成）">
        <Placeholder
          label="功效对比表 / 成分图谱 / 场景卡"
          note="ai_fields JSONB 渲染"
          height="h-40"
        />
      </SectionCard>

      {/* 下：评价 */}
      <SectionCard title="评价" hint="reviews: rating(1-5) / content">
        <div className="mb-3 flex items-center gap-3">
          <span className="text-3xl font-semibold text-white">4.8</span>
          <div className="flex items-center gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <Star key={i} className={cn('size-4', i <= 4 ? 'fill-amber-400 text-amber-400' : 'text-zinc-700')} />
            ))}
          </div>
          <span className="text-xs text-zinc-500">评分分布 + 最新 reviews</span>
        </div>
        <Placeholder label="评价列表（评分分布柱状 + 最新评论）" height="h-32" />
      </SectionCard>
    </div>
  );
}
