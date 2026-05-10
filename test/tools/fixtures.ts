import type { VisitContext } from "../../src/tools/schemas/visit-context.ts";

export const heroVisitContext: VisitContext = {
  patient: {
    id: "hapi-garcia-maria",
    name: "María Garcia",
    age: 67,
    preferred_language: "es-US",
    reading_level_target: "grade-6-es",
  },
  encounter: {
    id: "enc-2026-05-05-cardiology-fu",
    date: "2026-05-05",
    type: "cardiology-follow-up",
    provider: "Dr. James Chen",
    reason: "6-week follow-up after HFrEF medication titration",
  },
  active_problems: [
    { display: "Heart failure with reduced EF (EF 38%)", icd10: "I50.22", nyha: "II" },
    { display: "Type 2 diabetes mellitus", icd10: "E11.9", last_a1c: 7.8 },
    { display: "CKD stage 3a", icd10: "N18.31", egfr: 52 },
    { display: "Essential hypertension", icd10: "I10" },
    { display: "Hyperlipidemia", icd10: "E78.5" },
  ],
  medication_changes: [
    {
      action: "new",
      name: "furosemide",
      dose: "20 mg PO PRN",
      reason: "trace ankle edema",
      behavior_rule:
        "Take only on days the patient notices puffy ankles or has gained more than 1 kg overnight.",
    },
    { action: "continue", name: "metoprolol succinate", dose: "50 mg PO daily" },
    { action: "continue", name: "empagliflozin", dose: "10 mg PO daily" },
    { action: "continue", name: "lisinopril", dose: "20 mg PO daily" },
    { action: "continue", name: "atorvastatin", dose: "40 mg PO QHS" },
    { action: "continue", name: "metformin", dose: "1000 mg PO BID" },
  ],
  orders: [
    { type: "lab", display: "BMP", timing: "2 weeks" },
    { type: "lab", display: "BNP", timing: "2 weeks" },
    { type: "imaging", display: "Echocardiogram", timing: "8 weeks" },
    { type: "appointment", display: "Cardiology follow-up", timing: "8 weeks" },
  ],
  vitals_today: { bp: "128/76", hr: 72, weight_change_kg: -1.8 },
  key_labs_recent: { egfr: 52, k: 4.4, a1c: 7.8 },
  caregiver_present: "daughter Ana",
  clinician_summary:
    "67yo F with HFrEF (EF 38%), T2DM, CKD3a, HTN, here for 6-week f/u after metoprolol succinate uptitration to 50mg daily and addition of empagliflozin 10mg daily. BP today 128/76. HR 72. Wt down 1.8 kg from baseline. Reports improved exertional dyspnea. eGFR stable at 52. K+ 4.4. Plan: continue current regimen, repeat BMP and BNP in 2 weeks, return visit in 8 weeks. Patient education provided on heart-failure self-monitoring (daily weights, salt, fluid balance). Daughter present, reinforced teaching.",
};
