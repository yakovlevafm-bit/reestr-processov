// Автотесты ядра на искусственных данных (без данных ведомства). Запуск: node --test tests/
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), os = require('os');

// каждый тест — на своём временном каталоге данных и демо-профиле (ядро не зависит от профиля ведомства)
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'reestr-test-'));
fs.writeFileSync(path.join(TMP, 'config.json'), '{}');
process.env.REESTR_DATA = TMP; process.env.REESTR_STORAGE = 'json'; process.env.REESTR_PROFILE = process.env.REESTR_PROFILE || 'demo-kultura';

const { parseValue } = require('../lib/anketa.js');
const P = require('../lib/profile.js').load();
const v11 = require('../lib/method.js'), M2 = require('../lib/method_v2.js');
const { classify } = require('../lib/rules.js');
const { numericGrounding, unsupportedNumbers } = require('../lib/evidence.js');

const proc = (o = {}) => ({ id: 'T-1', name: 'Тестовый процесс', owner: 'Отдел туризма', group: '', input: '', output: '', client: '', code: '', cross: '', ...o });
const fact = (name, value, status = 'verified', extra = {}) => ({ id: 'f-' + name, pid: 'T-1', name, value, unit: '', status, source: 'тест', ...extra });

test('ответы анкеты: числа, единицы, периодичность', () => {
  assert.deepEqual(parseValue('count', 'около 300'), { value: 300, note: 'приблизительно' });
  assert.equal(parseValue('count', 'ежемесячно').value, 12);
  assert.equal(parseValue('count', 'ежеквартально').value, 4);
  assert.equal(parseValue('count', '10 в месяц').value, 120);
  assert.equal(parseValue('count', '1,5 тыс.').value, 1500);
  assert.equal(parseValue('hours', '30 мин').value, 0.5);
  assert.equal(parseValue('hours', '2,5').value, 2.5);
  assert.ok(parseValue('count', '5-10').review, 'диапазон — на разбор');
  assert.ok(parseValue('hours', '0').review, '0 часов — на разбор');
  assert.ok(parseValue('hours', '500').review, '500 ч на случай — проверить единицу');
  assert.ok(parseValue('count', 'каждый день').review, 'без числа — на разбор');
  assert.equal(parseValue('problem', '4').value, 4);
  assert.ok(parseValue('problem', '7').review);
  assert.equal(parseValue('format', 'Частично цифровой').value, 'частично цифровой');
  assert.equal(parseValue('count', ''), null);
});

test('профиль: подразделения по записи владельца (демо-профиль)', () => {
  assert.equal(P.deptOf('Отдел по туризму и гостеприимству'), 'Отдел туризма'); // сопоставление по ключевым словам из profile.json
  assert.equal(P.deptOf('Заместитель председателя'), 'Руководство комитета');
  assert.equal(P.deptOf('Отдел нового типа'), 'Отдел нового типа');
  assert.equal(P.deptOf(''), 'Подразделение не указано');
});

test('профиль: типы процессов и функции по положению (демо-профиль)', () => {
  assert.equal(classify(proc({ name: 'Рассмотрение обращений о согласовании работ на объектах культурного наследия' })).key, 'heritage_appeal');
  assert.equal(classify(proc({ name: 'Предоставление субсидии на возмещение затрат' })).key, 'grant');
  assert.equal(classify(proc({ name: 'Сбор отчетов 7-НК от подведомственных учреждений' })).key, 'inst_report');
  assert.equal(classify(proc({ name: 'Нечто без ключевых слов' })).key, 'other');
  const FN = require('../lib/functions.js');
  assert.equal(FN.classifyFunctions(proc({ name: 'Учёт памятников архитектуры' })).includes('2.1'), true);
});

