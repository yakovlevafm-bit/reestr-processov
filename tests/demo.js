// Сквозная проверка на ДЕМО-ведомстве другой отрасли (profiles/demo-kultura): ядро должно работать без единой правки кода.
// Временные каталоги данных и выгрузок; реестр — искусственный xlsx по шаблону ОГВ. node tests/demo.js
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'reestr-demo-data-')), EXP = fs.mkdtempSync(path.join(os.tmpdir(), 'reestr-demo-exp-'));
fs.writeFileSync(path.join(DATA, 'config.json'), JSON.stringify({ profile: 'demo-kultura' }));
const env = { ...process.env, REESTR_DATA: DATA, REESTR_EXPORT: EXP, REESTR_PROFILE: 'demo-kultura', REESTR_STORAGE: process.env.DEMO_STORAGE || 'json' };
let fails = 0; const check = (cond, what) => { console.log((cond ? '  ✔ ' : '  ✖ ') + what); if (!cond) fails++; };
const run = (...args) => { const r = spawnSync(process.execPath, [path.join(ROOT, 'reestr.js'), ...args], { env, encoding: 'utf8', cwd: ROOT }); if (r.status !== 0) { console.log(r.stdout, r.stderr); } return r; };

// 1. искусственный реестр (шаблон ОГВ: заголовок в строке 8, «Название процесса» в D)
const { buildXlsx } = require('../lib/xlsxwrite.js');
const reg = require('../profiles/demo-kultura/example.js').writeRegistry(path.join(DATA, 'Реестр ДКТ.xlsx'));

console.log('ДЕМО-ведомство, хранилище ' + env.REESTR_STORAGE);
// 2. команды
let r = run('import', reg); check(r.status === 0 && /процессов 8/.test(r.stdout), 'импорт реестра: 8 процессов');
r = run('storage'); check(/профиль: demo-kultura/.test(r.stdout), 'включён профиль demo-kultura');
r = run('stats'); check(r.status === 0, 'сводка (stats)');
r = run('export'); check(r.status === 0 && fs.readdirSync(EXP).some(f => /^Реестр процессов ДКТ — оценка/.test(f)), 'выгрузка Excel с названием ведомства');
r = run('anketa2'); const an = path.join(EXP, 'анкеты2'); check(r.status === 0 && fs.existsSync(an) && fs.readdirSync(an).filter(f => /^Анкета — /.test(f)).length >= 5, 'простые анкеты по подразделениям демо-ведомства');
check(!fs.existsSync(path.join(ROOT, 'export', 'анкеты2', 'Анкета — Отдел туризма.xlsx')), 'выгрузки не попали в общую папку export');
r = run('opros'); const op = path.join(EXP, 'опросник'); check(r.status === 0 && fs.existsSync(op) && fs.readdirSync(op).filter(f => /^Опросник — /.test(f)).length >= 4, 'опросники владельцев по подразделениям (без дублей)');

