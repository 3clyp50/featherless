import { SELF, env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { buildRenderArtifacts } from "../src/tools/visualization.ts";

describe("render artifact + route e2e", () => {
  it("artifact URL resolves to wrapped HTML on the Worker", async () => {
    const fragment = `<canvas id="x"></canvas><script>window.__chart=true;</script>`;
    const artifacts = await buildRenderArtifacts(env.RENDER_CACHE, "https://example.com", fragment);
    expect(artifacts.renderUrl).not.toBeNull();

    const res = await SELF.fetch(artifacts.renderUrl as string);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(fragment);
    expect(body).toMatch(/<!doctype html>/i);
  });
});
