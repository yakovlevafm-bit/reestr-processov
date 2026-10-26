/* ================================================================
   Анкеты для отделов: вопросы «ИИ-шлюза», факты реестра на подтверждение,
   гипотезы на согласование — по одной книге xlsx на отдел; обратный
   импорт заполненных анкет в facts/cards.
   ----------------------------------------------------------------
   build(assessAll)   → export/анкеты/Анкета — <отдел>.xlsx (+ сводка)
   importAnswers(f)   → факты: подтверждено/отклонено/новое значение;
                        ответы на вопросы → card.ai.answers; гипотезы → status
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { store, ROOT } = require('./store.js');
const { buildXlsx, S } = require('./xlsxwrite.js');
const { readSheet } = require('./registry_import.js');

/* --- владелец из реестра → отдел (реестр заполнен неровно: опечатки, ФИО вместо отдела) --- */
// подразделения и правила приведения записей владельца — в профиле ведомства (profiles/<id>/profile.json → departments)
const deptOf = owner => require('./profile.js').load().deptOf(owner);

const FACT_HINT = { format: 'полностью цифровой / частично цифровой / бумажный', machine: 'машиночитаемый / немашиночитаемый', paper: 'бумажный / электронный / смешанный', count: 'число случаев (заявок, отчётов, писем) за 2025 год', hours: 'активное время специалиста на один случай, часов', problem: 'от 1 (нет проблем) до 5 (срывы сроков, жалобы, ошибки)', term: 'нормативный срок, дней' };

// дубль: факт «ИИ-шлюз» извлёк из той же строки реестра, что и импорт, с тем же значением — в анкету не выносим
const sameVal = (a, b) => String(a.value).trim().toLowerCase() === String(b.value).trim().toLowerCase();
function factsForAnketa(facts){
  const live = facts.filter(f => f.status !== 'rejected' && f.status !== 'superseded');
  // показатель уже подтверждён (паспорт, оператор) — неподтверждённые варианты того же показателя не выносим
  const done = new Set(live.filter(f => f.status === 'verified' && f.name !== 'other').map(f => f.name));
  return live.filter(f => f.status === 'verified' || !done.has(f.name))
    .filter(f => f.status !== 'ai' || !live.some(o => o !== f && o.status !== 'ai' && o.name === f.name && sameVal(o, f)));
}

