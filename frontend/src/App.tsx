import React, { createContext, useContext, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, Link, useNavigate } from 'react-router-dom';
import { authApi } from './api/client';
import type { User } from './types';

// ── Pages ─────────────────────────────────────────────────────────────────────
import { ServiceList }             from './pages/applicant/ServiceList';
import { Apply }                   from './pages/applicant/Apply';
import { MyApplications }          from './pages/applicant/MyApplications';
import { ApplicationDetail }       from './pages/applicant/ApplicationDetail';
import { ReviewQueue }             from './pages/reviewer/ReviewQueue';
import { ReviewPanel }             from './pages/reviewer/ReviewPanel';
import { AdminDashboard }          from './pages/admin/AdminDashboard';
import { IntegrationCycles }       from './pages/admin/IntegrationCycles';
import { IntegrationCycleDetail }  from './pages/admin/IntegrationCycleDetail';
import { NewService }              from './pages/admin/NewService';
import { ServicesList }            from './pages/admin/ServicesList';
import { EditService }             from './pages/admin/EditService';

// ── Auth Context ──────────────────────────────────────────────────────────────

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null, token: null,
  login: () => {}, logout: () => {},
});

export const useAuth = () => useContext(AuthContext);

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(localStorage.getItem('esp_token'));
  const [user, setUser]   = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (token) {
      authApi.me()
        .then(r => setUser(r.user))
        .catch(() => { localStorage.removeItem('esp_token'); setToken(null); })
        .finally(() => setReady(true));
    } else {
      setReady(true);
    }
  }, [token]);

  const login = (t: string, u: User) => {
    localStorage.setItem('esp_token', t);
    setToken(t);
    setUser(u);
  };

  const logout = () => {
    authApi.logout().catch(() => {});
    localStorage.removeItem('esp_token');
    setToken(null);
    setUser(null);
  };

  if (!ready) return <div className="flex items-center justify-center h-screen"><div className="animate-spin w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full" /></div>;

  return (
    <AuthContext.Provider value={{ user, token, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

// ── Login Page ────────────────────────────────────────────────────────────────

function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]     = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const r = await authApi.login(email, password);
      login(r.token, r.user);
      navigate('/');
    } catch (err: unknown) {
      setError((err as Error).message || 'خطأ في تسجيل الدخول');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-navy rounded-2xl mx-auto flex items-center justify-center text-white text-2xl mb-4">
            🏛
          </div>
          <h1 className="text-2xl font-bold text-gray-900">منصة الخدمات الإلكترونية</h1>
          <p className="text-gray-400 text-sm mt-1">eqratech-services-platform</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">البريد الإلكتروني</label>
            <input
              type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
              placeholder="example@org.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">كلمة المرور</label>
            <input
              type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          <button
            type="submit" disabled={loading}
            className="w-full py-3 bg-navy text-white rounded-lg hover:bg-blue-800 disabled:opacity-50 font-medium text-sm"
          >
            {loading ? 'جارٍ الدخول...' : 'دخول'}
          </button>

          <div className="text-xs text-gray-400 text-center pt-2">
            <p>حسابات تجريبية (Demo1234!):</p>
            <p className="mt-1">admin@demo.esp · staff@demo.esp · auditor@demo.esp · ahmed@demo.esp</p>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Layout + Nav ──────────────────────────────────────────────────────────────

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-navy text-white shadow-lg" dir="rtl">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <Link to="/" className="font-bold text-sm">🏛 ESP</Link>
            {user?.role === 'applicant' && (
              <>
                <Link to="/services"          className="text-sm text-blue-200 hover:text-white transition-colors">الخدمات</Link>
                <Link to="/my-applications"   className="text-sm text-blue-200 hover:text-white transition-colors">طلباتي</Link>
              </>
            )}
            {(user?.role === 'staff' || user?.role === 'auditor' || user?.role === 'admin') && (
              <Link to="/review/queue" className="text-sm text-blue-200 hover:text-white transition-colors">المراجعة</Link>
            )}
            {user?.role === 'admin' && (
              <>
                <Link to="/admin"                className="text-sm text-blue-200 hover:text-white transition-colors">الإدارة</Link>
                <Link to="/admin/services"        className="text-sm text-blue-200 hover:text-white transition-colors">الخدمات</Link>
                <Link to="/admin/services/new"   className="text-sm text-blue-200 hover:text-white transition-colors">+ خدمة جديدة</Link>
                <Link to="/admin/integration"    className="text-sm text-blue-200 hover:text-white transition-colors">Nashmi</Link>
              </>
            )}
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-blue-200">{user?.name}</span>
            <span className="text-xs bg-blue-700 px-2 py-0.5 rounded-full">{user?.role}</span>
            <button onClick={handleLogout} className="text-xs text-blue-300 hover:text-white transition-colors">خروج</button>
          </div>
        </div>
      </nav>

      <main>{children}</main>
    </div>
  );
}

// ── Route guard ───────────────────────────────────────────────────────────────

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Blocks non-applicants from applicant-only routes */
function RequireApplicant({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== 'applicant') return <Navigate to="/" replace />;
  return <>{children}</>;
}

function HomeRedirect() {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === 'admin')   return <Navigate to="/admin" replace />;
  if (user.role === 'staff' || user.role === 'auditor') return <Navigate to="/review/queue" replace />;
  return <Navigate to="/services" replace />;
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route path="/" element={<RequireAuth><Layout><HomeRedirect /></Layout></RequireAuth>} />

          {/* Applicant-only */}
          <Route path="/services"          element={<RequireApplicant><Layout><ServiceList /></Layout></RequireApplicant>} />
          <Route path="/apply/:serviceCode"element={<RequireApplicant><Layout><Apply /></Layout></RequireApplicant>} />
          <Route path="/my-applications"   element={<RequireApplicant><Layout><MyApplications /></Layout></RequireApplicant>} />
          <Route path="/applications/:id"  element={<RequireApplicant><Layout><ApplicationDetail /></Layout></RequireApplicant>} />

          {/* Reviewer */}
          <Route path="/review/queue"      element={<RequireAuth><Layout><ReviewQueue /></Layout></RequireAuth>} />
          <Route path="/review/:id"        element={<RequireAuth><Layout><ReviewPanel /></Layout></RequireAuth>} />

          {/* Admin */}
          <Route path="/admin"                      element={<RequireAuth><Layout><AdminDashboard /></Layout></RequireAuth>} />
          <Route path="/admin/services"             element={<RequireAuth><Layout><ServicesList /></Layout></RequireAuth>} />
          <Route path="/admin/services/new"         element={<RequireAuth><Layout><NewService /></Layout></RequireAuth>} />
          <Route path="/admin/services/:id/edit"    element={<RequireAuth><Layout><EditService /></Layout></RequireAuth>} />
          <Route path="/admin/integration"          element={<RequireAuth><Layout><IntegrationCycles /></Layout></RequireAuth>} />
          <Route path="/admin/integration/:id"      element={<RequireAuth><Layout><IntegrationCycleDetail /></Layout></RequireAuth>} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
