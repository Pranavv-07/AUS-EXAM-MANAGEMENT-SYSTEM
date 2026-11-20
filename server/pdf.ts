import fs from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import type { ExamSession, HallAllocation, MasterSummaryRow } from '../src/types/exam.ts';
import { buildDispatchSummary, buildMasterSummaryRows, resolveHallBenchPattern } from './seating.ts';

const OFFICIAL_LOGO_PATH = path.resolve(process.cwd(), 'public/assets/aistudio/image_9c337579.png');

function drawUniversityHeader(
  doc: PDFKit.PDFDocument,
  pageWidth: number,
  margin: number,
  department: string,
  subtitle: string
) {
  const usableWidth = pageWidth - margin * 2;
  const startY = margin;

  // Embed official Aditya University logo on the left
  if (fs.existsSync(OFFICIAL_LOGO_PATH)) {
    doc.image(OFFICIAL_LOGO_PATH, margin, startY + 2, { height: 34 });
  }

  // University Wordmark & Department
  doc
    .fillColor('#0b5299')
    .font('Helvetica-Bold')
    .fontSize(15)
    .text('ADITYA UNIVERSITY', margin, startY + 2, {
      width: usableWidth,
      align: 'center',
    });

  doc
    .fillColor('#1e293b')
    .font('Helvetica')
    .fontSize(8)
    .text('SURAMPALEM - 533437, ANDHRA PRADESH, INDIA', margin, startY + 19, {
      width: usableWidth,
      align: 'center',
    });

  doc
    .fillColor('#0f172a')
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(`DEPARTMENT OF ${department.toUpperCase()}`, margin, startY + 31, {
      width: usableWidth,
      align: 'center',
    });

  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .text(subtitle, margin, startY + 45, {
      width: usableWidth,
      align: 'center',
    });

  // Rule divider
  const lineY = startY + 61;
  doc
    .moveTo(margin, lineY)
    .lineTo(pageWidth - margin, lineY)
    .lineWidth(1.2)
    .strokeColor('#0b5299')
    .stroke();

  return lineY + 8;
}

function drawCellBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  opts: {
    bold?: boolean;
    fontSize?: number;
    align?: 'left' | 'center' | 'right';
    fill?: string;
    textColor?: string;
    paddingX?: number;
  } = {}
) {
  if (opts.fill) {
    doc.save().rect(x, y, w, h).fill(opts.fill).restore();
  }
  doc.save().rect(x, y, w, h).lineWidth(0.75).strokeColor('#000000').stroke().restore();

  if (text) {
    const fontSize = opts.fontSize ?? 8.5;
    const padX = opts.paddingX ?? 4;
    doc
      .fillColor(opts.textColor ?? '#000000')
      .font(opts.bold ? 'Helvetica-Bold' : 'Helvetica')
      .fontSize(fontSize);

    const textHeight = doc.heightOfString(text, { width: w - padX * 2 });
    const textY = y + Math.max(2, (h - textHeight) / 2);
    doc.text(text, x + padX, textY, {
      width: w - padX * 2,
      align: opts.align ?? 'center',
      lineBreak: true,
    });
  }
}

