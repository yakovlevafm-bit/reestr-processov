/* ================================================================
   Простая анкета отдела (20.10.2026) — вместо анкеты от 13.10 (лист «Факты» с кодами, вопросы и гипотезы ИИ).
   Один рабочий лист: строка = процесс, 7 жёлтых столбцов простыми словами, почти все — выбор из списка.
   Чистка дублей встроена: для строк-дублей подсказка «похоже, это то же, что …».
   build2() → export/анкеты2/Анкета — <отдел>.xlsx;  importSimple(file) → факты, card.dedup, card.v2 (struct, risk)
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { store, ROOT } = require('./store.js');
const { buildXlsx, S } = require('./xlsxwrite.js');
const { readSheet } = require('./registry_import.js');
const { deptOf, parseValue } = require('./anketa.js');

// названия подразделений для документов — по действующему штатному расписанию (профиль ведомства → departments.official)
const dept = owner => require('./profile.js').load().officialOf(owner);
const KIND = (o => ({ nom: o.kindNom || 'ведомство', gen: o.kindGen || 'ведомства' }))(require('./profile.js').load().org); // вид органа: министерство, комитет, управление

// выпадающие списки (без «;» — разделитель списков в Excel)
const L = {
  status: ['выполняем', 'то же, что в подсказке (дубль)', 'это этап другого процесса', 'больше не выполняем', 'выполняет другой отдел'],
  docs: ['на бумаге или сканом', 'файлы Word / Excel в свободной форме', 'единая форма, шаблон или система'],
  problems: ['нет', 'иногда: уточнения, переделки', 'часто: срывы сроков, жалобы, ошибки'],
  risk: ['незначительная', 'переделка внутри ' + KIND.gen, 'жалоба, проверка, бюджетные деньги или права заявителя'],
};
const HEAD_ROW = 6; // строка заголовка таблицы на листе «Процессы отдела»
const COLS = ['№', 'Код процесса', 'Процесс', 'Сейчас в реестре: раз в год', 'Сейчас в реестре: часов на 1 раз', 'Подсказка',
  '① Что с процессом?', '② Сколько раз в год?', '③ Сколько часов работы на 1 раз?', '④ Как поступают документы?', '⑤ Бывают ли проблемы?', '⑥ Цена ошибки', '⑦ Комментарий, что мешает, идеи'];

function regVal(facts, name){ const live = facts.filter(f => f.name === name && f.status !== 'rejected' && f.status !== 'superseded' && f.status !== 'ai'); const v = live.find(f => f.status === 'verified') || live[live.length - 1]; return v ? v.value : ''; }

function build2(opts = {}){
  const reg = store.processes(), facts = store.facts(), cards = store.cards();
  const ck = path.join(ROOT, 'delo', 'chistka_checklist.json');
  const dup = fs.existsSync(ck) ? Object.fromEntries(JSON.parse(fs.readFileSync(ck, 'utf8')).rows.map(r => [r.id, r])) : {};
  const by = {}; for (const p of reg.processes) (by[dept(p.owner)] = by[dept(p.owner)] || []).push(p);
  const dir = path.join(require('./storage.js').EXPORT, 'анкеты2'); fs.mkdirSync(dir, { recursive: true });
  const G = v => ({ v: v ?? '', s: S.WRAP }), GN = v => ({ v: v === '' ? '' : v, s: typeof v === 'number' ? S.NUM : S.WRAP }), Y = v => ({ v: v || '', s: S.INPUT_TEXT }), H = v => ({ v, s: S.HEAD });
  const out = [];
  for (const [d, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)){
    list.sort((a, b) => (a.row ?? 1e9) - (b.row ?? 1e9));
    const rows = [
      [{ v: `Анкета: ${d}`, s: S.TITLE }],
      [G(`Заполните жёлтые ячейки — по одной строке на каждый процесс отдела (${list.length}). Белые столбцы — справка, их не меняйте. Если сомневаетесь — напишите в комментарии.`)],
      [{ v: 'Кто заполнил (ФИО, должность):', s: S.BOLD }, G(''), G(''), Y('')],
      [{ v: 'Телефон:', s: S.BOLD }, G(''), G(''), Y('')],
      [],
      COLS.map(H),
    ];
    let nDup = 0;
    list.forEach((p, i) => {
      const f = facts.filter(x => x.pid === p.id); const c = cards[p.id] || {}; const dp = dup[p.id];
      const cnt = regVal(f, 'count'), hrs = regVal(f, 'hours');
      const hints = [];
      if (c.pilot) hints.push('проект оптимизации 2026 года');
      if (dp){ nDup++; hints.push(dp.action.startsWith('перенести') ? `Похоже, это этап процесса ${dp.ref} «${dp.refName.slice(0, 90)}»${dp.refDept !== d ? ' (' + dp.refDept + ')' : ''}` : dp.ref ? `Похоже, это то же, что ${dp.ref} «${dp.refName.slice(0, 90)}»${dp.refDept !== d ? ' (' + dp.refDept + ')' : ''}` : 'Похоже, дублирует другую строку реестра — уточните'); }
      if (typeof hrs === 'number' && (hrs > 100 || (typeof cnt === 'number' && cnt * hrs > 3200))) hints.push('Часы в реестре, похоже, указаны за год или в минутах — проверьте');
      rows.push([{ v: i + 1, s: S.NUM }, G(p.id), G(p.name), GN(cnt), GN(hrs), G(hints.join('. ')), Y(dp ? '' : 'выполняем'), Y(''), Y(''), Y(''), Y(''), Y(''), Y('')]);
    });
    const ins = [[{ v: 'Как заполнить анкету — 5 минут на чтение', s: S.TITLE }], [],
      ...[
        ['Что это', `Список всех процессов вашего отдела из реестра процессов ${KIND.gen}. Нужны ваши цифры и оценки: по ним ${KIND.nom} выбирает, какую работу упростить или автоматизировать в первую очередь, и считает реальную нагрузку отдела.`],
        ['Где заполнять', 'Лист «Процессы отдела». Одна строка — один процесс. Заполняются только жёлтые ячейки; в большинстве из них нужно выбрать вариант из списка (стрелка справа от ячейки).'],
        ['① Что с процессом?', 'Обычно оставьте «выполняем». Если в подсказке написано «похоже, это то же, что …» — выберите «то же, что в подсказке (дубль)» или «это этап другого процесса», а если это всё-таки отдельная работа — «выполняем» и в комментарии одной фразой, чем она отличается. Для дублей и этапов столбцы ②–⑥ не заполняйте.'],
        ['② Раз в год', 'Сколько раз за год выполняется работа: заявок, отчётов, писем, проверок. Можно «12», «ежемесячно», «около 300». Белый столбец левее — что записано сейчас; если верно — перепишите то же число.'],
        ['③ Часов на 1 раз', 'Сколько часов чистой работы специалистов уходит на один раз, без ожидания ответов и подписи. Можно «2», «0,5», «30 мин». Пример: отчёт готовится неделю, но работы в нём на 4 часа — пишите 4.'],
        ['④–⑥', 'Выберите из списка: как к вам поступают документы, бывают ли проблемы, и что будет, если в работе ошибиться.'],
        ['⑦ Комментарий', 'По желанию: что мешает, что можно упростить, какие данные приходится запрашивать повторно.'],
        ['Вверху листа', 'Укажите, кто заполнил, и телефон — чтобы можно было уточнить.'],
        ['Не меняйте', 'Код процесса, порядок строк и названия столбцов — ответы загружаются в реестр автоматически.'],
      ].map(([a, b]) => [{ v: a, s: S.BOLD }, G(b)]),
      [], [{ v: 'Пример', s: S.BOLD }, G('Процесс «Приём годовых отчётов подведомственных организаций», в реестре: 4 раза в год, 120 часов на 1 раз (подсказка: часы, похоже, за год).')],
      [{ v: '', s: S.TEXT }, G('① выполняем   ② ежеквартально   ③ 6   ④ файлы Word / Excel в свободной форме   ⑤ иногда: уточнения, переделки   ⑥ переделка внутри ' + KIND.gen + '   ⑦ предприятия присылают разные формы — нужен единый шаблон')],
    ];
    const safe = d.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
    const file = path.join(dir, `Анкета — ${safe}.xlsx`);
    fs.writeFileSync(file, buildXlsx([
      { name: 'Процессы отдела', rows, widths: [5, 10, 55, 11, 11, 38, 24, 12, 12, 26, 26, 30, 40], freeze: HEAD_ROW },
      { name: 'Как заполнить', rows: ins, widths: [22, 120] },
    ]));
    out.push({ dept: d, file, n: list.length, dup: nDup });
  }
  fs.writeFileSync(path.join(dir, 'lists.json'), JSON.stringify({ lists: L, headRow: HEAD_ROW, files: out.map(o => ({ file: o.file, n: o.n })) }, null, 1));
  return { dir, files: out };
}

/* ---- загрузка заполненной простой анкеты ----
   ② ③ → факты count/hours (parseValue: «ежемесячно», «30 мин», «около 300»), ④ → format/machine + card.v2.struct,
   ⑤ → факт problem 1/3/5, ⑥ (+⑤) → card.v2.risk, ① → card.dedup; спорное → файл разбора. Повторная загрузка не задваивает. */
