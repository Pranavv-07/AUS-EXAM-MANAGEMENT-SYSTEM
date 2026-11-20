import React, { useEffect, useRef, useState } from 'react';
import { Upload, Download, ArrowUpRight, Plus, Search, Pencil, Trash2, X, SlidersHorizontal } from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../../lib/api.ts';
import type { MinorStreamOption, Student } from '../../types/exam.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface StudentRosterStepProps {
  students: Student[];
  onRefresh: () => Promise<void>;
  onNext: () => void;
  globalSearch?: string;
}

const DEFAULT_BRANCH_OPTIONS = ['CSE', 'ECE', 'EEE', 'IT', 'AIML', 'MECH', 'CIVIL'];

export function StudentRosterStep({
  students,
  onRefresh,
  onNext,
  globalSearch = '',
}: StudentRosterStepProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [search, setSearch] = useState('');
  const [yearFilter, setYearFilter] = useState<string>('ALL');
  const [branchFilter, setBranchFilter] = useState<string>('ALL');
  const [minorFilter, setMinorFilter] = useState<string>('ALL');

  const [minorOptions, setMinorOptions] = useState<MinorStreamOption[]>([]);
  const [templateBranches, setTemplateBranches] = useState<string[]>(DEFAULT_BRANCH_OPTIONS);
  const [newBranchInput, setNewBranchInput] = useState('');
  const [newMinorBranch, setNewMinorBranch] = useState('CSE');
  const [newMinorName, setNewMinorName] = useState('');
  const [newMinorCode, setNewMinorCode] = useState('');
  const [showTemplateConfig, setShowTemplateConfig] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  // Confirm dialogs
  const [pendingDelete, setPendingDelete] = useState<Student | null>(null);

  // CRUD Form
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Student | null>(null);
  const [rollNo, setRollNo] = useState('');
  const [fullName, setFullName] = useState('');
  const [branch, setBranch] = useState('CSE');
  const [currentYear, setCurrentYear] = useState(2);
  const [batchCode, setBatchCode] = useState('2025-2029');
  const [minorStream, setMinorStream] = useState('NONE');
  const [isDetained, setIsDetained] = useState(false);
  const [saving, setSaving] = useState(false);

  async function loadMinorOptions() {
    try {
      const list = await apiFetch<MinorStreamOption[]>('/api/minor-streams');
      setMinorOptions(list);
    } catch {
      // ignore transient
    }
  }

  useEffect(() => {
    void loadMinorOptions();
  }, []);

  useEffect(() => {
    if (globalSearch.trim()) {
      setSearch(globalSearch);
    }
  }, [globalSearch]);

  const branches = [...new Set([...templateBranches, ...students.map((s) => s.branch)])].sort();
  const minorNames = [
    ...new Set([
      ...minorOptions.map((m) => m.name),
      ...students.map((s) => s.minor_stream).filter((m) => m && m !== 'NONE'),
    ]),
  ].sort();

  const filtered = students.filter((s) => {
    if (yearFilter !== 'ALL' && s.current_year !== Number(yearFilter)) return false;
    if (branchFilter !== 'ALL' && s.branch !== branchFilter) return false;
    if (minorFilter !== 'ALL' && s.minor_stream !== minorFilter) return false;
    const activeSearch = (search || globalSearch).trim().toLowerCase();
    if (activeSearch) {
      return (
        s.roll_no.toLowerCase().includes(activeSearch) ||
        s.full_name.toLowerCase().includes(activeSearch) ||
        s.branch.toLowerCase().includes(activeSearch)
      );
    }
    return true;
  });

  async function handleAddMinorOption(e: React.FormEvent) {
    e.preventDefault();
    if (!newMinorName.trim() || !newMinorCode.trim()) return;
    setError('');
    try {
      await apiFetch('/api/minor-streams', {
        method: 'POST',
        body: JSON.stringify({
          branch: newMinorBranch,
          name: newMinorName.trim(),
          code: newMinorCode.trim().toUpperCase(),
        }),
      });
      setNewMinorName('');
      setNewMinorCode('');
      await loadMinorOptions();
      setStatusMsg('Added Minor Stream option for student forms and Excel dropdowns.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteMinorOption(id: number) {
    await apiFetch(`/api/minor-streams/${id}`, { method: 'DELETE' });
    await loadMinorOptions();
  }

  function handleAddBranchTag() {
    const clean = newBranchInput.trim().toUpperCase();
    if (!clean) return;
    if (!templateBranches.includes(clean)) {
      setTemplateBranches((prev) => [...prev, clean].sort());
    }
    setNewBranchInput('');
  }

  async function handleDownloadTemplate() {
    const params = new URLSearchParams();
    params.set('branches', branches.join(','));
    params.set('minors', minorNames.join(','));
    await downloadAuthorizedFile(
      `/api/students/sample-excel?${params.toString()}`,
      'aditya_students_template.xlsx'
    );
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    setStatusMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiFetch<{ processed: number; skipped: number; filename: string }>(
        '/api/students/upload',
        { method: 'POST', body: formData }
      );
      setStatusMsg(`Imported ${res.processed} student records from "${res.filename}" (${res.skipped} skipped).`);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function openAdd() {
    setEditing(null);
    setRollNo('');
    setFullName('');
    setBranch(branches[0] || 'CSE');
    setCurrentYear(2);
    setBatchCode('2025-2029');
    setMinorStream('NONE');
    setIsDetained(false);
    setShowForm(true);
  }

  function openEdit(s: Student) {
    setEditing(s);
    setRollNo(s.roll_no);
    setFullName(s.full_name);
    setBranch(s.branch);
    setCurrentYear(s.current_year);
    setBatchCode(s.batch_code);
    setMinorStream(s.minor_stream);
    setIsDetained(s.is_detained);
    setShowForm(true);
  }

  async function handleSaveStudent(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        roll_no: rollNo,
        full_name: fullName,
        branch,
        current_year: currentYear,
        batch_code: batchCode,
        minor_stream: minorStream,
        is_detained: isDetained,
      };
      if (editing) {
        await apiFetch(`/api/students/${editing.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setStatusMsg(`Updated student ${rollNo.toUpperCase()}.`);
      } else {
        await apiFetch('/api/students', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStatusMsg(`Added student ${rollNo.toUpperCase()}.`);
      }
      setShowForm(false);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteStudent() {
    if (!pendingDelete) return;
    setError('');
    try {
      await apiFetch(`/api/students/${pendingDelete.id}`, { method: 'DELETE' });
      setStatusMsg(`Removed student ${pendingDelete.roll_no}.`);
      setPendingDelete(null);
      await onRefresh();
    } catch (err) {
      setError((err as Error).message);
      setPendingDelete(null);
    }
  }

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={pendingDelete !== null}
        title="Remove Student Record"
        description={`Are you sure you want to remove student ${pendingDelete?.roll_no} (${pendingDelete?.full_name}) from the database?`}
        confirmLabel="Remove Student"
        onConfirm={() => void confirmDeleteStudent()}
        onCancel={() => setPendingDelete(null)}
      />

      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
            01. Student &amp; Minor Stream Roster
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => setShowTemplateConfig((p) => !p)}
            className="flex items-center gap-1.5 px-3.5 py-2 min-h-[39px] text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#0b5299] text-slate-800 dark:text-slate-100 rounded-none cursor-pointer whitespace-nowrap"
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Template &amp; Minor Options</span>
          </button>

          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            className="flex items-center gap-2 px-4 py-2 min-h-[39px] text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-[#0b5299] text-slate-800 dark:text-slate-100 rounded-none cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Excel Template (.xlsx)</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="hidden"
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-2 px-4 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{uploading ? 'Importing...' : 'Upload Excel Roster'}</span>
          </button>

          <button
            type="button"
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 min-h-[39px] text-xs font-medium border border-[#0b5299] text-[#0b5299] dark:text-sky-400 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-none cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add Student</span>
          </button>

          <button
            type="button"
            onClick={onNext}
            className="flex items-center gap-1.5 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#cf6c38] hover:bg-[#b85a29] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <span>Next: Hall Matrix</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {statusMsg && (
        <div className="p-3 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-200">
          {statusMsg}
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs font-medium text-[#ff0000]">
          {error}
        </div>
      )}

      {/* Configurable Minor Streams & Branches for Direct Selection + Excel Dropdown Template */}
      {showTemplateConfig && (
        <div className="bg-white dark:bg-slate-900 border border-[#0b5299] rounded-[8px] p-5 space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
              Configure Dropdown Values (Student CRUD &amp; Excel Template)
            </h2>
            <button
              type="button"
              onClick={() => setShowTemplateConfig(false)}
              className="text-slate-500 hover:text-slate-800 dark:text-slate-400 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Minor Streams Management */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Minor Stream Options
              </p>
              <form onSubmit={handleAddMinorOption} className="flex flex-wrap gap-2">
                <select
                  value={newMinorBranch}
                  onChange={(e) => setNewMinorBranch(e.target.value)}
                  className="px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">ALL</option>
                  {branches.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  required
                  value={newMinorName}
                  onChange={(e) => setNewMinorName(e.target.value)}
                  aria-label="Minor stream name"
                  className="flex-1 min-w-[140px] px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
                <input
                  type="text"
                  required
                  value={newMinorCode}
                  onChange={(e) => setNewMinorCode(e.target.value)}
                  aria-label="Minor stream short code"
                  className="w-20 px-2.5 py-1.5 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
                <button
                  type="submit"
                  className="px-3.5 py-1.5 text-xs font-medium bg-[#0b5299] text-white rounded-none cursor-pointer"
                >
                  Add Minor
                </button>
              </form>

              <div className="border border-slate-200 dark:border-slate-800 overflow-hidden">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      <th className="py-1.5 px-3">Branch</th>
                      <th className="py-1.5 px-3">Minor Stream Name</th>
                      <th className="py-1.5 px-3">Code</th>
                      <th className="py-1.5 px-3 text-right">Remove</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {minorOptions.map((m) => (
                      <tr key={m.id}>
                        <td className="py-1.5 px-3 font-mono-tabular">{m.branch}</td>
                        <td className="py-1.5 px-3 font-medium text-slate-900 dark:text-white">{m.name}</td>
                        <td className="py-1.5 px-3 font-mono-tabular text-[#0b5299] dark:text-sky-400">{m.code}</td>
                        <td className="py-1.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDeleteMinorOption(m.id)}
                            className="text-[#ff0000] hover:underline cursor-pointer"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Branches for Template Dropdown */}
            <div className="space-y-3">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                Branches Included in Excel Dropdowns &amp; Forms
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newBranchInput}
                  onChange={(e) => setNewBranchInput(e.target.value)}
                  aria-label="Add branch code"
                  className="flex-1 px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
                <button
                  type="button"
                  onClick={handleAddBranchTag}
                  className="px-3.5 py-1.5 text-xs font-medium bg-[#0b5299] text-white rounded-none cursor-pointer"
                >
                  Add Branch
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {branches.map((b) => (
                  <span
                    key={b}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
                  >
                    {b}
                  </span>
                ))}
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => void handleDownloadTemplate()}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-[#cf6c38] hover:bg-[#b85a29] text-white rounded-none cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Save &amp; Download Template with These Dropdowns</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary Strip */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] px-5 py-4 flex flex-wrap items-center gap-6 text-xs">
        <div>
          <span className="text-slate-500 dark:text-slate-400">Total Students:</span>{' '}
          <span className="font-mono-tabular font-semibold text-slate-900 dark:text-white">
            {students.length}
          </span>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">2nd Year:</span>{' '}
          <span className="font-mono-tabular font-semibold text-[#0b5299] dark:text-sky-400">
            {students.filter((s) => s.current_year === 2 && !s.is_detained).length}
          </span>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">3rd Year:</span>{' '}
          <span className="font-mono-tabular font-semibold text-[#0b5299] dark:text-sky-400">
            {students.filter((s) => s.current_year === 3 && !s.is_detained).length}
          </span>
        </div>
        <div>
          <span className="text-slate-500 dark:text-slate-400">Minor Stream:</span>{' '}
          <span className="font-mono-tabular font-semibold text-[#cf6c38]">
            {students.filter((s) => s.minor_stream !== 'NONE' && !s.is_detained).length}
          </span>
        </div>
      </div>

      {/* Add/Edit Student Form with Direct Dropdown Selection */}
      {showForm && (
        <form
          onSubmit={handleSaveStudent}
          className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-4"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              {editing ? `Edit Student: ${editing.roll_no}` : 'Add Student Record'}
            </h3>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="text-slate-500 hover:text-slate-800 dark:text-slate-400 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Roll Number
              </label>
              <input
                type="text"
                required
                value={rollNo}
                onChange={(e) => setRollNo(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Branch
              </label>
              <select
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              >
                {branches.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Academic Year
              </label>
              <select
                value={currentYear}
                onChange={(e) => setCurrentYear(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              >
                <option value={1}>Year 1</option>
                <option value={2}>Year 2</option>
                <option value={3}>Year 3</option>
                <option value={4}>Year 4</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Minor Stream
              </label>
              <select
                value={minorStream}
                onChange={(e) => setMinorStream(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              >
                <option value="NONE">NONE (Regular Track)</option>
                {minorNames.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Batch Code
              </label>
              <input
                type="text"
                value={batchCode}
                onChange={(e) => setBatchCode(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Detained (YES / NO)
              </label>
              <select
                value={isDetained ? 'YES' : 'NO'}
                onChange={(e) => setIsDetained(e.target.value === 'YES')}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              >
                <option value="NO">NO — Eligible</option>
                <option value="YES">YES — Detained</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="px-5 py-2 min-h-[39px] text-xs font-medium border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 rounded-none cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
            >
              {saving ? 'Saving...' : 'Save Student'}
            </button>
          </div>
        </form>
      )}

      {/* Filter Bar + Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] overflow-hidden">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Filter students by roll number or name"
              className="w-full pl-9 pr-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            >
              <option value="ALL">All Years</option>
              <option value="1">Year 1</option>
              <option value="2">Year 2</option>
              <option value="3">Year 3</option>
              <option value="4">Year 4</option>
            </select>

            <select
              value={branchFilter}
              onChange={(e) => setBranchFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            >
              <option value="ALL">All Branches</option>
              {branches.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>

            <select
              value={minorFilter}
              onChange={(e) => setMinorFilter(e.target.value)}
              className="px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            >
              <option value="ALL">All Minor Streams</option>
              <option value="NONE">Regular (NONE)</option>
              {minorNames.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="p-10 text-center space-y-2">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              {students.length === 0
                ? 'No student records loaded.'
                : 'No students match the selected filters.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0b5299] text-white text-xs font-medium">
                  <th className="py-2.5 px-4">Roll No</th>
                  <th className="py-2.5 px-4">Full Name</th>
                  <th className="py-2.5 px-4">Branch</th>
                  <th className="py-2.5 px-4">Year</th>
                  <th className="py-2.5 px-4">Batch</th>
                  <th className="py-2.5 px-4">Minor Stream</th>
                  <th className="py-2.5 px-4">Detained</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                {filtered.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2.5 px-4 font-mono-tabular font-semibold text-slate-900 dark:text-white">
                      {s.roll_no}
                    </td>
                    <td className="py-2.5 px-4 text-slate-800 dark:text-slate-200">{s.full_name}</td>
                    <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">{s.branch}</td>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-700 dark:text-slate-300">
                      Year {s.current_year}
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular text-slate-500 dark:text-slate-400">
                      {s.batch_code}
                    </td>
                    <td className="py-2.5 px-4 font-medium text-[#0b5299] dark:text-sky-400">
                      {s.minor_stream === 'NONE' ? '—' : s.minor_stream}
                    </td>
                    <td className="py-2.5 px-4 font-mono-tabular">
                      <span
                        className={
                          s.is_detained
                            ? 'text-[#ff0000] font-semibold'
                            : 'text-emerald-700 dark:text-emerald-400'
                        }
                      >
                        {s.is_detained ? 'YES' : 'NO'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEdit(s)}
                          title="Edit"
                          className="p-1.5 border border-slate-200 dark:border-slate-700 hover:border-[#0b5299] text-slate-700 dark:text-slate-300 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(s)}
                          title="Delete"
                          className="p-1.5 border border-slate-200 dark:border-slate-700 hover:border-red-400 text-[#ff0000] cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
