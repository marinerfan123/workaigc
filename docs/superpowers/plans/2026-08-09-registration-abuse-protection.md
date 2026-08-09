# Registration Abuse Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect public registration from malformed input, injection-adjacent abuse, and automated account creation without changing the authenticated session or signup-credit contract.

**Architecture:** Keep PostgreSQL parameterized queries and the existing `users.email` uniqueness constraint as the persistence boundary. Add a small server-owned registration-security module that validates the request contract, enforces trusted-proxy-aware rate limits, and verifies a Cloudflare Turnstile token server-side. Both AuthPage and AuthModal submit the same proof and low-cost honeypot metadata; only the server decides whether registration is allowed.

**Tech Stack:** Node.js native HTTP server, PostgreSQL `pg`, Redis/ioredis, React 19, TypeScript, Vitest for frontend tests, Node `node:test` for new server-module tests.

## Global Constraints

- PostgreSQL remains the only authoritative durable store; do not add browser persistence or JSON fallbacks.
- Preserve `/api/auth/register` as the registration endpoint, its success response shape, secure cookie session creation, default-asset seeding, and signup-credit audit transaction.
- Do not put Turnstile secrets, test tokens, or provider credentials in source control, `.env.example`, Docker Compose defaults, browser bundles, or test fixtures.
- Production must reject registration when Turnstile is not configured or verification fails; development may explicitly bypass it only when no secret is configured.
- Trust `X-Forwarded-For` only when deployment explicitly opts into a trusted reverse proxy; direct app exposure must use the socket address.
- Keep the existing password minimum of six characters in this change to avoid silently breaking existing clients; add maximum lengths and type checks server-side.

---

### Task 1: Create and Test Server Registration-Security Primitives

**Files:**
- Create: `server/registration-security.cjs`
- Create: `server/__tests__/registration-security.test.cjs`

**Interfaces:**
- Produces `validateRegistrationPayload(body) -> { ok: true, value: { email, password, displayName, turnstileToken, honeypot, formStartedAt } } | { ok: false, error: string }`.
- Produces `isLikelyAutomatedSubmission({ honeypot, formStartedAt, now }) -> boolean`.
- Produces `verifyTurnstile({ token, remoteIp, fetchFn, secret, expectedHostnames }) -> Promise<{ ok: boolean, error?: string }>`.
- Consumes no database connection and accepts `fetchFn` as an injection point for deterministic tests.

- [ ] **Step 1: Write failing Node tests for the request contract**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRegistrationPayload, isLikelyAutomatedSubmission } = require('../registration-security.cjs');

test('rejects non-string or oversized registration fields before persistence', () => {
  assert.equal(validateRegistrationPayload({ email: { $gt: '' }, password: '123456' }).ok, false);
  assert.equal(validateRegistrationPayload({ email: 'a@b.com', password: 'x'.repeat(129) }).ok, false);
  assert.equal(validateRegistrationPayload({ email: 'USER@Example.com ', password: '123456' }).value.email, 'user@example.com');
});

test('treats a filled honeypot or a sub-two-second submit as automation', () => {
  assert.equal(isLikelyAutomatedSubmission({ honeypot: 'https://spam.example', formStartedAt: Date.now() - 500, now: Date.now() }), true);
  assert.equal(isLikelyAutomatedSubmission({ honeypot: '', formStartedAt: Date.now() - 3_000, now: Date.now() }), false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test server/__tests__/registration-security.test.cjs`

Expected: FAIL because `server/registration-security.cjs` does not exist.

- [ ] **Step 3: Implement the pure validation and heuristic functions**

```js
function validateRegistrationPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: '请求格式不正确' };
  if (typeof body.email !== 'string' || typeof body.password !== 'string') return { ok: false, error: '邮箱和密码格式不正确' };
  const email = body.email.trim().toLowerCase();
  const password = body.password;
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: '邮箱格式不正确' };
  if (password.length < 6 || password.length > 128) return { ok: false, error: '密码长度不符合要求' };
  if (displayName.length > 80 || /[\u0000-\u001F\u007F]/.test(displayName)) return { ok: false, error: '昵称格式不正确' };
  return { ok: true, value: { email, password, displayName, turnstileToken: String(body.turnstileToken || ''), honeypot: String(body.website || ''), formStartedAt: Number(body.formStartedAt) } };
}
```

- [ ] **Step 4: Add Turnstile verification tests and implementation**

```js
test('accepts only a successful Turnstile response for an expected hostname', async () => {
  const fetchFn = async () => ({ ok: true, json: async () => ({ success: true, hostname: 'app.example.com' }) });
  const result = await verifyTurnstile({ token: 'token', remoteIp: '203.0.113.9', secret: 'test-secret', expectedHostnames: ['app.example.com'], fetchFn });
  assert.deepEqual(result, { ok: true });
});
```

`verifyTurnstile` must POST URL-encoded `secret`, `response`, and `remoteip` to `https://challenges.cloudflare.com/turnstile/v0/siteverify`; reject missing tokens, non-OK HTTP responses, `success !== true`, and a hostname outside `expectedHostnames` when that allowlist is configured.

