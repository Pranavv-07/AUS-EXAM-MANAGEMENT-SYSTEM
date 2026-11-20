import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import type { SessionSlot } from '../src/types/exam.ts';

function normalizeHeader(val: unknown): string {
  return String(val ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Parses dates like "19.08.2026 (Wednesday)", "16/3/26", "16/03/2026", "2026-08-19", or Excel serials -> YYYY-MM-DD
 */
export function normalizeExamDate(raw: unknown): string | null {
  if (typeof raw === 'number' && raw > 30000 && raw < 80000) {
    // Excel serial date
    const utcDays = Math.floor(raw - 25569);
    const d = new Date(utcDays * 86400 * 1000);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  const s = String(raw ?? '')
    .replace(/\(.*?\)/g, '')
    .trim();
  if (!s) return null;

  // YYYY-MM-DD
  const isoMatch = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD.MM.YYYY or DD/MM/YY
  const dmyMatch = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (dmyMatch) {
    const [, d, m, yRaw] = dmyMatch;
    const y = yRaw.length === 2 ? `20${yRaw}` : yRaw;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return null;
}

export function formatDisplayDate(isoDate: string): string {
  const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return isoDate;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * Generates neatly formatted Student Roster Excel Template with dropdown validations for:
 * - branch (configured branches)
 * - current_year (1,2,3,4)
 * - minor_stream (NONE + configured minor stream names)
 * - is_detained (NO,YES) with conditional formatting
 */
export async function buildStudentTemplateWorkbook(params: {
  branches: string[];
  minorStreams: string[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aditya University Examination Cell';

  const ws = wb.addWorksheet('Students', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const optSheet = wb.addWorksheet('DropdownOptions');
  optSheet.state = 'hidden';

  const uniqueBranches = [...new Set(params.branches.map((b) => b.trim().toUpperCase()).filter(Boolean))];
  if (uniqueBranches.length === 0) uniqueBranches.push('CSE', 'ECE', 'EEE', 'IT', 'AIML');

  const uniqueMinors = [
    'NONE',
    ...new Set(params.minorStreams.map((m) => m.trim()).filter((m) => m && m.toUpperCase() !== 'NONE')),
  ];

  uniqueBranches.forEach((b, idx) => {
    optSheet.getCell(`A${idx + 1}`).value = b;
  });
  uniqueMinors.forEach((m, idx) => {
    optSheet.getCell(`B${idx + 1}`).value = m;
  });

  ws.columns = [
    { header: 'roll_no', key: 'roll_no', width: 18 },
    { header: 'full_name', key: 'full_name', width: 28 },
    { header: 'branch', key: 'branch', width: 14 },
    { header: 'current_year', key: 'current_year', width: 15 },
    { header: 'batch_code', key: 'batch_code', width: 15 },
    { header: 'minor_stream', key: 'minor_stream', width: 24 },
    { header: 'is_detained', key: 'is_detained', width: 15 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5299' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    };
  });

  const branchFormula = `=DropdownOptions!$A$1:$A$${uniqueBranches.length}`;
  const minorFormula = `=DropdownOptions!$B$1:$B$${uniqueMinors.length}`;

  for (let r = 2; r <= 500; r++) {
    ws.getCell(`C${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [branchFormula],
      showErrorMessage: true,
      errorTitle: 'Branch Selection',
      error: 'Select a valid branch from the dropdown list.',
    };
    ws.getCell(`D${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"1,2,3,4"'],
      showErrorMessage: true,
      errorTitle: 'Academic Year',
      error: 'Select 1, 2, 3, or 4.',
    };
    ws.getCell(`F${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [minorFormula],
      showErrorMessage: true,
      errorTitle: 'Minor Stream Selection',
      error: 'Select NONE or a configured Minor Stream.',
    };
    ws.getCell(`G${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"NO,YES"'],
      showErrorMessage: true,
      errorTitle: 'Detained Status',
      error: 'Select YES or NO.',
    };
  }

  ws.addConditionalFormatting({
    ref: 'G2:G500',
    rules: [
      {
        type: 'cellIs',
        operator: 'equal',
        priority: 1,
        formulae: ['"YES"'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } },
          font: { color: { argb: 'FF991B1B' }, bold: true },
        },
      },
      {
        type: 'cellIs',
        operator: 'equal',
        priority: 2,
        formulae: ['"NO"'],
        style: {
          fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } },
          font: { color: { argb: 'FF166534' }, bold: true },
        },
      },
    ],
  });

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Generates Timetable / Scheduled Subjects Excel Template matching image_875c1680 & image_83ed7318
 */
export async function buildTimetableTemplateWorkbook(branches: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('TimeTable', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const optSheet = wb.addWorksheet('Options');
  optSheet.state = 'hidden';
  const branchChoices = ['ALL', ...new Set(branches.map((b) => b.trim().toUpperCase()).filter(Boolean))];
  branchChoices.forEach((b, i) => {
    optSheet.getCell(`A${i + 1}`).value = b;
  });

  ws.columns = [
    { header: 'S.No', key: 'sno', width: 8 },
    { header: 'Course Code', key: 'course_code', width: 16 },
    { header: 'Course Name', key: 'course_name', width: 40 },
    { header: 'Academic Year', key: 'academic_year', width: 15 },
    { header: 'Branch', key: 'branch', width: 14 },
    { header: 'Session', key: 'session', width: 12 },
    { header: 'Date (DD.MM.YYYY)', key: 'exam_date', width: 22 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5299' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
  });

  for (let r = 2; r <= 200; r++) {
    ws.getCell(`D${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"1,2,3,4"'],
    };
    ws.getCell(`E${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`=Options!$A$1:$A$${branchChoices.length}`],
    };
    ws.getCell(`F${r}`).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: ['"FN,AN"'],
    };
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/**
 * Generates Official Invigilation Willingness Excel Template matching image_f59d9722.png
 * Uses strict YES / NO dropdowns & conditional formatting instead of unreadable ticks.
 */
export async function buildWillingnessTemplateWorkbook(params: {
  department: string;
  examTitle: string;
  dates: string[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Willingness', {
    views: [{ state: 'frozen', ySplit: 5 }],
  });

  const cleanDates = params.dates.filter(Boolean);
  const datesToUse = cleanDates.length > 0 ? cleanDates : [new Date().toISOString().slice(0, 10)];

  // Columns: A=S.No, B=Id, C=Name, D=Designation, then pairs (FN, AN) per date, then Signature
  const totalCols = 4 + datesToUse.length * 2 + 1;
  const lastColLetter = ws.getColumn(totalCols).letter;

  ws.mergeCells(`A1:${lastColLetter}1`);
  ws.getCell('A1').value = 'ADITYA UNIVERSITY';
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0B5299' } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells(`A2:${lastColLetter}2`);
  ws.getCell('A2').value = `DEPARTMENT OF ${params.department.toUpperCase()}`;
  ws.getCell('A2').font = { bold: true, size: 11 };
  ws.getCell('A2').alignment = { horizontal: 'center', vertical: 'middle' };

  ws.mergeCells(`A3:${lastColLetter}3`);
  ws.getCell('A3').value = `${params.examTitle} - Will Invigilation Duties List (Select YES or NO)`;
  ws.getCell('A3').font = { bold: true, size: 10 };
  ws.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };

  // Two-level header at rows 4 & 5
  const fixedCols = [
    { col: 1, title: 'S.No', width: 8 },
    { col: 2, title: 'Id', width: 12 },
    { col: 3, title: 'Name', width: 32 },
    { col: 4, title: 'Designation', width: 28 },
  ];

  for (const fc of fixedCols) {
    const colLetter = ws.getColumn(fc.col).letter;
    ws.getColumn(fc.col).width = fc.width;
    ws.mergeCells(`${colLetter}4:${colLetter}5`);
    const cell = ws.getCell(`${colLetter}4`);
    cell.value = fc.title;
    cell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5299' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  let colCursor = 5;
  const slotColLetters: string[] = [];

  for (const isoDate of datesToUse) {
    const fnLetter = ws.getColumn(colCursor).letter;
    const anLetter = ws.getColumn(colCursor + 1).letter;
    ws.getColumn(colCursor).width = 10;
    ws.getColumn(colCursor + 1).width = 10;

    ws.mergeCells(`${fnLetter}4:${anLetter}4`);
    const dateCell = ws.getCell(`${fnLetter}4`);
    dateCell.value = formatDisplayDate(isoDate);
    dateCell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
    dateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5299' } };
    dateCell.alignment = { horizontal: 'center', vertical: 'middle' };

    for (const [ltr, label] of [
      [fnLetter, 'FN'],
      [anLetter, 'AN'],
    ] as const) {
      const subCell = ws.getCell(`${ltr}5`);
      subCell.value = label;
      subCell.font = { bold: true, size: 10, color: { argb: 'FF0B233B' } };
      subCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF3F9' } };
      subCell.alignment = { horizontal: 'center', vertical: 'middle' };
      slotColLetters.push(ltr);
    }

    colCursor += 2;
  }

  const sigLetter = ws.getColumn(colCursor).letter;
  ws.getColumn(colCursor).width = 18;
  ws.mergeCells(`${sigLetter}4:${sigLetter}5`);
  const sigCell = ws.getCell(`${sigLetter}4`);
  sigCell.value = 'Signature';
  sigCell.font = { bold: true, size: 10, color: { argb: 'FFFFFFFF' } };
  sigCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B5299' } };
  sigCell.alignment = { horizontal: 'center', vertical: 'middle' };

  // Borders on headers
  for (let r = 4; r <= 5; r++) {
    for (let c = 1; c <= totalCols; c++) {
      ws.getCell(r, c).border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    }
  }

  // Strict YES / NO dropdowns & conditional formatting on all FN/AN cells (rows 6..205)
  for (let r = 6; r <= 205; r++) {
    ws.getCell(`A${r}`).alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getCell(`B${r}`).alignment = { horizontal: 'center', vertical: 'middle' };

    for (const ltr of slotColLetters) {
      const cell = ws.getCell(`${ltr}${r}`);
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.dataValidation = {
        type: 'list',
        allowBlank: true,
        formulae: ['"YES,NO"'],
        showErrorMessage: true,
        errorTitle: 'Template Error',
        error: 'Only YES or NO dropdown values are allowed in FN / AN willingness slots.',
      };
    }
  }

  for (const ltr of slotColLetters) {
    ws.addConditionalFormatting({
      ref: `${ltr}6:${ltr}205`,
      rules: [
        {
          type: 'cellIs',
          operator: 'equal',
          priority: 1,
          formulae: ['"YES"'],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFDCFCE7' } },
            font: { color: { argb: 'FF166534' }, bold: true },
          },
        },
        {
          type: 'cellIs',
          operator: 'equal',
          priority: 2,
          formulae: ['"NO"'],
          style: {
            fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: 'FFFEE2E2' } },
            font: { color: { argb: 'FF991B1B' }, bold: true },
          },
        },
      ],
    });
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export interface ParsedWillingnessEntry {
  department: string;
  exam_title: string;
  emp_id: string;
  faculty_name: string;
  designation: string;
  exam_date: string;
  session_slot: SessionSlot;
  willing: 'YES' | 'NO';
}

/**
 * Strictly validates and parses uploaded Invigilation Willingness Excel sheet.
 * Throws descriptive errors if template headers or YES/NO slot cells do not conform.
 */
export function parseAndValidateWillingnessWorkbook(buffer: Buffer): {
  entries: ParsedWillingnessEntry[];
  dates: string[];
  department: string;
} {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) {
    throw new Error('Uploaded Excel workbook contains no sheets.');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[firstSheet], {
    header: 1,
    defval: '',
    raw: true,
  });

  if (rows.length < 2) {
    throw new Error(
      'File does not follow the official Willingness Template (missing header rows and faculty rows).'
    );
  }

  let department = 'Examination Cell';
  let examTitle = '';
  let headerRowIdx = -1;

  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r].map((v) => String(v ?? '').trim());
    const joined = row.join(' ').trim();
    if (joined.toUpperCase().startsWith('DEPARTMENT OF')) {
      department = joined.replace(/^DEPARTMENT OF\s+/i, '').trim();
    } else if (joined.toUpperCase().includes('INVIGILATION') || joined.toUpperCase().includes('DUTIES LIST')) {
      examTitle = joined;
    }

    const norms = row.map((v) => normalizeHeader(v));
    if (norms.includes('id') && norms.includes('name') && (norms.includes('designation') || norms.includes('sno'))) {
      headerRowIdx = r;
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(
      'Invalid template format: Missing required columns "S.No", "Id", "Name", and "Designation". Download and use the official Willingness Template.'
    );
  }

  const topHeader = rows[headerRowIdx];
  const subHeader = rows[headerRowIdx + 1] || [];

  const normTop = topHeader.map((c) => normalizeHeader(c));
  const idCol = normTop.indexOf('id');
  const nameCol = normTop.indexOf('name');
  const desigCol = normTop.indexOf('designation');

  if (idCol === -1 || nameCol === -1 || desigCol === -1) {
    throw new Error(
      'Invalid template format: Required columns "Id", "Name", and "Designation" were not found in the header row.'
    );
  }

  // Detect whether two-row header (Date merged over FN/AN) is used
  const subNorms = subHeader.map((c) => String(c ?? '').trim().toUpperCase());
  const hasSubHeader = subNorms.some((s) => s === 'FN' || s === 'AN');

  interface SlotColumn {
    colIndex: number;
    exam_date: string;
    session_slot: SessionSlot;
  }

  const slotColumns: SlotColumn[] = [];
  let dataStartRow = headerRowIdx + 1;

  if (hasSubHeader) {
    dataStartRow = headerRowIdx + 2;
    let activeDateIso: string | null = null;
    const maxCols = Math.max(topHeader.length, subHeader.length);

    for (let c = 0; c < maxCols; c++) {
      const topRaw = topHeader[c];
      const parsedDate = normalizeExamDate(topRaw);
      if (parsedDate) {
        activeDateIso = parsedDate;
      }

      const subVal = String(subHeader[c] ?? '').trim().toUpperCase();
      if (subVal === 'FN' || subVal === 'AN') {
        if (!activeDateIso) {
          throw new Error(
            `Template error at column ${c + 1}: Found "${subVal}" without a valid Date header (e.g. 16/03/2026) above it.`
          );
        }
        slotColumns.push({
          colIndex: c,
          exam_date: activeDateIso,
          session_slot: subVal as SessionSlot,
        });
      }
    }
  } else {
    // Support single-row headers like "16/03/2026 FN"
    for (let c = 0; c < topHeader.length; c++) {
      const raw = String(topHeader[c] ?? '').trim();
      const m = raw.match(/^(.*?)\s+(FN|AN)$/i);
      if (m) {
        const dIso = normalizeExamDate(m[1]);
        if (!dIso) {
          throw new Error(`Invalid date header "${raw}" at column ${c + 1}. Expected DD/MM/YYYY FN or AN.`);
        }
        slotColumns.push({
          colIndex: c,
          exam_date: dIso,
          session_slot: m[2].toUpperCase() as SessionSlot,
        });
      }
    }
  }

  if (slotColumns.length === 0) {
    throw new Error(
      'Invalid template format: No Date with FN/AN willingness columns found. Download the official Willingness Template first.'
    );
  }

  const entries: ParsedWillingnessEntry[] = [];
  const dateSet = new Set<string>();

  for (let r = dataStartRow; r < rows.length; r++) {
    const row = rows[r];
    const empId = String(row[idCol] ?? '').trim();
    const facultyName = String(row[nameCol] ?? '').trim();
    const designation = String(row[desigCol] ?? '').trim();

    if (!empId && !facultyName) continue;

    if (!empId || !facultyName) {
      throw new Error(
        `Template validation error on row ${r + 1}: Both "Id" and "Name" are required for every faculty entry.`
      );
    }

    for (const slotCol of slotColumns) {
      dateSet.add(slotCol.exam_date);
      const rawCell = String(row[slotCol.colIndex] ?? '').trim();
      const upper = rawCell.toUpperCase();

      let willing: 'YES' | 'NO';
      if (upper === 'YES' || upper === 'Y' || upper === 'TRUE' || rawCell === '✓' || rawCell === '✔' || rawCell === '☑') {
        willing = 'YES';
      } else if (upper === 'NO' || upper === 'N' || upper === 'FALSE' || rawCell === '' || rawCell === '-' || rawCell === '✗' || rawCell === '✘') {
        willing = 'NO';
      } else {
        throw new Error(
          `Invalid value "${rawCell}" at row ${r + 1} (${facultyName}, ${formatDisplayDate(slotCol.exam_date)} ${slotCol.session_slot}). Use only YES or NO from the dropdown.`
        );
      }

      entries.push({
        department,
        exam_title: examTitle,
        emp_id: empId,
        faculty_name: facultyName,
        designation,
        exam_date: slotCol.exam_date,
        session_slot: slotCol.session_slot,
        willing,
      });
    }
  }

  if (entries.length === 0) {
    throw new Error('No faculty rows found below the header in the uploaded willingness Excel file.');
  }

  return {
    entries,
    dates: Array.from(dateSet).sort(),
    department,
  };
}
