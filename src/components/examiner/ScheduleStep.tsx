import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  CheckCircle2,
  AlertTriangle,
  Plus,
  Trash2,
  BookOpen,
  Download,
  Upload,
  Building2,
} from 'lucide-react';
import { apiFetch, downloadAuthorizedFile } from '../../lib/api.ts';
import type {
  CapacityValidationResult,
  ExamLayoutConfig,
  ExamSession,
  Hall,
  InterleaveStyle,
  MinorStreamOption,
  ScheduledSubject,
  SeatingMode,
  SessionSlot,
  Student,
} from '../../types/exam.ts';
import { ConfirmDialog } from '../ConfirmDialog.tsx';

interface ScheduleStepProps {
  students: Student[];
  halls: Hall[];
  sessions: ExamSession[];
  activeSession: ExamSession | null;
  onSelectSession: (session: ExamSession) => void;
  onRefreshSessions: () => Promise<ExamSession[]>;
  onNext: () => void;
}

const ROOM_PATTERN_PRESETS: Array<{ label: string; pattern: number[] }> = [
  { label: '3-2-3', pattern: [3, 2, 3] },
  { label: '2-3-2', pattern: [2, 3, 2] },
  { label: '3-3-3', pattern: [3, 3, 3] },
  { label: '2-3-2-3-2', pattern: [2, 3, 2, 3, 2] },
  { label: '2-3-2-3', pattern: [2, 3, 2, 3] },
  { label: '2-3', pattern: [2, 3] },
  { label: '2-2-2-2', pattern: [2, 2, 2, 2] },
];

const YEAR_LABELS: Record<number, string> = {
  1: 'I Year (1st)',
  2: 'II Year (2nd)',
  3: 'III Year (3rd)',
  4: 'IV Year (4th)',
};

function yearRoman(yr: number): string {
  return yr === 1 ? 'I' : yr === 2 ? 'II' : yr === 3 ? 'III' : 'IV';
}

