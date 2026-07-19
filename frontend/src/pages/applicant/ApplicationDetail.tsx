import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { applicationsApi } from '../../api/client';
import { DynamicForm } from '../../engine/DynamicForm';
import { DocumentUploader } from '../../engine/DocumentUploader';
import type { Application } from '../../types';

const STATUS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  draft:                    { label: 'مسودة',          color: 'bg-gray-100 text-gray-600',    icon: '📝' },
  submitted:                { label: 'تم التقديم',      color: 'bg-blue-100 text-blue-700',    icon: '📨' },
  under_review:             { label: 'قيد المراجعة',    color: 'bg-yellow-100 text-yellow-700',icon: '🔍' },
  modifications_requested:  { label: 'يحتاج تعديل',    color: 'bg-orange-100 text-orange-700',icon: '✏️' },
  approved:                 { label: 'موافق عليه',      color: 'bg-green-100 text-green-700',  icon: '✅' },
  rejected:                 { label: 'مرفوض',           color: 'bg-red-100 text-red-700',      icon: '❌' },
  certificate_issued:       { label: 'صدرت الشهادة',    color: 'bg-teal-100 text-teal-700',    icon: '🏆' },
};

/**
 * ApplicationDetail — single-application view for the applicant.
 *
 * Fixes two previously-missing behaviors (bug #3 and #9):
 *   - #9: when status is modifications_requested (or still draft), the applicant
 *     can edit their data/documents and resubmit, instead of hitting a dead route.
 *   - #3: when status is certificate_issued, the issued certificate is now
 *     actually displayed here instead of nowhere.
 */
