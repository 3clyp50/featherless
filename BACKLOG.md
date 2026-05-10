# BACKLOG.md

New ideas land here instead of in the D5/D6 build. The discipline is part of the product.

## Post-Hackathon Product Ideas

| Idea | Why It Is Tempting | Why It Is Not In The Submission |
|---|---|---|
| More languages | Real clinics need Vietnamese, Mandarin, Tagalog, Haitian Creole, Arabic, and more. | Spanish plus English is enough to prove the AI Factor in a 3-minute video. |
| Teach-back chat | Confirms the patient understood the packet. | It is a second patient-facing workflow and needs its own safety evaluation. |
| Voice or SMS packet | Better for some older or low-literacy patients. | Audio is harder to judge in a short platform demo. |
| Appointment-booking integration | Closes the operational loop. | Vendor-specific scheduling APIs are outside the hackathon sandbox. |
| PEMAT auto-scoring | Makes packet quality measurable. | Readability + grounding + manual review are enough for submission. |
| Audit dashboard | Production teams will want it. | The A2A trace and SHARP proof screenshots carry the judging story. |
| BAA-ready deployment template | Real buyer enablement. | A Terraform and compliance pack is a post-hackathon sprint. |
| Additional hero patients | Shows generality. | One deeply tested patient is better than two thin ones for this deadline. |
| Patient portal write-back adapters | Makes `DocumentReference` delivery real across EHRs. | The safe MVP emits standards-correct resources and gates write-back. |
| Cost analytics | Useful for buyer conversations. | Any ROI number before deployment would be speculative. |

## Technical Ideas Parked

| Idea | Reason To Park |
|---|---|
| Router framework for orchestrator | Native Worker `fetch()` is smaller and has no new dependency risk. |
| Citation RAG | The current citation pack is small enough for explicit allow-list grounding. |
| Streaming A2A | Prompt Opinion can invoke non-streaming JSON-RPC; trace beats token streaming for this workflow. |
| Memory-aware visit packets | The substrate has memory tools, but the submitted workflow should stay visit-scoped. |
| Real EHR launch | SMART sandbox setup costs time and adds no PHI-safety benefit for the video. |

## How To Add

Add one row with the tempting upside and the reason it stays out of the current build. If the reason is weak, fix the plan before writing code.