test('методика v1.1: веса, двойной счёт убран, группа по границам', () => {
  const rule = classify(proc({ name: 'Предоставление субсидии' }));
  // 100 случаев × 3 ч = 300 ч → труд 3; проблемность 4 → ценность = (3·3 + 2·4) = 17
  const a = v11.assess(proc(), [fact('count', 100), fact('hours', 3), fact('problem', 4)], rule, {}, {});
  assert.equal(a.labor, 300);
  assert.equal(a.value.min, 17); assert.equal(a.value.max, 17);
  assert.equal(a.items.freq.score, 4); // частота считается, но с весом 0
  // без фактов: диапазон 5–25, группа по ожидаемому значению
  const b = v11.assess(proc(), [], rule, {}, {});
  assert.equal(b.value.min, 5); assert.equal(b.value.max, 25); assert.equal(b.complete, false);
  assert.ok(['likely', 'measure_first', 'constraints', 'needs_data', 'quick_wins', 'low'].includes(b.group));
  // ценность не дотягивает до порога даже при лучших значениях → низкий/быстрый результат, а не «нет данных»
  const c = v11.assess(proc(), [fact('count', 2), fact('hours', 1)], rule, {}, {}); // 2 ч/год → труд 1 → max = 3 + 10 = 13
  assert.equal(c.value.max, 13); assert.ok(['low', 'quick_wins'].includes(c.group));
});

test('методика v2: ИП = В × К / Р, доверие, проверка единиц', () => {
  const rule = classify(proc({ name: 'Предоставление субсидии' }));
  const a = M2.assessV2(proc(), [fact('count', 40), fact('hours', 2)], rule, {});
  assert.equal(a.hours, 80);
  assert.ok(a.B.min <= a.B.mode && a.B.mode <= a.B.max);
  assert.ok(a.K.mode > 0 && a.K.mode <= 1);
  assert.ok([1, 2, 3, 5, 8, 13].includes(a.P.mode));
  assert.equal(a.IP.mode, Math.round(a.B.mode * a.K.mode / a.P.mode * 10) / 10);
  assert.ok(a.effect && a.effect.rub > 0);
  // ручная оценка → уровень A и подставляется как есть
  const m = M2.assessV2(proc(), [], rule, { v2: { goal: { score: 5, basis: 'тест' }, size: { score: 3, basis: 'тест' } } });
  assert.equal(m.items.goal.mode, 5); assert.equal(m.items.goal.ev, 'A'); assert.equal(m.P.mode, 3); assert.equal(m.P.ev, 'A');
  // 120 «часов» на случай по реестру — сомнительные единицы: эффект не считается
  const s = M2.assessV2(proc(), [fact('count', 120, 'proposed'), fact('hours', 120, 'proposed')], rule, {});
  assert.equal(s.suspect, true); assert.equal(s.effect, null);
});

test('модель доказательств: уровень вычисляется, покрытие и диапазон, конфликты, ограничения, блокеры', () => {
  const MT = require('../lib/maturity.js'); const rule = classify(proc());
  const a = M2.assessV2(proc(), [], rule, {});
  assert.equal(a.evidence.level, 'PRE'); assert.ok(a.evidence.value.VERIFIED.coverage < 1);
  // все критерии вручную — суждение, не факт: INTERVIEW достижим, VERIFIED — нет
  const man = Object.fromEntries(M2.CRITERIA.value.concat(M2.CRITERIA.fit).map(c => [c.key, { score: 3, basis: 'тест' }]));
  const m = M2.assessV2(proc(), [], rule, { v2: man });
  assert.equal(m.evidence.value.level, 'INTERVIEW'); assert.equal(m.evidence.level, 'INTERVIEW'); assert.equal(m.evidence.value.VERIFIED.coverage, 0);
  assert.equal(m.items.own.ev, 'A', 'в расчёте доверия ручная оценка пока A'); assert.equal(MT.evOf(m.items.own), 'B', 'для зрелости — B');
  // один подтверждённый факт (труд, вес 25) → покрытие VERIFIED 25 %, диапазон, 5 недостающих критериев, прослеживаемость до фактов
  const f = M2.assessV2(proc(), [fact('count', 100), fact('hours', 3)], rule, {}); const V = f.evidence.value.VERIFIED;
  assert.equal(V.coverage, 0.25); assert.ok(V.min < V.max); assert.equal(V.missing.length, 5); assert.deepEqual(f.items.own.src, ['f-count', 'f-hours']);
  // конфликт двух подтверждённых значений влияет на критерий труда и не даёт подняться выше PRE
  const c = MT.conflicts([fact('count', 100), { ...fact('count', 200), id: 'f-count2', by: 'другой' }]);
  assert.equal(c.length, 1); assert.equal(c[0].kind, 'verified'); assert.ok(c[0].crits.includes('own'));
  const cc = M2.assessV2(proc(), [fact('count', 100), { ...fact('count', 200), id: 'f-count2' }, fact('hours', 3)], rule, { v2: man });
  assert.equal(cc.evidence.value.level, 'PRE'); assert.equal(cc.evidence.conflicts.length, 1);
  // расхождение анкеты с подтверждённым (из карточки) — ожидает решения; снимается, когда подтверждённое совпало с анкетой
  assert.equal(MT.conflicts([fact('hours', 2)], { conflicts: [{ name: 'hours', value: 5, verified: 2 }] })[0].kind, 'pending');
  assert.equal(MT.conflicts([fact('hours', 5)], { conflicts: [{ name: 'hours', value: 5, verified: 2 }] }).length, 0);
  // ограничение — один критерий-владелец; неизвестный критерий → готовность проекта
  const cons = MT.constraints({ constraints: [{ text: 'запрет 152-ФЗ', crit: 'stable' }, { text: 'нет исполнителя', crit: 'xx' }] }, MT.targets(M2.CRITERIA));
  assert.equal(cons[0].crit, 'stable'); assert.equal(cons[1].crit, 'readiness');
  // блокер без основания — не доказан
  const bl = MT.blockers({ blockers: ['data', 'legal'], blockerBasis: { data: 'машиночитаемого реестра нет и не планируется' } }, v11.BLOCKERS);
  assert.equal(bl[0].proven, true); assert.equal(bl[1].proven, false);
});

