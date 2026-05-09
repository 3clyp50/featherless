/**
 * Clinical Chart.js visualisation builders. Pure HTML emitters — Chart.js
 * itself is loaded from a CDN inside the rendered iframe, so the Worker
 * never executes chart code.
 */

type Dict = Record<string, unknown>;

export const CHART_COLORS = {
  primary: "rgb(37, 99, 235)",
  primary_bg: "rgba(37, 99, 235, 0.1)",
  success: "rgb(16, 185, 129)",
  success_bg: "rgba(16, 185, 129, 0.1)",
  warning: "rgb(245, 158, 11)",
  warning_bg: "rgba(245, 158, 11, 0.1)",
  danger: "rgb(220, 38, 38)",
  danger_bg: "rgba(220, 38, 38, 0.1)",
  purple: "rgb(139, 92, 246)",
  purple_bg: "rgba(139, 92, 246, 0.1)",
  gray: "rgb(107, 114, 128)",
  gray_bg: "rgba(107, 114, 128, 0.1)",
} as const;

const VITALS_NORMAL_RANGES: Record<string, [number, number]> = {
  "Heart rate": [60, 100],
  "Pulse rate": [60, 100],
  "Body temperature": [36.5, 37.5],
  "Oxygen saturation": [95, 100],
  "Respiratory rate": [12, 20],
};

function hashId(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  return String(Math.abs(h) % 100_000);
}

function deepMerge(base: Dict, override: Dict): Dict {
  for (const [k, v] of Object.entries(override)) {
    const cur = base[k];
    if (cur && typeof cur === "object" && !Array.isArray(cur) && v && typeof v === "object" && !Array.isArray(v)) {
      deepMerge(cur as Dict, v as Dict);
    } else {
      base[k] = v;
    }
  }
  return base;
}

interface ChartArgs {
  chartId: string;
  chartType: "line" | "bar" | "doughnut";
  labels: unknown[];
  datasets: Dict[];
  title?: string;
  yAxisLabel?: string;
  xAxisLabel?: string;
  annotations?: Dict;
  optionsOverride?: Dict;
}

function buildChartHtml(args: ChartArgs): string {
  const options: Dict = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      title: {
        display: Boolean(args.title),
        text: args.title ?? "",
        font: { size: 14, weight: "bold" },
      },
      legend: { display: args.datasets.length > 1 },
    },
    scales: {},
  };

  if (args.chartType === "line" || args.chartType === "bar") {
    (options.scales as Dict).y = {
      beginAtZero: false,
      title: { display: Boolean(args.yAxisLabel), text: args.yAxisLabel ?? "" },
    };
    (options.scales as Dict).x = {
      title: { display: Boolean(args.xAxisLabel), text: args.xAxisLabel ?? "" },
    };
  }

  if (args.annotations && Object.keys(args.annotations).length) {
    (options.plugins as Dict).annotation = { annotations: args.annotations };
  }

  if (args.optionsOverride) {
    deepMerge(options, args.optionsOverride);
  }

  const config = {
    type: args.chartType,
    data: { labels: args.labels, datasets: args.datasets },
    options,
  };
  const configJson = JSON.stringify(config);

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
}

// ====
// Lab trend
// ====

export function buildLabTrendChart(
  testName: string,
  values: { date?: string; value?: unknown; unit?: string }[],
  normalRange?: [number, number],
): string {
  if (!values.length) {
    return '<p style="color: #64748b; text-align: center;">No data available</p>';
  }
  const labels: string[] = [];
  const dataPoints: number[] = [];
  for (const v of values) {
    const num = typeof v.value === "number" ? v.value : Number.parseFloat(String(v.value ?? ""));
    if (Number.isNaN(num)) continue;
    labels.push((v.date ?? "").slice(0, 10));
    dataPoints.push(num);
  }
  let abnormal: boolean[] = dataPoints.map(() => false);
  if (normalRange) {
    const [low, high] = normalRange;
    abnormal = dataPoints.map((val) => val < low || val > high);
  }
  const pointColors = abnormal.map((a) => (a ? CHART_COLORS.danger : CHART_COLORS.primary));
  const chartId = `lab_chart_${hashId(testName)}`;

  const datasets: Dict[] = [
    {
      label: testName,
      data: dataPoints,
      borderColor: CHART_COLORS.primary,
      backgroundColor: CHART_COLORS.primary_bg,
      pointBackgroundColor: pointColors,
      pointBorderColor: pointColors,
      pointRadius: 6,
      fill: true,
      tension: 0.3,
    },
  ];

  const annotations: Dict = {};
  if (normalRange) {
    annotations.normalRange = {
      type: "box",
      yMin: normalRange[0],
      yMax: normalRange[1],
      backgroundColor: "rgba(16, 185, 129, 0.1)",
      borderColor: "rgba(16, 185, 129, 0.3)",
      borderWidth: 1,
      label: { content: "Normal Range", enabled: true, position: "end" },
    };
  }

  const unit = values[0]?.unit ?? "";
  return buildChartHtml({
    chartId,
    chartType: "line",
    labels,
    datasets,
    title: `${testName} Trend`,
    yAxisLabel: unit,
    annotations,
  });
}

// ====
// Vitals dashboard
// ====

