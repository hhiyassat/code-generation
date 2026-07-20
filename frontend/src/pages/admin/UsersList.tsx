import React, { useEffect, useState } from 'react';
import { adminApi } from '../../api/client';
import type { User } from '../../types';

const ROLE_LABELS: Record<string, string> = {
  applicant: 'متقدم',
  staff:     'موظف',
  auditor:   'مدقق',
  admin:     'مدير',
};

export function UsersList() {
  const [users, setUsers]       = useState<User[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [savingId, setSavingId] = useState<number | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);

  const [newName, setNewName]         = useState('');
  const [newEmail, setNewEmail]       = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole]         = useState('applicant');
  const [creating, setCreating]       = useState(false);
  const [createError, setCreateError] = useState('');

  const load = () => {
    adminApi.listUsers()
      .then(r => setUsers(r.users))
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const handleToggleActive = async (user: User) => {
    setSavingId(user.id);
    try {
      const r = await adminApi.updateUser(user.id, { is_active: !user.is_active });
      setUsers(prev => prev.map(u => u.id === user.id ? r.user : u));
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const handleRoleChange = async (user: User, role: string) => {
    setSavingId(user.id);
    try {
      const r = await adminApi.updateUser(user.id, { role });
      setUsers(prev => prev.map(u => u.id === user.id ? r.user : u));
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSavingId(null);
    }
  };

  const handleCreate = async () => {
    setCreateError('');
    if (!newName.trim() || !newEmail.trim() || !newPassword) {
      setCreateError('جميع الحقول مطلوبة.');
      return;
    }
    setCreating(true);
    try {
      await adminApi.createUser({ name: newName, email: newEmail, password: newPassword, role: newRole });
      setNewName(''); setNewEmail(''); setNewPassword(''); setNewRole('applicant');
      setShowNewForm(false);
      load();
    } catch (e: unknown) {
      setCreateError((e as Error).message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full" />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-8" dir="rtl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">المستخدمون</h1>
          <p className="text-gray-500 text-sm mt-1">{users.length} مستخدم</p>
        </div>
        <button
          onClick={() => setShowNewForm(v => !v)}
          className="px-4 py-2 bg-navy text-white text-sm rounded-lg hover:bg-blue-800 font-medium"
        >
          + مستخدم جديد
        </button>
      </div>

      {showNewForm && (
        <div className="mb-6 bg-white border border-gray-200 rounded-xl p-5 space-y-3">
          {createError && <p className="text-red-600 text-sm">{createError}</p>}
          <input
            type="text" placeholder="الاسم" value={newName}
            onChange={e => setNewName(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="email" placeholder="البريد الإلكتروني" value={newEmail}
            onChange={e => setNewEmail(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <input
            type="password" placeholder="كلمة المرور (8 أحرف على الأقل، حروف وأرقام)" value={newPassword}
            onChange={e => setNewPassword(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={newRole} onChange={e => setNewRole(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="w-full py-2.5 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm font-medium"
          >
            {creating ? 'جارٍ الإنشاء...' : 'إنشاء المستخدم'}
          </button>
        </div>
      )}

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {users.map(user => (
          <div
            key={user.id}
            className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between gap-4 flex-wrap"
          >
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gray-900">{user.name}</p>
              <p className="text-sm text-gray-500">{user.email}</p>
            </div>

            <select
              value={user.role}
              onChange={e => handleRoleChange(user, e.target.value)}
              disabled={savingId === user.id}
              className="text-sm border border-gray-300 rounded-lg px-2 py-1.5 disabled:opacity-50"
            >
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>

            <button
              onClick={() => handleToggleActive(user)}
              disabled={savingId === user.id}
              className={`text-xs px-3 py-1.5 rounded-full font-medium disabled:opacity-50 ${
                user.is_active !== false
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
            >
              {user.is_active !== false ? '✓ نشط' : 'معطّل'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}