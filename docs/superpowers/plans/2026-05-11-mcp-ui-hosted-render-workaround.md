# MCP-UI Hosted Render Workaround Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Featherless clinical dashboards visible inside Prompt Opinion by hosting each dashboard at a public, token-protected route on the Worker and surfacing a clickable link in visualization tool output, without breaking spec-compliant MCP-UI hosts.

**Architecture:** Worker stores rendered dashboard HTML fragments in Cloudflare KV under unguessable random tokens. A new `GET /render/<token>` route reads from KV and serves a wrapped HTML document with `no-store` / `noindex` headers. Each visualization tool returns its existing `ui://` resource at `content[0]` plus a new text content item at `content[1]` carrying a markdown link to the hosted page, and a top-level `render_url` field for programmatic access.

**Tech Stack:** TypeScript, Cloudflare Workers, Cloudflare KV, `@cloudflare/vitest-pool-workers`, vitest, Web Crypto API, MCP TypeScript SDK, `@mcp-ui/server`.

**Reference spec:** `docs/superpowers/specs/2026-05-11-mcp-ui-hosted-render-workaround-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `wrangler.jsonc` | Modify | Add `RENDER_CACHE` KV namespace binding |
| `wrangler.test.jsonc` | Modify | Add same binding so tests pass under workers pool |
| `src/env.ts` | Modify | Add optional `RENDER_CACHE?: KVNamespace` to `Env` |
| `src/render-store.ts` | Create | Token generator + KV put/get (single-purpose module) |
| `src/index.ts` | Modify | Add `/render/<token>` route handler |
| `src/tools/visualization.ts` | Modify | Take `env` arg; emit text + `render_url`; degrade if KV unset |
| `src/server.ts` | Modify | Pass `env` to `registerVisualizationTools` |
| `test/render-store.test.ts` | Create | Unit tests for token + put/get + malformed-token reject |
| `test/render-route.test.ts` | Create | Route tests: 404 garbage, 404 missing, 200 + correct headers |

Total: 2 new modules, 6 modified files, 2 new test files.

---

## Chunk 1: KV Plumbing + render-store Module

### Task 1: Add KV binding to wrangler configs

**Files:**
- Modify: `wrangler.jsonc` (add `kv_namespaces`)
- Modify: `wrangler.test.jsonc` (add `kv_namespaces`)

- [ ] **Step 1: Provision KV namespace**

Run from the repo root:

```bash
npx wrangler kv namespace create RENDER_CACHE
npx wrangler kv namespace create RENDER_CACHE --preview
```

Expected output: two `id` values, e.g.:

```
{ binding = "RENDER_CACHE", id = "abc123..." }
{ binding = "RENDER_CACHE", preview_id = "def456..." }
```

Copy both IDs.

- [ ] **Step 2: Edit `wrangler.jsonc`**

Append the KV binding inside the top-level object (after `"ai": { "binding": "AI" }`):

```jsonc
  "ai": { "binding": "AI" },
  "kv_namespaces": [
    {
      "binding": "RENDER_CACHE",
      "id": "<PASTE-PRODUCTION-ID>",
      "preview_id": "<PASTE-PREVIEW-ID>"
    }
  ]
```

- [ ] **Step 3: Edit `wrangler.test.jsonc`**

Append inside the top-level object:

```jsonc
  "kv_namespaces": [
    { "binding": "RENDER_CACHE", "id": "test-render-cache" }
  ]
```

The `id` is arbitrary under `@cloudflare/vitest-pool-workers` — Miniflare provides an in-memory KV per test.

- [ ] **Step 4: Verify wrangler accepts config**

Run: `npx wrangler types --config wrangler.jsonc`
Expected: completes without error; regenerates `worker-configuration.d.ts` if present.

- [ ] **Step 5: Commit**

```bash
git add wrangler.jsonc wrangler.test.jsonc
git commit -m "feat(render): add RENDER_CACHE KV binding for hosted dashboards"
```

---

### Task 2: Extend `Env` type with RENDER_CACHE

**Files:**
- Modify: `src/env.ts`

- [ ] **Step 1: Edit `src/env.ts`**

Inside the `Env` interface, alongside other optional bindings (e.g. `AI?: Ai;`), add:

```ts
  RENDER_CACHE?: KVNamespace;
```

The `?` keeps it optional so unit tests / orchestrator deployment without the binding still type-check. Runtime code must null-check.

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/env.ts
git commit -m "feat(render): expose optional RENDER_CACHE binding on Env"
```

