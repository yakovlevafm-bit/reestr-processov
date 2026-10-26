/* ================================================================
   Методика оценки, версия 1.1 (20.10.2026). Основа — v1.0 по образцу методики
   пилота v1.1 «Цифрового региона»; v1.0 сохранена в lib/method_v10.js.

   Что изменено в v1.1 и почему:
   1. Двойной счёт. Годовой труд = частота × время, поэтому «Частота» больше
      не входит в сумму (вес 0, показывается справочно).
   2. «Ручные операции» и «Повторяемость» описывают пригодность процесса
      к автоматизации, а не ценность — перенесены в реализуемость;
      «Ручные операции» там читаются наоборот: цифровой вход → 5 («Цифровой вход»).
   3. Критерии взвешены, чтобы шкалы остались 5–25 и порог 19 сохранил смысл:
      ЦЕННОСТЬ = 3 × труд + 2 × проблемность;
      РЕАЛИЗУЕМОСТЬ = (4·данные + 3·интеграции + 4·технологии + 4·MVP + 4·измеримость
                       + 3·повторяемость + 3·цифровой вход) / 5.
   4. Процесс без полных данных больше не «выпадает» из рейтинга: ранжируется по
      ожидаемому значению (середина диапазона) с долей подтверждённых критериев,
      а группа определяется по границам диапазона: если даже в лучшем случае
      ценность ниже порога — это известно и без замеров; если процесс может
      оказаться приоритетным, но данных нет — «Сначала замерить».

   Критерий считается автоматически из ПОДТВЕРЖДЁННЫХ фактов; если факта нет или
   он не подтверждён — критерий даётся диапазоном [1..5] (или предварительным
   значением из реестра, помеченным «предварительно»). Оператор может задать
   критерий вручную (с основанием). Порог высокого уровня — 19.
   ================================================================ */
'use strict';

const VERSION = '1.1';
const CRITERIA = {
  value: [
    { key: 'labor', w: 3, name: 'Годовой ручной труд', hint: 'случаи × активные чел.-часы: ≥2000 → 5, 500–1999 → 4, 100–499 → 3, 20–99 → 2, <20 → 1' },
    { key: 'problem', w: 2, name: 'Проблемность', hint: 'сроки, ошибки, жалобы, включён в план оптимизации → 4–5; жалоб нет → 1–2' },
    { key: 'freq', w: 0, name: 'Частота (справочно)', hint: 'в сумму не входит — уже учтена в годовом труде; экземпляров в год: ≥500 → 5, 100–499 → 4, 25–99 → 3, 5–24 → 2, <5 → 1' },
  ],
  feas: [
    { key: 'data', w: 4, name: 'Данные', hint: 'есть машиночитаемый источник для решения → 5; данные только на бумаге → 1' },
    { key: 'integ', w: 3, name: 'Интеграции', hint: 'внешних систем не нужно → 5; нужен API ДЕЛА/СМЭВ/ФГИС → 2' },
    { key: 'tech', w: 4, name: 'Технологии', hint: 'решается имеющимся стеком (формы, OCR, шаблоны, ИИ через «Мост») → 5' },
    { key: 'mvp', w: 4, name: 'MVP за 3 месяца', hint: 'пилот реально показать за квартал → 5' },
    { key: 'measure', w: 4, name: 'Измеримость', hint: 'есть журнал/счётчик до и после → 5; эффект не измерить → 1' },
    { key: 'repeat', w: 3, name: 'Повторяемость', hint: 'типовой сценарий (обращения по реестру, сборы данных, заявки) → 5 … индивидуальная работа → 1' },
    { key: 'manual', w: 3, name: 'Цифровой вход', hint: 'цифровой машиночитаемый → 5; частично цифровой машиночитаемый → 4; частично цифровой немашиночитаемый → 2; бумажный и немашиночитаемый → 1' },
  ],
};
const THRESHOLD = 19;

const scale = (v, steps) => { for (const [lim, s] of steps) if (v >= lim) return s; return 1; };
const freqScore = n => scale(n, [[500, 5], [100, 4], [25, 3], [5, 2]]);
const laborScore = h => scale(h, [[2000, 5], [500, 4], [100, 3], [20, 2]]);
function manualScore(format, machine, paper){
  const f = (format || '').toLowerCase(), m = (machine || '').toLowerCase(), p = (paper || '').toLowerCase();
  if (/^цифров/.test(f) && !/немашин/.test(m)) return 1;
  if (/немашин/.test(m) && (/бумаж/.test(p) || /бумаж/.test(f))) return 5;
  if (/немашин/.test(m)) return 4;
  if (/частично/.test(f)) return 2;
  return null;
}

