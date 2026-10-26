/* ================================================================
   Реализуемость по гипотезам (единая схема отбора, этап 2 — 25.10.2026).
   Источник: Methodology v2.0 (SCORING_ENGINE_SPEC_V2_DRAFT) и отзыв на неё.

   Ценность — свойство процесса (ось В методики v2), реализуемость — свойство
   конкретного варианта улучшения: у одного процесса «шаблон и чек-лист» и
   «интеграция с ФГИС» реализуемы по-разному. Поэтому F1–F5 (/25), размер работы,
   блокеры и готовность проекта считаются для каждой гипотезы отдельно, а ценность
   у всех гипотез процесса общая. Оси не складываются: решение — по матрице
   ценность × реализуемость с порогом 19/25 по каждой оси (как в v1.1); если
   диапазон пересекает порог — «сначала замерить».

   Гипотезы — card.hyps[i] (текст, эффект, статус); сюда добавляются поля:
     kind      — вид: simplify (упростить/устранить без ИТ) | automate | integrate | ai;
     f         — ручные оценки F1–F5 с основанием: { data: {score, basis}, ... };
     size      — размер работы 1-2-3-5-8-13 с основанием;
     blockers  — [{ key, basis }] — доказанная невозможность именно для этой гипотезы;
     chosen    — выбранный вариант (иначе берётся лучший по реализуемости без блокеров).
   Стартовые оценки F — по типу процесса (rule.feas) и виду гипотезы, уровень C;
   F5 поднимается до A, когда подтверждены количество и время (есть что мерить).
   Уровень зрелости оси F — lib/maturity.js (PRE → INTERVIEW → VERIFIED).
   Среди гипотез обязателен вариант «упростить или устранить без ИТ» — иначе отметка.
   ================================================================ */
'use strict';
const MT = require('./maturity.js');

const THRESHOLD = 19; // порог высокого уровня по каждой оси, /25
const F = [
  { key: 'data', w: 1, name: 'F1 Данные', hint: 'машиночитаемый источник для решения есть → 5; данные только на бумаге → 1', from: 'data' },
  { key: 'integ', w: 1, name: 'F2 Интеграции', hint: 'внешних систем не нужно → 5; нужен API СЭД / СМЭВ / ФГИС → 2; интеграция невозможна → 1', from: 'integ' },
  { key: 'tech', w: 1, name: 'F3 Техническая зрелость', hint: 'решается имеющимся стеком (формы, шаблоны, OCR, ИИ через ведомственный шлюз) → 5; нужна разработка или закупка → 2', from: 'tech' },
  { key: 'norm', w: 1, name: 'F4 Нормативные и организационные ограничения', hint: 'менять НПА и регламенты не нужно → 5; нужен приказ ведомства → 3; менять областной НПА или федеральные требования → 1' },
  { key: 'measure', w: 1, name: 'F5 Измеримость эффекта', hint: 'есть журнал или счётчик «до» и «после» → 5; эффект не измерить → 1', from: 'measure' },
];
const KIND = { simplify: 'упростить или устранить без ИТ', automate: 'автоматизировать по правилам', integrate: 'интеграция или новая система', ai: 'ИИ-помощник' };
// поправки стартовых оценок и размера по виду гипотезы
const KIND_FIX = {
  simplify: { integ: [5, 'без ИТ-решения — интеграции не нужны'], tech: [5, 'без ИТ-решения'], size: 2 },
  integrate: { integ: [2, 'нужна интеграция с внешней системой'], tech: [2, 'разработка или закупка'], sizeMin: 8 },
  ai: { tech: [3, 'ИИ через ведомственный шлюз — пилот и проверка качества'], sizeMin: 5 },
};
const FIB = [1, 2, 3, 5, 8, 13], FIB_PM = { 1: 0.5, 2: 1, 3: 2, 5: 4, 8: 8, 13: 12 };
const DEC = {
  plan: 'в план — по очереди и до линии мощности команды', other: 'другая гипотеза или сначала снять ограничения', quick: 'быстрая победа — размер работ ≤ 2',
  skip: 'не берём в этом цикле', measure: 'сначала замерить', blocked: 'доказан блокер',
};
const r1 = v => Math.round(v * 10) / 10;
const est = (mode, ev, basis, spread = 1) => ({ min: Math.max(1, mode - spread), mode, max: Math.min(5, mode + spread), ev, basis, src: [] });
const sure = (facts, name) => facts.some(f => f.name === name && f.status === 'verified');

