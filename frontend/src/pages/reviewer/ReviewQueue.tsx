import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { reviewApi } from '../../api/client';
import type { Application } from '../../types';

export function ReviewQueue() {
  const [queue, setQueue]     = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    reviewApi.queue()
      .then(r => setQueue(r.applications))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  const slaStatus = (app: Application) => {
    if (app.sla_breached) return 'breached';
    if (!app.sla_deadline) return 'ok';
    const hours = (new Date(app.sla_deadline).getTime() - Date.now()) / 3600000;
    if (hours < 4) return 'urgent';
    if (hours < 12) return 'warning';
    return 'ok';
  };

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-8" dir="rtl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">قائمة المراجعة</h1>
        <p className="text-gray-500 text-sm mt-1">{queue.length} طلب في انتظار المراجعة</p>
      </div>
      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
      )}

      {queue.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          <p className="text-5xl mb-3">🎉</p>
          <p>لا توجد طلبات معلقة</p>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map(app => {
            const isApproved = app.status === 'approved';
            const sla = isApproved ? 'ok' : slaStatus(app);
            const slaColors: Record<string, string> = {
              breached: 'border-red-400 bg-red-50',
              urgent:   'border-orange-400 bg-orange-50',
              warning:  'border-yellow-300 bg-yellow-50',
              ok:       'border-gray-200 bg-white',
            };

            return (
              <Link
                key={app.id}
                to={`/review/${app.id}`}
                className={`block rounded-xl border-2 p-5 hover:shadow-md transition-all ${
                  isApproved ? 'border-teal-300 bg-teal-50' : slaColors[sla]
                }`}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="font-mono text-xs text-gray-400">{app.reference_number}</span>
                      {isApproved ? (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 font-medium">
                          ✅ موافق عليه — بانتظار الدفع/الشهادة
                        </span>
                      ) : (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                          {app.service_definition?.schema?.workflow?.stages?.find(
                            s => s.id === app.current_stage
                          )?.label_ar ?? app.current_stage}
                        </span>
                      )}
                      {sla === 'breached' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">
                          ⚠️ تجاوز الموعد
                        </span>
                      )}
                      {sla === 'urgent' && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-600 font-medium">
                          🔥 عاجل
                        </span>
                      )}
                    </div>

                    <p className="font-semibold text-gray-900 mt-2">
                      {app.service_definition?.name_ar || '—'}
                    </p>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {app.applicant?.name} · {app.applicant?.email}
                    </p>

                    {!isApproved && app.sla_deadline && (
                      <p className="text-xs text-gray-400 mt-2">
                        الموعد النهائي: {new Date(app.sla_deadline).toLocaleString('ar-EG')}
                      </p>
                    )}
                  </div>

                  <div className="flex-shrink-0">
                    <span className={`text-xs px-3 py-1.5 rounded-lg font-medium ${
                      isApproved
                        ? 'bg-teal-600 text-white'
                        : app.assigned_reviewer_id ? 'bg-orange-100 text-orange-700' : 'bg-blue-600 text-white'
                    }`}>
                      {isApproved ? '💳 تأكيد الدفع / إصدار الشهادة' : app.assigned_reviewer_id ? '🔒 قيد مراجعتك' : 'مراجعة'}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
