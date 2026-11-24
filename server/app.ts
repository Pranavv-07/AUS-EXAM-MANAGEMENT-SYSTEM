import 'dotenv/config';
import express, { Request, Response, NextFunction, RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import * as XLSX from 'xlsx';
import {
  execute,
  initDatabase,
  isDatabaseConfigured,
  logAudit,
  queryAll,
  queryOne,
  withTransaction,
} from './db.ts';
import {
  allocateSeatingMatrices,
  buildDispatchSummary,
  buildMasterSummaryRows,
  compareRollNo,
  filterStudentsForSession,
  getCohortLabel,
  validateSessionCapacity,
} from './seating.ts';
import {
  buildCourseEligibilityTemplateWorkbook,
  buildStudentTemplateWorkbook,
  buildTimetableTemplateWorkbook,
  buildWillingnessTemplateWorkbook,
  normalizeExamDate,
  parseAndValidateWillingnessWorkbook,
} from './excel.ts';
import {
  generateAttendancePdfBuffer,
  generateBundlePdfBuffer,
  generateDispatchPdfBuffer,
  generateMasterPdfBuffer,
  generateProformaPdfBuffer,
  generateRoomsPdfBuffer,
} from './pdf.ts';
import type {
  CourseEligibilityRecord,
  CourseEligibilityStatus,
  EligibilityStatus,
  ExamLayoutConfig,
  ExamSession,
  Hall,
  HallAllocation,
  SeatCell,
  SeatingMode,
  SessionSlot,
  Student,
  UserRole,
} from '../src/types/exam.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'aditya-university-exam-cell-secret-2026';

let dbInitPromise: Promise<void> | null = null;

export async function ensureDatabaseReady(): Promise<void> {
  if (!isDatabaseConfigured()) {
    throw new Error(
      'DATABASE_URL environment variable is not configured. Add DATABASE_URL in Vercel Project Settings -> Environment Variables and redeploy.'
    );
  }
  if (!dbInitPromise) {
    dbInitPromise = initDatabase().catch((err) => {
      dbInitPromise = null;
      throw err;
    });
  }
  await dbInitPromise;
}

interface AuthPayload {
  id: number;
  username: string;
  full_name: string;
  emp_id: string;
  department: string;
  role: UserRole;
}

interface AuthedRequest extends Request {
  user?: AuthPayload;
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

function safe(
  fn: (req: AuthedRequest, res: Response, next: NextFunction) => unknown
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as AuthedRequest, res, next)).catch(next);
  };
}

async function authenticateToken(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    const dbUser = await queryOne<AuthPayload & { is_active: number }>(
      'SELECT id, username, full_name, emp_id, department, role, is_active FROM users WHERE id = $1',
      [decoded.id]
    );

    if (!dbUser || !dbUser.is_active) {
      res.status(401).json({ error: 'Account inactive or not found' });
      return;
    }
    req.user = {
      id: dbUser.id,
      username: dbUser.username,
      full_name: dbUser.full_name,
      emp_id: dbUser.emp_id,
      department: dbUser.department,
      role: dbUser.role,
    };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired session token' });
  }
}

function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Administrator privileges required' });
    return;
  }
  next();
}

function normalizeEligibilityStatus(raw: unknown, legacyDetained?: unknown): EligibilityStatus {
  const s = String(raw ?? '').trim().toUpperCase();
  if (s === 'DETAINED') return 'DETAINED';
  if (s === 'CONDONATION_PENDING' || s === 'HOLD' || s === 'VERIFICATION_HOLD') {
    return 'CONDONATION_PENDING';
  }
  if (s === 'ELIGIBLE') return 'ELIGIBLE';
  return legacyDetained ? 'DETAINED' : 'ELIGIBLE';
}

function mapStudentRow(row: Record<string, unknown>): Student {
  const elig = normalizeEligibilityStatus(row.eligibility_status, row.is_detained);
  return {
    id: Number(row.id),
    roll_no: String(row.roll_no),
    full_name: String(row.full_name),
    branch: String(row.branch),
    current_year: Number(row.current_year),
    batch_code: String(row.batch_code),
    minor_stream: String(row.minor_stream),
    is_detained: Boolean(row.is_detained) || elig === 'DETAINED',
    eligibility_status: elig,
    is_pwd: Boolean(row.is_pwd),
    created_at: String(row.created_at),
  };
}

function mapCourseEligibilityRow(row: Record<string, unknown>): CourseEligibilityRecord {
  return {
    id: Number(row.id),
    roll_no: String(row.roll_no),
    course_code: String(row.course_code),
    status: String(row.status) as CourseEligibilityStatus,
    remarks: String(row.remarks || ''),
    updated_at: String(row.updated_at),
  };
}

async function resolveSessionCourseCodes(
  selectedSubjectIds: number[],
  subjectMapping: Record<string, string>
): Promise<string[]> {
  const codes = new Set<string>();
  if (Array.isArray(selectedSubjectIds) && selectedSubjectIds.length > 0) {
    const subjRows = await queryAll<{ course_code: string }>(
      'SELECT course_code FROM scheduled_subjects WHERE id = ANY($1::int[])',
      [selectedSubjectIds]
    );
    for (const r of subjRows) {
      if (r.course_code) codes.add(String(r.course_code).trim().toUpperCase());
    }
  }
  for (const val of Object.values(subjectMapping || {})) {
    const firstToken = String(val || '').trim().split(/\s+-\s+|\s+/)[0] || '';
    if (/^[A-Z0-9]{4,14}$/i.test(firstToken) && /\d/.test(firstToken)) {
      codes.add(firstToken.toUpperCase());
    }
  }
  return Array.from(codes);
}

function parseBenchPattern(raw: unknown, fallbackCols: number, fallbackBenchCap: number): number[] {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((n) => Math.max(1, Math.min(4, Number(n) || 1)));
    }
  } catch {
    // fallback below
  }
  const cap = Math.max(1, fallbackBenchCap || 3);
  const out: number[] = [];
  let rem = fallbackCols;
  while (rem > 0) {
    const chunk = Math.min(cap, rem);
    out.push(chunk);
    rem -= chunk;
  }
  return out.length > 0 ? out : [3, 3, 3];
}

function mapHallRow(row: Record<string, unknown>): Hall {
  const gridCols = Number(row.grid_cols);
  const benchCap = Number(row.bench_capacity);
  return {
    id: Number(row.id),
    building_code: String(row.building_code),
    building_name: String(row.building_name),
    floor: String(row.floor),
    room_no: String(row.room_no),
    room_type: row.room_type as 'CLASSROOM' | 'LAB',
    grid_rows: Number(row.grid_rows),
    grid_cols: gridCols,
    bench_capacity: benchCap,
    bench_pattern: parseBenchPattern(row.bench_pattern, gridCols, benchCap),
    total_capacity: Number(row.total_capacity),
    is_active: Boolean(row.is_active),
  };
}

function mapExamSessionRow(row: Record<string, unknown>): ExamSession {
  return {
    id: Number(row.id),
    exam_title: String(row.exam_title),
    department: String(row.department),
    exam_date: String(row.exam_date),
    session_slot: row.session_slot as SessionSlot,
    session_timing: String(row.session_timing),
    target_years: JSON.parse(String(row.target_years || '[]')),
    target_branches: JSON.parse(String(row.target_branches || '[]')),
    seating_mode: row.seating_mode as SeatingMode,
    minor_stream_filter: row.minor_stream_filter ? String(row.minor_stream_filter) : null,
    subject_mapping: JSON.parse(String(row.subject_mapping || '{}')),
    selected_subject_ids: JSON.parse(String(row.selected_subject_ids || '[]')),
    selected_hall_ids: JSON.parse(String(row.selected_hall_ids || '[]')),
    layout_config: JSON.parse(String(row.layout_config || '{}')) as ExamLayoutConfig,
    status: row.status as 'DRAFT' | 'ALLOCATED' | 'FINALIZED',
    created_by: Number(row.created_by),
    created_at: String(row.created_at),
  };
}

async function loadSessionAllocations(examSessionId: number): Promise<{
  session: ExamSession | null;
  allocations: HallAllocation[];
}> {
  const sessionRow = await queryOne<Record<string, unknown>>(
    'SELECT * FROM exam_sessions WHERE id = $1',
    [examSessionId]
  );
  if (!sessionRow) return { session: null, allocations: [] };

  const session = mapExamSessionRow(sessionRow);
  const allocRows = await queryAll<Record<string, unknown>>(
    `SELECT ha.*, h.building_code, h.building_name, h.floor, h.room_no, h.room_type,
            h.grid_rows, h.grid_cols, h.bench_capacity, h.bench_pattern, h.total_capacity, h.is_active
     FROM hall_allocations ha
     JOIN halls h ON h.id = ha.hall_id
     WHERE ha.exam_session_id = $1
     ORDER BY ha.sort_order ASC`,
    [examSessionId]
  );

  if (allocRows.length === 0) {
    return { session, allocations: [] };
  }

  const allocIds = allocRows.map((ar) => Number(ar.id));
  const allCells = await queryAll<Record<string, unknown>>(
    `SELECT * FROM seat_cells WHERE allocation_id = ANY($1::int[]) ORDER BY allocation_id ASC, row_index ASC, col_index ASC`,
    [allocIds]
  );

  const cellsByAlloc = new Map<number, SeatCell[]>();
  for (const cr of allCells) {
    const aid = Number(cr.allocation_id);
    const list = cellsByAlloc.get(aid) || [];
    list.push({
      id: Number(cr.id),
      allocation_id: aid,
      row_index: Number(cr.row_index),
      col_index: Number(cr.col_index),
      bench_group: Number(cr.bench_group),
      sub_seat_index: Number(cr.sub_seat_index),
      cohort_label: String(cr.cohort_label),
      student_id: cr.student_id ? Number(cr.student_id) : null,
      roll_no_snapshot: cr.roll_no_snapshot ? String(cr.roll_no_snapshot) : null,
    });
    cellsByAlloc.set(aid, list);
  }

  const allocations: HallAllocation[] = allocRows.map((ar) => {
    const aid = Number(ar.id);
    const cells = cellsByAlloc.get(aid) || [];

    const cohortCounts: Record<string, number> = {};
    for (const c of cells) {
      if (c.roll_no_snapshot) {
        cohortCounts[c.cohort_label] = (cohortCounts[c.cohort_label] || 0) + 1;
      }
    }

    const gCols = Number(ar.grid_cols);
    const bCap = Number(ar.bench_capacity);
    return {
      id: aid,
      exam_session_id: Number(ar.exam_session_id),
      hall_id: Number(ar.hall_id),
      sort_order: Number(ar.sort_order),
      allocated_count: Number(ar.allocated_count),
      invigilator_1_name: String(ar.invigilator_1_name || ''),
      invigilator_1_emp_id: String(ar.invigilator_1_emp_id || ''),
      invigilator_1_willing: Boolean(ar.invigilator_1_willing),
      invigilator_2_name: String(ar.invigilator_2_name || ''),
      invigilator_2_emp_id: String(ar.invigilator_2_emp_id || ''),
      invigilator_2_willing: Boolean(ar.invigilator_2_willing),
      column_headers: JSON.parse(String(ar.column_headers || '[]')),
      hall: {
        id: Number(ar.hall_id),
        building_code: String(ar.building_code),
        building_name: String(ar.building_name),
        floor: String(ar.floor),
        room_no: String(ar.room_no),
        room_type: ar.room_type as 'CLASSROOM' | 'LAB',
        grid_rows: Number(ar.grid_rows),
        grid_cols: gCols,
        bench_capacity: bCap,
        bench_pattern: parseBenchPattern(ar.bench_pattern, gCols, bCap),
        total_capacity: Number(ar.total_capacity),
        is_active: Boolean(ar.is_active),
      },
      cells,
      cohort_counts: cohortCounts,
    };
  });

  return { session, allocations };
}

