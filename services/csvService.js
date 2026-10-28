// -------------------------------------------------------------
// RFC 4180 CSV parser for validated complaint imports (SIH26264).
// Pure JavaScript, no external dependencies.
//
// Handles:
//   - Quoted fields containing commas, CR/LF and escaped quotes ("" )
//   - Both CRLF and LF line endings
//   - UTF-8 byte order mark
//   - Physical line tracking so validation errors map back to the
//     exact line in the operator's source file
//
// Structural failures (unterminated quote, stray mid-field quote)
// are returned as a file-level error; per-row problems are left for
// the caller's row-level validation.
// -------------------------------------------------------------

/**
 * Parse raw CSV text.
 * @param {string} text
 * @returns {{ rows: Array<{line: number, cells: string[]}>, error: string|null }}
 */
function parseCsv(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { rows: [], error: 'CSV content is empty.' };
  }

  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xFEFF) {
    text = text.slice(1);
  }

  const rows = [];
  let cells = [];
  let field = '';
  let inQuotes = false;
  let line = 1;          // physical line where the current row started
  let rowStartLine = 1;
  let i = 0;

  const pushField = () => {
    cells.push(field);
    field = '';
  };

  const pushRow = () => {
    pushField();
    rows.push({ line: rowStartLine, cells });
    cells = [];
    rowStartLine = line;
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // escaped quote
          i += 2;
          continue;
        }
        inQuotes = false; // closing quote
        i += 1;
        continue;
      }
      if (ch === '\n') line += 1;
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"' && field === '') {
      inQuotes = true; // opening quote (only valid at field start)
      i += 1;
      continue;
    }

    if (ch === '"') {
      return { rows, error: `Malformed CSV: unexpected quote inside an unquoted field near line ${line}.` };
    }

    if (ch === ',') {
      pushField();
      i += 1;
      continue;
    }

    if (ch === '\r') {
      line += 1;
      pushRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }

    if (ch === '\n') {
      line += 1;
      pushRow();
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  if (inQuotes) {
    return { rows, error: 'Malformed CSV: unterminated quoted field (missing closing ").' };
  }

  // Flush the final row (no trailing newline)
  pushRow();

  // Drop rows that are entirely empty (blank lines)
  const nonEmpty = rows.filter(r => r.cells.some(c => c.trim() !== ''));
  return { rows: nonEmpty, error: null };
}

/**
 * Map a raw header cell to a canonical column key.
 * Normalises case/spacing so "Source Reference", "source_reference" and
 * "SOURCE-REFERENCE" all resolve identically.
 * Returns null for unknown headers (unknown columns are ignored, not fatal).
 */
const HEADER_ALIASES = {
  sourcereference: 'source_reference',
  sourceref: 'source_reference',
  externalreference: 'source_reference',
  ref: 'source_reference',
  institutionid: 'institution_id',
  institution: 'institution_id',
  instid: 'institution_id',
  bureau: 'bureau',
  cell: 'bureau',
  category: 'category',
  priority: 'priority',
  complainantname: 'complainant_name',
  complainant: 'complainant_name',
  complainantrole: 'complainant_role',
  complainantemail: 'complainant_email',
  email: 'complainant_email',
  complainantphone: 'complainant_phone',
  phone: 'complainant_phone',
  subject: 'subject',
  description: 'description',
  targetdate: 'target_date',
  slatargetdate: 'target_date',
  targetsladate: 'target_date', // exact exportToCSV() column name (round-trip)
  expecteddisposaldate: 'target_date',
  assignedofficer: 'assigned_officer',
  officer: 'assigned_officer'
};

function normalizeHeader(raw) {
  const key = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return HEADER_ALIASES[key] || null;
}

module.exports = { parseCsv, normalizeHeader };