export function renderMasterSummaryPage(
  doc: PDFKit.PDFDocument,
  session: ExamSession,
  allocations: HallAllocation[],
  includeSubject: boolean
) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = 34;
  const usableWidth = pageWidth - margin * 2;

  let y = drawUniversityHeader(
    doc,
    pageWidth,
    margin,
    session.department,
    'SEATING ARRANGEMENT — NOTICE BOARD COPY'
  );

  // Exam Info Strip
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(9.5)
    .text(session.exam_title.toUpperCase(), margin, y, {
      width: usableWidth,
      align: 'center',
    });
  y += 14;

  const sessionLabel = `${session.session_slot}: ${session.session_timing}`;
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(`DATE: ${session.exam_date}`, margin, y, { width: usableWidth / 2, align: 'left' });
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text(`TIME: ${sessionLabel}`, margin + usableWidth / 2, y, {
      width: usableWidth / 2,
      align: 'right',
    });
  y += 16;

  const summaryRows: MasterSummaryRow[] = buildMasterSummaryRows(session, allocations);

  // Column widths
  // S.No | Branch / Floor | ROLL NUMBERS (From | To) | [Subject] | ROOM NO | Total
  const cols = includeSubject
    ? {
        sno: 32,
        branchFloor: 112,
        from: 86,
        to: 86,
        subject: 108,
        room: 60,
        total: usableWidth - (32 + 112 + 86 + 86 + 108 + 60),
      }
    : {
        sno: 36,
        branchFloor: 140,
        from: 105,
        to: 105,
        subject: 0,
        room: 82,
        total: usableWidth - (36 + 140 + 105 + 105 + 82),
      };

  const headerH1 = 18;
  const headerH2 = 16;
  const rowH = 22;

  const drawTableHeader = (startY: number) => {
    let x = margin;
    drawCellBox(doc, x, startY, cols.sno, headerH1 + headerH2, 'S.No', {
      bold: true,
      fill: '#eef3f9',
    });
    x += cols.sno;

    drawCellBox(doc, x, startY, cols.branchFloor, headerH1 + headerH2, 'Branch / Floor', {
      bold: true,
      fill: '#eef3f9',
    });
    x += cols.branchFloor;

    drawCellBox(doc, x, startY, cols.from + cols.to, headerH1, 'ROLL NUMBERS', {
      bold: true,
      fill: '#eef3f9',
    });
    drawCellBox(doc, x, startY + headerH1, cols.from, headerH2, 'From', {
      bold: true,
      fill: '#eef3f9',
    });
    drawCellBox(doc, x + cols.from, startY + headerH1, cols.to, headerH2, 'To', {
      bold: true,
      fill: '#eef3f9',
    });
    x += cols.from + cols.to;

    if (includeSubject) {
      drawCellBox(doc, x, startY, cols.subject, headerH1 + headerH2, 'Subject / Time Table', {
        bold: true,
        fill: '#eef3f9',
      });
      x += cols.subject;
    }

    drawCellBox(doc, x, startY, cols.room, headerH1 + headerH2, 'ROOM NO', {
      bold: true,
      fill: '#eef3f9',
    });
    x += cols.room;

    drawCellBox(doc, x, startY, cols.total, headerH1 + headerH2, 'Total', {
      bold: true,
      fill: '#eef3f9',
    });

    return startY + headerH1 + headerH2;
  };

  y = drawTableHeader(y);

  let grandTotal = 0;
  for (let i = 0; i < summaryRows.length; i++) {
    const row = summaryRows[i];
    if (y + rowH > pageHeight - 115) {
      doc.addPage({ size: 'A4', layout: 'portrait', margin: 34 });
      y = margin;
      y = drawTableHeader(y);
    }

    let x = margin;
    drawCellBox(doc, x, y, cols.sno, rowH, String(row.sno), { fontSize: 8.5 });
    x += cols.sno;

    // Row-spanned Branch / Floor
    if (row.row_span && row.row_span > 0) {
      // Check if span fits remaining page height
      const remainingRowsOnPage = Math.floor((pageHeight - 115 - y) / rowH);
      const effectiveSpan = Math.min(row.row_span, Math.max(1, remainingRowsOnPage));
      drawCellBox(
        doc,
        x,
        y,
        cols.branchFloor,
        rowH * effectiveSpan,
        `${row.branch_label}\n(${row.floor_label})`,
        { bold: true, fontSize: 8 }
      );
    } else if (row.row_span === undefined) {
      drawCellBox(doc, x, y, cols.branchFloor, rowH, `${row.branch_label} (${row.floor_label})`, {
        bold: true,
        fontSize: 8,
      });
    }
    x += cols.branchFloor;

    drawCellBox(doc, x, y, cols.from, rowH, row.roll_from, { fontSize: 8.5 });
    x += cols.from;

    drawCellBox(doc, x, y, cols.to, rowH, row.roll_to, { fontSize: 8.5 });
    x += cols.to;

    if (includeSubject) {
      drawCellBox(doc, x, y, cols.subject, rowH, row.subject, { fontSize: 7.5 });
      x += cols.subject;
    }

    drawCellBox(doc, x, y, cols.room, rowH, row.room_no, { bold: true, fontSize: 8.5 });
    x += cols.room;

    drawCellBox(doc, x, y, cols.total, rowH, String(row.total), { bold: true, fontSize: 8.5 });
    grandTotal += row.total;
    y += rowH;
  }

  // Grand Total row
  const beforeTotalW =
    cols.sno + cols.branchFloor + cols.from + cols.to + (includeSubject ? cols.subject : 0) + cols.room;
  drawCellBox(doc, margin, y, beforeTotalW, 22, 'GRAND TOTAL', {
    bold: true,
    align: 'right',
    fill: '#eef3f9',
    paddingX: 10,
  });
  drawCellBox(doc, margin + beforeTotalW, y, cols.total, 22, String(grandTotal), {
    bold: true,
    fill: '#eef3f9',
  });
  y += 30;

  // Building Legend
  const buildings = new Map<string, string>();
  for (const a of allocations) {
    buildings.set(a.hall.building_code, a.hall.building_name);
  }
  const legendText = Array.from(buildings.entries())
    .map(([code, name]) => `${code}: ${name}`)
    .join('   |   ');

  if (legendText) {
    doc
      .fillColor('#1e293b')
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(`BUILDING LEGEND: ${legendText}`, margin, y, { width: usableWidth });
    y += 28;
  }

  // Signature Footer
  const sigY = Math.max(y + 12, pageHeight - 75);
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('Dept. Examcell In-Charge', margin, sigY, { width: 180, align: 'left' });

  doc
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('HEAD OF THE DEPARTMENT', pageWidth - margin - 180, sigY, {
      width: 180,
      align: 'right',
    });
}

