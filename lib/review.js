/* ================================================================
   Базовая линия и обзоры эффекта (единая схема отбора, этап 3 — 25.10.2026).
   Источник: отзыв на Methodology v2.0 (п. 10: VERIFIED остаётся оценкой «до»,
   нужны обзоры после внедрения), стандарт РЦК (паспорт проекта с текущими и
   целевыми значениями), практика РАНХиГС по оценке эффекта.

   Базовая линия (card.baseline) фиксируется при старте проекта: подтверждённые
   факты процесса (количество, время, годовой труд, срок, проблемность) и показатели
   потока по СЭД (ВПП, доля позже срока) — те же показатели потом сравниваются
   в обзорах. Обзоры (card.reviews[]) — через 3 и 12 месяцев после старта: значение
   «после» по каждому показателю, источник, кто провёл. Эффект считается, а не
   декларируется: Δ и % к базовой линии по каждому показателю.
   ================================================================ */
'use strict';
const { toNum } = require('./method.js');

// показатели базовой линии; better: down — меньше лучше, none — направление не задано (объём)
const METRICS = [
  { key: 'count', name: 'Количество выполнений в год', unit: 'случаев/год', better: 'none' },
  { key: 'hours', name: 'Активное время на один случай', unit: 'чел.-ч', better: 'down' },
  { key: 'annual', name: 'Годовой объём ручного труда', unit: 'чел.-ч/год', better: 'down' },
  { key: 'term', name: 'Срок выполнения', unit: 'дней', better: 'down' },
  { key: 'problem', name: 'Проблемность', unit: '1–5', better: 'down' },
  { key: 'vpp', name: 'Время протекания по СЭД', unit: 'раб. дн.', better: 'down' },
  { key: 'late', name: 'Позже срока по СЭД', unit: '%', better: 'down' },
];
const KINDS = { m3: 'через 3 месяца', m12: 'через 12 месяцев' };
const MONTHS = { m3: 3, m12: 12 };

const iso = d => d.toISOString().slice(0, 10);
const addMonths = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return iso(d); };
const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);

/** Снимок базовой линии: последние подтверждённые факты + показатели ДЕЛА (dm — delo_metrics.procs[id]). */
function snapshot({ facts = [], dm = null, start, by = 'оператор', at }){
  const values = {};
  for (const m of METRICS.slice(0, 5)){
    const ok = facts.filter(f => f.name === m.key && f.status === 'verified'); const f = ok[ok.length - 1];
    if (f && toNum(f.value) !== null) values[m.key] = { value: toNum(f.value), src: `факт ${f.id}: ${f.source || ''}`.trim() };
  }
  // годовой труд — произведение, если прямого факта нет
  if (!values.annual && values.count && values.hours) values.annual = { value: Math.round(values.count.value * values.hours.value), src: 'количество × время (подтверждённые факты)' };
  if (dm && dm.vpp && dm.vpp.n >= 5 && dm.vpp.med !== null && dm.vpp.med !== undefined) values.vpp = { value: dm.vpp.med, src: `СЭД: медиана по ${dm.vpp.n} документам` };
  if (dm && dm.late && dm.late.of >= 5 && dm.late.pct !== null) values.late = { value: dm.late.pct, src: `СЭД: ${dm.late.n} из ${dm.late.of} документов` };
  return { at: at || iso(new Date()), start: start || iso(new Date()), by, values };
}

/** Чего не хватает в базовой линии для обзора: нет ни одного показателя труда / потока. */
function gaps(baseline){
  const v = (baseline && baseline.values) || {}; const out = [];
  if (!v.annual && !v.hours) out.push('нет подтверждённого времени на случай или годового труда — эффект по труду не измерить');
  if (!v.vpp && !v.term) out.push('нет срока или времени протекания — эффект по срокам не измерить');
  if (!v.problem) out.push('нет оценки проблемности «до»');
  return out;
}

/** Сроки обзоров и их состояние: done | overdue | soon (≤ 30 дней) | later. */
function due(baseline, reviews = [], today = iso(new Date())){
  if (!baseline || !baseline.start) return [];
  return Object.keys(KINDS).map(kind => {
    const date = addMonths(baseline.start, MONTHS[kind]); const r = reviews.find(x => x.kind === kind);
    const d = days(today, date);
    return { kind, name: KINDS[kind], date, review: r || null, status: r ? 'done' : d < 0 ? 'overdue' : d <= 30 ? 'soon' : 'later', days: d };
  });
}

/** Эффект обзора к базовой линии: по каждому показателю «до», «после», Δ, %. */
function effect(baseline, review){
  const b = (baseline && baseline.values) || {}, a = (review && review.values) || {};
  return METRICS.filter(m => b[m.key] || a[m.key] !== undefined).map(m => {
    const before = b[m.key] ? b[m.key].value : null, after = a[m.key] !== undefined && a[m.key] !== null && a[m.key] !== '' ? toNum(a[m.key]) : null;
    const delta = before !== null && after !== null ? Math.round((after - before) * 100) / 100 : null;
    const pct = delta !== null && before ? Math.round(delta / before * 100) : null;
    const good = delta === null || m.better === 'none' ? null : m.better === 'down' ? delta < 0 : delta > 0;
    return { key: m.key, name: m.name, unit: m.unit, before, after, delta, pct, good, src: a[m.key + '_src'] || '' };
  });
}

/** Сводка по процессу для страниц: базовая линия, обзоры, сроки, итоговый эффект по последнему обзору. */
function summary(card, today){
  const baseline = card.baseline || null, reviews = card.reviews || [];
  const d = due(baseline, reviews, today);
  const last = reviews.length ? reviews[reviews.length - 1] : null;
  return { baseline, reviews, due: d, gaps: baseline ? gaps(baseline) : [], last: last ? { review: last, rows: effect(baseline, last) } : null };
}

module.exports = { METRICS, KINDS, MONTHS, snapshot, gaps, due, effect, summary, addMonths };