/* Статусы фактов:
     ai         — предложение ИИ («Мост»): в оценку не попадает даже предварительно, пока человек не подтвердит
     proposed   — предложение из реестра: даёт предварительное значение (диапазон остаётся)
     verified   — подтверждено экспертом с основанием
     rejected   — отклонено; superseded — заменено новым подтверждённым значением */
const FACT_STATUS = { ai: 'предложение ИИ', proposed: 'из реестра', verified: 'подтверждено', rejected: 'отклонено', superseded: 'заменено' };
const toNum = v => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isNaN(n) ? null : n; };
const sameVal = (a, b) => { const x = toNum(a), y = toNum(b); return x !== null && y !== null ? Math.abs(x - y) <= Math.abs(y) * 0.01 + 1e-9 : String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); };

/** факты процесса: берём подтверждённые (два разных подтверждённых значения — конфликт), иначе предложенные из реестра. */
function pick(facts, name){
  const ok = facts.filter(f => f.name === name && f.status === 'verified');
  if (ok.length){
    const distinct = ok.filter((f, i) => !ok.slice(0, i).some(g => sameVal(g.value, f.value) && (g.period || '') === (f.period || '')));
    if (distinct.length > 1) return { v: distinct[distinct.length - 1].value, sure: false, conflict: distinct.map(f => `${f.value} ${f.unit || ''} (${f.period || 'период не указан'}, ${f.by || f.role || '?'})`) };
    return { v: ok[ok.length - 1].value, sure: true };
  }
  const pr = facts.filter(f => f.name === name && f.status === 'proposed'); if (pr.length) return { v: pr[pr.length - 1].value, sure: false };
  return null;
}

/* Стоп-факторы (блокеры) — отмечает оператор в карточке; любой отмеченный переводит процесс в группу «блокеры» */
const BLOCKERS = {
  owner: 'нет владельца процесса или доступного эксперта',
  data: 'критические данные недоступны или их нет в машиночитаемом виде',
  legal: 'правовой или ИБ-запрет на использование данных',
  integ: 'критическая интеграция (ДЕЛО, ФГИС, СМЭВ) невозможна',
  measure: 'эффект нельзя измерить — нет журнала или счётчика',
};
/* Группы приоритета — порядок показа */
const GROUPS = [
  ['candidates', 'Приоритетные кандидаты', 'оба показателя подтверждены и не ниже порога'],
  ['likely', 'Вероятные кандидаты — подтвердить', 'данных не хватает, но по ожидаемым значениям (середина диапазона) оба показателя не ниже порога — нужно подтвердить факты'],
  ['measure_first', 'Сначала замерить', 'в лучшем случае процесс приоритетный, в худшем — нет; решает замер (количество, время, проблемность)'],
  ['quick_wins', 'Быстрый результат', 'реализуемость высокая, ценность ниже порога — небольшие улучшения без проекта'],
  ['constraints', 'Сначала снять ограничения', 'ценность высокая, реализуемость ниже порога — нужны данные, интеграция или решение'],
  ['blocked', 'Есть блокеры', 'отмечен стоп-фактор — до его снятия не ранжируется'],
  ['conflict', 'Противоречие источников', 'подтверждённые факты расходятся — нужно решение аналитика'],
  ['needs_data', 'Недостаточно подтверждённых данных', 'диапазон слишком широк, чтобы отнести к группе'],
  ['low', 'Низкий приоритет', 'ценность ниже порога даже при лучших значениях неподтверждённых критериев'],
];

/**
 * assess(process, facts, rule, manual) → { value:{min,max,items}, feas:{min,max,items}, complete, quadrant }
 * items[key] = { score|null, min, max, basis, sure, manual }
 */
