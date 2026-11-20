import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';

/**
 * Normalizes a PostgreSQL connection string so passwords containing unencoded '@'
 * characters still parse cleanly in pg/node URL parsers.
 */
function normalizePgConnectionString(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const match = trimmed.match(/^(postgres(?:ql)?:\/\/)([^:/]+):(.+)@([^@/?#]+(?::\d+)?\/.*)$/i);
  if (!match) return trimmed;
  const [, scheme, user, password, hostAndDb] = match;
  const safePassword = password.includes('@') ? encodeURIComponent(decodeSafe(password)) : password;
  return `${scheme}${user}:${safePassword}@${hostAndDb}`;
}

function decodeSafe(val: string): string {
  try {
    return decodeURIComponent(val);
  } catch {
    return val;
  }
}

const rawDatabaseUrl = process.env.DATABASE_URL || '';
if (!rawDatabaseUrl) {
  throw new Error(
    'DATABASE_URL environment variable is required to connect to Supabase PostgreSQL.'
  );
}

const connectionString = normalizePgConnectionString(rawDatabaseUrl);

export const pool = new Pool({
  connectionString,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 15000,
});

// Optional Supabase JS v2 Admin Client (server-side only)
function resolveSupabaseUrl(dbUrl: string): string {
  if (process.env.SUPABASE_URL?.trim()) return process.env.SUPABASE_URL.trim();
  const refMatch = dbUrl.match(/postgres\.([a-z0-9]+)/i);
  return refMatch ? `https://${refMatch[1]}.supabase.co` : '';
}

const supabaseUrl = resolveSupabaseUrl(rawDatabaseUrl);
const supabaseSecretKey =
  process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || '';

export const supabaseAdmin: SupabaseClient | null =
  supabaseUrl && supabaseSecretKey
    ? createClient(supabaseUrl, supabaseSecretKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

export async function queryAll<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const result = await pool.query<T>(sql, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T | undefined> {
  const result = await pool.query<T>(sql, params);
  return result.rows[0];
}

export async function execute(
  sql: string,
  params: unknown[] = []
): Promise<{ rowCount: number; rows: Record<string, unknown>[] }> {
  const result = await pool.query(sql, params);
  return { rowCount: result.rowCount ?? 0, rows: result.rows };
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function initDatabase(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      emp_id TEXT NOT NULL,
      department TEXT NOT NULL DEFAULT 'Examination Cell',
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'EXAMINER')),
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS students (
      id SERIAL PRIMARY KEY,
      roll_no TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      branch TEXT NOT NULL,
      current_year INTEGER NOT NULL CHECK(current_year BETWEEN 1 AND 4),
      batch_code TEXT NOT NULL DEFAULT '2025-2029',
      minor_stream TEXT NOT NULL DEFAULT 'NONE',
      is_detained INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS minor_stream_options (
      id SERIAL PRIMARY KEY,
      branch TEXT NOT NULL DEFAULT 'CSE',
      name TEXT UNIQUE NOT NULL,
      code TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_subjects (
      id SERIAL PRIMARY KEY,
      course_code TEXT NOT NULL,
      course_name TEXT NOT NULL,
      academic_year INTEGER NOT NULL CHECK(academic_year BETWEEN 1 AND 4),
      branch TEXT NOT NULL DEFAULT 'ALL',
      exam_date TEXT NOT NULL,
      session_slot TEXT NOT NULL CHECK(session_slot IN ('FN', 'AN')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS faculty_willingness (
      id SERIAL PRIMARY KEY,
      department TEXT NOT NULL DEFAULT '',
      exam_title TEXT NOT NULL DEFAULT '',
      emp_id TEXT NOT NULL,
      faculty_name TEXT NOT NULL,
      designation TEXT NOT NULL DEFAULT '',
      exam_date TEXT NOT NULL,
      session_slot TEXT NOT NULL CHECK(session_slot IN ('FN', 'AN')),
      willing TEXT NOT NULL CHECK(willing IN ('YES', 'NO')),
      uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(emp_id, exam_date, session_slot)
    );

    CREATE TABLE IF NOT EXISTS halls (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
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
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS hall_allocations (
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
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
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      action_type TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS contact_inquiries (
      id SERIAL PRIMARY KEY,
      sender_name TEXT NOT NULL,
      sender_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      message TEXT NOT NULL,
      utm_source TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS course_eligibility (
      id SERIAL PRIMARY KEY,
      roll_no TEXT NOT NULL,
      course_code TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('ELIGIBLE', 'CONDONATION_PENDING', 'DETAINED', 'SUPPLEMENTARY')),
      remarks TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(roll_no, course_code)
    );

    CREATE INDEX IF NOT EXISTS idx_seat_cells_alloc ON seat_cells(allocation_id);
    CREATE INDEX IF NOT EXISTS idx_hall_alloc_session ON hall_allocations(exam_session_id);
    CREATE INDEX IF NOT EXISTS idx_course_elig_roll ON course_eligibility(roll_no);
    CREATE INDEX IF NOT EXISTS idx_course_elig_course ON course_eligibility(course_code);

    ALTER TABLE students ADD COLUMN IF NOT EXISTS eligibility_status TEXT NOT NULL DEFAULT 'ELIGIBLE';
    ALTER TABLE students ADD COLUMN IF NOT EXISTS is_pwd INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE faculty_willingness ADD COLUMN IF NOT EXISTS teaching_courses TEXT NOT NULL DEFAULT '[]';
    UPDATE students SET eligibility_status = 'DETAINED' WHERE is_detained = 1 AND eligibility_status = 'ELIGIBLE';
  `);

  await seedRequiredAccountsAndConfig();
}

export async function logAudit(
  userId: number | null,
  username: string,
  role: string,
  actionType: string,
  details: string
): Promise<void> {
  await pool.query(
    `INSERT INTO audit_logs (user_id, username, role, action_type, details) VALUES ($1, $2, $3, $4, $5)`,
    [userId, username, role, actionType, details]
  );
}

async function seedRequiredAccountsAndConfig(): Promise<void> {
  const userRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM users');
  if (!userRow || userRow.c === 0) {
    const adminHash = bcrypt.hashSync('admin123', 10);
    const examinerHash = bcrypt.hashSync('exam@123', 10);

    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, emp_id, department, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 1)
       ON CONFLICT (username) DO NOTHING`,
      ['admin', adminHash, 'System Administrator', 'AU-ADMIN', 'Examination Cell', 'ADMIN']
    );
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, emp_id, department, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, 1)
       ON CONFLICT (username) DO NOTHING`,
      ['examiner', examinerHash, 'Examination Coordinator', 'AU-EXAM', 'Examination Cell', 'EXAMINER']
    );
  }

  const hallRow = await queryOne<{ c: number }>('SELECT COUNT(*)::int AS c FROM halls');
  if (!hallRow || hallRow.c === 0) {
    const hallsSeed = [
      ['RTB', 'RATAN TATA BHAVAN', 'II FLOOR', 'RTB-202', 'CLASSROOM', 6, 9, 3, '[3,3,3]', 54],
      ['RTB', 'RATAN TATA BHAVAN', 'II FLOOR', 'RTB-203', 'CLASSROOM', 6, 9, 3, '[3,3,3]', 54],
      ['RTB', 'RATAN TATA BHAVAN', 'II FLOOR', 'RTB-204', 'CLASSROOM', 6, 9, 3, '[3,3,3]', 54],
      ['RTB', 'RATAN TATA BHAVAN', 'II FLOOR', 'RTB-205', 'CLASSROOM', 6, 9, 3, '[3,3,3]', 54],
      ['RB', 'RAMANUJAN BHAVAN', 'I FLOOR', 'RB-123', 'LAB', 9, 8, 2, '[2,2,2,2]', 72],
      ['RB', 'RAMANUJAN BHAVAN', 'I FLOOR', 'RB-127', 'LAB', 9, 8, 2, '[2,2,2,2]', 72],
    ];
    for (const h of hallsSeed) {
      await pool.query(
        `INSERT INTO halls (building_code, building_name, floor, room_no, room_type, grid_rows, grid_cols, bench_capacity, bench_pattern, total_capacity, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)
         ON CONFLICT (room_no) DO NOTHING`,
        h
      );
    }
  }

  const minorRow = await queryOne<{ c: number }>(
    'SELECT COUNT(*)::int AS c FROM minor_stream_options'
  );
  if (!minorRow || minorRow.c === 0) {
    const minorsSeed = [
      ['CSE', 'Machine Intelligence', 'MI'],
      ['CSE', 'Data Engineering', 'DE'],
      ['CSE', 'Network Security', 'NS'],
      ['ALL', 'SAP', 'SAP'],
    ];
    for (const m of minorsSeed) {
      await pool.query(
        `INSERT INTO minor_stream_options (branch, name, code)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING`,
        m
      );
    }
  }
}
