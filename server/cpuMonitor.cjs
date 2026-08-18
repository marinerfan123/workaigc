'use strict';
// ─── CPU-based 自适应负载降级（adaptive load shedder）───
// 监控本进程 CPU 用量；超阈值 → 进入 SHED 态（拒绝新任务，返 503）；低于恢复阈值 → 恢复正常。
// 进程级测量（不依赖 system loadavg），cluster 模式下每个 worker 独立判断。
// 典型场景：图像/视频生成是 CPU-bound，单 worker 跑满会占满 1 核。
// 2 核机器上 2 worker 各 80% ≈ 系统 80%（1.6 核），超过即降级保系统不卡死。
//
// 设计要点：
// - 测量：setInterval 每 CPU_PERIOD_MS 采样 process.cpuUsage() delta，归一化到「单核占比」
// - 滞回（Hysteresis）：SHED_THRESHOLD 触发 / RECOVER_THRESHOLD 恢复，避免在边界抖动反复切换
// - 持续时间窗：必须连续超阈值 SHED_HOLD_MS 才进入 SHED（避免瞬时尖峰误触发）
// - 不杀 in-flight：仅 dispatcher 入口拒绝新任务，正在跑的请求自然完成
// - 优雅降级：SHED 态返 HTTP 503 + Retry-After，前端可重试

const CPU_PERIOD_MS  = 2000;   // 采样间隔
const SHED_THRESHOLD     = 0.80;   // 触发 SHED 的 CPU 占比（80%）
const RECOVER_THRESHOLD  = 0.60;   // 退出 SHED 的 CPU 占比（60%）
const SHED_HOLD_MS   = 5000;   // 连续超阈值持续 5s 才进 SHED
const RECOVER_HOLD_MS    = 10000;  // 连续低于阈值持续 10s 才退出 SHED

let SHED = false;
let aboveSince = 0;        // 首次跨过 SHED_THRESHOLD 的时间戳
let belowSince = 0;        // 首次低于 RECOVER_THRESHOLD 的时间戳
let lastSwitchAt = 0;
let lastCpuPercent = 0;
let lastSampleAt = Date.now();
let lastCpu = process.cpuUsage();
let timer = null;
let started = false;

function tick() {
  const now = Date.now();
  const elapsed = now - lastSampleAt;
  if (elapsed < CPU_PERIOD_MS) return; // 防御
  const cur = process.cpuUsage(lastCpu);
  const totalUs = cur.user + cur.system;
  // 归一化到「单核占比」：totalUs (μs) / 1000 / elapsed (ms) → 0~N（>1 表示多线程占用）
  const cpuPercent = (totalUs / 1000) / elapsed;
  lastCpuPercent = cpuPercent;
  lastCpu = process.cpuUsage();
  lastSampleAt = now;

  if (!SHED) {
    if (cpuPercent >= SHED_THRESHOLD) {
      if (!aboveSince) aboveSince = now;
      if (now - aboveSince >= SHED_HOLD_MS) {
        SHED = true;
        lastSwitchAt = now;
        belowSince = 0;
        console.log(`[cpuMonitor] 进入 SHED 态（CPU=${(cpuPercent*100).toFixed(1)}% 持续 ${((now-aboveSince)/1000).toFixed(1)}s 超 ${(SHED_THRESHOLD*100).toFixed(0)}%）`);
      }
    } else {
      aboveSince = 0;
    }
  } else {
    if (cpuPercent < RECOVER_THRESHOLD) {
      if (!belowSince) belowSince = now;
      if (now - belowSince >= RECOVER_HOLD_MS) {
        SHED = false;
        lastSwitchAt = now;
        aboveSince = 0;
        console.log(`[cpuMonitor] 退出 SHED 态（CPU=${(cpuPercent*100).toFixed(1)}% 持续 ${((now-belowSince)/1000).toFixed(1)}s 低于 ${(RECOVER_THRESHOLD*100).toFixed(0)}%）`);
      }
    } else {
      belowSince = 0;
    }
  }
}

function start() {
  if (started) return;
  started = true;
  lastCpu = process.cpuUsage();
  lastSampleAt = Date.now();
  timer = setInterval(tick, CPU_PERIOD_MS);
  if (timer.unref) timer.unref(); // 不阻止进程退出
  console.log(`[cpuMonitor] 已启动（采样 ${CPU_PERIOD_MS}ms | SHED>${(SHED_THRESHOLD*100).toFixed(0)}%×${SHED_HOLD_MS/1000}s | 恢复<${(RECOVER_THRESHOLD*100).toFixed(0)}%×${RECOVER_HOLD_MS/1000}s）`);
}

function isShedding() { return SHED; }
function getCpuPercent() { return lastCpuPercent; }
function getStatus() {
  return {
    shedding: SHED,
    cpuPercent: lastCpuPercent,
    shedThreshold: SHED_THRESHOLD,
    recoverThreshold: RECOVER_THRESHOLD,
    aboveSince: aboveSince || null,
    belowSince: belowSince || null,
    lastSwitchAt: lastSwitchAt || null,
    sampling: { intervalMs: CPU_PERIOD_MS, lastSampleAt },
  };
}

module.exports = {
  start, isShedding, getCpuPercent, getStatus,
  SHED_THRESHOLD, RECOVER_THRESHOLD,
};
