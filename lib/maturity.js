/* ================================================================
   Модель доказательств (единая схема отбора, этап 1 — 25.10.2026).
   Источник: Methodology v2.0 (SCORING_ENGINE_SPEC_V2_DRAFT) и отзыв на неё.

   Уровень зрелости оценки вычисляется, а не назначается:
     PRE       — допустимы любые оценки, в том числе по типу процесса (C);
                 годится для отбора и короткого списка, не для решения о проекте;
     INTERVIEW — все критерии оси на уровне A или B: факты реестра и анкет,
                 ручные оценки с основанием; годится для гипотез и предварительного решения;
     VERIFIED  — все критерии оси на уровне A (подтверждённые факты с источником),
                 нет влияющих конфликтов; годится для решения о проекте и базовой линии.
   Ручная оценка (card.v2[key]) — суждение человека с основанием, а не факт: для уровня
   зрелости считается B, хотя в расчёте доверия пока остаётся A (вопрос к руководству).
   Для неполной оси показываются известная часть суммы, покрытие (доля веса критериев)
   и диапазон при худших/лучших значениях неизвестных критериев.
   Конфликт — два разных подтверждённых значения одного факта, либо ответ анкеты,
   расходящийся с подтверждённым значением и не разобранный; конфликт «влияет»,
   если факт участвует в критерии оси.
   Ограничения: одна причина → один критерий-владелец (card.constraints: [{text, crit, hyp?, by, at}]; hyp — индекс гипотезы,
   если ограничение относится к её реализуемости F1–F5, см. lib/hypothesis.js);
   юридический запрет относится к одному критерию и не превращается в «нет данных» в другом.
   Блокеры — отдельно от баллов (card.blockers + card.blockerBasis): низкий балл ещё не блокер,
   блокер — только доказанная невозможность с основанием.
   ================================================================ */
'use strict';
const { toNum } = require('./method.js');

const LEVELS = ['PRE', 'INTERVIEW', 'VERIFIED'];
const LEVEL = {
  PRE: { ok: 'ABC', name: 'предварительная', hint: 'оценки по типу процесса допустимы — для отбора и короткого списка' },
  INTERVIEW: { ok: 'AB', name: 'по данным отдела', hint: 'реестр, анкета, ручные оценки с основанием — для гипотез и предварительного решения' },
  VERIFIED: { ok: 'A', name: 'подтверждённая', hint: 'только подтверждённые факты с источником, без влияющих конфликтов — для решения о проекте' },
};
// какие критерии v2 зависят от какого факта (для «влияющих» конфликтов)
const FACT_CRIT = { count: ['own', 'ext'], hours: ['own'], annual: ['own'], problem: ['risk'], term: ['urg'], format: ['struct'], machine: ['struct'], paper: ['struct'] };
const sameVal = (a, b) => { const x = toNum(a), y = toNum(b); return x !== null && y !== null ? Math.abs(x - y) <= Math.abs(y) * 0.01 + 1e-9 : String(a).trim().toLowerCase() === String(b).trim().toLowerCase(); };
const r2 = v => Math.round(v * 100) / 100;

/** Уровень доказательности критерия для зрелости: ручная оценка — суждение, не факт → B. */
const evOf = e => e.manual ? (e.ev === 'A' ? 'B' : e.ev) : e.ev;

/** Ось: items — {key: est}, criteria — [{key, w?, name}], unit(scores) — число оси из полного набора оценок.
    Для каждого уровня: покрытие по весу, известная часть (неизвестные = 0, только для взвешенной суммы), диапазон, чего не хватает. */
function axis(items, criteria, unit, { weighted = true } = {}){
  const W = criteria.reduce((s, c) => s + (weighted ? c.w : 1), 0);
  const out = {};
  for (const L of LEVELS){
    const known = criteria.filter(c => LEVEL[L].ok.includes(evOf(items[c.key])));
    const miss = criteria.filter(c => !known.includes(c));
    const fill = v => Object.fromEntries(criteria.map(c => [c.key, known.includes(c) ? items[c.key].mode : v]));
    out[L] = {
      coverage: r2(known.reduce((s, c) => s + (weighted ? c.w : 1), 0) / W),
      part: weighted && miss.length ? r2(unit(fill(0))) : null,
      min: r2(unit(fill(1))), max: r2(unit(fill(5))),
      missing: miss.map(c => ({ key: c.key, name: c.name, ev: evOf(items[c.key]), basis: items[c.key].basis })),
    };
  }
  return out;
}

/** Конфликты фактов процесса: [{name, kind: 'verified' | 'pending', values, crits}].
    card.conflicts — расхождения анкеты с подтверждённым значением, записанные загрузчиком (lib/anketa2.js);
    снимаются, когда подтверждённое значение совпало с ответом анкеты или запись удалена из карточки. */
