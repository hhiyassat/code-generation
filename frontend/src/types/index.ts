// ESP v2 — TypeScript Types
// NFR-003: Bilingual (Arabic/English) throughout

export interface Organization {
  id: number;
  name_ar: string;
  name_en: string;
  slug: string;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: 'applicant' | 'staff' | 'auditor' | 'admin';
  organization_id: number;
  is_active?: boolean;
  created_at?: string;
}

export interface Paginated<T> {
  data: T[];
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
}

// ── Schema types ────────────────────────────────────────────────────

export interface SchemaFieldOption {
  value: string;
  label_ar: string;
  label_en: string;
}

export interface SchemaField {
  id: string;
  label_ar: string;
  label_en: string;
  type: 'text' | 'textarea' | 'select' | 'radio' | 'multiselect' | 'checkbox_group' | 'number' | 'date' | 'email';
  required: boolean;
  section?: string;
  placeholder_ar?: string;
  placeholder_en?: string;
  description_ar?: string;
  description_en?: string;
  pattern?: string;
  min_length?: number;
  max_length?: number;
  min?: number;
  max?: number;
  options?: SchemaFieldOption[];
  conditional?: { field: string; value: string };
}

export interface SchemaSection {
  id: string;
  label_ar: string;
  label_en: string;
}

export interface SchemaDocument {
  id: string;
  label_ar: string;
  label_en: string;
  required: boolean;
  accept: string[];
  max_size_mb: number;
  description_ar?: string;
  description_en?: string;
  conditional?: { field: string; value: string };
}

export interface SchemaWorkflowStage {
  id: string;
  label_ar: string;
  label_en: string;
  role: string;
  sla_hours?: number;
  actions: string[];
}

export interface ServiceSchema {
  service_code: string;
  name_ar: string;
  name_en: string;
  version?: string;
  fields: SchemaField[];
  sections?: SchemaSection[];
  documents: SchemaDocument[];
  workflow: { stages: SchemaWorkflowStage[] };
  fee: {
    type: 'fixed' | 'tiered' | 'formula';
    amount?: number;
    field?: string;
    tiers?: Record<string, number>;
    default?: number;
    currency?: string;
  };
  certificate?: {
    validity_months: number;
    title_ar: string;
    title_en: string;
    fields_on_cert: string[];
  };
}

// ── Service Definition ──────────────────────────────────────────────

export interface ServiceDefinition {
  id: number;
  code: string;
  name_ar: string;
  name_en: string;
  description_ar?: string;
  description_en?: string;
  category?: string;
  base_fee?: number;
  sla_hours?: number;
  currency: string;
  schema: ServiceSchema;
  status: 'active' | 'inactive' | 'draft';
}

// ── Application ─────────────────────────────────────────────────────

export type ApplicationStatus =
  | 'draft'
  | 'submitted'
  | 'under_review'
  | 'modifications_requested'
  | 'approved'
  | 'rejected'
  | 'certificate_issued';

export interface ApplicationDocument {
  id: number;
  document_id: string;
  original_filename: string;
  mime_type: string;
  size_bytes: number;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
}

export interface ApplicationReview {
  id: number;
  stage_id: string;
  stage?: string;
  decision: string;
  notes?: string;
  annotations?: Record<string, unknown>;
  review_round: number;
  reviewer?: Pick<User, 'id' | 'name' | 'role'>;
  created_at: string;
}

export interface Certificate {
  id: number;
  certificate_number: string;
  status: 'active' | 'revoked' | 'expired';
  issued_date: string;
  expiry_date: string;
}

export interface Application {
  id: number;
  reference_number: string;
  status: ApplicationStatus;
  current_stage?: string;
  data?: Record<string, unknown>;
  fee_amount: number;
  payment_status: 'pending' | 'paid' | 'waived';
  sla_deadline?: string;
  sla_breached?: boolean;
  review_round: number;
  assigned_reviewer_id?: number | null;
  submitted_at?: string;
  service_definition?: ServiceDefinition;
  applicant?: Pick<User, 'id' | 'name' | 'email'>;
  documents?: ApplicationDocument[];
  reviews?: ApplicationReview[];
  certificate?: Certificate;
  created_at: string;
  updated_at: string;
}

// ── Admin stats ─────────────────────────────────────────────────────

export interface DashboardStats {
  total_applications: number;
  pending_review: number;
  under_review: number;
  approved_today: number;
  certificates_issued: number;
  active_services: number;
  total_users: number;
}
