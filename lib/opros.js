/* ================================================================
   Опросник владельцев процессов (22.10.2026) — подтверждение паспорта процесса на интервью
   при хронометраже. Строка = процесс отдела; все ответы заранее подставлены из реестра и
   разметки паспорта — на интервью только проверить и исправить неверное.
     ① владелец — должность   ② где идёт процесс (поток)   ③ с кем   ④ роль ведомства
     ⑤ для кого результат      ⑥ вид процесса                ⑦ комментарий
   build() → export/опросник/Опросник — <отдел>.xlsx (+ lists.json для lib/opros_dv.ps1 — выпадающие списки)
   importOpros(file) → card.passport (подтверждено, основание — опросник); спорное → файл разбора.
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { store, ROOT } = require('./store.js');
const { buildXlsx, S } = require('./xlsxwrite.js');
const { readSheet } = require('./registry_import.js');
const PS = require('./passport.js');
const PRF = require('./profile.js').load();
const dept = owner => PRF.officialOf(owner);
const KG = PRF.org.kindGen || 'ведомства', KN = PRF.org.kindNom || 'ведомство';

// выпадающие списки простыми словами (без «;» — разделитель списков в Excel) ↔ значения паспорта
const L = {
  cross: [['только в нашем отделе', 'dept'], [`с другими отделами ${KG}`, 'inter'], ['с другими ведомствами, округами, организациями', 'agency']],
  role: [[`${KN} ведёт процесс целиком`, 'owner'], [`${KN} — один из участников`, 'part']],
  group: [['граждане, бизнес, округа', 'ext'], ['органы власти (федеральные, региональные)', 'gov'], [`сотрудники и отделы ${KG}`, 'int']],
  kind: [['основной — результат для внешних', 'main'], ['обеспечивающий — для своих сотрудников и отделов', 'support'], ['управления — планы, госпрограммы, показатели, контроль', 'manage']],
};
const label = (list, v) => (list.find(x => x[1] === v) || [''])[0];
const valueOf = (list, s) => { const n = x => String(x ?? '').trim().toLowerCase().replace(/\s+/g, ' '); const f = list.find(x => n(x[0]) === n(s)); return f ? f[1] : null; };
const HEAD_ROW = 6;
const COLS = ['№', 'Код процесса', 'Процесс', 'Сейчас в реестре', 'Обратите внимание',
  '① Владелец процесса — должность', '② Где идёт процесс?', '③ С кем (отделы, ведомства)', '④ Роль ' + KG, '⑤ Для кого результат?', '⑥ Вид процесса', '⑦ Комментарий'];

function build(){
  const reg = store.processes(), cards = store.cards(), staff = store.staff();
  const by = {}; for (const p of reg.processes) if (!p.duplicateOf) (by[dept(p.owner)] = by[dept(p.owner)] || []).push(p);
  const dir = path.join(require('./storage.js').EXPORT, 'опросник'); fs.mkdirSync(dir, { recursive: true });
  const G = v => ({ v: v ?? '', s: S.WRAP }), Y = v => ({ v: v || '', s: S.INPUT_TEXT }), H = v => ({ v, s: S.HEAD });
  const out = [];
  for (const [d, list] of Object.entries(by).sort((a, b) => b[1].length - a[1].length)){
    list.sort((a, b) => (a.row ?? 1e9) - (b.row ?? 1e9));
    const rows = [
      [{ v: `Опросник владельцев процессов: ${d}`, s: S.TITLE }],
      [G(`Все ответы уже подставлены из реестра (${list.length} процессов). Проверьте каждую строку и исправьте только неверное — выбором из списка. Пустую ячейку заполните. Столбец «Обратите внимание» — где реестр противоречит сам себе.`)],
      [{ v: 'Кто отвечал (ФИО, должность):', s: S.BOLD }, G(''), G(''), Y('')],
      [{ v: 'Кто вёл интервью, дата:', s: S.BOLD }, G(''), G(''), Y('')],
      [],
      COLS.map(H),
    ];
    list.forEach((p, i) => {
      const pp = PS.passportOf(p, cards[p.id] || {}, staff);
      const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
      const now = [`${p.kind || 'вид —'} · ${p.cross || 'сквозной —'}${p.crossWith ? ' (' + cut(p.crossWith, 40) + ')' : ''}`, `клиент: ${cut(p.client, 70) || '—'}`, dept(p.owner) !== p.owner.trim() ? `ответственный: ${cut(p.owner, 50)}` : ''].filter(Boolean).join('\n');
      const warn = [];
      if (pp.kind.conflict) warn.push(pp.kind.note);
      if (pp.cross.value && pp.cross.value !== 'dept' && !pp.crossWith.value) warn.push('в реестре «сквозной», но не указано, с кем');
      if (/ФИО/.test(pp.owner.note)) warn.push('ответственным указан сотрудник, а нужна должность владельца');
      if (pp.recipient.types.some(t => t === 'unknown' || t === 'external')) warn.push('из реестра не ясно, кто получает результат');
      if (pp.kind.src === 'авто' && !pp.kind.conflict) warn.push('по названию похож на процесс управления — проверьте ⑥');
      const post = pp.owner.src === 'подтверждено' ? pp.owner.value : (pp.owner.value || '').replace(/\s*\(.*\)$/, '');
      rows.push([{ v: i + 1, s: S.NUM }, G(p.id), G(p.name), G(now), G(warn.join('. ')),
        Y(post), Y(label(L.cross, pp.cross.value)), Y(pp.crossWith.value), Y(label(L.role, pp.role.value)), Y(label(L.group, pp.recipient.group)), Y(label(L.kind, pp.kind.value)), Y('')]);
    });
    const ins = [[{ v: 'Как работать с опросником — 3 минуты на чтение', s: S.TITLE }], [],
      ...[
        ['Зачем', `${KN[0].toUpperCase() + KN.slice(1)} выбирает процессы для оптимизации по их результату для получателя: для кого делается работа, кто за неё отвечает целиком, сколько отделов и ведомств в ней участвует. В реестре эти сведения неполные — их подтверждает владелец процесса.`],
        ['Как заполнять', 'Ответы уже подставлены. Пройдите строки по порядку: если верно — ничего не меняйте; если нет — выберите другой вариант из списка (стрелка справа от ячейки) или исправьте текст.'],
        ['① Владелец процесса', 'Должность (не ФИО) того, кто отвечает за результат процесса целиком и может менять порядок работы. Обычно — начальник отдела; если процесс ведёт заместитель министра или другой отдел — укажите его.'],
        ['② Где идёт процесс', 'Только в вашем отделе; с другими отделами — если документ проходит через них по ходу работы; с другими ведомствами — если без их участия результата нет (ФОИВ, органы области, округа, организации).'],
        ['③ С кем', 'Перечислите отделы или ведомства, через которые проходит работа. Для «только в нашем отделе» — оставьте пустым.'],
        ['④ Роль', `Ведёт ли ${KN} процесс целиком (отвечает за итог) или выполняет только свою часть в чужом процессе.`],
        ['⑤ Для кого результат', 'Кто получает итог работы: граждане, бизнес, округа — или органы власти (отчёт, информация), или свои сотрудники и отделы.'],
        ['⑥ Вид процесса', 'Основной — результат для внешних; обеспечивающий — для своих (кадры, закупки, делопроизводство); управления — планы, госпрограммы, показатели, контроль исполнения.'],
        ['«Обратите внимание»', 'Здесь видно, где реестр противоречит сам себе. Эти строки проверьте особенно внимательно.'],
        ['Не меняйте', 'Код процесса, порядок строк и названия столбцов — ответы загружаются в реестр автоматически.'],
      ].map(([a, b]) => [{ v: a, s: S.BOLD }, G(b)]),
    ];
    const safe = d.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').slice(0, 120);
    const file = path.join(dir, `Опросник — ${safe}.xlsx`);
    fs.writeFileSync(file, buildXlsx([
      { name: 'Процессы отдела', rows, widths: [5, 10, 50, 34, 34, 26, 26, 26, 24, 26, 30, 30], freeze: HEAD_ROW },
      { name: 'Как работать', rows: ins, widths: [22, 120] },
    ]));
    out.push({ dept: d, file, n: list.length });
  }
  const lists = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, v.map(x => x[0])]));
  fs.writeFileSync(path.join(dir, 'lists.json'), JSON.stringify({ headRow: HEAD_ROW, lastCol: 'L', validations: [{ col: 'G', list: lists.cross }, { col: 'I', list: lists.role }, { col: 'J', list: lists.group }, { col: 'K', list: lists.kind }], files: out.map(o => ({ file: o.file, n: o.n })) }, null, 1));
  return { dir, files: out };
}

/* ---- загрузка заполненного опросника → card.passport (подтверждено) ---- */
function importOpros(file, opts = {}){
  const src = path.basename(file);
  const { sheet, rows } = readSheet(file, 'Процессы отдела');
  if (sheet !== 'Процессы отдела' || !String((rows.get(HEAD_ROW) || {}).B || '').startsWith('Код процесса') || !String((rows.get(HEAD_ROW) || {}).F || '').startsWith('①')) throw new Error(`${src}: нет листа «Процессы отдела» опросника в исходном виде — загрузка остановлена`);
  const who = String((rows.get(3) || {}).D || '').trim(), iv = String((rows.get(4) || {}).D || '').trim();
  const by = opts.who || who || src;
  const reg = store.processes().processes, byId = Object.fromEntries(reg.map(p => [p.id, p]));
  const cards = store.cards(), staff = store.staff(), at = store.now();
  const res = { file: src, by, rows: 0, saved: 0, review: [] };
  const review = (row, pid, what, why) => res.review.push({ row, pid, what, why });
  for (const [r, c] of [...rows].filter(([r]) => r > HEAD_ROW).sort((a, b) => a[0] - b[0])){
    const pid = String(c.B || '').trim(); if (!pid) continue;
    const p = byId[pid]; if (!p){ review(r, pid, '', 'код процесса не найден в реестре'); continue; }
    res.rows++;
    const passport = {}; let bad = false;
    const post = String(c.F || '').trim();
    if (post && /[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?[А-ЯЁ]\./.test(post)){ review(r, pid, post, '① указано ФИО — нужна должность'); bad = true; } else if (post) passport.ownerPost = post;
    for (const [col, key, list, q] of [['G', 'cross', L.cross, '②'], ['I', 'role', L.role, '④'], ['K', 'kind', L.kind, '⑥']]){
      if (!String(c[col] ?? '').trim()) continue;
      const v = valueOf(list, c[col]); if (!v){ review(r, pid, c[col], q + ' ответ не из списка'); bad = true; } else passport[key] = v;
    }
    const cw = String(c.H || '').trim(); if (cw) passport.crossWith = cw;
    if (passport.cross && passport.cross !== 'dept' && !cw) review(r, pid, label(L.cross, passport.cross), '③ не указано, с кем — паспорт сохранён, уточнить');
    if (String(c.J ?? '').trim()){
      const g = valueOf(L.group, c.J);
      if (!g){ review(r, pid, c.J, '⑤ ответ не из списка'); bad = true; }
      else { // типы получателя: из разметки «Клиента», если группа совпала; иначе — общий тип группы
        const auto = PS.recipientTypes(p.client).filter(t => PS.RGROUP[t] === g);
        passport.recipientTypes = auto.length ? auto : [{ ext: 'external', gov: 'regional', int: 'internal' }[g]];
      }
    }
    const comment = String(c.L || '').trim();
    if (bad && !Object.keys(passport).length) continue;
    const cur = (cards[pid] || {}).passport || {};
    cards[pid] = cards[pid] || { history: [] };
    cards[pid].passport = { ...cur, ...passport, ...(comment ? { comment } : {}), basis: `опросник владельцев: ${by}${iv ? '; интервью: ' + iv : ''}`, by, at, src };
    cards[pid].history = [...(cards[pid].history || []), { at, who: by, what: 'опросник: паспорт процесса' }].slice(-50);
    res.saved++;
  }
  if (!opts.dry){
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    if (opts.backup !== false){ const bdir = path.join(ROOT, '..', '_Архив', 'бэкапы', `reestr_opros_${stamp}`); store.backup(bdir); res.backup = bdir; } // карточки до загрузки
    store.saveCards(cards);
    store.log({ act: 'opros_import', file: src, by, rows: res.rows, saved: res.saved, review: res.review.length });
  }
  if (res.review.length){
    const dir = path.join(require('./storage.js').EXPORT, 'опросник', 'разбор'); fs.mkdirSync(dir, { recursive: true });
    const T = v => ({ v: v ?? '', s: S.WRAP });
    res.reportFile = path.join(dir, `Разбор — ${src.replace(/\.xlsx$/i, '')}${opts.dry ? ' (пробный)' : ''}.xlsx`);
    fs.writeFileSync(res.reportFile, buildXlsx([{ name: 'Разбор', rows: [[{ v: `Разбор опросника: ${src}`, s: S.TITLE }], [], ['Строка', 'Код', 'Ответ', 'Что не так'].map(v => ({ v, s: S.HEAD })), ...res.review.map(x => [{ v: x.row, s: S.NUM }, T(x.pid), T(x.what), T(x.why)])], widths: [8, 10, 40, 80] }]));
  }
  return res;
}

module.exports = { build, importOpros, LISTS: L, HEAD_ROW };
