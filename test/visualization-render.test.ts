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
