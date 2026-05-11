import { describe, expect, it } from "vitest";
import { buildLabTrendChart } from "../../src/ui/clinical-charts.ts";

describe("clinical chart HTML builders", () => {
  it("escapes chart config before embedding it in an inline script", () => {
    const maliciousLabel = "</script><script>globalThis.__xss = true</script>";
    const html = buildLabTrendChart(maliciousLabel, [
      { date: "2026-05-01", value: 4.2, unit: "mg/dL" },
      { date: "2026-05-02", value: 4.5, unit: "mg/dL" },
    ]);

    expect(html).toContain("\\u003c/script\\u003e");
    expect(html).toContain("\\u003cscript\\u003eglobalThis.__xss = true\\u003c/script\\u003e");
    expect(html).not.toContain(maliciousLabel);
  });
});
