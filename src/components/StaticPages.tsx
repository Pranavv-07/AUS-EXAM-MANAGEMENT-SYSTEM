import React, { useMemo, useState } from 'react';
import { ChevronDown, Copy, Check, Mail, Phone, ArrowLeft } from 'lucide-react';
import { apiFetch } from '../lib/api.ts';

interface PageNavProps {
  onNavigate: (path: string) => void;
}

const FAQ_ITEMS = [
  {
    q: 'How does 54-seat Classroom interleaving work when two years write exams together?',
    a: 'Each 6×9 classroom contains 3 bench columns of 3 sub-seats each. Bench Group 1 and 3 place [Higher Year | Lower Year | Higher Year], while Bench Group 2 places [Lower Year | Higher Year | Lower Year], yielding 30 seats for the primary cohort and 24 seats for the secondary cohort.',
  },
  {
    q: 'How does 72-seat Laboratory seating arrange paired columns?',
    a: 'Laboratories configured at 9×8 pair two columns side-by-side across 4 lab columns, assigning 36 seats to Cohort A and 36 seats to Cohort B vertically from row 1 to row 9.',
  },
  {
    q: 'How are Minor Stream students (MI / SAP) seated?',
    a: 'When Minor Stream mode is selected, eligible students enrolled in the chosen minor stream are filtered, sorted by roll number, and queued vertically down their designated columns one behind the other.',
  },
  {
    q: 'What Excel columns are supported for student roster uploads?',
    a: 'The importer supports .xlsx, .xls, and .csv files containing roll_no, full_name, branch, current_year, batch_code, minor_stream, and is_detained. You can download a blank column template directly inside Step 1.',
  },
];

