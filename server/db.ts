import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'aditya_exam.db');
export const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(table: string, col: string): boolean {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return cols.some((c) => c.name === col);
}

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      emp_id TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT 'Examination Cell',
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'EXAMINER')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      roll_no TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      current_year INTEGER NOT NULL CHECK(current_year BETWEEN 1 AND 4),
      batch_code TEXT NOT NULL DEFAULT '2025-2029',
      minor_stream TEXT NOT NULL DEFAULT 'NONE',
      is_detained INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS minor_stream_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      branch TEXT NOT NULL DEFAULT 'CSE',
      name TEXT UNIQUE NOT NULL,
      code TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_code TEXT NOT NULL,
      course_name TEXT NOT NULL,
      academic_year INTEGER NOT NULL CHECK(academic_year BETWEEN 1 AND 4),
      branch TEXT NOT NULL DEFAULT 'ALL',
      exam_date TEXT NOT NULL,
      session_slot TEXT NOT NULL CHECK(session_slot IN ('FN', 'AN')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS faculty_willingness (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department TEXT NOT NULL DEFAULT '',
      exam_title TEXT NOT NULL DEFAULT '',
      emp_id TEXT NOT NULL,
      faculty_name TEXT NOT NULL,
      designation TEXT NOT NULL DEFAULT '',
      exam_date TEXT NOT NULL,
      session_slot TEXT NOT NULL CHECK(session_slot IN ('FN', 'AN')),
      willing TEXT NOT NULL CHECK(willing IN ('YES', 'NO')),
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(emp_id, exam_date, session_slot)
    );

    CREATE TABLE IF NOT EXISTS halls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      building_code TEXT NOT NULL,
      building_name TEXT NOT NULL DEFAULT 'RATAN TATA BHAVAN',
      floor TEXT NOT NULL DEFAULT 'II FLOOR',
      room_no TEXT UNIQUE NOT NULL,
      room_type TEXT NOT NULL CHECK(room_type IN ('CLASSROOM', 'LAB')),
      grid_rows INTEGER NOT NULL,
      grid_cols INTEGER NOT NULL,
      bench_capacity INTEGER NOT NULL,
      bench_pattern TEXT NOT NULL DEFAULT '[3,3,3]',
      total_capacity INTEGER NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS exam_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_title TEXT NOT NULL,
      department TEXT NOT NULL,
      exam_date TEXT NOT NULL,
      session_slot TEXT NOT NULL CHECK(session_slot IN ('FN', 'AN')),
      session_timing TEXT NOT NULL,
      target_years TEXT NOT NULL DEFAULT '[2,3]',
      target_branches TEXT NOT NULL DEFAULT '["CSE"]',
      seating_mode TEXT NOT NULL CHECK(seating_mode IN ('INTERLEAVED', 'SINGLE_YEAR_CORNERS', 'SEQUENTIAL', 'MINOR_STREAM')),
      minor_stream_filter TEXT,
      subject_mapping TEXT NOT NULL DEFAULT '{}',
      selected_subject_ids TEXT NOT NULL DEFAULT '[]',
      selected_hall_ids TEXT NOT NULL DEFAULT '[]',
      layout_config TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'ALLOCATED', 'FINALIZED')),
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hall_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_session_id INTEGER NOT NULL REFERENCES exam_sessions(id) ON DELETE CASCADE,
      hall_id INTEGER NOT NULL REFERENCES halls(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      allocated_count INTEGER NOT NULL DEFAULT 0,
      invigilator_1_name TEXT NOT NULL DEFAULT '',
      invigilator_1_emp_id TEXT NOT NULL DEFAULT '',
      invigilator_1_willing INTEGER NOT NULL DEFAULT 0,
      invigilator_2_name TEXT NOT NULL DEFAULT '',
      invigilator_2_emp_id TEXT NOT NULL DEFAULT '',
      invigilator_2_willing INTEGER NOT NULL DEFAULT 0,
      column_headers TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS seat_cells (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      allocation_id INTEGER NOT NULL REFERENCES hall_allocations(id) ON DELETE CASCADE,
      row_index INTEGER NOT NULL,
      col_index INTEGER NOT NULL,
      bench_group INTEGER NOT NULL,
      sub_seat_index INTEGER NOT NULL,
      cohort_label TEXT NOT NULL DEFAULT '',
      student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
      roll_no_snapshot TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      action_type TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS contact_inquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender_name TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      utm_source TEXT DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Safe schema migrations for existing SQLite files
  if (!hasColumn('halls', 'bench_pattern')) {
    db.exec(`ALTER TABLE halls ADD COLUMN bench_pattern TEXT NOT NULL DEFAULT '[3,3,3]'`);
    db.exec(`UPDATE halls SET bench_pattern = '[2,2,2,2]' WHERE room_type = 'LAB' AND grid_cols = 8`);
  }

  if (!hasColumn('exam_sessions', 'layout_config')) {
    // Recreate exam_sessions cleanly to update CHECK constraint on seating_mode and add new columns
    db.pragma('foreign_keys = OFF');
    const migrateTx = db.transaction(() => {
      db.exec(`
        CREATE TABLE exam_sessions_v2 (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          exam_title TEXT NOT NULL,
          department TEXT NOT NULL,
          exam_date TEXT NOT NULL,
          session_slot TEXT NOT NULL CHECK(session_slot IN ('FN', 'AN')),
          session_timing TEXT NOT NULL,
          target_years TEXT NOT NULL DEFAULT '[2,3]',
          target_branches TEXT NOT NULL DEFAULT '["CSE"]',
          seating_mode TEXT NOT NULL CHECK(seating_mode IN ('INTERLEAVED', 'SINGLE_YEAR_CORNERS', 'SEQUENTIAL', 'MINOR_STREAM')),
          minor_stream_filter TEXT,
          subject_mapping TEXT NOT NULL DEFAULT '{}',
          selected_subject_ids TEXT NOT NULL DEFAULT '[]',
          selected_hall_ids TEXT NOT NULL DEFAULT '[]',
          layout_config TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT', 'ALLOCATED', 'FINALIZED')),
          created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO exam_sessions_v2 (
          id, exam_title, department, exam_date, session_slot, session_timing,
          target_years, target_branches, seating_mode, minor_stream_filter,
          subject_mapping, selected_hall_ids, status, created_by, created_at
        )
        SELECT id, exam_title, department, exam_date, session_slot, session_timing,
               target_years, target_branches, seating_mode, minor_stream_filter,
               subject_mapping, selected_hall_ids, status, created_by, created_at
        FROM exam_sessions;
        DROP TABLE exam_sessions;
        ALTER TABLE exam_sessions_v2 RENAME TO exam_sessions;
      `);
    });
    migrateTx();
    db.pragma('foreign_keys = ON');
  }

  seedRequiredAccountsAndConfig();
}

export function logAudit(
  userId: number | null,
  username: string,
  role: string,
  actionType: string,
  details: string
) {
  db.prepare(
    `INSERT INTO audit_logs (user_id, username, role, action_type, details) VALUES (?, ?, ?, ?, ?)`
  ).run(userId, username, role, actionType, details);
}

function seedRequiredAccountsAndConfig() {
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as { c: number }).c;
  if (userCount === 0) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    const examinerHash = bcrypt.hashSync('exam@123', 10);

    const insertUser = db.prepare(
      `INSERT INTO users (username, password_hash, full_name, emp_id, department, role, is_active) VALUES (?, ?, ?, ?, ?, ?, 1)`
    );
    insertUser.run('admin', adminHash, 'System Administrator', 'AU-ADMIN', 'Examination Cell', 'ADMIN');
    insertUser.run('examiner', examinerHash, 'Examination Coordinator', 'AU-EXAM', 'Examination Cell', 'EXAMINER');
  }

  const hallCount = (db.prepare('SELECT COUNT(*) as c FROM halls').get() as { c: number }).c;
  if (hallCount === 0) {
    const insertHall = db.prepare(
      `INSERT INTO halls (building_code, building_name, floor, room_no, room_type, grid_rows, grid_cols, bench_capacity, bench_pattern, total_capacity, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    );
    insertHall.run('RTB', 'RATAN TATA BHAVAN', 'II FLOOR', 'RTB-202', 'CLASSROOM', 6, 9, 3, '[3,3,3]', 54);
    insertHall.run('RTB', 'RATAN TATA BHAVAN', 'II FLOOR', 'RTB-203', 'CLASSROOM', 6, 9, 3, '[3,3,3]', 54);
    insertHall.run('RTB', 'RATAN TATA BHAVAN', 'II FLOOR', 'RTB-204', 'CLASSROOM', 6, 9, 3, '[3,3,3]', 54);
    insertHall.run('RTB', 'RATAN TATA BHAVAN', 'II FLOOR', 'RTB-205', 'CLASSROOM', 6, 9, 3, '[3,3,3]', 54);
    insertHall.run('RB', 'RAMANUJAN BHAVAN', 'I FLOOR', 'RB-123', 'LAB', 9, 8, 2, '[2,2,2,2]', 72);
    insertHall.run('RB', 'RAMANUJAN BHAVAN', 'I FLOOR', 'RB-127', 'LAB', 9, 8, 2, '[2,2,2,2]', 72);
  }

  const minorCount = (db.prepare('SELECT COUNT(*) as c FROM minor_stream_options').get() as { c: number }).c;
  if (minorCount === 0) {
    const insertMinor = db.prepare(
      `INSERT INTO minor_stream_options (branch, name, code) VALUES (?, ?, ?)`
    );
    insertMinor.run('CSE', 'Machine Intelligence', 'MI');
    insertMinor.run('CSE', 'Data Engineering', 'DE');
    insertMinor.run('CSE', 'Network Security', 'NS');
    insertMinor.run('ALL', 'SAP', 'SAP');
  }
}