export function ApplicationDetail() {
  const { id } = useParams<{ id: string }>();

  const [application, setApplication] = useState<Application | null>(null);
  const [formData, setFormData]       = useState<Record<string, unknown>>({});
  const [errors, setErrors]           = useState<Record<string, string>>({});
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [pageError, setPageError]     = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    applicationsApi.get(Number(id))
      .then(r => {
        setApplication(r.application);
        setFormData(r.application.data ?? {});
      })
      .catch(e => setPageError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const handleFieldChange = (field: string, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
  };

  const handleSaveDraft = async () => {
    if (!application) return;
    setSaving(true);
    setSavedNotice(false);
    try {
      const r = await applicationsApi.update(application.id, formData);
      setApplication(r.application);
      setSavedNotice(true);
    } catch (err: unknown) {
      const e = err as { errors?: Record<string, string>; message?: string };
      if (e.errors) setErrors(e.errors);
      else setPageError(e.message || 'حدث خطأ أثناء الحفظ.');
    } finally {
      setSaving(false);
    }
  };
  
  const handleResubmit = async () => {
  if (!application) return;
  setSubmitting(true);
  try {
    // Bug fix: submit() validates whatever is already saved in the DB — it
    // does NOT receive formData. Must save current edits first, or a
    // resubmission silently uses stale/old data and the user's edits vanish.
    const saveResult = await applicationsApi.update(application.id, formData);
    setApplication(saveResult.application);

    const submitResult = await applicationsApi.submit(application.id);
    setApplication(submitResult.application);
  } catch (err: unknown) {
    const e = err as { errors?: Record<string, string>; message?: string };
    if (e.errors) setErrors(e.errors);
    else setPageError(e.message || 'حدث خطأ أثناء إعادة التقديم.');
  } finally {
    setSubmitting(false);
  }
  };

  const handleDocumentUploaded = async () => {
    if (!application) return;
    const r = await applicationsApi.get(application.id);
    setApplication(r.application);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" role="status" aria-label="جارٍ التحميل">
        <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!application) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 text-center" dir="rtl">
        <p className="text-red-600 mb-4">{pageError || 'تعذر العثور على هذا الطلب.'}</p>
        <Link to="/my-applications" className="text-blue-600 hover:underline text-sm">→ العودة إلى طلباتي</Link>
      </div>
    );
  }

  const statusInfo   = STATUS_LABELS[application.status] || { label: application.status, color: 'bg-gray-100 text-gray-600', icon: '❓' };
  const schema        = application.service_definition?.schema;
  const isEditable     = application.status === 'draft' || application.status === 'modifications_requested';
  const latestReview   = application.reviews && application.reviews.length > 0
    ? application.reviews[application.reviews.length - 1]
    : null;

  return (
    <main className="max-w-3xl mx-auto px-4 py-8" dir="rtl">
      <Link to="/my-applications" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-block">
        → العودة إلى طلباتي
      </Link>

      {/* Header */}
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{application.service_definition?.name_ar || '—'}</h1>
          <p className="text-sm text-gray-400 font-mono mt-1">{application.reference_number}</p>
        </div>
        <span className={`text-xs px-3 py-1.5 rounded-full font-medium whitespace-nowrap ${statusInfo.color}`}>
          {statusInfo.icon} {statusInfo.label}
        </span>
      </header>

      {pageError && (
        <div role="alert" className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          {pageError}
        </div>
      )}

      {/* #9 fix: show reviewer feedback when modifications are requested */}
      {application.status === 'modifications_requested' && (
        <div className="mb-6 bg-orange-50 border border-orange-200 rounded-xl p-4 text-sm text-orange-800">
          <p className="font-semibold mb-1">⚠️ طُلب منك تعديل هذا الطلب</p>
          <p>{latestReview?.notes || 'يرجى مراجعة البيانات أدناه وتصحيحها ثم إعادة التقديم.'}</p>
        </div>
      )}

      {application.status === 'rejected' && latestReview && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <p className="font-semibold mb-1">❌ تم رفض هذا الطلب</p>
          {latestReview.notes && <p>{latestReview.notes}</p>}
        </div>
      )}

      {/* #3 fix: actually display the issued certificate */}
      {application.status === 'certificate_issued' && application.certificate && (
        <div className="mb-6 bg-white rounded-xl border-2 border-teal-200 overflow-hidden">
          <div className="bg-teal-700 px-6 py-3 flex items-center gap-2">
            <span className="text-xl">🏆</span>
            <h2 className="text-white font-semibold text-sm">الشهادة الصادرة</h2>
          </div>
          <dl className="p-6 space-y-3">
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">رقم الشهادة</dt>
              <dd className="font-mono font-medium text-gray-900">{application.certificate.certificate_number}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">تاريخ الإصدار</dt>
              <dd className="font-medium">{new Date(application.certificate.issued_date).toLocaleDateString('ar-EG')}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">تاريخ الانتهاء</dt>
              <dd className="font-medium">{new Date(application.certificate.expiry_date).toLocaleDateString('ar-EG')}</dd>
            </div>
            <div className="flex justify-between text-sm">
              <dt className="text-gray-500">الحالة</dt>
              <dd className={`font-medium ${application.certificate.status === 'active' ? 'text-green-600' : 'text-red-600'}`}>
                {application.certificate.status === 'active' ? 'سارية' : application.certificate.status}
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/* Read-only summary for non-editable, non-terminal states (submitted / under_review / approved) */}
      {!isEditable && application.status !== 'certificate_issued' && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-6">
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-gray-500">الرسوم</dt>
              <dd className="font-medium">{application.fee_amount} {application.service_definition?.currency}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">حالة الدفع</dt>
              <dd className="font-medium">{application.payment_status === 'paid' ? 'مدفوع' : application.payment_status === 'waived' ? 'معفى' : 'غير مدفوع'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-500">المستندات المرفوعة</dt>
              <dd className="font-medium">{application.documents?.length ?? 0}</dd>
            </div>
          </dl>
        </div>
      )}

      {/* #9 fix: editable form + documents, shown for draft / modifications_requested */}
      {isEditable && schema && (
        <section className="space-y-6">
          <DynamicForm
            schema={schema}
            values={formData}
            errors={errors}
            onChange={handleFieldChange}
          />

          <DocumentUploader
            documents={schema.documents}
            application={application}
            formData={formData}
            onUploaded={handleDocumentUploaded}
          />

          {savedNotice && (
            <p className="text-sm text-green-600">✓ تم حفظ التعديلات.</p>
          )}

          <div className="flex justify-between pt-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={saving}
              aria-busy={saving}
              className="px-5 py-2.5 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm font-medium disabled:opacity-50"
            >
              {saving ? 'جارٍ الحفظ...' : 'حفظ بدون تقديم'}
            </button>
            <button
              type="button"
              onClick={handleResubmit}
              disabled={submitting}
              aria-busy={submitting}
              className="px-6 py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
            >
              {submitting ? 'جارٍ إعادة التقديم...' : '✓ إعادة التقديم'}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}