// opts: { srok: 'дд.мм.гггг', komu: 'кому вернуть' }
function build(assessAll, opts = {}){
  const all = assessAll();
  const labor = {}; for (const r of require('./labor.js').check(all, store.staff()).rows) labor[r.id] = r; // ленивый require: labor.js сам берёт deptOf отсюда
  const OK_LABOR = new Set(['правдоподобно', 'нет данных', 'нет времени на случай', 'нет количества']);
  const byDept = {};
  for (const x of all){ const d = deptOf(x.p.owner); (byDept[d] = byDept[d] || []).push(x); }
  const dir = path.join(require('./storage.js').EXPORT, 'анкеты'); fs.mkdirSync(dir, { recursive: true });
  const H = v => ({ v, s: S.HEAD }), T = v => ({ v, s: S.WRAP }), N = v => ({ v, s: S.NUM }), I = v => ({ v: v || '', s: S.INPUT_TEXT });
  const summary = [['Отдел', 'Владелец в реестре (как записано)', 'Процессов', 'Вопросов', 'Фактов на проверку', 'Гипотез', 'Файл'].map(H)];
  const date = new Date().toISOString().slice(0, 10);
  for (const [dept, items] of Object.entries(byDept).sort((a, b) => b[1].length - a[1].length)){
    items.sort((a, b) => (a.p.row ?? 1e9) - (b.p.row ?? 1e9)); // добавленные вручную (без строки xlsx) — в конце
    const owners = [...new Set(items.map(x => x.p.owner))];
    // Лист «Процессы»
    const pr = [['ID', 'Процесс', 'Группа реестра', 'Владелец в реестре', 'В пилоте 2026', 'Резюме «ИИ-шлюза»', 'Ценность (оценка)', 'Реализуемость (оценка)', 'Вопросов', 'Фактов на проверку'].map(H)];
    // Лист «Вопросы»
    const qs = [['Ключ', 'ID', 'Процесс', '№', 'Вопрос', 'Ответ', 'Кто ответил (должность)', 'Комментарий'].map(H)];
    // Лист «Факты»
    const fr = [['Код факта', 'ID', 'Процесс', 'Показатель', 'В реестре', 'Ед.', 'Примечание', 'Верно? (да / нет)', 'Верное значение', 'Единица', 'Источник / основание'].map(H)];
    // Лист «Гипотезы»
    const hr = [['Ключ', 'ID', 'Процесс', '№', 'Гипотеза', 'Ожидаемый эффект', 'Что проверить', 'Источник', 'Согласны? (да / нет / частично)', 'Комментарий'].map(H)];
    let nq = 0, nf = 0, nh = 0;
    for (const x of items){
      const ai = x.card.ai || {}; const questions = ai.questions || [];
      questions.forEach((q, i) => { qs.push([`${x.p.id}#q${i + 1}`, x.p.id, T(x.p.name), N(i + 1), T(q), I(), I(), I()]); nq++; });
      const facts = factsForAnketa(x.facts);
      const lv = labor[x.p.id];
      for (const f of facts){
        const notes = [];
        if (f.status === 'verified') notes.push('уже подтверждено (' + (f.by || '') + ')');
        if (f.stale) notes.push('подтверждение устарело: строка реестра изменилась');
        if (f.status === 'ai') notes.push('извлечено ИИ «ИИ-шлюз»' + (f.quote ? ': «' + f.quote + '»' : '') + (f.check && !f.check.ok ? ' — числа нет в цитате' : ''));
        if ((f.name === 'hours' || f.name === 'count') && f.status !== 'verified'){
          if (lv && !OK_LABOR.has(lv.verdict)) notes.push(`сверка трудозатрат: ${lv.verdict} (${lv.why})`);
          else if (f.name === 'count' && +f.value > 5000) notes.push('проверить: очень много случаев');
        }
        const susp = notes.join('; ');
        fr.push([f.id, x.p.id, T(x.p.name), T(store.FACT_NAMES[f.name] || f.name), typeof f.value === 'number' ? N(f.value) : T(String(f.value)), T(f.unit || ''), T(susp), I(f.status === 'verified' ? 'да' : ''), I(), I(), I(f.basis || '')]); nf++;
      }
      for (const k of ['count', 'hours', 'problem']) if (!facts.some(f => f.name === k)){
        fr.push([`${x.p.id}#new:${k}`, x.p.id, T(x.p.name), T(store.FACT_NAMES[k]), T('— нет в реестре —'), '', T(FACT_HINT[k]), I(), I(), I(k === 'count' ? 'случаев/год' : k === 'hours' ? 'чел.-ч/случай' : ''), I()]); nf++;
      }
      const hyps = x.card.hyps || x.rule.hyps.map(h => ({ text: h[0], effect: h[1], source: 'правила' }));
      const numWarn = i => (x.card.numCheck ? x.card.numCheck.unsupported.filter(u => u.where === 'гипотеза ' + (i + 1)).map(u => u.n) : []);
      hyps.forEach((h, i) => { const nw = numWarn(i); hr.push([`${x.p.id}#h${i + 1}`, x.p.id, T(x.p.name), N(i + 1), T(h.text), T(h.effect || ''), T([h.check || '', nw.length ? `числа ${nw.join(', ')} — оценка ИИ, в реестре их нет` : ''].filter(Boolean).join('; ')), T(h.source || 'правила'), I(h.status === 'verified' ? 'да' : h.status === 'rejected' ? 'нет' : ''), I()]); nh++; });
      pr.push([x.p.id, T(x.p.name), T(x.p.group), T(x.p.owner), x.card.pilot ? 'да' : '', T(ai.summary || ''), `${x.a.value.min}–${x.a.value.max}`, `${x.a.feas.min}–${x.a.feas.max}`, N(questions.length), N(fr.length)]);
    }
    const intro = [
      [{ v: `Анкета по процессам: ${dept}`, s: S.TITLE }],
      [T(`${require('./profile.js').load().ui.anketaTitle} · сформировано ${date} · процессов: ${items.length}${owners.length > 1 || owners[0] !== dept ? ' · владельцы по реестру: ' + owners.join('; ') : ''}`)],
      [],
      [{ v: 'Зачем', s: S.BOLD }, T('По каждому процессу ' + (require('./profile.js').load().org.kindNom || 'ведомство') + ' оценивает ценность автоматизации и реализуемость. Оценка считается только из подтверждённых фактов, поэтому без ответов отдела процесс остаётся с диапазоном и не попадает в приоритеты.')],
      [{ v: 'Что заполнить', s: S.BOLD }, T('Жёлтые ячейки на трёх листах. «Вопросы» — ответы на вопросы, которые сформулировал ИИ-помощник «ИИ-шлюз» по описанию процесса (если вопрос не по делу — так и напишите). «Факты» — подтвердить цифры реестра или вписать верные с указанием источника (журнал, ДЕЛО, отчёт, оценка специалиста). «Гипотезы» — согласие с идеями автоматизации и замечания.')],
      [{ v: 'Единицы', s: S.BOLD }, T('«Активное время на один случай» — часы работы специалиста на одну заявку/отчёт/письмо, без ожидания. Если в реестре стоит, например, 120 — это, скорее всего, минуты или часы за год: поставьте «нет» и впишите верное значение.')],
      [{ v: 'Срок и возврат', s: S.BOLD }, T(`${opts.srok ? 'До ' + opts.srok + ' ' : ''}заполненный файл вернуть ${opts.komu || 'куратору цифровизации'}; ответы загружаются в реестр автоматически, без ручного переноса. Имя файла, коды в столбце A и порядок строк не менять, строки не удалять. Если вопрос не к вашему отделу — напишите в ответе, какой отдел ведёт процесс.`)],
      [{ v: 'Пометки', s: S.BOLD }, T('В столбце «Примечание» листа «Факты»: «извлечено ИИ» — цифру выписал «ИИ-шлюз», её нужно проверить; «сверка трудозатрат» — время и количество в реестре противоречат друг другу (часто минуты записаны как часы или указаны часы за год). На листе «Гипотезы» числа с пометкой «оценка ИИ» не взяты из реестра — подтвердите или поправьте.')],
      [{ v: 'Лист «Процессы»', s: S.BOLD }, T('Справочно: перечень процессов отдела, резюме «ИИ-шлюза» и текущая оценка диапазоном.')],
    ];
    const safe = dept.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
    const file = path.join(dir, `Анкета — ${safe}.xlsx`);
    fs.writeFileSync(file, buildXlsx([
      { name: 'Как заполнять', rows: intro, widths: [18, 120] },
      { name: 'Вопросы', rows: qs, widths: [14, 9, 45, 4, 70, 60, 24, 40], freeze: 1, autoFilter: `A1:H${qs.length}` },
      { name: 'Факты', rows: fr, widths: [16, 9, 45, 26, 16, 22, 40, 12, 14, 18, 45], freeze: 1, autoFilter: `A1:K${fr.length}` },
      { name: 'Гипотезы', rows: hr, widths: [14, 9, 40, 4, 60, 40, 40, 10, 14, 45], freeze: 1, autoFilter: `A1:J${hr.length}` },
      { name: 'Процессы', rows: pr, widths: [9, 60, 30, 30, 8, 70, 10, 10, 8, 8], freeze: 1, autoFilter: `A1:J${pr.length}` },
    ]));
    summary.push([T(dept), T(owners.join('; ')), N(items.length), N(nq), N(nf), N(nh), T(path.basename(file))]);
  }
  const sumFile = path.join(dir, `Анкеты — сводка ${date}.xlsx`);
  fs.writeFileSync(sumFile, buildXlsx([{ name: 'Сводка', rows: summary, widths: [60, 60, 10, 10, 12, 10, 70], freeze: 1 }]));
  return { dir, summary: summary.slice(1).map(r => ({ dept: r[0].v, owners: r[1].v, n: r[2].v, q: r[3].v, f: r[4].v, h: r[5].v, file: r[6].v })), sumFile };
}