test('реализуемость по гипотезам: ценность общая, F1–F5, размер и блокеры — у каждой гипотезы свои; матрица решений', () => {
  const HY = require('../lib/hypothesis.js'); const rule = classify(proc({ name: 'Предоставление субсидии' }));
  const facts = [fact('count', 100), fact('hours', 3), fact('problem', 4)]; const v2 = M2.assessV2(proc(), facts, rule, {});
  const card = { hyps: [
    { text: 'Шаблон и чек-лист проверки', effect: '', status: 'proposed', kind: 'simplify' },
    { text: 'Интеграция с ФГИС', effect: '', status: 'proposed', kind: 'integrate', blockers: [{ key: 'integ', basis: 'у ФГИС нет API для регионов, письмо оператора' }] },
    { text: 'Отклонённая', effect: '', status: 'rejected' },
    { text: 'ИИ-предпроверка', effect: '', status: 'proposed', kind: 'ai', f: { norm: { score: 5, basis: 'регламент менять не нужно' } }, size: { score: 3, basis: 'оценка ИТ' }, chosen: true },
  ] };
  const hy = HY.assess({ card, rule, facts, v2, BLOCKERS: v11.BLOCKERS });
  assert.equal(hy.rows.length, 3, 'отклонённая гипотеза не оценивается'); assert.deepEqual(hy.rows.map(r => r.i), [0, 1, 3], 'индексы — как в card.hyps');
  const [s, g, a] = hy.rows;
  assert.equal(s.items.integ.mode, 5); assert.equal(s.items.tech.mode, 5); assert.equal(s.P.mode, 2, 'без ИТ — размер 2');
  assert.equal(g.items.integ.mode, 2); assert.ok(g.P.mode >= 8); assert.equal(g.decision.d, 'blocked'); assert.equal(g.blockers[0].proven, true);
  assert.equal(a.items.norm.mode, 5); assert.equal(a.items.norm.ev, 'A'); assert.equal(a.items.norm.manual, true); assert.equal(a.P.mode, 3); assert.equal(a.P.manual, true);
  assert.equal(a.items.measure.ev, 'A', 'подтверждены количество и время — F5 подтверждён'); assert.deepEqual(a.items.measure.src, ['f-count', 'f-hours']);
  assert.ok(hy.rows.every(r => r.total.min <= r.total.mode && r.total.mode <= r.total.max && r.total.max <= 25));
  assert.equal(hy.best.i, 3, 'выбранная гипотеза — для плана'); assert.equal(hy.pm, HY.FIB_PM[3]); assert.equal(hy.size, 3);
  assert.ok(!hy.flags.some(x => /без ИТ/.test(x)), 'вариант без ИТ есть');
  // без выбора — лучшая по реализуемости среди неблокированных; варианта «без ИТ» нет — он добавляется по типу процесса (virtual, не сохранён)
  const hy2 = HY.assess({ card: { hyps: [{ text: 'А', status: 'proposed', kind: 'integrate' }, { text: 'Б', status: 'proposed', kind: 'automate' }] }, rule, facts, v2, BLOCKERS: v11.BLOCKERS });
  assert.equal(hy2.rows.length, 3); assert.equal(hy2.rows[2].kind, 'simplify'); assert.equal(hy2.rows[2].h.virtual, true); assert.ok(!hy2.flags.some(x => /без ИТ/.test(x)));
  assert.equal(hy2.best.i, 2, 'вариант без ИТ: интеграции и техзрелость 5 — лучший по реализуемости');
  assert.equal(HY.list({ hyps: [{ text: 'А', status: 'proposed' }] }, rule, { virtual: false }).length, 1, 'без добавления — как в карточке');
  assert.equal(HY.list({ hyps: [{ text: 'А', status: 'rejected', kind: 'simplify' }] }, rule).length, 2, 'отклонённый вариант без ИТ не считается');
  assert.equal(HY.list({}, { hyps: [], simplify: ['Свой текст', 'эффект'] }).find(h => h.kind === 'simplify').text, 'Свой текст', 'текст — из типа процесса (профиль)');
  // матрица: порог 19 по каждой оси, диапазон через порог → замерить
  const r = { total: { min: 20, max: 24 }, P: { mode: 2 }, blockers: [] };
  assert.equal(HY.decide({ min: 20, max: 23 }, r).d, 'plan');
  assert.equal(HY.decide({ min: 10, max: 15 }, r).d, 'quick');
  assert.equal(HY.decide({ min: 10, max: 15 }, { ...r, P: { mode: 5 } }).d, 'skip');
  assert.equal(HY.decide({ min: 20, max: 23 }, { ...r, total: { min: 12, max: 16 } }).d, 'other');
  assert.equal(HY.decide({ min: 15, max: 22 }, r).d, 'measure');
  // размер гипотезы попадает в каскад
  const CS = require('../lib/cascade.js'); const PS = require('../lib/passport.js');
  const p = proc({ client: 'ФЛ, ЮЛ' }); const item = { p, rule, facts, card, a: {}, pp: PS.passportOf(p, card, []), v2, hy };
  CS.run([item], { labor: [{ id: 'T-1', labor: 300, sure: true }] });
  assert.equal(item.cs.pm, HY.FIB_PM[3]); assert.equal(item.cs.size, 3);
});