const DOCS = { [L.docs[0]]: { format: 'бумажный', machine: 'немашиночитаемый', struct: 1 }, [L.docs[1]]: { format: 'частично цифровой', machine: 'немашиночитаемый', struct: 3 }, [L.docs[2]]: { format: 'полностью цифровой', machine: 'машиночитаемый', struct: 5 } };
const PROB = { [L.problems[0]]: 1, [L.problems[1]]: 3, [L.problems[2]]: 5 };
const RISK = { [L.risk[0]]: 1, [L.risk[1]]: 2, [L.risk[2]]: 4 };
const norm = s => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const pickList = (list, v) => list.find(x => norm(x) === norm(v));

function importSimple(file, opts = {}){
  const src = path.basename(file);
  const { sheet, rows } = readSheet(file, 'Процессы отдела');
  if (sheet !== 'Процессы отдела' || !String((rows.get(HEAD_ROW) || {}).B || '').startsWith('Код процесса')) throw new Error(`${src}: нет листа «Процессы отдела» в исходном виде — загрузка остановлена`);
  const who = String((rows.get(3) || {}).D || '').trim(), title = String((rows.get(1) || {}).A || '').replace(/^Анкета:\s*/, '').trim();
  const by = opts.who || who || (title ? 'анкета: ' + title : src);
  const facts = store.facts(), cards = store.cards(), at = store.now(); let seq = 0;
  const res = { file: src, by, rows: 0, facts: 0, dedup: 0, v2: 0, added: [], review: [] };
  const review = (row, pid, what, why) => res.review.push({ row, pid, what, why });
  // строки без кода (или с кодом не из реестра), но с названием — процессы, которых в реестре нет; с opts.addNew — добавляются
  const reg = store.processes(); const knownIds = new Set(reg.processes.map(p => p.id)); const newPid = new Map();
  let nextId = Math.max(0, ...reg.processes.map(p => +(p.id.split('-')[1]) || 0)) + 1;
  const nrm = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim();
  for (const [r, c] of [...rows].filter(([r]) => r > HEAD_ROW).sort((a, b) => a[0] - b[0])){
    const code = String(c.B || '').trim(), name = String(c.C || '').replace(/\s+/g, ' ').trim();
    if (knownIds.has(code) || !name) continue;
    const same = reg.processes.find(p => nrm(p.name) === nrm(name));
    if (same){ newPid.set(r, same.id); review(r, code || '(нет кода)', name, `такой процесс уже есть: ${same.id} — ответы отнесены к нему`); continue; }
    if (!opts.addNew){ review(r, code || '(нет кода)', name, 'новый процесс — в реестре нет (загрузка с --add-new добавит его)'); continue; }
    const id = require('./profile.js').load().org.idPrefix + '-' + nextId++;
    reg.processes.push({ id, row: null, code: '', group: '', name, owner: title, status: '', client: '', input: '', output: '', kind: '', hoursRaw: '', hours: null, hoursUnit: '', perYearRaw: '', perYear: null, cross: '', crossWith: '', role: '', paper: '', format: '', machine: '', place: '', source: 'anketa', addedAt: at, addedBy: by, addedFrom: src });
    knownIds.add(id); newPid.set(r, id); res.added.push({ id, name, row: r }); review(r, id, name, 'новый процесс по анкете — добавлен в реестр; проверить на дубли и уточнить получателя, вход и выход');
  }
  const addFact = (pid, name, value, unit, note, key) => {
    const live = facts.filter(f => f.pid === pid && f.name === name && f.status !== 'rejected' && f.status !== 'superseded');
    const ver = live.find(f => f.status === 'verified' && f.anketaKey !== key);
    const prev = live.find(f => f.anketaKey === key);
    if (prev && String(prev.value) === String(value)) return;
    if (ver && String(ver.value) !== String(value)){
      review(null, pid, `${store.FACT_NAMES[name] || name}: ${value}`, `уже подтверждено другое значение ${ver.value} (${ver.by}) — решить вручную`);
      // расхождение остаётся в карточке как ожидающий конфликт (модель доказательств, lib/maturity.js) — пока его не разберут, ось выше PRE не поднимается
      const old = ((cards[pid] || {}).conflicts || []).filter(x => !(x.name === name && String(x.value) === String(value)));
      setCard(pid, { conflicts: [...old, { name, value, verified: ver.value, verifiedBy: ver.by || '', src, at }] }, 'анкета: расхождение по ' + (store.FACT_NAMES[name] || name));
      return;
    }
    if (ver && String(ver.value) === String(value)) return;
    const nf = { id: 'f' + (facts.length + 1) + '-' + (Date.now() + seq++).toString(36), at, pid, name, value, unit, period: '2025', source: 'анкета отдела: ' + src, role: 'владелец процесса', status: 'verified', by, basis: 'анкета отдела' + (note ? '; ' + note : ''), anketaKey: key };
    for (const o of live.filter(f => f.status !== 'verified')){ o.status = 'superseded'; o.at = at; nf.replaces = o.id; }
    facts.push(nf); res.facts++;
  };
  const setCard = (pid, patch, what) => { const c = cards[pid] = cards[pid] || { history: [] }; Object.assign(c, patch); c.history = [...(c.history || []), { at, who: by, what }].slice(-50); };
  for (const [r, c] of [...rows].filter(([r]) => r > HEAD_ROW).sort((a, b) => a[0] - b[0])){
    const pid = newPid.get(r) || String(c.B || '').trim(); if (!pid) continue;
    if (!knownIds.has(pid)){ if (!newPid.has(r) && !String(c.C || '').trim()) review(r, pid, '', 'код процесса не найден в реестре'); continue; }
    if (newPid.has(r)) setCard(pid, { anketaNew: { by, at, src, row: r } }, 'анкета: процесс добавлен по анкете');
    const st = c.G ? pickList(L.status, c.G) : null; let comment = String(c.M || '').trim();
    if (c.G && !st){ review(r, pid, c.G, '① ответ не из списка'); continue; }
    // «выполняет другой отдел» + в ② написано, кто: это не число, а ответ на вопрос «кто»
    if (st === L.status[4] && String(c.H || '').trim() && !/\d/.test(String(c.H))){ comment = ['кто: ' + String(c.H).trim(), comment].filter(Boolean).join('; '); c.H = ''; }
    const filled = [c.H, c.I, c.J, c.K, c.L].some(v => String(v ?? '').trim());
    if ((!st || (st === L.status[0] && !(cards[pid] || {}).dedup)) && !filled && !comment) continue; // «выполняем» стоит заранее — без других ответов строку не считаем
    res.rows++;
    if (st && st !== L.status[0]){ setCard(pid, { dedup: { decision: st, comment, by, at, src } }, 'анкета: ' + st); res.dedup++; if (filled) review(r, pid, st, 'для дубля или этапа заполнены ②–⑥ — проверить, к какой строке относятся цифры'); continue; }
    if (st === L.status[0] && (cards[pid] || {}).dedup) setCard(pid, { dedup: { decision: st, comment, by, at, src } }, 'анкета: отдельный процесс');
    for (const [col, name] of [['H', 'count'], ['I', 'hours']]){
      if (!String(c[col] ?? '').trim()) continue;
      const p = parseValue(name, c[col]); if (!p) continue;
      if (p.review){ review(r, pid, c[col], (name === 'count' ? '② ' : '③ ') + p.review); continue; }
      addFact(pid, name, p.value, store.FACT_UNITS[name], p.note, `${pid}#s:${name}`);
    }
    const v2 = { ...((cards[pid] || {}).v2 || {}) }; let v2ch = false; const basis = `анкета отдела (${by}, ${at.slice(0, 10)})`;
    if (c.J){
      // смешанный вход «на бумаге или сканом/единая форма…» — берём наименее цифровой: он и ограничивает процесс
      let jv = pickList(L.docs, c.J); let mixed = '';
      if (!jv){ const parts = String(c.J).split(/[\/;]|\s+или\s+(?=единая|файлы)/).map(x => pickList(L.docs, x)).filter(Boolean); if (parts.length){ jv = L.docs.find(x => parts.includes(x)); mixed = `смешанный вход: ${String(c.J).trim()}`; } }
      const d = DOCS[jv]; if (!d) review(r, pid, c.J, '④ ответ не из списка'); else { if (mixed) review(r, pid, c.J, '④ смешанный вход — взят наименее цифровой («' + jv + '»), проверить'); addFact(pid, 'format', d.format, '', '', `${pid}#s:format`); addFact(pid, 'machine', d.machine, '', '', `${pid}#s:machine`); v2.struct = { score: d.struct, basis }; v2ch = true; } }
    let pr = null; if (c.K){ pr = PROB[pickList(L.problems, c.K)]; if (!pr) review(r, pid, c.K, '⑤ ответ не из списка'); else addFact(pid, 'problem', pr, '', '', `${pid}#s:problem`); }
    if (c.L){ const rk = RISK[pickList(L.risk, c.L)]; if (!rk) review(r, pid, c.L, '⑥ ответ не из списка'); else { v2.risk = { score: rk === 4 && pr === 5 ? 5 : rk, basis }; v2ch = true; } }
    if (v2ch){ setCard(pid, { v2 }, 'анкета: оценка v2'); res.v2++; }
    if (comment) setCard(pid, { anketaComment: { text: comment, by, at } }, 'анкета: комментарий');
  }
  if (!opts.dry){
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const bdir = path.join(ROOT, '..', '_Архив', 'бэкапы', `reestr_anketa2_${stamp}`); store.backup(bdir); // факты и карточки до загрузки
    res.backup = bdir; store.saveFacts(facts); store.saveCards(cards);
    if (res.added.length){ store.saveProcesses(reg); for (const a of res.added) store.log({ act: 'process_add', pid: a.id, name: a.name, basis: 'анкета отдела: ' + src }); }
    store.log({ act: 'anketa2_import', file: src, by, rows: res.rows, facts: res.facts, dedup: res.dedup, v2: res.v2, added: res.added.length, review: res.review.length });
  }
  if (res.review.length){
    const dir = path.join(require('./storage.js').EXPORT, 'анкеты2', 'разбор'); fs.mkdirSync(dir, { recursive: true });
    const T = v => ({ v: v ?? '', s: S.WRAP });
    res.reportFile = path.join(dir, `Разбор — ${src.replace(/\.xlsx$/i, '')}${opts.dry ? ' (пробный)' : ''}.xlsx`);
    fs.writeFileSync(res.reportFile, buildXlsx([{ name: 'Разбор', rows: [[{ v: `Разбор анкеты: ${src}`, s: S.TITLE }], [], ['Строка', 'Код', 'Ответ', 'Что не так'].map(v => ({ v, s: S.HEAD })), ...res.review.map(x => [{ v: x.row, s: S.NUM }, T(x.pid), T(x.what), T(x.why)])], widths: [8, 10, 40, 80] }]));
  }
  return res;
}

