# Mycelia Security Audit

**Date**: 2026-03-25
**Scope**: `/backend/` — routes, auth, WebSocket handlers, middleware, config
**Method**: Static code analysis using Agentic Zero-Trust framework

---

## Summary

| Severity | Count |
|----------|-------|
| 🔴 Critical / High | 3 |
| 🟡 Medium | 8 |
| 🟢 Low / Informational | 4 |

---

## 🔴 Critical / High

### H1 — Deno `--allow-all` (`-A`) permissions
**File**: `deno.json:3-4`
**Risk**: Any exploited vulnerability has full system access — filesystem, network, env, process exec.
**Fix**: Replace `-A` with scoped flags: `--allow-net --allow-read --allow-write=.,/tmp --allow-env --allow-run=ffmpeg --allow-sys`

---

### H2 — Placeholder secrets in `.env.example`
**File**: `.env.example:74,87,117,127`
**Risk**: `password`, `change-me-please`, and predictable token values may be copied into production.
**Values at risk**:
- `SECRET_KEY=change-me-please`
- `MONGO_INITDB_ROOT_PASSWORD=password`
- `REDIS_PASSWORD=password`
- `MYCELIA_TOKEN=mycelia_1111...`
- `MYCELIA_CLIENT_ID=1111...`

**Fix**: Replace all with empty strings; require users to generate values via setup script.

---

### H3 — Overly permissive default policy at first-run setup
**File**: `backend/app/routes/setup.ts:86-88`
**Risk**: First API key is always granted `resource:"**", action:"**"` with no option to restrict.
**Note**: Intentional for bootstrap; flagged for awareness. All subsequent keys should use least-privilege scopes.

---

## 🟡 Medium

### M1 — Tokens accepted via HTTP URL query parameters
**File**: `backend/app/lib/auth/core.server.ts:135-153`
**Risk**: Tokens in URLs are logged in HTTP server logs, browser history, and referrer headers — violates OAuth2 spec.
**Fix**: Remove URL query param token fallback for HTTP requests; require `Authorization: Bearer` header only.

---

### M2 — WebSocket token in URL query parameter
**File**: `backend/app/services/audio.websocket.server.ts:831-835`
**Risk**: Same token-in-URL leakage risk. Token appears in server access logs.
**Note**: Kept for IoT/OMI hardware device compatibility where custom headers are not supported.

---

### M3 — WebSocket auth happens after connection upgrade
**File**: `backend/server.ts:176-245`
**Risk**: Unauthenticated clients establish WebSocket connections before auth check — allows resource exhaustion.
**Fix**: Add token verification before calling `wss.handleUpgrade()`; reject at socket level if invalid.

---

### M4 — Rate limiter fails open (Redis unavailability disables rate limiting)
**File**: `backend/app/utils/rateLimit.ts:98-102`
**Risk**: If Redis is down, the catch block silently allows all requests through — rate limiting is disabled without alerting.
**Fix**: Fail closed: return 503 when rate limiting check fails.

---

### M5 — Rate limiting not applied to upload endpoints
**File**: `backend/routes.ts:39,41`
**Risk**: `/api/files/upload` and `/api/audio/upload` have no rate limits — vulnerable to storage exhaustion attacks.
**Fix**: Apply `withRateLimit` to upload handlers.

---

### M6 — Permissive CORS — no origin whitelist
**File**: `backend/server.ts:148-150`
**Risk**: No `origin` restriction on CORS config; accepts requests from any origin.
**Fix**: Whitelist `MYCELIA_FRONTEND_HOST` and known dev origins.

---

### M7 — Sensitive user data logged verbatim
**Files**:
- `backend/app/routes/api.chat.ts:65` — full chat message content logged
- `backend/app/routes/oauth.authorize.ts:190-196` — `redirect_uri` and `scope` logged

**Risk**: User messages and OAuth metadata persisted in `server.log` — PII exposure risk.
**Fix**: Remove debug message logging; strip sensitive fields from OAuth logs.

---

### M8 — No channel name validation on WebSocket subscribe
**File**: `backend/app/services/updates.websocket.server.ts:83-116`
**Risk**: Client-supplied channel names passed directly to Redis subscribe without sanitization — potential Redis channel injection.
**Fix**: Validate channel names against an allowlist pattern before subscribing.

---

## 🟢 Low / Informational

### L1 — `ALLOW_INSECURE_TRANSPORT=true` default in example config
**File**: `.env.example:33`
**Risk**: Development flag that disables TLS validation; could leak into production configs.
**Fix**: Default to `false`; require explicit opt-in for local dev.

---

### L2 — Error messages may expose internal details to clients
**File**: `backend/app/middleware/errorHandler.ts:65-77`
**Risk**: `error.message` returned directly to API clients in production — may include DB connection strings, file paths.
**Fix**: Return generic "Internal server error" in production; detailed message only in development.

---

### L3 — No CSRF protection on OAuth consent routes
**File**: `backend/app/routes/oauth.authorize.ts`
**Risk**: OAuth consent and token exchange endpoints vulnerable to CSRF if session cookies are used.
**Mitigation**: Current implementation uses bearer tokens (not cookies), which are not CSRF-vulnerable by default. Low risk in current architecture.

---

### L4 — No audio file integrity check before FFmpeg processing
**File**: `backend/app/routes/api.audio.stream.ts`
**Risk**: Files passed to FFmpeg without format validation; malformed files could cause FFmpeg crashes or unexpected behavior.
**Fix**: Validate file magic bytes / MIME type before processing.

---

## Fixes Applied

| # | Issue | Status |
|---|-------|--------|
| H1 | Scope Deno permissions | ✅ Fixed |
| H2 | Remove placeholder secrets | ✅ Fixed |
| M1 | Remove URL token (HTTP) | ✅ Fixed |
| M3 | WebSocket pre-auth before upgrade | ✅ Fixed |
| M4 | Rate limiter fail closed | ✅ Fixed |
| M5 | Rate limiting on upload endpoints | ✅ Fixed |
| M6 | CORS origin whitelist | ✅ Fixed |
| M7 | Remove sensitive logging | ✅ Fixed |
| M8 | Channel name validation | ✅ Fixed |
| L1 | ALLOW_INSECURE_TRANSPORT default | ✅ Fixed |
| L2 | Generic error messages in production | ✅ Fixed |
| H3 | Setup default policy | ⚠️ Intentional (bootstrap requirement) |
| M2 | WebSocket URL token (IoT compat) | ⚠️ Kept with comment |
| L3 | CSRF on OAuth | ⚠️ Low risk — bearer tokens used, not cookies |
| L4 | FFmpeg file validation | ⚠️ Out of scope for this pass |
