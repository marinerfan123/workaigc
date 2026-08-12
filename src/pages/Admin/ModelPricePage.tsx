import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Cpu, Image as ImageIcon, Film, Save, Trash2, Plus, AlertCircle, Check,
  BrainCircuit, HelpCircle,
} from 'lucide-react';
import {
  apiGetModels, apiPatchModel, apiAddModel, apiGetProviders, apiGetModelPriceHistory,
} from '@/services/api';

type ModelRow = {
  id: string;
  modelId: string;
  displayName: string;
  type?: string;
  providerId?: string;
  creditCost?: number;
  enabled?: boolean;
};

type ModelGroup = {
  displayName: string;
  modelId: string;
  type: string;
  items: ModelRow[];
  creditCost: number;
  inconsistent: boolean;
};

const TYPE_META: Record<string, { label: string; icon: React.ReactNode; color: string; bg: string; border: string }> = {
  image: { label: '图像', icon: <ImageIcon className="size-3.5" />, color: 'text-sky-300', bg: 'bg-sky-500/10', border: 'border-sky-500/20' },
  video: { label: '视频', icon: <Film className="size-3.5" />, color: 'text-violet-300', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  text: { label: '推理', icon: <BrainCircuit className="size-3.5" />, color: 'text-teal-300', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
};

function typeMeta(type?: string) {
  return TYPE_META[type || ''] || {
    label: '其他', icon: <HelpCircle className="size-3.5" />, color: 'text-zinc-400', bg: 'bg-zinc-500/10', border: 'border-zinc-500/20',
  };
}

function groupModels(models: ModelRow[]): ModelGroup[] {
  const map = new Map<string, ModelRow[]>();
  models.forEach((m) => {
    const key = (m.displayName || m.modelId || '').trim() || '_';
    const arr = map.get(key) || [];
    arr.push(m);
    map.set(key, arr);
  });
  return Array.from(map.entries())
    .map(([displayName, items]) => {
      const first = items[0];
      const costs = items.map((m) => (typeof m.creditCost === 'number' ? m.creditCost : 0));
      const creditCost = costs[0] || 0;
      const inconsistent = costs.some((c) => c !== creditCost);
      return {
        displayName,
        modelId: first?.modelId || '',
        type: first?.type || 'other',
        items,
        creditCost,
        inconsistent,
      };
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
}

export default function ModelPricePage() {
  const [groups, setGroups] = useState<ModelGroup[]>([]);
  const [providers, setProviders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingName, setSavingName] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({}); // displayName -> 编辑中的价格
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [addForm, setAddForm] = useState({
    modelId: '', displayName: '', type: 'image', providerId: '', creditCost: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ms, ps] = await Promise.all([apiGetModels(), apiGetProviders()]);
      const rows = ((ms as ModelRow[]) || []).filter((m) => m.enabled !== false);
      setGroups(groupModels(rows));
      setProviders(ps || []);
    } catch {
      /* 静默 */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const providerName = (pid?: string) => providers.find((p) => p.id === pid)?.name || pid || '—';

  const savePrice = async (name: string) => {
    const group = groups.find((g) => g.displayName === name);
    if (!group || group.items.length === 0) return;
    const v = Math.max(0, Math.floor(Number(draft[name]) ?? group.creditCost));
    setSavingName(name);
    try {
      let failed = 0;
      for (const m of group.items) {
        const r: any = await apiPatchModel(m.id, { creditCost: v });
        if (r && r.ok === false) failed += 1;
      }
      if (failed > 0) throw new Error(`${failed} 个实例保存失败`);
      setGroups((prev) => prev.map((g) => {
        if (g.displayName !== name) return g;
        return {
          ...g,
          creditCost: v,
          inconsistent: false,
          items: g.items.map((m) => ({ ...m, creditCost: v })),
        };
      }));
      setDraft((prev) => { const next = { ...prev }; delete next[name]; return next; });
    } catch (e: any) {
      alert('保存失败：' + (e?.message || e));
    } finally {
      setSavingName(null);
    }
  };

  const unlist = async (name: string) => {
    const group = groups.find((g) => g.displayName === name);
    if (!group || group.items.length === 0) return;
    const providerList = group.items.map((m) => providerName(m.providerId)).filter(Boolean).join('、') || '所有实例';
    if (!window.confirm(
      `确认下架「${name}」？\n\n将同时下架以下 ${group.items.length} 个服务商实例：${providerList}\n下架后价格记录会保留，再次添加时可沿用。`,
    )) return;
    try {
      let failed = 0;
      for (const m of group.items) {
        const r: any = await apiPatchModel(m.id, { enabled: false });
        if (r && r.ok === false) failed += 1;
      }
      if (failed > 0) throw new Error(`${failed} 个实例下架失败`);
      setGroups((prev) => prev.filter((g) => g.displayName !== name));
    } catch (e: any) {
      alert('下架失败：' + (e?.message || e));
    }
  };

  const submitAdd = async () => {
    const mid = addForm.modelId.trim();
    const name = addForm.displayName.trim();
    if (!mid || !name) { alert('请填写 model_id 与显示名称'); return; }
    let cost = Math.max(0, Math.floor(Number(addForm.creditCost) || 0));
    // 再添加时提醒是否沿用原来的价格
    try {
      const hist = await apiGetModelPriceHistory(mid);
      if (hist.found && hist.creditCost && hist.creditCost > 0) {
        const when = (hist.updatedAt || '').slice(0, 10);
        const ok = window.confirm(
          `检测到「${mid}」曾设置价格 ${hist.creditCost} 积分（${when}）。\n\n`
          + `确定 = 沿用原价 ${hist.creditCost} 积分\n`
          + `取消 = 使用当前填写的 ${cost || 0} 积分`,
        );
        if (ok) cost = hist.creditCost;
      }
    } catch { /* 历史查询失败不阻断添加 */ }
    const id = 'model-' + mid.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    setSubmitting(true);
    try {
      const payload = {
        id, modelId: mid, displayName: name, type: addForm.type,
        providerId: addForm.providerId || null, enabled: true, creditCost: cost,
      };
      // 单创建；若 id 已存在（后端 409）则取最新 revision 再 PATCH（沿用旧 upsert 语义）
      let res = await apiAddModel(payload);
      if (res && res.ok === false && /409/.test(res.error || '')) {
        const all = await apiGetModels();
        const ex = all.find((m) => m.id === id);
        res = await apiPatchModel(id, { ...payload, revision: ex ? ex.revision : 1 });
      }
      if (!res || res.ok === false) throw new Error((res && res.error) || '添加失败');
      setAddForm({ modelId: '', displayName: '', type: 'image', providerId: '', creditCost: '' });
      setShowAdd(false);
      await load();
    } catch (e: any) {
      alert('添加失败：' + (e?.message || e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="flex size-11 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
          <Cpu className="size-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">模型价格设置</h1>
          <p className="mt-1 text-sm text-zinc-500">
            全局价格管控：按对外名称（映射名）组合同名模型，统一价格；下架后自动隐藏；再次添加同名模型时若曾设过价格会提醒您是否沿用。
          </p>
        </div>
      </div>

      {/* 添加模型 */}
      <div className="mb-5">
        {!showAdd ? (
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 rounded-2xl border border-dashed border-zinc-700 px-4 py-3 text-sm text-zinc-300 hover:border-emerald-500/50 hover:text-emerald-300 transition-colors"
          >
            <Plus className="size-4" /> 添加模型
          </button>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-5">
            <div className="mb-3 text-sm font-medium text-zinc-200">添加模型</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">model_id（上游模型标识）</span>
                <input
                  value={addForm.modelId}
                  onChange={(e) => setAddForm({ ...addForm, modelId: e.target.value })}
                  placeholder="如 flux-1.1-pro"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">显示名称（对外映射名）</span>
                <input
                  value={addForm.displayName}
                  onChange={(e) => setAddForm({ ...addForm, displayName: e.target.value })}
                  placeholder="如 FLUX 1.1 Pro"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">类型标签</span>
                <select
                  value={addForm.type}
                  onChange={(e) => setAddForm({ ...addForm, type: e.target.value })}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                >
                  <option value="image">图像</option>
                  <option value="video">视频</option>
                  <option value="text">推理</option>
                  <option value="other">其他</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-zinc-500">服务商</span>
                <select
                  value={addForm.providerId}
                  onChange={(e) => setAddForm({ ...addForm, providerId: e.target.value })}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                >
                  <option value="">未选择</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>{p.name || p.id}</option>
                  ))}
                </select>
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs text-zinc-500">价格（消耗积分，留空为 0）</span>
                <input
                  value={addForm.creditCost}
                  onChange={(e) => setAddForm({ ...addForm, creditCost: e.target.value.replace(/[^0-9]/g, '') })}
                  placeholder="如 10"
                  inputMode="numeric"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-800/40 px-3 py-2 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <button
                onClick={submitAdd}
                disabled={submitting}
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-black hover:bg-emerald-400 disabled:opacity-50"
              >
                {submitting ? <Check className="size-4 animate-spin" /> : <Plus className="size-4" />}
                {submitting ? '添加中…' : '确认添加'}
              </button>
              <button
                onClick={() => { setShowAdd(false); setAddForm({ modelId: '', displayName: '', type: 'image', providerId: '', creditCost: '' }); }}
                className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="py-16 text-center text-sm text-zinc-500">加载中…</div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-zinc-800 py-16 text-center text-sm text-zinc-500">
          暂无在线模型。点击上方「添加模型」新增。
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => {
            const draftVal = draft[g.displayName] ?? g.creditCost;
            const dirty = (draft[g.displayName] !== undefined) && draftVal !== g.creditCost;
            const meta = typeMeta(g.type);
            return (
              <div
                key={g.displayName}
                className="flex items-center gap-4 rounded-2xl border border-white/10 bg-zinc-900/60 px-4 py-3"
              >
                <div className={`flex size-10 shrink-0 items-center justify-center rounded-xl border ${meta.border} ${meta.bg} ${meta.color}`}>
                  {meta.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-white">{g.displayName}</span>
                    <span className={`inline-flex items-center gap-1 rounded-md border ${meta.border} ${meta.bg} ${meta.color} px-1.5 py-0.5 text-[10px] font-medium`}>
                      {meta.icon}
                      {meta.label}
                    </span>
                    {g.inconsistent && (
                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300" title="组内同名模型价格不一致，保存后将统一">
                        <AlertCircle className="size-3" /> 价格不一致
                      </span>
                    )}
                  </div>
                  <div className="truncate text-xs text-zinc-500">
                    {g.modelId}
                    {g.items.length > 1 && (
                      <span className="ml-1 text-zinc-600">· {g.items.length} 个实例</span>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="flex flex-col items-end">
                    <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-800/40 px-2 py-1.5">
                      <input
                        type="number"
                        min={0}
                        value={draftVal}
                        onChange={(e) => setDraft({ ...draft, [g.displayName]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                        className="w-16 bg-transparent text-right text-sm text-white outline-none"
                      />
                      <span className="pl-1 text-xs text-zinc-500">积分</span>
                    </div>
                  </div>
                  <button
                    onClick={() => savePrice(g.displayName)}
                    disabled={!dirty && !g.inconsistent || savingName === g.displayName}
                    className="flex items-center gap-1 rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {savingName === g.displayName ? <Check className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    保存
                  </button>
                  <button
                    onClick={() => unlist(g.displayName)}
                    title="下架整组（从价格列表隐藏，价格记录保留）"
                    className="flex items-center gap-1 rounded-xl border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400 hover:border-red-500/50 hover:text-red-400"
                  >
                    <Trash2 className="size-3.5" /> 下架
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-6 flex items-start gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3 text-xs text-zinc-500">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
        <span>
          价格按对外名称（映射名）统一管理，同名模型会自动合并为一行；修改价格并保存会同步更新该名称下的所有服务商实例。下架操作会整组下架。
        </span>
      </div>
    </div>
  );
}