// вариант «упростить или устранить без ИТ» — обязателен среди гипотез (единая схема); текст по типу процесса (rules.json simplify), иначе общий
const SIMPLIFY_DEFAULT = ['Упростить или устранить без ИТ: убрать лишние согласования и дублирующие сведения, ввести чек-лист и шаблон, принимать по одному каналу', 'меньше передач и переделок'];
const simplifyOf = rule => { const s = rule.simplify || SIMPLIFY_DEFAULT; return { text: s[0], effect: s[1] || '', status: 'proposed', source: 'правила', kind: 'simplify' }; };

/** Гипотезы процесса: из карточки, иначе стартовые по типу процесса; если варианта без ИТ нет — он добавляется
    (virtual: true — не сохранён, появится в карточке при следующем сохранении гипотез). opts.virtual = false — без добавления. */
function list(card, rule, opts = {}){
  const base = card.hyps || (rule.hyps || []).map(h => ({ text: h[0], effect: h[1], status: 'proposed', source: 'правила' }));
  if (opts.virtual === false || base.some(h => h.kind === 'simplify' && h.status !== 'rejected')) return base;
  return [...base, { ...simplifyOf(rule), virtual: true }];
}

/** Реализуемость одной гипотезы: F1–F5 с уровнями, сумма /25 (мин–вер–макс), размер, блокеры, зрелость. */
function assessOne(h, { rule, facts, v2, BLOCKERS }){
  const feas = rule.feas || {}, fix = KIND_FIX[h.kind] || {}, items = {};
  for (const c of F){
    const k = fix[c.key];
    if (k) items[c.key] = est(k[0], 'C', k[1]);
    else if (c.from && feas[c.from] !== undefined && feas[c.from] !== null) items[c.key] = est(feas[c.from], 'C', `по типу процесса «${rule.type}» — уточнить`);
    else items[c.key] = est(3, 'C', c.key === 'norm' ? 'нормативные ограничения не оценены — уточнить у владельца и юриста' : 'тип процесса не определён', 2);
  }
  if (sure(facts, 'count') && sure(facts, 'hours')) items.measure = { ...est(Math.max(items.measure.mode, 4), 'A', 'подтверждены количество и время — есть что мерить', 0), src: facts.filter(f => ['count', 'hours'].includes(f.name) && f.status === 'verified').map(f => f.id) };
  for (const c of F){ const m = h.f && h.f[c.key]; if (m && m.score) items[c.key] = { ...est(+m.score, 'A', 'вручную: ' + (m.basis || ''), 0), manual: true }; }
  const sum = k => F.reduce((s, c) => s + items[c.key][k], 0);
  const total = { min: sum('min'), mode: sum('mode'), max: sum('max') }; total.exp = r1((total.min + 4 * total.mode + total.max) / 6);
  // размер работы: вручную → по виду гипотезы → по типу процесса (v2.P)
  let P;
  if (h.size && FIB.includes(+h.size.score)) P = { min: +h.size.score, mode: +h.size.score, max: +h.size.score, ev: 'A', manual: true, basis: 'вручную: ' + (h.size.basis || '') };
  else { let m = fix.size || Math.max(v2.P.mode, fix.sizeMin || 1); if (!FIB.includes(m)) m = FIB.find(x => x >= m) || 13; const i = FIB.indexOf(m); P = { min: FIB[Math.max(0, i - 1)], mode: m, max: FIB[Math.min(FIB.length - 1, i + 1)], ev: 'C', basis: fix.size || fix.sizeMin ? `по виду гипотезы «${KIND[h.kind]}»` : v2.P.basis }; }
  const blockers = (h.blockers || []).filter(b => b && BLOCKERS[b.key]).map(b => ({ key: b.key, name: BLOCKERS[b.key], basis: b.basis || '', proven: !!(b.basis || '').trim() }));
  const ax = MT.axis(items, F, s => F.reduce((a, c) => a + s[c.key], 0));
  const level = MT.maturity(ax, [], F.map(c => c.key)).level;
  return { items, total, P, pm: FIB_PM[P.mode], blockers, axis: ax, level };
}

