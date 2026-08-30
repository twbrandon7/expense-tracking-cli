import { sheets_v4 } from 'googleapis';
import { getSheetsClient } from '../auth/gmail-auth';
import { ClassifiedSummaryRow } from '../types';

export interface SyncOptions {
  spreadsheetId: string;
  yearMonth: string; // YYYY-MM, e.g. "2026-07"
  sheetName?: string; // Optional exact or approximate sheet tab name
  summaryRows: ClassifiedSummaryRow[];
  overrideSheet?: boolean;
}

export interface SyncResult {
  updatedCount: number;
  insertedCount: number;
  sheetTitle: string;
  month: number;
  year: number;
}

/**
 * Finds target sheet using approximate matching and validates single-match requirement.
 */
export function findTargetSheet(
  sheetsList: sheets_v4.Schema$Sheet[],
  targetYear: number,
  sheetNameQuery?: string
): sheets_v4.Schema$Sheet {
  const availableTitles = sheetsList
    .map(s => s.properties?.title?.trim())
    .filter((t): t is string => Boolean(t));

  if (sheetNameQuery && sheetNameQuery.trim()) {
    const query = sheetNameQuery.trim();
    const normQuery = normalizeName(query);

    // 1. Exact match
    const exact = sheetsList.find(
      s => (s.properties?.title || '').trim() === query
    );
    if (exact) return exact;

    // 2. Approximate match (substring / normalized)
    let matches = sheetsList.filter(s => {
      const title = s.properties?.title || '';
      const normTitle = normalizeName(title);
      return normTitle.includes(normQuery) || normQuery.includes(normTitle);
    });

    if (!normQuery.includes('股票')) {
      const nonStockMatches = matches.filter(s => !(s.properties?.title || '').includes('股票'));
      if (nonStockMatches.length > 0) {
        matches = nonStockMatches;
      }
    }

    if (matches.length === 1) {
      return matches[0];
    }
    if (matches.length === 0) {
      throw new Error(
        `No sheet tab found matching "${query}". Available sheets: [${availableTitles.join(', ')}]`
      );
    }
    const matchedNames = matches.map(s => s.properties?.title).join(', ');
    throw new Error(
      `Multiple sheet tabs matched query "${query}": [${matchedNames}]. Please provide a more specific sheet name.`
    );
  }

  // Approximate match on target year (excluding "股票" by default)
  const yearStr = String(targetYear);
  const yearMatches = sheetsList.filter(s => {
    const title = s.properties?.title || '';
    return title.includes(yearStr) && !title.includes('股票');
  });

  if (yearMatches.length === 1) {
    return yearMatches[0];
  }
  if (yearMatches.length === 0) {
    const allYearMatches = sheetsList.filter(s => (s.properties?.title || '').includes(yearStr));
    if (allYearMatches.length === 1) {
      return allYearMatches[0];
    }
    if (allYearMatches.length === 0) {
      throw new Error(
        `No sheet tab found for year ${targetYear}. Available sheets: [${availableTitles.join(', ')}]`
      );
    }
    const matchNames = allYearMatches.map(s => s.properties?.title).join(', ');
    throw new Error(
      `Multiple sheet tabs found matching year ${targetYear}: [${matchNames}]. Please specify the target sheet tab using --sheet-name (e.g. --sheet-name "${allYearMatches[0].properties?.title}") or set sheet_name in config.yaml.`
    );
  }

  const matchNames = yearMatches.map(s => s.properties?.title).join(', ');
  throw new Error(
    `Multiple sheet tabs found matching year ${targetYear}: [${matchNames}]. Please specify the target sheet tab using --sheet-name (e.g. --sheet-name "${yearMatches[0].properties?.title}") or set sheet_name in config.yaml.`
  );
}

/**
 * Normalizes category and sub_type names for resilient matching.
 * e.g., '計畫' <-> '計劃', trimming whitespace.
 */
export function normalizeName(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/畫/g, '劃')
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Formats a formula string for Google Sheets.
 * e.g. "202 + 3" -> "=202+3", "56" -> "=56"
 */
export function formatFormula(formula: string, amount: number): string {
  const trimmed = formula ? formula.trim() : '';
  if (!trimmed) {
    return `=${amount}`;
  }
  if (trimmed.startsWith('=')) {
    return trimmed;
  }
  return `=${trimmed}`;
}

/**
 * Merges an existing cell formula/value with a new formula.
 */
export function combineFormula(existingFormulaOrValue: string, newFormula: string): string {
  const cleanNew = newFormula.startsWith('=') ? newFormula.substring(1).trim() : newFormula.trim();
  if (!existingFormulaOrValue || existingFormulaOrValue.trim() === '') {
    return `=${cleanNew}`;
  }

  const trimmedExisting = existingFormulaOrValue.trim();
  if (trimmedExisting.startsWith('=')) {
    const existingBody = trimmedExisting.substring(1).trim();
    return `=${existingBody} + ${cleanNew}`;
  }

  return `=${trimmedExisting} + ${cleanNew}`;
}