// In-memory rate limiter for spam & brute-force protection
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = rateLimitBuckets.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (entry.count >= maxRequests) {
    return false;
  }
  entry.count += 1;
  return true;
}

export function createApiApp(): express.Express {
  const app = express();
  app.set('trust proxy', 1);

  // Force HTTPS in production behind reverse proxy + baseline security headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    const host = req.headers.host || '';
    const isLocal = host.startsWith('localhost') || host.startsWith('127.0.0.1');
    const proto = req.headers['x-forwarded-proto'];
    if (process.env.NODE_ENV === 'production' && !isLocal && proto === 'http' && host) {
      res.redirect(301, `https://${host}${req.originalUrl}`);
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (process.env.NODE_ENV === 'production' && !isLocal) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      databaseConfigured: isDatabaseConfigured(),
      runtime: process.env.VERCEL ? 'vercel' : 'node',
    });
  });

  // Ensure DB schema & default accounts exist before serving any /api route
  app.use(
    '/api',
    safe(async (req: AuthedRequest, res: Response, next: NextFunction) => {
      if (req.path === '/health') {
        next();
        return;
      }
      if (!isDatabaseConfigured()) {
        res.status(503).json({
          error:
            'Database is not configured on the server. Set DATABASE_URL in Vercel Project Settings -> Environment Variables and redeploy.',
        });
        return;
      }
      await ensureDatabaseReady();
      next();
    })
  );

  // ==================== AUTH ROUTES ====================
  app.post(
    '/api/auth/login',
    safe(async (req: Request, res: Response) => {
      const ip = req.ip || 'unknown';
      if (!checkRateLimit(`login:${ip}`, 15, 10 * 60 * 1000)) {
        res.status(429).json({
          error: 'Too many login attempts. Please wait a few minutes and try again.',
        });
        return;
      }

      const { username, password, website, utm_source } = req.body as {
        username?: string;
        password?: string;
        website?: string;
        utm_source?: string;
      };

      if (website && website.trim() !== '') {
        res.status(400).json({ error: 'Automated submission rejected.' });
        return;
      }

      if (!username || !password) {
        res.status(400).json({ error: 'Username and password are required' });
        return;
      }

      const userRow = await queryOne<{
        id: number;
        username: string;
        password_hash: string;
        full_name: string;
        emp_id: string;
        department: string;
        role: UserRole;
        is_active: number;
      }>('SELECT * FROM users WHERE username = $1', [username.trim()]);

      if (!userRow || !bcrypt.compareSync(password, userRow.password_hash)) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
      }

      if (!userRow.is_active) {
        res.status(403).json({ error: 'Account has been deactivated by Administrator' });
        return;
      }

      const payload: AuthPayload = {
        id: userRow.id,
        username: userRow.username,
        full_name: userRow.full_name,
        emp_id: userRow.emp_id,
        department: userRow.department,
        role: userRow.role,
      };

      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
      await logAudit(
        userRow.id,
        userRow.username,
        userRow.role,
        'USER_LOGIN',
        `Authenticated into ${userRow.role} portal${utm_source ? ` (source: ${utm_source})` : ''}`
      );
      res.json({ token, user: payload });
    })
  );

  // ==================== PUBLIC CONTACT / SUPPORT ROUTE ====================
  app.post(
    '/api/contact',
    safe(async (req: Request, res: Response) => {
      const ip = req.ip || 'unknown';
      if (!checkRateLimit(`contact:${ip}`, 5, 15 * 60 * 1000)) {
        res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
        return;
      }

      const {
        sender_name,
        sender_email,
        subject,
        message,
        website,
        human_answer,
        human_expected,
        utm_source,
      } = req.body as {
        sender_name?: string;
        sender_email?: string;
        subject?: string;
        message?: string;
        website?: string;
        human_answer?: string;
        human_expected?: number;
        utm_source?: string;
      };

      if (website && website.trim() !== '') {
        res.status(400).json({ error: 'Automated submission rejected.' });
        return;
      }

      if (typeof human_expected !== 'number' || Number(human_answer) !== human_expected) {
        res.status(400).json({ error: 'Human verification answer is incorrect.' });
        return;
      }

      if (!sender_name?.trim() || !sender_email?.trim() || !subject?.trim() || !message?.trim()) {
        res.status(400).json({ error: 'All fields are required.' });
        return;
      }

      await execute(
        `INSERT INTO contact_inquiries (sender_name, sender_email, subject, message, utm_source) VALUES ($1, $2, $3, $4, $5)`,
        [
          sender_name.trim(),
          sender_email.trim(),
          subject.trim(),
          message.trim(),
          (utm_source || '').trim(),
        ]
      );

      await logAudit(
        null,
        sender_email.trim(),
        'VISITOR',
        'SUPPORT_INQUIRY',
        `Submitted support inquiry: "${subject.trim()}"`
      );

      res.status(201).json({ success: true, message: 'Inquiry recorded by the Examination Cell.' });
    })
  );

  app.get('/api/auth/me', safe(authenticateToken), (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  // ==================== ADMIN ROUTES ====================
  app.get(
    '/api/admin/users',
    safe(authenticateToken),
    requireAdmin,
    safe(async (_req: AuthedRequest, res: Response) => {
      const rows = await queryAll<Record<string, unknown>>(
        'SELECT id, username, full_name, emp_id, department, role, is_active, created_at FROM users ORDER BY id ASC'
      );
      res.json(
        rows.map((r) => ({
          ...r,
          is_active: Boolean(r.is_active),
        }))
      );
    })
  );

  app.post(
    '/api/admin/users',
    safe(authenticateToken),
    requireAdmin,
    safe(async (req: AuthedRequest, res: Response) => {
      const { username, password, full_name, emp_id, department, role } = req.body as {
        username: string;
        password: string;
        full_name: string;
        emp_id: string;
        department?: string;
        role?: UserRole;
      };

      if (!username || !password || !full_name || !emp_id) {
        res.status(400).json({ error: 'Username, password, full name, and employee ID are required' });
        return;
      }

      const existing = await queryOne('SELECT id FROM users WHERE username = $1', [username.trim()]);
      if (existing) {
        res.status(409).json({ error: 'Username already exists' });
        return;
      }

      const hash = bcrypt.hashSync(password, 10);
      const { rows } = await execute(
        `INSERT INTO users (username, password_hash, full_name, emp_id, department, role, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, 1)
         RETURNING id, username, full_name, emp_id, department, role, is_active, created_at`,
        [
          username.trim(),
          hash,
          full_name.trim(),
          emp_id.trim(),
          (department || 'Computer Science & Engineering').trim(),
          role === 'ADMIN' ? 'ADMIN' : 'EXAMINER',
        ]
      );

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'CREATE_ACCOUNT',
        `Created ${role || 'EXAMINER'} account "${username.trim()}" (${emp_id.trim()})`
      );

      const created = rows[0];
      res.status(201).json({ ...created, is_active: Boolean(created.is_active) });
    })
  );

  app.put(
    '/api/admin/users/:id',
    safe(authenticateToken),
    requireAdmin,
    safe(async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const { full_name, emp_id, department, role, is_active, password } = req.body as {
        full_name?: string;
        emp_id?: string;
        department?: string;
        role?: UserRole;
        is_active?: boolean;
        password?: string;
      };

      const existing = await queryOne<Record<string, unknown>>('SELECT * FROM users WHERE id = $1', [
        id,
      ]);
      if (!existing) {
        res.status(404).json({ error: 'User not found' });
        return;
      }

      if (id === req.user!.id && is_active === false) {
        res.status(400).json({ error: 'Cannot deactivate your own active admin session' });
        return;
      }

      const nextHash =
        password && password.trim()
          ? bcrypt.hashSync(password.trim(), 10)
          : String(existing.password_hash);
      const { rows } = await execute(
        `UPDATE users SET full_name = $1, emp_id = $2, department = $3, role = $4, is_active = $5, password_hash = $6
         WHERE id = $7
         RETURNING id, username, full_name, emp_id, department, role, is_active, created_at`,
        [
          full_name?.trim() ?? String(existing.full_name),
          emp_id?.trim() ?? String(existing.emp_id),
          department?.trim() ?? String(existing.department),
          role ?? String(existing.role),
          is_active === undefined ? Number(existing.is_active) : is_active ? 1 : 0,
          nextHash,
          id,
        ]
      );

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'UPDATE_ACCOUNT',
        `Updated account "${String(existing.username)}"`
      );

      const updated = rows[0];
      res.json({ ...updated, is_active: Boolean(updated.is_active) });
    })
  );

  app.delete(
    '/api/admin/users/:id',
    safe(authenticateToken),
    requireAdmin,
    safe(async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      if (id === req.user!.id) {
        res.status(400).json({ error: 'Cannot delete your own account' });
        return;
      }
      const existing = await queryOne<{ username: string }>(
        'SELECT username FROM users WHERE id = $1',
        [id]
      );
      if (!existing) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      await execute('DELETE FROM users WHERE id = $1', [id]);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'DELETE_ACCOUNT',
        `Deleted account "${existing.username}"`
      );
      res.json({ success: true });
    })
  );

  app.get(
    '/api/admin/audit-logs',
    safe(authenticateToken),
    requireAdmin,
    safe(async (req: AuthedRequest, res: Response) => {
      const actionFilter = typeof req.query.action === 'string' ? req.query.action : '';
      const logs = actionFilter
        ? await queryAll('SELECT * FROM audit_logs WHERE action_type = $1 ORDER BY id DESC LIMIT 250', [
            actionFilter,
          ])
        : await queryAll('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 250');
      res.json(logs);
    })
  );

  app.get(
    '/api/admin/analytics',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const [
        totalStudentsRow,
        activeStudentsRow,
        totalHallsRow,
        totalSeatCapRow,
        totalExamSessionsRow,
        totalExaminersRow,
        studentsByYear,
        studentsByBranch,
        studentsByMinor,
        recentRows,
      ] = await Promise.all([
        queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM students'),
        queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM students WHERE is_detained = 0'),
        queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM halls WHERE is_active = 1'),
        queryOne<{ s: number }>(
          'SELECT COALESCE(SUM(total_capacity), 0)::int AS s FROM halls WHERE is_active = 1'
        ),
        queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM exam_sessions'),
        queryOne<{ c: number }>(
          "SELECT COUNT(*)::int AS c FROM users WHERE role = 'EXAMINER' AND is_active = 1"
        ),
        queryAll(
          'SELECT current_year AS year, COUNT(*)::int AS count FROM students WHERE is_detained = 0 GROUP BY current_year ORDER BY current_year ASC'
        ),
        queryAll(
          'SELECT branch, COUNT(*)::int AS count FROM students WHERE is_detained = 0 GROUP BY branch ORDER BY count DESC'
        ),
        queryAll(
          'SELECT minor_stream, COUNT(*)::int AS count FROM students WHERE is_detained = 0 GROUP BY minor_stream ORDER BY count DESC'
        ),
        queryAll<Record<string, unknown>>('SELECT * FROM exam_sessions ORDER BY id DESC LIMIT 10'),
      ]);

      const totalStudents = totalStudentsRow?.c ?? 0;
      const activeStudents = activeStudentsRow?.c ?? 0;

      res.json({
        total_students: totalStudents,
        active_students: activeStudents,
        detained_students: totalStudents - activeStudents,
        total_halls: totalHallsRow?.c ?? 0,
        total_seat_capacity: totalSeatCapRow?.s ?? 0,
        total_exam_sessions: totalExamSessionsRow?.c ?? 0,
        total_examiners: totalExaminersRow?.c ?? 0,
        students_by_year: studentsByYear,
        students_by_branch: studentsByBranch,
        students_by_minor: studentsByMinor,
        recent_sessions: recentRows.map(mapExamSessionRow),
      });
    })
  );

  // ==================== STUDENT & COHORT ROUTES ====================
  app.get(
    '/api/students',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const rows = await queryAll<Record<string, unknown>>('SELECT * FROM students');
      const mapped = rows.map(mapStudentRow).sort((a, b) => compareRollNo(a.roll_no, b.roll_no));
      res.json(mapped);
    })
  );

  app.post(
    '/api/students',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const {
        roll_no,
        full_name,
        branch,
        current_year,
        batch_code,
        minor_stream,
        is_detained,
        eligibility_status,
        is_pwd,
      } = req.body as Partial<Student>;
      if (!roll_no || !full_name || !branch || !current_year) {
        res.status(400).json({ error: 'Roll number, full name, branch, and year are required' });
        return;
      }

      const cleanRoll = roll_no.trim().toUpperCase();
      const existing = await queryOne('SELECT id FROM students WHERE roll_no = $1', [cleanRoll]);
      if (existing) {
        res.status(409).json({ error: `Student with Roll No ${cleanRoll} already exists` });
        return;
      }

      const cleanMinor = (minor_stream || '').trim();
      const normalizedMinor = cleanMinor.toUpperCase() === 'NONE' || !cleanMinor ? '' : cleanMinor;
      const eligStatus = normalizeEligibilityStatus(eligibility_status, is_detained);
      const detainedFlag = eligStatus === 'DETAINED' ? 1 : 0;

      const { rows } = await execute(
        `INSERT INTO students (roll_no, full_name, branch, current_year, batch_code, minor_stream, is_detained, eligibility_status, is_pwd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          cleanRoll,
          full_name.trim(),
          branch.trim().toUpperCase(),
          Number(current_year),
          (batch_code || '2025-2029').trim(),
          normalizedMinor,
          detainedFlag,
          eligStatus,
          is_pwd ? 1 : 0,
        ]
      );

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'ADD_STUDENT',
        `Added student ${cleanRoll} (${branch}, ${eligStatus})`
      );
      res.status(201).json(mapStudentRow(rows[0]));
    })
  );

  app.put(
    '/api/students/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const existing = await queryOne<Record<string, unknown>>('SELECT * FROM students WHERE id = $1', [
        id,
      ]);
      if (!existing) {
        res.status(404).json({ error: 'Student not found' });
        return;
      }

      const {
        roll_no,
        full_name,
        branch,
        current_year,
        batch_code,
        minor_stream,
        is_detained,
        eligibility_status,
        is_pwd,
      } = req.body as Partial<Student>;
      const nextMinor =
        minor_stream !== undefined
          ? minor_stream.trim().toUpperCase() === 'NONE' || !minor_stream.trim()
            ? ''
            : minor_stream.trim()
          : String(existing.minor_stream || '');

      const nextElig =
        eligibility_status !== undefined
          ? normalizeEligibilityStatus(eligibility_status, is_detained)
          : is_detained !== undefined
            ? is_detained
              ? 'DETAINED'
              : 'ELIGIBLE'
            : normalizeEligibilityStatus(existing.eligibility_status, existing.is_detained);
      const nextDetained = nextElig === 'DETAINED' ? 1 : 0;

      const { rows } = await execute(
        `UPDATE students SET roll_no = $1, full_name = $2, branch = $3, current_year = $4, batch_code = $5,
          minor_stream = $6, is_detained = $7, eligibility_status = $8, is_pwd = $9
         WHERE id = $10 RETURNING *`,
        [
          roll_no ? roll_no.trim().toUpperCase() : String(existing.roll_no),
          full_name ? full_name.trim() : String(existing.full_name),
          branch ? branch.trim().toUpperCase() : String(existing.branch),
          current_year !== undefined ? Number(current_year) : Number(existing.current_year),
          batch_code ? batch_code.trim() : String(existing.batch_code),
          nextMinor,
          nextDetained,
          nextElig,
          is_pwd !== undefined ? (is_pwd ? 1 : 0) : Number(existing.is_pwd || 0),
          id,
        ]
      );

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'UPDATE_STUDENT',
        `Updated student ${roll_no || String(existing.roll_no)} (${nextElig})`
      );

      res.json(mapStudentRow(rows[0]));
    })
  );

  app.delete(
    '/api/students/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const existing = await queryOne<{ roll_no: string }>('SELECT roll_no FROM students WHERE id = $1', [
        id,
      ]);
      if (!existing) {
        res.status(404).json({ error: 'Student not found' });
        return;
      }
      await execute('DELETE FROM students WHERE id = $1', [id]);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'DELETE_STUDENT',
        `Removed student ${existing.roll_no}`
      );
      res.json({ success: true });
    })
  );

  app.get(
    '/api/students/sample-excel',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const customBranches =
        typeof req.query.branches === 'string' && req.query.branches.trim()
          ? req.query.branches
              .split(',')
              .map((b) => b.trim().toUpperCase())
              .filter(Boolean)
          : ['CSE', 'ECE', 'EEE', 'IT', 'AIML', 'MECH', 'CIVIL'];

      const dbMinors = (
        await queryAll<{ name: string }>('SELECT name FROM minor_stream_options ORDER BY name ASC')
      ).map((r) => r.name);

      const customMinors =
        typeof req.query.minors === 'string' && req.query.minors.trim()
          ? req.query.minors
              .split(',')
              .map((m) => m.trim())
              .filter(Boolean)
          : dbMinors;

      const buf = await buildStudentTemplateWorkbook({
        branches: customBranches,
        minorStreams: customMinors,
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="aditya_students_template.xlsx"');
      res.send(buf);
    })
  );

  app.post(
    '/api/students/upload',
    safe(authenticateToken),
    upload.single('file'),
    safe(async (req: AuthedRequest, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: 'Excel file is required' });
        return;
      }

      try {
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheet = workbook.SheetNames[0];
        if (!firstSheet) {
          res.status(400).json({ error: 'Excel workbook has no sheets' });
          return;
        }

        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
          workbook.Sheets[firstSheet],
          { defval: '' }
        );

        if (rawRows.length === 0) {
          res.status(400).json({ error: 'Uploaded sheet is empty' });
          return;
        }

        const firstKeys = Object.keys(rawRows[0] || {}).map((k) =>
          k.toLowerCase().replace(/[^a-z0-9]/g, '')
        );
        const hasRollKey = firstKeys.some((k) =>
          ['rollno', 'htno', 'hallticket', 'regno'].includes(k)
        );
        if (!hasRollKey) {
          res.status(400).json({
            error:
              'Invalid template format: Missing "roll_no" column header. Download and use the official Student Roster template.',
          });
          return;
        }

        let insertedOrUpdated = 0;
        let skipped = 0;
        const rowsToUpsert: Array<{
          rollNo: string;
          fullName: string;
          branch: string;
          currentYear: number;
          batchCode: string;
          minorStream: string;
          isDetained: number;
          eligibilityStatus: EligibilityStatus;
          isPwd: number;
        }> = [];
        const dedupedByRoll = new Map<string, number>();

        for (const raw of rawRows) {
          const norm: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) {
            norm[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(v ?? '').trim();
          }

          const rollNo = (norm.rollno || norm.htno || norm.hallticket || norm.regno || '').toUpperCase();
          if (!rollNo) {
            skipped++;
            continue;
          }

          const fullName = norm.fullname || norm.name || norm.studentname || `Student ${rollNo}`;
          const branch = (norm.branch || norm.dept || norm.department || 'CSE').toUpperCase();
          const yearParsed = parseInt(norm.currentyear || norm.year || '2', 10);
          const currentYear = Number.isNaN(yearParsed) ? 2 : Math.min(4, Math.max(1, yearParsed));
          const batchCode = norm.batchcode || norm.batch || '2025-2029';
          const rawMinor = (norm.minorstream || norm.minor || '').trim();
          const minorStream = rawMinor.toUpperCase() === 'NONE' || !rawMinor ? '' : rawMinor;
          const detainedRaw = (norm.isdetained || norm.detained || 'NO').toLowerCase();
          const legacyDetained = ['1', 'true', 'yes', 'y'].includes(detainedRaw);
          const eligibilityStatus = normalizeEligibilityStatus(
            norm.eligibilitystatus || norm.eligibility || norm.status || '',
            legacyDetained
          );
          const isDetained = eligibilityStatus === 'DETAINED' ? 1 : 0;
          const pwdRaw = (norm.ispwd || norm.pwd || 'NO').toLowerCase();
          const isPwd = ['1', 'true', 'yes', 'y'].includes(pwdRaw) ? 1 : 0;

          const item = {
            rollNo,
            fullName,
            branch,
            currentYear,
            batchCode,
            minorStream,
            isDetained,
            eligibilityStatus,
            isPwd,
          };
          if (dedupedByRoll.has(rollNo)) {
            rowsToUpsert[dedupedByRoll.get(rollNo)!] = item;
          } else {
            dedupedByRoll.set(rollNo, rowsToUpsert.length);
            rowsToUpsert.push(item);
          }
          insertedOrUpdated++;
        }

        if (rowsToUpsert.length > 0) {
          await withTransaction(async (client) => {
            const CHUNK = 180;
            for (let i = 0; i < rowsToUpsert.length; i += CHUNK) {
              const slice = rowsToUpsert.slice(i, i + CHUNK);
              const values: unknown[] = [];
              const placeholders = slice
                .map((row, idx) => {
                  const base = idx * 9;
                  values.push(
                    row.rollNo,
                    row.fullName,
                    row.branch,
                    row.currentYear,
                    row.batchCode,
                    row.minorStream,
                    row.isDetained,
                    row.eligibilityStatus,
                    row.isPwd
                  );
                  return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
                })
                .join(', ');

              await client.query(
                `INSERT INTO students (roll_no, full_name, branch, current_year, batch_code, minor_stream, is_detained, eligibility_status, is_pwd)
                 VALUES ${placeholders}
                 ON CONFLICT(roll_no) DO UPDATE SET
                   full_name = excluded.full_name,
                   branch = excluded.branch,
                   current_year = excluded.current_year,
                   batch_code = excluded.batch_code,
                   minor_stream = excluded.minor_stream,
                   is_detained = excluded.is_detained,
                   eligibility_status = excluded.eligibility_status,
                   is_pwd = excluded.is_pwd`,
                values
              );
            }
          });
        }

        await logAudit(
          req.user!.id,
          req.user!.username,
          req.user!.role,
          'UPLOAD_EXCEL',
          `Uploaded "${req.file.originalname}": ${insertedOrUpdated} students upserted, ${skipped} skipped`
        );

        res.json({
          success: true,
          processed: insertedOrUpdated,
          skipped,
          filename: req.file.originalname,
        });
      } catch (err) {
        res.status(400).json({ error: `Failed to parse Excel file: ${(err as Error).message}` });
      }
    })
  );

  // ==================== COURSE-SPECIFIC ELIGIBILITY ROUTES ====================
  app.get(
    '/api/course-eligibility',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const rows = await queryAll<Record<string, unknown>>(
        'SELECT * FROM course_eligibility ORDER BY course_code ASC, roll_no ASC'
      );
      res.json(rows.map(mapCourseEligibilityRow));
    })
  );

  app.post(
    '/api/course-eligibility',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const { roll_no, course_code, status, remarks } = req.body as {
        roll_no?: string;
        course_code?: string;
        status?: CourseEligibilityStatus;
        remarks?: string;
      };

      if (!roll_no?.trim() || !course_code?.trim()) {
        res.status(400).json({ error: 'Roll No and Course Code are required' });
        return;
      }

      const cleanRoll = roll_no.trim().toUpperCase();
      const cleanCourse = course_code.trim().toUpperCase();
      const validStatuses: CourseEligibilityStatus[] = [
        'ELIGIBLE',
        'CONDONATION_PENDING',
        'DETAINED',
        'SUPPLEMENTARY',
      ];
      const cleanStatus: CourseEligibilityStatus = validStatuses.includes(
        String(status || '').toUpperCase() as CourseEligibilityStatus
      )
        ? (String(status).toUpperCase() as CourseEligibilityStatus)
        : 'DETAINED';

      const { rows } = await execute(
        `INSERT INTO course_eligibility (roll_no, course_code, status, remarks)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (roll_no, course_code) DO UPDATE SET
           status = excluded.status,
           remarks = excluded.remarks,
           updated_at = NOW()
         RETURNING *`,
        [cleanRoll, cleanCourse, cleanStatus, (remarks || '').trim()]
      );

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'UPSERT_COURSE_ELIGIBILITY',
        `Set ${cleanRoll} in ${cleanCourse} as ${cleanStatus}`
      );

      res.status(201).json(mapCourseEligibilityRow(rows[0]));
    })
  );

  app.delete(
    '/api/course-eligibility/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      await execute('DELETE FROM course_eligibility WHERE id = $1', [Number(req.params.id)]);
      res.json({ success: true });
    })
  );

  app.get(
    '/api/course-eligibility/template-excel',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const buf = await buildCourseEligibilityTemplateWorkbook();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        'attachment; filename="aditya_course_eligibility_template.xlsx"'
      );
      res.send(buf);
    })
  );

  app.post(
    '/api/course-eligibility/upload',
    safe(authenticateToken),
    upload.single('file'),
    safe(async (req: AuthedRequest, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: 'Course Eligibility Excel file is required' });
        return;
      }
      try {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) {
          res.status(400).json({ error: 'Excel workbook contains no sheets' });
          return;
        }
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
          defval: '',
        });
        if (rawRows.length === 0) {
          res.status(400).json({ error: 'Uploaded sheet is empty' });
          return;
        }

        const firstKeys = Object.keys(rawRows[0] || {}).map((k) =>
          k.toLowerCase().replace(/[^a-z0-9]/g, '')
        );
        if (!firstKeys.some((k) => k.includes('roll')) || !firstKeys.some((k) => k.includes('course'))) {
          res.status(400).json({
            error: 'Invalid template format: Missing "roll_no" and "course_code" columns.',
          });
          return;
        }

        const validStatuses = new Set(['ELIGIBLE', 'CONDONATION_PENDING', 'DETAINED', 'SUPPLEMENTARY']);
        const deduped = new Map<
          string,
          { rollNo: string; courseCode: string; status: string; remarks: string }
        >();
        let skipped = 0;

        for (const raw of rawRows) {
          const norm: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) {
            norm[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(v ?? '').trim();
          }
          const rollNo = (norm.rollno || norm.htno || '').toUpperCase();
          const courseCode = (norm.coursecode || norm.subjectcode || '').toUpperCase();
          const status = (norm.status || norm.eligibilitystatus || 'DETAINED').toUpperCase();
          const remarks = norm.remarks || '';
          if (!rollNo || !courseCode || !validStatuses.has(status)) {
            skipped++;
            continue;
          }
          deduped.set(`${rollNo}::${courseCode}`, { rollNo, courseCode, status, remarks });
        }

        const records = Array.from(deduped.values());
        if (records.length > 0) {
          await withTransaction(async (client) => {
            const CHUNK = 200;
            for (let i = 0; i < records.length; i += CHUNK) {
              const slice = records.slice(i, i + CHUNK);
              const values: unknown[] = [];
              const placeholders = slice
                .map((r, idx) => {
                  const base = idx * 4;
                  values.push(r.rollNo, r.courseCode, r.status, r.remarks);
                  return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
                })
                .join(', ');
              await client.query(
                `INSERT INTO course_eligibility (roll_no, course_code, status, remarks)
                 VALUES ${placeholders}
                 ON CONFLICT (roll_no, course_code) DO UPDATE SET
                   status = excluded.status,
                   remarks = excluded.remarks,
                   updated_at = NOW()`,
                values
              );
            }
          });
        }

        await logAudit(
          req.user!.id,
          req.user!.username,
          req.user!.role,
          'UPLOAD_COURSE_ELIGIBILITY',
          `Imported ${records.length} course-level eligibility mappings from "${req.file.originalname}"`
        );

        res.json({ success: true, processed: records.length, skipped });
      } catch (err) {
        res.status(400).json({ error: `Failed to parse file: ${(err as Error).message}` });
      }
    })
  );

  // ==================== MINOR STREAM CATALOG ROUTES ====================
  app.get(
    '/api/minor-streams',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const rows = await queryAll('SELECT * FROM minor_stream_options ORDER BY branch ASC, name ASC');
      res.json(rows);
    })
  );

  app.post(
    '/api/minor-streams',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const { branch, name, code } = req.body as { branch?: string; name?: string; code?: string };
      if (!name?.trim() || !code?.trim()) {
        res.status(400).json({ error: 'Minor stream name and code are required' });
        return;
      }
      const existing = await queryOne(
        'SELECT id FROM minor_stream_options WHERE LOWER(name) = LOWER($1)',
        [name.trim()]
      );
      if (existing) {
        res.status(409).json({ error: `Minor stream "${name.trim()}" already exists` });
        return;
      }
      const { rows } = await execute(
        'INSERT INTO minor_stream_options (branch, name, code) VALUES ($1, $2, $3) RETURNING *',
        [(branch || 'ALL').trim().toUpperCase(), name.trim(), code.trim().toUpperCase()]
      );
      res.status(201).json(rows[0]);
    })
  );

  app.delete(
    '/api/minor-streams/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      await execute('DELETE FROM minor_stream_options WHERE id = $1', [Number(req.params.id)]);
      res.json({ success: true });
    })
  );

  // ==================== SCHEDULED SUBJECTS / TIMETABLE ROUTES ====================
  app.get(
    '/api/subjects',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const rows = await queryAll(
        'SELECT * FROM scheduled_subjects ORDER BY exam_date ASC, session_slot ASC, academic_year ASC, course_code ASC'
      );
      res.json(rows);
    })
  );

  app.post(
    '/api/subjects',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const { course_code, course_name, academic_year, branch, exam_date, session_slot } = req.body as {
        course_code?: string;
        course_name?: string;
        academic_year?: number;
        branch?: string;
        exam_date?: string;
        session_slot?: SessionSlot;
      };
      if (!course_code?.trim() || !course_name?.trim() || !exam_date?.trim() || !session_slot) {
        res
          .status(400)
          .json({ error: 'Course code, course name, exam date, and session (FN/AN) are required' });
        return;
      }
      const yr = Math.min(4, Math.max(1, Number(academic_year) || 2));
      const { rows } = await execute(
        `INSERT INTO scheduled_subjects (course_code, course_name, academic_year, branch, exam_date, session_slot)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          course_code.trim().toUpperCase(),
          course_name.trim(),
          yr,
          (branch || 'ALL').trim().toUpperCase(),
          normalizeExamDate(exam_date) || exam_date.trim(),
          session_slot === 'AN' ? 'AN' : 'FN',
        ]
      );
      res.status(201).json(rows[0]);
    })
  );

  app.delete(
    '/api/subjects/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      await execute('DELETE FROM scheduled_subjects WHERE id = $1', [Number(req.params.id)]);
      res.json({ success: true });
    })
  );

  app.get(
    '/api/subjects/template-excel',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const buf = await buildTimetableTemplateWorkbook([
        'CSE',
        'ECE',
        'EEE',
        'IT',
        'AIML',
        'MECH',
        'CIVIL',
      ]);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="aditya_timetable_template.xlsx"');
      res.send(buf);
    })
  );

  app.post(
    '/api/subjects/upload',
    safe(authenticateToken),
    upload.single('file'),
    safe(async (req: AuthedRequest, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: 'Timetable Excel file is required' });
        return;
      }
      try {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const firstSheet = wb.SheetNames[0];
        if (!firstSheet) {
          res.status(400).json({ error: 'Workbook contains no sheets' });
          return;
        }
        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], {
          defval: '',
        });
        if (rawRows.length === 0) {
          res.status(400).json({ error: 'Uploaded timetable sheet is empty' });
          return;
        }

        const firstKeys = Object.keys(rawRows[0] || {}).map((k) =>
          k.toLowerCase().replace(/[^a-z0-9]/g, '')
        );
        if (
          !firstKeys.some((k) => k.includes('coursecode')) ||
          !firstKeys.some((k) => k.includes('coursename'))
        ) {
          res.status(400).json({
            error: 'Invalid timetable template: Missing "Course Code" and "Course Name" column headers.',
          });
          return;
        }

        const fallbackYear = Math.min(4, Math.max(1, Number(req.body?.default_year) || 2));
        const parsedSubjects: Array<[string, string, number, string, string, SessionSlot]> = [];
        let lastDate = new Date().toISOString().slice(0, 10);
        let lastSlot: SessionSlot = 'FN';

        for (const raw of rawRows) {
          const norm: Record<string, string> = {};
          for (const [k, v] of Object.entries(raw)) {
            norm[k.toLowerCase().replace(/[^a-z0-9]/g, '')] = String(v ?? '').trim();
          }

          const code = (norm.coursecode || '').toUpperCase();
          const name = norm.coursename || '';
          if (!code || !name) continue;

          const dateRaw = norm.dateday || norm.date || norm.examdate || norm.dateddmmyyyy || '';
          const parsedDate = normalizeExamDate(dateRaw);
          if (parsedDate) lastDate = parsedDate;

          const slotRaw = (norm.session || norm.slot || '').toUpperCase();
          if (slotRaw === 'FN' || slotRaw === 'AN') lastSlot = slotRaw;

          const yrParsed = parseInt(norm.academicyear || norm.year || '', 10);
          const yr = Number.isNaN(yrParsed) ? fallbackYear : Math.min(4, Math.max(1, yrParsed));
          const branch = (norm.branch || 'ALL').toUpperCase();

          parsedSubjects.push([code, name, yr, branch, lastDate, lastSlot]);
        }

        if (parsedSubjects.length > 0) {
          await withTransaction(async (client) => {
            const values: unknown[] = [];
            const placeholders = parsedSubjects
              .map((row, idx) => {
                const base = idx * 6;
                values.push(...row);
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`;
              })
              .join(', ');
            await client.query(
              `INSERT INTO scheduled_subjects (course_code, course_name, academic_year, branch, exam_date, session_slot)
               VALUES ${placeholders}`,
              values
            );
          });
        }

        await logAudit(
          req.user!.id,
          req.user!.username,
          req.user!.role,
          'UPLOAD_TIMETABLE',
          `Imported ${parsedSubjects.length} scheduled subjects from "${req.file.originalname}"`
        );
        res.json({ success: true, imported: parsedSubjects.length });
      } catch (err) {
        res.status(400).json({ error: `Failed to parse timetable: ${(err as Error).message}` });
      }
    })
  );

  app.post(
    '/api/students/promote-year',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const { from_year, branch } = req.body as { from_year: number; branch?: string };
      const yr = Number(from_year);
      if (![1, 2, 3].includes(yr)) {
        res.status(400).json({ error: 'Can promote cohorts from Year 1, 2, or 3 only' });
        return;
      }

      const toYear = yr + 1;
      let changes = 0;
      if (branch && branch !== 'ALL') {
        const info = await execute(
          'UPDATE students SET current_year = $1 WHERE current_year = $2 AND branch = $3 AND is_detained = 0',
          [toYear, yr, branch.toUpperCase()]
        );
        changes = info.rowCount;
      } else {
        const info = await execute(
          'UPDATE students SET current_year = $1 WHERE current_year = $2 AND is_detained = 0',
          [toYear, yr]
        );
        changes = info.rowCount;
      }

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'PROMOTE_YEAR',
        `Promoted ${changes} active students (${branch || 'ALL'}) from Year ${yr} to Year ${toYear}`
      );

      res.json({ success: true, promoted_count: changes, from_year: yr, to_year: toYear });
    })
  );

  // ==================== HALL & LAB CONFIGURATOR ROUTES ====================
  app.get(
    '/api/halls',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const rows = await queryAll<Record<string, unknown>>(
        'SELECT * FROM halls ORDER BY building_code ASC, room_no ASC'
      );
      res.json(rows.map(mapHallRow));
    })
  );

  app.post(
    '/api/halls',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const {
        building_code,
        building_name,
        floor,
        room_no,
        room_type,
        grid_rows,
        grid_cols,
        bench_capacity,
        bench_pattern,
      } = req.body as Partial<Hall>;

      if (!building_code || !room_no || !room_type || !grid_rows) {
        res.status(400).json({ error: 'Room identifier, building, type, and row count are required' });
        return;
      }

      const pattern = parseBenchPattern(
        bench_pattern,
        Number(grid_cols) || 9,
        Number(bench_capacity) || 3
      );
      const computedCols = pattern.reduce((s, n) => s + n, 0);
      const maxBenchCap = Math.max(...pattern);
      const cleanRoom = room_no.trim().toUpperCase();
      const existing = await queryOne('SELECT id FROM halls WHERE room_no = $1', [cleanRoom]);
      if (existing) {
        res.status(409).json({ error: `Hall ${cleanRoom} already exists` });
        return;
      }

      const totalCapacity = Number(grid_rows) * computedCols;
      const { rows } = await execute(
        `INSERT INTO halls (building_code, building_name, floor, room_no, room_type, grid_rows, grid_cols, bench_capacity, bench_pattern, total_capacity, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
         RETURNING *`,
        [
          building_code.trim().toUpperCase(),
          (building_name || 'RATAN TATA BHAVAN').trim().toUpperCase(),
          (floor || 'II FLOOR').trim().toUpperCase(),
          cleanRoom,
          room_type,
          Number(grid_rows),
          computedCols,
          maxBenchCap,
          JSON.stringify(pattern),
          totalCapacity,
        ]
      );

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'ADD_HALL',
        `Configured ${room_type} ${cleanRoom} (${grid_rows}×[${pattern.join('-')}] = ${totalCapacity} seats)`
      );

      res.status(201).json(mapHallRow(rows[0]));
    })
  );

  app.put(
    '/api/halls/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const existing = await queryOne<Record<string, unknown>>('SELECT * FROM halls WHERE id = $1', [
        id,
      ]);
      if (!existing) {
        res.status(404).json({ error: 'Hall not found' });
        return;
      }

      const {
        building_code,
        building_name,
        floor,
        room_no,
        room_type,
        grid_rows,
        grid_cols,
        bench_capacity,
        bench_pattern,
        is_active,
      } = req.body as Partial<Hall>;

      const nextRows = grid_rows !== undefined ? Number(grid_rows) : Number(existing.grid_rows);
      const existingPattern = parseBenchPattern(
        existing.bench_pattern,
        Number(existing.grid_cols),
        Number(existing.bench_capacity)
      );
      const nextPattern =
        bench_pattern !== undefined
          ? parseBenchPattern(
              bench_pattern,
              Number(grid_cols) || Number(existing.grid_cols),
              Number(bench_capacity) || Number(existing.bench_capacity)
            )
          : existingPattern;
      const nextCols = nextPattern.reduce((s, n) => s + n, 0);
      const nextBenchCap = Math.max(...nextPattern);
      const totalCapacity = nextRows * nextCols;

      const { rows } = await execute(
        `UPDATE halls SET building_code = $1, building_name = $2, floor = $3, room_no = $4, room_type = $5,
          grid_rows = $6, grid_cols = $7, bench_capacity = $8, bench_pattern = $9, total_capacity = $10, is_active = $11
         WHERE id = $12 RETURNING *`,
        [
          building_code ? building_code.trim().toUpperCase() : String(existing.building_code),
          building_name ? building_name.trim().toUpperCase() : String(existing.building_name),
          floor ? floor.trim().toUpperCase() : String(existing.floor),
          room_no ? room_no.trim().toUpperCase() : String(existing.room_no),
          room_type ?? String(existing.room_type),
          nextRows,
          nextCols,
          nextBenchCap,
          JSON.stringify(nextPattern),
          totalCapacity,
          is_active !== undefined ? (is_active ? 1 : 0) : Number(existing.is_active),
          id,
        ]
      );

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'UPDATE_HALL',
        `Updated hall ${room_no || String(existing.room_no)}`
      );

      res.json(mapHallRow(rows[0]));
    })
  );

  app.delete(
    '/api/halls/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const existing = await queryOne<{ room_no: string }>('SELECT room_no FROM halls WHERE id = $1', [
        id,
      ]);
      if (!existing) {
        res.status(404).json({ error: 'Hall not found' });
        return;
      }
      await execute('DELETE FROM halls WHERE id = $1', [id]);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'DELETE_HALL',
        `Removed hall ${existing.room_no}`
      );
      res.json({ success: true });
    })
  );

  // ==================== EXAM SESSIONS & SEATING ENGINE ====================
  app.get(
    '/api/exams',
    safe(authenticateToken),
    safe(async (_req: AuthedRequest, res: Response) => {
      const rows = await queryAll<Record<string, unknown>>(
        'SELECT * FROM exam_sessions ORDER BY id DESC'
      );
      res.json(rows.map(mapExamSessionRow));
    })
  );

  app.post(
    '/api/exams',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const {
        exam_title,
        department,
        exam_date,
        session_slot,
        session_timing,
        target_years,
        target_branches,
        seating_mode,
        minor_stream_filter,
        subject_mapping,
        selected_subject_ids,
        selected_hall_ids,
        layout_config,
      } = req.body as Partial<ExamSession>;

      if (!exam_title || !exam_date || !session_slot) {
        res.status(400).json({ error: 'Exam title, date, and session slot are required' });
        return;
      }

      const timing =
        session_timing ||
        (session_slot === 'FN' ? '09:30 AM TO 12:00 PM' : '01:30 PM TO 04:00 PM');

      const { rows } = await execute(
        `INSERT INTO exam_sessions (
          exam_title, department, exam_date, session_slot, session_timing,
          target_years, target_branches, seating_mode, minor_stream_filter,
          subject_mapping, selected_subject_ids, selected_hall_ids, layout_config, status, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DRAFT', $14)
        RETURNING *`,
        [
          exam_title.trim(),
          (department || 'Computer Science & Engineering').trim(),
          exam_date,
          session_slot,
          timing,
          JSON.stringify(target_years || []),
          JSON.stringify(target_branches || []),
          seating_mode || 'INTERLEAVED',
          minor_stream_filter || null,
          JSON.stringify(subject_mapping || {}),
          JSON.stringify(selected_subject_ids || []),
          JSON.stringify(selected_hall_ids || []),
          JSON.stringify(layout_config || {}),
          req.user!.id,
        ]
      );

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'CREATE_EXAM',
        `Created exam schedule "${exam_title.trim()}" (${exam_date} ${session_slot})`
      );

      res.status(201).json(mapExamSessionRow(rows[0]));
    })
  );

  app.put(
    '/api/exams/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      const existingRow = await queryOne<Record<string, unknown>>(
        'SELECT * FROM exam_sessions WHERE id = $1',
        [id]
      );
      if (!existingRow) {
        res.status(404).json({ error: 'Exam session not found' });
        return;
      }

      const existing = mapExamSessionRow(existingRow);
      const body = req.body as Partial<ExamSession>;

      const { rows } = await execute(
        `UPDATE exam_sessions SET
          exam_title = $1, department = $2, exam_date = $3, session_slot = $4, session_timing = $5,
          target_years = $6, target_branches = $7, seating_mode = $8, minor_stream_filter = $9,
          subject_mapping = $10, selected_subject_ids = $11, selected_hall_ids = $12, layout_config = $13
         WHERE id = $14 RETURNING *`,
        [
          body.exam_title ?? existing.exam_title,
          body.department ?? existing.department,
          body.exam_date ?? existing.exam_date,
          body.session_slot ?? existing.session_slot,
          body.session_timing ?? existing.session_timing,
          JSON.stringify(body.target_years ?? existing.target_years),
          JSON.stringify(body.target_branches ?? existing.target_branches),
          body.seating_mode ?? existing.seating_mode,
          body.minor_stream_filter !== undefined
            ? body.minor_stream_filter
            : existing.minor_stream_filter,
          JSON.stringify(body.subject_mapping ?? existing.subject_mapping),
          JSON.stringify(body.selected_subject_ids ?? existing.selected_subject_ids),
          JSON.stringify(body.selected_hall_ids ?? existing.selected_hall_ids),
          JSON.stringify(body.layout_config ?? existing.layout_config),
          id,
        ]
      );

      res.json(mapExamSessionRow(rows[0]));
    })
  );

  app.delete(
    '/api/exams/:id',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const id = Number(req.params.id);
      await execute('DELETE FROM exam_sessions WHERE id = $1', [id]);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'DELETE_EXAM',
        `Deleted exam session #${id}`
      );
      res.json({ success: true });
    })
  );

  app.post(
    '/api/exams/validate-capacity',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const {
        target_years,
        target_branches,
        seating_mode,
        minor_stream_filter,
        selected_hall_ids,
        selected_subject_ids,
        subject_mapping,
        layout_config,
      } = req.body as {
        target_years: number[];
        target_branches: string[];
        seating_mode: SeatingMode;
        minor_stream_filter: string | null;
        selected_hall_ids: number[];
        selected_subject_ids?: number[];
        subject_mapping?: Record<string, string>;
        layout_config?: ExamLayoutConfig;
      };

      const [studentRows, hallRows, eligRows, sessionCourseCodes] = await Promise.all([
        queryAll<Record<string, unknown>>('SELECT * FROM students'),
        queryAll<Record<string, unknown>>('SELECT * FROM halls WHERE is_active = 1'),
        queryAll<Record<string, unknown>>('SELECT * FROM course_eligibility'),
        resolveSessionCourseCodes(selected_subject_ids || [], subject_mapping || {}),
      ]);
      const students = studentRows.map(mapStudentRow);
      const courseElig = eligRows.map(mapCourseEligibilityRow);
      const allHalls = hallRows.map(mapHallRow);
      const selectedHalls = (selected_hall_ids || [])
        .map((hid) => allHalls.find((h) => h.id === hid))
        .filter((h): h is Hall => Boolean(h));

      const result = validateSessionCapacity(
        students,
        selectedHalls,
        target_years || [],
        target_branches || [],
        seating_mode || 'INTERLEAVED',
        minor_stream_filter || null,
        layout_config,
        courseElig,
        sessionCourseCodes
      );
      res.json(result);
    })
  );

  app.post(
    '/api/exams/:id/allocate',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const sessionRow = await queryOne<Record<string, unknown>>(
        'SELECT * FROM exam_sessions WHERE id = $1',
        [examId]
      );

      if (!sessionRow) {
        res.status(404).json({ error: 'Exam session not found' });
        return;
      }

      const body = req.body as Partial<ExamSession>;
      let freshSessionRow = sessionRow;
      if (Object.keys(body).length > 0) {
        const current = mapExamSessionRow(sessionRow);
        const mergedLayoutConfig = body.layout_config
          ? { ...current.layout_config, ...body.layout_config }
          : current.layout_config;
        const { rows } = await execute(
          `UPDATE exam_sessions SET
            seating_mode = $1, minor_stream_filter = $2, target_years = $3,
            target_branches = $4, selected_hall_ids = $5, subject_mapping = $6,
            selected_subject_ids = $7, layout_config = $8
           WHERE id = $9 RETURNING *`,
          [
            body.seating_mode ?? current.seating_mode,
            body.minor_stream_filter !== undefined
              ? body.minor_stream_filter
              : current.minor_stream_filter,
            JSON.stringify(body.target_years ?? current.target_years),
            JSON.stringify(body.target_branches ?? current.target_branches),
            JSON.stringify(body.selected_hall_ids ?? current.selected_hall_ids),
            JSON.stringify(body.subject_mapping ?? current.subject_mapping),
            JSON.stringify(body.selected_subject_ids ?? current.selected_subject_ids),
            JSON.stringify(mergedLayoutConfig),
            examId,
          ]
        );
        freshSessionRow = rows[0];
      }

      const session = mapExamSessionRow(freshSessionRow);

      const [studentRows, hallRows, prevAllocs, eligRows, sessionCourseCodes] = await Promise.all([
        queryAll<Record<string, unknown>>('SELECT * FROM students'),
        queryAll<Record<string, unknown>>('SELECT * FROM halls WHERE is_active = 1'),
        queryAll<Record<string, unknown>>(
          'SELECT * FROM hall_allocations WHERE exam_session_id = $1',
          [examId]
        ),
        queryAll<Record<string, unknown>>('SELECT * FROM course_eligibility'),
        resolveSessionCourseCodes(session.selected_subject_ids, session.subject_mapping),
      ]);

      const students = studentRows.map(mapStudentRow);
      const courseElig = eligRows.map(mapCourseEligibilityRow);
      const allHalls = hallRows.map(mapHallRow);
      const selectedHalls = session.selected_hall_ids
        .map((hid) => allHalls.find((h) => h.id === hid))
        .filter((h): h is Hall => Boolean(h));

      if (selectedHalls.length === 0) {
        res.status(400).json({ error: 'Please select at least one hall before running the seating engine.' });
        return;
      }

      const prevByHall = new Map<number, Record<string, unknown>>();
      for (const pa of prevAllocs) {
        prevByHall.set(Number(pa.hall_id), pa);
      }

      const filteredInfo = filterStudentsForSession({
        students,
        courseEligibility: courseElig,
        sessionCourseCodes,
        targetYears: session.target_years,
        targetBranches: session.target_branches,
        seatingMode: session.seating_mode,
        minorStreamFilter: session.minor_stream_filter,
        layoutConfig: session.layout_config,
      });

      const computed = allocateSeatingMatrices(
        students,
        selectedHalls,
        session.target_years,
        session.target_branches,
        session.seating_mode,
        session.minor_stream_filter,
        session.layout_config,
        courseElig,
        sessionCourseCodes
      );

      if (computed.length === 0) {
        res.status(400).json({
          error:
            filteredInfo.excludedCount > 0
              ? `No eligible students (${filteredInfo.excludedCount} detained or on condonation verification hold).`
              : 'No eligible students found for the selected cohorts.',
        });
        return;
      }

      await withTransaction(async (client) => {
        await client.query('DELETE FROM hall_allocations WHERE exam_session_id = $1', [examId]);

        for (const roomAlloc of computed) {
          const prev = prevByHall.get(roomAlloc.hall.id);
          const allocInsert = await client.query<{ id: number }>(
            `INSERT INTO hall_allocations (
              exam_session_id, hall_id, sort_order, allocated_count,
              invigilator_1_name, invigilator_1_emp_id, invigilator_1_willing,
              invigilator_2_name, invigilator_2_emp_id, invigilator_2_willing,
              column_headers
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id`,
            [
              examId,
              roomAlloc.hall.id,
              roomAlloc.sort_order,
              roomAlloc.allocated_count,
              prev ? String(prev.invigilator_1_name || '') : '',
              prev ? String(prev.invigilator_1_emp_id || '') : '',
              prev ? Number(prev.invigilator_1_willing || 0) : 0,
              prev ? String(prev.invigilator_2_name || '') : '',
              prev ? String(prev.invigilator_2_emp_id || '') : '',
              prev ? Number(prev.invigilator_2_willing || 0) : 0,
              JSON.stringify(roomAlloc.column_headers),
            ]
          );
          const allocId = Number(allocInsert.rows[0].id);

          if (roomAlloc.cells.length > 0) {
            const cellValues: unknown[] = [];
            const cellPlaceholders = roomAlloc.cells
              .map((cell, idx) => {
                const base = idx * 8;
                cellValues.push(
                  allocId,
                  cell.row_index,
                  cell.col_index,
                  cell.bench_group,
                  cell.sub_seat_index,
                  cell.cohort_label,
                  cell.student_id,
                  cell.roll_no_snapshot
                );
                return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
              })
              .join(', ');

            await client.query(
              `INSERT INTO seat_cells (
                allocation_id, row_index, col_index, bench_group, sub_seat_index,
                cohort_label, student_id, roll_no_snapshot
              ) VALUES ${cellPlaceholders}`,
              cellValues
            );
          }
        }

        await client.query("UPDATE exam_sessions SET status = 'ALLOCATED' WHERE id = $1", [examId]);
      });

      const totalSeated = computed.reduce((sum, r) => sum + r.allocated_count, 0);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'RUN_SEATING_ENGINE',
        `Allocated ${totalSeated} students across ${computed.length} halls for "${session.exam_title}" (${session.seating_mode}; ${filteredInfo.excludedCount} excluded/hold)`
      );

      const loaded = await loadSessionAllocations(examId);
      const summaryRows = loaded.session ? buildMasterSummaryRows(loaded.session, loaded.allocations) : [];
      res.json({
        ...loaded,
        summary_rows: summaryRows,
        excluded_students: filteredInfo.excludedStudents,
        excluded_count: filteredInfo.excludedCount,
        hold_count: filteredInfo.holdCount,
      });
    })
  );

  // Post-allocation late-registrant / buffer seat slotting
  app.post(
    '/api/exams/:id/pin-seat',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const { roll_no, hall_id, full_name, branch, current_year } = req.body as {
        roll_no?: string;
        hall_id?: number;
        full_name?: string;
        branch?: string;
        current_year?: number;
      };

      if (!roll_no?.trim() || !hall_id) {
        res.status(400).json({ error: 'Student Roll Number and target Room are required' });
        return;
      }

      const cleanRoll = roll_no.trim().toUpperCase();
      const loaded = await loadSessionAllocations(examId);
      if (!loaded.session || loaded.allocations.length === 0) {
        res
          .status(404)
          .json({ error: 'Run the seating allocation engine before slotting into a buffer seat.' });
        return;
      }

      for (const alloc of loaded.allocations) {
        const existingCell = alloc.cells.find(
          (c) => (c.roll_no_snapshot || '').toUpperCase() === cleanRoll
        );
        if (existingCell) {
          res.status(409).json({
            error: `Student ${cleanRoll} is already seated in ${alloc.hall.room_no} (Row ${existingCell.row_index}, Col ${existingCell.col_index}).`,
          });
          return;
        }
      }

      const targetAlloc = loaded.allocations.find((a) => a.hall_id === Number(hall_id));
      if (!targetAlloc) {
        res.status(404).json({ error: 'Selected hall is not part of this session allocation.' });
        return;
      }

      let studentRow = await queryOne<Record<string, unknown>>(
        'SELECT * FROM students WHERE roll_no = $1',
        [cleanRoll]
      );
      if (!studentRow) {
        const yr = Math.min(
          4,
          Math.max(1, Number(current_year) || loaded.session.target_years[0] || 2)
        );
        const br = (branch || loaded.session.target_branches[0] || 'CSE').trim().toUpperCase();
        const inserted = await execute(
          `INSERT INTO students (roll_no, full_name, branch, current_year, batch_code, minor_stream, is_detained, eligibility_status, is_pwd)
           VALUES ($1, $2, $3, $4, '2025-2029', '', 0, 'ELIGIBLE', 0) RETURNING *`,
          [cleanRoll, (full_name || `Late Reg ${cleanRoll}`).trim(), br, yr]
        );
        studentRow = inserted.rows[0];
      }

      const student = mapStudentRow(studentRow);
      const cohortLabel = getCohortLabel(
        student,
        loaded.session.seating_mode,
        loaded.session.minor_stream_filter
      );

      const bufferCell = targetAlloc.cells.find(
        (c) => !c.roll_no_snapshot && c.cohort_label === 'BUFFER'
      );
      const emptyCell =
        bufferCell ||
        targetAlloc.cells.find((c) => !c.roll_no_snapshot && c.cohort_label !== 'EMPTY');

      if (!emptyCell || !emptyCell.id) {
        res.status(400).json({
          error: `No empty or buffer seats remain in ${targetAlloc.hall.room_no}. Choose another room or add a buffer seat.`,
        });
        return;
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE seat_cells SET student_id = $1, roll_no_snapshot = $2, cohort_label = $3 WHERE id = $4`,
          [student.id, student.roll_no, cohortLabel, emptyCell.id]
        );
        await client.query(
          `UPDATE hall_allocations SET allocated_count = allocated_count + 1 WHERE id = $1`,
          [targetAlloc.id]
        );
      });

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'PIN_BUFFER_SEAT',
        `Slotted ${student.roll_no} into ${targetAlloc.hall.room_no} (${bufferCell ? 'Buffer Seat' : 'Empty Seat'} R${emptyCell.row_index}C${emptyCell.col_index}) without regenerating other halls`
      );

      const refreshed = await loadSessionAllocations(examId);
      const summaryRows = refreshed.session
        ? buildMasterSummaryRows(refreshed.session, refreshed.allocations)
        : [];
      res.json({
        ...refreshed,
        summary_rows: summaryRows,
        slotted_room: targetAlloc.hall.room_no,
        slotted_seat: `Row ${emptyCell.row_index}, Col ${emptyCell.col_index}`,
        used_buffer: Boolean(bufferCell),
      });
    })
  );

  app.get(
    '/api/exams/:id/allocations',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const loaded = await loadSessionAllocations(examId);
      if (!loaded.session) {
        res.status(404).json({ error: 'Exam session not found' });
        return;
      }
      const summaryRows = buildMasterSummaryRows(loaded.session, loaded.allocations);
      res.json({ ...loaded, summary_rows: summaryRows });
    })
  );

  app.post(
    '/api/exams/:id/willingness',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const { assignments } = req.body as {
        assignments: Array<{
          allocation_id: number;
          invigilator_1_name: string;
          invigilator_1_emp_id: string;
          invigilator_1_willing: boolean;
          invigilator_2_name: string;
          invigilator_2_emp_id: string;
          invigilator_2_willing: boolean;
        }>;
      };

      if (!Array.isArray(assignments)) {
        res.status(400).json({ error: 'Assignments array is required' });
        return;
      }

      await withTransaction(async (client) => {
        for (const a of assignments) {
          await client.query(
            `UPDATE hall_allocations SET
              invigilator_1_name = $1, invigilator_1_emp_id = $2, invigilator_1_willing = $3,
              invigilator_2_name = $4, invigilator_2_emp_id = $5, invigilator_2_willing = $6
             WHERE id = $7 AND exam_session_id = $8`,
            [
              (a.invigilator_1_name || '').trim(),
              (a.invigilator_1_emp_id || '').trim(),
              a.invigilator_1_willing ? 1 : 0,
              (a.invigilator_2_name || '').trim(),
              (a.invigilator_2_emp_id || '').trim(),
              a.invigilator_2_willing ? 1 : 0,
              a.allocation_id,
              examId,
            ]
          );
        }
        await client.query("UPDATE exam_sessions SET status = 'FINALIZED' WHERE id = $1", [examId]);
      });

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'SAVE_WILLINGNESS',
        `Updated invigilator willingness roster for ${assignments.length} halls in exam #${examId}`
      );

      const loaded = await loadSessionAllocations(examId);
      res.json(loaded);
    })
  );

  // ==================== INVIGILATION WILLINGNESS TEMPLATE & UPLOAD ROUTES ====================
  app.get(
    '/api/willingness/template-excel',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const department =
        typeof req.query.department === 'string' && req.query.department.trim()
          ? req.query.department.trim()
          : 'Freshman Engineering';
      const examTitle =
        typeof req.query.title === 'string' && req.query.title.trim()
          ? req.query.title.trim()
          : 'Internal Examinations';
      const datesRaw = typeof req.query.dates === 'string' ? req.query.dates : '';
      const dates = datesRaw
        .split(',')
        .map((d) => normalizeExamDate(d) || d.trim())
        .filter(Boolean);

      const buf = await buildWillingnessTemplateWorkbook({
        department,
        examTitle,
        dates,
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="aditya_willingness_template.xlsx"');
      res.send(buf);
    })
  );

  app.get(
    '/api/willingness',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
      const slot = typeof req.query.slot === 'string' ? req.query.slot.trim().toUpperCase() : '';

      let rows: Array<Record<string, unknown>>;
      if (date && (slot === 'FN' || slot === 'AN')) {
        rows = await queryAll<Record<string, unknown>>(
          `SELECT * FROM faculty_willingness WHERE exam_date = $1 AND session_slot = $2 ORDER BY willing DESC, faculty_name ASC`,
          [date, slot]
        );
      } else if (date) {
        rows = await queryAll<Record<string, unknown>>(
          `SELECT * FROM faculty_willingness WHERE exam_date = $1 ORDER BY session_slot ASC, willing DESC, faculty_name ASC`,
          [date]
        );
      } else {
        rows = await queryAll<Record<string, unknown>>(
          `SELECT * FROM faculty_willingness ORDER BY exam_date ASC, session_slot ASC, faculty_name ASC`
        );
      }

      const dutyRows = await queryAll<{ emp_id: string }>(
        `SELECT invigilator_1_emp_id AS emp_id FROM hall_allocations WHERE invigilator_1_emp_id <> ''
         UNION ALL
         SELECT invigilator_2_emp_id AS emp_id FROM hall_allocations WHERE invigilator_2_emp_id <> ''`
      );
      const dutyCounts = new Map<string, number>();
      for (const d of dutyRows) {
        const id = String(d.emp_id || '').trim();
        if (id) dutyCounts.set(id, (dutyCounts.get(id) || 0) + 1);
      }

      res.json(
        rows.map((r) => {
          let courses: string[] = [];
          try {
            const parsed = JSON.parse(String(r.teaching_courses || '[]'));
            if (Array.isArray(parsed)) courses = parsed.map(String);
          } catch {
            courses = [];
          }
          const empId = String(r.emp_id || '');
          return {
            ...r,
            teaching_courses: courses,
            duty_count: dutyCounts.get(empId) || 0,
          };
        })
      );
    })
  );

  app.post(
    '/api/exams/:id/auto-assign-invigilators',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const { rule } = req.body as { rule?: 'TWO_PER_ROOM' | 'ONE_PER_30' };
      const loaded = await loadSessionAllocations(examId);

      if (!loaded.session || loaded.allocations.length === 0) {
        res.status(404).json({ error: 'Allocate seating rooms before auto-assigning invigilators.' });
        return;
      }

      const session = loaded.session;
      const sessionCourseCodes = await resolveSessionCourseCodes(
        session.selected_subject_ids,
        session.subject_mapping
      );
      const sessionCourseSet = new Set(sessionCourseCodes);

      const [willingRows, allDutyRows, sameSlotRows] = await Promise.all([
        queryAll<Record<string, unknown>>(
          `SELECT * FROM faculty_willingness WHERE exam_date = $1 AND session_slot = $2 ORDER BY faculty_name ASC`,
          [session.exam_date, session.session_slot]
        ),
        queryAll<{ emp_id: string }>(
          `SELECT ha.invigilator_1_emp_id AS emp_id FROM hall_allocations ha WHERE ha.exam_session_id <> $1 AND ha.invigilator_1_emp_id <> ''
           UNION ALL
           SELECT ha.invigilator_2_emp_id AS emp_id FROM hall_allocations ha WHERE ha.exam_session_id <> $1 AND ha.invigilator_2_emp_id <> ''`,
          [examId]
        ),
        queryAll<{ emp_id: string }>(
          `SELECT ha.invigilator_1_emp_id AS emp_id
           FROM hall_allocations ha JOIN exam_sessions es ON es.id = ha.exam_session_id
           WHERE ha.exam_session_id <> $1 AND es.exam_date = $2 AND es.session_slot = $3 AND ha.invigilator_1_emp_id <> ''
           UNION
           SELECT ha.invigilator_2_emp_id AS emp_id
           FROM hall_allocations ha JOIN exam_sessions es ON es.id = ha.exam_session_id
           WHERE ha.exam_session_id <> $1 AND es.exam_date = $2 AND es.session_slot = $3 AND ha.invigilator_2_emp_id <> ''`,
          [examId, session.exam_date, session.session_slot]
        ),
      ]);

      const cumulativeDuties = new Map<string, number>();
      for (const d of allDutyRows) {
        const id = String(d.emp_id || '').trim();
        if (id) cumulativeDuties.set(id, (cumulativeDuties.get(id) || 0) + 1);
      }

      const bookedSameSlot = new Set<string>(sameSlotRows.map((r) => String(r.emp_id).trim()));

      const excludedClashes: Array<{
        emp_id: string;
        faculty_name: string;
        reason: string;
        matching_courses: string[];
      }> = [];

      const poolCandidates: Array<{
        emp_id: string;
        faculty_name: string;
        duty_count: number;
      }> = [];

      for (const r of willingRows) {
        if (String(r.willing).toUpperCase() !== 'YES') continue;
        const empId = String(r.emp_id || '').trim();
        const facultyName = String(r.faculty_name || '').trim();
        let teachingCourses: string[] = [];
        try {
          const parsed = JSON.parse(String(r.teaching_courses || '[]'));
          if (Array.isArray(parsed)) teachingCourses = parsed.map((c) => String(c).toUpperCase());
        } catch {
          teachingCourses = [];
        }

        const matching = teachingCourses.filter((c) => sessionCourseSet.has(c));
        if (matching.length > 0) {
          excludedClashes.push({
            emp_id: empId,
            faculty_name: facultyName,
            reason: 'Subject Conflict (Examined Course Handled)',
            matching_courses: matching,
          });
          continue;
        }

        if (bookedSameSlot.has(empId)) {
          excludedClashes.push({
            emp_id: empId,
            faculty_name: facultyName,
            reason: `Already booked in another hall on ${session.exam_date} ${session.session_slot}`,
            matching_courses: [],
          });
          continue;
        }

        poolCandidates.push({
          emp_id: empId,
          faculty_name: facultyName,
          duty_count: cumulativeDuties.get(empId) || 0,
        });
      }

      poolCandidates.sort(
        (a, b) => a.duty_count - b.duty_count || a.faculty_name.localeCompare(b.faculty_name)
      );

      let cursor = 0;
      let assignedRooms = 0;
      let skippedSlots = 0;

      await withTransaction(async (client) => {
        for (const alloc of loaded.allocations) {
          const needed = rule === 'ONE_PER_30' && alloc.allocated_count <= 30 ? 1 : 2;
          const inv1 = cursor < poolCandidates.length ? poolCandidates[cursor++] : null;
          const inv2 =
            needed >= 2 && cursor < poolCandidates.length ? poolCandidates[cursor++] : null;

          if (!inv1) skippedSlots++;
          if (needed >= 2 && !inv2) skippedSlots++;
          if (inv1) assignedRooms++;

          await client.query(
            `UPDATE hall_allocations SET
              invigilator_1_name = $1, invigilator_1_emp_id = $2, invigilator_1_willing = $3,
              invigilator_2_name = $4, invigilator_2_emp_id = $5, invigilator_2_willing = $6
             WHERE id = $7 AND exam_session_id = $8`,
            [
              inv1 ? inv1.faculty_name : '',
              inv1 ? inv1.emp_id : '',
              inv1 ? 1 : 0,
              inv2 ? inv2.faculty_name : '',
              inv2 ? inv2.emp_id : '',
              inv2 ? 1 : 0,
              alloc.id,
              examId,
            ]
          );
        }
        await client.query("UPDATE exam_sessions SET status = 'FINALIZED' WHERE id = $1", [examId]);
      });

      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'AUTO_ASSIGN_INVIGILATORS',
        `Auto-assigned invigilators (${rule || 'TWO_PER_ROOM'}) for ${assignedRooms}/${loaded.allocations.length} halls; excluded ${excludedClashes.length} clash(es)`
      );

      const refreshed = await loadSessionAllocations(examId);
      res.json({
        ...refreshed,
        assigned_rooms: assignedRooms,
        unfilled_slots: skippedSlots,
        excluded_clashes: excludedClashes,
        pool_available: poolCandidates.length,
      });
    })
  );

  app.post(
    '/api/willingness/upload',
    safe(authenticateToken),
    upload.single('file'),
    safe(async (req: AuthedRequest, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: 'Willingness Excel file is required' });
        return;
      }

      try {
        const parsed = parseAndValidateWillingnessWorkbook(req.file.buffer);
        const deduped = new Map<string, (typeof parsed.entries)[number]>();
        for (const e of parsed.entries) {
          deduped.set(`${e.emp_id}::${e.exam_date}::${e.session_slot}`, e);
        }
        const entries = Array.from(deduped.values());

        if (entries.length > 0) {
          await withTransaction(async (client) => {
            const CHUNK = 140;
            for (let i = 0; i < entries.length; i += CHUNK) {
              const slice = entries.slice(i, i + CHUNK);
              const values: unknown[] = [];
              const placeholders = slice
                .map((e, idx) => {
                  const base = idx * 9;
                  values.push(
                    e.department,
                    e.exam_title,
                    e.emp_id,
                    e.faculty_name,
                    e.designation,
                    e.exam_date,
                    e.session_slot,
                    e.willing,
                    JSON.stringify(e.teaching_courses || [])
                  );
                  return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9})`;
                })
                .join(', ');

              await client.query(
                `INSERT INTO faculty_willingness (department, exam_title, emp_id, faculty_name, designation, exam_date, session_slot, willing, teaching_courses)
                 VALUES ${placeholders}
                 ON CONFLICT(emp_id, exam_date, session_slot) DO UPDATE SET
                   department = excluded.department,
                   exam_title = excluded.exam_title,
                   faculty_name = excluded.faculty_name,
                   designation = excluded.designation,
                   willing = excluded.willing,
                   teaching_courses = CASE WHEN excluded.teaching_courses <> '[]' THEN excluded.teaching_courses ELSE faculty_willingness.teaching_courses END,
                   uploaded_at = NOW()`,
                values
              );
            }
          });
        }

        const willingCount = entries.filter((e) => e.willing === 'YES').length;
        await logAudit(
          req.user!.id,
          req.user!.username,
          req.user!.role,
          'UPLOAD_WILLINGNESS',
          `Uploaded "${req.file.originalname}": ${entries.length} slot entries (${willingCount} YES) across ${parsed.dates.join(', ')}`
        );

        res.json({
          success: true,
          total_entries: entries.length,
          willing_yes_count: willingCount,
          dates: parsed.dates,
          department: parsed.department,
        });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    })
  );

  app.delete(
    '/api/willingness',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      await execute('DELETE FROM faculty_willingness');
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'CLEAR_WILLINGNESS',
        'Cleared uploaded faculty willingness records'
      );
      res.json({ success: true });
    })
  );

  // ==================== OFFICIAL PDF EXPORT ROUTES ====================
  app.get(
    '/api/exams/:id/pdf/master',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const includeSubject = req.query.includeSubject !== 'false';
      const { session, allocations } = await loadSessionAllocations(examId);

      if (!session || allocations.length === 0) {
        res.status(404).json({ error: 'No seating allocations found for this exam session' });
        return;
      }

      const pdfBuf = await generateMasterPdfBuffer(session, allocations, includeSubject);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'GENERATE_PDF',
        `Exported Master Seating Summary PDF for "${session.exam_title}"`
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="AU_Master_Seating_${session.exam_date}_${session.session_slot}.pdf"`
      );
      res.send(pdfBuf);
    })
  );

  app.get(
    '/api/exams/:id/pdf/rooms',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const { session, allocations } = await loadSessionAllocations(examId);

      if (!session || allocations.length === 0) {
        res.status(404).json({ error: 'No seating allocations found for this exam session' });
        return;
      }

      const pdfBuf = await generateRoomsPdfBuffer(session, allocations);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'GENERATE_PDF',
        `Exported Room-Wise Invigilator Statements PDF (${allocations.length} halls) for "${session.exam_title}"`
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="AU_Room_Seating_Absentees_${session.exam_date}_${session.session_slot}.pdf"`
      );
      res.send(pdfBuf);
    })
  );

  app.get(
    '/api/exams/:id/pdf/bundle',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const includeSubject = req.query.includeSubject !== 'false';
      const { session, allocations } = await loadSessionAllocations(examId);

      if (!session || allocations.length === 0) {
        res.status(404).json({ error: 'No seating allocations found for this exam session' });
        return;
      }

      const pdfBuf = await generateBundlePdfBuffer(session, allocations, includeSubject);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'GENERATE_PDF',
        `Exported Complete Official PDF Bundle for "${session.exam_title}"`
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="AU_Complete_Exam_Bundle_${session.exam_date}_${session.session_slot}.pdf"`
      );
      res.send(pdfBuf);
    })
  );

  app.get(
    '/api/exams/:id/pdf/attendance',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const { session, allocations } = await loadSessionAllocations(examId);

      if (!session || allocations.length === 0) {
        res.status(404).json({ error: 'No seating allocations found for this exam session' });
        return;
      }

      const studentRows = await queryAll<{ roll_no: string; full_name: string }>(
        'SELECT roll_no, full_name FROM students'
      );
      const nameMap = new Map<string, string>();
      for (const st of studentRows) {
        nameMap.set(st.roll_no, st.full_name);
      }

      const pdfBuf = await generateAttendancePdfBuffer(session, allocations, nameMap);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'GENERATE_PDF',
        `Exported Room-Wise Attendance Reports (${allocations.length} rooms) for "${session.exam_title}"`
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="AU_Attendance_Sheets_${session.exam_date}_${session.session_slot}.pdf"`
      );
      res.send(pdfBuf);
    })
  );

  app.get(
    '/api/exams/:id/pdf/proforma',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const { session, allocations } = await loadSessionAllocations(examId);

      if (!session || allocations.length === 0) {
        res.status(404).json({ error: 'No seating allocations found for this exam session' });
        return;
      }

      const pdfBuf = await generateProformaPdfBuffer(session, allocations);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'GENERATE_PDF',
        `Exported Examination Proforma for "${session.exam_title}"`
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="AU_Examination_Proforma_${session.exam_date}_${session.session_slot}.pdf"`
      );
      res.send(pdfBuf);
    })
  );

  app.get(
    '/api/exams/:id/dispatch',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const bufferPct = req.query.bufferPct !== undefined ? Number(req.query.bufferPct) : 5;
      const { session, allocations } = await loadSessionAllocations(examId);
      if (!session || allocations.length === 0) {
        res.status(404).json({ error: 'No seating allocations found for this exam session' });
        return;
      }
      res.json(buildDispatchSummary(session, allocations, bufferPct));
    })
  );

  app.get(
    '/api/exams/:id/pdf/dispatch',
    safe(authenticateToken),
    safe(async (req: AuthedRequest, res: Response) => {
      const examId = Number(req.params.id);
      const bufferPct = req.query.bufferPct !== undefined ? Number(req.query.bufferPct) : 5;
      const { session, allocations } = await loadSessionAllocations(examId);

      if (!session || allocations.length === 0) {
        res.status(404).json({ error: 'No seating allocations found for this exam session' });
        return;
      }

      const pdfBuf = await generateDispatchPdfBuffer(session, allocations, bufferPct);
      await logAudit(
        req.user!.id,
        req.user!.username,
        req.user!.role,
        'GENERATE_PDF',
        `Exported QP & Answer Booklet Dispatch Sheet (+${bufferPct}% buffer) for "${session.exam_title}"`
      );

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="AU_QP_Booklet_Dispatch_${session.exam_date}_${session.session_slot}.pdf"`
      );
      res.send(pdfBuf);
    })
  );

  // Express global JSON error handler for async & DB failures
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error';
    console.error('API Error:', err);
    if (!res.headersSent) {
      res.status(500).json({ error: message });
    }
  });

  return app;
}
