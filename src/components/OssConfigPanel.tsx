// 多槽位 OSS 配置面板
//
// 替代之前在 ModelHubPage 内嵌的简单 OSS 配置块。新设计：
//   • 顶部：总开关 + Active 槽位条
//   • 槽位列表：每个槽位一张卡片，含 provider-type 徽章、bucket、region、关键动作（test/activate/edit/delete）
//   • 新增：+ 阿里云 OSS / + 腾讯云 COS 两个按钮
//   • 编辑：抽屉或行内展开（行内更紧凑）
//
// 数据由 useOssConfig 暴露：enabled/active/configs/动作。
import { useEffect, useMemo, useState } from 'react';
import { HardDriveUpload, Server, Plus, Pencil, Trash2, Check, X, Loader2, Key, Globe, FolderOpen, Settings2, Link2, Eye, EyeOff, Database, Tag, ChevronDown } from 'lucide-react';
import { useOssConfig } from '@/hooks/useOssConfig';
import { type IOssConfig, type OssProviderType, DEFAULT_OSS_SLOT } from '@/data/oss';

interface IOssLog {
  id: string;
  level: 'success' | 'error' | 'info';
  action: string;
  message: string;
  timestamp: number;
}

const PROVIDER_META: Record<OssProviderType, { label: string; color: string; ring: string; bg: string }> = {
  'aliyun-oss': { label: '阿里云 OSS', color: 'text-orange-300', ring: 'ring-orange-500/30', bg: 'bg-gradient-to-br from-orange-500/15 to-amber-500/10' },
  'tencent-cos': { label: '腾讯云 COS', color: 'text-sky-300',   ring: 'ring-sky-500/30',     bg: 'bg-gradient-to-br from-sky-500/15 to-cyan-500/10' },
};

const PROVIDER_PRESETS: Record<OssProviderType, { region: string; regionLabel: string; endpointExternal: string }> = {
  'aliyun-oss': { region: 'cn-shanghai', regionLabel: '华东2（上海）', endpointExternal: 'oss-cn-shanghai.aliyuncs.com' },
  'tencent-cos': { region: 'ap-shanghai', regionLabel: '上海', endpointExternal: 'cos.ap-shanghai.myqcloud.com' },
};

