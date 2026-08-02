// server/billing.cjs — Phase A 三段式积分计费（CommonJS，仅依赖 pg Pool）
// 复刻 docs/phase-a/billing.js，加 ensureOnce 幂等包装（L4）。
// 单位：虚拟积分(credits)，见 MASTER_DESIGN_v2 §2.3 A.6。
const billing = {
  // 原子扣减：WHERE credits>=amount 一行搞定，无需事务（不能用 SELECT FOR UPDATE 单语句陷阱，L1）
  async reserveCredits(pg, userId, amount, ref) {
    if (!amount || amount <= 0) return true; // 0 成本无需预留
    const r = await pg.query(
      `UPDATE users SET credits = credits - $1 WHERE id = $2 AND credits >= $1`,
      [amount, userId],
    );
    if (r.rowCount === 0) throw new Error('积分不足');
    await pg.query(
      `INSERT INTO credit_transactions (user_id, kind, amount, ref) VALUES ($1, 'reserve', $2, $3)`,
      [userId, amount, ref],
    );
    return true;
  },

  // 是否已记账该 ref 的某 kind（幂等判据）
  async _hasPosted(pg, ref, kind) {
    if (!ref) return false;
    const r = await pg.query(
      `SELECT 1 FROM credit_transactions WHERE ref = $1 AND kind = $2 LIMIT 1`,
      [ref, kind],
    );
    return r.rows.length > 0;
  },

  // commit：reserve 已扣余额，这里只记一笔 commit（含余额快照）。幂等：已 commit 则跳过（L4）
  async commitCredits(pg, userId, amount, ref) {
    if (!amount || amount <= 0) return true;
    if (await this._hasPosted(pg, ref, 'commit')) return true;
    await pg.query(
      `INSERT INTO credit_transactions (user_id, kind, amount, ref, balance_after)
       VALUES ($1, 'commit', $2, $3, (SELECT credits FROM users WHERE id = $1))`,
      [userId, amount, ref],
    );
    return true;
  },

  // release：生成失败补回余额。幂等：已 release 则跳过（L4，防崩溃重试双退）
  async releaseCredits(pg, userId, amount, ref) {
    if (!amount || amount <= 0) return true;
    if (await this._hasPosted(pg, ref, 'release')) return true;
    await pg.query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [amount, userId]);
    await pg.query(
      `INSERT INTO credit_transactions (user_id, kind, amount, ref) VALUES ($1, 'release', $2, $3)`,
      [userId, amount, ref],
    );
    return true;
  },

  // 对账兜底（L2/L3）：找回「running 超 30 分钟」但仍 reserve 未结算的任务，释放 held。
  // 由 Phase B 的定时 worker 调用；Phase A 仅导出备用。
  async findDanglingReserves(pg, staleMinutes = 30) {
    const r = await pg.query(
      `SELECT DISTINCT t.idempotency_key AS ref, t.user_id, t.cost
         FROM generation_tasks t
         LEFT JOIN credit_transactions c ON c.ref = t.idempotency_key AND c.kind = 'commit'
        WHERE t.status = 'running'
          AND t.created_at < NOW() - ($1 || ' minutes')::INTERVAL
          AND c.id IS NULL
          AND t.idempotency_key IS NOT NULL`,
      [String(staleMinutes)],
    );
    return r.rows;
  },
};

module.exports = billing;
