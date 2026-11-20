import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import * as XLSX from 'xlsx';
import { createServer as createViteServer } from 'vite';
import { db, initDatabase, logAudit } from './server/db.ts';
import {
  allocateSeatingMatrices,
  buildMasterSummaryRows,
  compareRollNo,
  validateSessionCapacity,
} from './server/seating.ts';
import {
  buildStudentTemplateWorkbook,
  buildTimetableTemplateWorkbook,
  buildWillingnessTemplateWorkbook,
  normalizeExamDate,
  parseAndValidateWillingnessWorkbook,
} from './server/excel.ts';
import {
  generateAttendancePdfBuffer,
  generateBundlePdfBuffer,
  generateMasterPdfBuffer,
  generateProformaPdfBuffer,
  generateRoomsPdfBuffer,
} from './server/pdf.ts';
import type {
  ExamLayoutConfig,
  ExamSession,
  Hall,
  HallAllocation,
  SeatCell,
  SeatingMode,
  SessionSlot,
  Student,
  UserRole,
} from './src/types/exam.ts';

const JWT_SECRET = process.env.JWT_SECRET || 'aditya-university-exam-cell-secret-2026';
const PORT = 3000;

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

initDatabase();

function authenticateToken(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : null;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : queryToken;

  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthPayload;
    const dbUser = db
      .prepare('SELECT id, username, full_name, emp_id, department, role, is_active FROM users WHERE id = ?')
      .get(decoded.id) as (AuthPayload & { is_active: number }) | undefined;

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

function mapStudentRow(row: Record<string, unknown>): Student {
  return {
    id: Number(row.id),
    roll_no: String(row.roll_no),
    full_name: String(row.full_name),
    branch: String(row.branch),
    current_year: Number(row.current_year),
    batch_code: String(row.batch_code),
    minor_stream: String(row.minor_stream),
    is_detained: Boolean(row.is_detained),
    created_at: String(row.created_at),
  };
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

function loadSessionAllocations(examSessionId: number): {
  session: ExamSession | null;
  allocations: HallAllocation[];
} {
  const sessionRow = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(examSessionId) as
    | Record<string, unknown>
    | undefined;
  if (!sessionRow) return { session: null, allocations: [] };

  const session = mapExamSessionRow(sessionRow);
  const allocRows = db
    .prepare(
      `SELECT ha.*, h.building_code, h.building_name, h.floor, h.room_no, h.room_type,
              h.grid_rows, h.grid_cols, h.bench_capacity, h.bench_pattern, h.total_capacity, h.is_active
       FROM hall_allocations ha
       JOIN halls h ON h.id = ha.hall_id
       WHERE ha.exam_session_id = ?
       ORDER BY ha.sort_order ASC`
    )
    .all(examSessionId) as Array<Record<string, unknown>>;

  const cellStmt = db.prepare(
    `SELECT * FROM seat_cells WHERE allocation_id = ? ORDER BY row_index ASC, col_index ASC`
  );

  const allocations: HallAllocation[] = allocRows.map((ar) => {
    const cellRows = cellStmt.all(Number(ar.id)) as Array<Record<string, unknown>>;
    const cells: SeatCell[] = cellRows.map((cr) => ({
      id: Number(cr.id),
      allocation_id: Number(cr.allocation_id),
      row_index: Number(cr.row_index),
      col_index: Number(cr.col_index),
      bench_group: Number(cr.bench_group),
      sub_seat_index: Number(cr.sub_seat_index),
      cohort_label: String(cr.cohort_label),
      student_id: cr.student_id ? Number(cr.student_id) : null,
      roll_no_snapshot: cr.roll_no_snapshot ? String(cr.roll_no_snapshot) : null,
    }));

    const cohortCounts: Record<string, number> = {};
    for (const c of cells) {
      if (c.roll_no_snapshot) {
        cohortCounts[c.cohort_label] = (cohortCounts[c.cohort_label] || 0) + 1;
      }
    }

    const gCols = Number(ar.grid_cols);
    const bCap = Number(ar.bench_capacity);
    return {
      id: Number(ar.id),
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

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);

  // Force HTTPS in production behind reverse proxy + baseline security headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    const proto = req.headers['x-forwarded-proto'];
    if (process.env.NODE_ENV === 'production' && proto === 'http' && req.headers.host) {
      res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  });

  app.use(express.json({ limit: '5mb' }));

  // ==================== AUTH ROUTES ====================
  app.post('/api/auth/login', (req: Request, res: Response) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`login:${ip}`, 15, 10 * 60 * 1000)) {
      res.status(429).json({ error: 'Too many login attempts. Please wait a few minutes and try again.' });
      return;
    }

    const { username, password, website, utm_source } = req.body as {
      username?: string;
      password?: string;
      website?: string;
      utm_source?: string;
    };

    // Honeypot bot protection check
    if (website && website.trim() !== '') {
      res.status(400).json({ error: 'Automated submission rejected.' });
      return;
    }

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required' });
      return;
    }

    const userRow = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username.trim()) as
      | {
          id: number;
          username: string;
          password_hash: string;
          full_name: string;
          emp_id: string;
          department: string;
          role: UserRole;
          is_active: number;
        }
      | undefined;

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
    logAudit(
      userRow.id,
      userRow.username,
      userRow.role,
      'USER_LOGIN',
      `Authenticated into ${userRow.role} portal${utm_source ? ` (source: ${utm_source})` : ''}`
    );
    res.json({ token, user: payload });
  });

  // ==================== PUBLIC CONTACT / SUPPORT ROUTE ====================
  app.post('/api/contact', (req: Request, res: Response) => {
    const ip = req.ip || 'unknown';
    if (!checkRateLimit(`contact:${ip}`, 5, 15 * 60 * 1000)) {
      res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
      return;
    }

    const { sender_name, sender_email, subject, message, website, human_answer, human_expected, utm_source } =
      req.body as {
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

    if (
      typeof human_expected !== 'number' ||
      Number(human_answer) !== human_expected
    ) {
      res.status(400).json({ error: 'Human verification answer is incorrect.' });
      return;
    }

    if (!sender_name?.trim() || !sender_email?.trim() || !subject?.trim() || !message?.trim()) {
      res.status(400).json({ error: 'All fields are required.' });
      return;
    }

    db.prepare(
      `INSERT INTO contact_inquiries (sender_name, sender_email, subject, message, utm_source) VALUES (?, ?, ?, ?, ?)`
    ).run(
      sender_name.trim(),
      sender_email.trim(),
      subject.trim(),
      message.trim(),
      (utm_source || '').trim()
    );

    logAudit(
      null,
      sender_email.trim(),
      'VISITOR',
      'SUPPORT_INQUIRY',
      `Submitted support inquiry: "${subject.trim()}"`
    );

    res.status(201).json({ success: true, message: 'Inquiry recorded by the Examination Cell.' });
  });

  app.get('/api/auth/me', authenticateToken, (req: AuthedRequest, res: Response) => {
    res.json({ user: req.user });
  });

  // ==================== ADMIN ROUTES ====================
  app.get('/api/admin/users', authenticateToken, requireAdmin, (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare(
        'SELECT id, username, full_name, emp_id, department, role, is_active, created_at FROM users ORDER BY id ASC'
      )
      .all() as Array<Record<string, unknown>>;
    res.json(
      rows.map((r) => ({
        ...r,
        is_active: Boolean(r.is_active),
      }))
    );
  });

  app.post('/api/admin/users', authenticateToken, requireAdmin, (req: AuthedRequest, res: Response) => {
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

    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username.trim());
    if (existing) {
      res.status(409).json({ error: 'Username already exists' });
      return;
    }

    const hash = bcrypt.hashSync(password, 10);
    const info = db
      .prepare(
        `INSERT INTO users (username, password_hash, full_name, emp_id, department, role, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        username.trim(),
        hash,
        full_name.trim(),
        emp_id.trim(),
        (department || 'Computer Science & Engineering').trim(),
        role === 'ADMIN' ? 'ADMIN' : 'EXAMINER'
      );

    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'CREATE_ACCOUNT',
      `Created ${role || 'EXAMINER'} account "${username.trim()}" (${emp_id.trim()})`
    );

    const created = db
      .prepare('SELECT id, username, full_name, emp_id, department, role, is_active, created_at FROM users WHERE id = ?')
      .get(info.lastInsertRowid) as Record<string, unknown>;
    res.status(201).json({ ...created, is_active: Boolean(created.is_active) });
  });

  app.put('/api/admin/users/:id', authenticateToken, requireAdmin, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const { full_name, emp_id, department, role, is_active, password } = req.body as {
      full_name?: string;
      emp_id?: string;
      department?: string;
      role?: UserRole;
      is_active?: boolean;
      password?: string;
    };

    const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (id === req.user!.id && is_active === false) {
      res.status(400).json({ error: 'Cannot deactivate your own active admin session' });
      return;
    }

    const nextHash = password && password.trim() ? bcrypt.hashSync(password.trim(), 10) : String(existing.password_hash);
    db.prepare(
      `UPDATE users SET full_name = ?, emp_id = ?, department = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?`
    ).run(
      full_name?.trim() ?? String(existing.full_name),
      emp_id?.trim() ?? String(existing.emp_id),
      department?.trim() ?? String(existing.department),
      role ?? String(existing.role),
      is_active === undefined ? Number(existing.is_active) : is_active ? 1 : 0,
      nextHash,
      id
    );

    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'UPDATE_ACCOUNT',
      `Updated account "${String(existing.username)}"`
    );

    const updated = db
      .prepare('SELECT id, username, full_name, emp_id, department, role, is_active, created_at FROM users WHERE id = ?')
      .get(id) as Record<string, unknown>;
    res.json({ ...updated, is_active: Boolean(updated.is_active) });
  });

  app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    if (id === req.user!.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }
    const existing = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as
      | { username: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    logAudit(req.user!.id, req.user!.username, req.user!.role, 'DELETE_ACCOUNT', `Deleted account "${existing.username}"`);
    res.json({ success: true });
  });

  app.get('/api/admin/audit-logs', authenticateToken, requireAdmin, (req: AuthedRequest, res: Response) => {
    const actionFilter = typeof req.query.action === 'string' ? req.query.action : '';
    const logs = actionFilter
      ? db
          .prepare('SELECT * FROM audit_logs WHERE action_type = ? ORDER BY id DESC LIMIT 250')
          .all(actionFilter)
      : db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 250').all();
    res.json(logs);
  });

  app.get('/api/admin/analytics', authenticateToken, (_req: AuthedRequest, res: Response) => {
    const totalStudents = (db.prepare('SELECT COUNT(*) as c FROM students').get() as { c: number }).c;
    const activeStudents = (
      db.prepare('SELECT COUNT(*) as c FROM students WHERE is_detained = 0').get() as { c: number }
    ).c;
    const detainedStudents = totalStudents - activeStudents;
    const totalHalls = (db.prepare('SELECT COUNT(*) as c FROM halls WHERE is_active = 1').get() as { c: number }).c;
    const totalSeatCapacity =
      (
        db.prepare('SELECT COALESCE(SUM(total_capacity), 0) as s FROM halls WHERE is_active = 1').get() as {
          s: number;
        }
      ).s || 0;
    const totalExamSessions = (db.prepare('SELECT COUNT(*) as c FROM exam_sessions').get() as { c: number }).c;
    const totalExaminers = (
      db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'EXAMINER' AND is_active = 1").get() as { c: number }
    ).c;

    const studentsByYear = db
      .prepare('SELECT current_year as year, COUNT(*) as count FROM students WHERE is_detained = 0 GROUP BY current_year ORDER BY current_year ASC')
      .all();
    const studentsByBranch = db
      .prepare('SELECT branch, COUNT(*) as count FROM students WHERE is_detained = 0 GROUP BY branch ORDER BY count DESC')
      .all();
    const studentsByMinor = db
      .prepare('SELECT minor_stream, COUNT(*) as count FROM students WHERE is_detained = 0 GROUP BY minor_stream ORDER BY count DESC')
      .all();
    const recentRows = db
      .prepare('SELECT * FROM exam_sessions ORDER BY id DESC LIMIT 10')
      .all() as Array<Record<string, unknown>>;

    res.json({
      total_students: totalStudents,
      active_students: activeStudents,
      detained_students: detainedStudents,
      total_halls: totalHalls,
      total_seat_capacity: totalSeatCapacity,
      total_exam_sessions: totalExamSessions,
      total_examiners: totalExaminers,
      students_by_year: studentsByYear,
      students_by_branch: studentsByBranch,
      students_by_minor: studentsByMinor,
      recent_sessions: recentRows.map(mapExamSessionRow),
    });
  });

  // ==================== STUDENT & COHORT ROUTES ====================
  app.get('/api/students', authenticateToken, (_req: AuthedRequest, res: Response) => {
    const rows = db.prepare('SELECT * FROM students').all() as Array<Record<string, unknown>>;
    const mapped = rows.map(mapStudentRow).sort((a, b) => compareRollNo(a.roll_no, b.roll_no));
    res.json(mapped);
  });

  app.post('/api/students', authenticateToken, (req: AuthedRequest, res: Response) => {
    const { roll_no, full_name, branch, current_year, batch_code, minor_stream, is_detained } = req.body as Partial<Student>;
    if (!roll_no || !full_name || !branch || !current_year) {
      res.status(400).json({ error: 'Roll number, full name, branch, and year are required' });
      return;
    }

    const cleanRoll = roll_no.trim().toUpperCase();
    const existing = db.prepare('SELECT id FROM students WHERE roll_no = ?').get(cleanRoll);
    if (existing) {
      res.status(409).json({ error: `Student with Roll No ${cleanRoll} already exists` });
      return;
    }

    const cleanMinor = (minor_stream || 'NONE').trim();
    const normalizedMinor = cleanMinor.toUpperCase() === 'NONE' || !cleanMinor ? 'NONE' : cleanMinor;

    const info = db
      .prepare(
        `INSERT INTO students (roll_no, full_name, branch, current_year, batch_code, minor_stream, is_detained)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cleanRoll,
        full_name.trim(),
        branch.trim().toUpperCase(),
        Number(current_year),
        (batch_code || '2025-2029').trim(),
        normalizedMinor,
        is_detained ? 1 : 0
      );

    logAudit(req.user!.id, req.user!.username, req.user!.role, 'ADD_STUDENT', `Added student ${cleanRoll} (${branch})`);
    const created = db.prepare('SELECT * FROM students WHERE id = ?').get(info.lastInsertRowid) as Record<
      string,
      unknown
    >;
    res.status(201).json(mapStudentRow(created));
  });

  app.put('/api/students/:id', authenticateToken, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }

    const { roll_no, full_name, branch, current_year, batch_code, minor_stream, is_detained } = req.body as Partial<Student>;
    const nextMinor =
      minor_stream !== undefined
        ? minor_stream.trim().toUpperCase() === 'NONE' || !minor_stream.trim()
          ? 'NONE'
          : minor_stream.trim()
        : String(existing.minor_stream);

    db.prepare(
      `UPDATE students SET roll_no = ?, full_name = ?, branch = ?, current_year = ?, batch_code = ?, minor_stream = ?, is_detained = ? WHERE id = ?`
    ).run(
      roll_no ? roll_no.trim().toUpperCase() : String(existing.roll_no),
      full_name ? full_name.trim() : String(existing.full_name),
      branch ? branch.trim().toUpperCase() : String(existing.branch),
      current_year !== undefined ? Number(current_year) : Number(existing.current_year),
      batch_code ? batch_code.trim() : String(existing.batch_code),
      nextMinor,
      is_detained !== undefined ? (is_detained ? 1 : 0) : Number(existing.is_detained),
      id
    );

    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'UPDATE_STUDENT',
      `Updated student ${roll_no || String(existing.roll_no)}`
    );

    const updated = db.prepare('SELECT * FROM students WHERE id = ?').get(id) as Record<string, unknown>;
    res.json(mapStudentRow(updated));
  });

  app.delete('/api/students/:id', authenticateToken, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT roll_no FROM students WHERE id = ?').get(id) as
      | { roll_no: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Student not found' });
      return;
    }
    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    logAudit(req.user!.id, req.user!.username, req.user!.role, 'DELETE_STUDENT', `Removed student ${existing.roll_no}`);
    res.json({ success: true });
  });

  app.get('/api/students/sample-excel', authenticateToken, async (req: AuthedRequest, res: Response) => {
    const customBranches =
      typeof req.query.branches === 'string' && req.query.branches.trim()
        ? req.query.branches.split(',').map((b) => b.trim().toUpperCase()).filter(Boolean)
        : ['CSE', 'ECE', 'EEE', 'IT', 'AIML', 'MECH', 'CIVIL'];

    const dbMinors = (
      db.prepare('SELECT name FROM minor_stream_options ORDER BY name ASC').all() as Array<{ name: string }>
    ).map((r) => r.name);

    const customMinors =
      typeof req.query.minors === 'string' && req.query.minors.trim()
        ? req.query.minors.split(',').map((m) => m.trim()).filter(Boolean)
        : dbMinors;

    const buf = await buildStudentTemplateWorkbook({
      branches: customBranches,
      minorStreams: customMinors,
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="aditya_students_template.xlsx"');
    res.send(buf);
  });

  app.post(
    '/api/students/upload',
    authenticateToken,
    upload.single('file'),
    (req: AuthedRequest, res: Response) => {
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

        const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheet], {
          defval: '',
        });

        if (rawRows.length === 0) {
          res.status(400).json({ error: 'Uploaded sheet is empty' });
          return;
        }

        const firstKeys = Object.keys(rawRows[0] || {}).map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ''));
        const hasRollKey = firstKeys.some((k) => ['rollno', 'htno', 'hallticket', 'regno'].includes(k));
        if (!hasRollKey) {
          res.status(400).json({
            error: 'Invalid template format: Missing "roll_no" column header. Download and use the official Student Roster template.',
          });
          return;
        }

        const upsertStmt = db.prepare(
          `INSERT INTO students (roll_no, full_name, branch, current_year, batch_code, minor_stream, is_detained)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(roll_no) DO UPDATE SET
             full_name = excluded.full_name,
             branch = excluded.branch,
             current_year = excluded.current_year,
             batch_code = excluded.batch_code,
             minor_stream = excluded.minor_stream,
             is_detained = excluded.is_detained`
        );

        let insertedOrUpdated = 0;
        let skipped = 0;

        const tx = db.transaction(() => {
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
            const rawMinor = (norm.minorstream || norm.minor || 'NONE').trim();
            const minorStream = rawMinor.toUpperCase() === 'NONE' || !rawMinor ? 'NONE' : rawMinor;
            const detainedRaw = (norm.isdetained || norm.detained || 'NO').toLowerCase();
            const isDetained = ['1', 'true', 'yes', 'y'].includes(detainedRaw) ? 1 : 0;

            upsertStmt.run(rollNo, fullName, branch, currentYear, batchCode, minorStream, isDetained);
            insertedOrUpdated++;
          }
        });
        tx();

        logAudit(
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
    }
  );

  // ==================== MINOR STREAM CATALOG ROUTES ====================
  app.get('/api/minor-streams', authenticateToken, (_req: AuthedRequest, res: Response) => {
    const rows = db.prepare('SELECT * FROM minor_stream_options ORDER BY branch ASC, name ASC').all();
    res.json(rows);
  });

  app.post('/api/minor-streams', authenticateToken, (req: AuthedRequest, res: Response) => {
    const { branch, name, code } = req.body as { branch?: string; name?: string; code?: string };
    if (!name?.trim() || !code?.trim()) {
      res.status(400).json({ error: 'Minor stream name and code are required' });
      return;
    }
    const existing = db.prepare('SELECT id FROM minor_stream_options WHERE lower(name) = lower(?)').get(name.trim());
    if (existing) {
      res.status(409).json({ error: `Minor stream "${name.trim()}" already exists` });
      return;
    }
    const info = db
      .prepare('INSERT INTO minor_stream_options (branch, name, code) VALUES (?, ?, ?)')
      .run((branch || 'ALL').trim().toUpperCase(), name.trim(), code.trim().toUpperCase());
    const created = db.prepare('SELECT * FROM minor_stream_options WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  });

  app.delete('/api/minor-streams/:id', authenticateToken, (req: AuthedRequest, res: Response) => {
    db.prepare('DELETE FROM minor_stream_options WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });

  // ==================== SCHEDULED SUBJECTS / TIMETABLE ROUTES ====================
  app.get('/api/subjects', authenticateToken, (_req: AuthedRequest, res: Response) => {
    const rows = db
      .prepare('SELECT * FROM scheduled_subjects ORDER BY exam_date ASC, session_slot ASC, academic_year ASC, course_code ASC')
      .all();
    res.json(rows);
  });

  app.post('/api/subjects', authenticateToken, (req: AuthedRequest, res: Response) => {
    const { course_code, course_name, academic_year, branch, exam_date, session_slot } = req.body as {
      course_code?: string;
      course_name?: string;
      academic_year?: number;
      branch?: string;
      exam_date?: string;
      session_slot?: SessionSlot;
    };
    if (!course_code?.trim() || !course_name?.trim() || !exam_date?.trim() || !session_slot) {
      res.status(400).json({ error: 'Course code, course name, exam date, and session (FN/AN) are required' });
      return;
    }
    const yr = Math.min(4, Math.max(1, Number(academic_year) || 2));
    const info = db
      .prepare(
        `INSERT INTO scheduled_subjects (course_code, course_name, academic_year, branch, exam_date, session_slot)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        course_code.trim().toUpperCase(),
        course_name.trim(),
        yr,
        (branch || 'ALL').trim().toUpperCase(),
        normalizeExamDate(exam_date) || exam_date.trim(),
        session_slot === 'AN' ? 'AN' : 'FN'
      );
    const created = db.prepare('SELECT * FROM scheduled_subjects WHERE id = ?').get(info.lastInsertRowid);
    res.status(201).json(created);
  });

  app.delete('/api/subjects/:id', authenticateToken, (req: AuthedRequest, res: Response) => {
    db.prepare('DELETE FROM scheduled_subjects WHERE id = ?').run(Number(req.params.id));
    res.json({ success: true });
  });

  app.get('/api/subjects/template-excel', authenticateToken, async (_req: AuthedRequest, res: Response) => {
    const buf = await buildTimetableTemplateWorkbook(['CSE', 'ECE', 'EEE', 'IT', 'AIML', 'MECH', 'CIVIL']);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="aditya_timetable_template.xlsx"');
    res.send(buf);
  });

  app.post('/api/subjects/upload', authenticateToken, upload.single('file'), (req: AuthedRequest, res: Response) => {
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
      const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[firstSheet], { defval: '' });
      if (rawRows.length === 0) {
        res.status(400).json({ error: 'Uploaded timetable sheet is empty' });
        return;
      }

      const firstKeys = Object.keys(rawRows[0] || {}).map((k) => k.toLowerCase().replace(/[^a-z0-9]/g, ''));
      if (!firstKeys.some((k) => k.includes('coursecode')) || !firstKeys.some((k) => k.includes('coursename'))) {
        res.status(400).json({
          error: 'Invalid timetable template: Missing "Course Code" and "Course Name" column headers.',
        });
        return;
      }

      const insertStmt = db.prepare(
        `INSERT INTO scheduled_subjects (course_code, course_name, academic_year, branch, exam_date, session_slot)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      let count = 0;
      const fallbackYear = Math.min(4, Math.max(1, Number(req.body?.default_year) || 2));

      const tx = db.transaction(() => {
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

          insertStmt.run(code, name, yr, branch, lastDate, lastSlot);
          count++;
        }
      });
      tx();

      logAudit(req.user!.id, req.user!.username, req.user!.role, 'UPLOAD_TIMETABLE', `Imported ${count} scheduled subjects from "${req.file.originalname}"`);
      res.json({ success: true, imported: count });
    } catch (err) {
      res.status(400).json({ error: `Failed to parse timetable: ${(err as Error).message}` });
    }
  });

  app.post('/api/students/promote-year', authenticateToken, (req: AuthedRequest, res: Response) => {
    const { from_year, branch } = req.body as { from_year: number; branch?: string };
    const yr = Number(from_year);
    if (![1, 2, 3].includes(yr)) {
      res.status(400).json({ error: 'Can promote cohorts from Year 1, 2, or 3 only' });
      return;
    }

    const toYear = yr + 1;
    let changes = 0;
    if (branch && branch !== 'ALL') {
      const info = db
        .prepare('UPDATE students SET current_year = ? WHERE current_year = ? AND branch = ? AND is_detained = 0')
        .run(toYear, yr, branch.toUpperCase());
      changes = info.changes;
    } else {
      const info = db
        .prepare('UPDATE students SET current_year = ? WHERE current_year = ? AND is_detained = 0')
        .run(toYear, yr);
      changes = info.changes;
    }

    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'PROMOTE_YEAR',
      `Promoted ${changes} active students (${branch || 'ALL'}) from Year ${yr} to Year ${toYear}`
    );

    res.json({ success: true, promoted_count: changes, from_year: yr, to_year: toYear });
  });

  // ==================== HALL & LAB CONFIGURATOR ROUTES ====================
  app.get('/api/halls', authenticateToken, (_req: AuthedRequest, res: Response) => {
    const rows = db.prepare('SELECT * FROM halls ORDER BY building_code ASC, room_no ASC').all() as Array<
      Record<string, unknown>
    >;
    res.json(rows.map(mapHallRow));
  });

  app.post('/api/halls', authenticateToken, (req: AuthedRequest, res: Response) => {
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

    const pattern = parseBenchPattern(bench_pattern, Number(grid_cols) || 9, Number(bench_capacity) || 3);
    const computedCols = pattern.reduce((s, n) => s + n, 0);
    const maxBenchCap = Math.max(...pattern);
    const cleanRoom = room_no.trim().toUpperCase();
    const existing = db.prepare('SELECT id FROM halls WHERE room_no = ?').get(cleanRoom);
    if (existing) {
      res.status(409).json({ error: `Hall ${cleanRoom} already exists` });
      return;
    }

    const totalCapacity = Number(grid_rows) * computedCols;
    const info = db
      .prepare(
        `INSERT INTO halls (building_code, building_name, floor, room_no, room_type, grid_rows, grid_cols, bench_capacity, bench_pattern, total_capacity, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        building_code.trim().toUpperCase(),
        (building_name || 'RATAN TATA BHAVAN').trim().toUpperCase(),
        (floor || 'II FLOOR').trim().toUpperCase(),
        cleanRoom,
        room_type,
        Number(grid_rows),
        computedCols,
        maxBenchCap,
        JSON.stringify(pattern),
        totalCapacity
      );

    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'ADD_HALL',
      `Configured ${room_type} ${cleanRoom} (${grid_rows}×[${pattern.join('-')}] = ${totalCapacity} seats)`
    );

    const created = db.prepare('SELECT * FROM halls WHERE id = ?').get(info.lastInsertRowid) as Record<
      string,
      unknown
    >;
    res.status(201).json(mapHallRow(created));
  });

  app.put('/api/halls/:id', authenticateToken, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM halls WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
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
        ? parseBenchPattern(bench_pattern, Number(grid_cols) || Number(existing.grid_cols), Number(bench_capacity) || Number(existing.bench_capacity))
        : existingPattern;
    const nextCols = nextPattern.reduce((s, n) => s + n, 0);
    const nextBenchCap = Math.max(...nextPattern);
    const totalCapacity = nextRows * nextCols;

    db.prepare(
      `UPDATE halls SET building_code = ?, building_name = ?, floor = ?, room_no = ?, room_type = ?, grid_rows = ?, grid_cols = ?, bench_capacity = ?, bench_pattern = ?, total_capacity = ?, is_active = ? WHERE id = ?`
    ).run(
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
      id
    );

    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'UPDATE_HALL',
      `Updated hall ${room_no || String(existing.room_no)}`
    );

    const updated = db.prepare('SELECT * FROM halls WHERE id = ?').get(id) as Record<string, unknown>;
    res.json(mapHallRow(updated));
  });

  app.delete('/api/halls/:id', authenticateToken, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT room_no FROM halls WHERE id = ?').get(id) as
      | { room_no: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Hall not found' });
      return;
    }
    db.prepare('DELETE FROM halls WHERE id = ?').run(id);
    logAudit(req.user!.id, req.user!.username, req.user!.role, 'DELETE_HALL', `Removed hall ${existing.room_no}`);
    res.json({ success: true });
  });

  // ==================== EXAM SESSIONS & SEATING ENGINE ====================
  app.get('/api/exams', authenticateToken, (_req: AuthedRequest, res: Response) => {
    const rows = db.prepare('SELECT * FROM exam_sessions ORDER BY id DESC').all() as Array<Record<string, unknown>>;
    res.json(rows.map(mapExamSessionRow));
  });

  app.post('/api/exams', authenticateToken, (req: AuthedRequest, res: Response) => {
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

    const info = db
      .prepare(
        `INSERT INTO exam_sessions (
          exam_title, department, exam_date, session_slot, session_timing,
          target_years, target_branches, seating_mode, minor_stream_filter,
          subject_mapping, selected_subject_ids, selected_hall_ids, layout_config, status, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?)`
      )
      .run(
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
        req.user!.id
      );

    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'CREATE_EXAM',
      `Created exam schedule "${exam_title.trim()}" (${exam_date} ${session_slot})`
    );

    const created = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(info.lastInsertRowid) as Record<
      string,
      unknown
    >;
    res.status(201).json(mapExamSessionRow(created));
  });

  app.put('/api/exams/:id', authenticateToken, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    const existingRow = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) {
      res.status(404).json({ error: 'Exam session not found' });
      return;
    }

    const existing = mapExamSessionRow(existingRow);
    const body = req.body as Partial<ExamSession>;

    db.prepare(
      `UPDATE exam_sessions SET
        exam_title = ?, department = ?, exam_date = ?, session_slot = ?, session_timing = ?,
        target_years = ?, target_branches = ?, seating_mode = ?, minor_stream_filter = ?,
        subject_mapping = ?, selected_subject_ids = ?, selected_hall_ids = ?, layout_config = ?
       WHERE id = ?`
    ).run(
      body.exam_title ?? existing.exam_title,
      body.department ?? existing.department,
      body.exam_date ?? existing.exam_date,
      body.session_slot ?? existing.session_slot,
      body.session_timing ?? existing.session_timing,
      JSON.stringify(body.target_years ?? existing.target_years),
      JSON.stringify(body.target_branches ?? existing.target_branches),
      body.seating_mode ?? existing.seating_mode,
      body.minor_stream_filter !== undefined ? body.minor_stream_filter : existing.minor_stream_filter,
      JSON.stringify(body.subject_mapping ?? existing.subject_mapping),
      JSON.stringify(body.selected_subject_ids ?? existing.selected_subject_ids),
      JSON.stringify(body.selected_hall_ids ?? existing.selected_hall_ids),
      JSON.stringify(body.layout_config ?? existing.layout_config),
      id
    );

    const updated = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(id) as Record<string, unknown>;
    res.json(mapExamSessionRow(updated));
  });

  app.delete('/api/exams/:id', authenticateToken, (req: AuthedRequest, res: Response) => {
    const id = Number(req.params.id);
    db.prepare('DELETE FROM exam_sessions WHERE id = ?').run(id);
    logAudit(req.user!.id, req.user!.username, req.user!.role, 'DELETE_EXAM', `Deleted exam session #${id}`);
    res.json({ success: true });
  });

  app.post('/api/exams/validate-capacity', authenticateToken, (req: AuthedRequest, res: Response) => {
    const { target_years, target_branches, seating_mode, minor_stream_filter, selected_hall_ids, layout_config } =
      req.body as {
        target_years: number[];
        target_branches: string[];
        seating_mode: SeatingMode;
        minor_stream_filter: string | null;
        selected_hall_ids: number[];
        layout_config?: ExamLayoutConfig;
      };

    const studentRows = db.prepare('SELECT * FROM students').all() as Array<Record<string, unknown>>;
    const students = studentRows.map(mapStudentRow);

    const hallRows = db.prepare('SELECT * FROM halls WHERE is_active = 1').all() as Array<Record<string, unknown>>;
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
      layout_config
    );
    res.json(result);
  });

  app.post('/api/exams/:id/allocate', authenticateToken, (req: AuthedRequest, res: Response) => {
    const examId = Number(req.params.id);
    const sessionRow = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(examId) as
      | Record<string, unknown>
      | undefined;

    if (!sessionRow) {
      res.status(404).json({ error: 'Exam session not found' });
      return;
    }

    const body = req.body as Partial<ExamSession>;
    if (Object.keys(body).length > 0) {
      const current = mapExamSessionRow(sessionRow);
      db.prepare(
        `UPDATE exam_sessions SET
          seating_mode = ?, minor_stream_filter = ?, target_years = ?,
          target_branches = ?, selected_hall_ids = ?, subject_mapping = ?,
          selected_subject_ids = ?, layout_config = ?
         WHERE id = ?`
      ).run(
        body.seating_mode ?? current.seating_mode,
        body.minor_stream_filter !== undefined ? body.minor_stream_filter : current.minor_stream_filter,
        JSON.stringify(body.target_years ?? current.target_years),
        JSON.stringify(body.target_branches ?? current.target_branches),
        JSON.stringify(body.selected_hall_ids ?? current.selected_hall_ids),
        JSON.stringify(body.subject_mapping ?? current.subject_mapping),
        JSON.stringify(body.selected_subject_ids ?? current.selected_subject_ids),
        JSON.stringify(body.layout_config ?? current.layout_config),
        examId
      );
    }

    const freshSessionRow = db.prepare('SELECT * FROM exam_sessions WHERE id = ?').get(examId) as Record<
      string,
      unknown
    >;
    const session = mapExamSessionRow(freshSessionRow);

    const students = (db.prepare('SELECT * FROM students').all() as Array<Record<string, unknown>>).map(
      mapStudentRow
    );
    const allHalls = (
      db.prepare('SELECT * FROM halls WHERE is_active = 1').all() as Array<Record<string, unknown>>
    ).map(mapHallRow);
    const selectedHalls = session.selected_hall_ids
      .map((hid) => allHalls.find((h) => h.id === hid))
      .filter((h): h is Hall => Boolean(h));

    if (selectedHalls.length === 0) {
      res.status(400).json({ error: 'Please select at least one hall before running the seating engine.' });
      return;
    }

    const prevAllocs = db
      .prepare('SELECT * FROM hall_allocations WHERE exam_session_id = ?')
      .all(examId) as Array<Record<string, unknown>>;
    const prevByHall = new Map<number, Record<string, unknown>>();
    for (const pa of prevAllocs) {
      prevByHall.set(Number(pa.hall_id), pa);
    }

    const computed = allocateSeatingMatrices(
      students,
      selectedHalls,
      session.target_years,
      session.target_branches,
      session.seating_mode,
      session.minor_stream_filter,
      session.layout_config
    );

    if (computed.length === 0) {
      res.status(400).json({ error: 'No eligible students found for the selected cohorts.' });
      return;
    }

    const insertAlloc = db.prepare(
      `INSERT INTO hall_allocations (
        exam_session_id, hall_id, sort_order, allocated_count,
        invigilator_1_name, invigilator_1_emp_id, invigilator_1_willing,
        invigilator_2_name, invigilator_2_emp_id, invigilator_2_willing,
        column_headers
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const insertCell = db.prepare(
      `INSERT INTO seat_cells (
        allocation_id, row_index, col_index, bench_group, sub_seat_index,
        cohort_label, student_id, roll_no_snapshot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const tx = db.transaction(() => {
      db.prepare('DELETE FROM hall_allocations WHERE exam_session_id = ?').run(examId);

      for (const roomAlloc of computed) {
        const prev = prevByHall.get(roomAlloc.hall.id);
        const info = insertAlloc.run(
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
          JSON.stringify(roomAlloc.column_headers)
        );
        const allocId = Number(info.lastInsertRowid);

        for (const cell of roomAlloc.cells) {
          insertCell.run(
            allocId,
            cell.row_index,
            cell.col_index,
            cell.bench_group,
            cell.sub_seat_index,
            cell.cohort_label,
            cell.student_id,
            cell.roll_no_snapshot
          );
        }
      }

      db.prepare("UPDATE exam_sessions SET status = 'ALLOCATED' WHERE id = ?").run(examId);
    });
    tx();

    const totalSeated = computed.reduce((sum, r) => sum + r.allocated_count, 0);
    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'RUN_SEATING_ENGINE',
      `Allocated ${totalSeated} students across ${computed.length} halls for "${session.exam_title}" (${session.seating_mode})`
    );

    const loaded = loadSessionAllocations(examId);
    const summaryRows = loaded.session ? buildMasterSummaryRows(loaded.session, loaded.allocations) : [];
    res.json({ ...loaded, summary_rows: summaryRows });
  });

  app.get('/api/exams/:id/allocations', authenticateToken, (req: AuthedRequest, res: Response) => {
    const examId = Number(req.params.id);
    const loaded = loadSessionAllocations(examId);
    if (!loaded.session) {
      res.status(404).json({ error: 'Exam session not found' });
      return;
    }
    const summaryRows = buildMasterSummaryRows(loaded.session, loaded.allocations);
    res.json({ ...loaded, summary_rows: summaryRows });
  });

  app.post('/api/exams/:id/willingness', authenticateToken, (req: AuthedRequest, res: Response) => {
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

    const updateStmt = db.prepare(
      `UPDATE hall_allocations SET
        invigilator_1_name = ?, invigilator_1_emp_id = ?, invigilator_1_willing = ?,
        invigilator_2_name = ?, invigilator_2_emp_id = ?, invigilator_2_willing = ?
       WHERE id = ? AND exam_session_id = ?`
    );

    const tx = db.transaction(() => {
      for (const a of assignments) {
        updateStmt.run(
          (a.invigilator_1_name || '').trim(),
          (a.invigilator_1_emp_id || '').trim(),
          a.invigilator_1_willing ? 1 : 0,
          (a.invigilator_2_name || '').trim(),
          (a.invigilator_2_emp_id || '').trim(),
          a.invigilator_2_willing ? 1 : 0,
          a.allocation_id,
          examId
        );
      }
      db.prepare("UPDATE exam_sessions SET status = 'FINALIZED' WHERE id = ?").run(examId);
    });
    tx();

    logAudit(
      req.user!.id,
      req.user!.username,
      req.user!.role,
      'SAVE_WILLINGNESS',
      `Updated invigilator willingness roster for ${assignments.length} halls in exam #${examId}`
    );

    const loaded = loadSessionAllocations(examId);
    res.json(loaded);
  });

  // ==================== INVIGILATION WILLINGNESS TEMPLATE & UPLOAD ROUTES ====================
  app.get('/api/willingness/template-excel', authenticateToken, async (req: AuthedRequest, res: Response) => {
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

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="aditya_willingness_template.xlsx"');
    res.send(buf);
  });

  app.get('/api/willingness', authenticateToken, (req: AuthedRequest, res: Response) => {
    const date = typeof req.query.date === 'string' ? req.query.date.trim() : '';
    const slot = typeof req.query.slot === 'string' ? req.query.slot.trim().toUpperCase() : '';

    let rows;
    if (date && (slot === 'FN' || slot === 'AN')) {
      rows = db
        .prepare(
          `SELECT * FROM faculty_willingness WHERE exam_date = ? AND session_slot = ? ORDER BY willing DESC, faculty_name ASC`
        )
        .all(date, slot);
    } else if (date) {
      rows = db
        .prepare(
          `SELECT * FROM faculty_willingness WHERE exam_date = ? ORDER BY session_slot ASC, willing DESC, faculty_name ASC`
        )
        .all(date);
    } else {
      rows = db
        .prepare(`SELECT * FROM faculty_willingness ORDER BY exam_date ASC, session_slot ASC, faculty_name ASC`)
        .all();
    }
    res.json(rows);
  });

  app.post(
    '/api/willingness/upload',
    authenticateToken,
    upload.single('file'),
    (req: AuthedRequest, res: Response) => {
      if (!req.file) {
        res.status(400).json({ error: 'Willingness Excel file is required' });
        return;
      }

      try {
        const parsed = parseAndValidateWillingnessWorkbook(req.file.buffer);
        const upsertStmt = db.prepare(
          `INSERT INTO faculty_willingness (department, exam_title, emp_id, faculty_name, designation, exam_date, session_slot, willing)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(emp_id, exam_date, session_slot) DO UPDATE SET
             department = excluded.department,
             exam_title = excluded.exam_title,
             faculty_name = excluded.faculty_name,
             designation = excluded.designation,
             willing = excluded.willing,
             uploaded_at = datetime('now')`
        );

        const tx = db.transaction(() => {
          for (const e of parsed.entries) {
            upsertStmt.run(
              e.department,
              e.exam_title,
              e.emp_id,
              e.faculty_name,
              e.designation,
              e.exam_date,
              e.session_slot,
              e.willing
            );
          }
        });
        tx();

        const willingCount = parsed.entries.filter((e) => e.willing === 'YES').length;
        logAudit(
          req.user!.id,
          req.user!.username,
          req.user!.role,
          'UPLOAD_WILLINGNESS',
          `Uploaded "${req.file.originalname}": ${parsed.entries.length} slot entries (${willingCount} YES) across ${parsed.dates.join(', ')}`
        );

        res.json({
          success: true,
          total_entries: parsed.entries.length,
          willing_yes_count: willingCount,
          dates: parsed.dates,
          department: parsed.department,
        });
      } catch (err) {
        res.status(400).json({ error: (err as Error).message });
      }
    }
  );

  app.delete('/api/willingness', authenticateToken, (req: AuthedRequest, res: Response) => {
    db.prepare('DELETE FROM faculty_willingness').run();
    logAudit(req.user!.id, req.user!.username, req.user!.role, 'CLEAR_WILLINGNESS', 'Cleared uploaded faculty willingness records');
    res.json({ success: true });
  });

  // ==================== OFFICIAL PDF EXPORT ROUTES ====================
  app.get('/api/exams/:id/pdf/master', authenticateToken, async (req: AuthedRequest, res: Response) => {
    const examId = Number(req.params.id);
    const includeSubject = req.query.includeSubject !== 'false';
    const { session, allocations } = loadSessionAllocations(examId);

    if (!session || allocations.length === 0) {
      res.status(404).json({ error: 'No seating allocations found for this exam session' });
      return;
    }

    const pdfBuf = await generateMasterPdfBuffer(session, allocations, includeSubject);
    logAudit(
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
  });

  app.get('/api/exams/:id/pdf/rooms', authenticateToken, async (req: AuthedRequest, res: Response) => {
    const examId = Number(req.params.id);
    const { session, allocations } = loadSessionAllocations(examId);

    if (!session || allocations.length === 0) {
      res.status(404).json({ error: 'No seating allocations found for this exam session' });
      return;
    }

    const pdfBuf = await generateRoomsPdfBuffer(session, allocations);
    logAudit(
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
  });

  app.get('/api/exams/:id/pdf/bundle', authenticateToken, async (req: AuthedRequest, res: Response) => {
    const examId = Number(req.params.id);
    const includeSubject = req.query.includeSubject !== 'false';
    const { session, allocations } = loadSessionAllocations(examId);

    if (!session || allocations.length === 0) {
      res.status(404).json({ error: 'No seating allocations found for this exam session' });
      return;
    }

    const pdfBuf = await generateBundlePdfBuffer(session, allocations, includeSubject);
    logAudit(
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
  });

  app.get('/api/exams/:id/pdf/attendance', authenticateToken, async (req: AuthedRequest, res: Response) => {
    const examId = Number(req.params.id);
    const { session, allocations } = loadSessionAllocations(examId);

    if (!session || allocations.length === 0) {
      res.status(404).json({ error: 'No seating allocations found for this exam session' });
      return;
    }

    const studentRows = db.prepare('SELECT roll_no, full_name FROM students').all() as Array<{
      roll_no: string;
      full_name: string;
    }>;
    const nameMap = new Map<string, string>();
    for (const st of studentRows) {
      nameMap.set(st.roll_no, st.full_name);
    }

    const pdfBuf = await generateAttendancePdfBuffer(session, allocations, nameMap);
    logAudit(
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
  });

  app.get('/api/exams/:id/pdf/proforma', authenticateToken, async (req: AuthedRequest, res: Response) => {
    const examId = Number(req.params.id);
    const { session, allocations } = loadSessionAllocations(examId);

    if (!session || allocations.length === 0) {
      res.status(404).json({ error: 'No seating allocations found for this exam session' });
      return;
    }

    const pdfBuf = await generateProformaPdfBuffer(session, allocations);
    logAudit(
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
  });

  // ==================== VITE / STATIC SERVING ====================
  const distDir = path.resolve(process.cwd(), 'dist');
  const isProd = process.env.NODE_ENV === 'production' && fs.existsSync(distDir);

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Aditya University Exam Portal running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
