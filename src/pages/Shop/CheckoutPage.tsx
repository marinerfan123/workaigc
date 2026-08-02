// 结算（骨架，M6 / §G.3 下单流程 + 积分抵现）
// 下单 6 步：登录校验 → 锁库存(行锁) → 算价(total - credit_used*RATE) → 建单(pending) → 支付 → audit_logs
import { useAuth } from '@/services/authStore';
import { PageHeader, SectionCard, Placeholder, cn } from '@/components/skeleton';

export default function CheckoutPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <PageHeader title="结算" subtitle="M6 · 下单含积分抵现 + 防超卖（§G.3 / §D.4）" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="收货 / 支付">
            <Placeholder label="收货信息 + 支付方式（微信 / 支付宝 / 纯积分）" height="h-40" />
          </SectionCard>

          {/* 积分抵现 */}
          <SectionCard title="积分抵现" hint="credit_used 走 §D.1 原子预扣">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white">使用积分抵扣</div>
                <div className="text-xs text-zinc-500">当前可用 {user?.credits ?? 0} 积分</div>
              </div>
              <button className="rounded-xl border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-emerald-500/40 transition-colors">
                使用
              </button>
            </div>
          </SectionCard>
        </div>

        <SectionCard title="订单摘要">
          <div className="space-y-2 text-sm">
            <div className="flex justify-between text-zinc-400"><span>商品</span><span className="text-white">¥298.00</span></div>
            <div className="flex justify-between text-zinc-400"><span>积分抵扣</span><span className="text-emerald-400">-¥0.00</span></div>
            <div className="flex justify-between border-t border-zinc-800 pt-2 font-medium"><span className="text-white">应付</span><span className="text-emerald-400">¥298.00</span></div>
          </div>
          <button className={cn('mt-4 w-full rounded-2xl bg-emerald-500 py-2.5 text-sm font-medium text-black hover:bg-emerald-400 transition-colors')}>
            提交订单
          </button>
        </SectionCard>
      </div>
    </div>
  );
}
