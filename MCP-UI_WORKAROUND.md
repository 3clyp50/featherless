## Status (2026-05-11)

Server-side hosted-render workaround is live. Visualization tools now
return a `render_url` and a text content item with the clickable link,
in addition to the `ui://` resource. Spec-compliant MCP-UI hosts are
unaffected. See:
- `docs/superpowers/specs/2026-05-11-mcp-ui-hosted-render-workaround-design.md`
- `docs/superpowers/plans/2026-05-11-mcp-ui-hosted-render-workaround.md`

---

## How MCP-UI Rendering Works (and What's Missing in Prompt Opinion)

### The Wire Format

When any visualization tool fires, `createUIResource()` wraps the HTML into a standard MCP content item: [1](#0-0) 

The resulting JSON that Prompt Opinion receives looks like this:

```json
{
  "content": [
    {
      "type": "resource",
      "resource": {
        "uri": "ui://featherless/dashboard/patient-123/1715000000",
        "mimeType": "text/html",
        "text": "<div class=\"clinical-context\">...<canvas id=\"lab_chart_...\"></canvas><script src=\"https://cdn.jsdelivr.net/npm/chart.js\"></script>...</div>"
      }
    }
  ],
  "patient_id": "patient-123",
  "alerts_count": 2
}
```

The `text` field is the full HTML string emitted by `buildClinicalContextDisplay` and `buildChartHtml`. The Worker never executes Chart.js — it only emits the `<script src="...cdn...">` tags. [2](#0-1) 

### Why Prompt Opinion Shows Raw Output

Prompt Opinion currently treats every `content` item with `type: "resource"` as opaque text. It does not check whether the `uri` starts with `ui://` and does not use `srcdoc` to hydrate an iframe. The HTML lands as a raw string in the tool output panel.

### What Needs to Be Built

A renderer component must be injected into Prompt Opinion's tool-result rendering pipeline. The detection rule is simple:

```
content.type === "resource"
  && content.resource.uri.startsWith("ui://")
  && content.resource.mimeType === "text/html"
```

When that matches, instead of printing `content.resource.text`, render:

```html
<iframe
  srcdoc="<ESCAPED HTML>"
  sandbox="allow-scripts"
  style="width:100%; height:600px; border:none; border-radius:8px;"
  title="Clinical Dashboard"
></iframe>
```

Key constraints:
- **`sandbox="allow-scripts"`** is required — Chart.js must execute inside the iframe. [3](#0-2) 
- **Do NOT add `allow-same-origin`** — that would let the iframe escape the sandbox and access the parent origin.
- **Do NOT add `allow-forms` or `allow-top-navigation`** — the HTML only needs script execution.
- The `height` should be dynamic or at least `600px`; the vitals dashboard uses a CSS grid that can grow tall. [4](#0-3) 

### Build Spec Prompt

Here is a self-contained prompt you can hand to a Devin session or another agent to implement this:

---

```
Context
-------
Repository: TerminallyLazy/featherless
The Featherless MCP server returns tool results whose `content` array contains
items of shape:

  {
    type: "resource",
    resource: {
      uri: "ui://featherless/<tool>/<patient-id>/<timestamp>",
      mimeType: "text/html",
      text: "<full HTML string with Chart.js CDN scripts>"
    }
  }

Prompt Opinion currently renders these as raw text. The goal is to render them
as sandboxed iframes so Chart.js executes and the clinical dashboards display.

Task
----
In the Prompt Opinion frontend (wherever MCP tool results are rendered), add a
MCP-UI content renderer with the following behaviour:

1. Detection
   For each item in a tool result's `content` array, check:
     item.type === "resource"
     && typeof item.resource?.uri === "string"
     && item.resource.uri.startsWith("ui://")
     && item.resource.mimeType === "text/html"

2. Rendering
   When the check passes, render an iframe using the `srcdoc` attribute:

     <iframe
       srcdoc={item.resource.text}
       sandbox="allow-scripts"
       style="width:100%;height:600px;border:none;border-radius:8px;"
       title={item.resource.uri}
     />

   - Use `sandbox="allow-scripts"` ONLY. Do not add allow-same-origin,
     allow-forms, or allow-top-navigation.
   - The iframe must NOT inherit the parent page's cookies or localStorage.

3. Fallback
   If the check fails, keep the existing raw-text rendering path unchanged.

4. Resize (optional but recommended)
   Listen for a `message` event from the iframe:
     window.addEventListener("message", (e) => {
       if (e.data?.type === "mcpui-resize") {
         iframe.style.height = e.data.height + "px";
       }
     });
   The Featherless HTML does not currently emit this event, but it is the
   standard MCP-UI resize protocol and future-proofs the integration.

5. No server-side changes needed
   The Featherless Worker already emits correct MCP-UI payloads via
   @mcp-ui/server's createUIResource(). Only the Prompt Opinion frontend
   rendering layer needs to change.

Files to look at for reference on the payload shape:
  src/tools/visualization.ts  (lines 33-39, 96-102)
  src/ui/clinical-charts.ts   (lines 111-122)
  src/ui/clinical-display.ts  (lines 339-368)
```

---

### Minimal Vanilla-JS Renderer (if Prompt Opinion uses a plugin/extension API)

If Prompt Opinion exposes a tool-result hook, this is the minimal renderer:

```js
function renderMcpUiContent(contentItem, container) {
  const r = contentItem?.resource;
  if (
    contentItem?.type !== "resource" ||
    !r?.uri?.startsWith("ui://") ||
    r?.mimeType !== "text/html"
  ) {
    return false; // not a ui:// resource — let default renderer handle it
  }

  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.setAttribute("srcdoc", r.text);
  iframe.style.cssText =
    "width:100%;height:600px;border:none;border-radius:8px;display:block;";
  iframe.title = r.uri;
  container.appendChild(iframe);
  return true;
}
```

The `srcdoc` attribute is the critical piece — it injects the HTML directly without a network round-trip, and the `sandbox="allow-scripts"` flag lets Chart.js run while keeping the iframe isolated from the parent page. [5](#0-4)

### Citations

**File:** src/tools/visualization.ts (L33-39)
```typescript
function uiResource(uri: string, html: string): Dict {
  return createUIResource({
    uri: uri as `ui://${string}`,
    content: { type: "rawHtml", htmlString: html },
    encoding: "text",
  }) as Dict;
}
```

**File:** src/ui/clinical-charts.ts (L1-5)
```typescript
/**
 * Clinical Chart.js visualisation builders. Pure HTML emitters — Chart.js
 * itself is loaded from a CDN inside the rendered iframe, so the Worker
 * never executes chart code.
 */
```

**File:** src/ui/clinical-charts.ts (L111-122)
```typescript
  return `
  <div style="height: 300px; position: relative;">
    <canvas id="${args.chartId}"></canvas>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
  <script>
    (function() {
      const ctx = document.getElementById('${args.chartId}');
      if (ctx) { new Chart(ctx, ${configJson}); }
    })();
  </script>`;
```

**File:** src/ui/clinical-charts.ts (L220-222)
```typescript
  const items = charts.map((c) => `<div class="chart-container">${c}</div>`).join("");
  return `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1rem;">${items}</div>`;
}
```


