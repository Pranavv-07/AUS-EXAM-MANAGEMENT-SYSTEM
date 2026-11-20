import React, { useEffect, useState } from 'react';
import { BarChart3, Users, FileText, Plus, Pencil, Trash2, Search, X, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';
import type { AuditLog, UniversityAnalytics, User, UserRole } from '../types/exam.ts';
import { ConfirmDialog } from './ConfirmDialog.tsx';

interface AdminPortalProps {
  currentUser: User;
  globalSearch?: string;
}

type AdminTab = 'analytics' | 'accounts' | 'audit';

export function AdminPortal({ currentUser, globalSearch = '' }: AdminPortalProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>('analytics');
  const [analytics, setAnalytics] = useState<UniversityAnalytics | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  // Account Form state
  const [showUserForm, setShowUserForm] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [showFormPassword, setShowFormPassword] = useState(false);
  const [formFullName, setFormFullName] = useState('');
  const [formEmpId, setFormEmpId] = useState('');
  const [formDepartment, setFormDepartment] = useState('Examination Cell');
  const [formRole, setFormRole] = useState<UserRole>('EXAMINER');
  const [savingUser, setSavingUser] = useState(false);

  // Confirm delete dialog
  const [pendingDeleteUser, setPendingDeleteUser] = useState<User | null>(null);

  // Audit Filter
  const [logFilter, setLogFilter] = useState('');
  const [logSearch, setLogSearch] = useState('');

  async function loadAll() {
    setLoading(true);
    setError('');
    try {
      const [analyticsRes, usersRes, logsRes] = await Promise.all([
        apiFetch<UniversityAnalytics>('/api/admin/analytics'),
        apiFetch<User[]>('/api/admin/users'),
        apiFetch<AuditLog[]>('/api/admin/audit-logs'),
      ]);
      setAnalytics(analyticsRes);
      setUsers(usersRes);
      setLogs(logsRes);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (globalSearch.trim()) {
      setLogSearch(globalSearch);
    }
  }, [globalSearch]);

  function openCreateUser() {
    setEditingUser(null);
    setFormUsername('');
    setFormPassword('');
    setShowFormPassword(false);
    setFormFullName('');
    setFormEmpId('');
    setFormDepartment('Examination Cell');
    setFormRole('EXAMINER');
    setShowUserForm(true);
  }

  function openEditUser(u: User) {
    setEditingUser(u);
    setFormUsername(u.username);
    setFormPassword('');
    setShowFormPassword(false);
    setFormFullName(u.full_name);
    setFormEmpId(u.emp_id);
    setFormDepartment(u.department);
    setFormRole(u.role);
    setShowUserForm(true);
  }

  async function handleSaveUser(e: React.FormEvent) {
    e.preventDefault();
    setSavingUser(true);
    setError('');
    setStatusMsg('');
    try {
      if (editingUser) {
        await apiFetch(`/api/admin/users/${editingUser.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            full_name: formFullName,
            emp_id: formEmpId,
            department: formDepartment,
            role: formRole,
            password: formPassword || undefined,
          }),
        });
        setStatusMsg(`Updated account "${editingUser.username}".`);
      } else {
        await apiFetch('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            username: formUsername,
            password: formPassword,
            full_name: formFullName,
            emp_id: formEmpId,
            department: formDepartment,
            role: formRole,
          }),
        });
        setStatusMsg(`Created ${formRole} account "${formUsername}".`);
      }
      setShowUserForm(false);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingUser(false);
    }
  }

  async function handleToggleActive(u: User) {
    setError('');
    setStatusMsg('');
    try {
      await apiFetch(`/api/admin/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: !u.is_active }),
      });
      setStatusMsg(`${u.is_active ? 'Disabled' : 'Enabled'} account "${u.username}".`);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function confirmDeleteUser() {
    if (!pendingDeleteUser) return;
    setError('');
    setStatusMsg('');
    try {
      await apiFetch(`/api/admin/users/${pendingDeleteUser.id}`, { method: 'DELETE' });
      setStatusMsg(`Deleted account "${pendingDeleteUser.username}".`);
      setPendingDeleteUser(null);
      await loadAll();
    } catch (err) {
      setError((err as Error).message);
      setPendingDeleteUser(null);
    }
  }

  const filteredLogs = logs.filter((l) => {
    if (logFilter && l.action_type !== logFilter) return false;
    const q = (logSearch || globalSearch).trim().toLowerCase();
    if (q) {
      return (
        l.username.toLowerCase().includes(q) ||
        l.action_type.toLowerCase().includes(q) ||
        l.details.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const filteredUsers = users.filter((u) => {
    const q = globalSearch.trim().toLowerCase();
    if (!q) return true;
    return (
      u.username.toLowerCase().includes(q) ||
      u.full_name.toLowerCase().includes(q) ||
      u.emp_id.toLowerCase().includes(q) ||
      u.department.toLowerCase().includes(q)
    );
  });

  const actionTypes = [...new Set(logs.map((l) => l.action_type))];

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-120px)]">
      <ConfirmDialog
        open={pendingDeleteUser !== null}
        title="Delete Staff Account"
        description={`Are you sure you want to permanently remove "${pendingDeleteUser?.username}" (${pendingDeleteUser?.full_name})? This action cannot be undone.`}
        confirmLabel="Delete Account"
        onConfirm={() => void confirmDeleteUser()}
        onCancel={() => setPendingDeleteUser(null)}
      />

      {/* Left Sidebar Navigation */}
      <aside className="lg:w-64 shrink-0 bg-white dark:bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-4">
        <div className="mb-4 px-2">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Admin Command Center
          </p>
        </div>
        <nav className="flex lg:flex-col gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('analytics')}
            className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'analytics'
                ? 'bg-[#0b5299] text-white'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <BarChart3 className="w-4 h-4 shrink-0" />
            <span>University Analytics</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('accounts')}
            className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'accounts'
                ? 'bg-[#0b5299] text-white'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4 shrink-0" />
            <span>Examiner Accounts</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('audit')}
            className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'audit'
                ? 'bg-[#0b5299] text-white'
                : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <FileText className="w-4 h-4 shrink-0" />
            <span>System Audit Logs</span>
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 p-6 lg:p-8 max-w-[1280px]">
        {statusMsg && (
          <div className="mb-6 p-3 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-200">
            {statusMsg}
          </div>
        )}
        {error && (
          <div className="mb-6 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs font-medium text-[#ff0000]">
            {error}
          </div>
        )}

        {loading && !analytics ? (
          <div className="space-y-4">
            <div className="h-24 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] animate-pulse" />
            <div className="h-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] animate-pulse" />
          </div>
        ) : null}

        {/* TAB 1: ANALYTICS */}
        {activeTab === 'analytics' && analytics && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
                  University-Wide Examination Analytics
                </h1>
              </div>
              <button
                type="button"
                onClick={() => void loadAll()}
                className="px-5 py-2 min-h-[39px] text-xs font-medium bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:border-[#0b5299] text-slate-800 dark:text-slate-100 rounded-none cursor-pointer whitespace-nowrap"
              >
                Refresh Metrics
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-5">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Eligible Students</p>
                <p className="font-mono-tabular text-3xl font-semibold text-[#0b5299] dark:text-sky-400 mt-2">
                  {analytics.active_students}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                  {analytics.detained_students} detained · {analytics.total_students} total
                </p>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-5">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Hall Seat Capacity</p>
                <p className="font-mono-tabular text-3xl font-semibold text-slate-900 dark:text-white mt-2">
                  {analytics.total_seat_capacity}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 tabular-nums">
                  Across {analytics.total_halls} configured rooms &amp; labs
                </p>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-5">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Exam Sessions Scheduled</p>
                <p className="font-mono-tabular text-3xl font-semibold text-slate-900 dark:text-white mt-2">
                  {analytics.total_exam_sessions}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Persisted in relational store</p>
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-5">
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Active Examiner Accounts</p>
                <p className="font-mono-tabular text-3xl font-semibold text-slate-900 dark:text-white mt-2">
                  {analytics.total_examiners}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Department Exam Cell staff</p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-4">
                  Active Students by Academic Year
                </h2>
                {analytics.students_by_year.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    No student cohorts uploaded yet. Examiners can import Excel rosters in the Examiner Workspace.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {analytics.students_by_year.map((item) => {
                      const pct =
                        analytics.active_students > 0
                          ? Math.round((item.count / analytics.active_students) * 100)
                          : 0;
                      return (
                        <div key={item.year} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              B.Tech Year {item.year}
                            </span>
                            <span className="font-mono-tabular text-slate-600 dark:text-slate-400">
                              {item.count} students ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-[#0b5299]"
                              style={{ width: `${Math.max(4, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white mb-4">
                  Minor Stream Distribution
                </h2>
                {analytics.students_by_minor.length === 0 ? (
                  <p className="text-sm text-slate-500 dark:text-slate-400">No minor stream records present.</p>
                ) : (
                  <div className="space-y-3">
                    {analytics.students_by_minor.map((item) => {
                      const pct =
                        analytics.active_students > 0
                          ? Math.round((item.count / analytics.active_students) * 100)
                          : 0;
                      return (
                        <div key={item.minor_stream} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-medium text-slate-800 dark:text-slate-200">
                              {item.minor_stream === 'NONE' ? 'Regular Core Track' : `Minor: ${item.minor_stream}`}
                            </span>
                            <span className="font-mono-tabular text-slate-600 dark:text-slate-400">
                              {item.count} students ({pct}%)
                            </span>
                          </div>
                          <div className="h-2 bg-slate-100 dark:bg-slate-800 overflow-hidden">
                            <div
                              className={item.minor_stream === 'NONE' ? 'h-full bg-slate-400' : 'h-full bg-[#cf6c38]'}
                              style={{ width: `${Math.max(4, pct)}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800">
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Recent Examination Sessions
                </h2>
              </div>
              {analytics.recent_sessions.length === 0 ? (
                <div className="p-6 text-sm text-slate-500 dark:text-slate-400">
                  No examination sessions have been created yet.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#0b5299] text-white text-xs font-medium">
                        <th className="py-2.5 px-4">Exam Title</th>
                        <th className="py-2.5 px-4">Department</th>
                        <th className="py-2.5 px-4">Date &amp; Slot</th>
                        <th className="py-2.5 px-4">Strategy</th>
                        <th className="py-2.5 px-4">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {analytics.recent_sessions.map((s) => (
                        <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                            {s.exam_title}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{s.department}</td>
                          <td className="py-2.5 px-4 font-mono-tabular text-slate-700 dark:text-slate-300">
                            {s.exam_date} · {s.session_slot}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{s.seating_mode}</td>
                          <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-white">{s.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: EXAMINER ACCOUNT CRUD */}
        {activeTab === 'accounts' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
                  Examiner &amp; Administrator Accounts
                </h1>
              </div>
              <button
                type="button"
                onClick={openCreateUser}
                className="flex items-center gap-2 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                <span>Add Account</span>
              </button>
            </div>

            {showUserForm && (
              <form
                onSubmit={handleSaveUser}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-4"
              >
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                  <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                    {editingUser ? `Edit Account: ${editingUser.username}` : 'Create Staff Account'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowUserForm(false)}
                    className="text-slate-500 hover:text-slate-800 dark:text-slate-400 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Username
                    </label>
                    <input
                      type="text"
                      required
                      disabled={Boolean(editingUser)}
                      value={formUsername}
                      onChange={(e) => setFormUsername(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 disabled:bg-slate-100 dark:disabled:bg-slate-800/50 focus:outline-none focus:border-[#0b5299]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      {editingUser ? 'New Password (optional)' : 'Initial Password'}
                    </label>
                    <div className="relative">
                      <input
                        type={showFormPassword ? 'text' : 'password'}
                        required={!editingUser}
                        value={formPassword}
                        onChange={(e) => setFormPassword(e.target.value)}
                        className="w-full pl-3 pr-9 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowFormPassword((p) => !p)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 cursor-pointer"
                      >
                        {showFormPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Employee ID
                    </label>
                    <input
                      type="text"
                      required
                      value={formEmpId}
                      onChange={(e) => setFormEmpId(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Full Name
                    </label>
                    <input
                      type="text"
                      required
                      value={formFullName}
                      onChange={(e) => setFormFullName(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Department
                    </label>
                    <input
                      type="text"
                      required
                      value={formDepartment}
                      onChange={(e) => setFormDepartment(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Role
                    </label>
                    <select
                      value={formRole}
                      onChange={(e) => setFormRole(e.target.value as UserRole)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                    >
                      <option value="EXAMINER">EXAMINER</option>
                      <option value="ADMIN">ADMIN</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowUserForm(false)}
                    className="px-5 py-2 min-h-[39px] text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 rounded-none cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingUser}
                    className="px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
                  >
                    {savingUser ? 'Saving...' : editingUser ? 'Save Changes' : 'Create Account'}
                  </button>
                </div>
              </form>
            )}

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-[#0b5299] text-white text-xs font-medium">
                      <th className="py-3 px-4">Emp ID</th>
                      <th className="py-3 px-4">Full Name</th>
                      <th className="py-3 px-4">Username</th>
                      <th className="py-3 px-4">Department</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                    {filteredUsers.map((u) => (
                      <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                        <td className="py-3 px-4 font-mono-tabular font-medium text-slate-800 dark:text-slate-200">
                          {u.emp_id}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900 dark:text-white">
                          {u.full_name}
                        </td>
                        <td className="py-3 px-4 font-mono-tabular text-slate-600 dark:text-slate-400">
                          {u.username}
                        </td>
                        <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{u.department}</td>
                        <td className="py-3 px-4 font-medium text-[#0b5299] dark:text-sky-400">{u.role}</td>
                        <td className="py-3 px-4">
                          <span
                            className={`font-medium ${
                              u.is_active ? 'text-emerald-700 dark:text-emerald-400' : 'text-[#ff0000]'
                            }`}
                          >
                            {u.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => openEditUser(u)}
                              title="Edit Account"
                              className="p-1.5 border border-slate-200 dark:border-slate-700 hover:border-[#0b5299] text-slate-700 dark:text-slate-300 cursor-pointer"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {u.id !== currentUser.id && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void handleToggleActive(u)}
                                  className="px-2.5 py-1 border border-slate-200 dark:border-slate-700 hover:border-[#0b5299] text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer"
                                >
                                  {u.is_active ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPendingDeleteUser(u)}
                                  title="Delete Account"
                                  className="p-1.5 border border-slate-200 dark:border-slate-700 hover:border-red-400 text-[#ff0000] cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
                  System Audit &amp; Data Logs
                </h1>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={logSearch}
                    onChange={(e) => setLogSearch(e.target.value)}
                    aria-label="Filter audit logs"
                    className="pl-9 pr-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                  />
                </div>
                <select
                  value={logFilter}
                  onChange={(e) => setLogFilter(e.target.value)}
                  className="px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                >
                  <option value="">All Action Types</option>
                  {actionTypes.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] overflow-hidden">
              {filteredLogs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500 dark:text-slate-400">
                  No audit entries match the current filter.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#0b5299] text-white text-xs font-medium">
                        <th className="py-3 px-4">Timestamp (UTC)</th>
                        <th className="py-3 px-4">User</th>
                        <th className="py-3 px-4">Role</th>
                        <th className="py-3 px-4">Action</th>
                        <th className="py-3 px-4">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                      {filteredLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <td className="py-2.5 px-4 font-mono-tabular text-slate-600 dark:text-slate-400 whitespace-nowrap">
                            {log.created_at}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-900 dark:text-white">
                            {log.username}
                          </td>
                          <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300">{log.role}</td>
                          <td className="py-2.5 px-4 font-mono-tabular font-medium text-[#0b5299] dark:text-sky-400">
                            {log.action_type}
                          </td>
                          <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