- [ ] **Step 5: Run the focused server tests**

Run: `node --test server/__tests__/registration-security.test.cjs`

Expected: PASS.

### Task 2: Apply Server-Side Registration Controls

**Files:**
- Modify: `server/ratelimit.cjs:5-26`
- Modify: `server/server.js:19-44, 1285-1318`
- Modify: `.env.example`

**Interfaces:**
- Consumes `validateRegistrationPayload`, `isLikelyAutomatedSubmission`, and `verifyTurnstile` from `registration-security.cjs`.
- Consumes `clientIp(req, { trustProxy })` from `ratelimit.cjs`.
- Produces unchanged successful registration payload `{ ok: true, user }`; rejection responses remain JSON and use 400/403/429/503 without revealing provider details.

- [ ] **Step 1: Extend client-IP tests before changing proxy behavior**

Add a `node:test` case proving a spoofed `X-Forwarded-For` is ignored when `trustProxy` is false and used only when it is true:

```js
assert.equal(clientIp({ headers: { 'x-forwarded-for': '198.51.100.7' }, socket: { remoteAddress: '127.0.0.1' } }, { trustProxy: false }), '127.0.0.1');
assert.equal(clientIp({ headers: { 'x-forwarded-for': '198.51.100.7' }, socket: { remoteAddress: '127.0.0.1' } }, { trustProxy: true }), '198.51.100.7');
```

- [ ] **Step 2: Implement explicit proxy trust and registration configuration**

Read `TRUST_PROXY`, `TURNSTILE_SECRET_KEY`, and comma-separated `TURNSTILE_EXPECTED_HOSTNAMES` once at server startup. Change `clientIp` to inspect `X-Forwarded-For` only when the explicit `trustProxy` option is true. Add these variables to `.env.example` with empty values and Chinese deployment comments; do not add defaults to Compose.

- [ ] **Step 3: Wire validation, bot checks, and two rate-limit dimensions into `handleRegister`**

Apply checks in this exact order: parse body; validate types/lengths; reject filled honeypot or implausibly fast form; apply IP limit; apply `sha256(email)` keyed email limit; verify Turnstile; then query/insert PostgreSQL. Use `crypto.createHash('sha256').update(email).digest('hex')` for the rate-limit key rather than raw email. Retain the existing IP limit of five registrations per minute and add an email limit of three attempts per hour.

In production, if no Turnstile secret is configured, return `503` with a generic registration-unavailable message and emit one startup warning. In development, allow the verification step only when no secret is configured; when a secret is present, always verify it.

- [ ] **Step 4: Guard duplicate-email races without leaking internals**

Catch PostgreSQL unique-violation code `23505` around the insert and return the existing `409 该邮箱已注册` response. Re-throw unrelated database errors for the existing request-level error path.

- [ ] **Step 5: Run focused server tests**

Run: `node --test server/__tests__/registration-security.test.cjs`

Expected: PASS, including spoofed proxy, malformed payload, honeypot, Turnstile, and duplicate-email cases.

### Task 3: Send Shared Registration Proof From Both UI Entrypoints

**Files:**
- Create: `src/components/auth/TurnstileChallenge.tsx`
- Modify: `src/pages/Auth/AuthPage.tsx:1-119`
- Modify: `src/components/AuthModal.tsx:1-120`
- Modify: `src/services/api.ts:638-646`
- Modify: `src/services/authStore.ts:37-42`

