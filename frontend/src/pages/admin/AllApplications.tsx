import React, { useEffect, useState } from 'react';
import { adminApi } from '../../api/client';
import type { Application } from '../../types';

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '',                        label: 'الكل' },
  { value: 'draft',                   label: 'مسودة' },
  { value: 'submitted',               label: 'تم التقديم' },
  { value: 'under_review',            label: 'قيد المراجعة' },
  { value: 'modifications_requested', label: 'يحتاج تعديل' },
  { value: 'approved',                label: 'موافق عليه' },
  { value: 'rejected',                label: 'مرفوض' },
  { value: 'certificate_issued',      label: 'صدرت الشهادة' },
];

const STATUS_COLORS: Record<string, string> = {
  draft:                    'bg-gray-100 text-gray-600',
  submitted:                'bg-blue-100 text-blue-700',
  under_review:             'bg-yellow-100 text-yellow-700',
  modifications_requested:  'bg-orange-100 text-orange-700',
  approved:                 'bg-green-100 text-green-700',
  rejected:                 'bg-red-100 text-red-700',
  certificate_issued:       'bg-teal-100 text-teal-700',
};

export function AllApplications() {
  const [applications, setApplications] = useState<Application[]>([]);
  const [status, setStatus]     = useState('');
  const [page, setPage]         = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    setLoading(true);
    adminApi.allApplications(status || undefined, page)
      .then(r => {
        setApplications(r.data);
        setLastPage(r.last_page);
        setTotal(r.total);
      })
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [status, page]);

  return (
    <div className="max-w-5xl mx-auto px-4 py-8" dir="rtl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">جميع الطلبات</h1>
        <p className="text-gray-500 text-sm mt-1">{total} طلب</p>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 mb-6 flex-wrap">
        {STATUS_TABS.map(tab => (
          <button
            key={tab.value}
            onClick={() => { setStatus(tab.value); setPage(1); }}
            className={`text-sm px-3 py-1.5 rounded-full font-medium transition-colors ${
              status === tab.value
                ? 'bg-navy text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
        </div>
      ) : applications.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-3">📋</p>
          <p className="text-lg">لا توجد طلبات مطابقة</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {applications.map(app => (
              <div
                key={app.id}
                className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-xs text-gray-400">{app.reference_number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[app.status] ?? 'bg-gray-100 text-gray-600'}`}>
                      {STATUS_TABS.find(t => t.value === app.status)?.label ?? app.status}
                    </span>
                  </div>
                  <p className="font-semibold text-gray-900 mt-1">{app.service_definition?.name_ar ?? '—'}</p>
                  <p className="text-sm text-gray-500">{app.applicant?.name} · {app.applicant?.email}</p>
                </div>
                <div className="text-left text-sm text-gray-400 whitespace-nowrap">
                  {new Date(app.created_at).toLocaleDateString('ar-EG')}
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          {lastPage > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                → السابق
              </button>
              <span className="text-sm text-gray-500">{page} / {lastPage}</span>
              <button
                onClick={() => setPage(p => Math.min(lastPage, p + 1))}
                disabled={page >= lastPage}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50"
              >
                التالي ←
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}