/** Решение по матрице ценность × реализуемость: V, Fh — {min, max} /25. */
function decide(V, r){
  if (r.blockers.some(b => b.proven)) return { d: 'blocked', why: 'доказан блокер: ' + r.blockers.filter(b => b.proven).map(b => b.name).join('; ') };
  const T = THRESHOLD, cross = x => x.min < T && x.max >= T;
  if (cross(V) || cross(r.total)) return { d: 'measure', why: `диапазон пересекает порог ${T}: ${[cross(V) ? 'ценность процесса' : '', cross(r.total) ? 'реализуемость гипотезы' : ''].filter(Boolean).join(' и ')} — замерить недостающие критерии` };
  const hv = V.min >= T, hf = r.total.min >= T;
  if (hv && hf) return { d: 'plan', why: `ценность ${V.min}+ и реализуемость ${r.total.min}+ не ниже порога ${T}` };
  if (hv) return { d: 'other', why: `ценность высокая, реализуемость ${r.total.max} ниже порога ${T}` };
  if (hf) return r.P.mode <= 2 ? { d: 'quick', why: `ценность ниже порога, но размер ${r.P.mode} — быстрая победа` } : { d: 'skip', why: `ценность ${V.max} ниже порога ${T}` };
  return { d: 'skip', why: `обе оси ниже порога ${T}` };
}

/** Все гипотезы процесса + сводка: выбранная (или лучшая без блокеров), размер для плана, отметки. */
function assess({ card, rule, facts, v2, BLOCKERS }){
  const hyps = list(card, rule).map((h, i) => ({ h, i })).filter(x => x.h.status !== 'rejected'); // i — индекс в card.hyps
  const V = { min: r1(v2.B.min / 4), max: r1(v2.B.max / 4), exp: r1(v2.B.exp / 4) }; // В 20–100 → /25, порог 19 ≙ 76
  const rows = hyps.map(({ h, i }) => { const r = assessOne(h, { rule, facts, v2, BLOCKERS }); return { i, h, ...r, decision: decide(V, r), kind: h.kind || '', chosen: !!h.chosen }; });
  const live = rows.filter(r => !r.blockers.some(b => b.proven));
  const best = rows.find(r => r.chosen) || [...live].sort((a, b) => b.total.exp - a.total.exp || a.P.mode - b.P.mode)[0] || null;
  const flags = [];
  if (!rows.length) flags.push('гипотез улучшения нет');
  else if (!rows.some(r => r.kind === 'simplify')) flags.push('нет варианта «упростить или устранить без ИТ»');
  if (rows.length === 1) flags.push('одна гипотеза — нужен второй вариант');
  if (best && best.chosen && best.blockers.some(b => b.proven)) flags.push('у выбранной гипотезы доказан блокер');
  return { V, rows, best, pm: best ? best.pm : v2.pm, size: best ? best.P.mode : v2.P.mode, level: best ? best.level : 'PRE', flags };
}

module.exports = { THRESHOLD, F, KIND, FIB, FIB_PM, DEC, SIMPLIFY_DEFAULT, simplifyOf, list, assessOne, decide, assess };
