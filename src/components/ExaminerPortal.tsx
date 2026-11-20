import React, { useEffect, useState } from 'react';
import {
  Users,
  Building2,
  CalendarDays,
  Cpu,
  ClipboardCheck,
  FileOutput,
  GraduationCap,
} from 'lucide-react';
import { motion } from 'motion/react';
import { apiFetch } from '../lib/api.ts';
import type {
  ExamSession,
  Hall,
  HallAllocation,
  MasterSummaryRow,
  Student,
} from '../types/exam.ts';
import { StudentRosterStep } from './examiner/StudentRosterStep.tsx';
import { HallConfiguratorStep } from './examiner/HallConfiguratorStep.tsx';
import { ScheduleStep } from './examiner/ScheduleStep.tsx';
import { SeatingEngineStep } from './examiner/SeatingEngineStep.tsx';
import { WillingnessStep } from './examiner/WillingnessStep.tsx';
import { PreviewExportStep } from './examiner/PreviewExportStep.tsx';
import { YearPromotionStep } from './examiner/YearPromotionStep.tsx';

type ExaminerStep = 1 | 2 | 3 | 4 | 5 | 6 | 7;

const STEPS: Array<{
  id: ExaminerStep;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 1, label: '01. Student & Minor Roster', short: 'Students', icon: Users },
  { id: 2, label: '02. Hall & Lab Configurator', short: 'Halls', icon: Building2 },
  { id: 3, label: '03. Exam Schedule & Cohorts', short: 'Schedule', icon: CalendarDays },
  { id: 4, label: '04. Seating Algorithm Engine', short: 'Engine', icon: Cpu },
  { id: 5, label: '05. Invigilation Willingness', short: 'Invigilators', icon: ClipboardCheck },
  { id: 6, label: '06. Grid Preview & PDF Export', short: 'Export PDF', icon: FileOutput },
  { id: 7, label: '07. Year Promotion', short: 'Promotions', icon: GraduationCap },
];

interface ExaminerPortalProps {
  globalSearch?: string;
}

export function ExaminerPortal({ globalSearch = '' }: ExaminerPortalProps) {
  const [step, setStep] = useState<ExaminerStep>(1);
  const [students, setStudents] = useState<Student[]>([]);
  const [halls, setHalls] = useState<Hall[]>([]);
  const [sessions, setSessions] = useState<ExamSession[]>([]);
  const [activeSession, setActiveSession] = useState<ExamSession | null>(null);
  const [allocations, setAllocations] = useState<HallAllocation[]>([]);
  const [summaryRows, setSummaryRows] = useState<MasterSummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function refreshStudents() {
    const data = await apiFetch<Student[]>('/api/students');
    setStudents(data);
  }

  async function refreshHalls() {
    const data = await apiFetch<Hall[]>('/api/halls');
    setHalls(data);
  }

  async function refreshSessions(): Promise<ExamSession[]> {
    const data = await apiFetch<ExamSession[]>('/api/exams');
    setSessions(data);
    return data;
  }

  async function loadAllocationsForSession(sessionId: number) {
    const res = await apiFetch<{
      session: ExamSession;
      allocations: HallAllocation[];
      summary_rows: MasterSummaryRow[];
    }>(`/api/exams/${sessionId}/allocations`);
    setActiveSession(res.session);
    setAllocations(res.allocations);
    setSummaryRows(res.summary_rows);
  }

  useEffect(() => {
    async function init() {
      setLoading(true);
      try {
        const [st, hl, ex] = await Promise.all([
          apiFetch<Student[]>('/api/students'),
          apiFetch<Hall[]>('/api/halls'),
          apiFetch<ExamSession[]>('/api/exams'),
        ]);
        setStudents(st);
        setHalls(hl);
        setSessions(ex);
        if (ex.length > 0) {
          await loadAllocationsForSession(ex[0].id);
        }
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, []);

  function handleSelectSession(session: ExamSession) {
    setActiveSession(session);
    void loadAllocationsForSession(session.id);
  }

  return (
    <div className="flex flex-col lg:flex-row min-h-[calc(100vh-120px)]">
      {/* Left Workspace Workflow Sidebar */}
      <aside className="no-print lg:w-64 shrink-0 bg-white dark:bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 p-4">
        <div className="mb-4 px-2">
          <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">
            Examiner Workflow
          </p>
          {activeSession && (
            <p
              className="text-xs font-medium text-[#0b5299] dark:text-sky-400 mt-1 truncate"
              title={activeSession.exam_title}
            >
              {activeSession.exam_title}
            </p>
          )}
        </div>
        <nav className="flex lg:flex-col gap-1 overflow-x-auto">
          {STEPS.map((item) => {
            const Icon = item.icon;
            const active = step === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setStep(item.id)}
                className={`flex items-center gap-3 px-3 py-2.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  active
                    ? 'bg-[#0b5299] text-white'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="hidden lg:inline">{item.label}</span>
                <span className="lg:hidden">{item.short}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Viewport */}
      <main id="main-content" className="flex-1 p-6 lg:p-8 max-w-[1320px]">
        {loading ? (
          <div className="space-y-4">
            <div className="h-20 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] animate-pulse" />
            <div className="h-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] animate-pulse" />
          </div>
        ) : (
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 1 && (
              <StudentRosterStep
                students={students}
                onRefresh={refreshStudents}
                onNext={() => setStep(2)}
                globalSearch={globalSearch}
              />
            )}
            {step === 2 && (
              <HallConfiguratorStep
                halls={halls}
                onRefresh={refreshHalls}
                onNext={() => setStep(3)}
              />
            )}
            {step === 3 && (
              <ScheduleStep
                students={students}
                halls={halls}
                sessions={sessions}
                activeSession={activeSession}
                onSelectSession={handleSelectSession}
                onRefreshSessions={refreshSessions}
                onNext={() => setStep(4)}
              />
            )}
            {step === 4 && (
              <SeatingEngineStep
                activeSession={activeSession}
                allocations={allocations}
                onAllocationsUpdated={(sess, allocs, rows) => {
                  setActiveSession(sess);
                  setAllocations(allocs);
                  setSummaryRows(rows);
                  void refreshSessions();
                }}
                onNext={() => setStep(5)}
              />
            )}
            {step === 5 && (
              <WillingnessStep
                activeSession={activeSession}
                allocations={allocations}
                onRefreshAllocations={async () => {
                  if (activeSession) await loadAllocationsForSession(activeSession.id);
                }}
                onNext={() => setStep(6)}
              />
            )}
            {step === 6 && (
              <PreviewExportStep
                activeSession={activeSession}
                allocations={allocations}
                summaryRows={summaryRows}
              />
            )}
            {step === 7 && (
              <YearPromotionStep
                students={students}
                onRefresh={refreshStudents}
              />
            )}
          </motion.div>
        )}
      </main>
    </div>
  );
}