export function renderRoomInvigilatorPage(
  doc: PDFKit.PDFDocument,
  session: ExamSession,
  alloc: HallAllocation
) {
  const pageWidth = doc.page.width;
  const pageHeight = doc.page.height;
  const margin = 28;
  const usableWidth = pageWidth - margin * 2;

  let y = drawUniversityHeader(
    doc,
    pageWidth,
    margin,
    session.department,
    'SEATING PLAN & ABSENTEES STATEMENT — INVIGILATOR COPY'
  );

  // Metadata Block Table
  const metaH = 19;
  const halfW = usableWidth / 2;
  drawCellBox(doc, margin, y, halfW, metaH, `Room No: ${alloc.hall.room_no} (${alloc.hall.building_code} - ${alloc.hall.floor})`, {
    bold: true,
    align: 'left',
    paddingX: 6,
    fontSize: 8.5,
  });
  drawCellBox(
    doc,
    margin + halfW,
    y,
    halfW,
    metaH,
    `Date & Session: ${session.exam_date}  |  ${session.session_slot} (${session.session_timing})`,
    { bold: true, align: 'left', paddingX: 6, fontSize: 8.5 }
  );
  y += metaH;

  drawCellBox(
    doc,
    margin,
    y,
    halfW,
    metaH,
    `Name of the Invigilator - I: ${alloc.invigilator_1_name || '________________________'}   (Emp. ID: ${alloc.invigilator_1_emp_id || '________'})`,
    { align: 'left', paddingX: 6, fontSize: 8 }
  );
  drawCellBox(
    doc,
    margin + halfW,
    y,
    halfW,
    metaH,
    `Name of the Invigilator - II: ${alloc.invigilator_2_name || '________________________'}   (Emp. ID: ${alloc.invigilator_2_emp_id || '________'})`,
    { align: 'left', paddingX: 6, fontSize: 8 }
  );
  y += metaH + 8;

  // Physical Seating Grid with Bench Aisle Spacing
  const benchPattern = resolveHallBenchPattern(alloc.hall, session.layout_config);
  const rows = alloc.hall.grid_rows;
  const cols = benchPattern.reduce((s, n) => s + n, 0) || alloc.hall.grid_cols;
  const numGroups = benchPattern.length;
  const aisleGap = numGroups > 1 ? 8 : 0;
  const colW = (usableWidth - (numGroups - 1) * aisleGap) / cols;

  // Map 0-based column index -> exact X offset accounting for bench aisle gaps
  const colXOffsets: number[] = [];
  let cursorX = margin;
  for (let g = 0; g < numGroups; g++) {
    const size = benchPattern[g];
    for (let s = 0; s < size; s++) {
      colXOffsets.push(cursorX);
      cursorX += colW;
    }
    cursorX += aisleGap;
  }

  const groupH = 16;
  const colHeadH = 18;
  const availableGridHeight = pageHeight - y - 140;
  const cellH = Math.min(24, Math.max(17, Math.floor((availableGridHeight - groupH - colHeadH) / rows)));

  let gx = margin;
  for (let g = 0; g < numGroups; g++) {
    const colsInGroup = benchPattern[g];
    const label = alloc.hall.room_type === 'LAB' ? `LAB COLUMN ${g + 1}` : `BENCH ${g + 1} (${colsInGroup})`;
    drawCellBox(doc, gx, y, colW * colsInGroup, groupH, label, {
      bold: true,
      fontSize: 7.5,
      fill: '#eef3f9',
    });
    gx += colW * colsInGroup + aisleGap;
  }
  y += groupH;

  // Sub-column Branch/Year headers
  for (let c = 0; c < cols; c++) {
    const header = alloc.column_headers[c] === 'EMPTY' ? '—' : alloc.column_headers[c] || '-';
    drawCellBox(doc, colXOffsets[c], y, colW, colHeadH, header, {
      bold: true,
      fontSize: 7.5,
      fill: alloc.column_headers[c] === 'EMPTY' ? '#f1f5f9' : '#f8fafc',
      textColor: alloc.column_headers[c] === 'EMPTY' ? '#94a3b8' : '#000000',
    });
  }
  y += colHeadH;

  // Build lookup matrix
  const cellMap = new Map<string, string>();
  for (const cell of alloc.cells) {
    cellMap.set(`${cell.row_index}-${cell.col_index}`, cell.roll_no_snapshot || '');
  }

  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const roll = cellMap.get(`${r}-${c}`) || '';
      const isMiddleEmpty = alloc.column_headers[c - 1] === 'EMPTY';
      drawCellBox(doc, colXOffsets[c - 1], y, colW, cellH, roll, {
        fontSize: cols >= 9 ? 7.5 : 8,
        bold: Boolean(roll),
        fill: isMiddleEmpty ? '#f8fafc' : undefined,
      });
    }
    y += cellH;
  }

  y += 6;
  // Centered label: Roll Numbers Allotted
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('Roll Numbers Allotted', margin, y, { width: usableWidth, align: 'center' });
  y += 14;

  // Bottom Footer: Left Signatures + Note | Right Summary Mini-Table
  const leftW = usableWidth * 0.48;
  const rightX = margin + usableWidth * 0.52;
  const rightW = usableWidth * 0.48;

  // Left side
  doc
    .fillColor('#000000')
    .font('Helvetica-Bold')
    .fontSize(8)
    .text("Note: Please round off the Roll No's absent.", margin, y);

  const sigLineY = y + 48;
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text('Signature of the Invigilator - I', margin, sigLineY, { width: leftW / 2 - 8 });
  doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .text('Signature of the Invigilator - II', margin + leftW / 2, sigLineY, {
      width: leftW / 2,
      align: 'right',
    });

  // Right side mini-table: Branch | No. of Presentees | No. of Absentees | Total
  const mCol1 = rightW * 0.34;
  const mCol2 = rightW * 0.24;
  const mCol3 = rightW * 0.24;
  const mCol4 = rightW * 0.18;
  const miniRowH = 16;

  drawCellBox(doc, rightX, y, mCol1, miniRowH, 'Branch', { bold: true, fontSize: 7.5, fill: '#eef3f9' });
  drawCellBox(doc, rightX + mCol1, y, mCol2, miniRowH, 'No. of Presentees', {
    bold: true,
    fontSize: 7,
    fill: '#eef3f9',
  });
  drawCellBox(doc, rightX + mCol1 + mCol2, y, mCol3, miniRowH, 'No. of Absentees', {
    bold: true,
    fontSize: 7,
    fill: '#eef3f9',
  });
  drawCellBox(doc, rightX + mCol1 + mCol2 + mCol3, y, mCol4, miniRowH, 'Total', {
    bold: true,
    fontSize: 7.5,
    fill: '#eef3f9',
  });

  let my = y + miniRowH;
  const cohortEntries = Object.entries(alloc.cohort_counts);
  for (const [cohort, count] of cohortEntries) {
    drawCellBox(doc, rightX, my, mCol1, miniRowH, cohort, { bold: true, fontSize: 7.5 });
    drawCellBox(doc, rightX + mCol1, my, mCol2, miniRowH, '', { fontSize: 7.5 });
    drawCellBox(doc, rightX + mCol1 + mCol2, my, mCol3, miniRowH, '', { fontSize: 7.5 });
    drawCellBox(doc, rightX + mCol1 + mCol2 + mCol3, my, mCol4, miniRowH, String(count), {
      bold: true,
      fontSize: 7.5,
    });
    my += miniRowH;
  }

  // Mini-table Total row
  drawCellBox(doc, rightX, my, mCol1, miniRowH, 'Total', { bold: true, fontSize: 7.5, fill: '#f8fafc' });
  drawCellBox(doc, rightX + mCol1, my, mCol2, miniRowH, '', { fontSize: 7.5 });
  drawCellBox(doc, rightX + mCol1 + mCol2, my, mCol3, miniRowH, '', { fontSize: 7.5 });
  drawCellBox(doc, rightX + mCol1 + mCol2 + mCol3, my, mCol4, miniRowH, String(alloc.allocated_count), {
    bold: true,
    fontSize: 7.5,
    fill: '#f8fafc',
  });
}

