# OSS 存储配置与商业化永久访问方案

> Phase 1 主流化服务端最终化（dispatcher.cjs + assetFinalize.cjs）落地后的运维文档。
> 主流做法：业务服务器**不持有永久 AK/SK**；上传由后端签短期（1h）PUT 预签名；浏览器裸二进制 PUT；下载签 7d GET 预签名。
> 本文档为该方案落地时的**运维配置**与**商业化长期访问**补充说明。

---

## 一、OSS 桶 CORS 配置（**前置条件**，不配浏览器直传会失败）

`GET /api/oss/sign-upload` 签发的预签名 URL 是浏览器要直接 `fetch(PUT)` 过去的——需要 OSS 桶允许浏览器跨域请求。

### 阿里云 OSS

1. 控制台 → OSS → 选择桶 → **数据安全 / 跨域设置 / CORS 规则** → 新建规则：
   - 来源：`https://your.domain`（生产）/ `http://localhost:5173`（开发）
   - 允许 Methods：**PUT, POST, GET, HEAD, OPTIONS**
   - 允许 Headers：`*`（最小集：`Authorization, Content-Type, Content-MD5, x-oss-date`）
   - 暴露 Headers：`ETag, x-oss-request-id`（让前端能读回服务端响应）
   - 缓存时间：`600`（秒，调试可设短一些）
2. 或 Terraform：
   ```hcl
   resource "alicloud_oss_bucket" "main" {
     bucket = "your-bucket-name"
   }
   resource "alicloud_oss_bucket_cors" "cors" {
     bucket = alicloud_oss_bucket.main.id
     cors_rule {
       allowed_origins = ["https://your.domain", "http://localhost:5173"]
       allowed_methods = ["PUT", "POST", "GET", "HEAD", "OPTIONS"]
       allowed_headers = ["*"]
       expose_headers  = ["ETag", "x-oss-request-id"]
       max_age_seconds = 600
     }
   }
   ```

### 腾讯云 COS

1. 控制台 → COS → 选择桶 → **权限管理 / 跨域访问 CORS 设置** → 添加规则：
   - 来源 Origin：`https://your.domain`、`http://localhost:5173`
   - Methods：**PUT, POST, GET, HEAD, OPTIONS**
   - 允许 Headers：`*`
   - 暴露 Headers：`ETag, Content-Length, x-cos-request-id`
   - 超时：`600`
2. 或 COS XML API（自动化）：
   ```
   PUT /?cors HTTP/1.1
   Host: <bucket>-<appid>.cos.ap-shanghai.myqcloud.com
   Content-Type: application/xml
   ...
   <CORSConfiguration>
     <CORSRule>
       <AllowedOrigin>https://your.domain</AllowedOrigin>
       <AllowedMethod>PUT</AllowedMethod>
       <AllowedMethod>POST</AllowedMethod>
       <AllowedMethod>GET</AllowedMethod>
       <AllowedMethod>HEAD</AllowedMethod>
       <AllowedMethod>OPTIONS</AllowedMethod>
       <AllowedHeader>*</AllowedHeader>
       <ExposeHeader>ETag</ExposeHeader>
       <ExposeHeader>x-cos-request-id</ExposeHeader>
       <MaxAgeSeconds>600</MaxAgeSeconds>
     </CORSRule>
   </CORSConfiguration>
   ```

### 调试技巧
- 浏览器 Console 若出现 `CORS preflight ... Access-Control-Allow-Origin` 缺失 → 来源/方法/头未在 OSS 桶 CORS 列表中
- 若预签名 URL 自己带 `?OSSAccessKeyId=...&Signature=...&Expires=...` 但 PUT 仍失败 → 检查桶 `读写权限`（必须公共读=否，PUT 由签名授权即可）和网络（OSS 端点地域白名单）
- 用 curl 模拟 PUT：最容易隔离「CORS」与「签名」两类问题
  ```bash
  curl -X PUT --data-binary "@local.png" \
       -H "Content-Type: image/png" \
       "$PUT_URL"
  # 200 = 成功；403 SignatureDoesNotMatch = 签名错；403 AccessDenied = 桶策略
  ```

---

## 二、7 天 GET 预签名 → 商业化长期访问：3 套方案横向对比

> Phase 1 落地后，`media.oss_url` 存的是 GET 7d 预签名 URL；7 天后链接失效。
> 商业化媒体（用户上传的图片 / 视频 / 创作结果）必须能长期访问，否则用户看到「过期图」是大事故。
> 主流三套方案对比：

