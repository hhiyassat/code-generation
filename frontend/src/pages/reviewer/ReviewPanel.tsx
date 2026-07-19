import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { applicationsApi, reviewApi } from '../../api/client';
import { DynamicForm } from '../../engine/DynamicForm';
import type { Application } from '../../types';

// Eqratech Methodology: سبب مطلوب for every non-approve action
const DECISION_OPTIONS = [
  {
    value: 'approved',
    label: '✅ موافقة',
    color: 'border-green-400 bg-green-50 text-green-700',
    notesRequired: false,
    notesLabel: 'ملاحظات (اختياري)',
    notesPlaceholder: 'أضف ملاحظة اختيارية...',
  },
  {
    value: 'modifications_requested',
    label: '✏️ طلب تعديل',
    color: 'border-orange-400 bg-orange-50 text-orange-700',
    notesRequired: true,
    notesLabel: 'وصف التعديلات المطلوبة *',
    notesPlaceholder: 'اذكر بالتفصيل ما يجب تعديله — سيظهر هذا للمتقدم...',
  },
  {
    value: 'rejected',
    label: '❌ رفض',
    color: 'border-red-400 bg-red-50 text-red-700',
    notesRequired: true,
    notesLabel: 'سبب الرفض *',
    notesPlaceholder: 'اذكر سبب الرفض بوضوح — سيظهر هذا للمتقدم...',
  },
] as const;

export function ReviewPanel() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [app, setApp]             = useState<Application | null>(null);
  const [loading, setLoading]     = useState(true);
  const [claiming, setClaiming]   = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [deciding, setDeciding]   = useState(false);
  const [decision, setDecision]   = useState('');
  const [notes, setNotes]         = useState('');
  const [notesError, setNotesError] = useState('');
  const [pageError, setPageError]   = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [confirmingPayment, setConfirmingPayment] = useState(false);  

  useEffect(() => {
    if (!id) return;
    applicationsApi.get(Number(id))
      .then(r => setApp(r.application))
      .catch(e => setPageError((e as Error).message))
      .finally(() => setLoading(false));
  }, [id]);

  const handleClaim = async () => {
    if (!app) return;
    setClaiming(true);
    setPageError('');
    try {
      const r = await reviewApi.claim(app.id);
      setApp(r.application);
    } catch (e: unknown) {
      setPageError((e as Error).message);
    } finally {
      setClaiming(false);
    }
  };
  const handleRelease = async () =>{
    if (!app) return;
    if(!window.confirm('هل تريد التراجع عن استلام هذا الطلب؟ سيصبح متاحاً لمراجعين آخرين.')) return;
    setReleasing(true);
    setPageError('');
    try{
      const r = await reviewApi.release(app.id);
      setApp(r.application);
    } catch (e:unknown){
      setPageError((e as Error).message);
    }finally{
      setReleasing(false);
    }
  };

  const handleDecide = async () => {
    if (!app || !decision) return;

    // Frontend guard: Eqratech Methodology سبب مطلوب
    const opt = DECISION_OPTIONS.find(o => o.value === decision);
    if (opt?.notesRequired && !notes.trim()) {
      setNotesError('هذا الحقل مطلوب — يجب ذكر السبب وفق منهجية عقراتك');
      return;
    }

    setDeciding(true);
    setPageError('');
    setNotesError('');
    try {
      await reviewApi.decide(app.id, decision, notes.trim() || undefined);
      navigate('/review/queue', { state: { decided: true, decision } });
    } catch (err: unknown) {
      const apiErr = err as Error & { errors?: Record<string, string[]> };
      // Surface backend validation (notes.required) if caught
      if (apiErr.errors?.notes) {
        setNotesError(apiErr.errors.notes[0]);
      } else {
        setPageError(apiErr.message);
      }
    } finally {
      setDeciding(false);
    }
  };