export function generateMasterPdfBuffer(
  session: ExamSession,
  allocations: HallAllocation[],
  includeSubject: boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 34 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderMasterSummaryPage(doc, session, allocations, includeSubject);
    doc.end();
  });
}

export function generateRoomsPdfBuffer(
  session: ExamSession,
  allocations: HallAllocation[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 28 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    allocations.forEach((alloc, idx) => {
      if (idx > 0) doc.addPage({ size: 'A4', layout: 'landscape', margin: 28 });
      renderRoomInvigilatorPage(doc, session, alloc);
    });

    doc.end();
  });
}

export function generateBundlePdfBuffer(
  session: ExamSession,
  allocations: HallAllocation[],
  includeSubject: boolean
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 34 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    renderMasterSummaryPage(doc, session, allocations, includeSubject);

    for (const alloc of allocations) {
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 28 });
      renderRoomInvigilatorPage(doc, session, alloc);
    }

    doc.end();
  });
}

export function generateAttendancePdfBuffer(
  session: ExamSession,
  allocations: HallAllocation[],
  studentNamesByRoll: Map<string, string>
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 34 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 34;
    const usableWidth = pageWidth - margin * 2;

    allocations.forEach((alloc, roomIdx) => {
      if (roomIdx > 0) doc.addPage({ size: 'A4', layout: 'portrait', margin: 34 });

      let y = drawUniversityHeader(
        doc,
        pageWidth,
        margin,
        session.department,
        'ROOM-WISE ATTENDANCE SHEET'
      );

      // Room & Exam info bar
      const metaH = 18;
      drawCellBox(
        doc,
        margin,
        y,
        usableWidth / 2,
        metaH,
        `Room No: ${alloc.hall.room_no} (${alloc.hall.building_code})`,
        { bold: true, align: 'left', paddingX: 6, fontSize: 8.5 }
      );
      drawCellBox(
        doc,
        margin + usableWidth / 2,
        y,
        usableWidth / 2,
        metaH,
        `Date & Session: ${session.exam_date} | ${session.session_slot} (${session.session_timing})`,
        { bold: true, align: 'left', paddingX: 6, fontSize: 8.5 }
      );
      y += metaH + 6;

      const occupied = alloc.cells
        .filter((c) => Boolean(c.roll_no_snapshot))
        .sort((a, b) =>
          (a.roll_no_snapshot || '').localeCompare(b.roll_no_snapshot || '', 'en', {
            numeric: true,
            sensitivity: 'base',
          })
        );

      const cols = {
        sno: 32,
        roll: 92,
        name: 152,
        cohort: 70,
        booklet: 88,
        sig: usableWidth - (32 + 92 + 152 + 70 + 88),
      };

      const drawHeader = (hy: number) => {
        let x = margin;
        drawCellBox(doc, x, hy, cols.sno, 20, 'S.No', { bold: true, fill: '#eef3f9', fontSize: 8 });
        x += cols.sno;
        drawCellBox(doc, x, hy, cols.roll, 20, 'Roll Number', { bold: true, fill: '#eef3f9', fontSize: 8 });
        x += cols.roll;
        drawCellBox(doc, x, hy, cols.name, 20, 'Student Name', { bold: true, fill: '#eef3f9', fontSize: 8 });
        x += cols.name;
        drawCellBox(doc, x, hy, cols.cohort, 20, 'Branch', { bold: true, fill: '#eef3f9', fontSize: 8 });
        x += cols.cohort;
        drawCellBox(doc, x, hy, cols.booklet, 20, 'Booklet No.', { bold: true, fill: '#eef3f9', fontSize: 8 });
        x += cols.booklet;
        drawCellBox(doc, x, hy, cols.sig, 20, 'Student Signature', { bold: true, fill: '#eef3f9', fontSize: 8 });
        return hy + 20;
      };

      y = drawHeader(y);
      const rowH = 17;

      occupied.forEach((cell, idx) => {
        if (y + rowH > pageHeight - 75) {
          doc.addPage({ size: 'A4', layout: 'portrait', margin: 34 });
          y = drawHeader(margin);
        }
        const roll = cell.roll_no_snapshot || '';
        const name = studentNamesByRoll.get(roll) || '';
        let x = margin;
        drawCellBox(doc, x, y, cols.sno, rowH, String(idx + 1), { fontSize: 7.5 });
        x += cols.sno;
        drawCellBox(doc, x, y, cols.roll, rowH, roll, { bold: true, fontSize: 8 });
        x += cols.roll;
        drawCellBox(doc, x, y, cols.name, rowH, name, { align: 'left', paddingX: 5, fontSize: 7.5 });
        x += cols.name;
        drawCellBox(doc, x, y, cols.cohort, rowH, cell.cohort_label, { fontSize: 7.5 });
        x += cols.cohort;
        drawCellBox(doc, x, y, cols.booklet, rowH, '', { fontSize: 7.5 });
        x += cols.booklet;
        drawCellBox(doc, x, y, cols.sig, rowH, '', { fontSize: 7.5 });
        y += rowH;
      });

      const sigY = Math.max(y + 18, pageHeight - 54);
      doc
        .fillColor('#000000')
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(
          `Invigilator I: ${alloc.invigilator_1_name || '__________________'}`,
          margin,
          sigY,
          { width: usableWidth / 2, align: 'left' }
        );
      doc
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text(
          `Invigilator II: ${alloc.invigilator_2_name || '__________________'}`,
          margin + usableWidth / 2,
          sigY,
          { width: usableWidth / 2, align: 'right' }
        );
    });

    doc.end();
  });
}

