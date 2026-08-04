// server/payments/providers/easypay.cjs — 易支付（EPay / 码支付类聚合通道）适配器
// 一个适配器通吃支付宝/微信（易支付后端自动路由）。签名采用易支付标准 MD5 方案。
// 安全：pid/pkey/webhook_secret 入参已是解密后的明文（由调用方经 crypto.cjs 解密后传入）。
//
// 注意：不同易支付二开平台的 sign 算法细节略有差异（主要是参与签名字段与拼接顺序）。
//       本实现给出最常见的一种（md5(md5(key) + 排序串 + key)）。联调时若平台校验失败，
//       仅需调整 _sign 内的字段集合，verifyWebhook 的 fails-closed 行为不变。
const crypto = require('crypto');
const { ServiceProvider } = require('../provider.cjs');

function md5(s) {
  return crypto.createHash('md5').update(s, 'utf8').digest('hex');
}

class EasyPayProvider extends ServiceProvider {
  get type() {
    return 'easypay';
  }

  // 易支付标准签名：排除 sign，按 key 字典序拼接 `k=v&...` + key，再 md5(md5(key)+串)
  _sign(params, key) {
    const keys = Object.keys(params)
      .filter((k) => k !== 'sign' && params[k] !== '' && params[k] != null)
      .sort();
    const raw = keys.map((k) => `${k}=${params[k]}`).join('&') + key;
    return md5(md5(key) + raw);
  }

  async createOrder({ order, method, notifyUrl, returnUrl }) {
    const key = this.cfg.pkey;
    const params = {
      pid: this.cfg.pid,
      type: method === 'alipay' ? 'alipay' : 'wxpay',
      out_trade_no: order.outTradeNo,
      name: `${this.cfg.product_name_prefix || '充值'} ${order.amount} 元`,
      money: (order.amount / 100).toFixed(2), // 分 → 元
      notify_url: notifyUrl,
      return_url: returnUrl || '',
    };
    params.sign = this._sign(params, key);
    const qs = new URLSearchParams(params).toString();
    const payUrl = `${String(this.cfg.api_base || '').replace(/\/$/, '')}/submit.php?${qs}`;
    return { payUrl, qrCode: null, payParams: params, outTradeNo: order.outTradeNo };
  }

  // 异步通知验签：易支付把 out_trade_no / trade_no / money / sign 通过 GET/POST 带回
  // 验签失败抛错 → 路由层返回 400 并拒绝入账（fails closed）
  async verifyWebhook({ body, query }) {
    const data = body && Object.keys(body).length ? body : query || {};
    const sign = data.sign;
    if (!sign) throw new Error('缺少签名');
    const calc = this._sign(data, this.cfg.pkey);
    if (calc !== sign) throw new Error('签名校验失败');
    const money = parseFloat(data.money);
    if (!Number.isFinite(money) || money <= 0) throw new Error('回调金额非法');
    const amountFen = Math.round(money * 100);
    return {
      ok: true,
      outTradeNo: data.out_trade_no,
      channelTradeNo: data.trade_no,
      amount: amountFen,
      raw: data,
    };
  }

  async refund(/* ctx */) {
    // 易支付退款需走平台 API，此处留接口；是否启用取决于 payment_providers.allow_refund
    throw new Error('easypay 退款未实现');
  }
}

module.exports = { EasyPayProvider };
