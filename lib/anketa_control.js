/* ================================================================
   Контроль сдачи анкет отделами.
   node reestr.js anketa-status [--napominanie] [--today дд.мм.гггг]
   → export/анкеты/Контроль сдачи анкет.xlsx
     · жёлтые столбцы (ответственный, контакт, дата назначения, примечание) заполняются вручную
       и сохраняются при пересборке (сопоставление по названию отдела);
     · остальное считается: файл в папке «получено», последняя загрузка из журнала (log.jsonl,
       act anketa_import), заполненность, строки на разбор, статус относительно сроков.
   --napominanie → export/анкеты/Напоминание <дата>.txt — текст письма отделам, не сдавшим анкету.
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { ROOT, DATA } = require('./store.js');
const { buildXlsx, S } = require('./xlsxwrite.js');
const { readSheet } = require('./registry_import.js');

const DIR = path.join(require('./storage.js').EXPORT, 'анкеты');
const INBOX = path.join(DIR, 'получено');           // сюда сохранять присланные отделами файлы
const FILE = path.join(DIR, 'Контроль сдачи анкет.xlsx');
// УСТАРЕЛО: контроль анкет от 13.10.2026 (они не рассылались). Новые анкеты — lib/anketa2.js, status2().
const SROK_OTV = '2026-10-15', SROK = '2026-10-20', KOMU = require('./profile.js').load().people.contact;
const local = utc => { if (!utc) return ''; const d = new Date(utc.replace(' ', 'T') + ':00Z'); return new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16).replace('T', ' '); }; // журнал в UTC → местное для показа
const ru = d => d ? d.slice(8, 10) + '.' + d.slice(5, 7) + '.' + d.slice(0, 4) : '';
const iso = s => { const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || '').trim()); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const pct = ([a, b]) => b ? Math.round(a / b * 100) : 0;
const deptOfFile = f => (/^Анкета — (.+?)(?: \(\d+\))?\.xlsx$/i.exec(f) || [])[1] || null;

function collect(today){
  // отделы и объём — по разосланным анкетам
  const depts = fs.readdirSync(DIR).filter(f => /^Анкета — .+\.xlsx$/i.test(f)).map(f => {
    const n = sheet => [...readSheet(path.join(DIR, f), sheet).rows].filter(([r, c]) => r > 1 && c.A).length;
    return { dept: deptOfFile(f), file: f, procs: n('Процессы'), facts: n('Факты'), q: n('Вопросы'), h: n('Гипотезы') };
  }).sort((a, b) => b.procs - a.procs);
  // ручные столбцы из прошлой версии таблицы
  const manual = {};
  if (fs.existsSync(FILE)){
    try {
      const { rows } = readSheet(FILE, 'Контроль');
      for (const [, c] of rows) if (c.B && /^\d+$/.test(String(c.A || ''))) manual[c.B] = { otv: c.C || '', contact: c.D || '', naznachen: c.E || '', note: c.F || '' };
    } catch (e) { throw new Error('Не прочитана прошлая таблица контроля (' + e.message + ') — ручные столбцы были бы потеряны, пересборка остановлена'); }
  }
  // присланные файлы
  fs.mkdirSync(INBOX, { recursive: true });
  const inbox = {};
  for (const f of fs.readdirSync(INBOX)){
    const d = deptOfFile(f); if (!d || f.startsWith('~$')) continue;
    const at = fs.statSync(path.join(INBOX, f)).mtime.toISOString().slice(0, 16).replace('T', ' '); // UTC, как store.now() в журнале
    if (!inbox[d] || inbox[d].at < at) inbox[d] = { file: f, at };
  }
  // последние загрузки из журнала
  const imp = {};
  for (const o of require('./store.js').store.readLog()){
    if (o.act !== 'anketa_import') continue;
    const d = o.dept || deptOfFile(o.file || ''); if (d) imp[d] = o; // журнал по времени — последняя запись побеждает
  }
  return depts.map(x => {
    const m = manual[x.dept] || {}, got = inbox[x.dept], li = imp[x.dept];
    let status, level = '';
    const left = days(today, SROK);
    if (got && (!li || li.at < got.at)){ status = 'получена, не загружена'; level = 'warn'; }
    else if (li){
      const fp = li.fill ? pct(li.fill.facts) : null;
      if (li.review) { status = `загружена, на разбор ${li.review}`; level = 'warn'; }
      else status = 'загружена';
      if (fp !== null && fp < 50){ status += ` · заполнено ${fp} % фактов`; level = 'warn'; }
      if (!li.review && (fp === null || fp >= 50)) level = 'ok';
    }
    else if (left < 0){ status = `ПРОСРОЧЕНО на ${-left} дн.`; level = 'bad'; }
    else if (!m.otv && today > SROK_OTV){ status = `нет ответственного (срок ${ru(SROK_OTV)} прошёл)`; level = 'bad'; }
    else if (!m.otv) status = `ждём ответственного до ${ru(SROK_OTV)}`;
    else status = left === 0 ? 'ждём анкету — срок сегодня' : `ждём анкету, осталось ${left} дн.`;
    if (left <= 1 && !got && !li && level !== 'bad') level = 'warn';
    return { ...x, ...m, got, li, status, level, submitted: !!(got || li) };
  });
}

function writeTable(rows, today){
  const H = v => ({ v, s: S.HEAD }), T = v => ({ v: v ?? '', s: S.WRAP }), N = v => ({ v, s: S.NUM }), I = v => ({ v: v || '', s: S.INPUT_TEXT });
  const L = { ok: S.OK, warn: S.WARN, bad: S.WARN };
  const sub = rows.filter(r => r.submitted).length, otv = rows.filter(r => r.otv).length, rev = rows.reduce((s, r) => s + (r.li ? r.li.review || 0 : 0), 0);
  const out = [
    [{ v: 'Контроль сдачи анкет по процессам ' + require('./profile.js').load().org.short, s: S.TITLE }],
    [T(`на ${ru(today)} · ответственные до ${ru(SROK_OTV)}, анкеты до ${ru(SROK)} → ${KOMU} · ответственных назначено ${otv} из ${rows.length} · анкет получено ${sub} из ${rows.length} · строк на разбор ${rev}`)],
    [T('Жёлтые столбцы заполняются вручную и сохраняются при пересборке. Присланные файлы класть в export\\анкеты\\получено\\ без переименования, затем: node reestr.js anketa-import export\\анкеты\\получено  и  node reestr.js anketa-status')],
    [],
    ['№', 'Отдел', 'Ответственный (ФИО, должность)', 'Телефон / e-mail', 'Назначен (дата)', 'Примечание', 'Процессов', 'Строк фактов', 'Статус', 'Файл получен', 'Загружен', 'Заполнено фактов', 'Ответов на вопросы', 'Гипотез с ответом', 'На разбор', 'Файл разбора'].map(H),
  ];
  rows.forEach((r, i) => {
    const f = r.li && r.li.fill;
    out.push([N(i + 1), T(r.dept), I(r.otv), I(r.contact), I(r.naznachen), I(r.note), N(r.procs), N(r.facts), { v: r.status, s: L[r.level] ?? S.WRAP },
      T(r.got ? local(r.got.at) : ''), T(r.li ? local(r.li.at) : ''),
      T(f ? `${f.facts[0]} из ${f.facts[1]} (${pct(f.facts)} %)` : ''), T(f ? `${f.questions[0]} из ${f.questions[1]}` : ''), T(f ? `${f.hyps[0]} из ${f.hyps[1]}` : ''),
      r.li ? N(r.li.review || 0) : T(''), T(r.li && r.li.review ? `ответы\\Разбор — ${r.li.file.replace(/\.xlsx$/i, '')}.xlsx` : '')]);
  });
  const buf = buildXlsx([{ name: 'Контроль', rows: out, widths: [4, 48, 30, 24, 12, 30, 9, 9, 34, 15, 15, 16, 12, 12, 9, 50], freeze: 5, autoFilter: `A5:P${out.length}` }]);
  try { fs.writeFileSync(FILE, buf); return FILE; }
  catch (e) { if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e; const alt = FILE.replace(/\.xlsx$/, ` (${today}).xlsx`); fs.writeFileSync(alt, buf); return alt + '  ← основной файл открыт в Excel, закройте его и пересоберите'; }
}

function reminder(rows, today){
  const wait = rows.filter(r => !r.submitted);
  if (!wait.length) return null;
  const left = days(today, SROK);
  const when = left > 1 ? `до ${ru(SROK)} (осталось ${left} дн.)` : left === 1 ? `завтра, ${ru(SROK)}` : left === 0 ? `сегодня, ${ru(SROK)}` : `${ru(SROK)} (срок прошёл)`;
  const lines = [
    `Напоминание о сроке представления анкет по процессам — на ${ru(today)}`,
    '',
    'КОМУ (не сдали анкету):',
    ...wait.map(r => `  • ${r.dept} — ${r.otv ? r.otv + (r.contact ? ', ' + r.contact : '') : 'ОТВЕТСТВЕННЫЙ НЕ НАЗНАЧЕН — направить начальнику отдела'}; процессов ${r.procs}, строк «Факты» ${r.facts}`),
    '',
    'ТЕМА: Анкета по процессам отдела — срок ' + ru(SROK),
    '',
    'Коллеги, добрый день!',
    '',
    `Напоминаю: заполненную анкету по процессам отдела нужно направить ${when} (письмо министра о заполнении анкет). Обязателен лист «Факты»: подтвердите цифры реестра («да») или впишите верное значение с источником — ДЕЛО, журнал, отчёт, оценка специалиста.`,
    '',
    'Чтобы ответы загрузились автоматически: не переименовывайте файл и листы, не меняйте коды в первом столбце, не удаляйте строки. Время указывайте в часах на один случай (можно «30 мин» — пересчитаем), количество — за 2025 год. Если данных нет, напишите «нет данных», если процесс ведёт другой отдел — укажите какой.',
    '',
    'Если анкета заполнена частично, пришлите то, что готово: повторная отправка исправленного файла не создаёт дублей.',
    '',
    `С уважением,\n${KOMU}`,
  ];
  const f = path.join(DIR, `Напоминание ${ru(today)}.txt`);
  fs.writeFileSync(f, '﻿' + lines.join('\r\n'));
  return { file: f, n: wait.length };
}

function status(opts = {}){
  const today = opts.today || new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  const rows = collect(today);
  const file = writeTable(rows, today);
  const rem = opts.napominanie ? reminder(rows, today) : null;
  return { today, rows, file, rem, inbox: INBOX };
}

module.exports = { status, iso, SROK, SROK_OTV, INBOX };
