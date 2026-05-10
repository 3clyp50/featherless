/**
 * Clinical UI display builder — interactive HTML cards/tables for MCP-UI.
 * Pure HTML emitters; no DOM API, no React.
 */

type Dict = Record<string, unknown>;

const COLORS = {
  critical: "#dc2626",
  warning: "#f59e0b",
  info: "#3b82f6",
  success: "#10b981",
  muted: "#6b7280",
  primary: "#2563eb",
  background: "#f8fafc",
  card: "#ffffff",
  border: "#e2e8f0",
  text: "#1e293b",
  text_muted: "#64748b",
} as const;

function esc(text: unknown): string {
  if (text === null || text === undefined) return "";
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function styles(): string {
  return `
  <style>
    .clinical-context { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: ${COLORS.background}; color: ${COLORS.text}; padding: 1rem; max-width: 1200px; margin: 0 auto; }
    .header { background: linear-gradient(135deg, ${COLORS.primary} 0%, #1d4ed8 100%); color: white;
      padding: 1.5rem; border-radius: 12px; margin-bottom: 1rem; }
    .header h1 { margin: 0 0 0.5rem 0; font-size: 1.75rem; }
    .header .patient-meta { opacity: 0.9; font-size: 1rem; }
    .card { background: ${COLORS.card}; border: 1px solid ${COLORS.border}; border-radius: 8px;
      padding: 1rem; margin-bottom: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
    .card-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.75rem;
      padding-bottom: 0.5rem; border-bottom: 1px solid ${COLORS.border}; }
    .card-title { font-weight: 600; font-size: 1.1rem; margin: 0; }
    .badge { display: inline-block; padding: 0.25rem 0.5rem; border-radius: 9999px;
      font-size: 0.75rem; font-weight: 500; }
    .badge-critical { background: #fef2f2; color: ${COLORS.critical}; border: 1px solid #fecaca; }
    .badge-warning  { background: #fffbeb; color: ${COLORS.warning}; border: 1px solid #fde68a; }
    .badge-info     { background: #eff6ff; color: ${COLORS.info}; border: 1px solid #bfdbfe; }
    .alert { padding: 1rem; border-radius: 8px; margin-bottom: 0.75rem;
      display: flex; align-items: flex-start; gap: 0.75rem; }
    .alert-critical { background: #fef2f2; border-left: 4px solid ${COLORS.critical}; }
    .alert-warning  { background: #fffbeb; border-left: 4px solid ${COLORS.warning}; }
    .alert-info     { background: #eff6ff; border-left: 4px solid ${COLORS.info}; }
    .alert-icon { font-size: 1.25rem; }
    .alert-content { flex: 1; }
    .alert-title { font-weight: 600; margin: 0 0 0.25rem 0; }
    .alert-details { font-size: 0.875rem; color: ${COLORS.text_muted}; }
    table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid ${COLORS.border}; }
    th { font-weight: 600; color: ${COLORS.text_muted}; font-size: 0.8rem;
      text-transform: uppercase; letter-spacing: 0.05em; }
    tr:last-child td { border-bottom: none; }
    .abnormal { color: ${COLORS.critical}; font-weight: 600; }
    .empty-state { text-align: center; padding: 1rem; color: ${COLORS.text_muted}; font-style: italic; }
    .two-column { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 1rem; }
    .detail-row { display: flex; justify-content: space-between; padding: 0.5rem 0;
      border-bottom: 1px solid ${COLORS.border}; }
    .detail-row:last-child { border-bottom: none; }
    .detail-label { color: ${COLORS.text_muted}; font-size: 0.875rem; }
    .detail-value { font-weight: 500; }
    .footer { text-align: center; padding: 1rem; color: ${COLORS.text_muted}; font-size: 0.75rem; }
    .section-icon { font-size: 1.25rem; }
  </style>`;
}

function buildHeader(name: string, age: number | null, gender: string, patientId: unknown): string {
  const ageStr = age ? `${age}yo` : "";
  const genderShort = gender ? gender.charAt(0).toUpperCase() : "";
  const meta = [ageStr, genderShort].filter(Boolean).join(" | ");
  return `
  <div class="header">
    <h1>${esc(name)}</h1>
    <div class="patient-meta">
      ${meta}${patientId ? ` | ID: ${esc(String(patientId))}` : ""}
    </div>
  </div>`;
}

function buildAlertsSection(alerts: Dict[]): string {
  if (!alerts.length) return "";
  const rendered = alerts.map((a) => {
    let severity = (a.severity as string) ?? "info";
    if (severity === "high") severity = "critical";
    else if (severity === "medium") severity = "warning";
    else if (!["critical", "warning", "info"].includes(severity)) severity = "info";
    const icon = severity === "critical" ? "⚠️" : severity === "warning" ? "⚡" : "ℹ️";

    const details = (a.details as unknown[] | undefined) ?? [];
    let detailsHtml = "";
    if (details.length) {
      const items = details
        .slice(0, 5)
        .map((d) => esc(String(d)))
        .join("<br>• ");
      detailsHtml = `<p class="alert-details">• ${items}</p>`;
    }
    return `
    <div class="alert alert-${severity}">
      <span class="alert-icon">${icon}</span>
      <div class="alert-content">
        <p class="alert-title">${esc((a.message as string) ?? "")}</p>
        ${detailsHtml}
      </div>
    </div>`;
  });
  return `<div class='alerts-section'>${rendered.join("")}</div>`;
}

function buildAllergiesSection(allergies: Dict[]): string {
  let content: string;
  if (!allergies.length) {
    content = '<p class="empty-state">No known allergies documented</p>';
  } else {
    const rows = allergies.map((a) => {
      const severity = ((a.severity as string) ?? "").toLowerCase();
      const severityClass = ["severe", "high"].includes(severity) ? "abnormal" : "";
      return `
      <tr>
        <td class="${severityClass}">${esc(a.allergen)}</td>
        <td>${esc(a.reaction ?? "Not specified")}</td>
        <td>${esc(a.severity ?? "Unknown")}</td>
      </tr>`;
    });
    content = `
    <table>
      <thead><tr><th>Allergen</th><th>Reaction</th><th>Severity</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
  }
  return `
  <div class="card">
    <div class="card-header">
      <span class="section-icon">🚨</span>
      <h2 class="card-title">Allergies</h2>
      <span class="badge badge-critical">${allergies.length} documented</span>
    </div>
    ${content}
  </div>`;
}

function buildMedicationsSection(meds: Dict[]): string {
  let content: string;
  if (!meds.length) {
    content = '<p class="empty-state">No active medications</p>';
  } else {
    const rows = meds.map(
      (m) => `
      <tr>
        <td><strong>${esc(m.name)}</strong></td>
        <td>${esc(m.dose ?? "")}</td>
        <td>${esc(m.frequency ?? "")}</td>
      </tr>`,
    );
    content = `<table>
      <thead><tr><th>Medication</th><th>Dose</th><th>Frequency</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
  }
  return `
  <div class="card">
    <div class="card-header">
      <span class="section-icon">💊</span>
      <h2 class="card-title">Active Medications</h2>
      <span class="badge badge-info">${meds.length} active</span>
    </div>
    ${content}
  </div>`;
}

function buildProblemsSection(problems: Dict[]): string {
  let content: string;
  if (!problems.length) {
    content = '<p class="empty-state">No active problems documented</p>';
  } else {
    const rows = problems.map(
      (p) => `
      <tr>
        <td>${esc(p.name)}</td>
        <td><code>${esc(p.icd_code ?? "N/A")}</code></td>
        <td>${esc(p.onset_date ?? "Unknown")}</td>
      </tr>`,
    );
    content = `<table>
      <thead><tr><th>Condition</th><th>ICD Code</th><th>Onset</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
  }
  return `
  <div class="card">
    <div class="card-header">
      <span class="section-icon">📋</span>
      <h2 class="card-title">Active Problems</h2>
      <span class="badge badge-warning">${problems.length} active</span>
    </div>
    ${content}
  </div>`;
}

function buildLabsSection(labs: Dict[]): string {
  let content: string;
  if (!labs.length) {
    content = '<p class="empty-state">No recent lab results</p>';
  } else {
    const rows = labs.map((lab) => {
      const isAbnormal = Boolean(lab.abnormal);
      const cls = isAbnormal ? "abnormal" : "";
      const value = lab.value;
      const unit = lab.unit ?? "";
      let display = `${value !== null && value !== undefined ? value : ""} ${unit}`.trim();
      if (isAbnormal) display = `⚠️ ${display}`;
      return `
      <tr>
        <td>${esc(lab.test)}</td>
        <td class="${cls}">${esc(display)}</td>
        <td>${esc(lab.normal_range ?? "N/A")}</td>
        <td>${esc(((lab.date as string) ?? "").slice(0, 10))}</td>
      </tr>`;
    });
    content = `<table>
      <thead><tr><th>Test</th><th>Value</th><th>Normal Range</th><th>Date</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>`;
  }
  return `
  <div class="card">
    <div class="card-header">
      <span class="section-icon">🔬</span>
      <h2 class="card-title">Recent Lab Results</h2>
    </div>
    ${content}
  </div>`;
}

function buildVisitsSection(visits: Dict[]): string {
  if (!visits.length) return "";
  const rows = visits.map((v) => {
    const date = ((v.date as string) ?? (v.start as string) ?? "").slice(0, 10);
    return `
    <tr>
      <td>${esc(date)}</td>
      <td>${esc(v.reason ?? v.type ?? "Not specified")}</td>
      <td>${esc(v.status ?? "")}</td>
    </tr>`;
  });
  return `
  <div class="card">
    <div class="card-header">
      <span class="section-icon">📅</span>
      <h2 class="card-title">Recent Visits</h2>
    </div>
    <table>
      <thead><tr><th>Date</th><th>Reason</th><th>Status</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  </div>`;
}

function buildImmunizationsSection(imms: Dict[]): string {
  if (!imms.length) return "";
  const rows = imms.map(
    (v) => `
    <tr>
      <td>${esc(v.vaccine)}</td>
      <td>${esc(v.date_administered ?? "Unknown")}</td>
      <td><code>${esc(v.cvx_code ?? "N/A")}</code></td>
    </tr>`,
  );
  return `
  <div class="card">
    <div class="card-header">
      <span class="section-icon">💉</span>
      <h2 class="card-title">Immunizations</h2>
      <span class="badge badge-info">${imms.length} recorded</span>
    </div>
    <table>
      <thead><tr><th>Vaccine</th><th>Date</th><th>CVX Code</th></tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  </div>`;
}

function buildDemographicsSection(d: Dict): string {
  return `
  <div class="card">
    <div class="card-header">
      <span class="section-icon">👤</span>
      <h2 class="card-title">Demographics &amp; Contact</h2>
    </div>
    <div class="two-column">
      <div>
        <div class="detail-row"><span class="detail-label">Date of Birth</span><span class="detail-value">${esc(d.date_of_birth ?? "")}</span></div>
        <div class="detail-row"><span class="detail-label">Gender</span><span class="detail-value">${esc(d.gender ?? "")}</span></div>
      </div>
      <div>
        <div class="detail-row"><span class="detail-label">Phone</span><span class="detail-value">${esc(d.phone ?? "Not on file")}</span></div>
        <div class="detail-row"><span class="detail-label">Email</span><span class="detail-value">${esc(d.email ?? "Not on file")}</span></div>
        <div class="detail-row"><span class="detail-label">Address</span><span class="detail-value">${esc(d.address ?? "Not on file")}</span></div>
      </div>
    </div>
  </div>`;
}

function buildMemoriesSection(memories: unknown): string {
  if (!Array.isArray(memories) || !memories.length) return "";
  const items: string[] = [];
  for (const mem of memories) {
    if (typeof mem === "string") items.push(`<li>${esc(mem.slice(0, 300))}</li>`);
    else if (mem && typeof mem === "object") {
      const m = mem as Dict;
      const content = (m.content as string) ?? (m.text as string) ?? JSON.stringify(m);
      items.push(`<li>${esc(String(content).slice(0, 300))}</li>`);
    }
  }
  if (!items.length) return "";
  return `
  <div class="card">
    <div class="card-header">
      <span class="section-icon">🧠</span>
      <h2 class="card-title">Clinical Memory (Past Encounters)</h2>
    </div>
    <ul style="margin: 0; padding-left: 1.5rem;">
      ${items.slice(0, 5).join("")}
    </ul>
  </div>`;
}

export function buildClinicalContextDisplay(context: Dict): string {
  const demographics = (context.demographics as Dict) ?? {};
  const patientName = (demographics.name as string) ?? "Unknown Patient";
  const age = (demographics.age as number | null) ?? null;
  const gender = (demographics.gender as string) ?? "";

  const parts = [
    styles(),
    buildHeader(patientName, age, gender, context.patient_id),
    buildAlertsSection((context.alerts as Dict[]) ?? []),
    buildAllergiesSection((context.allergies as Dict[]) ?? []),
    buildMedicationsSection((context.active_medications as Dict[]) ?? []),
    buildProblemsSection((context.active_problems as Dict[]) ?? []),
    buildLabsSection((context.recent_labs as Dict[]) ?? []),
    buildVisitsSection((context.recent_encounters as Dict[]) ?? []),
    buildImmunizationsSection((context.immunizations as Dict[]) ?? []),
    buildDemographicsSection(demographics),
  ];

  if (context.past_encounter_memories) {
    parts.push(buildMemoriesSection(context.past_encounter_memories));
  }

  const retrievedAt = (context.retrieved_at as string) ?? new Date().toISOString();
  return `
  <div class="clinical-context">
    ${parts.join("")}
    <footer class="footer">Retrieved: ${esc(retrievedAt)} · featherless</footer>
  </div>`;
}

// Per-section exports for finer-grained reuse
export {
  buildAlertsSection,
  buildAllergiesSection,
  buildMedicationsSection,
  buildProblemsSection,
  buildLabsSection,
  buildVisitsSection,
  buildImmunizationsSection,
  buildDemographicsSection,
  buildMemoriesSection,
};