module.exports = { build2, importSimple, LISTS: L, dept };

/* ---- контроль сдачи простых анкет: export/анкеты2/получено (файлы «Анкета — <отдел>*.xlsx») + журнал загрузок ---- */
function status2(opts = {}){
  const dir = path.join(require('./storage.js').EXPORT, 'анкеты2'), inbox = path.join(dir, 'получено'); fs.mkdirSync(inbox, { recursive: true });
  const lists = JSON.parse(fs.readFileSync(path.join(dir, 'lists.json'), 'utf8'));
  const srok = opts.srok || '2026-10-30', today = opts.today || new Date().toISOString().slice(0, 10);
  const imported = store.readLog().filter(x => x.act === 'anketa2_import');
  const got = fs.readdirSync(inbox).filter(f => /\.xlsx$/i.test(f) && !f.startsWith('~$'));
  const rows = lists.files.map(f => {
    const name = path.basename(f.file, '.xlsx'); const d = name.replace(/^Анкета — /, '');
    // присланный файл может называться «Копия Анкета  Отдел …», без тире и с обрезанным хвостом — ищем по началу названия отдела
    const key = s => s.toLowerCase().replace(/^копия\s*/, '').replace(/^анкета\s*[—-]?\s*/, '').replace(/[^а-яёa-z0-9]+/g, ' ').trim();
    const file = got.find(g => key(path.basename(g, '.xlsx')).startsWith(key(d).slice(0, 40)));
    let fill = null, who = '';
    if (file){ try { const { rows: rr } = readSheet(path.join(inbox, file), 'Процессы отдела'); who = String((rr.get(3) || {}).D || '');
      const data = [...rr].filter(([r]) => r > HEAD_ROW && (rr.get(r) || {}).B); fill = data.filter(([, c]) => [c.H, c.I, c.J, c.K, c.L, c.M].some(v => String(v ?? '').trim()) || (c.G && norm(c.G) !== norm(L.status[0]))).length; } catch { fill = -1; } }
    const imp = file && imported.filter(x => x.file === file).pop();
    const late = !file && today > srok;
    return { dept: d, n: f.n, file: file || '', who, fill, imported: imp ? imp.at : '', status: file ? (fill === -1 ? 'файл не читается — лист переименован?' : imp ? 'загружено' : 'получено, не загружено') : late ? 'не сдано, срок прошёл' : 'ждём' };
  });
  const H = v => ({ v, s: S.HEAD }), T = v => ({ v: v ?? '', s: S.WRAP }), N = v => ({ v, s: S.NUM });
  const file = path.join(dir, 'Контроль сдачи анкет.xlsx');
  fs.writeFileSync(file, buildXlsx([{ name: 'Контроль', rows: [[{ v: `Контроль сдачи анкет по процессам — на ${today.split('-').reverse().join('.')}, срок ${srok.split('-').reverse().join('.')}`, s: S.TITLE }], [],
    ['Отдел', 'Процессов', 'Файл', 'Кто заполнил', 'Заполнено строк', 'Загружено в реестр', 'Статус'].map(H),
    ...rows.map(r => [T(r.dept), N(r.n), T(r.file), T(r.who), r.fill === null ? T('') : N(r.fill), T(r.imported), T(r.status)])], widths: [60, 10, 40, 30, 12, 18, 30], freeze: 3 }]));
  return { rows, file, inbox, today, srok };
}
module.exports.status2 = status2;