---

### Task 3: Write failing test for `newRenderToken`

**Files:**
- Create: `test/render-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { newRenderToken } from "../src/render-store.ts";

describe("newRenderToken", () => {
  it("returns 64-char lowercase hex", () => {
    const token = newRenderToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns a different token on each call", () => {
    const a = newRenderToken();
    const b = newRenderToken();
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render-store.test.ts`
Expected: FAIL with `Cannot find module '../src/render-store.ts'`.

---

### Task 4: Implement `newRenderToken`

**Files:**
- Create: `src/render-store.ts`

- [ ] **Step 1: Write minimal implementation**

```ts
/**
 * Render token + KV store for hosted dashboard HTML fragments.
 * See docs/superpowers/specs/2026-05-11-mcp-ui-hosted-render-workaround-design.md
 */

const PREFIX = "render:";
export const RENDER_TTL_SECONDS = 900;

export function newRenderToken(): string {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/render-store.test.ts`
Expected: 2 tests pass.

---

### Task 5: Write failing test for `putRender` + `getRender` roundtrip

**Files:**
- Modify: `test/render-store.test.ts`

- [ ] **Step 1: Add roundtrip + malformed-token tests**

Append to the `describe` block:

```ts
import { env } from "cloudflare:test";
import { getRender, putRender } from "../src/render-store.ts";

describe("putRender + getRender", () => {
  it("roundtrips an HTML fragment", async () => {
    const token = newRenderToken();
    await putRender(env.RENDER_CACHE, token, "<div>hi</div>");
    expect(await getRender(env.RENDER_CACHE, token)).toBe("<div>hi</div>");
  });

  it("returns null for an unknown token", async () => {
    const unknown = "0".repeat(64);
    expect(await getRender(env.RENDER_CACHE, unknown)).toBeNull();
  });

  it("rejects malformed tokens without touching KV", async () => {
    const spy = vi.spyOn(env.RENDER_CACHE, "get");
    expect(await getRender(env.RENDER_CACHE, "not-hex!")).toBeNull();
    expect(await getRender(env.RENDER_CACHE, "abc")).toBeNull(); // too short
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

Top of file, add `vi` to the import:

```ts
import { describe, expect, it, vi } from "vitest";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render-store.test.ts`
Expected: FAIL — `putRender is not exported`.

---

### Task 6: Implement `putRender` + `getRender`

**Files:**
- Modify: `src/render-store.ts`

- [ ] **Step 1: Append implementation**

```ts
const TOKEN_RE = /^[a-f0-9]{64}$/;

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
  if (!TOKEN_RE.test(token)) return null;
  return kv.get(PREFIX + token);
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `npx vitest run test/render-store.test.ts`
Expected: 5 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/render-store.ts test/render-store.test.ts
git commit -m "feat(render): add render-store with token + KV put/get"
```

---

## Chunk 2: `/render/<token>` Route Handler

### Task 7: Write failing test for `/render/` route — malformed token

**Files:**
- Create: `test/render-route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { newRenderToken, putRender } from "../src/render-store.ts";