| 方案 | 适用场景 | 配置成本 | 运维成本 | 风险 |
|------|----------|---------|---------|------|
| **A. 公共读桶（直接拼 objectKey）** | 桶内容均为公开（注册页 logo、公开示例图） | 极低（OSS 控制台勾选） | 极低 | 不能用于**私人资产**（任意人可永久访问） |
| **B. CDN + 自有域名 + 私有桶回源** | **推荐商业项目**：所有用户资产走 CDN，桶私有，CDN 签名/免鉴权策略由 CDN 决定 | 中（要买 CDN 服务 + 配回源 Host + HTTPS 证书） | 中（CDN 配置变更） | CDN 与 OSS 双向同步；CDN 缓存时间与签名 URL 一致性 |
| **C. 不存 GET URL，只存 objectKey + 服务端按需重签** | 最高安全性（永远不外传 GET URL，60s 短的也行） | 中（前端需在加载媒体前调 `/api/oss/sign-get?key=xxx`） | 中（每次访问多一次 RTT；可 Redis 缓存重签结果 7d） | 多了 RTT / 多了一个端点要防护 |

### 推荐：**方案 B（CDN + 自有域名）** — 本项目商业化选型

理由（与主流商业项目对齐）：
1. 用户访问媒体走自有域名（CDN 边缘节点就近），不暴露 OSS 真域名/HTTP 状态
2. 私有 OSS 桶 → 不会被别人扫描劫持（公共桶易被穷举 objectKey）
3. CDN 提供 HTTPS / HTTP/3 / 缓存 / WAF 一套能力，无需自建
4. 商业项目对外呈现自有品牌

#### 主流参考实现
- 阿里云：OSS 桶私有 + CDN 加速域名 + 源站信息选 OSS 域名 + 回源 HOST 设为桶默认域名 + 缓存策略「不缓存」或「按业务」
- 腾讯云：COS 桶私有 + CDN 加速 + COS 回源鉴权（如有需要用「回源鉴权」）

### Asset 表字段与代码层配合

`media` 表已经有 `provider_url`、`oss_url`、`oss_object_key`、`oss_uploaded`、`status` 五个字段，足够覆盖三套方案：

| 方案 | media.oss_url | media.oss_object_key | 备注 |
|------|---------------|---------------------|------|
| A 公共读 | 直接拼 `https://<endpoint>/<objectKey>` | 必有 | 公共资产 |
| **B CDN（推荐）** | `https://cdn.your.domain/<objectKey>` | 必有 | 大多数资产 |
| C 按需重签 | 空（前端调 `/api/oss/sign-get?key=...`） | 必有 | 重签 GET 60s 短期；前端自动续 |

> Phase 1 主流化保留：`oss.cjs` 的 `buildOssGetUrl(cfg, objectKey)` 已经按 provider 重签 GET URL，未来切换到 CDN 方案只需新增一个 `buildCdnUrl(cfg, key)`，或直接拼 `https://cdn.your.domain/${key}`。

---

## 三、运维清单（**正式上线前**逐条核对）

- [ ] OSS 桶 CORS 已按上文配置（应用域 + dev 域）
- [ ] OSS 桶读写权限：私桶（避免公共读带来的对外曝光）
- [ ] 用 curl 在**应用域**与 **dev 域**分别 PUT 一次 + GET 一次，确认跨域工作
- [ ] 后端 `OSS_TEST_SLOT_ID` 调试槽位的 `oss_config` 行为（`/api/oss/test`）能 200 返回「Bucket 可写」
- [ ] 后端 `await initDB()` 启动日志能看到 `[PG] 数据库表初始化完成`，且 `media` 表已自动加上 `task_id` / `provider_url` 两列
- [ ] 商业化 CDN 部署方案按本文件第二节方案 B 选型（推荐）
- [ ] 七天后抽样看部分老 task 的 `media.oss_url` 是否仍可访问；如不可见，按 CDN 方案 B 切换

---

## 四、与主流方案的对照

- Replicate：服务端拿到 provider URL → 服务端存自有存储（Replicate 自己 CDN）→ 直接发最终 URL。**对应本项目方案 B。**
- fal.ai：服务端 fetch + 自有 R2 存储 → 发最终 URL。**对应方案 B。**
- Stability：服务端存储（与 fal 类似）→ 发最终 URL。
- AWS S3 业界主流：S3 私有 + CloudFront CDN + 私有回源 + 自有域名。**对应方案 B。**

> 不沿用「公共桶直接拼 objectKey」的原因：商业项目用户资产必须受访问控制；公共桶易被恶意扫描穷举。

---

## 五、本项目商业化长期目标（与 OSS 关联的部分）

- 用户上传的参考图 / 生成的图 / 视频：走 **CDN + 自有域名**（方案 B）
- 系统公共示例图（assets/samples/*）：走**公共读 + 单独桶**（方案 A，与用户资产隔离）
- 应用内分享（分享链接）：若需要 60s 短链（防爬取），按方案 C 用「按需重签」端点
- 监控：CDN 命中率、GET 失败率、平均延迟，纳入后台实时监控

