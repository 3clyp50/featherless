# MCP-UI Hosted Render Workaround — Design

**Status:** Approved, ready for implementation planning
**Date:** 2026-05-11
**Owner:** Featherless MCP server

## Problem

Featherless visualization tools (`visualize_lab_trend`, `visualize_vitals`,
`visualize_patient_dashboard`) return MCP-UI resources of the form:

```json
{
  "type": "resource",
  "resource": {
    "uri": "ui://featherless/<tool>/<patient-id>/<ts>",
    "mimeType": "text/html",
    "text": "<HTML with Chart.js CDN scripts>"
  }
}
```

Prompt Opinion — the target host for the Agents Assemble challenge — does not
render `ui://` resources. It treats them as opaque text. Chart.js never
executes, dashboards never display.

Modifying Prompt Opinion is out of scope. The workaround must live entirely
inside the Featherless Worker.

## Goal

Surface the dashboard to Prompt Opinion users without losing MCP-UI
compatibility for spec-compliant hosts (MCP Inspector, future Prompt Opinion
versions, Cursor, etc.).

## Non-goals

- Replacing Chart.js with server-side rendering.
- Modifying Prompt Opinion or upstreaming an MCP-UI renderer.
- Persisting dashboards beyond a short demo window.

## Approach

The Worker hosts each rendered dashboard at a public route on its own origin,
keyed by an unguessable random token. The visualization tool response carries
both the original `ui://` resource (unchanged) and a new text content item
containing a markdown link to the hosted page. Prompt Opinion surfaces the
link as clickable plain text; the user opens it in a new tab where Chart.js
runs in a normal browser context.

## Architecture

```
┌─────────────────┐    tools/call           ┌──────────────────────┐
│ Prompt Opinion  │ ──────────────────────▶ │ Worker  POST /mcp    │
└─────────────────┘                         └──────────┬───────────┘
        ▲                                              │ 1. build HTML
        │ tool response:                               │ 2. token = 32B hex
        │   content[0] = ui:// resource (existing)     │ 3. KV.put(token,html,
        │   content[1] = text "Open dashboard: <url>"  │      ttl=900)
        │   render_url  = "<url>"  (top-level field)   │ 4. return content
        │                                              │
        │ user clicks link                             │
        ▼                                              │
┌─────────────────┐  GET /render/<token>               │
│ Browser tab     │ ────────────────────────────────▶  │
│ (Chart.js runs) │ ◀──── HTML body (no-store) ─────── │
└─────────────────┘                                    │
```

## Components

### 1. KV namespace `RENDER_CACHE`

New Cloudflare KV binding. Provisioned manually with
`wrangler kv namespace create RENDER_CACHE` (and `--preview`).

`wrangler.jsonc` gains:

```jsonc
"kv_namespaces": [
  { "binding": "RENDER_CACHE", "id": "<id>", "preview_id": "<preview-id>" }
]
```

`src/env.ts` gains:

```ts
export interface Env {
  // ...existing
  RENDER_CACHE: KVNamespace;
}
```

### 2. `src/render-store.ts` — token + KV helpers

Single-purpose module. No business logic.

```ts
const PREFIX = "render:";
export const RENDER_TTL_SECONDS = 900; // 15 min

export function newRenderToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function putRender(
  kv: KVNamespace,
  token: string,
  html: string,
): Promise<void> {
  await kv.put(PREFIX + token, html, { expirationTtl: RENDER_TTL_SECONDS });
}

export async function getRender(
  kv: KVNamespace,
  token: string,
): Promise<string | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return kv.get(PREFIX + token);
}
```

Garbage paths skip KV lookup via regex guard.

### 3. `/render/:token` route in `src/index.ts`

```ts
async function handleRender(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = url.pathname.slice("/render/".length);
  const body = await getRender(env.RENDER_CACHE, token);
  if (!body) return new Response("Not found or expired", { status: 404 });

  const doc = `<!doctype html>