export function generateProformaPdfBuffer(
  session: ExamSession,
  allocations: HallAllocation[]
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 34 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 34;
    const usableWidth = pageWidth - margin * 2;

    let y = drawUniversityHeader(
      doc,
      pageWidth,
      margin,
      session.department,
      'INVIGILATION DUTY & ANSWER SCRIPT HANDOVER PROFORMA'
    );

    doc
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(session.exam_title.toUpperCase(), margin, y, { width: usableWidth, align: 'center' });
    y += 14;
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(
        `Date: ${session.exam_date}   |   Session: ${session.session_slot} (${session.session_timing})`,
        margin,
        y,
        { width: usableWidth, align: 'center' }
      );
    y += 18;

    const cols = {
      sno: 28,
      room: 62,
      inv1: 120,
      inv2: 120,
      allotted: 46,
      present: 46,
      absent: 46,
      sign: usableWidth - (28 + 62 + 120 + 120 + 46 + 46 + 46),
    };

    const drawHeader = (hy: number) => {
      let x = margin;
      drawCellBox(doc, x, hy, cols.sno, 24, 'S.No', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += cols.sno;
      drawCellBox(doc, x, hy, cols.room, 24, 'Room No', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += cols.room;
      drawCellBox(doc, x, hy, cols.inv1, 24, 'Invigilator I (Emp ID)', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += cols.inv1;
      drawCellBox(doc, x, hy, cols.inv2, 24, 'Invigilator II (Emp ID)', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += cols.inv2;
      drawCellBox(doc, x, hy, cols.allotted, 24, 'Allotted', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += cols.allotted;
      drawCellBox(doc, x, hy, cols.present, 24, 'Present', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += cols.present;
      drawCellBox(doc, x, hy, cols.absent, 24, 'Absent', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += cols.absent;
      drawCellBox(doc, x, hy, cols.sign, 24, 'Handover Sign', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      return hy + 24;
    };

    y = drawHeader(y);
    const rowH = 26;
    let totalAllotted = 0;

    allocations.forEach((alloc, idx) => {
      if (y + rowH > pageHeight - 90) {
        doc.addPage({ size: 'A4', layout: 'portrait', margin: 34 });
        y = drawHeader(margin);
      }
      totalAllotted += alloc.allocated_count;
      const inv1 = alloc.invigilator_1_name
        ? `${alloc.invigilator_1_name}${alloc.invigilator_1_emp_id ? ` (${alloc.invigilator_1_emp_id})` : ''}`
        : '__________________';
      const inv2 = alloc.invigilator_2_name
        ? `${alloc.invigilator_2_name}${alloc.invigilator_2_emp_id ? ` (${alloc.invigilator_2_emp_id})` : ''}`
        : '__________________';

      let x = margin;
      drawCellBox(doc, x, y, cols.sno, rowH, String(idx + 1), { fontSize: 7.5 });
      x += cols.sno;
      drawCellBox(doc, x, y, cols.room, rowH, alloc.hall.room_no, { bold: true, fontSize: 8 });
      x += cols.room;
      drawCellBox(doc, x, y, cols.inv1, rowH, inv1, { fontSize: 7, align: 'left', paddingX: 4 });
      x += cols.inv1;
      drawCellBox(doc, x, y, cols.inv2, rowH, inv2, { fontSize: 7, align: 'left', paddingX: 4 });
      x += cols.inv2;
      drawCellBox(doc, x, y, cols.allotted, rowH, String(alloc.allocated_count), { bold: true, fontSize: 8 });
      x += cols.allotted;
      drawCellBox(doc, x, y, cols.present, rowH, '', { fontSize: 8 });
      x += cols.present;
      drawCellBox(doc, x, y, cols.absent, rowH, '', { fontSize: 8 });
      x += cols.absent;
      drawCellBox(doc, x, y, cols.sign, rowH, '', { fontSize: 8 });
      y += rowH;
    });

    // Totals row
    const beforeW = cols.sno + cols.room + cols.inv1 + cols.inv2;
    drawCellBox(doc, margin, y, beforeW, 22, 'TOTAL', { bold: true, align: 'right', fill: '#eef3f9', paddingX: 8 });
    drawCellBox(doc, margin + beforeW, y, cols.allotted, 22, String(totalAllotted), { bold: true, fill: '#eef3f9' });
    drawCellBox(doc, margin + beforeW + cols.allotted, y, cols.present, 22, '', { fill: '#eef3f9' });
    drawCellBox(doc, margin + beforeW + cols.allotted + cols.present, y, cols.absent, 22, '', { fill: '#eef3f9' });
    drawCellBox(doc, margin + beforeW + cols.allotted + cols.present + cols.absent, y, cols.sign, 22, '', { fill: '#eef3f9' });

    const sigY = Math.max(y + 42, pageHeight - 64);
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9);
    doc.text('Dept. Examcell In-Charge', margin, sigY, { width: 180, align: 'left' });
    doc.text('Chief Superintendent / HOD', pageWidth - margin - 180, sigY, { width: 180, align: 'right' });

    doc.end();
  });
}

export function generateDispatchPdfBuffer(
  session: ExamSession,
  allocations: HallAllocation[],
  bufferPct = 5
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'portrait', margin: 34 });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const margin = 34;
    const usableWidth = pageWidth - margin * 2;
    const dispatch = buildDispatchSummary(session, allocations, bufferPct);

    let y = drawUniversityHeader(
      doc,
      pageWidth,
      margin,
      session.department,
      `QUESTION PAPER & ANSWER BOOKLET DISPATCH SHEET (+${dispatch.bufferPct}% BUFFER)`
    );

    doc
      .fillColor('#000000')
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text(session.exam_title.toUpperCase(), margin, y, { width: usableWidth, align: 'center' });
    y += 14;
    doc
      .font('Helvetica-Bold')
      .fontSize(8.5)
      .text(
        `Date: ${session.exam_date}   |   Session: ${session.session_slot} (${session.session_timing})   |   Stationery Buffer: +${dispatch.bufferPct}%`,
        margin,
        y,
        { width: usableWidth, align: 'center' }
      );
    y += 18;

    // Section 1: Floor-Wise Consolidation
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0b5299').text('1. FLOOR-WISE CONSOLIDATED DISPATCH', margin, y);
    y += 14;

    const fCols = {
      sno: 30,
      bhavan: 60,
      floor: 90,
      rooms: 55,
      students: 70,
      qp: 75,
      booklets: 80,
      seal: usableWidth - (30 + 60 + 90 + 55 + 70 + 75 + 80),
    };

    const drawFloorHeader = (hy: number) => {
      let x = margin;
      drawCellBox(doc, x, hy, fCols.sno, 20, 'S.No', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += fCols.sno;
      drawCellBox(doc, x, hy, fCols.bhavan, 20, 'Bhavan', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += fCols.bhavan;
      drawCellBox(doc, x, hy, fCols.floor, 20, 'Floor', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += fCols.floor;
      drawCellBox(doc, x, hy, fCols.rooms, 20, 'Rooms', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += fCols.rooms;
      drawCellBox(doc, x, hy, fCols.students, 20, 'Students', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += fCols.students;
      drawCellBox(doc, x, hy, fCols.qp, 20, `QP (+${dispatch.bufferPct}%)`, { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += fCols.qp;
      drawCellBox(doc, x, hy, fCols.booklets, 20, `Booklets (+${dispatch.bufferPct}%)`, { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += fCols.booklets;
      drawCellBox(doc, x, hy, fCols.seal, 20, 'Floor Sign', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      return hy + 20;
    };

    y = drawFloorHeader(y);
    const fRowH = 20;
    dispatch.floorSummaries.forEach((f, idx) => {
      if (y + fRowH > pageHeight - 100) {
        doc.addPage({ size: 'A4', layout: 'portrait', margin: 34 });
        y = drawFloorHeader(margin);
      }
      let x = margin;
      drawCellBox(doc, x, y, fCols.sno, fRowH, String(idx + 1), { fontSize: 7.5 });
      x += fCols.sno;
      drawCellBox(doc, x, y, fCols.bhavan, fRowH, f.building_code, { bold: true, fontSize: 7.5 });
      x += fCols.bhavan;
      drawCellBox(doc, x, y, fCols.floor, fRowH, f.floor, { fontSize: 7.5 });
      x += fCols.floor;
      drawCellBox(doc, x, y, fCols.rooms, fRowH, String(f.rooms_count), { fontSize: 7.5 });
      x += fCols.rooms;
      drawCellBox(doc, x, y, fCols.students, fRowH, String(f.student_count), { bold: true, fontSize: 8 });
      x += fCols.students;
      drawCellBox(doc, x, y, fCols.qp, fRowH, String(f.qp_with_buffer), { bold: true, fontSize: 8 });
      x += fCols.qp;
      drawCellBox(doc, x, y, fCols.booklets, fRowH, String(f.booklets_with_buffer), { bold: true, fontSize: 8 });
      x += fCols.booklets;
      drawCellBox(doc, x, y, fCols.seal, fRowH, '', { fontSize: 7.5 });
      y += fRowH;
    });

    const fBefore = fCols.sno + fCols.bhavan + fCols.floor;
    drawCellBox(doc, margin, y, fBefore, 20, 'TOTAL', { bold: true, align: 'right', fill: '#eef3f9', paddingX: 6, fontSize: 8 });
    drawCellBox(doc, margin + fBefore, y, fCols.rooms, 20, String(dispatch.totals.rooms), { bold: true, fill: '#eef3f9', fontSize: 8 });
    drawCellBox(doc, margin + fBefore + fCols.rooms, y, fCols.students, 20, String(dispatch.totals.students), { bold: true, fill: '#eef3f9', fontSize: 8 });
    drawCellBox(doc, margin + fBefore + fCols.rooms + fCols.students, y, fCols.qp, 20, String(dispatch.totals.qp_with_buffer), { bold: true, fill: '#eef3f9', fontSize: 8 });
    drawCellBox(doc, margin + fBefore + fCols.rooms + fCols.students + fCols.qp, y, fCols.booklets, 20, String(dispatch.totals.booklets_with_buffer), { bold: true, fill: '#eef3f9', fontSize: 8 });
    drawCellBox(doc, margin + fBefore + fCols.rooms + fCols.students + fCols.qp + fCols.booklets, y, fCols.seal, 20, '', { fill: '#eef3f9' });
    y += 32;

    // Section 2: Room-Wise & Subject-Wise Dispatch
    if (y + 60 > pageHeight - 70) {
      doc.addPage({ size: 'A4', layout: 'portrait', margin: 34 });
      y = margin;
    }

    doc.font('Helvetica-Bold').fontSize(9).fillColor('#0b5299').text('2. ROOM-WISE & SUBJECT-WISE PACKET DISPATCH', margin, y);
    y += 14;

    const rCols = {
      sno: 28,
      room: 60,
      floor: 66,
      cohort: 72,
      subject: 120,
      students: 46,
      qp: 46,
      booklets: 46,
      sign: usableWidth - (28 + 60 + 66 + 72 + 120 + 46 + 46 + 46),
    };

    const drawRoomHeader = (hy: number) => {
      let x = margin;
      drawCellBox(doc, x, hy, rCols.sno, 22, 'S.No', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += rCols.sno;
      drawCellBox(doc, x, hy, rCols.room, 22, 'Room No', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += rCols.room;
      drawCellBox(doc, x, hy, rCols.floor, 22, 'Floor', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += rCols.floor;
      drawCellBox(doc, x, hy, rCols.cohort, 22, 'Cohort', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += rCols.cohort;
      drawCellBox(doc, x, hy, rCols.subject, 22, 'Course / Subject', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += rCols.subject;
      drawCellBox(doc, x, hy, rCols.students, 22, 'Count', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += rCols.students;
      drawCellBox(doc, x, hy, rCols.qp, 22, 'QP Req.', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += rCols.qp;
      drawCellBox(doc, x, hy, rCols.booklets, 22, 'Booklets', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      x += rCols.booklets;
      drawCellBox(doc, x, hy, rCols.sign, 22, 'Seal Sign', { bold: true, fill: '#eef3f9', fontSize: 7.5 });
      return hy + 22;
    };

    y = drawRoomHeader(y);
    const rRowH = 20;
    dispatch.roomRows.forEach((r, idx) => {
      if (y + rRowH > pageHeight - 75) {
        doc.addPage({ size: 'A4', layout: 'portrait', margin: 34 });
        y = drawRoomHeader(margin);
      }
      let x = margin;
      drawCellBox(doc, x, y, rCols.sno, rRowH, String(idx + 1), { fontSize: 7.5 });
      x += rCols.sno;
      drawCellBox(doc, x, y, rCols.room, rRowH, r.room_no, { bold: true, fontSize: 7.5 });
      x += rCols.room;
      drawCellBox(doc, x, y, rCols.floor, rRowH, r.floor, { fontSize: 7 });
      x += rCols.floor;
      drawCellBox(doc, x, y, rCols.cohort, rRowH, r.cohort_label, { bold: true, fontSize: 7.5 });
      x += rCols.cohort;
      drawCellBox(doc, x, y, rCols.subject, rRowH, r.subject, { align: 'left', paddingX: 4, fontSize: 7 });
      x += rCols.subject;
      drawCellBox(doc, x, y, rCols.students, rRowH, String(r.student_count), { fontSize: 7.5 });
      x += rCols.students;
      drawCellBox(doc, x, y, rCols.qp, rRowH, String(r.qp_with_buffer), { bold: true, fontSize: 7.5 });
      x += rCols.qp;
      drawCellBox(doc, x, y, rCols.booklets, rRowH, String(r.booklets_with_buffer), { bold: true, fontSize: 7.5 });
      x += rCols.booklets;
      drawCellBox(doc, x, y, rCols.sign, rRowH, '', { fontSize: 7 });
      y += rRowH;
    });

    const sigY = Math.max(y + 34, pageHeight - 58);
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(9);
    doc.text('Dept. Examcell In-Charge', margin, sigY, { width: 180, align: 'left' });
    doc.text('QP Custodian / Chief Superintendent', pageWidth - margin - 200, sigY, { width: 200, align: 'right' });

    doc.end();
  });
}