export function buildVitalsDashboard(vitals: Dict[]): string {
  if (!vitals.length) {
    return '<p style="color: #64748b; text-align: center;">No vitals data</p>';
  }
  const groups = new Map<string, { date: string; value: unknown; unit: string }[]>();
  for (const v of vitals) {
    const test = ((v.test as string) ?? "Unknown").trim();
    const list = groups.get(test) ?? [];
    list.push({
      date: ((v.date as string) ?? "").slice(0, 10),
      value: v.value,
      unit: (v.unit as string) ?? "",
    });
    groups.set(test, list);
  }
  const charts: string[] = [];
  for (const [test, series] of [...groups.entries()].sort()) {
    const numeric = series.filter((s) => typeof s.value === "number");
    if (!numeric.length) continue;
    charts.push(buildLabTrendChart(test, numeric, VITALS_NORMAL_RANGES[test]));
  }
  if (!charts.length) {
    return '<p style="color: #64748b; text-align: center;">No numeric vitals data</p>';
  }
  const items = charts.map((c) => `<div class="chart-container">${c}</div>`).join("");
  return `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 1rem;">${items}</div>`;
}

// ====
// Visit frequency
// ====

export function buildVisitFrequencyChart(visits: Dict[]): string {
  if (!visits.length) return '<p style="color: #64748b; text-align: center;">No visits</p>';
  const monthly = new Map<string, number>();
  for (const v of visits) {
    const date = (v.date as string) ?? (v.start as string) ?? (v.scheduled_time as string) ?? "";
    if (date) {
      const m = date.slice(0, 7);
      monthly.set(m, (monthly.get(m) ?? 0) + 1);
    }
  }
  const months = [...monthly.keys()].sort();
  if (!months.length) return '<p style="color: #64748b; text-align: center;">No dated visits</p>';
  const data = months.map((m) => monthly.get(m) ?? 0);
  return buildChartHtml({
    chartId: `visits_chart_${hashId(months.join("|"))}`,
    chartType: "bar",
    labels: months,
    datasets: [
      {
        label: "Visits",
        data,
        backgroundColor: CHART_COLORS.primary_bg,
        borderColor: CHART_COLORS.primary,
        borderWidth: 2,
        borderRadius: 4,
      },
    ],
    title: "Visit Frequency",
    yAxisLabel: "Number of Visits",
  });
}

// ====
// Problem distribution
// ====

const PROBLEM_BUCKETS: { name: string; terms: string[] }[] = [
  { name: "Cardiovascular", terms: ["heart", "hypertension", "cardio", "blood pressure", "cholesterol"] },
  { name: "Endocrine", terms: ["diabetes", "thyroid", "obesity", "metabolic"] },
  { name: "Respiratory", terms: ["asthma", "copd", "respiratory", "lung", "breathing"] },
  { name: "Musculoskeletal", terms: ["arthritis", "pain", "back", "joint", "osteo"] },
  { name: "Mental Health", terms: ["anxiety", "depression", "mental", "psychiatric", "bipolar"] },
];

export function buildProblemDistributionChart(problems: Dict[]): string {
  if (!problems.length) return "";
  const counts: Record<string, number> = { Cardiovascular: 0, Endocrine: 0, Respiratory: 0, Musculoskeletal: 0, "Mental Health": 0, Other: 0 };
  for (const p of problems) {
    const name = ((p.name as string) ?? "").toLowerCase();
    const bucket = PROBLEM_BUCKETS.find((b) => b.terms.some((t) => name.includes(t)));
    counts[bucket?.name ?? "Other"] = (counts[bucket?.name ?? "Other"] ?? 0) + 1;
  }
  const labels = Object.keys(counts).filter((k) => (counts[k] ?? 0) > 0);
  const data = labels.map((k) => counts[k] ?? 0);
  if (!data.length) return "";

  const colors = [
    CHART_COLORS.danger,
    CHART_COLORS.warning,
    CHART_COLORS.primary,
    CHART_COLORS.purple,
    CHART_COLORS.success,
    CHART_COLORS.gray,
  ];
  return buildChartHtml({
    chartId: `problems_chart_${hashId(labels.join("|"))}`,
    chartType: "doughnut",
    labels,
    datasets: [
      {
        data,
        backgroundColor: colors.slice(0, data.length),
        borderWidth: 2,
        borderColor: "#ffffff",
      },
    ],
    title: "Problem Categories",
    optionsOverride: { plugins: { legend: { position: "right" } } },
  });
}

// ====
// Medication timeline
// ====

export function buildMedicationTimeline(medications: Dict[]): string {
  if (!medications.length) {
    return '<p style="color: #64748b; text-align: center;">No medications</p>';
  }
  const labels: string[] = [];
  const durations: number[] = [];
  const now = Date.now();
  for (const med of medications.slice(0, 15)) {
    labels.push(((med.name as string) ?? "Unknown").slice(0, 35));
    const start =
      (med.authored_on as string) ?? (med.start_date as string) ?? "";
    let startMs = now;
    if (start) {
      const t = Date.parse(start.slice(0, 10));
      if (!Number.isNaN(t)) startMs = t;
    }
    const days = Math.max(Math.floor((now - startMs) / 86_400_000), 30);
    durations.push(days);
  }
  const colors = [
    CHART_COLORS.primary,
    CHART_COLORS.success,
    CHART_COLORS.purple,
    CHART_COLORS.warning,
    CHART_COLORS.gray,
  ];
  const bg = Array.from({ length: durations.length }, (_, i) => colors[i % colors.length]);
  return buildChartHtml({
    chartId: `med_timeline_${hashId(labels.join("|"))}`,
    chartType: "bar",
    labels,
    datasets: [{ label: "Days on medication", data: durations, backgroundColor: bg, borderRadius: 4 }],
    title: "Active Medications",
    xAxisLabel: "Days on medication",
    optionsOverride: { indexAxis: "y", scales: { x: { title: { display: true, text: "Days" } } } },
  });
}