describe("GET /render/:token", () => {
  it("returns 404 for malformed token", async () => {
    const res = await SELF.fetch("https://example.com/render/not-hex");
    expect(res.status).toBe(404);
  });

  it("returns 404 for unknown token", async () => {
    const token = "0".repeat(64);
    const res = await SELF.fetch(`https://example.com/render/${token}`);
    expect(res.status).toBe(404);
  });

  it("returns 200 with stored HTML, security headers, and doctype", async () => {
    const token = newRenderToken();
    await putRender(env.RENDER_CACHE, token, "<canvas id='c'></canvas>");
    const res = await SELF.fetch(`https://example.com/render/${token}`);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^text\/html/);
    expect(res.headers.get("Cache-Control")).toBe("no-store, private");
    expect(res.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");

    const body = await res.text();
    expect(body).toMatch(/^<!doctype html>/i);
    expect(body).toContain("<canvas id='c'></canvas>");
    expect(body).toContain("<title>Clinical Dashboard</title>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render-route.test.ts`
Expected: FAIL — all three tests, because `/render/` route doesn't exist yet (current Worker returns 404 with body `"Not Found"`, which happens to satisfy the first two but not the third).

The 200-case assertion (body containing the canvas) ensures we will write the route.

---

### Task 8: Implement `/render/<token>` route handler

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Import render-store helpers**

Near the top of `src/index.ts`, after other imports, add:

```ts
import { getRender } from "./render-store.ts";
```

- [ ] **Step 2: Add `handleRender` function**

Insert above the `export default` block:

```ts
async function handleRender(request: Request, env: Env): Promise<Response> {
  if (!env.RENDER_CACHE) {
    return new Response("Render cache not configured", { status: 503 });
  }
  const url = new URL(request.url);
  const token = url.pathname.slice("/render/".length);

  let body = await getRender(env.RENDER_CACHE, token);
  if (body === null) {
    // KV is eventually consistent; tolerate ~1s replication lag on first hit.
    await new Promise((r) => setTimeout(r, 500));
    body = await getRender(env.RENDER_CACHE, token);
  }
  if (body === null) {
    console.warn(`[render] miss token=${token.slice(0, 8)}…`);
    return new Response("Not found or expired", { status: 404 });
  }

  console.log(`[render] hit token=${token.slice(0, 8)}…`);

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

- [ ] **Step 3: Wire route into fetch dispatcher**

In the existing `export default { async fetch(...) }`, insert *before* the `/health` line:

```ts
if (url.pathname.startsWith("/render/")) return handleRender(request, env);
```

The full block should now read:

```ts
async fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/mcp") return handleMcp(request, env);
  if (url.pathname.startsWith("/render/")) return handleRender(request, env);
  if (url.pathname === "/health") return new Response("ok");
  if (url.pathname === "/" || url.pathname === "")
    return new Response(INFO_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return new Response("Not Found", { status: 404 });
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/render-route.test.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Run full test suite to catch regressions**

Run: `npx vitest run`
Expected: all previously-passing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/render-route.test.ts
git commit -m "feat(render): add /render/<token> route serving KV-stored HTML"
```

---

## Chunk 3: Wire Visualization Tools to Emit Render URL

### Task 9: Pass `env` into `registerVisualizationTools`

**Files:**
- Modify: `src/tools/visualization.ts`
- Modify: `src/server.ts`

This task only changes the signature — emission of the new content item comes in Task 10. Splitting keeps the diff small.

- [ ] **Step 1: Update function signature**

In `src/tools/visualization.ts`:

```ts
import type { Env } from "../env.ts";

export function registerVisualizationTools(server: McpServer, env: Env): void {
  // ...existing body unchanged for now
}
```

- [ ] **Step 2: Update caller**

In `src/server.ts` line 71:

```ts
registerVisualizationTools(server, env);
```

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`
Expected: all tests still pass — pure signature change.

- [ ] **Step 4: Commit**

```bash
git add src/tools/visualization.ts src/server.ts
git commit -m "refactor(viz): thread env into registerVisualizationTools"
```

---

### Task 10: Write failing test for tool response shape (render_url + text content item)

**Files:**
- Modify: `test/render-route.test.ts` (or new `test/visualization-render.test.ts` — prefer the latter for clarity)
- Create: `test/visualization-render.test.ts`

For this test we invoke the visualization tool through the MCP transport because viz tools touch FHIR. To avoid setting up a HAPI server, test the response-shape helper directly. The helper will be extracted in Task 11.

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildRenderArtifacts } from "../src/tools/visualization.ts";

describe("buildRenderArtifacts", () => {
  it("returns null artifacts when KV binding is absent", async () => {
    const result = await buildRenderArtifacts(undefined, "https://w.example", "<div/>");
    expect(result.renderUrl).toBeNull();
    expect(result.textContent).toBeNull();
  });

  it("returns null artifacts when KV write fails", async () => {
    const failingKv = {
      put: async () => {
        throw new Error("KV exploded");
      },
    } as unknown as KVNamespace;
    const result = await buildRenderArtifacts(failingKv, "https://w.example", "<div/>");
    expect(result.renderUrl).toBeNull();
    expect(result.textContent).toBeNull();
  });

  it("returns a render URL and text content item on success", async () => {
    const result = await buildRenderArtifacts(
      env.RENDER_CACHE,
      "https://w.example",
      "<canvas/>",
    );
    expect(result.renderUrl).toMatch(
      /^https:\/\/w\.example\/render\/[a-f0-9]{64}$/,
    );
    expect(result.textContent).toEqual({
      type: "text",
      text: expect.stringContaining(result.renderUrl as string),
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/visualization-render.test.ts`
Expected: FAIL — `buildRenderArtifacts is not exported`.

---

### Task 11: Implement `buildRenderArtifacts` helper

**Files:**
- Modify: `src/tools/visualization.ts`

- [ ] **Step 1: Add the helper at top of file**

After the existing `uiResource` function, add:

```ts
import { newRenderToken, putRender } from "../render-store.ts";

export interface RenderArtifacts {
  renderUrl: string | null;
  textContent: { type: "text"; text: string } | null;
}

/**
 * Best-effort: store HTML in KV and produce a clickable link.
 * Returns nulls if RENDER_CACHE is unset or KV write fails — viz tools
 * must still emit their ui:// resource in that case (graceful degrade).
 */
export async function buildRenderArtifacts(
  kv: KVNamespace | undefined,
  originUrl: string,
  html: string,
): Promise<RenderArtifacts> {
  if (!kv) return { renderUrl: null, textContent: null };
  const token = newRenderToken();
  try {
    await putRender(kv, token, html);
  } catch (e) {
    console.warn(
      `[render] put failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { renderUrl: null, textContent: null };
  }
  const renderUrl = `${originUrl}/render/${token}`;
  return {
    renderUrl,
    textContent: {
      type: "text",
      text: `📊 Interactive dashboard (15 min link): ${renderUrl}`,
    },
  };
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run test/visualization-render.test.ts`
Expected: 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/tools/visualization.ts test/visualization-render.test.ts
git commit -m "feat(viz): add buildRenderArtifacts helper with graceful KV fallback"
```

---

### Task 12: Plumb origin URL through tool calls and emit artifacts

**Files:**
- Modify: `src/tools/visualization.ts`

The viz tool callbacks have no direct access to the inbound `Request`. Use the existing pattern: capture origin via `globalThis`-free path → in this codebase, MCP requests already flow through `runWithContext`. Rather than extending `SharpContext`, we keep things small: read the worker's deployed origin from an env var the tool already gets at registration time. The Worker exposes its current request origin only inside `fetch(request, env)`, so the cleanest local solution is to accept origin from a module-level setter updated per request inside `src/index.ts`.

Take the simpler route: pass the **request origin** through `SharpContext`.

#### Sub-step A: Extend `SharpContext`

- [ ] **Step 1: Add `originUrl` to `SharpContext`**

In `src/context.ts`:

```ts
export interface SharpContext {
  serverUrl: string | null;
  accessToken: string | null;
  patientId: string | null;
  fhirUser: string | null;
  scopes: string | null;
  extraHeaders: Record<string, string>;
  originUrl: string | null; // NEW — request origin for self-served routes
}
```

Update `EMPTY_CONTEXT`:

```ts
export const EMPTY_CONTEXT: SharpContext = {
  // ...existing
  originUrl: null,
};
```

In `parseSharpHeaders`, before the return statement:

```ts
const originUrl = (() => {
  try {
    return new URL(req.url).origin;
  } catch {
    return null;
  }
})();
```

Add `originUrl` to the returned object.

- [ ] **Step 2: Run tests to confirm no regressions**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 3: Commit**

```bash
git add src/context.ts
git commit -m "feat(context): expose request originUrl on SharpContext"
```

#### Sub-step B: Update each visualization tool

- [ ] **Step 4: Update `visualize_lab_trend`, `visualize_vitals`, `visualize_patient_dashboard`**

At the top of `src/tools/visualization.ts`, add:

```ts
import { getCurrentContext } from "../context.ts";
```

For each of the three tools, after the HTML string is built and before the existing `return { content: [uiResource(uri, html)], ... }`, replace the return statement with:

```ts
const origin = getCurrentContext().originUrl ?? "";
const artifacts = await buildRenderArtifacts(env.RENDER_CACHE, origin, html);

const content: Dict[] = [uiResource(uri, html)];
if (artifacts.textContent) content.push(artifacts.textContent);

return {
  content,
  render_url: artifacts.renderUrl,
  // ...existing fields (patient_id, data_points, etc.)
};
```

Three call sites to update:
1. `visualize_lab_trend` — keep `patient_id`, `test`, `data_points`.
2. `visualize_vitals` — keep `patient_id`, `data_points`.
3. `visualize_patient_dashboard` — keep `patient_id`, `patient_name`, `alerts_count`, `data_summary`.

- [ ] **Step 5: Run full test suite**

Run: `npx vitest run`
Expected: all tests pass. Existing visualization tests (if any) should still pass because `content[0]` is unchanged; new field `render_url` is additive.

- [ ] **Step 6: Commit**

```bash
git add src/tools/visualization.ts
git commit -m "feat(viz): emit render_url + text link alongside ui:// resource"
```

---

## Chunk 4: End-to-End Verification

### Task 13: Add an e2e route+tool integration test

**Files:**
- Create: `test/render-e2e.test.ts`

This test exercises the full path: request hits the viz tool helper, KV is written, the route serves wrapped HTML. It does not call the actual MCP visualization tool (that requires FHIR); it verifies the contract between `buildRenderArtifacts` and `/render/`.

- [ ] **Step 1: Write the test**

```ts
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildRenderArtifacts } from "../src/tools/visualization.ts";

describe("render artifact + route e2e", () => {
  it("artifact URL resolves to wrapped HTML on the Worker", async () => {
    const fragment = `<canvas id="x"></canvas><script>window.__chart=true;</script>`;
    const artifacts = await buildRenderArtifacts(
      env.RENDER_CACHE,
      "https://example.com",
      fragment,
    );
    expect(artifacts.renderUrl).not.toBeNull();

    const res = await SELF.fetch(artifacts.renderUrl as string);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(fragment);
    expect(body).toMatch(/<!doctype html>/i);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run test/render-e2e.test.ts`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add test/render-e2e.test.ts
git commit -m "test(render): e2e covering artifact-to-route handoff"
```

---

### Task 14: Manual smoke test on preview deploy

**Files:** none

- [ ] **Step 1: Deploy preview**

Run: `npx wrangler deploy --dry-run` to verify build, then:

```bash
npx wrangler deploy --env preview
```

(or your team's preview command — see `package.json` scripts if different).

- [ ] **Step 2: Hit visualization tool via MCP Inspector**

```bash
npx @modelcontextprotocol/inspector
```

Point it at the preview URL `/mcp`, send SHARP headers for hero patient, invoke `visualize_vitals`.

Expected in response:
- `content[0]` = `ui://featherless/vitals/...` resource (existing behaviour).
- `content[1]` = text item containing a `/render/<64-hex>` URL.
- `render_url` = same URL as a top-level string field.

- [ ] **Step 3: Open `render_url` in a browser tab**

Expected: full vitals dashboard renders. Chart.js charts draw. No console errors.

- [ ] **Step 4: Wait 16 minutes, re-open URL**

Expected: 404 "Not found or expired".

- [ ] **Step 5: Run the same call from Prompt Opinion**

Visit the agent at the challenge URL. Trigger a tool call that invokes `visualize_patient_dashboard`. Confirm the link surfaces in the tool output panel (clickable or copy-pastable). Open the link; verify dashboard renders.

- [ ] **Step 6: If Prompt Opinion strips the link**

Fall back: confirm `render_url` is visible in any structured/JSON view Prompt Opinion shows. If not, file a follow-up issue — this is the contingency the spec already flags.

---

### Task 15: Documentation pass

**Files:**
- Modify: `MCP-UI_WORKAROUND.md` (add note that server-side workaround is shipped)
- Modify: `README.md` (if it documents tool output shape, mention `render_url`)

- [ ] **Step 1: Add a short "Workaround Status" section to `MCP-UI_WORKAROUND.md`**

At the top, insert:

```markdown
## Status (2026-05-11)

Server-side hosted-render workaround is live. Visualization tools now
return a `render_url` and a text content item with the clickable link,
in addition to the `ui://` resource. Spec-compliant MCP-UI hosts are
unaffected. See:
- `docs/superpowers/specs/2026-05-11-mcp-ui-hosted-render-workaround-design.md`
- `docs/superpowers/plans/2026-05-11-mcp-ui-hosted-render-workaround.md`
```

- [ ] **Step 2: Commit**

```bash
git add MCP-UI_WORKAROUND.md
git commit -m "docs(render): mark hosted-render workaround as shipped"
```

---

## Done Criteria

- [ ] All unit tests pass (`npx vitest run`).
- [ ] `wrangler.jsonc` has a real `RENDER_CACHE` KV binding (not the placeholder ID).
- [ ] Preview deploy responds 200 on `GET /render/<valid-token>` and 404 on `GET /render/<garbage>`.
- [ ] `visualize_vitals` response contains a `render_url` whose target renders Chart.js in a browser.
- [ ] Prompt Opinion users can see the dashboard via the link.
- [ ] KV write failure path (tested by mocking) leaves `content[0]` intact — degrade verified.