// 3. расчёты в том же процессе (профиль и данные — демо)
Object.assign(process.env, env);
const { store } = require('../lib/store.js'); const { classify } = require('../lib/rules.js'); const M2 = require('../lib/method_v2.js'); const v11 = require('../lib/method.js');
const PR = require('../lib/profile.js').load();
const procs = store.processes().processes;
check(procs.every(p => p.id.startsWith('ДКТ-')), 'ID процессов с префиксом ДКТ');
check(procs.filter(p => p.duplicateOf).length === 1, 'найден 1 дубль (одинаковые гранты)');
const keys = procs.map(p => classify(p).key); check(['heritage_appeal', 'grant', 'inst_report', 'event', 'guide_cert', 'support'].every(k => keys.includes(k)), 'типы процессов — из демо-правил: ' + [...new Set(keys)].join(', '));
check(PR.deptOf('Председатель комитета') === 'Руководство комитета', 'подразделения — из демо-профиля');
const facts = store.facts(); const all = procs.map(p => ({ p, a: v11.assess(p, facts.filter(f => f.pid === p.id), classify(p), {}, {}), b: M2.assessV2(p, facts.filter(f => f.pid === p.id), classify(p), {}) }));
check(all.every(x => x.a.value.max >= x.a.value.min && x.b.P.mode > 0), 'методика v1.1 и v2 считают все процессы');
check(all.every(x => x.b.evidence && ['PRE', 'INTERVIEW', 'VERIFIED'].includes(x.b.evidence.level) && x.b.evidence.value.PRE.coverage === 1), 'модель доказательств: уровень у каждого процесса, PRE покрыт всегда');
check(all.find(x => /7-НК/.test(x.p.name)).b.items.ext.basis === 'сбор отчётности с подведомственных учреждений', 'признаки v2 — из демо-профиля');
// опросник владельцев: заполненный файл → паспорт «подтверждено»; ФИО вместо должности и ответ не из списка — на разбор
{ const O = require('../lib/opros.js'), L = O.LISTS; const id1 = procs.find(p => /Аттестация/.test(p.name)).id, id2 = procs.find(p => /кадров/.test(p.name)).id;
  const head = [[], [], [], [], [], ['№', 'Код процесса', 'Процесс', '', '', '① Владелец', '②', '③', '④', '⑤', '⑥', '⑦']];
  const f = path.join(EXP, 'Опросник — тест.xlsx');
  fs.writeFileSync(f, buildXlsx([{ name: 'Процессы отдела', rows: [...head,
    ['1', id1, '', '', '', 'Начальник отдела туризма', L.cross[2][0], 'органы МСУ', L.role[0][0], L.group[0][0], L.kind[0][0], 'тест'],
    ['2', id2, '', '', '', 'Петров П.П.', 'как-то так', '', '', L.group[2][0], L.kind[1][0], '']] }]));
  const res = O.importOpros(f, { backup: false }); const c = store.cards();
  const p1 = c[id1].passport, p2 = c[id2].passport;
  check(res.saved === 2 && p1.ownerPost === 'Начальник отдела туризма' && p1.cross === 'agency' && p1.role === 'owner' && p1.kind === 'main' && /опросник/.test(p1.basis), 'опросник: паспорт сохранён как подтверждённый');
  check(!p2.ownerPost && !p2.cross && p2.kind === 'support' && p2.recipientTypes[0] === 'internal' && res.review.length >= 2, 'опросник: ФИО и ответ не из списка — на разбор, остальное сохранено');
  check(require('../lib/passport.js').passportOf(procs.find(p => p.id === id1), c[id1], []).complete, 'опросник: паспорт процесса полностью подтверждён'); }

