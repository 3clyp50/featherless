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
