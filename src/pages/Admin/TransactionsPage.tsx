// 积分流水（骨架，M2 账务积分）
// credit_transactions：本人流水查询 + 后台审计；balance_after 只追加对账。
import { Receipt } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder } from '@/components/skeleton';

export default function TransactionsPage() {
  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="积分流水"
        subtitle="M2 · 消费 / 充值 / 后台调整 / 退款流水；balance_after 只追加对账"
        phase={{ status: 'building', label: 'Phase 2' }}
        icon={<Receipt className="size-5" />}
      />

      <SectionCard
        title="credit_transactions"
        hint="user_id / type / amount / balance_after / task_id(幂等) / created_at"
      >
        <Placeholder
          label="流水表格：类型筛选（consume / recharge / adjust / refund）+ 时间区间"
          note="生成前原子预扣（§D.1）+ 失败回退；本人查询 + 后台审计"
          height="h-64"
        />
      </SectionCard>
    </div>
  );
}