test('короткий список: мощность обследования, ручное включение и исключение', () => {
  const CS = require('../lib/cascade.js'), PS = require('../lib/passport.js'), HY = require('../lib/hypothesis.js');
  const rule = classify(proc({ name: 'Предоставление субсидии' }));
  const mk = (id, card = {}) => { const p = proc({ id, client: 'ФЛ, ЮЛ' }); const facts = [{ ...fact('count', 100), pid: id }, { ...fact('hours', 3), pid: id }, { ...fact('problem', 4), pid: id }]; const v2 = M2.assessV2(p, facts, rule, card); return { p, rule, facts, card, a: {}, pp: PS.passportOf(p, card, []), v2, hy: HY.assess({ card, rule, facts, v2, BLOCKERS: v11.BLOCKERS }) }; };
  const items = [mk('T-1'), mk('T-2'), mk('T-3', { short: { in: false, basis: 'уже в работе у РЦК' } }), mk('T-4', { light: 'green', short: { in: true, basis: 'поручение министра' } })];
  const labor = items.map(x => ({ id: x.p.id, labor: 300, sure: true }));
  const res = CS.run(items, { labor, cfg: { surveyN: 2 } });
  const short = items.filter(x => x.cs.short).map(x => x.p.id);
  assert.deepEqual(short, ['T-1', 'T-2'], 'первые surveyN прошедших отбор; исключённый вручную не попадает'); assert.equal(res.short, 2);
  assert.equal(res.pool, 3, 'пул: два по каскаду + один включённый вручную (зелёный, не прошёл отбор)');
  const res2 = CS.run(items, { labor, cfg: { surveyN: 5 } }); assert.ok(items.find(x => x.p.id === 'T-4').cs.short, 'включённый вручную попадает, когда есть мощность'); assert.ok(!items.find(x => x.p.id === 'T-3').cs.short); assert.equal(res2.short, 3);
});