const handleConfirmPayment = async () => {
    if (!app) return;
    if (!paymentReference.trim()) {
      setPageError('مرجع الدفع مطلوب.');
      return;
    }
    setConfirmingPayment(true);
    setPageError('');
    try {
      const r = await applicationsApi.confirmPayment(app.id, paymentReference.trim());
      setApp(r.application);
    } catch (err: unknown) {
      setPageError((err as Error).message);
    } finally {
      setConfirmingPayment(false);
    }
  };

  const handleIssueCert = async () => {
    if (!app) return;
    setPageError('');
    try {
      const r = await reviewApi.issueCertificate(app.id);
      setApp(r.application);
      alert(`✅ تم إصدار الشهادة رقم: ${r.certificate.certificate_number}`);
    } catch (err: unknown) {
      setPageError((err as Error).message);
    }
  };

  if (loading || !app) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  const schema     = app.service_definition?.schema;
  // Fix: was assigned_to_id (wrong) — backend column is assigned_reviewer_id
  const isClaimed  = !!app.assigned_reviewer_id;

  // Resolve current_stage ID → Arabic label from schema workflow stages
  const stageLabel = schema?.workflow?.stages?.find(s => s.id === app.current_stage)?.label_ar
    ?? app.current_stage;

  const selectedOpt = DECISION_OPTIONS.find(o => o.value === decision);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8" dir="rtl">

      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4">
        <div>
          <button onClick={() => navigate(-1)} className="text-sm text-gray-400 hover:text-gray-600 mb-2">
            → رجوع للقائمة
          </button>
          <h1 className="text-xl font-bold text-gray-900">
            {schema?.name_ar ?? app.service_definition?.name_ar}
          </h1>
          <p className="font-mono text-xs text-gray-400 mt-1">{app.reference_number}</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          {stageLabel && (
            <span className="text-xs px-3 py-1.5 rounded-full bg-blue-100 text-blue-700 font-medium">
              {stageLabel}
            </span>
          )}

          {/* Claim — only when submitted and not yet claimed by anyone */}
          {app.status === 'submitted' && !isClaimed && (
            <button
              onClick={handleClaim}
              disabled={claiming}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
            >
              {claiming ? 'جارٍ...' : '🔒 استلام الطلب'}
            </button>
          )}

          {isClaimed && app.status === 'under_review' && (
            <button
              onClick={handleRelease}
              disabled={releasing}
              title="التراجع عن الاستلام وإعادة الطلب لقائمة الانتظار"
              className="text-xs px-3 py-1.5 rounded-full bg-orange-100 text-orange-700 font-medium hover:bg-orange-200 disabled:opacity-50 transition-colors"
            >
              {releasing ? 'جارٍ...' : '🔓 قيد مراجعتك — تحرير'}
            </button>
          )}
        </div>
      </div>

      {pageError && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {pageError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

        {/* Left: application data (read-only) */}
        <div className="lg:col-span-2 space-y-6">
          {schema && (
            <DynamicForm
              schema={schema}
              values={app.data as Record<string, unknown>}
              onChange={() => {}}
              disabled={true}
            />
          )}

          {/* Uploaded documents */}
          {(app.documents?.length ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="bg-navy px-6 py-3">
                <h3 className="text-white font-semibold text-sm">المستندات المرفوعة</h3>
              </div>
              <div className="p-5 space-y-3">
                {app.documents?.map(doc => (
                  <div key={doc.id} className="flex items-center justify-between text-sm">
                    <div>
                      <p className="font-medium text-gray-700">{doc.document_id}</p>
                      <p className="text-gray-400 text-xs">{doc.original_filename}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      doc.status === 'accepted' ? 'bg-green-100 text-green-700' :
                      doc.status === 'rejected'  ? 'bg-red-100 text-red-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>{doc.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: review panel */}
        <div className="space-y-4">

          {/* Previous reviews log */}
          {(app.reviews?.length ?? 0) > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="font-semibold text-gray-800 text-sm mb-4">سجل المراجعات</h3>
              <div className="space-y-3">
                {app.reviews?.map(r => (
                  <div key={r.id} className="text-xs border-t border-gray-100 pt-3 first:border-t-0 first:pt-0">
                    <div className="flex justify-between">
                      <span className="font-medium text-gray-700">{r.stage}</span>
                      <span className={`px-1.5 py-0.5 rounded ${
                        r.decision === 'approved'                ? 'bg-green-100 text-green-700' :
                        r.decision === 'rejected'                ? 'bg-red-100 text-red-700' :
                        r.decision === 'modifications_requested' ? 'bg-orange-100 text-orange-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>{
                        r.decision === 'approved'                ? 'موافقة' :
                        r.decision === 'rejected'                ? 'مرفوض' :
                        r.decision === 'modifications_requested' ? 'طلب تعديل' :
                        r.decision
                      }</span>
                    </div>
                    {r.notes && (
                      <p className="text-gray-600 mt-1.5 bg-gray-50 rounded p-1.5">{r.notes}</p>
                    )}
                    <p className="text-gray-400 mt-1">{r.reviewer?.name}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Payment confirmation + issue certificate (post-approval) */}
          {app.status === 'approved' && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-5">
              <p className="text-green-700 font-medium text-sm mb-3">✅ الطلب موافق عليه</p>

              {app.payment_status !== 'paid' && app.payment_status !== 'waived' ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">يجب تأكيد الدفع أولاً قبل إصدار الشهادة.</p>
                  <input
                    type="text"
                    value={paymentReference}
                    onChange={e => setPaymentReference(e.target.value)}
                    placeholder="مرجع الدفع (رقم الإيصال أو المعاملة)"
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  <button
                    onClick={handleConfirmPayment}
                    disabled={confirmingPayment}
                    className="w-full py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                  >
                    {confirmingPayment ? 'جارٍ التأكيد...' : '💳 تأكيد الدفع'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleIssueCert}
                  className="w-full py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
                >
                  إصدار الشهادة
                </button>
              )}
            </div>
          )}

          {/* Terminal state badges */}
          {app.status === 'rejected' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-5 text-center text-sm text-red-700">
              ❌ هذا الطلب مرفوض
            </div>
          )}
          {app.status === 'certificate_issued' && (
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-5 text-center text-sm text-teal-700">
              🏆 تم إصدار الشهادة
            </div>
          )}

          {/* Decision form — only when claimed and under_review */}
          {isClaimed && app.status === 'under_review' && (
            <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
              <h3 className="font-semibold text-gray-800 text-sm">قرار المراجعة</h3>

              {/* Decision buttons */}
              <div className="space-y-2">
                {DECISION_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { setDecision(opt.value); setNotesError(''); setNotes(''); }}
                    className={`w-full text-right px-4 py-3 rounded-lg border-2 text-sm font-medium transition-all ${
                      decision === opt.value ? opt.color : 'border-gray-200 text-gray-600 hover:border-gray-300'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {/* Notes — shown whenever a decision is selected */}
              {decision && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1.5">
                    {selectedOpt?.notesLabel ?? 'ملاحظات'}
                    {selectedOpt?.notesRequired && (
                      <span className="text-red-500 mr-1 text-xs">— مطلوب وفق منهجية عقراتك</span>
                    )}
                  </label>
                  <textarea
                    value={notes}
                    onChange={e => { setNotes(e.target.value); if (notesError) setNotesError(''); }}
                    className={`w-full border rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none ${
                      notesError ? 'border-red-400 bg-red-50' : 'border-gray-300'
                    }`}
                    rows={4}
                    placeholder={selectedOpt?.notesPlaceholder}
                  />
                  {notesError && (
                    <p className="mt-1 text-xs text-red-600">⚠ {notesError}</p>
                  )}
                </div>
              )}

              <button
                onClick={handleDecide}
                disabled={!decision || deciding}
                className="w-full py-2.5 bg-navy text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 text-sm font-medium"
              >
                {deciding ? 'جارٍ الحفظ...' : 'تأكيد القرار'}
              </button>
            </div>
          )}

          {/* Prompt to claim if submitted and unclaimed */}
          {app.status === 'submitted' && !isClaimed && (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-5 text-center text-sm text-blue-700">
              <p className="font-medium mb-1">الطلب ينتظر مراجعاً</p>
              <p className="text-xs text-blue-500">اضغط "استلام الطلب" لبدء المراجعة</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