/* --- обратный импорт заполненной анкеты ---
   Правила (проверены на тестовой анкете 14.10.2026):
   · повторная загрузка того же или исправленного файла не плодит факты: новый факт помнит код строки (anketaKey);
   · уже подтверждённое (паспорт, оператор) анкетой не перезаписывается, а отказ от него или другое значение
     идут «на разбор»;
   · значение разбирается по показателю: минуты → часы, «в месяц» → ×12, текстовые показатели — только из списка;
     что не разобралось, не загружается, а попадает в файл разбора для отдела;
   · «нет данных / не знаю» — не отказ от факта; непонятный ответ («частично») — на разбор;
   · новое значение заменяет старое со ссылкой replaces (старое получает «заменено»), как verifyFact. */
const ANS = v => {
  const s = String(v ?? '').trim().toLowerCase(); if (!s) return '';
  if (/^(нет данных|н\/д|не знаю|затрудня|неизвестно|не вед[её]тся|не учитыва)/.test(s)) return 'unknown';
  if (/^(да|верно|подтвержда|ок$|\+$)/.test(s)) return 'yes';
  if (/^(нет|неверно|не верно|ошиб|-$)/.test(s)) return 'no';
  if (/^частично/.test(s)) return 'partial';
  return 'other';
};
const TEXT_VALUES = {
  format: [[/полност/, 'полностью цифровой'], [/частичн/, 'частично цифровой'], [/бумаж/, 'бумажный']],
  machine: [[/не\s*машин/, 'немашиночитаемый'], [/машин/, 'машиночитаемый']],
  paper: [[/смешан/, 'смешанный'], [/электрон/, 'электронный'], [/бумаж/, 'бумажный']],
};
const r2 = n => Math.round(n * 100) / 100;
/** Значение из анкеты → { value, note } или { review: 'почему не загружено' } */
function parseValue(name, raw){
  let s0 = String(raw ?? '').trim(); if (!s0) return null;
  if (/^-?\d+\.\d{6,}$/.test(s0)) s0 = String(+(+s0).toFixed(4)); // хвост двоичной дроби Excel: 20.100000000000001
  if (name === 'other') return { value: s0 };
  const s = s0.toLowerCase();
  if (name === 'count'){ // периодичность словом, без числа
    const w = [[/^ежегодно/, 1], [/^ежеквартально/, 4], [/^ежемесячно/, 12], [/^еженедельно/, 52], [/^ежедневно/, 247]].find(([re]) => re.test(s));
    if (w) return { value: w[1], note: `«${s0}» → ${w[1]} в год` + (w[1] === 247 ? ' (рабочих дней)' : '') };
  }
  // «не менее 1 рабочего дня» — нижняя граница, принимается с пометкой; «от 1 до 20 минут» — диапазон, на разбор
  const lb = /^(не менее|не меньше|минимум)\s+/.exec(s); const lower = lb ? 'нижняя граница («' + lb[1] + '»)' : '';
  if (TEXT_VALUES[name]){
    const hit = TEXT_VALUES[name].find(([re]) => re.test(s));
    return hit ? { value: hit[1] } : { review: `«${s0}» — нужно одно из: ${TEXT_VALUES[name].map(x => x[1]).join(' / ')}` };
  }
  const m = /^(около|примерно|приблизительно|~|≈)?\s*(\d[\d\s ]*(?:[.,]\d+)?)\s*(.*)$/.exec(lb ? s.slice(lb[0].length) : s);
  if (!m) return { review: `«${s0}» — не число` };
  const approx = [m[1] ? 'приблизительно' : '', lower].filter(Boolean).join('; ');
  let n = +m[2].replace(/[\s ]/g, '').replace(',', '.'); const rest = m[3].trim();
  if (/^[-–—]\s*\d/.test(rest)) return { review: `«${s0}» — диапазон, нужно одно число` };
  const note = (...a) => a.filter(Boolean).join('; ');
  if (name === 'hours'){
    if (n === 0) return { review: '0 часов на случай — укажите реальное время' };
    if (/^(чел\.?\s*-?\s*)?мин/.test(rest)) return { value: r2(n / 60), note: note(`переведено из ${n} мин`, approx) }; // «мин», «чел.-мин/случай»
    if (/^(раб[а-я.]*\s*)?(дн|день|дня)/.test(rest)) return { value: n * 8, note: note(`${n} раб. дн. × 8 ч`, approx) }; // «1 рабочий день», «не менее 1 рабочего дня (…)»
    if (/^(раб[а-я.]*\s*)?нед/.test(rest)) return { value: n * 40, note: note(`${n} раб. нед. × 40 ч`, approx) };
    if (!rest || /^(ч|час|чел)/.test(rest)){ if (n > 200) return { review: `${n} ч на один случай — проверьте единицу (возможно, часы за год или дата)` }; return { value: n, note: approx }; }
    return { review: `«${s0}» — нужны часы на один случай` };
  }
  if (name === 'count'){
    if (/^тыс/.test(rest)) return { value: Math.round(n * 1000), note: note(`«${s0}» → ${Math.round(n * 1000)}`, approx) };
    const k =/в\s*месяц|ежемесяч/.test(s) ? 12 : /в\s*квартал|ежекварт/.test(s) ? 4 : /в\s*неделю|еженедел/.test(s) ? 52 : /в\s*день|ежеднев/.test(s) ? 0 : 1;
    if (!k) return { review: `«${s0}» — укажите число случаев за год` };
    if (/^\(/.test(rest)) return { value: n * k, note: note(`«${rest.slice(0, 60)}»`, approx) }; // «2 (июнь, октябрь)»
    if (rest && !/^(раз|случа|заяв|шт|ед|отч|пис|док|обращ|дел|в\s*(год|месяц|квартал|неделю)|ежегод|ежемесяч|ежекварт|еженедел)/.test(rest)) return { review: `«${s0}» — не понятна единица, нужно число случаев за год` };
    return { value: n * k, note: note(k > 1 ? `пересчитано на год: ${n} × ${k}` : '', approx) };
  }
  if (name === 'problem'){
    if (rest || !Number.isInteger(n) || n < 1 || n > 5) return { review: `«${s0}» — нужна оценка от 1 до 5` };
    return { value: n };
  }
  if (name === 'term'){
    if (rest && !/^(дн|день|дня|раб|кал)/.test(rest)) return { review: `«${s0}» — нужен срок в днях` };
    return { value: n, note: approx };
  }
  if (rest && !/^(ч|час|чел)/.test(rest)) return { review: `«${s0}» — не понятна единица` };
  return { value: n, note: approx };
}
const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const isLive = f => f.status !== 'rejected' && f.status !== 'superseded';

const EXPECT = { 'Факты': ['A', 'Код факта'], 'Вопросы': ['A', 'Ключ'], 'Гипотезы': ['A', 'Ключ'] };
/** opts: { who, dry } → { dept, verified, replaced, rejected, added, unknown, dup, answers, hyps, review:[], reportFile } */
function importAnswers(file, opts = {}){
  if (typeof opts === 'string') opts = { who: opts };
  const src = path.basename(file);
  const dept = (/^Анкета — (.+?)(?: \(\d+\))?\.xlsx$/i.exec(src) || [])[1] || '';
  const by = opts.who || dept || src;
  const res = { file: src, dept, by, verified: 0, replaced: 0, rejected: 0, added: 0, unknown: 0, dup: 0, answers: 0, hyps: 0, review: [] };
  const sheets = {};
  for (const name of Object.keys(EXPECT)){
    const { sheet, rows } = readSheet(file, name);
    const [col, head] = EXPECT[name];
    if (sheet !== name || !String((rows.get(1) || {})[col] || '').startsWith(head)) throw new Error(`${src}: нет листа «${name}» в исходном виде (переименован или удалён столбец) — загрузка остановлена`);
    sheets[name] = [...rows].filter(([r]) => r > 1).sort((a, b) => a[0] - b[0]);
  }
  const facts = store.facts(); const byId = new Map(facts.map(f => [f.id, f]));
  // заполненность анкеты для таблицы контроля сдачи: строк с ответом / всего (заранее проставленное «да» у подтверждённых не считается)
  const pre = c => { const f = byId.get(String(c.A || '')); return f && f.status === 'verified' && ANS(c.H) === 'yes' && !c.I; };
  const cnt = (name, test) => { const r = sheets[name].filter(([, c]) => c.A); return [r.filter(([, c]) => test(c)).length, r.length]; };
  res.fill = { facts: cnt('Факты', c => (c.H || c.I) && !pre(c)), questions: cnt('Вопросы', c => c.F), hyps: cnt('Гипотезы', c => c.I || c.J) };
  const review = (sheet, row, key, pid, answer, reason) => res.review.push({ sheet, row, key, pid, answer, reason });
  const at = store.now(); let seq = 0;
  const newId = () => 'f' + (facts.length + 1) + '-' + (Date.now() + seq++).toString(36);
  const conflictWith = (pid, name, value, except) => name === 'other' ? null :
    facts.find(o => o.pid === pid && o.name === name && o.status === 'verified' && !except.includes(o) && !same(o.value, value));
  const add = (pid, name, p, unit, basis, key, replaces) => {
    const nf = { id: newId(), at, pid, name, value: p.value, unit, period: '2025', source: 'анкета отдела: ' + src, role: 'владелец процесса', status: 'verified', by, basis, anketaKey: key };
    if (p.note) nf.note = p.note; if (replaces){ replaces.status = 'superseded'; replaces.at = at; nf.replaces = replaces.id; if (replaces.quote) nf.quote = replaces.quote; }
    facts.push(nf); byId.set(nf.id, nf); return nf;
  };

  // ---------- Факты ----------
  for (const [row, c] of sheets['Факты']){
    const key = String(c.A || '').trim(), pid = String(c.B || '').trim(); if (!key || !pid) continue;
    const ans = ANS(c.H), rawVal = String(c.I ?? '').trim(), unitIn = String(c.J ?? '').trim();
    const shown = [c.H, c.I, c.J].filter(v => v !== undefined && v !== '').map(v => /^-?\d+\.\d{6,}$/.test(v) ? String(+(+v).toFixed(4)) : v).join(' | ');
    if (!ans && !rawVal) continue;
    const isNew = key.includes('#new:');
    const f = isNew ? null : byId.get(key);
    const name = isNew ? key.split('#new:')[1] : f && f.name;
    if (!isNew && !f){ review('Факты', row, key, pid, shown, 'код факта не найден в реестре (строку меняли или копировали)'); continue; }
    if (f && f.pid !== pid){ review('Факты', row, key, pid, shown, `код относится к ${f.pid}, а в строке ${pid}`); continue; }
    const basisIn = String(c.K ?? '').trim(); const basis = (basisIn && !(f && same(basisIn, f.basis))) ? basisIn : '';
    if (ans === 'unknown'){ res.unknown++; review('Факты', row, key, pid, shown, 'отдел: нет данных — факт оставлен как был, уточнить источник'); continue; }
    if (ans === 'other' || ans === 'partial'){ review('Факты', row, key, pid, shown, 'ответ не распознан: в «Верно?» нужно «да» или «нет»'); continue; }
    if (!rawVal && /\d/.test(String(c.H))){ review('Факты', row, key, pid, shown, 'число вписано в «Верно?» — перенести в «Верное значение»'); continue; }
    // единица, вписанная отдельно (I=120, J=мин), разбирается вместе со значением
    const stdUnit = store.FACT_UNITS[name] || '';
    const raw = rawVal && unitIn && !same(unitIn, stdUnit) && !(f && same(unitIn, f.unit)) ? rawVal + ' ' + unitIn : rawVal;
    const p = parseValue(name, raw);
    if (p && p.review){ review('Факты', row, key, pid, shown, p.review); continue; }
    const prev = facts.find(o => o.anketaKey === key && isLive(o)); // загружено из прошлой версии этой анкеты

    if (isNew){
      if (!p){ review('Факты', row, key, pid, shown, 'ответ без значения — впишите число в «Верное значение»'); continue; }
      if (prev && same(prev.value, p.value)){ res.dup++; continue; }
      const cf = conflictWith(pid, name, p.value, prev ? [prev] : []);
      if (cf){ review('Факты', row, key, pid, shown, `противоречит подтверждённому значению ${cf.value} (${cf.by}) — решить вручную`); continue; }
      add(pid, name, p, stdUnit, basis || 'анкета отдела', key, prev); prev ? res.replaced++ : res.added++; continue;
    }
    const confirms = p ? same(p.value, f.value) : ans === 'yes';
    if (confirms && ans !== 'no'){
      if (f.status === 'verified'){ res.dup++; continue; }
      if (!isLive(f)){ if (prev && same(prev.value, f.value)){ res.dup++; } else review('Факты', row, key, pid, shown, `факт уже ${f.status === 'rejected' ? 'отклонён' : 'заменён'} (${f.by || ''}) — решить вручную`); continue; }
      const cf = conflictWith(pid, name, f.value, [f]);
      if (cf){ review('Факты', row, key, pid, shown, `противоречит подтверждённому значению ${cf.value} (${cf.by}) — решить вручную`); continue; }
      Object.assign(f, { status: 'verified', by, basis: basis || 'подтверждено в анкете отдела', at, anketaKey: key }); delete f.stale; res.verified++; continue;
    }
    if (!p){ // «нет» без значения
      if (f.status === 'rejected'){ res.dup++; if (f.anketaKey === key) review('Факты', row, key, pid, shown, 'отклонено без верного значения — запросить у отдела число'); continue; }
      if (f.status === 'verified'){ review('Факты', row, key, pid, shown, `отдел не согласен с подтверждённым фактом (${f.by}) — решить вручную`); continue; }
      if (!isLive(f)){ res.dup++; continue; }
      Object.assign(f, { status: 'rejected', by, basis: basis || 'анкета отдела: значение неверно', at, anketaKey: key }); res.rejected++;
      review('Факты', row, key, pid, shown, 'отклонено без верного значения — запросить у отдела число');
      continue;
    }
    // новое значение вместо старого
    if (f.status === 'verified'){ review('Факты', row, key, pid, shown, `другое значение (${p.value}) к подтверждённому факту ${f.value} (${f.by}) — решить вручную`); continue; }
    if (prev && same(prev.value, p.value)){ res.dup++; continue; }
    const base = prev || (isLive(f) ? f : null);
    if (!base){ review('Факты', row, key, pid, shown, `факт уже ${f.status === 'rejected' ? 'отклонён' : 'заменён'} (${f.by || ''}) — решить вручную`); continue; }
    const cf = conflictWith(pid, name, p.value, [f, base]);
    if (cf){ review('Факты', row, key, pid, shown, `противоречит подтверждённому значению ${cf.value} (${cf.by}) — решить вручную`); continue; }
    const unit = TEXT_VALUES[name] ? '' : (stdUnit || f.unit || '');
    add(pid, name, p, unit, basis || 'анкета отдела', key, base); res.replaced++;
  }

  // ---------- Вопросы → card.ai.answers (повторная загрузка заменяет ответ на тот же вопрос) ----------
  const cards = store.cards(); const touched = new Set();
  const answers = {};
  for (const [, c] of sheets['Вопросы']){
    if (!c.A || !(c.F || c.H)) continue; const [pid, q] = String(c.A).split('#'); if (!cards[pid] || !q) continue;
    (answers[pid] = answers[pid] || []).push({ q: +q.slice(1), question: c.E, answer: c.F || '', who: c.G || '', comment: c.H || '', by });
  }
  for (const [pid, list] of Object.entries(answers)){
    const card = cards[pid]; const old = (card.ai || {}).answers || [];
    const changed = list.filter(a => !old.some(b => b.q === a.q && same(b.answer, a.answer) && same(b.comment, a.comment)));
    if (!changed.length) continue;
    card.ai = { ...(card.ai || {}), answers: [...old.filter(a => !changed.some(b => b.q === a.q)), ...changed].sort((a, b) => a.q - b.q), answeredAt: at.slice(0, 10), answeredBy: by };
    touched.add(pid); res.answers += changed.length;
  }

  // ---------- Гипотезы → статус + ответ отдела ----------
  for (const [row, c] of sheets['Гипотезы']){
    if (!c.A || !(c.I || c.J)) continue; const [pid, h] = String(c.A).split('#'); const card = cards[pid];
    const hyp = card && card.hyps && card.hyps[+String(h).slice(1) - 1];
    if (!hyp){ review('Гипотезы', row, c.A, pid, [c.I, c.J].filter(Boolean).join(' | '), 'гипотеза не найдена в карточке'); continue; }
    if (!same(hyp.text, c.E)){ review('Гипотезы', row, c.A, pid, [c.I, c.J].filter(Boolean).join(' | '), 'текст гипотезы в карточке изменился после рассылки — сверить вручную'); continue; }
    const a = ANS(c.I); const status = a === 'yes' ? 'verified' : a === 'no' ? 'rejected' : hyp.status;
    const answer = String(c.I || '').trim(), comment = String(c.J || '').trim();
    if (status === hyp.status && same(answer, hyp.answer) && same(comment, hyp.comment)) continue;
    if (c.I && a !== 'yes' && a !== 'no' && a !== 'partial') review('Гипотезы', row, c.A, pid, answer, 'ответ не распознан: нужно «да / нет / частично»');
    Object.assign(hyp, { status, answer, comment, by }); touched.add(pid); res.hyps++;
  }

  // ---------- сохранение (с копией до правок) и файл разбора для отдела ----------
  if (!opts.dry){
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const bdir = path.join(ROOT, '..', '_Архив', 'бэкапы', `reestr_anketa_${stamp}_${(dept || 'anketa').replace(/[^а-яёa-z0-9]+/gi, '_').slice(0, 40)}`);
    store.backup(bdir); // факты и карточки до загрузки (JSON-файлы или копия базы SQLite)
    res.backup = bdir;
    store.saveFacts(facts);
    for (const pid of touched){ const card = cards[pid]; card.history = [...(card.history || []), { at, who: by, what: 'анкета отдела' }].slice(-50); }
    store.saveCards(cards);
    store.log({ act: 'anketa_import', file: src, dept, fill: res.fill, by, verified: res.verified, replaced: res.replaced, rejected: res.rejected, added: res.added, unknown: res.unknown, dup: res.dup, answers: res.answers, hyps: res.hyps, review: res.review.length });
  }
  if (res.review.length){
    const dir = path.join(require('./storage.js').EXPORT, 'анкеты', 'ответы'); fs.mkdirSync(dir, { recursive: true });
    const H = v => ({ v, s: S.HEAD }), T = v => ({ v: v ?? '', s: S.WRAP });
    const rows = [[{ v: `Разбор анкеты: ${dept || src}`, s: S.TITLE }], [T(`Загружено ${at}${opts.dry ? ' (пробный прогон, в реестр не записано)' : ''}. Эти строки не загружены или требуют решения: уточните у отдела и поправьте в анкете, затем загрузите её повторно — уже загруженное не задвоится.`)], [],
      ['Лист', 'Строка', 'Код', 'ID', 'Что ответил отдел', 'Почему на разбор'].map(H),
      ...res.review.map(r => [T(r.sheet), { v: r.row, s: S.NUM }, T(r.key), T(r.pid), T(r.answer), T(r.reason)])];
    res.reportFile = path.join(dir, `Разбор — ${src.replace(/\.xlsx$/i, '')}${opts.dry ? ' (пробный)' : ''}.xlsx`);
    fs.writeFileSync(res.reportFile, buildXlsx([{ name: 'Разбор', rows, widths: [10, 8, 20, 10, 40, 70], freeze: 4 }]));
  }
  return res;
}

module.exports = { build, importAnswers, deptOf, parseValue };
