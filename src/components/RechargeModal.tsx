import { useState, useEffect } from 'react';
import { Wallet, Check, Loader2, X, AlertCircle, CreditCard, Smartphone } from 'lucide-react';
import { useAuth, refreshUser, setAuthModalOpen } from '@/services/authStore';
import {
  apiCreateRechargeOrder,
  apiRechargeCallback,
  apiPublicTopupPackages,
  type RechargeOrder,
  type TopupPackage,
} from '@/services/api';

const PRESETS = [6, 30, 98, 198, 648];
type Step = 'form' | 'paying' | 'success' | 'error';

export default function RechargeModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user } = useAuth();
  const [amount, setAmount] = useState<number>(98);
  const [custom, setCustom] = useState('');
  const [channel, setChannel] = useState<'wechat' | 'alipay'>('wechat');
  const [step, setStep] = useState<Step>('form');
  const [order, setOrder] = useState<RechargeOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [packages, setPackages] = useState<TopupPackage[]>([]);

  // 充值套餐后管可配置：优先拉后端套餐，未配置时回退内置预设
  useEffect(() => {
    apiPublicTopupPackages().then((r) => setPackages(r.items)).catch(() => {});
  }, []);

  if (!open) return null;

  const finalAmount = custom ? Math.floor(Number(custom)) : amount;
  const valid = Number.isFinite(finalAmount) && finalAmount > 0 && finalAmount <= 100000;

  function reset() {
    setStep('form');
    setOrder(null);
    setMsg('');
    setCustom('');
  }
  function close() {
    onClose();
    setTimeout(reset, 200);
  }

  async function create() {
    if (!user) {
      setAuthModalOpen(true);
      return;
    }
    if (!valid) {
      setStep('error');
      setMsg('请输入有效的充值金额（1 – 100000）');
      return;
    }
    setBusy(true);
    setMsg('');
    const r = await apiCreateRechargeOrder({ amount: finalAmount, channel });
    setBusy(false);
    if (r.ok && r.order) {
      setOrder(r.order);
      setStep('paying');
    } else {
      setStep('error');
      setMsg(r.error || '创建订单失败');
    }
  }

  async function pay() {
    if (!order) return;
    setBusy(true);
    const r = await apiRechargeCallback({ channel: order.channel, payOrderNo: order.payOrderNo });
    setBusy(false);
    if (r.ok) {
      await refreshUser().catch(() => {});
      setStep('success');
      setTimeout(() => close(), 1600);
    } else {
      setStep('error');
      setMsg(r.error || '支付失败');
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={close} />
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900/95 p-6 shadow-2xl">
        <div className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-emerald-500/15 blur-3xl" />
        {/* header */}
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
              <Wallet className="size-4" />
            </span>
            <h2 className="text-lg font-semibold text-white">充值积分</h2>
          </div>
          <button
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>
        <p className="relative mt-1 text-xs text-zinc-500">1 元 = 1 积分 · 当前为 DEV 模拟支付</p>

        <div className="relative mt-5">
          {step === 'form' && (
            <div className="space-y-5">
              <div>
                <div className="mb-2 text-sm text-zinc-400">选择套餐</div>
                <div className="grid grid-cols-3 gap-2">
                  {(packages.length
                    ? packages
                    : PRESETS.map((p) => ({ id: `p${p}`, price: p, credits: p, bonus: 0, name: '' }))
                  ).map((pkg) => {
                    const active = !custom && amount === pkg.price;
                    const totalCredits = pkg.credits + (pkg.bonus || 0);
                    return (
                      <button
                        key={pkg.id}
                        onClick={() => { setAmount(pkg.price); setCustom(''); }}
                        className={`flex flex-col items-center rounded-2xl border px-2 py-2.5 text-sm font-semibold transition-all ${
                          active
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                            : 'border-zinc-800 bg-zinc-800/40 text-zinc-300 hover:border-zinc-700'
                        }`}
                      >
                        <span>¥{pkg.price}</span>
                        <span className={`mt-0.5 text-[10px] font-normal ${pkg.bonus > 0 ? 'text-amber-300' : 'text-zinc-500'}`}>
                          {totalCredits} 积分
                        </span>
                      </button>
                    );
                  })}
                </div>
                <input
                  value={custom}
                  inputMode="numeric"
                  onChange={(e) => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="自定义金额（元）"
                  className="mt-2 w-full rounded-2xl border border-zinc-800 bg-zinc-800/40 px-4 py-2.5 text-sm text-white placeholder-zinc-600 outline-none focus:border-emerald-500/50"
                />
              </div>

              <div>
                <div className="mb-2 text-sm text-zinc-400">支付方式</div>
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { key: 'wechat', label: '微信支付', icon: Smartphone },
                    { key: 'alipay', label: '支付宝', icon: CreditCard },
                  ] as const).map((c) => {
                    const Icon = c.icon;
                    const active = channel === c.key;
                    return (
                      <button
                        key={c.key}
                        onClick={() => setChannel(c.key)}
                        className={`flex items-center gap-2 rounded-2xl border px-3 py-3 text-sm font-medium transition-all ${
                          active
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-white'
                            : 'border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:border-zinc-700'
                        }`}
                      >
                        <Icon className={`size-4 ${active ? 'text-emerald-400' : ''}`} />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <button
                onClick={create}
                disabled={!user || !valid || busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 py-3 text-sm font-bold text-zinc-900 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                {user ? `创建订单并支付 ¥${valid ? finalAmount : 0}` : '请先登录后充值'}
              </button>
            </div>
          )}

          {step === 'paying' && order && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-emerald-500/15 text-emerald-400">
                {channel === 'alipay' ? <CreditCard className="size-7" /> : <Smartphone className="size-7" />}
              </div>
              <div>
                <div className="text-3xl font-extrabold text-white">¥{order.amount}</div>
                <div className="mt-1 text-xs text-zinc-500">订单号 {order.payOrderNo}</div>
              </div>
              <button
                onClick={pay}
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-cyan-500 py-3 text-sm font-bold text-zinc-900 transition-transform hover:scale-[1.01] disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                模拟支付成功
              </button>
              <button onClick={close} className="text-xs text-zinc-500 hover:text-zinc-300">
                取消
              </button>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center space-y-3 py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400 animate-[pop_0.4s_ease-out]">
                <Check className="size-8" />
              </div>
              <div className="text-lg font-semibold text-white">充值成功</div>
              <div className="text-sm text-zinc-400">积分已到账，正在刷新…</div>
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15 text-red-400">
                <AlertCircle className="size-7" />
              </div>
              <div className="text-sm text-zinc-300">{msg || '出错了'}</div>
              <button
                onClick={() => setStep('form')}
                className="w-full rounded-2xl bg-zinc-800 py-3 text-sm font-semibold text-white hover:bg-zinc-700"
              >
                重试
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes pop{0%{transform:scale(0)}60%{transform:scale(1.15)}100%{transform:scale(1)}}`}</style>
    </div>
  );
}