/**
 * Merges existing cell note with new comment.
 */
export function combineNote(existingNote: string | undefined, newComment: string): string {
  const comment = newComment ? newComment.trim() : '';
  if (!existingNote || existingNote.trim() === '') {
    return comment;
  }
  if (!comment) {
    return existingNote.trim();
  }
  return `${existingNote.trim()}\n${comment}`;
}

export async function syncClassifiedSummaryToSheets(options: SyncOptions): Promise<SyncResult> {
  const { spreadsheetId, yearMonth, summaryRows, overrideSheet = false } = options;

  const [yearStr, monthStr] = yearMonth.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    throw new Error(`Invalid yearMonth format: "${yearMonth}". Expected YYYY-MM.`);
  }

  console.log(`Sync mode: ${overrideSheet ? 'Override existing records (--override-sheet)' : 'Append to existing records'}`);

  const sheets = await getSheetsClient();

  // 1. Fetch spreadsheet metadata and sheet list
  const spreadsheetMeta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))'
  });

  const sheetsList = spreadsheetMeta.data.sheets || [];
  if (sheetsList.length === 0) {
    throw new Error(`No sheets found in spreadsheet ${spreadsheetId}`);
  }

  // Find target sheet tab using approximate matching & single-match enforcement
  const targetSheet = findTargetSheet(sheetsList, year, options.sheetName);
  const sheetId = targetSheet.properties!.sheetId!;
  const sheetTitle = targetSheet.properties!.title!;

  console.log(`Found target sheet tab: "${sheetTitle}" (sheetId: ${sheetId})`);

  // Target month column index (0-based):
  // Col E = 1月 (idx 4), Col F = 2月 (idx 5), ..., Col P = 12月 (idx 15)
  const targetColIndex = 4 + (month - 1);
  const targetColLetter = String.fromCharCode(65 + targetColIndex);
  console.log(`Target billing month: ${year}-${String(month).padStart(2, '0')} -> Column ${targetColLetter} (${month}月)`);

  // 2. Fetch sheet grid data
  const gridRes = await sheets.spreadsheets.get({
    spreadsheetId,
    ranges: [`${sheetTitle}!A1:R120`],
    includeGridData: true,
    fields: 'sheets(data(rowData(values(userEnteredValue,formattedValue,note))))'
  });

  const rowData = gridRes.data.sheets?.[0]?.data?.[0]?.rowData || [];

  // Helper to get text value of cell
  const getCellText = (rIdx: number, cIdx: number): string => {
    if (rIdx >= rowData.length) return '';
    const cell = rowData[rIdx]?.values?.[cIdx];
    if (!cell) return '';
    return (
      cell.formattedValue ||
      cell.userEnteredValue?.stringValue ||
      (cell.userEnteredValue?.numberValue !== undefined ? String(cell.userEnteredValue.numberValue) : '') ||
      cell.userEnteredValue?.formulaValue ||
      ''
    ).trim();
  };

  const getCellFormulaOrValue = (rIdx: number, cIdx: number): string => {
    if (rIdx >= rowData.length) return '';
    const cell = rowData[rIdx]?.values?.[cIdx];
    if (!cell) return '';
    if (cell.userEnteredValue?.formulaValue) {
      return cell.userEnteredValue.formulaValue;
    }
    if (cell.userEnteredValue?.numberValue !== undefined) {
      return String(cell.userEnteredValue.numberValue);
    }
    if (cell.userEnteredValue?.stringValue) {
      return cell.userEnteredValue.stringValue;
    }
    return cell.formattedValue || '';
  };

  const getCellNote = (rIdx: number, cIdx: number): string => {
    if (rIdx >= rowData.length) return '';
    return rowData[rIdx]?.values?.[cIdx]?.note || '';
  };

  // 3. Scan and locate sections
  // We are looking for the "負債" section containing "計劃" and "非計劃"
  let plannedStartRow = -1;
  let plannedEndRow = -1;
  let unplannedStartRow = -1;
  let unplannedEndRow = -1;
  let totalDebtRow = -1;

  for (let r = 0; r < rowData.length; r++) {
    const colB = getCellText(r, 1);
    const colC = getCellText(r, 2);
    const colD = getCellText(r, 3);

    const normB = normalizeName(colB);
    const normC = normalizeName(colC);
    const normD = normalizeName(colD);

    if (normB === '負債' || normC === '計劃' || normC === '非計劃') {
      if (normC === '計劃') {
        if (plannedStartRow === -1) plannedStartRow = r;
      } else if (normC === '非計劃') {
        if (plannedEndRow === -1) plannedEndRow = r;
        if (unplannedStartRow === -1) unplannedStartRow = r;
      }
    }

    if (normB === '負債總計' || normC === '負債總計' || normD === '負債總計') {
      totalDebtRow = r;
      if (unplannedEndRow === -1) unplannedEndRow = r;
      break;
    }
  }

  // Fallbacks if not strictly found by header names
  if (plannedStartRow === -1) plannedStartRow = 19; // Default row 20 (0-indexed 19)
  if (unplannedStartRow === -1) unplannedStartRow = 35; // Default row 36 (0-indexed 35)
  if (plannedEndRow === -1) plannedEndRow = unplannedStartRow;
  if (totalDebtRow === -1) totalDebtRow = 42; // Default row 43 (0-indexed 42)
  if (unplannedEndRow === -1) unplannedEndRow = totalDebtRow;

  console.log(`Detected section ranges:`);
  console.log(`  - 計劃 (Planned): Rows ${plannedStartRow + 1} to ${plannedEndRow}`);
  console.log(`  - 非計劃 (Unplanned): Rows ${unplannedStartRow + 1} to ${unplannedEndRow}`);
  console.log(`  - 負債總計 (Total Debt Row): Row ${totalDebtRow + 1}`);

  // Build mapping of existing sub_types in Column D to 0-based row indices
  interface SubTypeLocation {
    rowIndex: number;
    category: '計劃' | '非計劃';
    name: string;
  }

  const existingMap = new Map<string, SubTypeLocation>();

  for (let r = plannedStartRow; r < plannedEndRow; r++) {
    const colD = getCellText(r, 3);
    if (colD) {
      existingMap.set(`計劃:${normalizeName(colD)}`, { rowIndex: r, category: '計劃', name: colD });
    }
  }

  for (let r = unplannedStartRow; r < unplannedEndRow; r++) {
    const colD = getCellText(r, 3);
    if (colD) {
      existingMap.set(`非計劃:${normalizeName(colD)}`, { rowIndex: r, category: '非計劃', name: colD });
    }
  }

  // Group summary rows into existing vs new rows
  const updatesToApply: {
    rowIndex: number;
    subType: string;
    category: string;
    newFormula: string;
    newComment: string;
  }[] = [];

  const rowsToInsert: {
    subType: string;
    category: '計劃' | '非計劃';
    summaryRow: ClassifiedSummaryRow;
  }[] = [];

  for (const sRow of summaryRows) {
    const normType = normalizeName(sRow.type);
    if (normType !== '計劃' && normType !== '非計劃') {
      console.log(`[SheetsSync] Skipping non-expense summary row: [${sRow.type}] ${sRow.sub_type} ($${sRow.amount})`);
      continue;
    }
    const category: '計劃' | '非計劃' = normType === '非計劃' ? '非計劃' : '計劃';
    const normSub = normalizeName(sRow.sub_type);
    const key = `${category}:${normSub}`;

    const existing = existingMap.get(key);
    if (existing) {
      updatesToApply.push({
        rowIndex: existing.rowIndex,
        subType: sRow.sub_type,
        category,
        newFormula: formatFormula(sRow.formula, sRow.amount),
        newComment: sRow.comment
      });
    } else {
      rowsToInsert.push({
        subType: sRow.sub_type,
        category,
        summaryRow: sRow
      });
    }
  }

  let insertedCount = 0;
  let updatedCount = 0;

  // 4. Handle Row Insertions if there are new types
  if (rowsToInsert.length > 0) {
    console.log(`Found ${rowsToInsert.length} new sub_types requiring new row insertions:`);
    for (const item of rowsToInsert) {
      console.log(`  + [${item.category}] ${item.subType} ($${item.summaryRow.amount})`);
    }

    for (const item of rowsToInsert) {
      // Find insertion point for this category
      let insertIndex = -1;

      if (item.category === '計劃') {
        let placeholderIdx = -1;
        for (let r = plannedStartRow; r < plannedEndRow; r++) {
          const colD = getCellText(r, 3);
          const norm = normalizeName(colD);
          if (norm.startsWith('其他') || norm === '-') {
            placeholderIdx = r;
            break;
          }
        }
        insertIndex = placeholderIdx !== -1 ? placeholderIdx : plannedEndRow;
      } else {
        let placeholderIdx = -1;
        for (let r = unplannedStartRow; r < unplannedEndRow; r++) {
          const colD = getCellText(r, 3);
          const norm = normalizeName(colD);
          if (norm.startsWith('其他') || norm === '-') {
            placeholderIdx = r;
            break;
          }
        }
        insertIndex = placeholderIdx !== -1 ? placeholderIdx : unplannedEndRow;
      }

      // Execute insert dimension
      const totalDebtRowNum = totalDebtRow + 1 + 1; // +1 1-based, +1 for row being inserted
      const newRowNum = insertIndex + 1;

      const formulaVal = formatFormula(item.summaryRow.formula, item.summaryRow.amount);
      const commentVal = item.summaryRow.comment || '';

      const monthCellFormat: sheets_v4.Schema$CellFormat = {
        numberFormat: {
          type: 'NUMBER',
          pattern: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)'
        },
        horizontalAlignment: 'CENTER',
        textFormat: {
          foregroundColor: { red: 0.7529412 },
          fontFamily: 'Microsoft JhengHei',
          fontSize: 12
        }
      };

      const requests: sheets_v4.Schema$Request[] = [
        {
          insertDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: insertIndex,
              endIndex: insertIndex + 1
            },
            inheritFromBefore: true
          }
        },
        {
          updateCells: {
            range: {
              sheetId,
              startRowIndex: insertIndex,
              endRowIndex: insertIndex + 1,
              startColumnIndex: 3, // Col D (sub_type)
              endColumnIndex: 4
            },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { stringValue: item.subType },
                    userEnteredFormat: {
                      textFormat: {
                        foregroundColor: { red: 0.7529412 },
                        fontFamily: 'Microsoft JhengHei',
                        fontSize: 12
                      }
                    }
                  }
                ]
              }
            ],
            fields: 'userEnteredValue,userEnteredFormat.textFormat'
          }
        },
        {
          // Write Month Value & Note with matching format
          updateCells: {
            range: {
              sheetId,
              startRowIndex: insertIndex,
              endRowIndex: insertIndex + 1,
              startColumnIndex: targetColIndex,
              endColumnIndex: targetColIndex + 1
            },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { formulaValue: formulaVal },
                    userEnteredFormat: monthCellFormat,
                    note: commentVal
                  }
                ]
              }
            ],
            fields: 'userEnteredValue,userEnteredFormat,note'
          }
        },
        {
          // Write Total (Col Q) & % (Col R)
          updateCells: {
            range: {
              sheetId,
              startRowIndex: insertIndex,
              endRowIndex: insertIndex + 1,
              startColumnIndex: 16, // Col Q
              endColumnIndex: 18 // Col R
            },
            rows: [
              {
                values: [
                  {
                    userEnteredValue: { formulaValue: `=SUM(E${newRowNum}:P${newRowNum})` }
                  },
                  {
                    userEnteredValue: { formulaValue: `=Q${newRowNum}/$Q$${totalDebtRowNum}` }
                  }
                ]
              }
            ],
            fields: 'userEnteredValue'
          }
        }
      ];

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests }
      });

      insertedCount++;

      // Adjust boundaries after insertion
      if (item.category === '計劃') {
        plannedEndRow++;
        unplannedStartRow++;
        unplannedEndRow++;
        totalDebtRow++;
      } else {
        unplannedEndRow++;
        totalDebtRow++;
      }

      // Adjust indices of already queued updates that are below insertIndex
      for (const update of updatesToApply) {
        if (update.rowIndex >= insertIndex) {
          update.rowIndex++;
        }
      }
    }
  }

  // 5. Apply Updates to Existing Rows
  if (updatesToApply.length > 0) {
    console.log(`Updating ${updatesToApply.length} existing rows in Column ${targetColLetter}...`);

    const updateRequests: sheets_v4.Schema$Request[] = [];

    for (const upd of updatesToApply) {
      let combinedFormulaVal: string;
      let combinedNoteVal: string;

      if (overrideSheet) {
        combinedFormulaVal = upd.newFormula;
        combinedNoteVal = upd.newComment || '';
      } else {
        const existingFormulaOrVal = getCellFormulaOrValue(upd.rowIndex, targetColIndex);
        const existingNote = getCellNote(upd.rowIndex, targetColIndex);
        combinedFormulaVal = combineFormula(existingFormulaOrVal, upd.newFormula);
        combinedNoteVal = combineNote(existingNote, upd.newComment);
      }

      updateRequests.push({
        updateCells: {
          range: {
            sheetId,
            startRowIndex: upd.rowIndex,
            endRowIndex: upd.rowIndex + 1,
            startColumnIndex: targetColIndex,
            endColumnIndex: targetColIndex + 1
          },
          rows: [
            {
              values: [
                {
                  userEnteredValue: { formulaValue: combinedFormulaVal },
                  note: combinedNoteVal
                }
              ]
            }
          ],
          fields: 'userEnteredValue,note'
        }
      });
      updatedCount++;
    }

    if (updateRequests.length > 0) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: { requests: updateRequests }
      });
    }
  }

  return {
    updatedCount,
    insertedCount,
    sheetTitle,
    month,
    year
  };
}
