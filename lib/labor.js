/* ================================================================
   Сверка трудозатрат: реестр противоречит сам себе?
   ----------------------------------------------------------------
   Для каждого процесса: часы на случай × случаев в год = труд/год.
   Вердикты: нет данных · правдоподобно · похоже на минуты · похоже на
   часы за год (а не на случай) · больше фонда отдела · текст вместо
   числа · противоречие подтверждённых фактов. Отдельно — сумма по
   отделам против фонда штата (если штат загружен).
   check(all, staff) → { rows, byDept, summary }
   exportXlsx(res)   → export/Сверка трудозатрат <дата>.xlsx
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { store, ROOT } = require('./store.js');
const { buildXlsx, S } = require('./xlsxwrite.js');
const { toNum } = require('./method.js');
const { deptOf } = require('./anketa.js');

const FUND = 1970; // ч/год на ставку по умолчанию
const MAX_PER_CASE = 40; // активных часов на один случай — выше почти всегда ошибка единиц

function verdict(p, cnt, hrs, annual, deptFund, deptRates){
  if (p.hoursRaw && hrs === null) return ['текст вместо числа', `в колонке «часы»: «${p.hoursRaw.slice(0, 50)}»`];
  if (p.perYearRaw && cnt === null) return ['текст вместо числа', `в колонке «в год»: «${p.perYearRaw.slice(0, 50)}»`];
  if (cnt === null && hrs === null) return ['нет данных', 'нет ни количества, ни времени'];
  if (hrs === null) return ['нет времени на случай', `случаев ${cnt}`];
  if (cnt === null) return ['нет количества', `часов на случай ${hrs}`];
  const labor = cnt * hrs;
  if (/мин/i.test(p.hoursRaw)) return ['минуты в реестре', `${hrs} мин × ${cnt} = ${Math.round(labor / 60)} ч/год`];
  if (hrs > MAX_PER_CASE && cnt > 1 && hrs / cnt < MAX_PER_CASE) return ['похоже на часы за год', `${hrs} ч на случай при ${cnt} случаях — скорее ${hrs} ч за год (${(hrs / cnt).toFixed(1)} ч/случай)`];
  if (hrs > MAX_PER_CASE && cnt <= 1) return ['часы за год или минуты', `${hrs} ч на единственный случай — либо годовой объём, либо минуты`];
  if (hrs > MAX_PER_CASE) return ['похоже на минуты', `${hrs} ч на случай нереалистично; в минутах было бы ${(hrs / 60).toFixed(1)} ч`];
  if (deptFund && labor > deptFund) return ['больше фонда отдела', `${Math.round(labor).toLocaleString('ru')} ч/год при фонде отдела ${Math.round(deptFund).toLocaleString('ru')} ч (${deptRates} ставок)`];
  if (labor > 3 * FUND) return ['больше трёх ставок', `${Math.round(labor).toLocaleString('ru')} ч/год — проверить обе цифры`];
  if (annual !== null && Math.abs(annual - labor) > Math.max(1, labor * 0.01)) return ['противоречие', `подтверждённый годовой труд ${annual}, а случаи × часы = ${Math.round(labor)}`];
  return ['правдоподобно', `${Math.round(labor).toLocaleString('ru')} ч/год`];
}

function check(all, staff){
  const fund = {}; for (const s of staff || []){ const d = fund[s.dept] = fund[s.dept] || { fund: 0, rates: 0 }; d.fund += (+s.occupied || 0) * (+s.hoursPerRate || FUND); d.rates += +s.occupied || 0; }
  const rows = [];
  for (const x of all){
    const pick = n => { const v = x.facts.filter(f => f.name === n && f.status === 'verified'); const pr = x.facts.filter(f => f.name === n && f.status === 'proposed'); return v.length ? { v: toNum(v[v.length - 1].value), sure: true } : pr.length ? { v: toNum(pr[pr.length - 1].value), sure: false } : { v: null, sure: false }; };
    const c = pick('count'), h = pick('hours'), a = pick('annual');
    const dept = deptOf(x.p.owner); const df = fund[dept] || fund[x.p.owner];
    const conflict = x.a.conflicts.find(k => k.key === 'labor' || k.key === 'freq');
    const [verd, why] = conflict ? ['противоречие', conflict.values.join(' / ')] : verdict(x.p, c.v, h.v, a.sure ? a.v : null, df && df.fund, df && df.rates);
    const labor = c.v !== null && h.v !== null ? c.v * h.v : null;
    rows.push({ id: x.p.id, name: x.p.name, dept, owner: x.p.owner, pilot: !!x.card.pilot, hoursRaw: x.p.hoursRaw, perYearRaw: x.p.perYearRaw, hours: h.v, count: c.v, sure: c.sure && h.sure, labor, verdict: verd, why, fixed: verd === 'минуты в реестре' ? labor / 60 : verd === 'похоже на часы за год' ? h.v : verd === 'похоже на минуты' ? labor / 60 : labor });
  }
  const byDept = {};
  for (const r of rows){ const d = byDept[r.dept] = byDept[r.dept] || { dept: r.dept, n: 0, withData: 0, plausible: 0, rawLabor: 0, fixedLabor: 0, fund: (fund[r.dept] || {}).fund || 0, rates: (fund[r.dept] || {}).rates || 0, verdicts: {} }; d.n++; if (r.labor !== null){ d.withData++; d.rawLabor += r.labor; d.fixedLabor += r.fixed || 0; } if (r.verdict === 'правдоподобно') d.plausible++; d.verdicts[r.verdict] = (d.verdicts[r.verdict] || 0) + 1; }
  const summary = {}; for (const r of rows) summary[r.verdict] = (summary[r.verdict] || 0) + 1;
  return { rows, byDept: Object.values(byDept).sort((a, b) => b.n - a.n), summary, rawTotal: rows.reduce((s, r) => s + (r.labor || 0), 0), fixedTotal: rows.reduce((s, r) => s + (r.fixed || 0), 0) };
}

function exportXlsx(res){
  const dir = path.join(require('./storage.js').EXPORT); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'Сверка трудозатрат ' + new Date().toISOString().slice(0, 10) + '.xlsx');
  const H = v => ({ v, s: S.HEAD }), T = v => ({ v: v ?? '', s: S.WRAP }), N = v => ({ v: v === null || v === undefined ? '' : Math.round(v * 100) / 100, s: S.NUM });
  const rows = [['ID', 'Отдел', 'Процесс', 'В пилоте', 'Часы на случай (реестр)', 'Случаев в год (реестр)', 'Часы, число', 'Случаев, число', 'Труд/год как записано', 'Вердикт', 'Пояснение', 'Труд/год с поправкой', 'Факты подтверждены'].map(H)];
  const order = ['противоречие', 'больше фонда отдела', 'больше трёх ставок', 'похоже на часы за год', 'похоже на минуты', 'часы за год или минуты', 'минуты в реестре', 'текст вместо числа', 'нет времени на случай', 'нет количества', 'нет данных', 'правдоподобно'];
  for (const r of [...res.rows].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || (b.labor || 0) - (a.labor || 0))) rows.push([r.id, T(r.dept), T(r.name), r.pilot ? 'да' : '', T(r.hoursRaw), T(r.perYearRaw), N(r.hours), N(r.count), N(r.labor), { v: r.verdict, s: r.verdict === 'правдоподобно' ? S.OK : /нет/.test(r.verdict) ? S.TEXT : S.WARN }, T(r.why), N(r.fixed), r.sure ? 'да' : '']);
  const dr = [['Отдел', 'Процессов', 'С данными о труде', 'Правдоподобных', 'Труд/год как записано', 'Труд/год с поправкой единиц', 'Фонд штата, ч/год', 'Занятых ставок', 'Доля фонда (с поправкой)'].map(H)];
  for (const d of res.byDept) dr.push([T(d.dept), N(d.n), N(d.withData), N(d.plausible), N(d.rawLabor), N(d.fixedLabor), N(d.fund || null), N(d.rates || null), d.fund ? { v: Math.round(d.fixedLabor / d.fund * 100) / 100, s: S.NUM2 } : '']);
  dr.push([{ v: 'Итого', s: S.BOLD }, N(res.rows.length), N(res.rows.filter(r => r.labor !== null).length), N(res.summary['правдоподобно'] || 0), N(res.rawTotal), N(res.fixedTotal), '', '', '']);
  const sm = [['Вердикт', 'Процессов', 'Что это значит'].map(H)];
  const MEAN = { 'правдоподобно': 'цифры можно брать как предварительные', 'похоже на часы за год': 'в колонке «на случай» записан годовой объём — поправка: часы ÷ случаи', 'похоже на минуты': 'в колонке «часы» — минуты; поправка ÷ 60', 'минуты в реестре': 'единица указана явно', 'часы за год или минуты': 'один случай в год — уточнить у отдела', 'больше фонда отдела': 'процесс один «съедает» больше, чем весь отдел работает', 'больше трёх ставок': 'подозрительно много, штат не загружен', 'текст вместо числа': 'в числовой колонке текст («ежеквартально», «8-24»)', 'нет времени на случай': 'есть количество, нет времени', 'нет количества': 'есть время, нет количества', 'нет данных': 'в реестре пусто — анкета отдела', 'противоречие': 'подтверждённые факты расходятся — решение аналитика' };
  for (const k of order) if (res.summary[k]) sm.push([T(k), N(res.summary[k]), T(MEAN[k] || '')]);
  sm.push([]); sm.push([T('Сумма «как записано», ч/год'), N(res.rawTotal), T('если сумма в сотни раз больше фонда рабочего времени ' + (require('./profile.js').load().org.kindGen || 'ведомства') + ', в реестре перепутаны единицы (минуты, часы за год)')]); sm.push([T('Сумма с поправкой единиц, ч/год'), N(res.fixedTotal), T('после ÷ 60 для минут и «часы за год» вместо «на случай»; остаётся предварительной')]);
  fs.writeFileSync(out, buildXlsx([
    { name: 'Сводка', rows: sm, widths: [34, 12, 90] },
    { name: 'По процессам', rows, widths: [9, 30, 60, 8, 16, 14, 10, 10, 14, 22, 60, 14, 10], freeze: 1, autoFilter: `A1:M${rows.length}` },
    { name: 'По отделам', rows: dr, widths: [50, 10, 12, 12, 16, 18, 14, 10, 12], freeze: 1 },
  ]));
  return out;
}

module.exports = { check, exportXlsx, FUND };