**Interfaces:**
- `TurnstileChallenge` receives `{ siteKey: string, onToken: (token: string) => void, onExpired: () => void }` and never exposes a secret.
- `register(email, password, displayName, proof)` accepts `proof: { turnstileToken: string, website: string, formStartedAt: number }`.
- `apiRegister` sends those fields unchanged to `/api/auth/register`.

- [ ] **Step 1: Write focused component/API tests for the shared registration payload**

Create a test that renders each registration entrypoint, fills the visible fields, and asserts its mocked `apiRegister` receives `website: ''`, a numeric `formStartedAt`, and the Turnstile token. Test a missing/expired token disables the production registration submit action.

- [ ] **Step 2: Implement the Turnstile wrapper without a new package**

Load `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit` once, render only when `VITE_TURNSTILE_SITE_KEY` is defined, and reset the token on expiry/error. Declare the minimal `window.turnstile` type locally. Do not put a provider secret in this component.

- [ ] **Step 3: Add accessible anti-bot form fields to both registration forms**

Use a visually off-screen text input named `website`, `tabIndex={-1}`, `autoComplete="off"`, and `aria-hidden="true"`; it must remain in the submitted payload. Capture `formStartedAt` when registration mode opens. Show a neutral “安全验证未完成” field error only when a configured challenge has no valid token. Do not reveal honeypot, timing, or provider-failure criteria to users.

- [ ] **Step 4: Unify registration validation and UI tokens**

Before invoking `register`, both entrypoints enforce the existing six-character minimum and email presence. Align error mapping and input `autoComplete` values. Replace emerald primary/focus styling with the project’s neutral card/accent/white-CTA tokens, but do not redesign unrelated authenticated pages.

- [ ] **Step 5: Run focused frontend tests**

Run: `npx vitest run src/__tests__/auth --config vitest.auth.config.ts`

Expected: PASS. The new config must include only `src/__tests__/auth/**/*.test.tsx` so reference projects under `refs/` are not collected.

### Task 4: Verify Deployment Behavior and Document Operations

**Files:**
- Modify: `.env.example`
- Modify: `deploy/PRE-LAUNCH-CHECKLIST.md`
- Modify: `docs/deployment-plan.md`
- Modify: `.codex/context/bug-ledger.md`

**Interfaces:**
- Documents required production variables: `TRUST_PROXY=true` only behind a proxy, `TURNSTILE_SECRET_KEY`, `TURNSTILE_EXPECTED_HOSTNAMES`, and frontend `VITE_TURNSTILE_SITE_KEY`.
- Documents the deliberate production fail-closed behavior when CAPTCHA configuration is absent or invalid.

- [ ] **Step 1: Add deployment checklist items**

Require a real Turnstile production hostname allowlist, correct proxy mode, and a manual registration test that verifies valid token success, invalid token rejection, filled honeypot rejection, rate-limit `429`, and cookie-based post-registration authentication.

- [ ] **Step 2: Run non-secret configuration checks**

Run: `docker compose config`

Expected: PASS with variables unset and no secret values printed. Confirm the application’s production path will reject new registration until real configuration is injected.

- [ ] **Step 3: Update the risk ledger**

Record the selected provider, the intentional development bypass, production fail-closed condition, trusted-proxy rule, verification commands, and any provider outage residual risk. Mark the registration-bot risk resolved only after staging validates the real provider callback.

## Self-Review

Spec coverage: parameterized SQL is retained and all registration fields gain type/length boundaries; automated traffic is checked with a server-verified challenge, honeypot/timing signal, trusted-client-IP limits, and email-hash limits; both UI entrypoints send the same proof; deployment and tests are specified.

Placeholder scan: no TBD or deferred implementation steps remain. Provider credentials and approved hostnames intentionally remain deployment-owned values rather than placeholders in source.

Type consistency: `proof` is produced by both forms, carried through `authStore.register` and `apiRegister`, and read as `turnstileToken`, `website`, and `formStartedAt` by `validateRegistrationPayload`.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-09-registration-abuse-protection.md`. Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks.
2. Inline Execution - execute tasks in this session with checkpoints.

The deployment must provide a Cloudflare Turnstile site key, secret key, and production hostname allowlist before the production fail-closed path can be enabled.
