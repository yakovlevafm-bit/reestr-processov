/* ================================================================
   Импорт реестра процессов из xlsx (региональный шаблон реестра процессов ОГВ; префикс ID — из профиля ведомства).
   Читает лист по ячейкам — переносы строк внутри ячеек и объединённые
   ячейки не ломают строки. Колонки шаблона:
     A Министерство  B Идентификатор  C Группа  D Название  E Владелец
     F Статус реинжиниринга  G Клиент  H Вход  I Выход  J Вид
     K Человеко-часы на 1 экземпляр  L Экземпляров в год  M Сквозной
     N С кем  O Роль  P Тип (бумажный/…)  Q Формат  R Машиночитаемость  S Точка размещения
   ================================================================ */
'use strict';
const fs = require('fs');
const { openZip } = require('./zipread.js');

const unesc = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const norm = s => String(s || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n+/g, '\n').trim();

function readSheet(file, sheetName){
  const z = openZip(file);
  const ss = []; const sx = z.text('xl/sharedStrings.xml') || '';
  for (const m of sx.matchAll(/<si>([\s\S]*?)<\/si>/g)) ss.push(unesc([...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(t => t[1]).join('')));
  const wb = z.text('xl/workbook.xml'); const rels = z.text('xl/_rels/workbook.xml.rels');
  const sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"[^>]*r:id="(rId\d+)"/g)].map(m => ({ name: unesc(m[1]), rid: m[2] }));
  const relMap = {}; for (const m of rels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]*)"/g)) relMap[m[1]] = m[2].replace(/^\/xl\//, '').replace(/^\//, '');
  const sh = sheets.find(s => !sheetName || s.name === sheetName) || sheets[0];
  const xml = z.text('xl/' + relMap[sh.rid]) || '';
  const rows = new Map();
  // пустая строка с форматом пишется как <row r="5" .../> — без этой ветки она «съела» бы ячейки следующей строки
  for (const r of xml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)){
    const cells = {};
    for (const c of (r[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
      const col = (/r="([A-Z]+)\d+"/.exec(c[1]) || [])[1]; const t = (/t="([^"]*)"/.exec(c[1]) || [])[1]; const inner = c[2] || '';
      let v = (/<v>([\s\S]*?)<\/v>/.exec(inner) || [])[1];
      if (t === 's' && v !== undefined) v = ss[+v];
      else if (t === 'inlineStr') v = unesc([...inner.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => x[1]).join(''));
      else if (v !== undefined) v = unesc(v);
      if (v !== undefined && v !== '') cells[col] = v;
    }
    rows.set(+r[1], cells);
  }
  return { sheet: sh.name, rows };
}

const num = v => { if (v === undefined || v === null) return null; const m = String(v).replace(/\s/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? +m[0] : null; };

/** Реестр → массив процессов { id, row, code, group, name, owner, status, client, input, output, kind, hoursRaw, hours, hoursUnit, perYearRaw, perYear, cross, crossWith, role, paper, format, machine, place } */
function importRegistry(file){
  const { sheet, rows } = readSheet(file);
  // строка заголовка — где в D стоит «Название процесса»
  let headRow = 8; for (const [r, c] of rows) if (/Название процесса/i.test(c.D || '')) { headRow = r; break; }
  const out = [];
  for (const [r, c] of [...rows].sort((a, b) => a[0] - b[0])){
    if (r <= headRow || !c.D) continue;
    const hoursRaw = norm(c.K), perYearRaw = norm(c.L);
    out.push({
      id: require('./profile.js').load().org.idPrefix + '-' + r, row: r, code: norm(c.B), group: norm(c.C), name: norm(c.D).replace(/\s+/g, ' '), owner: norm(c.E).replace(/\s+/g, ' '), status: norm(c.F),
      client: norm(c.G), input: norm(c.H), output: norm(c.I), kind: norm(c.J),
      hoursRaw, hours: num(hoursRaw), hoursUnit: /час/i.test(hoursRaw) ? 'ч' : /мин/i.test(hoursRaw) ? 'мин' : '',
      perYearRaw, perYear: num(perYearRaw),
      cross: norm(c.M), crossWith: norm(c.N), role: norm(c.O), paper: norm(c.P), format: norm(c.Q), machine: norm(c.R), place: norm(c.S),
    });
  }
  // дубли по названию: помечаем, но не удаляем — решает оператор
  const seen = new Map();
  for (const p of out){ const k = p.name.toLowerCase().replace(/[^а-яёa-z0-9]+/g, ' ').trim().slice(0, 90); if (seen.has(k)) p.duplicateOf = seen.get(k); else seen.set(k, p.id); }
  return { sheet, processes: out, meta: { file, imported: new Date().toISOString(), rows: out.length, duplicates: out.filter(p => p.duplicateOf).length } };
}

module.exports = { importRegistry, readSheet, num, norm };