function conflicts(facts, card = {}){
  const out = [], names = [...new Set(facts.map(f => f.name))];
  for (const pc of card.conflicts || []){
    if (facts.some(f => f.name === pc.name && f.status === 'verified' && sameVal(f.value, pc.value))) continue;
    out.push({ name: pc.name, kind: 'pending', values: [`${pc.verified} (подтверждено${pc.verifiedBy ? ', ' + pc.verifiedBy : ''})`, `${pc.value} (анкета${pc.src ? ': ' + pc.src : ''})`], crits: FACT_CRIT[pc.name] || [] });
  }
  for (const name of names){
    const ok = facts.filter(f => f.name === name && f.status === 'verified');
    const distinct = ok.filter((f, i) => !ok.slice(0, i).some(g => sameVal(g.value, f.value) && (g.period || '') === (f.period || '')));
    if (distinct.length > 1) out.push({ name, kind: 'verified', values: distinct.map(f => `${f.value} (${f.period || 'период не указан'}, ${f.by || f.role || '?'})`), crits: FACT_CRIT[name] || [] });
    else if (ok.length && !out.some(c => c.name === name)){
      // ответ анкеты, расходящийся с подтверждённым значением — расхождение, ждёт решения
      const last = ok[ok.length - 1];
      const pend = facts.filter(f => f.name === name && f.status === 'proposed' && /анкет/i.test(f.source || '') && !sameVal(f.value, last.value));
      if (pend.length) out.push({ name, kind: 'pending', values: [`${last.value} (подтверждено, ${last.by || '?'})`, ...pend.map(f => `${f.value} (анкета)`)], crits: FACT_CRIT[name] || [] });
    }
  }
  return out;
}

/** Достигнутый уровень оси: высший, где покрытие полное и нет влияющих конфликтов (PRE достижим всегда). */
function maturity(ax, conf, keys){
  const hit = conf.filter(c => c.crits.some(k => keys.includes(k)));
  let level = 'PRE';
  for (const L of LEVELS.slice(1)) if (ax[L].coverage >= 1 && !hit.length) level = L; else break;
  return { level, conflicts: hit };
}

/** Ограничения карточки, нормализованные: одна причина — один критерий-владелец. */
function constraints(card, targets){
  const T = Object.fromEntries(targets.map(t => [t.key, t.name]));
  return (card.constraints || []).filter(c => c && c.text).map((c, i) => ({ i, text: c.text, crit: T[c.crit] ? c.crit : 'readiness', critName: T[T[c.crit] ? c.crit : 'readiness'], hyp: c.hyp === undefined || c.hyp === null ? '' : String(c.hyp), by: c.by || '', at: c.at || '' }));
}
/** Блокеры с основанием; старая общая заметка blockersNote — основание для всех отмеченных. */
function blockers(card, BLOCKERS){
  const b = card.blockerBasis || {};
  return (card.blockers || []).filter(k => BLOCKERS[k]).map(k => ({ key: k, name: BLOCKERS[k], basis: b[k] || card.blockersNote || '', proven: !!(b[k] || card.blockersNote) }));
}
/** Куда может относиться ограничение: критерии ценности и пригодности, размер, готовность проекта. */
const targets = CRITERIA => [...CRITERIA.value, ...CRITERIA.fit].map(c => ({ key: c.key, name: c.name })).concat({ key: 'size', name: 'Размер работы Р' }, { key: 'readiness', name: 'Готовность проекта (не критерий)' });

/** Полная модель доказательств процесса для v2: оси ценности (В) и пригодности (К), размер, конфликты. */
function assess({ value, fit, P, facts, card = {}, CRITERIA }){
  const vAx = axis(value, CRITERIA.value, s => CRITERIA.value.reduce((a, c) => a + c.w * s[c.key], 0) / 5);
  const fAx = axis(fit, CRITERIA.fit, s => Math.max(0.1, CRITERIA.fit.reduce((a, c) => a + s[c.key], 0) / CRITERIA.fit.length / 5), { weighted: false });
  const conf = conflicts(facts, card);
  const v = maturity(vAx, conf, CRITERIA.value.map(c => c.key)), f = maturity(fAx, conf, CRITERIA.fit.map(c => c.key));
  const sizeLv = evOf(P) === 'A' ? 'VERIFIED' : evOf(P) === 'B' ? 'INTERVIEW' : 'PRE';
  const level = LEVELS[Math.min(LEVELS.indexOf(v.level), LEVELS.indexOf(f.level))];
  return { value: { ...vAx, level: v.level }, fit: { ...fAx, level: f.level }, size: { level: sizeLv, ev: P.ev, manual: !!P.manual }, conflicts: conf, level };
}

module.exports = { LEVELS, LEVEL, FACT_CRIT, evOf, axis, conflicts, maturity, constraints, blockers, targets, assess };
