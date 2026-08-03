# Phase 0 — nginx 七层限流验证报告

> 日期：2026-08-02　|　目的：验证 `deploy/nginx.conf` 的 `limit_req` 在真实 nginx 下生效
> 方法：本地下载 nginx 1.27.4 Windows 版（免安装），监听 `:8080` 反代到后端 `:3001`，用 `deploy/loadtest.mjs` 打 `:8080`。

## 复现步骤（本地 Windows）

```bash
# 1) 下载并解压 nginx（已存在于 E:/nginx_test/nginx-1.27.4）
# 2) 用相对 -c 启动（避免 Git Bash /e/ 路径被 Windows 二进制加倍）
cd E:/nginx_test/nginx-1.27.4
./nginx.exe -c conf/nginx.windows.conf        # 后台常驻
# 3) 压测（见下）
# 4) 关闭
./nginx.exe -c conf/nginx.windows.conf -s stop
```

> 注：Windows 二进制不认 `/e/...` 绝对路径（会被加倍成 `/e/e/...`）。必须把 conf 放进 nginx 目录内、用相对 `-c conf/xxx.conf` 启动。Windows 版 conf 在本地 `E:/nginx_test/nginx-1.27.4/conf/nginx.windows.conf`（**不在仓库内**，仓库里的是 Linux 版 `deploy/nginx.conf`）。

## TEST A — `api_limit`（50r/s, burst 100）on `/api/media`

| 指标 | 值 |
|------|-----|
| 并发 | 100 |
| 总请求 | 500 |
| 通过到后端(401) | 111 |
| **nginx 503 拦截** | **389** |
| 状态码 | 503=389, 401=111 |

**解读**：宽松层在 100 并发突发下放开 ~111 个（burst 100 + 少许），其余 **389 个被 nginx 直接 503 掉**，根本没打到后端。洪水被七层挡住。

## TEST B — `auth_limit`（10r/s, burst 20）on `/api/auth/login`

| 指标 | 值 |
|------|-----|
| 并发 | 30 |
| 总请求 | 30 |
| 401（到达后端，密码错） | 10 |
| 429（后端 10/60s 限额拦截） | 11 |
| **503（nginx burst 超限拦截）** | **9** |
| 状态码 | 401=10, 429=11, 503=9 |

**解读**：两层防御同时可见——
- nginx 先卡 `burst=20`，超出的 **9 个直接 503**；
- 放行的请求里有 11 个撞上**后端** `10/60s` 登录限额 → 429；
- 仅 10 个真正到达后端逻辑（返回 401）。
这正是「nginx 10r/s 快挡 + 后端 10/60s 慢挡」的分层设计。

## 结论

- `deploy/nginx.conf` 的 `limit_req` 在真实 nginx 下**生效且符合预期**：`api_limit` 兜洪水（503），`auth_limit` 双层 + 后端 429 协同。
- `location = /api/healthz` 按设计**豁免限流**（探测直通），验证时已确认 `:8080/api/healthz` 正常返回后端 JSON。
- Phase 0 七层防护闭环完成（nginx limit_req + 后端固定窗口 + Redis 降级 + healthz）。

## 生产注意点

- **X-Forwarded-For 传播**：本测试 nginx 与后端同机，nginx 写入的 `XFF=$remote_addr=127.0.0.1`，因此后端 `clientIp()` 取到的是 `127.0.0.1`（所有代理流量共用一个限额桶）。**生产环境** nginx 面向真实客户端，`XFF` 为真实客户端 IP，后端按真实 IP 限额——行为正确。但若在 nginx 之前还有别的反代，需确保只信任来自 nginx 的 `XFF`，否则客户端可伪造 `XFF` 绕过限额。
- **nginx 503 vs 后端 429**：`limit_req` 默认返回 503。前端如需区分「被限流」与「后端拒绝」，可加 `limit_req_status 429;`（nginx 1.27+ 支持）让七层也返回 429，提示更一致。
- 本验证未覆盖：`client_max_body_size 50m` 大文件上传、gzip 实际压缩比、TLS 层（conf 里是注释 stub）。
