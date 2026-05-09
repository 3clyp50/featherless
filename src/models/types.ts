/**
 * Shared literal types and Zod schemas across tool modules.
 */
import { z } from "zod";

export const ResourceTypeSchema = z.enum([
  "Patient",
  "Observation",
  "Condition",
  "MedicationRequest",
  "AllergyIntolerance",
  "Immunization",
  "DiagnosticReport",
  "Procedure",
  "Encounter",
  "Appointment",
  "DocumentReference",
  "Coverage",
]);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const ObservationCategorySchema = z.enum([
  "vital-signs",
  "laboratory",
  "imaging",
  "social-history",
  "survey",
  "exam",
  "therapy",
  "activity",
  "procedure",
]);
export type ObservationCategory = z.infer<typeof ObservationCategorySchema>;

export const ConditionStatusSchema = z.enum(["active", "recurrence", "relapse", "inactive", "remission", "resolved"]);
export const MedicationStatusSchema = z.enum(["active", "on-hold", "cancelled", "completed", "stopped", "draft", "unknown"]);
export const EncounterStatusSchema = z.enum(["planned", "arrived", "triaged", "in-progress", "onleave", "finished", "cancelled"]);
export const AppointmentStatusSchema = z.enum(["proposed", "pending", "booked", "arrived", "fulfilled", "cancelled", "noshow", "checked-in", "waitlist"]);
