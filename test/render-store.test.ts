import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { getRender, newRenderToken, putRender } from "../src/render-store.ts";

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
    expect(await getRender(env.RENDER_CACHE, "abc")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
