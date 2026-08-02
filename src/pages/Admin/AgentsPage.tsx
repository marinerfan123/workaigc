// M4 全局智能体层（真实数据）
// 监控看板 + 管理：agents / agent_providers / agent_rules（§B.9）
// 接口：/api/admin/agents* / agent-providers / agent-rules*；调度器 dispatcher 令牌桶 + round-robin。
import { Bot, Server, GitBranch, BarChart3, Power } from 'lucide-react';
import { PageHeader, SectionCard, TabBar, StatCard, cn } from '@/components/skeleton';
import { useCallback, useEffect, useState } from 'react';
import {
  apiAdminAgents, apiAdminToggleAgent,
  apiAdminAgentProviders, apiAdminAgentRules, apiAdminToggleAgentRule,
  type AdminAgent, type AgentProvider, type AgentRule,
} from '@/services/api';

export default function AgentsPage() {
  const [tab, setTab] = useState<'dashboard' | 'agents' | 'providers' | 'rules'>('dashboard');
  const [agents, setAgents] = useState<AdminAgent[]>([]);
  const [providers, setProviders] = useState<AgentProvider[]>([]);
  const [rules, setRules] = useState<AgentRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [a, p, r] = await Promise.all([apiAdminAgents(), apiAdminAgentProviders(), apiAdminAgentRules()]);
    setAgents(a); setProviders(p); setRules(r);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleAgent = async (a: AdminAgent) => {
    await apiAdminToggleAgent(a.key, !a.enabled);
    setAgents((prev) => prev.map((x) => (x.key === a.key ? { ...x, enabled: !x.enabled } : x)));
  };
  const toggleRule = async (r: AgentRule) => {
    await apiAdminToggleAgentRule(r.id, !r.enabled);
    setRules((prev) => prev.map((x) => (x.id === r.id ? { ...x, enabled: !x.enabled } : x)));
  };

  const enabledAgents = agents.filter((a) => a.enabled).length;
  const enabledRules = rules.filter((r) => r.enabled).length;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="全局智能体层"
        subtitle="M4 · 把 AI 能力建模为一等公民：看板 + 管理 + 自动化运营智能体"
        phase={{ status: 'ready', label: 'Phase 2 · 真实数据' }}
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
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="智能体总数" value={String(agents.length)} icon={<Bot className="size-4" />} />
          <StatCard label="启用中" value={String(enabledAgents)} icon={<Power className="size-4" />} />
          <StatCard label="自动化规则" value={String(rules.length)} icon={<GitBranch className="size-4" />} />
          <StatCard label="供应商映射" value={String(providers.length)} icon={<Server className="size-4" />} />
        </div>
      )}

      {tab === 'agents' && (
        <SectionCard title="agents 表" hint="key / name / enabled / daily_budget / config" actions={<span className="text-xs text-zinc-500">{loading ? '加载中…' : `${enabledAgents}/${agents.length} 启用`}</span>}>
          <div className="space-y-2">
            {agents.map((a) => (
              <div key={a.key} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <div>
                  <div className="font-medium text-zinc-100">{a.name}</div>
                  <div className="text-xs text-zinc-500">{a.key} · 日预算 {a.dailyBudget}</div>
                </div>
                <button
                  onClick={() => toggleAgent(a)}
                  className={cn('inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors',
                    a.enabled ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-white/10 text-zinc-400 hover:bg-white/15')}
                >
                  <Power className="size-3.5" /> {a.enabled ? '已启用' : '已停用'}
                </button>
              </div>
            ))}
            {agents.length === 0 && !loading && <div className="py-6 text-center text-xs text-zinc-500">暂无智能体</div>}
          </div>
        </SectionCard>
      )}

      {tab === 'providers' && (
        <SectionCard title="agent_providers 表" hint="agent_key / provider / model / weight / priority / cost_per_call / enabled">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500">
                  <th className="py-2 pr-4 font-medium">智能体</th>
                  <th className="py-2 pr-4 font-medium">供应商</th>
                  <th className="py-2 pr-4 font-medium">模型</th>
                  <th className="py-2 pr-4 font-medium">权重</th>
                  <th className="py-2 pr-4 font-medium">优先级</th>
                  <th className="py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {providers.map((p) => (
                  <tr key={p.id} className="text-zinc-200">
                    <td className="py-2.5 pr-4 text-zinc-300">{p.agentKey}</td>
                    <td className="py-2.5 pr-4">{p.provider || '—'}</td>
                    <td className="py-2.5 pr-4">{p.model || '—'}</td>
                    <td className="py-2.5 pr-4">{p.weight}</td>
                    <td className="py-2.5 pr-4">{p.priority}</td>
                    <td className="py-2.5"><span className={cn('rounded-full px-2 py-0.5 text-xs', p.enabled ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/10 text-zinc-400')}>{p.enabled ? '启用' : '停用'}</span></td>
                  </tr>
                ))}
                {providers.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-xs text-zinc-500">暂无供应商映射</td></tr>}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {tab === 'rules' && (
        <SectionCard title="agent_rules 表" hint="name / trigger / condition / action / enabled" actions={<span className="text-xs text-zinc-500">{loading ? '加载中…' : `${enabledRules}/${rules.length} 启用`}</span>}>
          <div className="space-y-2">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between rounded-2xl bg-white/5 px-4 py-3">
                <div>
                  <div className="font-medium text-zinc-100">{r.name}</div>
                  <div className="text-xs text-zinc-500">trigger: {r.trigger} · {JSON.stringify(r.condition)}</div>
                </div>
                <button
                  onClick={() => toggleRule(r)}
                  className={cn('inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors',
                    r.enabled ? 'bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25' : 'bg-white/10 text-zinc-400 hover:bg-white/15')}
                >
                  <Power className="size-3.5" /> {r.enabled ? '已启用' : '已停用'}
                </button>
              </div>
            ))}
            {rules.length === 0 && !loading && <div className="py-6 text-center text-xs text-zinc-500">暂无规则</div>}
          </div>
        </SectionCard>
      )}
    </div>
  );
}
