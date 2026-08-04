import { useState, useEffect, type ReactNode } from 'react';
import {
  User, KeyRound, Wallet, ShieldCheck, Sparkles, Check, Loader2,
  Receipt, CreditCard, Smartphone,
} from 'lucide-react';
import { useAuth, refreshUser } from '@/services/authStore';
import { useMediaCounts } from '@/hooks/useMediaCounts';
import {
  apiUpdateProfile, apiChangePassword,
  apiMeSummary, apiMeTransactions, apiMeRecharges,
  type MeTx, type MeRecharge,
} from '@/services/api';

function Card({ icon: Icon, title, children, action }: { icon: any; title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-md">
      <div className="mb-5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
            <Icon className="size-4" />
          </div>
          <h2 className="text-sm font-semibold tracking-wide text-zinc-200">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

type Summary = { credits: number; totalRecharged: number; totalConsumed: number; monthConsumed: number; totalGranted: number };

export default function AccountPage() {
  const { user } = useAuth();
  const { counts } = useMediaCounts();

  // 账务概览 / 流水 / 订单
  const [summary, setSummary] = useState<Summary | null>(null);
  const [txns, setTxns] = useState<MeTx[]>([]);
  const [txTotal, setTxTotal] = useState(0);
  const [txOffset, setTxOffset] = useState(0);
  const [txLoading, setTxLoading] = useState(false);
  const [recharges, setRecharges] = useState<MeRecharge[]>([]);

  // 个人资料
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // 密码
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwSaving, setPwSaving] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  const dirty = displayName.trim() && displayName.trim() !== (user?.displayName || '');

  useEffect(() => {
    apiMeSummary().then(setSummary).catch(() => {});
    apiMeRecharges().then((r) => setRecharges(r.items)).catch(() => {});
  }, []);

  async function loadTx(reset = false) {
    setTxLoading(true);
    const off = reset ? 0 : txOffset;
    try {
      const r = await apiMeTransactions({ limit: 20, offset: off });
      setTxns((prev) => (reset ? r.items : [...prev, ...r.items]));
      setTxTotal(r.total);
      setTxOffset(off + r.items.length);
    } finally {
      setTxLoading(false);
    }
  }
  useEffect(() => { loadTx(true); }, []);

  async function saveProfile() {
    if (!dirty) return;
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      await apiUpdateProfile(displayName.trim());
      await refreshUser();
      setProfileMsg('昵称已更新');
    } catch (e: any) {
      setProfileMsg(e?.message || '更新失败');
    } finally {
      setProfileSaving(false);
    }
  }

  async function savePassword() {
    setPwErr(null);
    setPwMsg(null);
    if (newPw.length < 6) return setPwErr('新密码至少 6 位');
    if (newPw !== confirmPw) return setPwErr('两次输入的新密码不一致');
    setPwSaving(true);
    try {
      await apiChangePassword(oldPw, newPw);
      setPwMsg('密码已修改，下次登录生效');
      setOldPw(''); setNewPw(''); setConfirmPw('');
    } catch (e: any) {
      setPwErr(e?.message || '修改失败');
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-400 text-lg font-bold text-black">
            {(user?.displayName || user?.email || 'U')[0]?.toUpperCase() || 'U'}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">账户设置</h1>
            <p className="text-xs text-zinc-500">{user?.email}</p>
          </div>
        </div>

        <div className="grid gap-5">
          {/* 个人资料 */}
          <Card icon={User} title="个人资料">
            <div className="space-y-4">
              <div>
                <label className="mb-1.5 block text-xs text-zinc-500">昵称</label>
                <div className="flex gap-2">
                  <input
                    value={displayName}
                    onChange={(e) => { setDisplayName(e.target.value); setProfileMsg(null); }}
                    className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                    placeholder="你的昵称"
                  />
                  <button
                    onClick={saveProfile}
                    disabled={!dirty || profileSaving}
                    className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-4 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:opacity-40"
                  >
                    {profileSaving ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                    保存
                  </button>
                </div>
              </div>
              {profileMsg && <p className="text-xs text-emerald-400">{profileMsg}</p>}
            </div>
          </Card>

          {/* 安全 */}
          <Card icon={KeyRound} title="安全 · 修改密码">
            <div className="space-y-3">
              <input
                type="password"
                value={oldPw}
                onChange={(e) => { setOldPw(e.target.value); setPwErr(null); }}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                placeholder="当前密码"
              />
              <div className="flex gap-2">
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => { setNewPw(e.target.value); setPwErr(null); }}
                  className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  placeholder="新密码（至少 6 位）"
                />
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => { setConfirmPw(e.target.value); setPwErr(null); }}
                  className="flex-1 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                  placeholder="确认新密码"
                />
              </div>
              {pwErr && <p className="text-xs text-red-400">{pwErr}</p>}
              {pwMsg && <p className="text-xs text-emerald-400">{pwMsg}</p>}
              <button
                onClick={savePassword}
                disabled={pwSaving}
                className="flex items-center gap-1.5 rounded-xl bg-zinc-100 px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-white disabled:opacity-40"
              >
                {pwSaving ? <Loader2 className="size-3.5 animate-spin" /> : <KeyRound className="size-3.5" />}
                更新密码
              </button>
            </div>
          </Card>

          {/* 用量概览 */}
          <Card icon={Wallet} title="用量概览">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="剩余积分" value={user?.credits ?? 0} accent />
              <Stat label="图片" value={counts?.image ?? 0} />
              <Stat label="视频" value={counts?.video ?? 0} />
              <Stat label="角色" value={counts?.character ?? 0} />
            </div>
            {summary && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
                <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-300">累计充值 {summary.totalRecharged}</span>
                <span className="rounded-full bg-red-500/10 px-3 py-1 text-red-300">累计消费 {summary.totalConsumed}</span>
                <span className="rounded-full bg-zinc-800/60 px-3 py-1 text-zinc-300">本月消费 {summary.monthConsumed}</span>
              </div>
            )}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="flex items-center gap-1.5 rounded-full bg-zinc-800/60 px-3 py-1 text-zinc-300">
                <ShieldCheck className="size-3.5 text-emerald-400" />
                角色：{user?.role === 'admin' ? '管理员' : '普通用户'}
              </span>
              <span className="flex items-center gap-1.5 rounded-full bg-zinc-800/60 px-3 py-1 text-zinc-300">
                <Sparkles className="size-3.5 text-amber-400" />
                套餐：{user?.plan || 'free'}
              </span>
            </div>
          </Card>

          {/* 积分流水 */}
          <Card icon={Receipt} title="积分流水" action={<span className="text-xs text-zinc-500">共 {txTotal} 笔</span>}>
            {txns.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">暂无流水记录</p>
            ) : (
              <div className="space-y-1">
                {txns.map((t) => {
                  const b = txBadge(t.kind);
                  const negative = t.kind === 'reserve' || t.kind === 'commit' || (t.kind === 'adjust' && t.amount < 0);
                  return (
                    <div key={t.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/5">
                      <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg text-xs font-semibold ${b.cls}`}>{b.short}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-zinc-200">{b.label}</div>
                        <div className="truncate text-[11px] text-zinc-500">
                          {formatTime(t.createdAt)}{t.ref ? ` · ${t.ref}` : ''}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className={`text-sm font-semibold tabular-nums ${negative ? 'text-red-400' : 'text-emerald-400'}`}>
                          {txSign(t)}{Math.abs(t.amount)}
                        </div>
                        <div className="text-[11px] text-zinc-500">余 {t.balanceAfter ?? '—'}</div>
                      </div>
                    </div>
                  );
                })}
                {txOffset < txTotal && (
                  <button
                    onClick={() => loadTx(false)}
                    disabled={txLoading}
                    className="mt-2 w-full rounded-xl border border-zinc-800 py-2 text-xs text-zinc-400 transition-colors hover:bg-white/5 disabled:opacity-50"
                  >
                    {txLoading ? '加载中…' : '加载更多'}
                  </button>
                )}
              </div>
            )}
          </Card>

          {/* 充值订单 */}
          <Card icon={Wallet} title="充值订单" action={<span className="text-xs text-zinc-500">{recharges.length} 笔</span>}>
            {recharges.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">暂无充值订单</p>
            ) : (
              <div className="space-y-1">
                {recharges.map((o) => {
                  const s = rechargeStatus(o.status);
                  return (
                    <div key={o.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/5">
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
                        {o.channel === 'alipay' ? <CreditCard className="size-4" /> : <Smartphone className="size-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-zinc-200">¥{o.amount} · {o.channel === 'alipay' ? '支付宝' : '微信'}</div>
                        <div className="truncate text-[11px] text-zinc-500">{formatTime(o.createdAt)}</div>
                      </div>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-center">
      <div className={`text-2xl font-bold ${accent ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
      <div className="mt-1 text-xs text-zinc-500">{label}</div>
    </div>
  );
}

function txBadge(kind: string) {
  switch (kind) {
    case 'reserve': return { label: '积分预扣', short: '预', cls: 'bg-red-500/10 text-red-400' };
    case 'commit': return { label: '积分消费', short: '消', cls: 'bg-red-500/10 text-red-400' };
    case 'release': return { label: '失败回退', short: '退', cls: 'bg-emerald-500/10 text-emerald-400' };
    case 'grant': return { label: '充值到账', short: '充', cls: 'bg-emerald-500/10 text-emerald-400' };
    case 'adjust': return { label: '手动调整', short: '调', cls: 'bg-amber-500/10 text-amber-400' };
    default: return { label: kind, short: '?', cls: 'bg-zinc-700/40 text-zinc-300' };
  }
}
function txSign(t: MeTx) {
  if (t.kind === 'grant' || t.kind === 'release') return '+';
  if (t.kind === 'adjust') return t.amount >= 0 ? '+' : '−';
  return '−';
}
function rechargeStatus(status: string) {
  switch (status) {
    case 'paid': return { label: '已支付', cls: 'bg-emerald-400/10 text-emerald-400' };
    case 'pending': return { label: '待支付', cls: 'bg-amber-400/10 text-amber-400' };
    case 'failed': return { label: '失败', cls: 'bg-red-400/10 text-red-400' };
    default: return { label: status, cls: 'bg-zinc-700/40 text-zinc-300' };
  }
}
function formatTime(s: string) {
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}
