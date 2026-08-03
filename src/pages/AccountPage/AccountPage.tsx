import { useState } from 'react';
import { User, KeyRound, Wallet, ShieldCheck, Sparkles, Check, Loader2 } from 'lucide-react';
import { useAuth, refreshUser } from '@/services/authStore';
import { useMediaCounts } from '@/hooks/useMediaCounts';
import { apiUpdateProfile, apiChangePassword } from '@/services/api';

function Card({ icon: Icon, title, children }: { icon: any; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900/40 p-6 backdrop-blur-md">
      <div className="mb-5 flex items-center gap-2.5">
        <div className="flex size-8 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400">
          <Icon className="size-4" />
        </div>
        <h2 className="text-sm font-semibold tracking-wide text-zinc-200">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export default function AccountPage() {
  const { user } = useAuth();
  const { counts } = useMediaCounts();

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
