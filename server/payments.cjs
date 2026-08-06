// server/payments.cjs — 充值订单 + 真实支付通道适配器（CommonJS）
// 安全铁律：绝不存在任何 DEV / 模拟入账路径。
//   · 创建订单只落库 pending + 签名（完整性标记），并交由真实通道生成 payUrl；
//   · 无配置通道一律 503，绝不回退 DEV 模拟；
//   · 真实入账只走 /api/credits/webhook/:type（验签→金额→状态守卫→幂等表），fails closed。
const crypto = require('crypto');
const { createLoader } = require('./payments/loader.cjs');
const { createWebhook } = require('./payments/webhook.cjs');

// 订单签名密钥：仅用于本地订单完整性标记，绝不构成入账凭证（入账必须过 webhook 验签）。
const SIGN_SECRET = process.env.PAYMENT_MASTER_KEY || process.env.PAYMENT_SIGN_SECRET || '';

function hmac(secret, msg) {
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

const payments = {
  createPayments(ctx) {
    const { getPg, session, sendJSON, parseBody } = ctx;

    // 通道加载器（fail closed：缺密钥/未配均返回 null）
    const loader = createLoader({ getPg });
    // 真实入账 worker（公开路由，鉴权网关前分发）
    const { handleWebhook } = createWebhook({ getPg, loader, sendJSON });

    async function requireUser(req, res) {
      const u = session.getUserFromCookie(req);
      if (!u) { sendJSON(res, 401, { error: '请先登录' }); return null; }
      return u;
    }

    // POST /api/credits/orders — 创建充值订单（真实支付通道；无通道一律 503，无模拟回退）
    async function loadPaymentSettings() {
      const pg = getPg();
      const def = { enabled: true, defaultExpiresMin: 15, minAmount: 1, maxAmount: 10000000, dailyLimit: 10000000, maxOpenOrders: 5 };
      if (!pg) return def;
      try {
        const r = await pg.query(
          'SELECT enabled, default_expires_min, min_amount, max_amount, daily_limit, max_open_orders FROM payment_settings WHERE id=1');
        if (!r.rows.length) return def;
        const x = r.rows[0];
        return {
          enabled: x.enabled !== false,
          defaultExpiresMin: Number(x.default_expires_min) || 15,
          minAmount: Number(x.min_amount) || 1,
          maxAmount: Number(x.max_amount) || 10000000,
          dailyLimit: Number(x.daily_limit) || 10000000,
          maxOpenOrders: Number(x.max_open_orders) || 5,
        };
      } catch (e) {
        return def;
      }
    }

    async function createOrder(req, res) {
      const u = await requireUser(req, res);
      if (!u) return;
      const body = await parseBody(req).catch(() => ({}));
      const amount = Math.floor(Number(body && body.amount)); // 单位：分
      const channel = (body && body.channel) || 'wxpay';
      if (!Number.isFinite(amount) || amount <= 0) return sendJSON(res, 400, { error: '充值金额必须大于 0' });
      if (amount > 100000 * 100) return sendJSON(res, 400, { error: '单笔充值金额过大' });
      const pg = getPg();
      if (!pg) return sendJSON(res, 503, { error: '数据库不可用' });

      // 通道可用性校验：无配置通道直接 503，绝不回退 DEV 模拟（防白嫖命门）
      const providerEntry = await loader.getDefault().catch(() => null);
      if (!providerEntry) return sendJSON(res, 503, { error: '支付通道暂未配置，无法充值' });

      // ── 支付全局设置校验（防滥用：总开关 / 金额区间 / 单用户日限额 / 最大待付数）──
      const settings = await loadPaymentSettings();
      if (!settings.enabled) return sendJSON(res, 503, { error: '支付功能已关闭' });
      if (amount < settings.minAmount) {
        return sendJSON(res, 400, { error: `单笔充值不得低于 ¥${(settings.minAmount / 100).toFixed(0)}` });
      }
      if (amount > settings.maxAmount) {
        return sendJSON(res, 400, { error: `单笔充值不得超过 ¥${(settings.maxAmount / 100).toFixed(0)}` });
      }
      // 单用户当日已用额度（paid + pending 合计）
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const dayRes = await pg.query(
        "SELECT COALESCE(SUM(amount),0) AS s FROM recharge_orders WHERE user_id=$1 AND status IN ('paid','pending') AND created_at >= $2",
        [u.id, todayStart],
      );
      const usedToday = Number(dayRes.rows[0] && dayRes.rows[0].s) || 0;
      if (usedToday + amount > settings.dailyLimit) {
        const leftYuan = Math.max(0, Math.floor((settings.dailyLimit - usedToday) / 100));
        return sendJSON(res, 429, { error: `今日充值额度已用尽（剩余 ¥${leftYuan}）` });
      }
      // 单用户最大待支付数（超上限直接拒绝，杜绝"长期待付挂着"）
      const openRes = await pg.query(
        "SELECT COUNT(*) AS c FROM recharge_orders WHERE user_id=$1 AND status='pending'",
        [u.id],
      );
      const openCount = Number(openRes.rows[0] && openRes.rows[0].c) || 0;
      if (openCount >= settings.maxOpenOrders) {
        return sendJSON(res, 429, {
          error: `您有 ${openCount} 笔待支付订单，请先完成付款或等待过期（上限 ${settings.maxOpenOrders} 笔）`,
        });
      }

      const id = 'ro-' + crypto.randomUUID();
      const payOrderNo = 'P' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      const sign = hmac(SIGN_SECRET, `${payOrderNo}:${amount}:${channel}`);
      // 计算绝对过期时间（前端倒计时用），与 order-expiry worker 阈值保持一致
      const expiresAt = new Date(Date.now() + settings.defaultExpiresMin * 60000).toISOString();
      await pg.query(
        `INSERT INTO recharge_orders (id, user_id, channel, amount, status, pay_order_no, sign)
         VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
        [id, u.id, channel, amount, payOrderNo, sign],
      );

      // 向真实通道下单，拿回支付链接（无 payUrl 时前端显示安全提示，不再有 DEV 入口）
      let payUrl = '';
      try {
        const method = channel === 'alipay' ? 'alipay' : 'wxpay';
        // 公网回调地址：优先用 PUBLIC_BASE_URL（隧道/生产域名），否则回退到请求 Host（本地联调）。
        // 这是「真实充值端到端跑通」的命门——localhost 下平台公网回调打不进来，必须用公网可达地址。
        const publicBase = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
        const notifyUrl = publicBase
          ? `${publicBase}/api/credits/webhook/${providerEntry.type}`
          : `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost:3001'}/api/credits/webhook/${providerEntry.type}`;
        const returnUrl = publicBase
          ? `${publicBase}/account/credits`
          : `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost:3001'}/account/credits`;
        const r = await providerEntry.provider.createOrder({
          order: { outTradeNo: payOrderNo, amount },
          method,
          notifyUrl,
          returnUrl,
        });
        payUrl = r && r.payUrl ? r.payUrl : '';
      } catch (e) {
        // 下单失败不影响订单落库；返回 payUrl 为空，前端提示稍后重试
        console.warn('[payments] 通道下单失败:', e.message);
      }

      return sendJSON(res, 200, {
        ok: true,
        order: { id, payOrderNo, amount, channel, status: 'pending', payUrl, expiresAt },
      });
    }

    // GET /api/credits/orders — 当前用户的充值订单历史
    async function listOrders(req, res) {
      const u = await requireUser(req, res);
      if (!u) return;
      const pg = getPg();
      if (!pg) return sendJSON(res, 503, { error: '数据库不可用' });
      const r = await pg.query(
        `SELECT id, pay_order_no, amount, channel, status, created_at, paid_at
           FROM recharge_orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50`,
        [u.id],
      );
      return sendJSON(res, 200, {
        items: r.rows.map((x) => ({
          id: x.id, payOrderNo: x.pay_order_no, amount: Number(x.amount),
          channel: x.channel, status: x.status,
          createdAt: x.created_at, paidAt: x.paid_at,
        })),
      });
    }

    // GET /api/credits/orders/:payOrderNo — 订单详情（前端轮询用）
    async function getOrder(req, res, payOrderNo) {
      const u = await requireUser(req, res);
      if (!u) return;
      const pg = getPg();
      if (!pg) return sendJSON(res, 503, { error: '数据库不可用' });
      const r = await pg.query(
        'SELECT id, pay_order_no, amount, channel, status, created_at, paid_at, fail_reason FROM recharge_orders WHERE pay_order_no=$1 AND user_id=$2',
        [payOrderNo, u.id],
      );
      if (!r.rows.length) return sendJSON(res, 404, { error: '订单不存在' });
      const o = r.rows[0];
      // 由 created_at + 全局过期分钟推导绝对过期时间（与 worker 阈值一致）
      const settings = await loadPaymentSettings();
      const createdMs = o.created_at ? new Date(o.created_at).getTime() : Date.now();
      const expiresAt = new Date(createdMs + settings.defaultExpiresMin * 60000).toISOString();
      return sendJSON(res, 200, {
        order: {
          id: o.id, payOrderNo: o.pay_order_no, amount: Number(o.amount),
          channel: o.channel, status: o.status, createdAt: o.created_at, paidAt: o.paid_at,
          expiresAt, failReason: o.fail_reason || null,
        },
      });
    }

    function handlePayments(req, res, url, method) {
      if (url === '/api/credits/orders' && method === 'POST') { createOrder(req, res); return true; }
      if (url === '/api/credits/orders' && method === 'GET') { listOrders(req, res); return true; }
      const m = url.match(/^\/api\/credits\/orders\/([^/]+)$/);
      if (m && method === 'GET') { getOrder(req, res, decodeURIComponent(m[1])); return true; }
      return false;
    }

    return {
      createOrder, listOrders, getOrder, handleWebhook, handlePayments,
      // 供后台支付设置页在增删改服务商后立即刷新 loader 缓存（60s TTL 失效），
      // 保证下一次充值/回调使用最新配置；失败静默不影响主流程。
      invalidateProviderCache: () => { try { loader.invalidate(); } catch (e) {} },
    };
  },
};

module.exports = payments;
