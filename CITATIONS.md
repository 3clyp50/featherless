# CITATIONS.md

**Purpose:** closed-world evidence for Featherless. Every clinical, workflow, or impact claim in the patient packet, README, Marketplace listing, video, or judge walkthrough should trace either to the synthetic FHIR chart in `HERO_PATIENT.md` or to one of these citation IDs.

**Curated:** 2026-05-10
**License posture:** public U.S. federal pages where possible; otherwise cite via DOI/URL and avoid redistributing full text.

## Patient Education And Health Literacy

### CIT-001 · AHRQ Plain Language

- **Title:** AHRQ Health Literacy Universal Precautions Toolkit, Tool 4, Plain Language
- **URL:** https://www.ahrq.gov/health-literacy/improve/precautions/tool4.html
- **Used for:** short sentences, common words, active voice, and action-first patient instructions.

### CIT-002 · AHRQ PEMAT

- **Title:** Patient Education Materials Assessment Tool and User's Guide
- **URL:** https://www.ahrq.gov/health-literacy/patient-education/pemat.html
- **Used for:** understandability and actionability framing; PEMAT commonly uses 70% as a patient-ready threshold.

### CIT-003 · Kessels Recall Study

- **Title:** Kessels RPC. "Patients' memory for medical information." Journal of the Royal Society of Medicine, 2003.
- **URL:** https://pmc.ncbi.nlm.nih.gov/articles/PMC539473/
- **Used for:** the recall statistic: patients often forget 40-80% of information given during clinical encounters, and remembered information can be inaccurate.

### CIT-004 · Discharge Comprehension

- **Title:** Engel KG, Heisler M, Smith DM, et al. "Patient comprehension of emergency department care and instructions." Annals of Emergency Medicine, 2009.
- **DOI:** 10.1016/j.annemergmed.2008.05.016
- **Used for:** patient comprehension risk after acute-care instructions; cite carefully as adjacent evidence, not as an outcome claim for Featherless.

### CIT-005 · CDC Clear Communication Index

- **URL:** https://www.cdc.gov/ccindex/index.html
- **Used for:** main message first, explicit call to action, behavioral recommendation clarity.

## Care Transitions

### CIT-006 · AHRQ Re-Engineered Discharge Toolkit

- **URL:** https://www.ahrq.gov/patient-safety/settings/hospital/red/toolkit/index.html
- **Used for:** medication clarity, follow-up instructions, return precautions, and contact-information structure.

### CIT-007 · Joint Commission Discharge Standard

- **URL:** https://www.jointcommission.org/
- **Used for:** real-world alignment with discharge and transition-of-care expectations.

### CIT-008 · CMS Discharge Planning Requirements

- **URL:** https://www.federalregister.gov/documents/2019/09/30/2019-20732/
- **Used for:** regulatory context for structured care-transition workflows.

## Standards And Interoperability

### CIT-009 · HL7 FHIR R4

- **URL:** https://hl7.org/fhir/R4/
- **Used for:** `Patient`, `Encounter`, `Condition`, `MedicationRequest`, `Observation`, `ServiceRequest`, `Task`, `CommunicationRequest`, and `DocumentReference` resource shapes.

### CIT-010 · SHARP

- **URL:** https://sharponmcp.com/
- **Used for:** healthcare context propagation with `X-FHIR-Server-URL`, `X-FHIR-Access-Token`, and `X-Patient-ID`.

### CIT-011 · Model Context Protocol

- **URL:** https://modelcontextprotocol.io/
- **Used for:** MCP tool exposure, JSON-RPC transport, and capability handshake.

### CIT-012 · A2A Protocol

- **URL:** https://a2a-protocol.org/latest/specification/
- **Used for:** external agent card and `message/send` coordination semantics.

### CIT-013 · SMART App Launch

- **URL:** https://hl7.org/fhir/smart-app-launch/
- **Used for:** OAuth2 launch context and FHIR access-token provenance.

### CIT-014 · CMS Interoperability And Prior Authorization Rule

- **URL:** https://www.federalregister.gov/documents/2024/02/08/2024-02635/
- **Used for:** "why now" framing for FHIR-native healthcare automation.

## Workload And Impact Context

### CIT-015 · EHR Inbox Burden

- **Title:** Akbar F, Mark G, Warton EM, et al. "Physicians' Electronic Inbox Work Patterns and Factors Associated with High Inbox Work Duration." JAMIA, 2024.
- **Used for:** clinician inbox burden context. Frame as a hypothesis for reduced portal follow-up, not a proven Featherless outcome.

### CIT-016 · AHRQ Care Transitions Resources

- **URL:** https://www.ahrq.gov/topics/care-transitions.html
- **Used for:** care-transition quality and readmission-risk context.

## Reading Metrics

### CIT-017 · Flesch-Kincaid

- **Title:** Kincaid JP et al., "Derivation of New Readability Formulas for Navy Enlisted Personnel," 1975.
- **Used for:** English reading-grade reporting.

### CIT-018 · INFLESZ

- **Title:** Barrio-Cantalejo IM, et al. "Validacion de la Escala INFLESZ..." Anales del Sistema Sanitario de Navarra, 2008.
- **URL:** https://pubmed.ncbi.nlm.nih.gov/18953367/
- **Used for:** Spanish readability reporting.

## Hackathon Context

### CIT-019 · Agents Assemble Rules

- **URL:** https://agents-assemble.devpost.com/rules
- **Used for:** Marketplace publication, protocol adherence, synthetic-data, video, and judging requirements.

### CIT-020 · Agents Assemble Overview

- **URL:** https://agents-assemble.devpost.com/
- **Used for:** AI Factor, Potential Impact, and Feasibility criteria.

## Grounding Contract

Featherless tools may ground patient-facing claims only in:

1. the structured `visit_context` payload,
2. citation IDs explicitly allowed in the patient-packet request.

If a claim cannot be grounded, it is omitted. No citation, no claim.