<html><head><meta charset="utf-8">
<title>Clinical Dashboard</title>
<meta name="referrer" content="no-referrer">
<style>body{margin:0;font:14px/1.5 -apple-system,sans-serif;background:#f8fafc}</style>
</head><body>${body}</body></html>`;

  return new Response(doc, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, private",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    },
  });
}
```

Wired into the existing fetch dispatcher alongside `/mcp`, `/health`, `/`:

```ts
if (url.pathname.startsWith("/render/")) return handleRender(request, env);
```

No auth header. Token is the bearer. PHI exposure window bounded by 900s TTL
and `Referrer-Policy: no-referrer` + `noindex`.

### 4. `SharpContext` carries request origin

`parseSharpHeaders(request, env)` adds `originUrl: new URL(request.url).origin`
to the returned context. Tools read it via the existing
`runWithContext` AsyncLocalStorage so visualization tools can build the
`/render/<token>` URL without plumbing `request` through `buildServer`.

### 5. Visualization tools emit both resource + text + structured URL

Each of `visualize_lab_trend`, `visualize_vitals`,
`visualize_patient_dashboard` performs:

```ts
const token = newRenderToken();
await putRender(env.RENDER_CACHE, token, html);
const renderUrl = `${origin}/render/${token}`;

return {
  content: [
    uiResource(uri, html), // unchanged — spec-compliant hosts use this
    {
      type: "text",
      text: `📊 Interactive dashboard (15 min link): ${renderUrl}`,
    },
  ],
  render_url: renderUrl,
  // ...existing structured fields (patient_id, alerts_count, etc.)
};
```

The `ui://` resource is preserved at `content[0]` for forward compatibility.
The text item is additive — a host that already renders `ui://` simply shows
both. A host that ignores `ui://` (Prompt Opinion today) shows the link.

`render_url` is also a top-level field on every visualization tool response
so the model/host can extract it programmatically if the text item is
stripped or auto-collapsed.

## Data flow

1. Client sends `tools/call` with SHARP headers.
2. `parseSharpHeaders` captures `originUrl`.
3. Visualization tool builds HTML, generates token, writes to KV.
4. Response includes `content[0]` (ui://), `content[1]` (text + link),
   and top-level `render_url`.
5. User clicks the link in Prompt Opinion.
6. Browser GETs `/render/<token>`.
7. Worker reads KV, wraps body in doctype HTML, returns with
   `Cache-Control: no-store` + `noindex`.
8. Browser executes inline `<script>` and the Chart.js CDN scripts.
9. After 900s, KV entry expires; subsequent fetches return 404.

## Error handling

- KV write failure → tool returns error response; no `render_url`.
  Existing `ui://` resource not emitted either (transactional).
- `/render/` GET with malformed token → 404 (regex reject, no KV call).
- `/render/` GET with expired/unknown token → 404 from KV miss.
- KV eventual-consistency miss within ~1s of write → handler retries once
  after 500ms before returning 404.

## Security

- Token: 32 bytes from `crypto.getRandomValues` → 256-bit entropy. Hex
  encoded. Unguessable.
- PHI lives only in KV body, not in the URL path. URL is bearer-capability.
- `Referrer-Policy: no-referrer` prevents downstream pages from learning
  the URL via `Referer`.
- `X-Robots-Tag: noindex, nofollow` keeps URLs out of search indexes if
  ever crawled.
- `Cache-Control: no-store, private` blocks intermediate caching.
- 900s TTL bounds exposure.
- No `Access-Control-Allow-*` headers on `/render/` — link opens via top-
  level navigation, not cross-origin fetch.
- Chart.js CDN remains the same trust boundary as before; no new third-
  party JS introduced.

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Prompt Opinion does not auto-link URLs in tool text | Medium | `render_url` top-level field; user copies if needed |
| KV eventual consistency causes 404 on fast click | Low | Single retry after 500ms in `/render/` handler |
| Token leaks via screenshot / shared transcript | Medium | 900s TTL; document in user-facing copy |
| Additive `content[1]` confuses strict MCP-UI hosts | Low | Text content items are part of base MCP spec; safe to coexist with resource items |
| KV write quota exhausted (free tier: 1k/day) | Very low at hackathon scale | Monitor; upgrade plan if needed |

## Testing

**Unit (`vitest`):**
- `render-store.test.ts`:
  - `newRenderToken()` returns 64-char hex.
  - `putRender` + `getRender` roundtrip with mocked KV.
  - `getRender` rejects malformed tokens without touching KV.
- `index.test.ts` (or new `render-route.test.ts`):
  - GET `/render/<garbage>` → 404, no KV call.
  - GET `/render/<valid-but-missing>` → 404.
  - GET `/render/<valid-with-html>` → 200, body contains HTML, headers
    include `no-store`, `noindex`, `no-referrer`.

**Manual e2e:**
- Deploy preview. Call `visualize_vitals` from MCP Inspector with hero
  patient. Confirm `render_url` returned; open it; confirm Chart.js
  renders.
- Same call via Prompt Opinion. Confirm link clickable / copy-pastable.
- Wait 16 minutes, re-open URL, confirm 404.

## Out of scope (future work)

- Server-side SVG fallback for hosts that strip URLs entirely.
- Signed JWT URLs instead of opaque tokens (only needed if quota becomes
  a problem).
- Upstream MCP-UI renderer PR to Prompt Opinion.
- Resize-message protocol (`mcpui-resize`) — irrelevant since iframe
  isn't used.

## Open questions resolved during planning

- Origin propagation: confirm `SharpContext` extension does not break
  existing tests. (Believed safe — context is additive.)
- Whether `render_url` belongs on every visualization tool response or
  only the dashboard. (Decision: every viz tool.)
- Whether `/render/` route needs CSP header. (Decision: no — Chart.js
  CDN already trusted in current dashboard HTML; adding strict CSP would
  require allow-listing.)

## Files touched

- `wrangler.jsonc` — add KV binding.
- `src/env.ts` — add `RENDER_CACHE: KVNamespace`.
- `src/render-store.ts` — new module.
- `src/index.ts` — add `/render/:token` route.
- `src/context.ts` — add `originUrl` to `SharpContext`.
- `src/tools/visualization.ts` — emit text content + `render_url` field on
  all three viz tools.
- `test/render-store.test.ts` — new.
- `test/render-route.test.ts` — new.