export function ScheduleStep({
  students,
  halls,
  sessions,
  activeSession,
  onSelectSession,
  onRefreshSessions,
  onNext,
}: ScheduleStepProps) {
  const activeHalls = halls.filter((h) => h.is_active);
  const availableBranches = useMemo(
    () =>
      [
        ...new Set([
          'CSE',
          'ECE',
          'EEE',
          'IT',
          'AIML',
          'MECH',
          'CIVIL',
          ...students.map((s) => s.branch),
        ]),
      ].sort(),
    [students]
  );

  const [subTab, setSubTab] = useState<'schedule' | 'timetable'>('schedule');

  // Catalogs fetched from server
  const [subjects, setSubjects] = useState<ScheduledSubject[]>([]);
  const [minorOptions, setMinorOptions] = useState<MinorStreamOption[]>([]);

  const allMinorNames = useMemo(
    () =>
      [
        ...new Set([
          ...minorOptions.map((m) => m.name),
          ...students.map((s) => s.minor_stream).filter((m) => m && m !== 'NONE'),
        ]),
      ].sort(),
    [minorOptions, students]
  );

  // Schedule form state
  const [examTitle, setExamTitle] = useState(
    activeSession?.exam_title || 'B.Tech II & III Year I Mid Internal Examinations'
  );
  const [department, setDepartment] = useState(
    activeSession?.department || 'Computer Science & Engineering'
  );
  const [examDate, setExamDate] = useState(activeSession?.exam_date || '2026-11-24');
  const [sessionSlot, setSessionSlot] = useState<SessionSlot>(activeSession?.session_slot || 'FN');
  const [sessionTiming, setSessionTiming] = useState(
    activeSession?.session_timing || '09:30 AM TO 12:00 PM'
  );
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<number[]>(
    activeSession?.selected_subject_ids || []
  );
  const [targetYears, setTargetYears] = useState<number[]>(activeSession?.target_years || [2, 3]);
  const [targetBranches, setTargetBranches] = useState<string[]>(
    activeSession?.target_branches || ['CSE']
  );
  const [seatingMode, setSeatingMode] = useState<SeatingMode>(
    activeSession?.seating_mode || 'INTERLEAVED'
  );
  const [interleaveStyle, setInterleaveStyle] = useState<InterleaveStyle>(
    activeSession?.layout_config?.interleave_style || 'ALTERNATE_SEATS'
  );
  const [roomPatterns, setRoomPatterns] = useState<Record<string, number[]>>(
    activeSession?.layout_config?.room_patterns || {}
  );
  const [minorFilter, setMinorFilter] = useState<string>(
    activeSession?.minor_stream_filter || 'Machine Intelligence'
  );
  const [selectedHallIds, setSelectedHallIds] = useState<number[]>(
    activeSession?.selected_hall_ids || []
  );
  const [subjectMapping, setSubjectMapping] = useState<Record<string, string>>(
    activeSession?.subject_mapping || {}
  );

  // Bhavan filtering
  const buildings = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of activeHalls) {
      map.set(h.building_code, h.building_name);
    }
    return Array.from(map.entries()).map(([code, name]) => ({ code, name }));
  }, [activeHalls]);

  const [selectedBhavans, setSelectedBhavans] = useState<string[]>([]);
  const [subjectDateFilter, setSubjectDateFilter] = useState<'MATCH_SLOT' | 'ALL'>('ALL');

  // Timetable creation / upload state
  const timetableInputRef = useRef<HTMLInputElement>(null);
  const [newSubjCode, setNewSubjCode] = useState('');
  const [newSubjName, setNewSubjName] = useState('');
  const [newSubjYear, setNewSubjYear] = useState(2);
  const [newSubjBranch, setNewSubjBranch] = useState('CSE');
  const [newSubjDate, setNewSubjDate] = useState(examDate);
  const [newSubjSlot, setNewSubjSlot] = useState<SessionSlot>('FN');
  const [uploadingTimetable, setUploadingTimetable] = useState(false);

  const [validation, setValidation] = useState<CapacityValidationResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [pendingDeleteSession, setPendingDeleteSession] = useState<ExamSession | null>(null);

  async function loadCatalogs() {
    try {
      const [subRows, minRows] = await Promise.all([
        apiFetch<ScheduledSubject[]>('/api/subjects'),
        apiFetch<MinorStreamOption[]>('/api/minor-streams'),
      ]);
      setSubjects(subRows);
      setMinorOptions(minRows);
    } catch {
      // ignore transient
    }
  }

  useEffect(() => {
    void loadCatalogs();
  }, []);

  useEffect(() => {
    if (buildings.length > 0 && selectedBhavans.length === 0) {
      const fromSelected = activeHalls
        .filter((h) => selectedHallIds.includes(h.id))
        .map((h) => h.building_code);
      setSelectedBhavans(
        fromSelected.length > 0 ? [...new Set(fromSelected)] : buildings.map((b) => b.code)
      );
    }
  }, [buildings.length]);

  useEffect(() => {
    if (activeSession) {
      setExamTitle(activeSession.exam_title);
      setDepartment(activeSession.department);
      setExamDate(activeSession.exam_date);
      setSessionSlot(activeSession.session_slot);
      setSessionTiming(activeSession.session_timing);
      setSelectedSubjectIds(activeSession.selected_subject_ids || []);
      setTargetYears(activeSession.target_years);
      setTargetBranches(activeSession.target_branches);
      setSeatingMode(activeSession.seating_mode);
      setInterleaveStyle(activeSession.layout_config?.interleave_style || 'ALTERNATE_SEATS');
      setRoomPatterns(activeSession.layout_config?.room_patterns || {});
      setMinorFilter(activeSession.minor_stream_filter || allMinorNames[0] || 'Machine Intelligence');
      setSelectedHallIds(activeSession.selected_hall_ids);
      setSubjectMapping(activeSession.subject_mapping || {});
    }
  }, [activeSession?.id]);

  const currentLayoutConfig: ExamLayoutConfig = useMemo(
    () => ({
      interleave_style: interleaveStyle,
      room_patterns: roomPatterns,
    }),
    [interleaveStyle, roomPatterns]
  );

  async function runCapacityCheck() {
    try {
      const res = await apiFetch<CapacityValidationResult>('/api/exams/validate-capacity', {
        method: 'POST',
        body: JSON.stringify({
          target_years: targetYears,
          target_branches: targetBranches,
          seating_mode: seatingMode,
          minor_stream_filter: seatingMode === 'MINOR_STREAM' ? minorFilter : null,
          selected_hall_ids: selectedHallIds,
          layout_config: currentLayoutConfig,
        }),
      });
      setValidation(res);
    } catch {
      // ignore transient
    }
  }

  useEffect(() => {
    void runCapacityCheck();
  }, [targetYears, targetBranches, seatingMode, minorFilter, selectedHallIds, currentLayoutConfig, students.length]);

  function applySubjectSelection(nextIds: number[]) {
    setSelectedSubjectIds(nextIds);
    const chosen = subjects.filter((s) => nextIds.includes(s.id));
    if (chosen.length === 0) return;

    const yrs = [...new Set(chosen.map((s) => s.academic_year))].sort();
    setTargetYears(yrs);

    const specificBranches = chosen.map((s) => s.branch).filter((b) => b && b !== 'ALL');
    if (specificBranches.length > 0) {
      setTargetBranches([...new Set(specificBranches)].sort());
    }

    // Build automatic subject mapping for each branch-year or YEAR_ROMAN
    const nextMap: Record<string, string> = { ...subjectMapping };
    for (const s of chosen) {
      const roman = yearRoman(s.academic_year);
      const label = `${s.course_code} - ${s.course_name}`;
      if (s.branch === 'ALL') {
        nextMap[`YEAR_${roman}`] = label;
        for (const br of targetBranches) {
          nextMap[`${br}-${roman}`] = label;
        }
      } else {
        nextMap[`${s.branch}-${roman}`] = label;
      }
    }
    setSubjectMapping(nextMap);

    // Sync exam date & slot from the primary selected subject
    setExamDate(chosen[0].exam_date);
    setSessionSlot(chosen[0].session_slot);
    setSessionTiming(
      chosen[0].session_slot === 'FN' ? '09:30 AM TO 12:00 PM' : '01:30 PM TO 04:00 PM'
    );

    // Suggest corner mode when only 1 year is selected
    if (yrs.length === 1 && seatingMode === 'INTERLEAVED') {
      setSeatingMode('SINGLE_YEAR_CORNERS');
    } else if (yrs.length >= 2 && seatingMode === 'SINGLE_YEAR_CORNERS') {
      setSeatingMode('INTERLEAVED');
    }
  }

  function toggleSubject(id: number) {
    const next = selectedSubjectIds.includes(id)
      ? selectedSubjectIds.filter((x) => x !== id)
      : [...selectedSubjectIds, id];
    applySubjectSelection(next);
  }

  function toggleYear(yr: number) {
    const next = targetYears.includes(yr)
      ? targetYears.filter((y) => y !== yr)
      : [...targetYears, yr].sort();
    setTargetYears(next);
  }

  function toggleBranch(br: string) {
    setTargetBranches((prev) =>
      prev.includes(br) ? prev.filter((b) => b !== br) : [...prev, br].sort()
    );
  }

  function toggleBhavan(code: string) {
    setSelectedBhavans((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  }

  function selectAllInBhavan(code: string) {
    const bhavanHallIds = activeHalls.filter((h) => h.building_code === code).map((h) => h.id);
    const allSelected = bhavanHallIds.every((id) => selectedHallIds.includes(id));
    if (allSelected) {
      setSelectedHallIds((prev) => prev.filter((id) => !bhavanHallIds.includes(id)));
    } else {
      setSelectedHallIds((prev) => [...new Set([...prev, ...bhavanHallIds])]);
    }
  }

  function toggleHall(id: number) {
    setSelectedHallIds((prev) => (prev.includes(id) ? prev.filter((h) => h !== id) : [...prev, id]));
  }

  function setRoomPatternOverride(hallId: number, pattern: number[]) {
    setRoomPatterns((prev) => ({
      ...prev,
      [String(hallId)]: pattern,
    }));
  }

  function handleSlotChange(slot: SessionSlot) {
    setSessionSlot(slot);
    setSessionTiming(slot === 'FN' ? '09:30 AM TO 12:00 PM' : '01:30 PM TO 04:00 PM');
  }

  async function handleSaveSession(createNew: boolean) {
    setSaving(true);
    setError('');
    setStatusMsg('');
    try {
      const payload = {
        exam_title: examTitle,
        department,
        exam_date: examDate,
        session_slot: sessionSlot,
        session_timing: sessionTiming,
        target_years: targetYears,
        target_branches: targetBranches,
        seating_mode: seatingMode,
        minor_stream_filter: seatingMode === 'MINOR_STREAM' ? minorFilter : null,
        subject_mapping: subjectMapping,
        selected_subject_ids: selectedSubjectIds,
        selected_hall_ids: selectedHallIds,
        layout_config: currentLayoutConfig,
      };

      let saved: ExamSession;
      if (!createNew && activeSession) {
        saved = await apiFetch<ExamSession>(`/api/exams/${activeSession.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload),
        });
        setStatusMsg(`Updated schedule "${saved.exam_title}".`);
      } else {
        saved = await apiFetch<ExamSession>('/api/exams', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setStatusMsg(`Created exam schedule "${saved.exam_title}".`);
      }
      await onRefreshSessions();
      onSelectSession(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteSession() {
    if (!pendingDeleteSession) return;
    try {
      await apiFetch(`/api/exams/${pendingDeleteSession.id}`, { method: 'DELETE' });
      const list = await onRefreshSessions();
      if (activeSession?.id === pendingDeleteSession.id && list.length > 0) {
        onSelectSession(list[0]);
      }
      setPendingDeleteSession(null);
    } catch (err) {
      setError((err as Error).message);
      setPendingDeleteSession(null);
    }
  }

  async function handleAddSubject(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setStatusMsg('');
    try {
      await apiFetch<ScheduledSubject>('/api/subjects', {
        method: 'POST',
        body: JSON.stringify({
          course_code: newSubjCode,
          course_name: newSubjName,
          academic_year: newSubjYear,
          branch: newSubjBranch,
          exam_date: newSubjDate,
          session_slot: newSubjSlot,
        }),
      });
      setNewSubjCode('');
      setNewSubjName('');
      await loadCatalogs();
      setStatusMsg('Scheduled subject added.');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleDeleteSubject(id: number) {
    try {
      await apiFetch(`/api/subjects/${id}`, { method: 'DELETE' });
      setSelectedSubjectIds((prev) => prev.filter((x) => x !== id));
      await loadCatalogs();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleTimetableUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingTimetable(true);
    setError('');
    setStatusMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('default_year', String(newSubjYear));
      const data = await apiFetch<{ imported?: number }>('/api/subjects/upload', {
        method: 'POST',
        body: formData,
      });
      await loadCatalogs();
      setStatusMsg(`Imported ${data.imported || 0} scheduled subjects from "${file.name}".`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploadingTimetable(false);
      if (timetableInputRef.current) timetableInputRef.current.value = '';
    }
  }

  const visibleSubjects = useMemo(() => {
    if (subjectDateFilter === 'ALL') return subjects;
    return subjects.filter((s) => s.exam_date === examDate && s.session_slot === sessionSlot);
  }, [subjects, subjectDateFilter, examDate, sessionSlot]);

  const subjectsByYear = useMemo(() => {
    const grouped = new Map<number, ScheduledSubject[]>();
    for (const s of visibleSubjects) {
      const list = grouped.get(s.academic_year) || [];
      list.push(s);
      grouped.set(s.academic_year, list);
    }
    return Array.from(grouped.entries()).sort((a, b) => a[0] - b[0]);
  }, [visibleSubjects]);

  const visibleHalls = useMemo(() => {
    if (selectedBhavans.length === 0) return activeHalls;
    return activeHalls.filter((h) => selectedBhavans.includes(h.building_code));
  }, [activeHalls, selectedBhavans]);

  const selectedHallsList = useMemo(
    () => activeHalls.filter((h) => selectedHallIds.includes(h.id)),
    [activeHalls, selectedHallIds]
  );

  const cohortKeys = targetYears
    .slice()
    .sort((a, b) => b - a)
    .flatMap((yr) => {
      const roman = yearRoman(yr);
      return targetBranches.map((br) => `${br}-${roman}`);
    });

  return (
    <div className="space-y-6">
      <ConfirmDialog
        open={pendingDeleteSession !== null}
        title="Delete Examination Schedule"
        description={`Delete schedule "${pendingDeleteSession?.exam_title}" and all its room allocations?`}
        confirmLabel="Delete Schedule"
        onConfirm={() => void confirmDeleteSession()}
        onCancel={() => setPendingDeleteSession(null)}
      />

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
            03. Subject Selection, Bhavan Rooms &amp; Schedule
          </h1>
          <div className="inline-flex border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900">
            <button
              type="button"
              onClick={() => setSubTab('schedule')}
              className={`px-3.5 py-1.5 text-xs font-medium cursor-pointer ${
                subTab === 'schedule'
                  ? 'bg-[#0b5299] text-white'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              Exam Schedule &amp; Subjects
            </button>
            <button
              type="button"
              onClick={() => setSubTab('timetable')}
              className={`px-3.5 py-1.5 text-xs font-medium border-l border-slate-300 dark:border-slate-700 cursor-pointer flex items-center gap-1.5 ${
                subTab === 'timetable'
                  ? 'bg-[#0b5299] text-white'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Scheduled Subjects Catalog ({subjects.length})</span>
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSaveSession(true)}
            className="flex items-center gap-1.5 px-4 py-2 min-h-[39px] text-xs font-medium border border-[#0b5299] text-[#0b5299] dark:text-sky-400 bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-none cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Save as New Exam</span>
          </button>
          {activeSession && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSaveSession(false)}
              className="px-4 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer whitespace-nowrap"
            >
              {saving ? 'Saving...' : 'Update Selected Exam'}
            </button>
          )}
          <button
            type="button"
            onClick={async () => {
              if (!activeSession) {
                await handleSaveSession(true);
              } else {
                await handleSaveSession(false);
              }
              onNext();
            }}
            className="flex items-center gap-1.5 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#cf6c38] hover:bg-[#b85a29] text-white rounded-none cursor-pointer whitespace-nowrap"
          >
            <span>Next: Seating Engine</span>
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

      {/* ==================== TIMETABLE / SUBJECTS SUB-TAB ==================== */}
      {subTab === 'timetable' && (
        <div className="space-y-6">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  University Examination Time Table (Scheduled Subjects)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Upload or add scheduled subjects per Academic Year, Branch, Date, and Session (FN/AN).
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    void downloadAuthorizedFile('/api/subjects/template-excel', 'aditya_timetable_template.xlsx')
                  }
                  className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:border-[#0b5299] rounded-none cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Download Timetable Template (.xlsx)</span>
                </button>
                <input
                  ref={timetableInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleTimetableUpload}
                  className="hidden"
                />
                <button
                  type="button"
                  disabled={uploadingTimetable}
                  onClick={() => timetableInputRef.current?.click()}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{uploadingTimetable ? 'Importing...' : 'Upload Time Table (.xlsx)'}</span>
                </button>
              </div>
            </div>

            <form onSubmit={handleAddSubject} className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Course Code
                </label>
                <input
                  type="text"
                  required
                  value={newSubjCode}
                  onChange={(e) => setNewSubjCode(e.target.value)}
                  placeholder="241CS007"
                  className="w-full px-3 py-2 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="md:col-span-3">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Course Name
                </label>
                <input
                  type="text"
                  required
                  value={newSubjName}
                  onChange={(e) => setNewSubjName(e.target.value)}
                  placeholder="Computer Networks"
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Academic Year
                </label>
                <select
                  value={newSubjYear}
                  onChange={(e) => setNewSubjYear(Number(e.target.value))}
                  className="w-full px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value={1}>Year 1 (I Year)</option>
                  <option value={2}>Year 2 (II Year)</option>
                  <option value={3}>Year 3 (III Year)</option>
                  <option value={4}>Year 4 (IV Year)</option>
                </select>
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Branch
                </label>
                <select
                  value={newSubjBranch}
                  onChange={(e) => setNewSubjBranch(e.target.value)}
                  className="w-full px-2 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="ALL">ALL</option>
                  {availableBranches.map((br) => (
                    <option key={br} value={br}>
                      {br}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Exam Date
                </label>
                <input
                  type="date"
                  required
                  value={newSubjDate}
                  onChange={(e) => setNewSubjDate(e.target.value)}
                  className="w-full px-2.5 py-2 text-xs font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div className="md:col-span-1">
                <label className="block text-[11px] font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Session
                </label>
                <select
                  value={newSubjSlot}
                  onChange={(e) => setNewSubjSlot(e.target.value as SessionSlot)}
                  className="w-full px-2 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                >
                  <option value="FN">FN</option>
                  <option value="AN">AN</option>
                </select>
              </div>
              <div className="md:col-span-1">
                <button
                  type="submit"
                  className="w-full py-2 text-xs font-medium bg-[#cf6c38] hover:bg-[#b85a29] text-white rounded-none cursor-pointer"
                >
                  Add
                </button>
              </div>
            </form>

            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-[#0b5299] text-white text-xs font-medium">
                    <th className="py-2.5 px-3 w-12">S.No</th>
                    <th className="py-2.5 px-3">Course Code</th>
                    <th className="py-2.5 px-3">Course Name</th>
                    <th className="py-2.5 px-3">Year</th>
                    <th className="py-2.5 px-3">Branch</th>
                    <th className="py-2.5 px-3">Session</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3 text-right">Remove</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {subjects.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 px-4 text-center text-slate-500">
                        No scheduled subjects added yet. Upload a timetable Excel sheet or add subjects above.
                      </td>
                    </tr>
                  ) : (
                    subjects.map((s, idx) => (
                      <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-mono-tabular">{idx + 1}</td>
                        <td className="py-2.5 px-3 font-mono-tabular font-semibold text-slate-900 dark:text-white">
                          {s.course_code}
                        </td>
                        <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">
                          {s.course_name}
                        </td>
                        <td className="py-2.5 px-3 font-medium">Year {s.academic_year}</td>
                        <td className="py-2.5 px-3 font-mono-tabular">{s.branch}</td>
                        <td className="py-2.5 px-3 font-mono-tabular">{s.session_slot}</td>
                        <td className="py-2.5 px-3 font-mono-tabular">{s.exam_date}</td>
                        <td className="py-2.5 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => void handleDeleteSubject(s.id)}
                            className="p-1 text-slate-400 hover:text-[#ff0000] cursor-pointer"
                            title="Delete Subject"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ==================== EXAM SCHEDULE & SELECTION ==================== */}
      {subTab === 'schedule' && (
        <>
          {sessions.length > 0 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-4">
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2.5">
                Saved Exam Schedules
              </p>
              <div className="flex flex-wrap gap-2">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`inline-flex items-center border ${
                      activeSession?.id === s.id
                        ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                        : 'border-slate-200 dark:border-slate-700 bg-[#f8f8f8] dark:bg-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(s)}
                      className="px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 cursor-pointer text-left"
                    >
                      <span>{s.exam_title}</span>
                      <span className="ml-2 font-mono-tabular text-[11px] text-slate-500 dark:text-slate-400">
                        ({s.exam_date} · {s.session_slot} · {s.status})
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteSession(s)}
                      title="Delete Schedule"
                      className="px-2 py-1.5 text-slate-400 hover:text-[#ff0000] border-l border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Select Scheduled Subjects (Multi-Year Individual Selection) */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
                  Step A. Select Subjects Scheduled Today (Per Academic Year)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Pick the exact exam subject(s) for 2nd Year, 3rd Year, etc. Selecting subjects automatically sets target cohorts and timetable labels.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSubjectDateFilter((p) => (p === 'ALL' ? 'MATCH_SLOT' : 'ALL'))
                  }
                  className="px-3 py-1.5 text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-none cursor-pointer"
                >
                  {subjectDateFilter === 'ALL'
                    ? 'Filter to Current Date & Slot'
                    : 'Show All Scheduled Dates'}
                </button>
                <button
                  type="button"
                  onClick={() => setSubTab('timetable')}
                  className="px-3 py-1.5 text-xs font-medium border border-[#0b5299] text-[#0b5299] dark:text-sky-400 rounded-none cursor-pointer"
                >
                  + Manage Timetable Subjects
                </button>
              </div>
            </div>

            {subjectsByYear.length === 0 ? (
              <div className="p-4 border border-dashed border-slate-300 dark:border-slate-700 text-xs text-slate-500 flex items-center justify-between">
                <span>
                  No scheduled subjects found for this filter. You can upload/add scheduled subjects in the catalog or select target years manually below.
                </span>
                <button
                  type="button"
                  onClick={() => setSubTab('timetable')}
                  className="px-3 py-1.5 bg-[#0b5299] text-white text-xs font-medium rounded-none cursor-pointer shrink-0 ml-3"
                >
                  Add Subjects
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {subjectsByYear.map(([yr, list]) => (
                  <div
                    key={yr}
                    className="border border-slate-200 dark:border-slate-700 bg-[#fafafa] dark:bg-slate-800/40 p-3.5 space-y-2"
                  >
                    <div className="text-xs font-semibold text-[#0b5299] dark:text-sky-400 pb-1.5 border-b border-slate-200 dark:border-slate-700">
                      {YEAR_LABELS[yr] || `Year ${yr}`}
                    </div>
                    <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1">
                      {list.map((subj) => {
                        const checked = selectedSubjectIds.includes(subj.id);
                        return (
                          <label
                            key={subj.id}
                            className={`flex items-start gap-2.5 p-2 border cursor-pointer text-xs ${
                              checked
                                ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleSubject(subj.id)}
                              className="accent-[#0b5299] mt-0.5"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-semibold text-slate-900 dark:text-white truncate">
                                <span className="font-mono-tabular text-[#0b5299] dark:text-sky-400">
                                  {subj.course_code}
                                </span>{' '}
                                · {subj.course_name}
                              </div>
                              <div className="text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400">
                                {subj.branch} · {subj.exam_date} · {subj.session_slot}
                              </div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Column: Exam Parameters & Seating Mode */}
            <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-5">
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white pb-3 border-b border-slate-200 dark:border-slate-800">
                Step B. Examination Metadata, Cohorts &amp; Arrangement Rules
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Examination Title
                  </label>
                  <input
                    type="text"
                    value={examTitle}
                    onChange={(e) => setExamTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Exam Date
                  </label>
                  <input
                    type="date"
                    value={examDate}
                    onChange={(e) => setExamDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Session Slot
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['FN', 'AN'] as SessionSlot[]).map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => handleSlotChange(slot)}
                        className={`py-2 text-xs font-medium border cursor-pointer ${
                          sessionSlot === slot
                            ? 'bg-[#0b5299] text-white border-[#0b5299]'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        {slot === 'FN' ? 'FN (Forenoon)' : 'AN (Afternoon)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Timing Window
                  </label>
                  <input
                    type="text"
                    value={sessionTiming}
                    onChange={(e) => setSessionTiming(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Target Academic Years
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3, 4].map((yr) => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => toggleYear(yr)}
                        className={`px-3 py-1.5 text-xs font-medium border cursor-pointer ${
                          targetYears.includes(yr)
                            ? 'bg-[#0b5299] text-white border-[#0b5299]'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        Year {yr}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                    Target Branches
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {availableBranches.map((br) => (
                      <button
                        key={br}
                        type="button"
                        onClick={() => toggleBranch(br)}
                        className={`px-3 py-1.5 text-xs font-medium border cursor-pointer ${
                          targetBranches.includes(br)
                            ? 'bg-[#0b5299] text-white border-[#0b5299]'
                            : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        {br}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-3">
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                  Seating Arrangement Strategy
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setSeatingMode('SINGLE_YEAR_CORNERS')}
                    className={`p-3 text-left border cursor-pointer ${
                      seatingMode === 'SINGLE_YEAR_CORNERS'
                        ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Single-Year Corner Seating
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      2 per bench in corners, middle seat left empty
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSeatingMode('INTERLEAVED')}
                    className={`p-3 text-left border cursor-pointer ${
                      seatingMode === 'INTERLEAVED'
                        ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Interleaved Multi-Cohort
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Mix 2+ years/branches by seats or bench blocks
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSeatingMode('SEQUENTIAL')}
                    className={`p-3 text-left border cursor-pointer ${
                      seatingMode === 'SEQUENTIAL'
                        ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Sequential Full Bench Fill
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Alphanumeric top-to-bottom across every seat
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSeatingMode('MINOR_STREAM')}
                    className={`p-3 text-left border cursor-pointer ${
                      seatingMode === 'MINOR_STREAM'
                        ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                        : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs font-semibold text-slate-900 dark:text-white">
                      Minor Stream Grouping
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Group selected Minor Stream students vertically
                    </div>
                  </button>
                </div>

                {seatingMode === 'INTERLEAVED' && (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 space-y-2">
                    <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Column Interleaving Style
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { id: 'ALTERNATE_SEATS', label: 'Alternate Seats (A-B-A / B-A-B)' },
                          { id: 'BENCH_BLOCKS', label: 'Alternating Benches (3-2-3 / 2-3-2)' },
                          { id: 'PAIRED_COLUMNS', label: 'Paired Columns (A-B | A-B)' },
                        ] as Array<{ id: InterleaveStyle; label: string }>
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setInterleaveStyle(opt.id)}
                          className={`px-3 py-1.5 text-xs font-medium border cursor-pointer ${
                            interleaveStyle === opt.id
                              ? 'bg-[#0b5299] text-white border-[#0b5299]'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {seatingMode === 'MINOR_STREAM' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                      Minor Stream Filter
                    </label>
                    <select
                      value={minorFilter}
                      onChange={(e) => setMinorFilter(e.target.value)}
                      className="px-3 py-2 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                    >
                      <option value="ALL">All Minor Stream Students</option>
                      {allMinorNames.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {cohortKeys.length > 0 && (
                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 space-y-2">
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">
                    Subject Labels per Cohort (Notice Board Summary)
                  </label>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {cohortKeys.map((key) => (
                      <div key={key}>
                        <label className="block text-[11px] font-mono-tabular text-slate-500 dark:text-slate-400 mb-1">
                          {key}
                        </label>
                        <input
                          type="text"
                          value={subjectMapping[key] || ''}
                          onChange={(e) =>
                            setSubjectMapping((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          placeholder="e.g. 241CS007 - Computer Networks"
                          className="w-full px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Right Column: Bhavan -> Rooms Picker + Per-Room Bench Layout + Validation */}
            <div className="lg:col-span-5 space-y-6">
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
                  <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-[#0b5299]" />
                    <span>Step C. Select Bhavan &amp; Rooms</span>
                  </h2>
                  <span className="font-mono-tabular text-xs text-[#0b5299] dark:text-sky-400 font-semibold">
                    {selectedHallIds.length} Selected
                  </span>
                </div>

                {/* Bhavan selector bar */}
                <div className="space-y-1.5">
                  <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                    Filter Bhavans
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {buildings.map((b) => {
                      const active = selectedBhavans.includes(b.code);
                      return (
                        <div key={b.code} className="inline-flex border border-slate-300 dark:border-slate-700">
                          <button
                            type="button"
                            onClick={() => toggleBhavan(b.code)}
                            className={`px-2.5 py-1 text-xs font-medium cursor-pointer ${
                              active
                                ? 'bg-[#0b5299] text-white'
                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            {b.code} ({b.name})
                          </button>
                          <button
                            type="button"
                            onClick={() => selectAllInBhavan(b.code)}
                            className="px-2 py-1 text-[10px] font-medium bg-slate-50 dark:bg-slate-900 text-[#0b5299] dark:text-sky-400 border-l border-slate-300 dark:border-slate-700 cursor-pointer"
                            title={`Toggle all rooms in ${b.code}`}
                          >
                            All
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2 max-h-[260px] overflow-y-auto pr-1">
                  {visibleHalls.map((h) => {
                    const checked = selectedHallIds.includes(h.id);
                    const effectivePattern = roomPatterns[String(h.id)] || h.bench_pattern;
                    const effectiveCols = effectivePattern.reduce((s, n) => s + n, 0);
                    return (
                      <label
                        key={h.id}
                        className={`flex items-center justify-between p-2.5 border cursor-pointer ${
                          checked
                            ? 'border-[#0b5299] bg-[#eef3f9] dark:bg-sky-950'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleHall(h.id)}
                            className="accent-[#0b5299]"
                          />
                          <div>
                            <div className="font-mono-tabular text-xs font-semibold text-slate-900 dark:text-white">
                              {h.room_no}{' '}
                              <span className="text-[10px] font-normal text-slate-500">
                                ({h.building_code} · {h.floor})
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {h.room_type} · Benches [{effectivePattern.join('-')}]
                            </div>
                          </div>
                        </div>
                        <div className="font-mono-tabular text-xs font-semibold text-slate-800 dark:text-slate-200">
                          {h.grid_rows * effectiveCols} seats
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Per-room layout pattern switcher (no common fixed template) */}
                {selectedHallsList.length > 0 && (
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                      Per-Room Bench Pattern (Optional Override for This Exam)
                    </div>
                    <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1">
                      {selectedHallsList.map((h) => {
                        const activePattern = (roomPatterns[String(h.id)] || h.bench_pattern).join('-');
                        return (
                          <div
                            key={h.id}
                            className="flex items-center justify-between gap-2 text-xs bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5 border border-slate-200 dark:border-slate-700"
                          >
                            <span className="font-mono-tabular font-semibold text-slate-800 dark:text-slate-200">
                              {h.room_no}
                            </span>
                            <select
                              value={activePattern}
                              onChange={(e) =>
                                setRoomPatternOverride(
                                  h.id,
                                  e.target.value.split('-').map((n) => Number(n))
                                )
                              }
                              className="px-2 py-1 text-[11px] font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
                            >
                              {!ROOM_PATTERN_PRESETS.some((p) => p.label === activePattern) && (
                                <option value={activePattern}>{activePattern}</option>
                              )}
                              {ROOM_PATTERN_PRESETS.map((p) => (
                                <option key={p.label} value={p.label}>
                                  {p.label} ({p.pattern.reduce((a, b) => a + b, 0) * h.grid_rows} seats)
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {validation && (
                <div
                  className={`bg-white dark:bg-slate-900 border rounded-[8px] p-5 space-y-3 ${
                    validation.valid
                      ? 'border-emerald-300 dark:border-emerald-800'
                      : 'border-amber-300 dark:border-amber-800'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    {validation.valid ? (
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    ) : (
                      <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-white">
                        Capacity Validation
                      </h3>
                      <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                        {validation.message}
                      </p>
                    </div>
                  </div>

                  {validation.cohort_breakdown.length > 0 && (
                    <div className="border-t border-slate-200 dark:border-slate-800 pt-3 space-y-2">
                      {validation.cohort_breakdown.map((b) => (
                        <div key={b.cohort_label} className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-800 dark:text-slate-200">
                            {b.cohort_label}
                          </span>
                          <span className="font-mono-tabular text-slate-700 dark:text-slate-300">
                            {b.student_count} students / {b.available_seats} seats
                            {b.deficit > 0 && (
                              <span className="text-[#ff0000] ml-1.5 font-semibold">(-{b.deficit})</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
