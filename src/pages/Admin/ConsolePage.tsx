// M3 运营总控台（骨架）
// 区块：6 KPI + 实时流量曲线 + 动向趋势 + 全局流水滚动 + 日志流 + 告警中心
// 实时数据经 SSE /api/admin/console/stream（metrics/traffic/flow/log/agent 五事件）推送，
// 后端在 Phase 2 接入；此处为骨架布局，标注字段与落点。
import { Activity, Zap, Film, Coins, CheckCircle2, Timer } from 'lucide-react';
import { PageHeader, StatCard, SectionCard, Placeholder, TabBar } from '@/components/skeleton';
import { useState } from 'react';

const KPIS = [
  { label: '在线用户', value: '—', icon: <Activity className="size-4" /> },
  { label: 'QPS', value: '—', icon: <Zap className="size-4" /> },
  { label: '今日生成', value: '—', icon: <Film className="size-4" /> },
  { label: '今日积分消耗', value: '—', icon: <Coins className="size-4" /> },
  { label: '成功率', value: '—', icon: <CheckCircle2 className="size-4" /> },
  { label: '平均延迟', value: '—', icon: <Timer className="size-4" /> },
];

export default function ConsolePage() {
  const [tab, setTab] = useState<'overview' | 'logs' | 'alerts'>('overview');

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="运营总控台"
        subtitle="M3 · 全局流水 / 流量 / 动向 / 日志 / 告警态势感知（admin 专属）"
        phase={{ status: 'building', label: 'Phase 2 接入 SSE' }}
        icon={<Activity className="size-5" />}
      />

      {/* 6 KPI */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {KPIS.map((k) => (
          <StatCard key={k.label} label={k.label} value={k.value} icon={k.icon} />
        ))}
      </div>

      <TabBar
        tabs={[
          { key: 'overview', label: '态势总览' },
          { key: 'logs', label: '日志流' },
          { key: 'alerts', label: '告警中心' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <SectionCard title="实时流量" hint="traffic 事件" className="lg:col-span-2" bodyClassName="p-0">
            <Placeholder
              label="QPS 实时曲线（1s 推送）"
              note="SSE /api/admin/console/stream → event: traffic"
              height="h-48"
            />
          </SectionCard>
          <SectionCard title="动向趋势" hint="flow 事件">
            <Placeholder label="全局积分流水滚动" note="flow: consume / recharge / refund" height="h-48" />
          </SectionCard>
          <SectionCard title="智能体调用" hint="agent 事件" className="lg:col-span-2">
            <Placeholder
              label="ops_bot 等 agent 调用 / 成本 / 成功率"
              note="agent_calls 实时聚合"
              height="h-44"
            />
          </SectionCard>
          <SectionCard title="异常 IP / 封禁" hint="ops_bot">
            <Placeholder label="ban_ip / alert_error_rate" note="H.3 规则引擎" height="h-44" />
          </SectionCard>
        </div>
      )}

      {tab === 'logs' && (
        <SectionCard title="日志流" hint="log 事件 · request_logs / audit_logs">
          <Placeholder
            label="实时日志滚动（级别 / 动作 / 消息）"
            note="仅采样/异步落库，OTel 取代 PG 写日志"
            height="h-72"
          />
        </SectionCard>
      )}

      {tab === 'alerts' && (
        <SectionCard title="告警中心" hint="H.2 阈值">
          <Placeholder
            label="QPS>800 / 成功率<95% / p95>1s / 5xx>2% / 视频积压>50"
            note="告警经 SSE 推总控台 + 通知 admin"
            height="h-72"
          />
        </SectionCard>
      )}
    </div>
  );
}