function genId() {
  return `oss-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function OssConfigPanel() {
  const { enabled, active, configs, setEnabled, reload, createSlot, updateSlot, deleteSlot, activateSlot, testSlot } = useOssConfig();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, any>>({});
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string }>>({});
  const [logs, setLogs] = useState<IOssLog[]>([]);
  const [creatingType, setCreatingType] = useState<OssProviderType | null>(null);

  // 默认编辑项 = active 槽位；若没有就空
  useEffect(() => {
    if (editingId == null && active) setEditingId(active.id);
  }, [active?.id]);

  const editing = useMemo(() => configs.find(c => c.id === editingId) || null, [editingId, configs]);

  function addLog(level: IOssLog['level'], action: string, message: string) {
    setLogs((prev) => [{ id: `log-${Date.now()}-${Math.random()}`, level, action, message, timestamp: Date.now() }, ...prev].slice(0, 30));
  }

  async function handleAdd(providerType: OssProviderType) {
    const preset = PROVIDER_PRESETS[providerType];
    const slot: Partial<IOssConfig> = {
      id: genId(),
      providerType,
      displayName: `新${PROVIDER_META[providerType].label}账号`,
      ...preset,
      bucket: '',
      appId: '',
      accessKeyId: '',
      accessKeySecret: '',
      pathPrefix: DEFAULT_OSS_SLOT.pathPrefix,
      customDomain: '',
      enabled: true,
    };
    const ok = await createSlot(slot);
    if (ok && ok.id) {
      addLog('success', 'create', `已创建 ${PROVIDER_META[providerType].label} 槽位 ${ok.id}`);
      setEditingId(ok.id);
      setDraft(ok);
    } else {
      addLog('error', 'create', `创建失败：${ok?.error || '未知错误'}`);
    }
  }

  function handleEdit(id: string) {
    const slot = configs.find(c => c.id === id);
    if (!slot) return;
    setEditingId(id);
    setDraft({ ...slot });
  }

  async function handleSave() {
    if (!editingId) return;
    setSavingId(editingId);
    const ok = await updateSlot(editingId, draft);
    setSavingId(null);
    if (ok) {
      addLog('success', 'save', `保存槽位 ${editingId} 成功`);
    } else {
      addLog('error', 'save', `保存失败：${editingId}`);
    }
  }

  async function handleDelete(id: string) {
    if (configs.length <= 1) {
      addLog('error', 'delete', '至少保留一个槽位');
      return;
    }
    if (!confirm('删除该 OSS 槽位？删除后无法恢复。')) return;
    const ok = await deleteSlot(id);
    if (ok) {
      addLog('success', 'delete', `已删除 ${id}`);
      if (editingId === id) setEditingId(active?.id || configs[0]?.id || null);
    }
  }

  async function handleActivate(id: string) {
    const ok = await activateSlot(id);
    if (ok) addLog('success', 'activate', `已切换 active → ${id}`);
  }

  async function handleTest(id: string) {
    setTestingId(id);
    addLog('info', 'test', `测试连接：${id}`);
    const r = await testSlot(id);
    setTestingId(null);
    setTestResults((prev) => ({ ...prev, [id]: r }));
    if (r.success) addLog('success', 'test', `连接成功：${r.message}`);
    else addLog('error', 'test', r.message);
  }

  function updateDraft(key: string, value: any) {
    setDraft((p) => ({ ...p, [key]: value }));
  }

  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-5">
      {/* 头部：标题 + 总开关 */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400">
          <Database className="size-5" />
        </div>
        <div className="flex-1">
          <h2 className="text-sm font-bold text-white">对象存储（OSS）</h2>
          <p className="text-xs text-zinc-500">配置多个云存储账号，活跃账号用于所有上传</p>
        </div>
        <span className={`text-xs font-semibold ${enabled ? 'text-emerald-400' : 'text-zinc-500'}`}>{enabled ? '总开关：开' : '总开关：关'}</span>
        <button
          onClick={() => setEnabled(!enabled)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-all ${enabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
          aria-label="OSS 总开关"
        >
          <div className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>

      {/* Active 槽位条 */}
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-4">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300 ring-1 ring-emerald-500/30">Active</span>
          {active ? (
            <span className="text-sm font-semibold text-white truncate">{active.displayName || active.bucket}</span>
          ) : (
            <span className="text-sm text-zinc-400">尚未设置活跃账号，所有上传将失败</span>
          )}
          {active && (
            <span className={`shrink-0 ml-auto inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${PROVIDER_META[active.providerType].bg} ${PROVIDER_META[active.providerType].color} ${PROVIDER_META[active.providerType].ring}`}>
              {PROVIDER_META[active.providerType].label}
            </span>
          )}
        </div>
        {active && (
          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-zinc-400">
            <div className="flex items-center gap-1.5"><FolderOpen className="size-3 opacity-60" /><span className="font-mono truncate">{active.bucket}</span></div>
            <div className="flex items-center gap-1.5"><Globe className="size-3 opacity-60" /><span>{active.regionLabel || active.region}</span></div>
            {active.providerType === 'tencent-cos' && active.appId && (
              <div className="flex items-center gap-1.5 col-span-2"><Tag className="size-3 opacity-60" />AppId: <span className="font-mono">{active.appId}</span></div>
            )}
          </div>
        )}
      </div>

      {/* 槽位列表 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">所有账号 ({configs.length})</h3>
          <button onClick={() => reload()} className="text-[10px] text-zinc-500 hover:text-white transition-colors">↻ 刷新</button>
        </div>
        <div className="space-y-1.5">
          {configs.map((c) => {
            const meta = PROVIDER_META[c.providerType];
            const isActive = c.id === active?.id;
            const testR = testResults[c.id];
            return (
              <div key={c.id} className={`group flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-all ${isActive ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-950/40 hover:border-zinc-700'}`}>
                <span className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${meta.bg} ${meta.color} ${meta.ring}`}>
                  {meta.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-white">{c.displayName || c.bucket || c.id}</span>
                    {!c.enabled && <span className="shrink-0 rounded-md bg-zinc-800 px-1.5 py-0.5 text-[9px] font-semibold text-zinc-500">已停用</span>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
                    {c.bucket && <span className="font-mono">{c.bucket}</span>}
                    {c.bucket && <span>·</span>}
                    <span>{c.regionLabel || c.region}</span>
                    {testR && <><span>·</span><span className={testR.success ? 'text-emerald-400' : 'text-red-400'}>{testR.success ? '✓ ' : '✗ '}{testR.message.slice(0, 30)}</span></>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  <button
                    onClick={() => handleTest(c.id)}
                    disabled={testingId === c.id}
                    className="rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50 inline-flex items-center gap-1"
                  >
                    {testingId === c.id ? <Loader2 className="size-3 animate-spin" /> : <span>测试</span>}
                  </button>
                  <button
                    onClick={() => handleEdit(c.id)}
                    className="rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors inline-flex items-center gap-1"
                  >
                    <Pencil className="size-3" />编辑
                  </button>
                  {!isActive && (
                    <button
                      onClick={() => handleActivate(c.id)}
                      className="rounded-lg bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300 hover:bg-emerald-500/25 hover:text-emerald-200 transition-colors inline-flex items-center gap-1"
                    >
                      <Check className="size-3" />设为活跃
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="rounded-lg bg-red-500/10 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/20 hover:text-red-200 transition-colors inline-flex items-center gap-1"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* 新增账号 */}
        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={() => handleAdd('aliyun-oss')}
            className="group flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 py-3 text-xs font-semibold text-orange-300 hover:border-orange-500/40 hover:bg-orange-500/5 transition-all"
          >
            <HardDriveUpload className="size-4" />
            新增阿里云 OSS
          </button>
          <button
            onClick={() => handleAdd('tencent-cos')}
            className="group flex items-center justify-center gap-2 rounded-2xl border border-dashed border-zinc-700 bg-zinc-900/30 py-3 text-xs font-semibold text-sky-300 hover:border-sky-500/40 hover:bg-sky-500/5 transition-all"
          >
            <Server className="size-4" />
            新增腾讯云 COS
          </button>
        </div>
      </div>

      {/* 编辑表单（抽屉风格的内嵌面板） */}
      {editing && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/80">
            <span className={`shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold ring-1 ${PROVIDER_META[editing.providerType].bg} ${PROVIDER_META[editing.providerType].color} ${PROVIDER_META[editing.providerType].ring}`}>
              {PROVIDER_META[editing.providerType].label}
            </span>
            <input
              value={draft.displayName || ''}
              onChange={(e) => updateDraft('displayName', e.target.value)}
              placeholder="账号别名，便于辨识"
              className="min-w-0 flex-1 rounded-xl bg-zinc-900/60 px-3 py-1.5 text-sm text-white placeholder:text-zinc-600 border border-zinc-800 focus:outline-none focus:border-emerald-500/50"
            />
            <button
              onClick={() => setShowSecret((p) => ({ ...p, [editingId!]: !p[editingId!] }))}
              className="shrink-0 rounded-lg bg-zinc-800 px-2 py-1 text-[10px] text-zinc-400 hover:text-white transition-colors"
              title={showSecret[editingId!] ? '隐藏 Secret' : '显示 Secret'}
            >
              {showSecret[editingId!] ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
              Secret
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldText label="Bucket" placeholder="my-bucket-name" value={draft.bucket || ''} onChange={(v) => updateDraft('bucket', v)} mono />
            <FieldText label={editing.providerType === 'tencent-cos' ? 'AppId' : '区域（可读名）'} placeholder={editing.providerType === 'tencent-cos' ? '1300000000' : '华东2（上海）'} value={editing.providerType === 'tencent-cos' ? (draft.appId || '') : (draft.regionLabel || '')} onChange={(v) => updateDraft(editing.providerType === 'tencent-cos' ? 'appId' : 'regionLabel', v)} mono={editing.providerType === 'tencent-cos'} />
            <FieldText label="Region" placeholder={editing.providerType === 'tencent-cos' ? 'ap-shanghai' : 'cn-shanghai'} value={draft.region || ''} onChange={(v) => updateDraft('region', v)} mono />
            <FieldText label="外网 Endpoint" placeholder={editing.providerType === 'tencent-cos' ? 'cos.ap-shanghai.myqcloud.com' : 'oss-cn-shanghai.aliyuncs.com'} value={draft.endpointExternal || ''} onChange={(v) => updateDraft('endpointExternal', v)} mono />
          </div>

          <div className="space-y-3">
            <FieldSecret label={editing.providerType === 'tencent-cos' ? 'SecretId' : 'AccessKey ID'} value={draft.accessKeyId || ''} onChange={(v) => updateDraft('accessKeyId', v)} visible={!!showSecret[editingId!]} />
            <FieldSecret label={editing.providerType === 'tencent-cos' ? 'SecretKey' : 'AccessKey Secret'} value={draft.accessKeySecret || ''} onChange={(v) => updateDraft('accessKeySecret', v)} visible={!!showSecret[editingId!]} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldText label="存储路径前缀" placeholder="images/" value={draft.pathPrefix || ''} onChange={(v) => updateDraft('pathPrefix', v)} mono />
            <FieldText label="自定义 CDN 域名" placeholder="cdn.example.com" value={draft.customDomain || ''} onChange={(v) => updateDraft('customDomain', v)} mono />
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/80">
            <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enabled !== false}
                onChange={(e) => updateDraft('enabled', e.target.checked)}
                className="size-3.5 rounded border-zinc-700 bg-zinc-800 text-emerald-500 focus:ring-emerald-500/30"
              />
              启用此账号
            </label>
            <div className="flex-1" />
            <button
              onClick={() => handleTest(editing.id)}
              disabled={testingId === editing.id}
              className="rounded-xl bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200 hover:bg-zinc-700 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {testingId === editing.id ? <Loader2 className="size-3 animate-spin" /> : <span>测试连接</span>}
            </button>
            <button
              onClick={handleSave}
              disabled={savingId === editing.id}
              className="rounded-xl bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/25 transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              {savingId === editing.id ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}保存
            </button>
          </div>
          {testResults[editing.id] && (
            <div className={`rounded-xl border px-3 py-2 text-xs ${testResults[editing.id].success ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300' : 'border-red-500/30 bg-red-500/5 text-red-300'}`}>
              {testResults[editing.id].message}
            </div>
          )}
        </div>
      )}

      {/* 操作日志 */}
      {logs.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">操作日志</h3>
            <button onClick={() => setLogs([])} className="text-[10px] text-zinc-500 hover:text-white transition-colors">清空</button>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-zinc-950/60 p-2">
            {logs.map((log) => {
              const time = new Date(log.timestamp).toLocaleTimeString('zh-CN', { hour12: false });
              const color = log.level === 'success' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                : log.level === 'error' ? 'text-red-400 bg-red-500/10 border-red-500/20'
                : 'text-blue-400 bg-blue-500/10 border-blue-500/20';
              const actionLabel = ({ create: '新增', test: '测试', save: '保存', delete: '删除', activate: '切活' } as any)[log.action] || log.action;
              return (
                <div key={log.id} className={`flex items-start gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${color}`}>
                  <span className="shrink-0 font-mono text-[10px] opacity-70">{time}</span>
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold bg-black/30">{actionLabel}</span>
                  <span className="flex-1 break-all">{log.message}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 小组件 ──────────────────────────────────────────────
function FieldText({ label, value, onChange, placeholder, mono = false }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-xl bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors ${mono ? 'font-mono text-xs' : ''}`}
      />
    </div>
  );
}
function FieldSecret({ label, value, onChange, visible }: { label: string; value: string; onChange: (v: string) => void; visible: boolean }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-zinc-400">{label}</label>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="••••••"
        className="w-full rounded-xl bg-zinc-800/50 px-3 py-2 text-sm text-white placeholder:text-zinc-600 border border-zinc-700 focus:outline-none focus:border-emerald-500/50 transition-colors font-mono"
      />
    </div>
  );
}
