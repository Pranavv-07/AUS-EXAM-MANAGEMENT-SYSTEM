import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Save,
  ArrowUpRight,
  Download,
  Upload,
  Trash2,
  UserCheck,
  Wand2,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../../lib/api.ts';
import type {
  ExamSession,
  FacultyWillingness,
  HallAllocation,
  ScheduledSubject,
} from '../../types/exam.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface WillingnessStepProps {
  activeSession: ExamSession | null;
  allocations: HallAllocation[];
  onRefreshAllocations: () => Promise<void>;
  onNext: () => void;
}

interface DutyDraft {
  allocation_id: number;
  room_no: string;
  invigilator_1_name: string;
  invigilator_1_emp_id: string;
  invigilator_1_willing: boolean;
  invigilator_2_name: string;
  invigilator_2_emp_id: string;
  invigilator_2_willing: boolean;
}

export function WillingnessStep({
  activeSession,
  allocations,
  onRefreshAllocations,
  onNext,
}: WillingnessStepProps) {
  const [drafts, setDrafts] = useState<DutyDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');

  // Template & Upload states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [tplDept, setTplDept] = useState(activeSession?.department || 'Freshman Engineering - I');
  const [tplTitle, setTplTitle] = useState(
    activeSession?.exam_title || 'I B.Tech II Semester Will Invigilation Duties List'
  );
  const [tplDates, setTplDates] = useState(activeSession?.exam_date || '2026-11-24');
  const [uploading, setUploading] = useState(false);
  const [willingnessRows, setWillingnessRows] = useState<FacultyWillingness[]>([]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Conflict checking & Auto-Assign state
  const [subjectsCatalog, setSubjectsCatalog] = useState<ScheduledSubject[]>([]);
  const [autoRule, setAutoRule] = useState<'TWO_PER_ROOM' | 'ONE_PER_30'>('TWO_PER_ROOM');
  const [autoAssigning, setAutoAssigning] = useState(false);
  const [excludedClashes, setExcludedClashes] = useState<
    Array<{ emp_id: string; faculty_name: string; reason: string; matching_courses: string[] }>
  >([]);

  async function fetchWillingnessForSession() {
    if (!activeSession) return;
    try {
      const qs = `?date=${encodeURIComponent(activeSession.exam_date)}&slot=${encodeURIComponent(
        activeSession.session_slot
      )}`;
      const rows = await apiFetch<FacultyWillingness[]>(`/api/willingness${qs}`);
      setWillingnessRows(rows);
    } catch {
      // ignore transient
    }
  }

  useEffect(() => {
    apiFetch<ScheduledSubject[]>('/api/subjects')
      .then((rows) => setSubjectsCatalog(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeSession) {
      setTplDept(activeSession.department || 'Freshman Engineering - I');
      setTplTitle(activeSession.exam_title);
      setTplDates(activeSession.exam_date);
      setExcludedClashes([]);
      void fetchWillingnessForSession();
    }
  }, [activeSession?.id, activeSession?.exam_date, activeSession?.session_slot]);

  useEffect(() => {
    setDrafts(
      allocations.map((a) => ({
        allocation_id: a.id,
        room_no: a.hall.room_no,
        invigilator_1_name: a.invigilator_1_name,
        invigilator_1_emp_id: a.invigilator_1_emp_id,
        invigilator_1_willing: a.invigilator_1_willing,
        invigilator_2_name: a.invigilator_2_name,
        invigilator_2_emp_id: a.invigilator_2_emp_id,
        invigilator_2_willing: a.invigilator_2_willing,
      }))
    );
  }, [allocations]);

  function updateDraft(idx: number, patch: Partial<DutyDraft>) {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  async function handleDownloadTemplate() {
    setError('');
    try {
      const qs = new URLSearchParams({
        department: tplDept,
        title: tplTitle,
        dates: tplDates,
      }).toString();
      await downloadAuthorizedFile(
        `/api/willingness/template-excel?${qs}`,
        'aditya_willingness_template.xlsx'
      );
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleUploadWillingness(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError('');
    setStatusMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const data = await apiFetch<{
        total_entries?: number;
        willing_yes_count?: number;
        dates?: string[];
      }>('/api/willingness/upload', {
        method: 'POST',
        body: formData,
      });
      await fetchWillingnessForSession();
      setStatusMsg(
        `Uploaded "${file.name}": ${data.willing_yes_count || 0} YES willing slot entries parsed across ${(data.dates || []).join(', ')}.`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleClearWillingness() {
    try {
      await apiFetch('/api/willingness', { method: 'DELETE' });
      setWillingnessRows([]);
      setConfirmClearOpen(false);
      setStatusMsg('Cleared uploaded willingness sheet entries.');
    } catch (err) {
      setError((err as Error).message);
      setConfirmClearOpen(false);
    }
  }

  async function handleSaveAll(goNext = false) {
    if (!activeSession) return;
    setSaving(true);
    setError('');
    setStatusMsg('');
    try {
      await apiFetch(`/api/exams/${activeSession.id}/willingness`, {
        method: 'POST',
        body: JSON.stringify({ assignments: drafts }),
      });
      await onRefreshAllocations();
      setStatusMsg('Invigilation willingness roster saved and synchronized with PDF statements.');
      if (goNext) onNext();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleAutoAssign() {
    if (!activeSession) return;
    setAutoAssigning(true);
    setError('');
    setStatusMsg('');
    try {
      const res = await apiFetch<{
        assigned_rooms: number;
        unfilled_slots: number;
        pool_available: number;
        excluded_clashes: Array<{
          emp_id: string;
          faculty_name: string;
          reason: string;
          matching_courses: string[];
        }>;
      }>(`/api/exams/${activeSession.id}/auto-assign-invigilators`, {
        method: 'POST',
        body: JSON.stringify({ rule: autoRule }),
      });
      setExcludedClashes(res.excluded_clashes || []);
      await Promise.all([onRefreshAllocations(), fetchWillingnessForSession()]);
      setStatusMsg(
        `Auto-assigned ${res.assigned_rooms} / ${allocations.length} halls (${
          autoRule === 'ONE_PER_30' ? '1 per 30 students' : '2 per room'
        }) using lowest-duty fair rotation.${
          res.excluded_clashes?.length
            ? ` Excluded ${res.excluded_clashes.length} faculty due to subject/slot clash.`
            : ''
        }`
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAutoAssigning(false);
    }
  }

  const sessionCourseCodes = useMemo(() => {
    const codes = new Set<string>();
    if (!activeSession) return codes;
    const selectedSet = new Set(activeSession.selected_subject_ids || []);
    for (const s of subjectsCatalog) {
      if (selectedSet.has(s.id) && s.course_code) {
        codes.add(s.course_code.trim().toUpperCase());
      }
    }
    for (const val of Object.values(activeSession.subject_mapping || {})) {
      const m = String(val || '').match(/\b([0-9]{2,4}[A-Z]{1,4}[0-9A-Z]{1,6})\b/i);
      if (m) codes.add(m[1].toUpperCase());
    }
    return codes;
  }, [activeSession, subjectsCatalog]);

  const facultyClashesByEmpId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const w of willingnessRows) {
      const matching = (w.teaching_courses || []).filter((c) =>
        sessionCourseCodes.has(String(c).trim().toUpperCase())
      );
      if (matching.length > 0) {
        map.set(w.emp_id.trim(), matching);
      }
    }
    return map;
  }, [willingnessRows, sessionCourseCodes]);

  if (!activeSession || allocations.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-8 text-center">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Run the Seating Allocation Engine in Step 04 first to populate room-wise invigilation slots.
        </p>
      </div>
    );
  }

  const willingFaculty = willingnessRows.filter((w) => w.willing === 'YES');

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={confirmClearOpen}
        title="Clear Uploaded Willingness List"
        description="Remove all uploaded faculty willingness entries from the database? Existing room duty assignments will stay intact."
        confirmLabel="Clear List"
        onConfirm={() => void handleClearWillingness()}
        onCancel={() => setConfirmClearOpen(false)}
      />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
            05. Invigilation Willingness Form &amp; Room Assignment
          </h1>
          <p className="text-xs font-medium text-[#0b5299] dark:text-sky-400 mt-0.5">
            {activeSession.exam_title} · {activeSession.exam_date} ({activeSession.session_slot})
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveAll(false)}
            className="flex items-center gap-2 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{saving ? 'Saving...' : 'Save Roster'}</span>
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveAll(true)}
            className="flex items-center gap-1.5 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#cf6c38] hover:bg-[#b85a29] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <span>Save &amp; Preview PDFs</span>
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

      {/* Department Willingness Excel Template & Upload */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-[#0b5299]" />
              <span>Faculty Willingness Excel Template &amp; Sheet Upload</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Official template uses strict <span className="font-semibold">YES / NO</span> dropdown
              validation &amp; conditional formatting in every FN / AN column (non-conforming files or unreadable tick marks are rejected).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void handleDownloadTemplate()}
              className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:border-[#0b5299] rounded-none cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download Willingness Template (.xlsx)</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleUploadWillingness}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>{uploading ? 'Validating Sheet...' : 'Upload Willingness Sheet (.xlsx)'}</span>
            </button>
            {willingnessRows.length > 0 && (
              <button
                type="button"
                onClick={() => setConfirmClearOpen(true)}
                className="flex items-center gap-1 px-3 py-2 text-xs font-medium border border-red-200 text-[#ff0000] hover:bg-red-50 dark:hover:bg-red-950 rounded-none cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Template Department Header
            </label>
            <input
              type="text"
              value={tplDept}
              onChange={(e) => setTplDept(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Template Exam List Title
            </label>
            <input
              type="text"
              value={tplTitle}
              onChange={(e) => setTplTitle(e.target.value)}
              className="w-full px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
              Template Exam Dates (Comma Separated)
            </label>
            <input
              type="text"
              value={tplDates}
              onChange={(e) => setTplDates(e.target.value)}
              placeholder="2026-11-24, 2026-11-25"
              className="w-full px-3 py-1.5 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
        </div>

        {willingnessRows.length > 0 && (
          <div className="border border-slate-200 dark:border-slate-800">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Faculty Willingness Status for {activeSession.exam_date} ({activeSession.session_slot})
              </span>
              <span className="font-mono-tabular text-[#0b5299] dark:text-sky-400 font-semibold">
                {willingFaculty.length} Willing (YES) / {willingnessRows.length} Listed
              </span>
            </div>
            <div className="max-h-[210px] overflow-y-auto overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                    <th className="py-2 px-3 w-12">S.No</th>
                    <th className="py-2 px-3">Emp ID</th>
                    <th className="py-2 px-3">Faculty Name</th>
                    <th className="py-2 px-3">Designation</th>
                    <th className="py-2 px-3">Teaching Courses</th>
                    <th className="py-2 px-3 text-center">Duties Assigned</th>
                    <th className="py-2 px-3 text-center">Willing ({activeSession.session_slot})</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {willingnessRows.map((w, idx) => {
                    const clashCourses = facultyClashesByEmpId.get(w.emp_id.trim()) || [];
                    return (
                      <tr key={w.id}>
                        <td className="py-2 px-3 font-mono-tabular text-slate-500">{idx + 1}</td>
                        <td className="py-2 px-3 font-mono-tabular font-semibold">{w.emp_id}</td>
                        <td className="py-2 px-3 font-medium text-slate-900 dark:text-white">
                          {w.faculty_name}
                        </td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{w.designation}</td>
                        <td className="py-2 px-3 font-mono-tabular text-[11px]">
                          {w.teaching_courses && w.teaching_courses.length > 0 ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="text-slate-700 dark:text-slate-300">
                                {w.teaching_courses.join(', ')}
                              </span>
                              {clashCourses.length > 0 && (
                                <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                  CLASH ({clashCourses.join(', ')})
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-center font-mono-tabular font-semibold text-slate-700 dark:text-slate-300">
                          {w.duty_count ?? 0}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <span
                            className={`inline-block px-2 py-0.5 text-[11px] font-mono-tabular font-semibold ${
                              w.willing === 'YES'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                            }`}
                          >
                            {w.willing}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Automated Duty Roster & Conflict Checker */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
              <Wand2 className="w-4 h-4 text-[#cf6c38]" />
              <span>Automated Invigilator Duty Roster &amp; Clash Checker</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Auto-assigns willing faculty ordered by lowest cumulative duty count while excluding teachers whose courses are examined in this session or who are already booked in this slot.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex border border-slate-300 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setAutoRule('TWO_PER_ROOM')}
                className={`px-3 py-1.5 text-xs font-medium cursor-pointer ${
                  autoRule === 'TWO_PER_ROOM'
                    ? 'bg-[#0b5299] text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                2 per Room
              </button>
              <button
                type="button"
                onClick={() => setAutoRule('ONE_PER_30')}
                className={`px-3 py-1.5 text-xs font-medium border-l border-slate-300 dark:border-slate-700 cursor-pointer ${
                  autoRule === 'ONE_PER_30'
                    ? 'bg-[#0b5299] text-white'
                    : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                }`}
              >
                1 per 30 Students
              </button>
            </div>
            <button
              type="button"
              disabled={autoAssigning || willingFaculty.length === 0}
              onClick={() => void handleAutoAssign()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#cf6c38] hover:bg-[#b85a29] disabled:opacity-50 text-white rounded-none cursor-pointer whitespace-nowrap"
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>{autoAssigning ? 'Assigning Roster...' : 'Auto-Assign Willing Faculty'}</span>
            </button>
          </div>
        </div>

        {excludedClashes.length > 0 && (
          <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Excluded Faculty Clashes Detected ({excludedClashes.length})</span>
            </div>
            <div className="space-y-1 text-[11px] text-amber-900 dark:text-amber-200">
              {excludedClashes.map((c) => (
                <div key={`${c.emp_id}-${c.reason}`} className="font-mono-tabular">
                  <span className="font-semibold">
                    {c.faculty_name} ({c.emp_id})
                  </span>
                  : {c.reason}
                  {c.matching_courses.length > 0 ? ` [${c.matching_courses.join(', ')}]` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Room Duty Assignment Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-[#0b5299] text-white text-xs font-medium">
                <th className="py-3 px-4">Room No</th>
                <th className="py-3 px-4">Invigilator - I (Pick Willing or Type)</th>
                <th className="py-3 px-4">Emp. ID</th>
                <th className="py-3 px-4 text-center">Willing</th>
                <th className="py-3 px-4">Invigilator - II (Pick Willing or Type)</th>
                <th className="py-3 px-4">Emp. ID</th>
                <th className="py-3 px-4 text-center">Willing</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
              {drafts.map((d, idx) => {
                const clash1 = d.invigilator_1_emp_id
                  ? facultyClashesByEmpId.get(d.invigilator_1_emp_id.trim()) || []
                  : [];
                const clash2 = d.invigilator_2_emp_id
                  ? facultyClashesByEmpId.get(d.invigilator_2_emp_id.trim()) || []
                  : [];
                return (
                  <tr key={d.allocation_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-3 px-4 font-mono-tabular font-semibold text-slate-900 dark:text-white whitespace-nowrap">
                      {d.room_no}
                    </td>
                    <td className="py-2.5 px-3 space-y-1">
                      {willingFaculty.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => {
                            const found = willingFaculty.find((f) => f.emp_id === e.target.value);
                            if (found) {
                              updateDraft(idx, {
                                invigilator_1_name: found.faculty_name,
                                invigilator_1_emp_id: found.emp_id,
                                invigilator_1_willing: true,
                              });
                            }
                          }}
                          className="w-full min-w-[175px] px-2 py-1 text-[11px] border border-[#0b5299]/40 bg-[#eef3f9] dark:bg-sky-950 text-slate-800 dark:text-slate-100"
                        >
                          <option value="">-- Select Willing Faculty (YES) --</option>
                          {willingFaculty.map((f) => {
                            const clash = facultyClashesByEmpId.get(f.emp_id.trim());
                            return (
                              <option key={f.emp_id} value={f.emp_id}>
                                {f.faculty_name} ({f.emp_id}) [{f.duty_count ?? 0}d]
                                {clash ? ` - CLASH (${clash.join(',')})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      )}
                      <input
                        type="text"
                        value={d.invigilator_1_name}
                        onChange={(e) => updateDraft(idx, { invigilator_1_name: e.target.value })}
                        placeholder="Invigilator I Name"
                        className="w-full min-w-[175px] px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                      />
                      {clash1.length > 0 && (
                        <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                          Subject clash warning: teaches {clash1.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-bottom">
                      <input
                        type="text"
                        value={d.invigilator_1_emp_id}
                        onChange={(e) => updateDraft(idx, { invigilator_1_emp_id: e.target.value })}
                        className="w-full min-w-[95px] px-2.5 py-1.5 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-center align-bottom pb-4">
                      <input
                        type="checkbox"
                        checked={d.invigilator_1_willing}
                        onChange={(e) => updateDraft(idx, { invigilator_1_willing: e.target.checked })}
                        className="accent-[#0b5299] w-4 h-4 cursor-pointer"
                      />
                    </td>
                    <td className="py-2.5 px-3 space-y-1">
                      {willingFaculty.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => {
                            const found = willingFaculty.find((f) => f.emp_id === e.target.value);
                            if (found) {
                              updateDraft(idx, {
                                invigilator_2_name: found.faculty_name,
                                invigilator_2_emp_id: found.emp_id,
                                invigilator_2_willing: true,
                              });
                            }
                          }}
                          className="w-full min-w-[175px] px-2 py-1 text-[11px] border border-[#0b5299]/40 bg-[#eef3f9] dark:bg-sky-950 text-slate-800 dark:text-slate-100"
                        >
                          <option value="">-- Select Willing Faculty (YES) --</option>
                          {willingFaculty.map((f) => {
                            const clash = facultyClashesByEmpId.get(f.emp_id.trim());
                            return (
                              <option key={f.emp_id} value={f.emp_id}>
                                {f.faculty_name} ({f.emp_id}) [{f.duty_count ?? 0}d]
                                {clash ? ` - CLASH (${clash.join(',')})` : ''}
                              </option>
                            );
                          })}
                        </select>
                      )}
                      <input
                        type="text"
                        value={d.invigilator_2_name}
                        onChange={(e) => updateDraft(idx, { invigilator_2_name: e.target.value })}
                        placeholder="Invigilator II Name"
                        className="w-full min-w-[175px] px-2.5 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                      />
                      {clash2.length > 0 && (
                        <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                          Subject clash warning: teaches {clash2.join(', ')}
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-3 align-bottom">
                      <input
                        type="text"
                        value={d.invigilator_2_emp_id}
                        onChange={(e) => updateDraft(idx, { invigilator_2_emp_id: e.target.value })}
                        className="w-full min-w-[95px] px-2.5 py-1.5 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                      />
                    </td>
                    <td className="py-2.5 px-3 text-center align-bottom pb-4">
                      <input
                        type="checkbox"
                        checked={d.invigilator_2_willing}
                        onChange={(e) => updateDraft(idx, { invigilator_2_willing: e.target.checked })}
                        className="accent-[#0b5299] w-4 h-4 cursor-pointer"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