test('базовая линия и обзоры эффекта: снимок, сроки, эффект к базовой линии', () => {
  const RV = require('../lib/review.js');
  const facts = [fact('count', 40), fact('hours', 2), fact('problem', 5), fact('term', 9.5, 'proposed')];
  const dm = { vpp: { n: 12, med: 7 }, late: { n: 3, of: 12, pct: 25 } };
  const b = RV.snapshot({ facts, dm, start: '2026-01-15', by: 'тест' });
  assert.equal(b.values.count.value, 40); assert.equal(b.values.annual.value, 80, 'годовой труд — произведение подтверждённых'); assert.ok(!b.values.term, 'неподтверждённый факт в базовую линию не входит');
  assert.equal(b.values.vpp.value, 7); assert.equal(b.values.late.value, 25); assert.deepEqual(RV.gaps(b), []);
  assert.ok(RV.gaps(RV.snapshot({ facts: [], dm: null })).length >= 2, 'пустая базовая линия — пробелы названы');
  const d = RV.due(b, [{ kind: 'm3', date: '2026-04-20', values: {} }], '2026-10-25');
  assert.equal(d[0].status, 'done'); assert.equal(d[1].date, '2027-01-15'); assert.equal(d[1].status, 'later');
  assert.equal(RV.due(b, [], '2026-05-01')[0].status, 'overdue'); assert.equal(RV.due(b, [], '2027-01-01')[1].status, 'soon');
  const e = RV.effect(b, { kind: 'm12', values: { hours: 1, vpp: 3, count: 45, hours_src: 'хронометраж' } });
  const by = Object.fromEntries(e.map(r => [r.key, r]));
  assert.equal(by.hours.pct, -50); assert.equal(by.hours.good, true); assert.equal(by.hours.src, 'хронометраж');
  assert.equal(by.vpp.good, true); assert.equal(by.count.good, null, 'объём — без направления «лучше»'); assert.equal(by.problem.after, null);
  const sm = RV.summary({ baseline: b, reviews: [{ kind: 'm3', date: '2026-04-20', values: { hours: 3 } }] }, '2026-10-25');
  assert.equal(sm.last.rows.find(r => r.key === 'hours').good, false, 'стало хуже — видно');
});

test('паспорт процесса: получатель, вид, поток, владелец', () => {
  const PS = require('../lib/passport.js');
  assert.deepEqual(PS.recipientTypes('ФЛ, ЮЛ, ИП'), ['citizens', 'business']);
  assert.deepEqual(PS.recipientTypes('Минкультуры России'), ['federal']);
  assert.deepEqual(PS.recipientTypes('Юридические лица, индивидуальные предприниматели, осуществляющие деятельность в области животноводства'), ['business'], '«в области» — не региональный орган');
  assert.deepEqual(PS.recipientTypes('управление финансов области'), ['regional']);
  assert.deepEqual(PS.recipientTypes('Сотрудники предприятий'), ['business'], 'сильный признак важнее слабого «сотрудники»');
  assert.deepEqual(PS.recipientTypes(''), ['unknown']);
  const staff = [{ dept: 'Отдел туризма', position: 'Начальник отдела' }];
  let x = PS.passportOf(proc({ kind: 'вспомогательный', client: 'ФЛ, ЮЛ', cross: 'сквозной' }), {}, staff);
  assert.equal(x.kind.conflict, true, 'вспомогательный с внешним получателем — противоречие');
  assert.equal(x.cross.value, 'inter'); assert.match(x.cross.note, /не указано, с кем/);
  assert.equal(x.owner.value, 'Начальник отдела (Отдел туризма)'); assert.equal(x.owner.src, 'авто');
  x = PS.passportOf(proc({ cross: 'сквозной', crossWith: 'Министерство Финансов, Казначейство' }), {}, staff);
  assert.equal(x.cross.value, 'agency', 'с федеральным органом — межведомственный');
  x = PS.passportOf(proc({ name: 'Формирование планов и подготовка отчетности по ключевым показателям эффективности', kind: 'основной' }), {}, staff);
  assert.equal(x.kind.value, 'manage');
  x = PS.passportOf(proc({ kind: 'вспомогательный', client: 'ФЛ' }), { passport: { kind: 'main', ownerPost: 'Заместитель министра', cross: 'dept', recipientTypes: ['citizens'], basis: 'тест' } }, staff);
  assert.equal(x.kind.src, 'подтверждено'); assert.equal(x.kind.conflict, undefined); assert.equal(x.complete, true);
});

