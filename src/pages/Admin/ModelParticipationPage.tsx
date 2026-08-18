import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Layers as LayersIcon, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Activity, KeyRound, Search,
} from 'lucide-react';
import {
  apiAdminModelParticipation,
  type ModelParticipationResponse, type ModelParticipation, type ProviderParticipation, type ParticipationSummary,
} from '@/services/api';

type Stat = { label: string; value: number; tone?: 'ok' | 'warn' | 'bad' | 'neutral' };

function StatCard({ label, value, tone = 'neutral' }: Stat) {
  const toneCls = {
    ok: 'text-emerald-300',
    warn: 'text-amber-300',
    bad: 'text-rose-300',
    neutral: 'text-white',
  }[tone];
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-900/60 px-4 py-3">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-2xl font-bold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

function Pill({ ok, label, tone }: { ok?: boolean; label: string; tone?: 'ok' | 'warn' | 'bad' | 'neutral' }) {
  const base = 'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]';
  let cls = 'border-zinc-700 bg-zinc-800/60 text-zinc-400';
  if (tone === 'ok' || ok === true) cls = 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300';
  else if (tone === 'warn') cls = 'border-amber-500/20 bg-amber-500/10 text-amber-300';
  else if (tone === 'bad' || ok === false) cls = 'border-rose-500/20 bg-rose-500/10 text-rose-300';
  return <span className={`${base} ${cls}`}>{label}</span>;
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
      <div className="mb-4">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {desc && <p className="mt-1 text-xs text-zinc-500">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

export default function ModelParticipationPage() {
  const [data, setData] = useState<ModelParticipationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [providerFilter, setProviderFilter] = useState('');
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const r = await apiAdminModelParticipation({ onlyProblems, providerId: providerFilter || undefined });
      if (!r) { setError('请求失败：请确认后端已启动且当前为管理员'); setData(null); return; }
      setData(r);
    } catch (e: any) {
      setError('加载失败：' + (e?.message || e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [onlyProblems, providerFilter]);

  useEffect(() => { load(); }, [load]);

  const summary: ParticipationSummary | null = data?.summary || null;
  const providers: ProviderParticipation[] = data?.providers || [];
  const provNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    (providers || []).forEach((p) => { m[p.providerId] = p.name || p.baseUrl || p.providerId; });
    return m;
  }, [providers]);

  // 模型表：先按 providerFilter / search 过滤（providerFilter 已在后端过滤，search 在客户端）
  const models: ModelParticipation[] = useMemo(() => {
    const list = data?.models || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => (m.displayName || '').toLowerCase().includes(q) || (m.modelId || '').toLowerCase().includes(q));
  }, [data, search]);

  const modelStats: Stat[] = summary ? [
    { label: '同步模型总数', value: summary.totalModels },
    { label: '已同步', value: summary.syncedModels, tone: 'ok' },
    { label: '已绑定', value: summary.boundModels },
    { label: '实际可参与', value: summary.participatesModels, tone: 'ok' },
    { label: '近24h被调用', value: summary.calledModels24h, tone: summary.calledModels24h > 0 ? 'ok' : 'neutral' },
    { label: '冷却/熔断中', value: summary.coolingModels, tone: summary.coolingModels > 0 ? 'warn' : 'ok' },
    { label: '容量不足', value: summary.lowCapacityModels, tone: summary.lowCapacityModels > 0 ? 'bad' : 'ok' },
  ] : [];

  const provStats: Stat[] = summary ? [
    { label: '密钥总数', value: summary.totalProviders },
    { label: '有效密钥', value: summary.validProviders, tone: 'ok' },
    { label: '冷却/熔断密钥', value: summary.coolingProviders, tone: summary.coolingProviders > 0 ? 'warn' : 'ok' },
  ] : [];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-400">
          <LayersIcon className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">模型参与度（密钥池四态）</h1>
          <p className="mt-1 text-sm text-zinc-500">
            核对每个模型/密钥是否真正进入调度：已同步 → 已绑定 → 实际被调用 → 当前冷却/熔断。参与口径与
            <code className="mx-1 text-zinc-400">dispatcher.loadDispatchPairs</code>严格对齐。
          </p>
        </div>
      </div>

      {/* 过滤器 */}
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-3">
        <button
          onClick={() => load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-white hover:bg-sky-400 disabled:opacity-50"
        >
          <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
          {loading ? '加载中…' : '刷新'}
        </button>

        <label className="flex items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={onlyProblems}
            onChange={(e) => setOnlyProblems(e.target.checked)}
            className="accent-sky-500"
          />
          仅看异常（未参与/冷却/容量不足）
        </label>

        <select
          value={providerFilter}
          onChange={(e) => setProviderFilter(e.target.value)}
          className="h-[38px] rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 text-sm text-white outline-none focus:border-sky-500/50"
        >
          <option value="">全部密钥</option>
          {providers.map((p) => (
            <option key={p.providerId} value={p.providerId}>
              {p.name || p.baseUrl || p.providerId}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索模型名 / model_id"
            className="w-full rounded-xl border border-zinc-800 bg-zinc-800/40 py-2 pl-9 pr-3 text-sm text-white placeholder-zinc-600 outline-none focus:border-sky-500/50"
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* 汇总 */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        {modelStats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {provStats.map((s) => <StatCard key={s.label} {...s} />)}
      </div>

      {/* 密钥池（服务商）视图 */}
      <Section
        title="密钥池视图（每个密钥承载多少模型）"
        desc="每个「密钥」= 一条独立 providers 行（按 baseUrl 分组，而非单 provider 多 key）。cooling = 该账号当前 cold 或熔断 OPEN/HALF_OPEN。"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="px-3 py-2">名称 / BaseUrl</th>
                <th className="px-3 py-2">密钥</th>
                <th className="px-3 py-2">启用</th>
                <th className="px-3 py-2">有效</th>
                <th className="px-3 py-2">Key池(运行)</th>
                <th className="px-3 py-2">熔断态</th>
                <th className="px-3 py-2">冷却</th>
                <th className="px-3 py-2 text-right">已同步</th>
                <th className="px-3 py-2 text-right">已绑定</th>
                <th className="px-3 py-2 text-right">可参与</th>
                <th className="px-3 py-2 text-right">近24h调用</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-zinc-500">无数据</td></tr>
              ) : providers.map((p) => (
                <tr key={p.providerId} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <div className="font-medium text-white">{p.name || '—'}</div>
                    <div className="text-[11px] text-zinc-500 truncate max-w-[220px]">{p.baseUrl}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-zinc-400">{p.keyMasked}</td>
                  <td className="px-3 py-2"><Pill ok={p.enabled} label={p.enabled ? '启用' : '停用'} /></td>
                  <td className="px-3 py-2"><Pill ok={p.validKey} label={p.validKey ? '有效' : '无效'} /></td>
                  <td className="px-3 py-2">
                    <div className="tabular-nums text-zinc-200">{p.poolSize ?? 0}</div>
                    <div className="text-[11px] text-zinc-500">活跃{p.activeKeys ?? 0}·运行{p.runtimeLoaded ?? 0}·断{p.coolingKeys ?? 0}·隔{p.isolatedKeys ?? 0}</div>
                  </td>
                  <td className="px-3 py-2">
                    <Pill
                      tone={p.cbState === 'CLOSED' ? 'ok' : p.cbState === 'OPEN' ? 'bad' : 'warn'}
                      label={p.cbState}
                    />
                  </td>
                  <td className="px-3 py-2"><Pill ok={!p.cooling} label={p.cooling ? '冷却中' : '正常'} /></td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-200">{p.syncedModels}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-200">{p.boundModels}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{p.servedModels}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-zinc-200">{p.called24h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* 模型视图 */}
      <Section
        title={`模型视图（${models.length} 条）`}
        desc="四态逐列核对：已同步（models 表有 provider_id）/ 已绑定（存在 enabled 绑定）/ 实际被调用（近24h generation_attempts）/ 当前冷却熔断（候选账号 cold 或熔断）。"
      >
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-xs text-zinc-500">
                <th className="px-3 py-2">模型</th>
                <th className="px-3 py-2">类型</th>
                <th className="px-3 py-2">已同步</th>
                <th className="px-3 py-2">已绑定</th>
                <th className="px-3 py-2">可参与</th>
                <th className="px-3 py-2">容量(池/并发)</th>
                <th className="px-3 py-2 text-right">近24h调用</th>
                <th className="px-3 py-2 text-right">成功</th>
                <th className="px-3 py-2">冷却/熔断</th>
              </tr>
            </thead>
            <tbody>
              {models.length === 0 ? (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-zinc-500">无匹配模型</td></tr>
              ) : models.map((m) => (
                <tr key={m.modelId} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                  <div className="font-medium text-white">{m.displayName || '—'}</div>
                  {m.mappingName && <div className="text-[11px] text-sky-400/80 font-mono">{m.mappingName}</div>}
                  <div className="text-[11px] text-zinc-500 font-mono">{m.modelId}</div>
                </td>
                <td className="px-3 py-2 text-zinc-400">{m.type || '—'}</td>
                <td className="px-3 py-2"><Pill ok={m.synced} label={m.synced ? '是' : '否'} /></td>
                <td className="px-3 py-2"><Pill ok={m.bound} label={m.bound ? '是' : '否'} /></td>
                <td className="px-3 py-2">
                  <Pill ok={m.participates} label={m.participates ? '参与' : '未参与'} />
                  {m.lowCapacity && <span className="ml-1"><Pill tone="bad" label="容量不足" /></span>}
                </td>
                <td className="px-3 py-2 text-zinc-300">
                  <span className="tabular-nums">{m.poolSize}</span>
                  <span className="text-zinc-500"> 密钥</span>
                  {m.unlimited ? (
                    <span className="ml-1 text-zinc-500">/无限</span>
                  ) : (
                    <span className="ml-1 text-zinc-500">/{m.totalConcurrency}并发</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-zinc-200">{m.calledLast24h}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-300">{m.successLast24h}</td>
                  <td className="px-3 py-2">
                    {m.cooling ? (
                      <Pill tone="warn" label={`冷却(${(m.coolingProviders || []).length})`} />
                    ) : (
                      <Pill label="正常" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="mt-4 flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-500">
        <Activity className="mt-0.5 size-3.5 shrink-0" />
        <span>
          「可参与」= 存在 enabled 绑定（或 legacy <code className="text-zinc-400">models.provider_id</code> 回退）且对应服务商
          <code className="mx-1 text-zinc-400">enabled</code> + <code className="text-zinc-400">api_key</code> 有效（≥6 位）。
          「容量不足」= 参与但仅单线路且并发槽 ≤1（如 gpt-image-1），批量提交会大量进入等待区并最终关闭——需在 ModelHub 配多密钥池或调高
          <code className="mx-1 text-zinc-400">max_concurrent</code>。「冷却/熔断」实时态来自调度器内存（与 generate 同源），含 cold 与熔断状态机 OPEN/HALF_OPEN。
        </span>
      </div>
    </div>
  );
}
