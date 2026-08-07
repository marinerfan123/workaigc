// server/admin.cjs — Phase 2 运营总控台(M3) + 全局智能体层(M4) 后台接口
// 路由：/api/admin/*（用户管理 §C.8 / 手动充值 §C.7 / 积分流水 M2 / agents·providers·rules §B.9）
// 实时：GET /api/admin/console/stream（SSE，§H.1 五事件 metrics/traffic/flow/log/agent）
// 依赖（由 server.js 注入）：getPg / session / sendJSON / fromSnake / toSnake / parseBody / traffic
// 设计依据：docs/MASTER_DESIGN.md（M3 §H.1/§H.3，M4 §B.9）+ 实际 schema（users.credits / credit_transactions.kind）

function createAdmin(ctx) {
  const { getPg, session, sendJSON, fromSnake, parseBody } = ctx;
  const traffic = ctx.traffic || { onlineUsers: () => 0, currentQps: () => 0 };
  const monitor = ctx.monitor || null;     // 实时监控模块(可选注入)；用于 /api/admin/monitor/{snapshot,stream,clear}
  const logbus = ctx.logbus || null;       // 日志总线(可选注入)；用于 /api/admin/logs/{snapshot,stream,clear}
  const syslog = ctx.syslog || null;       // 核心错误持久化(可选注入)；用于 /api/admin/errors（历史查询/清理）

  const hasPg = () => !!getPg();
  const pg = () => getPg();
  const crypto = require('crypto');

  // 管理员闸门：会话角色 admin 或 系统令牌(system) 放行
  function requireAdmin(req) {
    return !!(req.user && (req.user.role === 'admin' || req.user.role === 'system'));
  }

  // ───────────────────────── 用户管理（§C.8） ─────────────────────────
  async function listUsers(query) {
    const q = (query.q || '').trim();
    const role = (query.role || '').trim();
    const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 200);
    const offset = parseInt(query.offset || '0', 10) || 0;
    const params = [];
    let where = '1=1';
    let i = 1;
    if (q) { where += ` AND (email ILIKE $${i} OR display_name ILIKE $${i})`; params.push(`%${q}%`); i++; }
    if (role) { where += ` AND role=$${i}`; params.push(role); i++; }
    const countR = await pg().query(`SELECT COUNT(*) FROM users WHERE ${where}`, params);
    const total = parseInt(countR.rows[0].count, 10);
    const r = await pg().query(
      `SELECT id, email, display_name, role, credits, status, plan, created_at
       FROM users WHERE ${where} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset],
    );
    return { items: r.rows.map(fromSnake), total };
  }

  // 管理员手动充值 / 调整（§C.7，M2 后台调整流水；kind='adjust'，审计留痕）
  async function recharge(userId, amount, note, actorId) {
    const amt = Math.floor(Number(amount));
    if (!Number.isFinite(amt) || amt === 0) throw new Error('金额必须为非零整数');
    if (amt < 0) {
      const cur = await pg().query('SELECT recharge_credits FROM users WHERE id=$1', [userId]);
      if (!cur.rows.length) throw new Error('用户不存在');
      if (cur.rows[0].recharge_credits + amt < 0) throw new Error('扣减后余额不能为负');
    }
    const u = await pg().query(
      'UPDATE users SET recharge_credits = recharge_credits + $1, updated_at=NOW() WHERE id=$2 RETURNING credits',
      [amt, userId],
    );
    if (!u.rows.length) throw new Error('用户不存在');
    const newCredits = u.rows[0].credits;
    await pg().query(
      `INSERT INTO credit_transactions (user_id, kind, amount, ref, pool, balance_after)
       VALUES ($1,'adjust',$2,$3,'recharge',(SELECT credits FROM users WHERE id=$1))`,
      [userId, amt, `admin:${actorId}`],
    );
    await pg().query(
      `INSERT INTO audit_logs (actor_id, action, target, detail)
       VALUES ($1,'recharge',$2,$3)`,
      [actorId, userId, JSON.stringify({
        level: amt > 0 ? 'info' : 'warn',
        msg: `管理员${amt > 0 ? '充值' : '扣减'} ${Math.abs(amt)} 积分`,
        note: note || '', amount: amt,
      })],
    );
    return { ok: true, credits: newCredits };
  }

  // ───────────────────────── 用户运营（商用多用户 §C.8） ─────────────────────────
  async function setUserStatus(userId, status) {
    if (!['active', 'suspended'].includes(status)) throw new Error('状态非法');
    const u = await pg().query('UPDATE users SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id', [status, userId]);
    if (!u.rows.length) throw new Error('用户不存在');
    return { ok: true, status };
  }
  async function setUserRole(userId, role) {
    if (!['user', 'admin'].includes(role)) throw new Error('角色非法');
    const u = await pg().query('UPDATE users SET role=$1, updated_at=NOW() WHERE id=$2 RETURNING id', [role, userId]);
    if (!u.rows.length) throw new Error('用户不存在');
    return { ok: true, role };
  }
  async function deleteUser(userId) {
    const u = await pg().query('DELETE FROM users WHERE id=$1 RETURNING id', [userId]);
    if (!u.rows.length) throw new Error('用户不存在');
    return { ok: true };
  }

  // ───────────────────────── 积分流水（M2） ─────────────────────────
  async function listTransactions(query) {
    const limit = Math.min(parseInt(query.limit || '50', 10) || 50, 200);
    const offset = parseInt(query.offset || '0', 10) || 0;
    const type = (query.type || '').trim();
    const userId = (query.userId || '').trim();
    const params = [];
    let where = '1=1';
    let i = 1;
    if (type) { where += ` AND kind=$${i}`; params.push(type); i++; }
    if (userId) { where += ` AND user_id=$${i}`; params.push(userId); i++; }
    const countR = await pg().query(`SELECT COUNT(*) FROM credit_transactions WHERE ${where}`, params);
    const total = parseInt(countR.rows[0].count, 10);
    const r = await pg().query(
      `SELECT t.id, t.user_id, u.display_name AS user, t.kind, t.amount, t.balance_after, t.ref, t.created_at
       FROM credit_transactions t LEFT JOIN users u ON u.id=t.user_id
       WHERE ${where} ORDER BY t.id DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, limit, offset],
    );
    return { items: r.rows.map((x) => ({
      id: Number(x.id),
      userId: x.user_id,
      user: x.user || '系统',
      kind: x.kind,
      amount: Number(x.amount),
      balanceAfter: x.balance_after != null ? Number(x.balance_after) : null,
      ref: x.ref,
      createdAt: x.created_at,
    })), total };
  }

  // ───────────────────────── 全局智能体层（§B.9 / M4） ─────────────────────────
  async function listAgents() {
    const r = await pg().query(
      'SELECT key, name, enabled, daily_budget, config, agent_type, skill_key, created_at FROM agents ORDER BY name');
    return r.rows.map((a) => ({
      key: a.key, name: a.name, enabled: a.enabled,
      dailyBudget: a.daily_budget, config: a.config || {},
      agentType: a.agent_type || 'model', skillKey: a.skill_key || '',
      createdAt: a.created_at,
    }));
  }
  async function upsertAgent(a) {
    const key = (a.key || '').trim();
    if (!key) throw new Error('key 必填');
    const agentType = (a.agentType === 'skill') ? 'skill' : 'model';
    const skillKey = (a.skillKey || (a.config && a.config.skill) || '').toString();
    await pg().query(
      `INSERT INTO agents (key, name, enabled, daily_budget, config, agent_type, skill_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (key) DO UPDATE SET name=EXCLUDED.name, enabled=EXCLUDED.enabled,
         daily_budget=EXCLUDED.daily_budget, config=EXCLUDED.config,
         agent_type=EXCLUDED.agent_type, skill_key=EXCLUDED.skill_key`,
      [key, a.name || key, a.enabled !== false, Math.max(0, Number(a.dailyBudget) || 0), JSON.stringify(a.config || {}), agentType, skillKey],
    );
    return { ok: true };
  }
  async function toggleAgent(key, enabled) {
    await pg().query('UPDATE agents SET enabled=$2 WHERE key=$1', [key, !!enabled]);
    return { ok: true };
  }
  async function listAgentProviders(agentKey) {
    let sql = 'SELECT id, agent_key, provider, model, weight, priority, cost_per_call, enabled, created_at FROM agent_providers';
    const params = [];
    if (agentKey) { sql += ' WHERE agent_key=$1'; params.push(agentKey); }
    sql += ' ORDER BY priority, agent_key';
    const r = await pg().query(sql, params);
    return r.rows.map((p) => ({
      id: p.id, agentKey: p.agent_key, provider: p.provider, model: p.model,
      weight: p.weight, priority: p.priority, costPerCall: p.cost_per_call,
      enabled: p.enabled, createdAt: p.created_at,
    }));
  }
  async function upsertAgentProvider(p) {
    const id = (p.id || '').trim() || ('ap-' + rand());
    await pg().query(
      `INSERT INTO agent_providers (id, agent_key, provider, model, weight, priority, cost_per_call, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET agent_key=EXCLUDED.agent_key, provider=EXCLUDED.provider,
         model=EXCLUDED.model, weight=EXCLUDED.weight, priority=EXCLUDED.priority,
         cost_per_call=EXCLUDED.cost_per_call, enabled=EXCLUDED.enabled`,
      [id, p.agentKey, p.provider || '', p.model || '', Math.max(0, Number(p.weight) || 1),
       Math.max(0, Number(p.priority) || 10), Math.max(0, Number(p.costPerCall) || 0), p.enabled !== false],
    );
    return { ok: true, id };
  }
  async function listAgentRules() {
    const r = await pg().query(
      'SELECT id, name, trigger, condition, action, enabled, created_at FROM agent_rules ORDER BY name');
    return r.rows.map((x) => ({
      id: x.id, name: x.name, trigger: x.trigger, condition: x.condition || {},
      action: x.action || {}, enabled: x.enabled, createdAt: x.createdAt,
    }));
  }
  async function upsertAgentRule(r) {
    const id = (r.id || '').trim() || ('rule-' + rand());
    await pg().query(
      `INSERT INTO agent_rules (id, name, trigger, condition, action, enabled)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, trigger=EXCLUDED.trigger,
         condition=EXCLUDED.condition, action=EXCLUDED.action, enabled=EXCLUDED.enabled`,
      [id, r.name, r.trigger, JSON.stringify(r.condition || {}), JSON.stringify(r.action || {}), r.enabled !== false],
    );
    return { ok: true, id };
  }
  async function toggleAgentRule(id, enabled) {
    await pg().query('UPDATE agent_rules SET enabled=$2 WHERE id=$1', [id, !!enabled]);
    return { ok: true };
  }

  // ───────────────────────── SSE 总控台实时流（§H.1） ─────────────────────────
  async function computeMetrics() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const g = await pg().query('SELECT COUNT(*) FROM media WHERE created_at >= $1', [today]);
    const genToday = parseInt(g.rows[0].count, 10);
    const c = await pg().query(
      `SELECT COALESCE(SUM(amount),0) AS consumed FROM credit_transactions
       WHERE created_at >= $1 AND kind IN ('reserve','commit','grant')`, [today]);
    const creditToday = parseInt(c.rows[0].consumed, 10);
    const s = await pg().query(
      `SELECT COUNT(*) FILTER (WHERE status='done') AS done,
              COUNT(*) FILTER (WHERE status='failed') AS failed
       FROM generation_tasks WHERE created_at >= $1`, [today]);
    const done = parseInt(s.rows[0].done, 10);
    const failed = parseInt(s.rows[0].failed, 10);
    const successRate = (done + failed) === 0 ? 100 : Math.round((done / (done + failed)) * 1000) / 10;
    const lat = await pg().query(
      'SELECT COALESCE(AVG(latency_ms),0) AS avg FROM agent_calls WHERE created_at >= $1', [today]);
    const avgLatency = Math.round(parseFloat(lat.rows[0].avg) || 0);
    const online = traffic.onlineUsers();
    return {
      online: online > 0 ? online : await totalUsersFallback(),
      qps: traffic.currentQps(),
      gen_today: genToday,
      credit_today: creditToday,
      success_rate: successRate,
      avg_latency: avgLatency,
    };
  }
  async function totalUsersFallback() {
    try { const r = await pg().query('SELECT COUNT(*) FROM users'); return parseInt(r.rows[0].count, 10); }
    catch { return 0; }
  }
  async function newFlows(lastId) {
    const r = await pg().query(
      `SELECT t.id, u.display_name AS user, t.kind AS type, t.amount, t.balance_after AS "balanceAfter", t.created_at AS ts
       FROM credit_transactions t LEFT JOIN users u ON u.id=t.user_id
       WHERE t.id > $1 ORDER BY t.id ASC LIMIT 25`, [lastId]);
    return r.rows.map((x) => ({
      id: Number(x.id), user: x.user || '系统', type: x.type,
      amount: Number(x.amount), balanceAfter: x.balanceAfter != null ? Number(x.balanceAfter) : null,
      ts: new Date(x.ts).getTime(),
    }));
  }
  async function newLogs(lastId) {
    const r = await pg().query(
      'SELECT id, action, detail, created_at AS ts FROM audit_logs WHERE id > $1 ORDER BY id ASC LIMIT 25', [lastId]);
    return r.rows.map((x) => {
      const d = x.detail || {};
      return { id: Number(x.id), level: d.level || 'info', action: x.action, msg: d.msg || x.action, ts: new Date(x.ts).getTime() };
    });
  }
  async function agentSnapshot() {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const r = await pg().query(
      `SELECT agent_key, COUNT(*) AS calls, AVG(CASE WHEN ok THEN 1 ELSE 0 END) AS ok_rate,
              COALESCE(SUM(cost_credits),0) AS cost
       FROM agent_calls WHERE created_at >= $1 GROUP BY agent_key`, [today]);
    if (r.rows.length) {
      return r.rows.map((x) => ({
        agent: x.agent_key, calls: parseInt(x.calls, 10),
        ok_rate: Math.round((parseFloat(x.ok_rate) || 0) * 1000) / 10,
        cost: parseInt(x.cost, 10), ts: Date.now(),
      }));
    }
    // 暂无真实调用 → 给出已注册智能体基线，保证看板非空
    const agents = await listAgents();
    return agents.map((a) => ({ agent: a.key, calls: 0, ok_rate: 100, cost: 0, ts: Date.now() }));
  }

  async function streamConsole(req, res) {
    if (!hasPg()) return sendJSON(res, 503, { error: '数据库不可用' });
    if (!requireAdmin(req)) return sendJSON(res, 403, { error: '需要管理员权限' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 3000\n\n');
    let lastFlowId = 0;
    let lastLogId = 0;
    try {
      const f = await pg().query('SELECT COALESCE(MAX(id),0) AS m FROM credit_transactions');
      const l = await pg().query('SELECT COALESCE(MAX(id),0) AS m FROM audit_logs');
      lastFlowId = parseInt(f.rows[0].m, 10);
      lastLogId = parseInt(l.rows[0].m, 10);
    } catch {}

    const send = (event, data) => {
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {}
    };

    const tick = async () => {
      try {
        const metrics = await computeMetrics();
        send('metrics', metrics);
        send('traffic', { t: Date.now(), qps: metrics.qps });
        const flows = await newFlows(lastFlowId);
        for (const f of flows) { send('flow', f); if (f.id > lastFlowId) lastFlowId = f.id; }
        const logs = await newLogs(lastLogId);
        for (const l of logs) { send('log', l); if (l.id > lastLogId) lastLogId = l.id; }
        const agents = await agentSnapshot();
        for (const a of agents) send('agent', a);
      } catch { /* 静默，下一秒重试 */ }
    };
    await tick();
    const timer = setInterval(tick, 1000);
    const hb = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 15000);
    const cleanup = () => { clearInterval(timer); clearInterval(hb); };
    req.on('close', cleanup);
    req.on('error', cleanup);
  }

  // ───────────────────────── 路由分发 ─────────────────────────
  // ───────────────────────── 示例库（运营维护，推送给顾客） ─────────────────────────
  // 数据源：default_assets 表（全局示例模板）。顾客通过 ensureUserDefaults 在注册/登录时
  // 自动获得副本（is_default=TRUE）；本模块提供后台 CRUD + 手动一键推送。

  // 把 tags 入参归一化为 JSONB 存储字符串（接受数组 / 逗号分隔字符串）
  function normalizeTags(v) {
    if (Array.isArray(v)) return JSON.stringify(v.filter(Boolean).map(String));
    if (typeof v === 'string' && v.trim()) {
      return JSON.stringify(v.split(',').map((s) => s.trim()).filter(Boolean));
    }
    return '[]';
  }

  async function listSamples() {
    const r = await pg().query(
      'SELECT id,key,title,type,thumbnail,full_url,prompt,model,ratio,category,status,sort,tags,created_at FROM default_assets ORDER BY sort ASC, created_at ASC');
    return { samples: r.rows };
  }

  async function createSample(body) {
    const key = (body.key || '').toString().trim() || ('sample-' + crypto.randomUUID().slice(0, 8));
    const id = 'da-' + crypto.randomUUID();
    const title = (body.title || '').toString().trim();
    const type = body.type || 'image';
    const category = body.category || 'generated';
    const ratio = body.ratio || '1:1';
    const model = (body.model || '').toString();
    const thumbnail = (body.thumbnail || '').toString();
    const fullUrl = (body.fullUrl || body.full_url || '').toString();
    const prompt = (body.prompt || '').toString();
    const status = body.status || 'success';
    const sort = Number.isFinite(+body.sort) ? +body.sort : 0;
    const ex = await pg().query('SELECT 1 FROM default_assets WHERE key=$1', [key]);
    if (ex.rows.length) throw new Error('示例 key 已存在：' + key);
    await pg().query(
      `INSERT INTO default_assets (id,key,title,type,thumbnail,full_url,prompt,model,ratio,source,category,status,sort,tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'default',$10,$11,$12,$13::jsonb)`,
      [id, key, title, type, thumbnail, fullUrl, prompt, model, ratio, category, status, sort, normalizeTags(body.tags)]
    );
    return { ok: true, id, key };
  }

  async function updateSample(id, body) {
    // 只更新允许的字段；不改 key（保持默认库稳定性，避免已推送副本 orphan）
    const fields = [];
    const vals = [];
    let i = 1;
    const set = (col, v) => { fields.push(`${col}=$${i}`); vals.push(v); i++; };
    if (body.title !== undefined) set('title', body.title);
    if (body.type !== undefined) set('type', body.type);
    if (body.category !== undefined) set('category', body.category);
    if (body.ratio !== undefined) set('ratio', body.ratio);
    if (body.model !== undefined) set('model', body.model);
    if (body.thumbnail !== undefined) set('thumbnail', body.thumbnail);
    if (body.fullUrl !== undefined || body.full_url !== undefined) set('full_url', body.fullUrl || body.full_url || '');
    if (body.prompt !== undefined) set('prompt', body.prompt);
    if (body.status !== undefined) set('status', body.status);
    if (body.sort !== undefined) set('sort', Number.isFinite(+body.sort) ? +body.sort : 0);
    if (body.tags !== undefined) {
      fields.push(`tags=$${i}::jsonb`);
      vals.push(normalizeTags(body.tags));
      i++;
    }
    if (fields.length === 0) return { ok: true, noop: true };
    vals.push(id);
    await pg().query(`UPDATE default_assets SET ${fields.join(',')} WHERE id=$${i}`, vals);
    return { ok: true };
  }

  async function deleteSample(id) {
    await pg().query('DELETE FROM default_assets WHERE id=$1', [id]);
    return { ok: true };
  }

  // 把示例库当前条目批量拷贝给所有非 admin 用户（幂等：已有 default_key 副本则跳过）。
  // 顾客端 /api/media 按 owner 隔离，且 is_default=TRUE 标记可识别、可删除。
  async function pushSamplesToUsers() {
    const tpl = await pg().query('SELECT * FROM default_assets ORDER BY sort ASC, created_at ASC');
    if (!tpl.rows.length) return { ok: true, pushed: 0, users: 0, totalUsers: 0, note: '示例库为空，无可推送内容' };
    const users = await pg().query("SELECT id FROM users WHERE role<>'admin'");
    let copied = 0, usersTouched = 0;
    for (const u of users.rows) {
      let perUser = 0;
      for (const t of tpl.rows) {
        try {
          const ex = await pg().query('SELECT 1 FROM media WHERE user_id=$1 AND default_key=$2 LIMIT 1', [u.id, t.key]);
          if (ex.rows.length) continue;
          const mid = 'def-' + crypto.randomUUID();
          await pg().query(
            `INSERT INTO media (id,title,type,thumbnail,full_url,prompt,model,ratio,source,is_favorite,is_deleted,oss_url,oss_object_key,oss_uploaded,category,status,error_message,failed_at,created_at,user_id,is_default,default_key,tags)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'default',FALSE,FALSE,$9,$10,$11,$12,$13,$14,NULL,$15,$16,TRUE,$17,$18::jsonb)`,
            [mid, t.title, t.type, t.thumbnail, t.full_url || t.thumbnail, t.prompt, t.model, t.ratio,
             t.oss_url || '', t.oss_object_key || '', t.oss_uploaded || false, t.category, t.status || 'success', t.error_message || '',
             t.created_at || new Date().toISOString(), u.id, t.key, JSON.stringify(t.tags || [])]
          );
          copied++; perUser++;
        } catch (e) {
          console.warn('[Samples][push] 拷贝失败 user=%s key=%s :', u.id, t.key, e.message);
        }
      }
      if (perUser > 0) usersTouched++;
    }
    return { ok: true, pushed: copied, users: usersTouched, totalUsers: users.rows.length };
  }

  async function handleAdmin(req, res, url, method) {
    if (!hasPg()) return sendJSON(res, 503, { error: '数据库不可用' });
    if (!requireAdmin(req)) return sendJSON(res, 403, { error: '需要管理员权限' });
    const actorId = req.user.id;
    const query = req.query || {};

    if (url === '/api/admin/users' && method === 'GET') {
      return sendJSON(res, 200, await listUsers(query));
    }
    let     m = url.match(/^\/api\/admin\/users\/([^/]+)\/credits$/);
    if (m && method === 'POST') {
      const body = await parseBody(req);
      try { return sendJSON(res, 200, await recharge(decodeURIComponent(m[1]), body.amount, body.note, actorId)); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    m = url.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
    if (m && method === 'POST') {
      if (decodeURIComponent(m[1]) === actorId) return sendJSON(res, 400, { error: '不能操作自己' });
      const body = await parseBody(req);
      try { return sendJSON(res, 200, await setUserStatus(decodeURIComponent(m[1]), body.status)); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    m = url.match(/^\/api\/admin\/users\/([^/]+)\/role$/);
    if (m && method === 'PUT') {
      if (decodeURIComponent(m[1]) === actorId) return sendJSON(res, 400, { error: '不能操作自己' });
      const body = await parseBody(req);
      try { return sendJSON(res, 200, await setUserRole(decodeURIComponent(m[1]), body.role)); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    m = url.match(/^\/api\/admin\/users\/([^/]+)$/);
    if (m && method === 'DELETE') {
      if (decodeURIComponent(m[1]) === actorId) return sendJSON(res, 400, { error: '不能删除自己' });
      try { return sendJSON(res, 200, await deleteUser(decodeURIComponent(m[1]))); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    if (url === '/api/admin/transactions' && method === 'GET') {
      return sendJSON(res, 200, await listTransactions(query));
    }
    if (url === '/api/admin/agents' && method === 'GET') return sendJSON(res, 200, await listAgents());
    if (url === '/api/admin/agents' && method === 'POST') {
      const body = await parseBody(req);
      try { return sendJSON(res, 200, await upsertAgent(body)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    m = url.match(/^\/api\/admin\/agents\/([^/]+)\/toggle$/);
    if (m && method === 'PUT') {
      const body = await parseBody(req);
      await toggleAgent(decodeURIComponent(m[1]), body.enabled);
      return sendJSON(res, 200, { ok: true });
    }
    m = url.match(/^\/api\/admin\/agents\/([^/]+)\/providers$/);
    if (m && method === 'GET') return sendJSON(res, 200, await listAgentProviders(decodeURIComponent(m[1])));
    if (url === '/api/admin/agent-providers' && method === 'GET') return sendJSON(res, 200, await listAgentProviders(null));
    if (url === '/api/admin/agent-providers' && method === 'POST') {
      const body = await parseBody(req);
      try { return sendJSON(res, 200, await upsertAgentProvider(body)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    if (url === '/api/admin/agent-rules' && method === 'GET') return sendJSON(res, 200, await listAgentRules());
    if (url === '/api/admin/agent-rules' && method === 'POST') {
      const body = await parseBody(req);
      try { return sendJSON(res, 200, await upsertAgentRule(body)); } catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    m = url.match(/^\/api\/admin\/agent-rules\/([^/]+)\/toggle$/);
    if (m && method === 'PUT') {
      const body = await parseBody(req);
      await toggleAgentRule(decodeURIComponent(m[1]), body.enabled);
      return sendJSON(res, 200, { ok: true });
    }
    if (url === '/api/admin/audit' && method === 'GET') {
      const r = await pg().query(
        'SELECT id, actor_id, action, target, detail, created_at FROM audit_logs ORDER BY id DESC LIMIT 100');
      return sendJSON(res, 200, r.rows.map((x) => ({
        id: Number(x.id), actorId: x.actor_id, action: x.action, target: x.target,
        detail: x.detail || {}, createdAt: x.created_at,
      })));
    }

    // ───────────────── 示例库（运营维护，推送给顾客） ─────────────────
    // 注：必须放在 monitor/logbus 闸门之前，避免未注入 monitor 时 503。
    if (url === '/api/admin/samples' && method === 'GET') {
      return sendJSON(res, 200, await listSamples());
    }
    if (url === '/api/admin/samples' && method === 'POST') {
      const body = await parseBody(req);
      try { return sendJSON(res, 200, await createSample(body)); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    m = url.match(/^\/api\/admin\/samples\/push$/);
    if (m && method === 'POST') {
      try { return sendJSON(res, 200, await pushSamplesToUsers()); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    m = url.match(/^\/api\/admin\/samples\/([^/]+)$/);
    if (m && method === 'PUT') {
      const body = await parseBody(req);
      try { return sendJSON(res, 200, await updateSample(decodeURIComponent(m[1]), body)); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }
    if (m && method === 'DELETE') {
      try { return sendJSON(res, 200, await deleteSample(decodeURIComponent(m[1]))); }
      catch (e) { return sendJSON(res, 400, { error: e.message }); }
    }

    // ───────────────── 核心错误历史（#449/#450 持久化查询） ─────────────────
    // 依赖 syslog 模块（由 server.js 注入 ctx）。syslog 为 null 时 → 503。
    if (!syslog) return sendJSON(res, 503, { error: '错误日志模块未启用' });
    if (url === '/api/admin/errors' && method === 'GET') {
      try { return sendJSON(res, 200, await syslog.queryErrors(query)); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }
    if (url === '/api/admin/errors' && method === 'DELETE') {
      try { return sendJSON(res, 200, await syslog.clearErrors((query.category || '').trim())); }
      catch (e) { return sendJSON(res, 500, { error: e.message }); }
    }

    // ───────────────── 实时监控 · API 活动流 ─────────────────
    // 注：依赖 monitor 模块（由 server.js 注入 ctx）。monitor 为 null 时 → 503。
    if (!monitor) return sendJSON(res, 503, { error: '监控模块未启用' });
    if (url === '/api/admin/monitor/snapshot' && method === 'GET') {
      return sendJSON(res, 200, monitor.getSnapshot());
    }
    if (url === '/api/admin/monitor/stream' && method === 'GET') {
      return monitor.stream(req, res);                  // SSE(自带 writeHead/end)
    }
    if (url === '/api/admin/monitor/clear' && method === 'POST') {
      monitor.clear();
      return sendJSON(res, 200, { ok: true });
    }

    // ───────────────── 实时日志 · 数据库/Redis/控制台 ─────────────────
    // 注：依赖 logbus 模块（由 server.js 注入 ctx）。logbus 为 null 时 → 503。
    if (!logbus) return sendJSON(res, 503, { error: '日志总线未启用' });
    if (url === '/api/admin/logs/snapshot' && method === 'GET') {
      return sendJSON(res, 200, logbus.getSnapshot());
    }
    if (url === '/api/admin/logs/stream' && method === 'GET') {
      return logbus.stream(req, res);                    // SSE
    }
    if (url === '/api/admin/logs/clear' && method === 'POST') {
      logbus.clear();
      return sendJSON(res, 200, { ok: true });
    }

    return sendJSON(res, 404, { error: 'Not Found' });
  }

  return { handleAdmin, streamConsole, requireAdmin };
}

function rand() { return require('crypto').randomBytes(6).toString('hex'); }

module.exports = { createAdmin };
