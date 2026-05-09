/**
 * Vendor-neutral asynchronous FHIR R4 client.
 *
 * The token is obtained by the agent host before it ever reaches us, and is
 * forwarded on every MCP invocation via `X-FHIR-Access-Token` (SHARP-on-MCP §3.2).
 */

export type FHIRBundle = {
  resourceType: "Bundle";
  type?: string;
  total?: number;
  entry?: { resource?: Record<string, unknown>; fullUrl?: string }[];
  link?: { relation?: string; url?: string }[];
};

export interface FHIRClientOptions {
  baseUrl: string;
  accessToken?: string | null;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}

export class FHIRError extends Error {
  readonly statusCode: number;
  readonly detail: Record<string, unknown>;

  constructor(opts: { statusCode: number; message: string; detail?: Record<string, unknown> }) {
    super(`[${opts.statusCode}] ${opts.message}`);
    this.name = "FHIRError";
    this.statusCode = opts.statusCode;
    this.detail = opts.detail ?? {};
  }

  toToolResponse(): Record<string, unknown> {
    return {
      error: "fhir_error",
      status_code: this.statusCode,
      message: this.message,
      detail: this.detail,
    };
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class FHIRClient {
  readonly baseUrl: string;
  readonly accessToken: string | null;
  private readonly extraHeaders: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(opts: FHIRClientOptions) {
    if (!opts.baseUrl) {
      throw new Error(
        "FHIRClient requires a baseUrl. Pass X-FHIR-Server-URL or set FHIR_SERVER_URL.",
      );
    }
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.accessToken = opts.accessToken ?? null;
    this.extraHeaders = opts.extraHeaders ?? {};
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private buildHeaders(): HeadersInit {
    const headers: Record<string, string> = {
      Accept: "application/fhir+json",
      "Content-Type": "application/fhir+json",
      ...this.extraHeaders,
    };
    if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
    return headers;
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const url = new URL(this.baseUrl + (path.startsWith("/") ? path : `/${path}`));
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null) continue;
        url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  private async request(
    method: string,
    path: string,
    opts: { params?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<Record<string, unknown>> {
    const url = this.buildUrl(path, opts.params);
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.buildHeaders(),
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 204) return {};
    const text = await response.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { text: text.slice(0, 500) };
      }
    }

    if (!response.ok) {
      throw new FHIRError({
        statusCode: response.status,
        message: response.statusText || `HTTP ${response.status}`,
        detail: (json as Record<string, unknown>) ?? {},
      });
    }
    return (json as Record<string, unknown>) ?? {};
  }

  // --
  // Generic ops
  // --

  get(path: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("GET", path, { params });
  }

  post(path: string, body: unknown): Promise<Record<string, unknown>> {
    return this.request("POST", path, { body });
  }

  getCapabilityStatement(): Promise<Record<string, unknown>> {
    return this.get("/metadata");
  }

  getResource(resourceType: string, resourceId: string): Promise<Record<string, unknown>> {
    return this.get(`/${resourceType}/${resourceId}`);
  }

  search(
    resourceType: string,
    params?: Record<string, unknown>,
  ): Promise<FHIRBundle> {
    return this.get(`/${resourceType}`, params) as Promise<FHIRBundle>;
  }

  // --
  // Convenience accessors
  // --

  getPatient(patientId: string): Promise<Record<string, unknown>> {
    return this.getResource("Patient", patientId);
  }

  searchPatients(opts: {
    name?: string;
    family?: string;
    given?: string;
    birthdate?: string;
    identifier?: string;
    gender?: string;
    count?: number;
  } = {}): Promise<FHIRBundle> {
    const { count = 25, ...rest } = opts;
    return this.search("Patient", { _count: count, ...rest });
  }

  getObservations(
    patientId: string,
    opts: {
      category?: string;
      code?: string;
      date?: string;
      count?: number;
      sort?: string | null;
    } = {},
  ): Promise<FHIRBundle> {
    const { count = 50, sort = "-date", ...rest } = opts;
    const params: Record<string, unknown> = { patient: patientId, _count: count, ...rest };
    if (sort) params._sort = sort;
    return this.search("Observation", params);
  }

  getConditions(
    patientId: string,
    opts: { clinicalStatus?: string; count?: number } = {},
  ): Promise<FHIRBundle> {
    const params: Record<string, unknown> = { patient: patientId, _count: opts.count ?? 50 };
    if (opts.clinicalStatus) params["clinical-status"] = opts.clinicalStatus;
    return this.search("Condition", params);
  }

  getMedicationRequests(
    patientId: string,
    opts: { status?: string; count?: number } = {},
  ): Promise<FHIRBundle> {
    return this.search("MedicationRequest", {
      patient: patientId,
      _count: opts.count ?? 50,
      status: opts.status,
    });
  }

  getAllergies(patientId: string, opts: { count?: number } = {}): Promise<FHIRBundle> {
    return this.search("AllergyIntolerance", { patient: patientId, _count: opts.count ?? 50 });
  }

  getImmunizations(patientId: string, opts: { count?: number } = {}): Promise<FHIRBundle> {
    return this.search("Immunization", { patient: patientId, _count: opts.count ?? 50 });
  }

  getDiagnosticReports(
    patientId: string,
    opts: { category?: string; date?: string; count?: number } = {},
  ): Promise<FHIRBundle> {
    return this.search("DiagnosticReport", {
      patient: patientId,
      _count: opts.count ?? 50,
      category: opts.category,
      date: opts.date,
    });
  }

  getProcedures(patientId: string, opts: { count?: number } = {}): Promise<FHIRBundle> {
    return this.search("Procedure", { patient: patientId, _count: opts.count ?? 50 });
  }

  getEncounters(
    patientId: string,
    opts: { date?: string; status?: string; count?: number } = {},
  ): Promise<FHIRBundle> {
    return this.search("Encounter", {
      patient: patientId,
      _count: opts.count ?? 50,
      date: opts.date,
      status: opts.status,
    });
  }

  getAppointments(
    patientId?: string | null,
    opts: { date?: string; status?: string; count?: number } = {},
  ): Promise<FHIRBundle> {
    const params: Record<string, unknown> = { _count: opts.count ?? 50 };
    if (patientId) params.patient = patientId;
    if (opts.date) params.date = opts.date;
    if (opts.status) params.status = opts.status;
    return this.search("Appointment", params);
  }

  getDocumentReferences(
    patientId: string,
    opts: { category?: string; type?: string; count?: number } = {},
  ): Promise<FHIRBundle> {
    return this.search("DocumentReference", {
      patient: patientId,
      _count: opts.count ?? 25,
      category: opts.category,
      type: opts.type,
    });
  }

  getCoverage(patientId: string, opts: { count?: number } = {}): Promise<FHIRBundle> {
    return this.search("Coverage", { beneficiary: patientId, _count: opts.count ?? 10 });
  }

  getPatientEverything(
    patientId: string,
    opts: { start?: string; end?: string; types?: string[] } = {},
  ): Promise<Record<string, unknown>> {
    const params: Record<string, unknown> = {};
    if (opts.start) params.start = opts.start;
    if (opts.end) params.end = opts.end;
    if (opts.types?.length) params._type = opts.types.join(",");
    return this.get(
      `/Patient/${patientId}/$everything`,
      Object.keys(params).length ? params : undefined,
    );
  }
}
