# HERO_PATIENT.md

**Patient:** Mrs. María García
**FHIR dataset:** hand-crafted synthetic R4 bundle loaded into local HAPI
**FHIR base URL:** `http://127.0.0.1:8080/fhir`
**Encounter:** cardiology follow-up, 2026-05-05
**Demo language:** Spanish primary, English control
**Rule:** every patient-facing line must be defensible against this dossier or `CITATIONS.md`.

## 1. Demographics

| Field | Value |
|---|---|
| Name | María García |
| FHIR id | `hapi-garcia-maria` |
| Age / DOB | 67 / 1958-09-14 |
| Sex | Female |
| Preferred language | Spanish (`es-US`) |
| Reading target | Spanish, grade-6 equivalent |
| Lives with | Adult daughter Ana, present at the visit |
| Patient portal | Active, intermittent use |

This patient is synthetic. She is built to exercise the workflow: multilingual education, medication-change clarity, follow-up leakage, and clinician-reviewed send.

## 2. Active Problems

| Problem | ICD-10 | Status |
|---|---|---|
| Heart failure with reduced ejection fraction, EF 38% | `I50.22` | Active, NYHA II |
| Type 2 diabetes mellitus | `E11.9` | Active, A1c 7.8% |
| Chronic kidney disease stage 3a | `N18.31` | Active, eGFR 52 |
| Essential hypertension | `I10` | Active |
| Hyperlipidemia | `E78.5` | Active |

## 3. Encounter

- **Type:** cardiology follow-up, in person
- **Provider:** Dr. James Chen
- **Reason:** 6-week follow-up after HFrEF medication titration
- **Chart summary:** 67-year-old woman with HFrEF, T2DM, CKD3a, and HTN. BP 128/76, HR 72, weight down 1.8 kg from baseline. eGFR stable at 52, potassium 4.4. Continue current regimen, repeat BMP and BNP in 2 weeks, echocardiogram and cardiology follow-up in 8 weeks. Daughter Ana present for teaching.

## 4. Medication Changes

| Action | Drug | Dose | Grounded reason |
|---|---|---|---|
| New | furosemide | 20 mg PO PRN | Trace ankle edema; use only on days with puffy ankles or rapid weight gain |
| Continue | metoprolol succinate | 50 mg PO daily | HFrEF beta blocker |
| Continue | empagliflozin | 10 mg PO daily | HFrEF / diabetes |
| Continue | lisinopril | 20 mg PO daily | HFrEF / hypertension |
| Continue | atorvastatin | 40 mg PO QHS | Hyperlipidemia |
| Continue | metformin | 1000 mg PO BID | T2DM, eGFR 52 |

The new PRN diuretic is the demo-critical change. It needs behavior-level instructions, not a generic medication list.

## 5. Orders

| Order | Type | Timing |
|---|---|---|
| BMP | Lab | 2 weeks |
| BNP | Lab | 2 weeks |
| Echocardiogram | Imaging | 8 weeks |
| Cardiology follow-up | Appointment | 8 weeks |

## 6. Demo Hook

Mrs. García leaves the cardiology clinic with one new medicine, labs due soon, an echo to schedule, and instructions she needs in Spanish. Featherless turns that visit into:

1. a patient packet in plain Spanish,
2. a medication table that flags furosemide as new,
3. return precautions that distinguish a phone call from an emergency,
4. three care-team `Task` resources,
5. a draft `CommunicationRequest` proposal held for clinician review.

Nothing is auto-sent. Nothing is invented.

## 7. Canonical Visit Context

`clinical_pack_visit_context` should return this shape for the hero patient:

```json
{
  "patient": {
    "id": "hapi-garcia-maria",
    "name": "María Garcia",
    "age": 67,
    "preferred_language": "es-US",
    "reading_level_target": "grade-6-es"
  },
  "encounter": {
    "id": "enc-2026-05-05-cardiology-fu",
    "date": "2026-05-05",
    "type": "cardiology-follow-up",
    "provider": "Dr. James Chen",
    "reason": "6-week follow-up after HFrEF medication titration"
  },
  "active_problems": [
    { "display": "Heart failure with reduced EF (EF 38%)", "icd10": "I50.22", "nyha": "II" },
    { "display": "Type 2 diabetes mellitus", "icd10": "E11.9", "last_a1c": 7.8 },
    { "display": "CKD stage 3a", "icd10": "N18.31", "egfr": 52 },
    { "display": "Essential hypertension", "icd10": "I10" },
    { "display": "Hyperlipidemia", "icd10": "E78.5" }
  ],
  "medication_changes": [
    {
      "action": "new",
      "name": "furosemide",
      "dose": "20 mg PO PRN",
      "reason": "trace ankle edema",
      "behavior_rule": "Take only on days the patient notices puffy ankles or has gained more than 1 kg overnight."
    }
  ],
  "orders": [
    { "type": "lab", "display": "BMP", "timing": "2 weeks" },
    { "type": "lab", "display": "BNP", "timing": "2 weeks" },
    { "type": "imaging", "display": "Echocardiogram", "timing": "8 weeks" },
    { "type": "appointment", "display": "Cardiology follow-up", "timing": "8 weeks" }
  ],
  "vitals_today": { "bp": "128/76", "hr": 72, "weight_change_kg": -1.8 },
  "key_labs_recent": { "egfr": 52, "k": 4.4, "a1c": 7.8 },
  "caregiver_present": "daughter Ana"
}
```

## 8. Closure Resource Contract

`clinical_prepare_care_team_closure` emits:

1. `Task` — schedule BMP + BNP draw, due 2026-05-19.
2. `Task` — schedule echocardiogram, due 2026-06-30.
3. `Task` — nurse check-in call, due 2026-05-12.
4. `CommunicationRequest` — send patient packet to portal after clinician review, `status: "draft"`, `intent: "proposal"`.
5. `DocumentReference` — markdown patient packet attachment.

All resources are validated through the configured FHIR server. Write-back requires caller `write_back: true` and Worker env `WRITE_BACK=1`.

## 9. Failure Modes

- Do not translate medication names into slang.
- Do not invent dosing rules, dates, diagnoses, or OTC advice.
- Do not auto-send a packet without review.
- Do not include identifiers beyond the synthetic demo record.
- Do not make patient-facing claims without chart or citation grounding.
