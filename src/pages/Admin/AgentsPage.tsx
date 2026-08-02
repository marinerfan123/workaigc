// M4 全局智能体层（骨架）
// 监控看板（调用/成本/成功率）+ 管理：agents / agent_providers / agent_rules
// 接口：/api/admin/agents/*（DETAILED_SPEC §12.6）；调度器 dispatcher 令牌桶 + round-robin。
import { Bot, Server, GitBranch, BarChart3 } from 'lucide-react';
import { PageHeader, SectionCard, Placeholder, TabBar } from '@/components/skeleton';
import { useState } from 'react';

export default function AgentsPage() {
  const [tab, setTab] = useState<'dashboard' | 'agents' | 'providers' | 'rules'>('dashboard');

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="全局智能体层"
        subtitle="M4 · 把 AI 能力建模为一等公民：看板 + 管理 + 自动化运营智能体"
        phase={{ status: 'building', label: 'Phase 2' }}
        icon={<Bot className="size-5" />}
      />

      <TabBar
        tabs={[
          { key: 'dashboard', label: '监控看板', icon: <BarChart3 className="size-4" /> },
          { key: 'agents', label: '智能体', icon: <Bot className="size-4" /> },
          { key: 'providers', label: '供应商', icon: <Server className="size-4" /> },
          { key: 'rules', label: '自动化规则', icon: <GitBranch className="size-4" /> },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'dashboard' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard title="调用量" hint="agent_calls">
            <Placeholder label="按 agent_key 聚合调用次数" height="h-40" />
          </SectionCard>
          <SectionCard title="成功率" hint="ok / 总数">
            <Placeholder label="各 agent 成功率实时" height="h-40" />
          </SectionCard>
          <SectionCard title="成本" hint="cost_credits">
            <Placeholder label="积分消耗趋势" height="h-40" />
          </SectionCard>
        </div>
      )}

      {tab === 'agents' && (
        <SectionCard
          title="agents 表"
          hint="key / name / enabled / daily_budget / config"
          actions={<span className="text-xs text-zinc-500">新增智能体</span>}
        >
          <Placeholder
            label="智能体列表 + 启用开关"
            note="ops_bot 等；skill_registry 可插拔挂载"
            height="h-48"
          />
        </SectionCard>
      )}

      {tab === 'providers' && (
        <SectionCard title="agent_providers 表" hint="agent_key / provider / model / weight / priority / cost_per_call / enabled">
          <Placeholder
            label="多供应商权重与优先级"
            note="dispatcher 令牌桶 + round-robin 分配"
            height="h-48"
          />
        </SectionCard>
      )}

      {tab === 'rules' && (
        <SectionCard title="agent_rules 表" hint="name / trigger / condition / action / enabled">
          <Placeholder
            label="ops_bot 规则：ban_ip / alert_error_rate / auto_reply"
            note="H.3 规则引擎；命中写 agent_rule_logs"
            height="h-48"
          />
        </SectionCard>
      )}
    </div>
  );
}