test('доказательность: число должно стоять в цитате', () => {
  const src = 'Экземпляров в год: 120. Человеко-часы на 1 экземпляр: 2';
  assert.equal(numericGrounding('count', 120, 'Экземпляров в год: 120', src).ok, true);
  assert.equal(numericGrounding('count', 150, 'Экземпляров в год: 120', src).ok, false);
  assert.equal(numericGrounding('count', 120, 'цитаты нет в источнике 120', src).ok, false);
  // утверждение о текущем состоянии с числом, которого нет в источнике, — ловится; цель («до 2 ч») — нет
  assert.deepEqual(unsupportedNumbers('сейчас занимает 20 ч на заявку, цель — до 2 ч', 'в реестре 5 ч на заявку').map(x => x.n), [20]);
  assert.deepEqual(unsupportedNumbers('сейчас занимает 5 ч на заявку', 'в реестре 5 ч на заявку'), []);
});

for (const kind of ['json', 'sqlite']) test(`хранилище ${kind}: чтение, запись, атомарное изменение, журнал, копия`, () => {
  const ST = require('../lib/storage.js'); const dir = fs.mkdtempSync(path.join(TMP, kind + '-'));
  const prev = process.env.REESTR_DATA; process.env.REESTR_DATA = dir;
  delete require.cache[require.resolve('../lib/storage.js')]; const S2 = require('../lib/storage.js');
  const b = kind === 'json' ? S2.jsonBackend() : S2.sqliteBackend(path.join(dir, 'reestr.sqlite'));
  assert.deepEqual(b.get('cards', {}), {});
  b.put('cards', { a: 1 }); assert.deepEqual(b.get('cards', {}), { a: 1 });
  const r = b.update('cards', {}, c => { c.b = 2; return 'ok'; }); assert.equal(r, 'ok'); assert.deepEqual(b.get('cards', {}), { a: 1, b: 2 });
  assert.throws(() => b.update('cards', {}, c => { c.c = 3; throw new Error('стоп'); }));
  if (kind === 'sqlite') assert.deepEqual(b.get('cards', {}), { a: 1, b: 2 }, 'ошибка внутри изменения — откат');
  b.appendLog({ at: 't', act: 'x', n: 1 }); b.appendLog({ at: 't', act: 'y', n: 2 }); assert.deepEqual(b.readLog().map(o => o.act), ['x', 'y']);
  const bk = b.backup(path.join(dir, 'bk')); assert.ok(fs.readdirSync(bk).length >= 1);
  if (b.close) b.close();
  process.env.REESTR_DATA = prev; delete require.cache[require.resolve('../lib/storage.js')]; void ST;
});

test('загрузка реестра из xlsx шаблона ОГВ', () => {
  const { buildXlsx } = require('../lib/xlsxwrite.js');
  const head = ['№', 'Код', 'Группа', 'Название процесса', 'Владелец', 'Статус', 'Клиент', 'Вход', 'Выход', 'Вид', 'Ч/экз', 'Экз/год', 'Сквозной', 'С кем', 'Роль', 'Тип', 'Формат', 'Машиночитаемость', 'ИС'];
  const rows = [[], [], [], [], [], [], [], head,
    ['1', 'ОП.ГУ.', 'ОП. Обращения', 'Рассмотрение обращения о наличии угодий', 'Отдел ИС', '', 'ЮЛ', 'Обращение', 'Ответ', 'основной', '2', '40', 'несквозной', '', '', 'бумажный', 'частично цифровой', 'немашиночитаемый', ''],
    ['2', 'ОП.ГУ.', 'ОП. Обращения', 'Рассмотрение обращения о наличии угодий', 'Отдел ИС', '', 'ЮЛ', 'Обращение', 'Ответ', 'основной', '120 мин', '40', '', '', '', '', '', '', '']];
  const f = path.join(TMP, 'reg.xlsx'); fs.writeFileSync(f, buildXlsx([{ name: 'Реестр', rows }]));
  const r = require('../lib/registry_import.js').importRegistry(f);
  assert.equal(r.processes.length, 2);
  assert.equal(r.processes[0].id, P.org.idPrefix + '-9');
  assert.equal(r.processes[0].perYear, 40); assert.equal(r.processes[0].hours, 2);
  assert.equal(r.processes[1].hoursUnit, 'мин');
  assert.equal(r.processes[1].duplicateOf, r.processes[0].id, 'одинаковое название — дубль');
});

test.after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });
