// 后台「系统设置」：平台级配置聚合。
// 当前承载「工作台模型下拉排序方式」，供 GenerationBar 渲染模型下拉时读取，
// 让用户/运营按需切换排序逻辑（手动权重 / 名称 / 积分），无需改代码。
//
// 存储：settings 表 key='app' 的 value JSON 中的 workspaceModelSort 字段；
// 后端 PUT /api/settings 已做合并写入（局部保存不会覆盖后台其它配置）。
import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { Settings2, Save, Loader2, ArrowDownWideNarrow } from 'lucide-react';
import { apiGetSettings, apiSaveSettings } from '@/services/api';
import type { ModelSortMode } from '@/utils/groupModels';

/** 工作台模型下拉的排序选项（与 groupModels.ts 的 ModelSortMode 对应） */
const SORT_OPTIONS: { value: ModelSortMode; label: string; desc: string }[] = [
  { value: 'manual', label: '手动排序', desc: '按后台「模型价格」页设置的排序权重（sort_order）排列，最精确、可逐模型微调' },
  { value: 'name', label: '按名称', desc: '按模型展示名的中文拼音 / 字母顺序排序' },
  { value: 'credits', label: '按积分', desc: '按消耗积分数升序排列，便宜的模型排在前面' },
];

const cn = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

function normalizeSort(v: unknown): ModelSortMode {
  return v === 'name' || v === 'credits' ? v : 'manual';
}

export default function SystemSettingsPage() {
  const [sortMode, setSortMode] = useState<ModelSortMode>('manual');
  const [loaded, setLoaded] = useState<ModelSortMode>('manual');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = (await apiGetSettings().catch(() => ({}))) || {};
        if (!cancelled) {
          const m = normalizeSort(s.workspaceModelSort);
          setSortMode(m);
          setLoaded(m);
        }
      } catch {
        // 读不到配置不阻断，回退默认 manual
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dirty = sortMode !== loaded;

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const cur = (await apiGetSettings().catch(() => ({}))) || {};
      await apiSaveSettings({ ...cur, workspaceModelSort: sortMode });
      setLoaded(sortMode);
      toast.success('已保存系统设置');
    } catch (e) {
      toast.error('保存失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  }, [sortMode]);

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      {/* 页头 */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800/70">
          <Settings2 className="h-5 w-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">系统设置</h1>
          <p className="text-xs text-zinc-500">平台级配置聚合，影响前台工作台与生成体验。</p>
        </div>
      </div>

      {/* 工作台模型排序 */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5">
        <div className="mb-1 flex items-center gap-2">
          <ArrowDownWideNarrow className="h-4 w-4 text-emerald-400" />
          <h2 className="text-sm font-medium text-zinc-100">工作台模型排序</h2>
        </div>
        <p className="mb-4 text-xs text-zinc-500">
          控制工作台底部生成栏「模型」下拉里，各模型的排列顺序。
        </p>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-xs text-zinc-500">
            <Loader2 className="h-4 w-4 animate-spin" /> 正在加载配置…
          </div>
        ) : (
          <div className="space-y-2">
            {SORT_OPTIONS.map((opt) => {
              const active = sortMode === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSortMode(opt.value)}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-xl border px-3.5 py-3 text-left transition-all duration-200',
                    active
                      ? 'border-emerald-500/60 bg-emerald-500/10'
                      : 'border-zinc-800 bg-zinc-900/40 hover:border-zinc-700 hover:bg-zinc-800/40'
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                      active ? 'border-emerald-400' : 'border-zinc-600'
                    )}
                  >
                    {active && <span className="h-2 w-2 rounded-full bg-emerald-400" />}
                  </span>
                  <span className="flex-1">
                    <span className={cn('block text-sm', active ? 'text-emerald-300 font-medium' : 'text-zinc-200')}>
                      {opt.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-500">{opt.desc}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* 保存栏 */}
        <div className="mt-5 flex items-center justify-between border-t border-zinc-800 pt-4">
          <span className="text-xs text-zinc-500">
            {dirty ? '有未保存的修改' : '已保存'}
          </span>
          <button
            type="button"
            disabled={loading || saving || !dirty}
            onClick={handleSave}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all duration-200',
              loading || saving || !dirty
                ? 'cursor-not-allowed bg-zinc-800 text-zinc-500'
                : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
            )}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存设置
          </button>
        </div>
      </section>
    </div>
  );
}
