// ESP v2 — API Client
// All requests go through this client for consistent error handling.

import type { Application, ApplicationDocument, Certificate, DashboardStats, ServiceDefinition, User } from '../types';

const BASE = '/api/v1';

function getToken(): string | null {
  return localStorage.getItem('esp_token');
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  isFormData = false,
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Always tell Laravel we expect JSON — without this, validation errors
  // return 302 redirects instead of 422 JSON responses.
  headers['Accept'] = 'application/json';

  if (!isFormData && body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: isFormData ? (body as FormData) : body ? JSON.stringify(body) : undefined,
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    // EDA-10: Surface field-level errors and Hukm governance fields to the caller
    const err = new Error(json.message || `HTTP ${res.status}`) as Error & {
      errors?:   Record<string, string>;
      status?:   number;
      blockers?: unknown[];
      verdict?:  string;
    };
    err.errors   = json.errors;
    err.status   = res.status;
    err.blockers = json.blockers;   // Hukm: fatal blockers that halted generation
    err.verdict  = json.verdict;    // Hukm: verdict when halted (always 'batil')
    throw err;
  }

  return json as T;
}

// ── Auth ─────────────────────────────────────────────────────────────

export const authApi = {
  login:  (email: string, password: string) =>
    request<{ token: string; user: User }>('POST', '/auth/login', { email, password }),
  me:     () => request<{ user: User }>('GET', '/auth/me'),
  logout: () => request<void>('POST', '/auth/logout'),
  changePassword: (current_password: string, password: string, password_confirmation: string) =>
    request<{ message: string }>('POST', '/auth/password/change', { current_password, password, password_confirmation }),
};

// ── Services ──────────────────────────────────────────────────────────

export const servicesApi = {
  list: () => request<{ services: ServiceDefinition[] }>('GET', '/services'),
  get:  (code: string) => request<{ service: ServiceDefinition }>('GET', `/services/${code}`),
};

// ── Applications ──────────────────────────────────────────────────────

export const applicationsApi = {
  list:   () => request<{ applications: Application[] }>('GET', '/applications'),
  get:    (id: number) => request<{ application: Application }>('GET', `/applications/${id}`),
  create: (service_code: string, data: Record<string, unknown>) =>
    request<{ application: Application }>('POST', '/applications', { service_code, data }),
  update: (id: number, data: Record<string, unknown>) =>
    request<{ application: Application }>('PUT', `/applications/${id}`, { data }),
  submit: (id: number) => request<{ application: Application }>('POST', `/applications/${id}/submit`),
  uploadDocument: (id: number, document_id: string, file: File) => {
    const fd = new FormData();
    fd.append('document_id', document_id);
    fd.append('file', file);
    return request<{ document: ApplicationDocument }>('POST', `/applications/${id}/documents`, fd, true);
  },
  reviewQueue: () => request<{ applications: Application[] }>('GET', '/review/queue'),
  claim:  (id: number) => request<{ application: Application }>('POST', `/applications/${id}/claim`),
  release: (id: number) => request<{ application: Application }>('POST', `/applications/${id}/release`),
  decide: (id: number, decision: string, notes?: string, annotations?: unknown) =>
    request<{ review: unknown; application: Application }>('POST', `/applications/${id}/decide`, { decision, notes, annotations }),
  confirmPayment: (id: number, payment_reference: string) =>
    request<{ application: Application }>('POST', `/applications/${id}/confirm-payment`, { payment_reference }),
  issueCertificate: (id: number) =>
    request<{ certificate: Certificate; application: Application }>('POST', `/applications/${id}/issue-certificate`),
};

// ── Review API (alias for reviewer pages) ────────────────────────────

export const reviewApi = {
  queue:            () => applicationsApi.reviewQueue(),
  get:              (id: number) => applicationsApi.get(id),
  claim:            (id: number) => applicationsApi.claim(id),
  release:          (id: number) => applicationsApi.release(id),
  decide:           (id: number, decision: string, notes?: string, annotations?: unknown) =>
                      applicationsApi.decide(id, decision, notes, annotations),
  confirmPayment:   (id: number, ref: string) => applicationsApi.confirmPayment(id, ref),
  issueCertificate: (id: number) => applicationsApi.issueCertificate(id),
};

// ── Integration / Nashmi (uses integration key, not bearer token) ─────
// Integration key read from Vite env var — set VITE_INTEGRATION_KEY in .env
// Never hardcode secrets in source code.

const INTEGRATION_KEY = import.meta.env.VITE_INTEGRATION_KEY ?? '';
const INT_BASE = '/api/integration';

async function integrationRequest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${INT_BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Integration-Key': INTEGRATION_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.message || `HTTP ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return json as T;
}

export interface IntegrationCycle {
  id: number;
  cycle_ref: string;
  service_name: string;
  requirements_source: string;
  status: 'requirements_received' | 'code_done' | 'feedback_received' | 'closed';
  nashmi_project_id: number | null;
  requirements_meta: Record<string, unknown> | null;
  code_summary: Record<string, unknown> | null;
  feedback: Record<string, unknown> | null;
  notes: string | null;
  requirements_received_at: string | null;
  code_done_notified_at: string | null;
  feedback_received_at: string | null;
  created_at: string;
  updated_at: string;
}