// 4. веб-интерфейс на свободном порту
(async () => {
  const srv = require('../server.js').start(0); await new Promise(res => srv.on('listening', res)); const port = srv.address().port;
  // на страницах демо-ведомства не должно быть слов других установленных профилей (названия ведомства, положения, руководителя)
  const PR_DIR = path.join(ROOT, 'profiles'); const words = [];
  for (const d of fs.readdirSync(PR_DIR)){ const f = path.join(PR_DIR, d, 'profile.json'); if (d === 'demo-kultura' || !fs.existsSync(f)) continue; const o = JSON.parse(fs.readFileSync(f, 'utf8')); for (const w of [o.org.short, o.org.name, o.org.navSub, o.org.ui, (o.people || {}).headName, ((o.functions || {}).npa || {}).short]) if (w && w.length >= 4) words.push(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); }
  const bad = words.length ? new RegExp(words.join('|')) : /$^/;
  for (const u of ['/', '/processes', '/cascade', '/shortlist', '/reviews', '/functions', '/staff', '/method', '/v2', '/export', '/process/' + encodeURIComponent(procs[0].id)]){
    const resp = await fetch(`http://localhost:${port}${u}`); const t = await resp.text(); const m = t.match(bad);
    check(resp.status === 200 && /ДКТ|комитет/i.test(t) && !m, `страница ${u}: ${resp.status}${m ? ' — найдено «' + m[0] + '» рядом с: ' + t.slice(Math.max(0, m.index - 60), m.index + 30).replace(/\s+/g, ' ') : ''}`);
  }
  // паспорт процесса: без основания не сохраняется, с основанием — «подтверждено»
  const pu = `http://localhost:${port}/process/${encodeURIComponent(procs[0].id)}`;
  const post = body => fetch(pu + '/passport', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  let rr = await post({ kind: 'main', basis: '' }); check(/%D0%B1%D0%B5%D0%B7|без/i.test(decodeURIComponent(rr.headers.get('location') || '')), 'паспорт без основания не сохраняется');
  rr = await post({ kind: 'main', cross: 'agency', crossWith: 'органы МСУ', ownerPost: 'Начальник отдела', rt_business: 'on', basis: 'тест: начальник отдела' });
  const card = await (await fetch(pu)).text(); check(rr.status === 302 && /паспорт процесса сохранён/.test(decodeURIComponent(rr.headers.get('location') || '')) && (card.match(/подтверждено/g) || []).length >= 4, 'паспорт с основанием сохранён и показан как подтверждённый');
  // реализуемость по гипотезам: ручная оценка без основания отклоняется; вид «без ИТ», размер и выбор сохраняются и попадают в строку плана
  const postH = body => fetch(pu + '/hypfeas', { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  rr = await postH({ k0: 'simplify', f0_norm: '5', fb0_norm: '' }); check(/без основания/.test(decodeURIComponent(rr.headers.get('location') || '')), 'гипотеза: ручная оценка F без основания не принимается');
  rr = await postH({ k0: 'simplify', f0_norm: '5', fb0_norm: 'тест: регламент менять не нужно', p0: '2', pb0: 'тест: шаблон за месяц', chosen: '0' });
  const card2 = await (await fetch(pu)).text(); const h0 = (store.cards()[procs[0].id].hyps || [])[0] || {};
  check(rr.status === 302 && h0.kind === 'simplify' && h0.f.norm.score === 5 && h0.size.score === 2 && h0.chosen === true && /Г1<\/b> \(выбрана\) · размер 2, 1 чел.-мес./.test(card2) && !/нет варианта «упростить/.test(card2), 'гипотеза: вид, F4, размер и выбор сохранены, строка плана по выбранной гипотезе');
  // базовая линия и обзоры: пустая не сохраняется; с подтверждёнными фактами — фиксируется; обзор без источника отклоняется, с источником — эффект к базовой линии
  const postB = (path, body) => fetch(pu + path, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });
  const loc = r => decodeURIComponent(r.headers.get('location') || '');
  rr = await postB('/baseline', { start: '2026-02-01', by: 'тест' }); const empty = /пуста/.test(loc(rr));
  store.addFact({ pid: procs[0].id, name: 'count', value: 50, unit: 'случаев/год', status: 'verified', source: 'тест', basis: 'тест', by: 'тест' }); store.addFact({ pid: procs[0].id, name: 'hours', value: 2, unit: 'чел.-ч/случай', status: 'verified', source: 'тест', basis: 'тест', by: 'тест' });
  rr = await postB('/baseline', { start: '2026-02-01', by: 'тест' }); const bl = store.cards()[procs[0].id].baseline;
  check(empty && bl && bl.values.annual.value === 100 && bl.start === '2026-02-01', 'базовая линия: пустая отклонена, с фактами зафиксирована (годовой труд 100)');
  rr = await postB('/review', { kind: 'm3', date: '2026-05-05', by: 'тест', v_hours: '1' }); const noSrc = /без источника/.test(loc(rr));
  rr = await postB('/review', { kind: 'm3', date: '2026-05-05', by: 'тест', v_hours: '1', s_hours: 'хронометраж' }); const page3 = await (await fetch(pu)).text();
  check(noSrc && rr.status === 302 && /обзор записан/.test(loc(rr)) && /−50 %|-50 %/.test(page3.replace(/−/g, '-')), 'обзор: без источника отклонён, с источником записан и показан эффект −50 %');
  const sl = await (await fetch(`http://localhost:${port}/reviews`)).text(); check(sl.includes(procs[0].id) && /через 3 месяца: проведён/.test(sl), 'страница обзоров: процесс с базовой линией и проведённым обзором');
  srv.close();
  const b = require('../lib/storage.js').backend(); if (b.close) b.close();
  try { fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(EXP, { recursive: true, force: true }); } catch {}
  console.log(fails ? `НЕ ПРОЙДЕНО: ${fails}` : 'Демо-ведомство работает без правок ядра'); process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