export function AboutPage({ onNavigate }: PageNavProps) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-8 space-y-4">
        <p className="text-xs font-medium text-[#0b5299] dark:text-sky-400">
          INSTITUTIONAL PORTAL OVERVIEW
        </p>
        <h1 className="font-display text-3xl font-medium text-slate-900 dark:text-white">
          About the Examination Seating &amp; Scheduling System
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          Built for Aditya University, Surampalem, this portal standardizes examination hall configuration,
          student cohort management, deterministic seating matrix generation, invigilation willingness
          rostering, and print-ready official statement output.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Last updated: November 18, 2026
        </p>
      </div>

      {/* Expandable FAQ */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-8 space-y-4">
        <h2 className="font-display text-xl font-medium text-slate-900 dark:text-white">
          Frequently Asked Questions
        </h2>
        <div className="divide-y divide-slate-200 dark:divide-slate-800 border-t border-b border-slate-200 dark:border-slate-800">
          {FAQ_ITEMS.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div key={idx}>
                <button
                  type="button"
                  onClick={() => setOpenIdx(isOpen ? null : idx)}
                  aria-expanded={isOpen}
                  className="w-full py-4 flex items-center justify-between gap-4 text-left text-sm font-medium text-slate-900 dark:text-slate-100 cursor-pointer"
                >
                  <span>{item.q}</span>
                  <ChevronDown
                    className={`w-4 h-4 shrink-0 transition-transform ${
                      isOpen ? 'rotate-180 text-[#0b5299] dark:text-sky-400' : 'text-slate-400'
                    }`}
                  />
                </button>
                {isOpen && (
                  <p className="pb-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                    {item.a}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-2 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Portal</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function PrivacyPolicyPage({ onNavigate }: PageNavProps) {
  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-8 space-y-5">
        <p className="text-xs font-medium text-[#0b5299] dark:text-sky-400">
          DATA GOVERNANCE &amp; SECURITY
        </p>
        <h1 className="font-display text-3xl font-medium text-slate-900 dark:text-white">
          Privacy Policy
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Last updated: November 18, 2026
        </p>

        <div className="space-y-4 text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
          <section className="space-y-1.5">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              1. Institutional Purpose
            </h2>
            <p>
              Student roll numbers, names, academic years, minor stream enrollments, and faculty
              invigilation records entered into this portal are processed strictly for examination
              seating allocation, attendance verification, and official University documentation.
            </p>
          </section>

          <section className="space-y-1.5">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              2. Role-Based Access &amp; Audit Trail
            </h2>
            <p>
              Access is restricted to authenticated Administrators and Examination Coordinators.
              All database mutations, student Excel uploads, cohort promotions, and PDF exports are
              logged with timestamps and operator identifiers for institutional accountability.
            </p>
          </section>

          <section className="space-y-1.5">
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-white">
              3. Essential Browser Storage
            </h2>
            <p>
              This application stores only essential session tokens, display theme preferences, and
              cookie notice acknowledgments locally in your browser. No third-party advertising
              trackers are used.
            </p>
          </section>
        </div>

        <div className="pt-2">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-2 px-5 py-2 min-h-[39px] text-xs font-medium bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Return to Portal</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export function ContactPage({ onNavigate }: PageNavProps) {
  const [senderName, setSenderName] = useState('');
  const [senderEmail, setSenderEmail] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [website, setWebsite] = useState(''); // Honeypot
  const [humanAnswer, setHumanAnswer] = useState('');
  const [copiedEmail, setCopiedEmail] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  // Simple deterministic human check challenge
  const challenge = useMemo(() => ({ a: 7, b: 4, expected: 11 }), []);

  function copySupportEmail() {
    void navigator.clipboard.writeText('examcell@adityauniversity.in');
    setCopiedEmail(true);
    setTimeout(() => setCopiedEmail(false), 2000);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');
    setSuccessMsg('');
    try {
      const utmSource = sessionStorage.getItem('au_utm_source') || '';
      const res = await apiFetch<{ message: string }>('/api/contact', {
        method: 'POST',
        body: JSON.stringify({
          sender_name: senderName,
          sender_email: senderEmail,
          subject,
          message,
          website,
          human_answer: humanAnswer,
          human_expected: challenge.expected,
          utm_source: utmSource,
        }),
      });
      setSuccessMsg(res.message);
      setSenderName('');
      setSenderEmail('');
      setSubject('');
      setMessage('');
      setHumanAnswer('');
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-5">
          <div>
            <p className="text-xs font-medium text-[#0b5299] dark:text-sky-400">
              EXAMINATION CELL HELPDESK
            </p>
            <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white mt-1">
              Contact Support
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 mt-2 leading-relaxed">
              Report portal issues, seating discrepancies, or account access requests directly to the
              Aditya University Examination Cell.
            </p>
          </div>

          <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-sm">
            <div className="flex items-center justify-between gap-2">
              <a
                href="mailto:examcell@adityauniversity.in"
                className="inline-flex items-center gap-2 text-[#0b5299] dark:text-sky-400 underline break-all"
              >
                <Mail className="w-4 h-4 shrink-0" />
                <span>examcell@adityauniversity.in</span>
              </a>
              <button
                type="button"
                onClick={copySupportEmail}
                title="Copy support email"
                className="p-1.5 border border-slate-200 dark:border-slate-700 hover:border-[#0b5299] text-slate-600 dark:text-slate-300 cursor-pointer shrink-0"
              >
                {copiedEmail ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>

            <div>
              <a
                href="tel:+918842391111"
                className="inline-flex items-center gap-2 text-[#0b5299] dark:text-sky-400 underline"
              >
                <Phone className="w-4 h-4 shrink-0" />
                <span>+91 884 239 1111</span>
              </a>
            </div>
          </div>

          <div className="space-y-1.5 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300">
            <p className="font-semibold text-slate-900 dark:text-white">
              Developer Contact
            </p>
            <p>Pranav Vedula</p>
            <a
              href="mailto:vedulapranav@gmail.com"
              className="inline-flex items-center gap-1.5 text-[#0b5299] dark:text-sky-400 underline break-all"
            >
              <Mail className="w-3.5 h-3.5 shrink-0" />
              <span>vedulapranav@gmail.com</span>
            </a>
          </div>

          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-2 px-4 py-2 min-h-[39px] text-xs font-medium border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-none cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Back to Portal</span>
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="md:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-6 space-y-4"
        >
          <h2 className="font-display text-lg font-medium text-slate-900 dark:text-white">
            Submit Error Report or Inquiry
          </h2>

          {successMsg && (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 text-xs font-medium text-emerald-800 dark:text-emerald-200">
              {successMsg}
            </div>
          )}
          {errorMsg && (
            <div className="p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-xs font-medium text-[#ff0000]">
              {errorMsg}
            </div>
          )}

          {/* Honeypot field hidden from human users */}
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            className="hidden"
            aria-hidden="true"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Your Name
              </label>
              <input
                type="text"
                required
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                Institutional Email
              </label>
              <input
                type="email"
                required
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Subject
            </label>
            <input
              type="text"
              required
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Message / Error Details
            </label>
            <textarea
              required
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
              Spam Protection: What is {challenge.a} + {challenge.b}?
            </label>
            <input
              type="number"
              required
              value={humanAnswer}
              onChange={(e) => setHumanAnswer(e.target.value)}
              className="w-36 px-3 py-2 text-sm font-mono-tabular border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:border-[#0b5299]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="px-6 py-2 min-h-[39px] text-sm font-normal bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
          >
            {submitting ? 'Submitting...' : 'Send Inquiry'}
          </button>
        </form>
      </div>
    </div>
  );
}

export function NotFoundPage({ onNavigate }: PageNavProps) {
  return (
    <div className="max-w-xl mx-auto px-6 py-20 text-center">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[8px] p-10 space-y-4">
        <p className="font-mono-tabular text-4xl font-semibold text-[#0b5299] dark:text-sky-400">
          404
        </p>
        <h1 className="font-display text-2xl font-medium text-slate-900 dark:text-white">
          Page Not Found
        </h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          The requested Examination Cell route does not exist or has moved.
        </p>
        <div className="pt-2">
          <button
            type="button"
            onClick={() => onNavigate('/')}
            className="inline-flex items-center gap-2 px-6 py-2 min-h-[39px] text-sm font-normal bg-[#0b5299] hover:bg-[#003a77] text-white rounded-none cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Return to Home</span>
          </button>
        </div>
      </div>
    </div>
  );
}
