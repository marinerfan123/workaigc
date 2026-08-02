// server/shop.cjs — Phase 5 电商模块（AI 市集）
// 路由：/api/shop/products（列表）、/api/products/:id（详情）、
//       /api/cart（购物车 GET/POST）、/api/cart/:id（改/删）、
//       /api/orders（下单 POST / 列表 GET）、/api/orders/:id（详情）
// 依赖（由 server.js 注入）：getPg / session / sendJSON / camelKeys / parseBody
// 计费：复用 billing.cjs 三段式积分预扣（reserve / commit / release），幂等由 idempotency_key 保证
// 隔离：购物车 / 订单严格按 user_id 归属（多租户红线，与 #171 一致）

const crypto = require('crypto');

function createShop(ctx) {
  const { getPg, session, sendJSON, parseBody, billing } = ctx;
  const pg = () => getPg();
  const hasPg = () => !!getPg();

  // snake_case → camelCase（自带，避免依赖 server 的有限 SNAKE_MAP 白名单）
  function camelKeys(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const k of Object.keys(obj)) {
      out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = obj[k];
    }
    return out;
  }

  // 取真实登录用户（购物车/订单归属用）
  function requireUser(req, res) {
    const u = session.getUserFromCookie(req);
    if (!u) { sendJSON(res, 401, { error: '未登录' }); return null; }
    return u;
  }

  function uuid() { return crypto.randomUUID(); }

  // ───────────── 商品列表 ─────────────
  async function listProducts(query) {
    const cat = (query.cat || '').trim();
    const q = (query.q || '').trim();
    const limit = Math.min(parseInt(query.limit || '24', 10) || 24, 100);
    const offset = parseInt(query.offset || '0', 10) || 0;
    const params = [];
    let where = "p.status='active'";
    let i = 1;
    if (cat && cat !== 'all') { where += ` AND p.category=$${i}`; params.push(cat); i++; }
    if (q) { where += ` AND p.title ILIKE $${i}`; params.push(`%${q}%`); i++; }
    const r = await pg().query(
      `SELECT p.id, p.shop_id, p.title, p.subtitle, p.cover_url, p.price_cents,
              p.credit_price, p.stock, p.category, p.ai_fields, p.status, p.created_at,
              s.name AS shop_name
       FROM products p LEFT JOIN shops s ON s.id=p.shop_id
       WHERE ${where}
       ORDER BY p.created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset],
    );
    const totalR = await pg().query(`SELECT COUNT(*) FROM products p WHERE ${where}`, params);
    return {
      items: r.rows.map(camelKeys),
      total: parseInt(totalR.rows[0].count, 10),
      limit,
      offset,
    };
  }

  // ───────────── 商品详情 ─────────────
  async function getProduct(id) {
    const p = await pg().query(
      `SELECT p.*, s.name AS shop_name, s.description AS shop_description
       FROM products p LEFT JOIN shops s ON s.id=p.shop_id WHERE p.id=$1`,
      [id],
    );
    if (!p.rows.length) return null;
    const skus = await pg().query('SELECT * FROM product_skus WHERE product_id=$1 ORDER BY created_at', [id]);
    const reviews = await pg().query(
      'SELECT * FROM reviews WHERE product_id=$1 ORDER BY created_at DESC LIMIT 20', [id],
    );
    return {
      product: camelKeys(p.rows[0]),
      skus: skus.rows.map(camelKeys),
      reviews: reviews.rows.map(camelKeys),
    };
  }

  // ───────────── 购物车 ─────────────
  async function getCart(user) {
    const r = await pg().query(
      `SELECT c.id, c.qty, c.sku_id, c.created_at,
              p.id AS product_id, p.title, p.cover_url, p.credit_price AS product_credit_price,
              p.status AS product_status,
              s.specs AS attrs, s.credit_price AS sku_credit_price, s.stock AS sku_stock
       FROM cart_items c
       JOIN products p ON p.id=c.product_id
       LEFT JOIN product_skus s ON s.id=c.sku_id
       WHERE c.user_id=$1
       ORDER BY c.created_at DESC`,
      [user.id],
    );
    return r.rows.map((row) => {
      const unitCreditPrice = (row.sku_credit_price != null ? row.sku_credit_price : row.product_credit_price) || 0;
      return {
        id: row.id,
        productId: row.product_id,
        skuId: row.sku_id,
        qty: row.qty,
        title: row.title,
        coverUrl: row.cover_url,
        productStatus: row.product_status,
        attrs: row.attrs,
        skuStock: row.sku_stock,
        unitCreditPrice,
        subtotal: unitCreditPrice * row.qty,
      };
    });
  }

  async function addToCart(user, body) {
    const productId = body.productId || body.product_id;
    const skuId = body.skuId || body.sku_id || 0;
    const qty = Math.max(1, parseInt(body.qty || '1', 10) || 1);
    if (!productId) return { error: '缺少 productId' };
    // 校验商品存在且上架
    const p = await pg().query('SELECT id, status, credit_price FROM products WHERE id=$1', [productId]);
    if (!p.rows.length) return { error: '商品不存在', status: 404 };
    if (p.rows[0].status !== 'active') return { error: '商品已下架', status: 409 };
    const r = await pg().query(
      `INSERT INTO cart_items (user_id, product_id, sku_id, qty)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (user_id, product_id, sku_id)
       DO UPDATE SET qty = cart_items.qty + EXCLUDED.qty
       RETURNING *`,
      [user.id, productId, skuId, qty],
    );
    return { ok: true, item: camelKeys(r.rows[0]) };
  }

  async function updateCartItem(user, id, body) {
    const qty = parseInt(body.qty || '1', 10);
    if (!Number.isFinite(qty) || qty < 1) return { error: '数量无效', status: 400 };
    const r = await pg().query(
      'UPDATE cart_items SET qty=$1 WHERE id=$2 AND user_id=$3',
      [qty, id, user.id],
    );
    if (r.rowCount === 0) return { error: '购物车项不存在', status: 404 };
    return { ok: true };
  }

  async function removeCartItem(user, id) {
    const r = await pg().query('DELETE FROM cart_items WHERE id=$1 AND user_id=$2', [id, user.id]);
    if (r.rowCount === 0) return { error: '购物车项不存在', status: 404 };
    return { ok: true };
  }

  // ───────────── 下单（复用 billing 三段式积分预扣）─────────────
  async function createOrder(user, body) {
    const idemKey = body.idempotencyKey || uuid();
    // 幂等：同 key 直接返回已建订单
    const ex = await pg().query('SELECT * FROM orders WHERE idempotency_key=$1', [idemKey]);
    if (ex.rows.length) return { ok: true, order: camelKeys(ex.rows[0]), idempotent: true };

    const items = await getCart(user);
    if (!items.length) return { error: '购物车为空', status: 400 };

    // 库存 + 单价校验
    let totalCredits = 0;
    const lines = [];
    for (const it of items) {
      if (it.productStatus !== 'active') return { error: `商品「${it.title}」已下架`, status: 409 };
      const stock = it.skuId ? it.skuStock : null; // sku 维度库存；商品维度库存未强制（sku 优先）
      if (it.skuId && stock != null && stock < it.qty) {
        return { error: `「${it.title}」库存不足`, status: 409 };
      }
      totalCredits += it.unitCreditPrice * it.qty;
      lines.push(it);
    }
    if (totalCredits <= 0) return { error: '订单金额为 0', status: 400 };

    // 三段式：reserve（扣余额）→ 建单 → commit（记账）；失败 release
    try {
      await billing.reserveCredits(pg(), user.id, totalCredits, idemKey);
    } catch (e) {
      return { error: e.message || '积分不足', status: 402 };
    }

    try {
      const orderNo = `ORD-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const orderId = uuid();
      await pg().query(
        `INSERT INTO orders (id, order_no, user_id, total_cents, total_credits, credit_used, pay_channel, pay_status, idempotency_key, created_at, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,'credit','paid',$7,NOW(),NOW())`,
        [orderId, orderNo, user.id, 0, totalCredits, totalCredits, idemKey],
      );
      for (const it of lines) {
        await pg().query(
          `INSERT INTO order_items (order_id, product_id, sku_id, title, qty, unit_credit_price, unit_price_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [orderId, it.productId, it.skuId || 0, it.title, it.qty, it.unitCreditPrice, 0],
        );
        // 扣库存（商品维度；sku 维度若用则另扣）
        await pg().query(
          'UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE id=$2',
          [it.qty, it.productId],
        );
        if (it.skuId) {
          await pg().query(
            'UPDATE product_skus SET stock = GREATEST(stock - $1, 0) WHERE id=$2 AND stock >= $1',
            [it.qty, it.skuId],
          );
        }
      }
      // 清空购物车
      await pg().query('DELETE FROM cart_items WHERE user_id=$1', [user.id]);
      // commit 记账
      await billing.commitCredits(pg(), user.id, totalCredits, idemKey);
      return { ok: true, order: { id: orderId, orderNo, totalCredits, payStatus: 'paid' } };
    } catch (e) {
      await billing.releaseCredits(pg(), user.id, totalCredits, idemKey);
      return { error: '下单失败：' + (e.message || '未知错误'), status: 500 };
    }
  }

  // ───────────── 订单列表 / 详情 ─────────────
  async function listOrders(user) {
    const r = await pg().query(
      `SELECT o.*, (SELECT COUNT(*) FROM order_items oi WHERE oi.order_id=o.id) AS item_count
       FROM orders o WHERE o.user_id=$1 ORDER BY o.created_at DESC`,
      [user.id],
    );
    return r.rows.map(camelKeys);
  }

  async function getOrder(user, id) {
    const o = await pg().query('SELECT * FROM orders WHERE id=$1 AND user_id=$2', [id, user.id]);
    if (!o.rows.length) return null;
    const items = await pg().query('SELECT * FROM order_items WHERE order_id=$1', [id]);
    return { order: camelKeys(o.rows[0]), items: items.rows.map(camelKeys) };
  }

  // ───────────── 路由分发 ─────────────
  async function handleShop(req, res, url, method) {
    if (!hasPg()) return false;
    const path = url.split('?')[0];

    // 商品列表
    if (path === '/api/shop/products' && method === 'GET') {
      const data = await listProducts(Object.fromEntries(new URL(req.url, 'http://x').searchParams));
      sendJSON(res, 200, data);
      return true;
    }
    // 商品详情
    const mProd = path.match(/^\/api\/products\/([^/]+)$/);
    if (mProd && method === 'GET') {
      const d = await getProduct(decodeURIComponent(mProd[1]));
      if (!d) return sendJSON(res, 404, { error: '商品不存在' });
      return sendJSON(res, 200, d);
    }
    // 购物车
    if (path === '/api/cart' && method === 'GET') {
      const u = requireUser(req, res); if (!u) return true;
      return sendJSON(res, 200, await getCart(u));
    }
    if (path === '/api/cart' && method === 'POST') {
      const u = requireUser(req, res); if (!u) return true;
      const body = await parseBody(req);
      const r = await addToCart(u, body || {});
      if (r.error) return sendJSON(res, r.status || 400, { error: r.error });
      return sendJSON(res, 200, r);
    }
    const mCart = path.match(/^\/api\/cart\/([^/]+)$/);
    if (mCart) {
      const u = requireUser(req, res); if (!u) return true;
      const id = mCart[1];
      if (method === 'PUT') {
        const body = await parseBody(req);
        const r = await updateCartItem(u, id, body || {});
        if (r.error) return sendJSON(res, r.status || 400, { error: r.error });
        return sendJSON(res, 200, r);
      }
      if (method === 'DELETE') {
        const r = await removeCartItem(u, id);
        if (r.error) return sendJSON(res, r.status || 400, { error: r.error });
        return sendJSON(res, 200, r);
      }
    }
    // 订单
    if (path === '/api/orders' && method === 'POST') {
      const u = requireUser(req, res); if (!u) return true;
      const body = await parseBody(req);
      const r = await createOrder(u, body || {});
      if (r.error) return sendJSON(res, r.status || 400, { error: r.error });
      return sendJSON(res, 200, r);
    }
    if (path === '/api/orders' && method === 'GET') {
      const u = requireUser(req, res); if (!u) return true;
      return sendJSON(res, 200, await listOrders(u));
    }
    const mOrder = path.match(/^\/api\/orders\/([^/]+)$/);
    if (mOrder && method === 'GET') {
      const u = requireUser(req, res); if (!u) return true;
      const d = await getOrder(u, mOrder[1]);
      if (!d) return sendJSON(res, 404, { error: '订单不存在' });
      return sendJSON(res, 200, d);
    }
    return false;
  }

  return { handleShop };
}

module.exports = { createShop };
