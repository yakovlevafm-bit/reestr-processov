/**
 * Минимальный писатель xlsx поверх собственного zip.
 * Строки пишем инлайном (inlineStr) — так не нужен sharedStrings.xml.
 */
const { createZip } = require('./zipread.js');

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const colLetter = (n) => {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
};

// Индексы стилей — совпадают с порядком cellXfs ниже.
const S = {
  DEFAULT: 0, HEAD: 1, TEXT: 2, WRAP: 3, NUM: 4, NUM2: 5,
  BOLD: 6, BOLD_NUM: 7, NOTE: 8, OK: 9, WARN: 10, TITLE: 11,
  // Жёлтые — ячейки ввода: пользователь меняет их, формулы пересчитываются.
  INPUT: 12, DATE: 13, PCT: 14, INPUT_PCT: 15, INPUT_DATE: 16, BOLD_NUM2: 17, INPUT_TEXT: 18,
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4">
  <numFmt numFmtId="164" formatCode="#,##0"/>
  <numFmt numFmtId="165" formatCode="#,##0.00"/>
  <numFmt numFmtId="166" formatCode="0.0%"/>
  <numFmt numFmtId="167" formatCode="dd.mm.yyyy"/>
</numFmts>
<fonts count="7">
  <font><sz val="11"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><name val="Calibri"/></font>
  <font><i/><sz val="9"/><color rgb="FF666666"/><name val="Calibri"/></font>
  <font><sz val="11"/><color rgb="FF1B5E20"/><name val="Calibri"/></font>
  <font><sz val="11"/><color rgb="FFB71C1C"/><name val="Calibri"/></font>
  <font><b/><sz val="14"/><name val="Calibri"/></font>
  <font><b/><sz val="11"/><color rgb="FF333333"/><name val="Calibri"/></font>
</fonts>
<fills count="5">
  <fill><patternFill patternType="none"/></fill>
  <fill><patternFill patternType="gray125"/></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFE8E8E8"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFF8E1"/><bgColor indexed="64"/></patternFill></fill>
  <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
  <border><left/><right/><top/><bottom/><diagonal/></border>
  <border>
    <left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right>
    <top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/>
  </border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="19">
  <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
  <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top"/></xf>
  <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  <xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  <xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  <xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  <xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
  <xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
  <xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="4" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
  <xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  <xf numFmtId="165" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
  <xf numFmtId="167" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  <xf numFmtId="166" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1"/>
  <xf numFmtId="166" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
  <xf numFmtId="167" fontId="0" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/>
  <xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>
  <xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
</styleSheet>`;

/** cell: число, строка или {v, s, f} */
function cellXml(ref, cell) {
  if (cell === null || cell === undefined || cell === '') return '';
  const o = (typeof cell === 'object' && !Array.isArray(cell)) ? cell : { v: cell };
  const s = o.s ?? S.DEFAULT;
  // Формула: значение v (если есть) кладём как кэш, Excel всё равно пересчитает.
  if (o.f) {
    const v = (typeof o.v === 'number' && Number.isFinite(o.v)) ? `<v>${o.v}</v>` : '';
    return `<c r="${ref}" s="${s}"><f>${esc(o.f)}</f>${v}</c>`;
  }
  if (typeof o.v === 'number' && Number.isFinite(o.v)) {
    return `<c r="${ref}" s="${s}"><v>${o.v}</v></c>`;
  }
  return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(o.v)}</t></is></c>`;
}

function sheetXml(rows, { widths = [], freeze = 0, autoFilter = null } = {}) {
  const cols = widths.length
    ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const pane = freeze
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${freeze}" topLeftCell="A${freeze + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '';

  const body = rows.map((cells, ri) => {
    const r = ri + 1;
    const xs = cells.map((c, ci) => cellXml(`${colLetter(ci + 1)}${r}`, c)).join('');
    return xs ? `<row r="${r}">${xs}</row>` : `<row r="${r}"/>`;
  }).join('');

  // autoFilter обязан идти ПОСЛЕ sheetData — Excel строг к порядку элементов
  // и на перестановке молча объявляет файл повреждённым.
  const filter = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : '';

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + pane + cols + `<sheetData>${body}</sheetData>${filter}</worksheet>`;
}

/** sheets: [{name, rows, widths, freeze}] */
function buildXlsx(sheets) {
  const B = (s) => Buffer.from(s, 'utf8');

  const wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
    + sheets.map((s, i) => `<sheet name="${esc(s.name).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
    // Формулы пишем без кэша значений — просим Excel пересчитать всё при открытии.
    + '</sheets><calcPr calcId="0" fullCalcOnLoad="1"/></workbook>';

  const wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
    + `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
    + '</Relationships>';

  const ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';

  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';

  const entries = [
    { name: '[Content_Types].xml', data: B(ct) },
    { name: '_rels/.rels', data: B(rels) },
    { name: 'xl/workbook.xml', data: B(wb) },
    { name: 'xl/_rels/workbook.xml.rels', data: B(wbRels) },
    { name: 'xl/styles.xml', data: B(STYLES) },
  ];
  sheets.forEach((s, i) => entries.push({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    data: B(sheetXml(s.rows, { widths: s.widths, freeze: s.freeze, autoFilter: s.autoFilter })),
  }));

  return createZip(entries);
}

module.exports = { buildXlsx, S };