export const integrationApi = {
  cycles: () =>
    integrationRequest<{ data: IntegrationCycle[] }>('GET', '/cycles'),
  cycle: (id: number) =>
    integrationRequest<{ data: IntegrationCycle }>('GET', `/cycles/${id}`),
  notifyCodeDone: (id: number, payload: {
    git_branch?: string;
    git_commit?: string;
    files_changed?: string[];
    api_endpoints?: string[];
    frontend_pages?: string[];
    db_tables?: string[];
    notes?: string;
  }) =>
    integrationRequest<{ message: string; cycle_ref: string; nashmi_project: unknown }>
      ('POST', `/cycles/${id}/notify-done`, payload),
};

// ── Admin ─────────────────────────────────────────────────────────────

export const adminApi = {
  dashboard:       () => request<{ stats: DashboardStats }>('GET', '/admin/dashboard'),
  listUsers:       () => request<{ users: User[] }>('GET', '/admin/users'),
  createUser:      (data: unknown) => request<{ user: User }>('POST', '/admin/users', data),
  updateUser:      (id: number, data: unknown) => request<{ user: User }>('PUT', `/admin/users/${id}`, data),
  allApplications: (status?: string) =>
    request<{ data: Application[] }>('GET', `/admin/applications${status ? `?status=${status}` : ''}`),
  auditLogs: () => request<{ data: unknown[] }>('GET', '/admin/audit-logs'),

  /** List all services including drafts */
  listServices: () =>
    request<{ services: ServiceDefinition[] }>('GET', '/admin/services'),

  /** Get single service with full schema */
  getService: (id: number) =>
    request<{ service: ServiceDefinition }>('GET', `/admin/services/${id}`),

  /** Update service status */
  updateServiceStatus: (id: number, status: 'active' | 'inactive' | 'draft') =>
    request<{ service: ServiceDefinition }>('PATCH', `/services/${id}/status`, { status }),

  /** Update service schema/metadata */
  updateService: (id: number, data: Partial<{
    name_ar: string; name_en: string; description_ar: string;
    description_en: string; schema: Record<string, unknown>; status: string;
  }>) => request<{ service: ServiceDefinition }>('PUT', `/services/${id}`, data),

  /** FR-019: Apply a natural-language change to an existing schema via Claude */
  chatUpdateSchema: (current_schema: Record<string, unknown>, message: string) =>
    request<{ updated_schema: Record<string, unknown>; explanation: string; changes: string[]; tokens_used: number }>(
      'POST', '/admin/services/chat-schema', { current_schema, message }
    ),

  /** FR-018: Generate ESP v2 schema from SRS text via Claude API (server-side).
   *  Applies full Hukm Governance Layer — returns verdict, validation_report,
   *  blockers, hukm_ir, and generation_audit alongside the schema. */
  generateSchema: (srs_text: string, service_code?: string, mode: 'azimah' | 'rukhsa' = 'azimah', cycle_id?: number) =>
    request<{
      schema:             Record<string, unknown>;
      verdict:            'sahih' | 'fasid' | 'batil';
      validation_report:  Record<string, unknown>;
      blockers:           Array<{ type: string; severity: string; decision: string; message: string; resolution: string }>;
      hukm_ir:            Array<Record<string, unknown>> | null;
      generation_audit:   Record<string, unknown>;
      mode:               'azimah' | 'rukhsa';
      tokens_used:        number;
      model:              string;
    }>('POST', '/admin/services/generate-schema', { srs_text, service_code, mode, cycle_id }),

  generateSchemaFromFile: (srsFile: File, nfrFile?: File | null, service_code?: string, mode: 'azimah' | 'rukhsa' = 'azimah', cycle_id?: number) => {
    const fd = new FormData();
    fd.append('srs_file', srsFile);
    if (nfrFile) fd.append('nfr_file', nfrFile);
    if (service_code) fd.append('service_code', service_code);
    fd.append('mode', mode);
    if (cycle_id) fd.append('cycle_id', String(cycle_id));
    return request<{
      schema:             Record<string, unknown>;
      verdict:            'sahih' | 'fasid' | 'batil';
      validation_report:  Record<string, unknown>;
      blockers:           Array<{ type: string; severity: string; decision: string; message: string; resolution: string }>;
      hukm_ir:            Array<Record<string, unknown>> | null;
      generation_audit:   Record<string, unknown>;
      mode:               'azimah' | 'rukhsa';
      tokens_used:        number;
      model:              string;
    }>('POST', '/admin/services/generate-schema-from-file', fd, true);
  },

  /** Save a generated schema as a new ServiceDefinition */
  saveService: (data: {
    code: string; name_ar: string; name_en: string;
    description_ar?: string; description_en?: string;
    currency?: string; schema: Record<string, unknown>;
    status: 'draft' | 'active';
  }) => request<{ service: ServiceDefinition }>('POST', '/services', data),
};
