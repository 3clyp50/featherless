import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { newRenderToken, putRender } from "../src/render-store.ts";

describe("GET /render/:token", () => {
  it("returns 404 with our body text for malformed token", async () => {
    const res = await SELF.fetch("https://example.com/render/not-hex");
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found or expired");
  });

  it("returns 404 for unknown token", async () => {
    const token = "0".repeat(64);
    const res = await SELF.fetch(`https://example.com/render/${token}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found or expired");
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
