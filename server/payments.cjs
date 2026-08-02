// server/payments.cjs — Phase 2 收尾：充值订单 + 微信/支付宝 DEV 模拟支付适配器（CommonJS）
// M2 账务：recharge_orders 表 + 幂等回调入账。
// 生产环境把 callback 换成真实微信/支付宝异步通知验签（平台公钥）即可，业务入库逻辑不变。
const crypto = require('crypto');

function hmac(secret, msg) {
  return crypto.createHmac('sha256', secret).update(msg).digest('hex');
}

const payments = {
  createPayments(ctx) {
    const { getPg, session, sendJSON, parseBody } = ctx;
    const DEV_SECRET = process.env.PAY_DEV_SECRET || 'dev-pay-secret-change-me';
    const CHANNELS = ['wechat', 'alipay'];

    async function requireUser(req, res) {
      const u = session.getUserFromCookie(req);
      if (!u) { sendJSON(res, 401, { error: '请先登录' }); return null; }
      return u;
    }

    // POST /api/credits/orders — 创建充值订单（DEV：返回模拟支付入口）
    async function createOrder(req, res) {
      const u = await requireUser(req, res);
      if (!u) return;
      const body = await parseBody(req).catch(() => ({}));
      const amount = Math.floor(Number(body && body.amount));
      const channel = (body && body.channel) || 'wechat';
      if (!Number.isFinite(amount) || amount <= 0) return sendJSON(res, 400, { error: '充值金额必须大于 0' });
      if (amount > 100000) return sendJSON(res, 400, { error: '单笔充值金额过大' });
      if (!CHANNELS.includes(channel)) return sendJSON(res, 400, { error: '不支持的支付渠道' });
      const pg = getPg();
      if (!pg) return sendJSON(res, 503, { error: '数据库不可用' });
      const id = 'ro-' + crypto.randomUUID();
      const payOrderNo = 'P' + Date.now().toString(36) + crypto.randomBytes(4).toString('hex');
      const sign = hmac(DEV_SECRET, `${payOrderNo}:${amount}:${channel}`);
      await pg.query(
        `INSERT INTO recharge_orders (id, user_id, channel, amount, status, pay_order_no, sign)
         VALUES ($1,$2,$3,$4,'pending',$5,$6)`,
        [id, u.id, channel, amount, payOrderNo, sign],
      );
      return sendJSON(res, 200, {
        ok: true,
        devMode: true,
        order: {
          id, payOrderNo, amount, channel, status: 'pending',
          devPayUrl: `/api/credits/orders/dev-pay/${payOrderNo}`,
        },
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

    // GET /api/credits/orders/dev-pay/:payOrderNo — DEV 模拟支付页（手动 / curl 测试用）
    async function devPayPage(req, res, payOrderNo) {
      const pg = getPg();
      if (!pg) { res.writeHead(503); return res.end('db unavailable'); }
      const r = await pg.query('SELECT * FROM recharge_orders WHERE pay_order_no=$1', [payOrderNo]);
      if (!r.rows.length) { res.writeHead(404); return res.end('order not found'); }
      const o = r.rows[0];
      const chName = o.channel === 'alipay' ? '支付宝' : '微信支付';
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>DEV 模拟支付</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;background:#0b0b0f;color:#eee;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.card{background:#16161c;border:1px solid #2a2a33;border-radius:24px;padding:32px;width:360px;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.amt{font-size:40px;font-weight:800;margin:16px 0}.ch{color:#9aa}.btn{margin-top:20px;width:100%;padding:14px;border:0;border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;background:linear-gradient(135deg,#34d399,#22d3ee);color:#062}
.muted{color:#777;font-size:12px;margin-top:14px}</style></head>
<body><div class="card"><div class="ch">${chName} · DEV 模拟支付</div>
<div class="amt">¥${Number(o.amount)}</div>
<div class="muted">订单号 ${o.pay_order_no}</div>
<button class="btn" onclick="pay()">✅ 模拟支付成功</button>
<div class="muted">仅开发环境：点击后回调入账并加积分</div></div>
<script>
async function pay(){
  var b=document.querySelector('.btn'); b.disabled=true; b.textContent='处理中…';
  try{
    var r=await fetch('/api/credits/orders/callback/${o.channel}',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'include',body:JSON.stringify({payOrderNo:'${o.pay_order_no}'})});
    var j=await r.json();
    if(j.ok){ b.textContent='✅ 支付成功，已加积分'; setTimeout(function(){location.href='/';},1500); }
    else { b.disabled=false; b.textContent='重试'; alert(j.error||'支付失败'); }
  }catch(e){ b.disabled=false; b.textContent='重试'; alert('网络错误'); }
}
</script></body></html>`);
    }

    // POST /api/credits/orders/callback/:channel — 支付成功回调（幂等入账）
    // 生产：换成真实微信/支付宝异步通知 + 平台公钥验签；此处用 pay_order_no + HMAC 演示幂等与防重放。
    async function callback(req, res, channel) {
      if (!CHANNELS.includes(channel)) return sendJSON(res, 400, { error: '不支持的支付渠道' });
      const body = await parseBody(req).catch(() => ({}));
      const payOrderNo = (body && body.payOrderNo) || '';
      if (!payOrderNo) return sendJSON(res, 400, { error: '缺少 payOrderNo' });
      const pg = getPg();
      if (!pg) return sendJSON(res, 503, { error: '数据库不可用' });
      const client = await pg.connect();
      try {
        await client.query('BEGIN');
        const r = await client.query('SELECT * FROM recharge_orders WHERE pay_order_no=$1 FOR UPDATE', [payOrderNo]);
        if (!r.rows.length) { await client.query('ROLLBACK'); return sendJSON(res, 404, { error: '订单不存在' }); }
        const o = r.rows[0];
        const expect = hmac(DEV_SECRET, `${o.pay_order_no}:${o.amount}:${o.channel}`);
        if (o.sign !== expect) { await client.query('ROLLBACK'); return sendJSON(res, 400, { error: '签名校验失败' }); }
        if (o.status === 'paid') { await client.query('COMMIT'); return sendJSON(res, 200, { ok: true, alreadyPaid: true, credits: null }); }
        await client.query("UPDATE recharge_orders SET status='paid', paid_at=NOW() WHERE pay_order_no=$1", [payOrderNo]);
        const bal = await client.query('UPDATE users SET credits=credits+$1 WHERE id=$2 RETURNING credits', [o.amount, o.user_id]);
        const newBal = bal.rows[0] ? Number(bal.rows[0].credits) : null;
        await client.query(
          `INSERT INTO credit_transactions (user_id, kind, amount, ref, balance_after)
           VALUES ($1,'grant',$2,$3,$4)`,
          [o.user_id, o.amount, o.id, newBal],
        );
        await client.query('COMMIT');
        return sendJSON(res, 200, { ok: true, credits: newBal });
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        return sendJSON(res, 500, { error: '入账失败：' + e.message });
      } finally {
        client.release();
      }
    }

    function handlePayments(req, res, url, method) {
      if (url === '/api/credits/orders' && method === 'POST') { createOrder(req, res); return true; }
      if (url === '/api/credits/orders' && method === 'GET') { listOrders(req, res); return true; }
      let m = url.match(/^\/api\/credits\/orders\/dev-pay\/([^/]+)$/);
      if (m && method === 'GET') { devPayPage(req, res, decodeURIComponent(m[1])); return true; }
      m = url.match(/^\/api\/credits\/orders\/callback\/([a-z]+)$/);
      if (m && method === 'POST') { callback(req, res, m[1]); return true; }
      return false;
    }

    return { createOrder, listOrders, devPayPage, callback, handlePayments };
  },
};

module.exports = payments;