function assess(p, facts, rule, manual = {}, card = {}){
  const items = {}; const conflicts = [];
  const put = (key, score, basis, sure) => { items[key] = score === null || score === undefined ? { score: null, min: 1, max: 5, basis, sure: false } : { score, min: score, max: score, basis, sure: !!sure }; };
  const conf = (key, f, label) => { if (f && f.conflict){ conflicts.push({ key, fact: label, values: f.conflict }); items[key] = { score: null, min: 1, max: 5, basis: 'конфликт подтверждённых значений: ' + f.conflict.join(' · '), sure: false, conflict: true }; return true; } return false; };
  // ценность
  const cnt = pick(facts, 'count'), hrs = pick(facts, 'hours');
  put('freq', cnt ? freqScore(toNum(cnt.v)) : null, cnt ? `${cnt.v} в год${cnt.sure ? '' : ' (предварительно)'}` : 'нет факта «количество в год»', cnt && cnt.sure);
  conf('freq', cnt, 'количество в год');
  const labor = cnt && hrs && toNum(cnt.v) !== null && toNum(hrs.v) !== null ? toNum(cnt.v) * toNum(hrs.v) : null;
  put('labor', labor !== null ? laborScore(labor) : null, labor !== null ? `${Math.round(labor).toLocaleString('ru')} чел.-ч/год${cnt.sure && hrs.sure ? '' : ' (предварительно)'}` : 'нет фактов «количество» и «время на случай»', cnt && hrs && cnt.sure && hrs.sure);
  // прямой годовой объём труда (если подтверждён) должен сходиться со «случаи × часы» (допуск 1 %) — иначе противоречие
  const annual = pick(facts, 'annual');
  if (annual && annual.sure){
    const a = toNum(annual.v);
    if (labor !== null && cnt.sure && hrs.sure && a !== null && Math.abs(a - labor) > Math.max(1, labor * 0.01)){ conflicts.push({ key: 'labor', fact: 'годовой труд', values: [`прямо: ${a} чел.-ч/год`, `случаи × часы: ${Math.round(labor)}`] }); items.labor = { score: null, min: 1, max: 5, basis: `противоречие: подтверждённый годовой труд ${a}, а случаи × часы = ${Math.round(labor)}`, sure: false, conflict: true }; }
    else if (a !== null && (labor === null || !(cnt.sure && hrs.sure))) put('labor', laborScore(a), `${Math.round(a).toLocaleString('ru')} чел.-ч/год (подтверждённый годовой объём)`, true);
  }
  conf('labor', hrs, 'время на случай') || conf('labor', annual, 'годовой труд');
  const fmt = pick(facts, 'format'), mach = pick(facts, 'machine'), pap = pick(facts, 'paper');
  const ms = manualScore(fmt && fmt.v, mach && mach.v, pap && pap.v);
  // v1.1: «Цифровой вход» — обратная шкала к прежним «Ручным операциям» (бумага → 1, цифра → 5)
  put('manual', ms === null ? null : 6 - ms, [fmt && fmt.v, mach && mach.v, pap && pap.v].filter(Boolean).join(', ') || 'нет фактов о формате', fmt && fmt.sure && mach && mach.sure);
  put('repeat', rule.repeat, 'по типу процесса: ' + rule.type, false);
  const prob = pick(facts, 'problem');
  put('problem', prob ? Math.max(1, Math.min(5, toNum(prob.v) || 3)) : null, prob ? String(prob.v) + (prob.sure ? '' : ' (предварительно)') : 'нет факта о проблемности (сроки, ошибки, жалобы)', prob && prob.sure);
  conf('problem', prob, 'проблемность'); conf('manual', fmt, 'формат'); conf('manual', mach, 'машиночитаемость');
  // реализуемость — по типу процесса, предварительно; уточняется оператором
  for (const k of ['data', 'integ', 'tech', 'mvp', 'measure']) put(k, rule.feas[k], 'по типу процесса: ' + rule.type + ' — уточнить', false);
  if (items.measure.score !== null && cnt && hrs && cnt.sure && hrs.sure) put('measure', Math.max(items.measure.score, 4), 'есть подтверждённые количество и время', true);
  // ручные переопределения
  for (const [k, m] of Object.entries(manual || {})){ if (m && m.score) items[k] = { score: +m.score, min: +m.score, max: +m.score, basis: 'вручную: ' + (m.basis || ''), sure: true, manual: true }; }
  // v1.1: взвешенная сумма, приведённая к шкале 5–25 (Σw = 5 для ценности, 25 для реализуемости → делим на Σw/5)
  const r1 = v => Math.round(v * 10) / 10;
  const sum = list => { const W = list.reduce((s, c) => s + c.w, 0) / 5; const a = list.reduce((a, c) => ({ min: a.min + c.w * items[c.key].min, max: a.max + c.w * items[c.key].max }), { min: 0, max: 0 }); return { min: r1(a.min / W), max: r1(a.max / W) }; };
  const value = sum(CRITERIA.value.filter(c => c.w)), feas = sum(CRITERIA.feas);
  const weighted = [...CRITERIA.value, ...CRITERIA.feas].filter(c => c.w);
  const complete = weighted.every(c => items[c.key].sure);
  const wAll = weighted.reduce((s, c) => s + c.w, 0);
  const confidence = Math.round(weighted.filter(c => items[c.key].sure).reduce((s, c) => s + c.w, 0) / wAll * 100); // доля подтверждённого веса, %
  const mid = r => (r.min + r.max) / 2;
  value.exp = r1(mid(value)); feas.exp = r1(mid(feas));
  const quadrant = value.min === value.max && feas.min === feas.max
    ? (value.min >= THRESHOLD ? (feas.min >= THRESHOLD ? 'Приоритет' : 'Сначала снять ограничения') : (feas.min >= THRESHOLD ? 'Быстрый эффект' : 'Низкий приоритет'))
    : (mid(value) >= THRESHOLD ? (mid(feas) >= THRESHOLD ? 'предварительно: Приоритет' : 'предварительно: снять ограничения') : (mid(feas) >= THRESHOLD ? 'предварительно: быстрый эффект' : 'предварительно: низкий'));
  // группа приоритета с объяснением — отсутствие данных не означает низкий приоритет
  const blockers = (card.blockers || []).filter(k => BLOCKERS[k]);
  const known = Object.values(items).filter(i => i.sure).length, total = Object.keys(items).length;
  let group, reason;
  if (blockers.length){ group = 'blocked'; reason = 'Требуют решения: ' + blockers.map(k => BLOCKERS[k]).join('; ') + (card.blockersNote ? ' — ' + card.blockersNote : ''); }
  else if (conflicts.length){ group = 'conflict'; reason = 'Расходятся подтверждённые значения: ' + conflicts.map(c => c.fact + ' (' + c.values.join(' / ') + ')').join('; '); }
  else if (!complete){
    // v1.1: неполные данные — группа по ожидаемым значениям и границам диапазона
    const T = THRESHOLD, nm = k => (CRITERIA.value.find(c => c.key === k) || CRITERIA.feas.find(c => c.key === k)).name;
    const miss = weighted.filter(c => !items[c.key].sure).map(c => nm(c.key));
    const d = v => String(v).replace('.', ','); const rng = r => r.min === r.max ? d(r.min) : `${d(r.min)}–${d(r.max)} (ожидаемо ${d(r.exp)})`;
    const tail = ` Ценность ${rng(value)}, реализуемость ${rng(feas)}; подтверждено ${confidence} % веса критериев. Не хватает: ${miss.join(', ')}.`;
    if (value.max < T){ group = feas.exp >= T ? 'quick_wins' : 'low'; reason = `Ценность не выше ${value.max} даже при лучших значениях — ниже порога ${T}.` + tail; }
    else if (value.exp >= T){ group = feas.exp >= T ? 'likely' : 'constraints'; reason = (group === 'likely' ? 'По ожидаемым значениям оба показателя не ниже порога — подтвердить факты.' : 'Ценность по ожидаемым значениям высокая, реализуемость ниже порога.') + tail; }
    else if (feas.exp >= T){ group = 'measure_first'; reason = `Ценность может оказаться от ${value.min} до ${value.max} — решает замер.` + tail; }
    else { group = 'needs_data'; reason = `Подтверждено критериев: ${known} из ${total}.` + tail; }
  }
  else { const hv = value.min >= THRESHOLD, hf = feas.min >= THRESHOLD; group = hv ? (hf ? 'candidates' : 'constraints') : (hf ? 'quick_wins' : 'low'); reason = `Ценность ${value.min}/25, реализуемость ${feas.min}/25; порог высокого уровня — ${THRESHOLD}.` + (group === 'constraints' ? ' Поднять реализуемость: ' + CRITERIA.feas.filter(c => items[c.key].score <= 3).map(c => c.name + ' ' + items[c.key].score).join(', ') + '.' : ''); }
  return { version: VERSION, value: { ...value, items: CRITERIA.value.map(c => c.key) }, feas: { ...feas, items: CRITERIA.feas.map(c => c.key) }, items, complete, confidence, quadrant, threshold: THRESHOLD, labor, conflicts, group, reason, blockers };
}

module.exports = { VERSION, CRITERIA, THRESHOLD, assess, FACT_STATUS, BLOCKERS, GROUPS, toNum };
