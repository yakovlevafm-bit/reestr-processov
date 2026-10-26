/* ================================================================
   Методика оценки v2 (ПРОЕКТ, 20.10.2026) — считается параллельно с v1.1,
   рабочей не является до согласования весов руководством.

   ИП = В × К / Р
     В — ценность 20–100: 6 критериев 1–5 с весами (Σ = 100), В = Σ wᵢ·sᵢ / 5;
     К — пригодность к автоматизации 0,1–1 (структура и цифровой вход, работа по
         правилам, стабильность процесса);
     Р — размер работы по шкале 1-2-3-5-8-13 (как в WSJF).
   Ценность и пригодность перемножаются: нечего автоматизировать — нет эффекта;
   стоимость решения — в знаменателе.

   Каждый критерий — три оценки (минимум / вероятное / максимум) и уровень
   доказательности: A — подтверждённый факт (ДЕЛО, хронометраж, журнал),
   B — данные реестра или анкеты, C — оценка по типу процесса.
   Ожидаемое значение — PERT: (min + 4·вер + max) / 6. Доверие Д = 1 / 0,8 / 0,5
   по уровням A/B/C, взвешенное по весам критериев (как confidence в RICE).

   Гейты (стоп-факторы) в сумму не входят; «светофор» РЦК — шаг 0:
   зелёный — процесс не оптимизируем; красный — сначала устранить/передать.
   Источники подходов: WSJF (SAFe), RICE, UiPath Automation Hub, Standard Cost
   Model (ОЭСР), TDABC, «Эффективный регион», методичка РЦК ЛО (2025).
   ================================================================ */
'use strict';
const { toNum } = require('./method.js');
const EV = require('./maturity.js'); // модель доказательств: уровни зрелости PRE → INTERVIEW → VERIFIED, конфликты, покрытие осей

const VERSION = '2.1-проект'; // 2.1: модель доказательств (единая схема, 25.10.2026)
const PRF = require('./profile.js').load(); // отраслевые подсказки и признаки стартовых оценок — из профиля
const pv = (PRF.method && PRF.method.v2) || {}, rxo = (o, d) => o ? new RegExp(o.re, o.flags || '') : d;
const V2P = { // общие значения по умолчанию — для профиля без отраслевых настроек
  extClient: rxo(pv.externalClient, /ФЛ|ЮЛ|ИП|юрид|физ|граждан|организац|предпринимат|заинтерес|округ|МО\b|администрац/i),
  seasonal: rxo(pv.seasonal, /сезон|ежедневн|оперативн|паводк|ЧС/i),
  collectTypes: pv.collectTypes || ['collect'], collectBasis: pv.collectBasis || 'сбор данных с внешних участников: они заполняют формы',
  riskTypes: pv.riskTypes || ['appeal', 'control', 'subsidy'], riskBasis: pv.riskBasis || 'обращения/контроль/субсидии — законные сроки и риск обжалования',
  goalByCode: (pv.goalByCode || [{ re: '^ВП', mode: 1, min: 1, max: 2, basis: 'вспомогательный процесс' }]).map(x => ({ ...x, re: new RegExp(x.re) })),
};
const CONF = { A: 1, B: 0.8, C: 0.5 };
const FIB = [1, 2, 3, 5, 8, 13];
const FIB_PM = { 1: 0.5, 2: 1, 3: 2, 5: 4, 8: 8, 13: 12 }; // размер → чел.-мес.
const DEFAULTS = { rate: 590, capacityPM: 24, fund: 1600 }; // ₽/ч (условно — уточнить ФОТ), мощность команды чел.-мес./год, практический фонд ч/год

const CRITERIA = {
  value: [
    { key: 'own', w: 25, name: 'Свой ручной труд, ч/год', hint: 'случаи × часы: <50 → 1, 50–199 → 2, 200–499 → 3, 500–1499 → 4, ≥1500 → 5' },
    { key: 'ext', w: 15, name: 'Внешняя нагрузка', hint: 'заявители, округа, организации: число обращений/подач в год <10 → 1, 10–49 → 2, 50–199 → 3, 200–999 → 4, ≥1000 → 5; сбор данных с МО и организаций — 3–5' },
    { key: 'goal', w: 20, name: 'Связь с целями', hint: (PRF.method && PRF.method.v2 && PRF.method.v2.hints && PRF.method.v2.hints.goal) || '1 нет; 2 косвенная; 3 отраслевой показатель или рейтинг; 4 госпрограмма или КПЭ ведомства; 5 национальные цели / оценка губернатора' },
    { key: 'risk', w: 15, name: 'Качество и правовой риск', hint: 'просрочки, переделки, жалобы, предписания, суды: нет → 1 … системно → 5' },
    { key: 'urg', w: 10, name: 'Срочность и сезонность', hint: '1 нет; 3 сезонный пик ×2; 5 пик ×5 или жёсткий срок по НПА' },
    { key: 'span', w: 15, name: 'Сквозной охват и тиражируемость', hint: 'одно подразделение → 1 … ≥3 ОИВ или все округа, либо решение тиражируется на ≥5 процессов → 5' },
  ],
  fit: [
    { key: 'struct', name: 'Структурированный цифровой вход', hint: 'бумага/скан → 1 … машиночитаемый файл или форма → 5' },
    { key: 'rules', name: 'Работа по правилам', hint: 'экспертное суждение → 1 … типовой сценарий по правилам → 5' },
    { key: 'stable', name: 'Стабильность процесса и НПА на 12 мес.', hint: 'меняется → 1 … стабилен → 5' },
  ],
};
const GATES = {
  owner: 'есть владелец процесса',
  legal: 'процесс правомерен, его можно менять',
  data: 'нужные данные существуют',
  security: 'ИБ: 152-ФЗ, требования ФСТЭК к ГИС',
  baseline: 'есть базовая линия для измерения эффекта',
};
const LIGHT = { red: 'красный — сначала устранить или передать функцию', yellow: 'жёлтый — сначала бережливая оптимизация, потом автоматизация', green: 'зелёный — процесс в норме, не оптимизируем' };

const scale = (v, steps) => { for (const [lim, s] of steps) if (v >= lim) return s; return 1; };
const pert = (a, m, b) => (a + 4 * m + b) / 6;
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
// src — id фактов, из которых получена оценка (прослеживаемость: балл → факт → источник → правило в hint критерия)
const est = (mode, min, max, ev, basis, src = []) => ({ min: Math.min(min, mode), mode, max: Math.max(max, mode), ev, basis, src: src.filter(Boolean) });
const pick = (facts, name) => { const ok = facts.filter(f => f.name === name && f.status === 'verified'); if (ok.length) return { v: toNum(ok[ok.length - 1].value), ev: 'A', id: ok[ok.length - 1].id }; const pr = facts.filter(f => f.name === name && f.status === 'proposed'); return pr.length ? { v: toNum(pr[pr.length - 1].value), ev: 'B', id: pr[pr.length - 1].id } : null; };
// ручная оценка — суждение человека с основанием: в расчёте доверия A, для уровня зрелости (lib/maturity.js) — B
const manual = (s, basis) => ({ ...est(s, s, s, 'A', 'вручную: ' + (basis || '')), manual: true });
const worse = (a, b) => (a === 'C' || b === 'C') ? 'C' : (a === 'B' || b === 'B') ? 'B' : 'A';

function assessV2(p, facts, rule, card = {}, cfg = {}){
  const C = { ...DEFAULTS, ...cfg }; const over = card.v2 || {}; const it = {};
  const cnt = pick(facts, 'count'), hrs = pick(facts, 'hours');
  const n = cnt && cnt.v !== null ? cnt.v : null, t = hrs && hrs.v !== null ? hrs.v : null;
  const hours = n !== null && t !== null ? n * t : null;
  // проверка единиц: > 100 ч на случай или > 2 ставок (2 × практический фонд) на один процесс — вероятно, ошибка единиц в реестре
  const suspect = hours !== null && (t > 100 || hours > 2 * C.fund) && worse(cnt.ev, hrs.ev) !== 'A';
  const ownS = h => scale(h, [[1500, 5], [500, 4], [200, 3], [50, 2]]);
  // V1 свой труд
  it.own = suspect ? est(3, 1, 5, 'C', `по реестру ${Math.round(hours).toLocaleString('ru')} ч/год (${n} × ${t} ч) — сомнительные единицы, проверить`)
    : hours !== null ? (() => { const s = ownS(hours), ev = worse(cnt.ev, hrs.ev); const src = [cnt.id, hrs.id]; return ev === 'A' ? est(s, s, s, 'A', `${Math.round(hours)} ч/год (подтверждено)`, src) : est(s, Math.max(1, s - 1), Math.min(5, s + 1), 'B', `${Math.round(hours)} ч/год по реестру — уточнить хронометражем`, src); })() : est(3, 1, 5, 'C', 'нет количества или времени на случай');
  // V2 внешняя нагрузка (SCM: число внешних взаимодействий)
  const extClient = V2P.extClient.test(p.client || '');
  it.ext = V2P.collectTypes.includes(rule.key) ? est(4, 3, 5, 'C', V2P.collectBasis)
    : extClient && n !== null ? (() => { const s = scale(n, [[1000, 5], [200, 4], [50, 3], [10, 2]]); return est(s, Math.max(1, s - 1), s, cnt.ev, `${n} обращений/подач в год от внешних заявителей (${p.client.slice(0, 40)})`, [cnt.id]); })()
    : extClient ? est(3, 2, 5, 'C', 'внешние заявители, количество не известно')
    : est(1, 1, 2, 'C', `клиент внутренний или федеральный: ${(p.client || '—').slice(0, 40)}`);
  // V3 связь с целями — по коду раздела реестра, до решения руководства
  const code = p.code || '';
  const g = V2P.goalByCode.find(x => x.re.test(code));
  it.goal = g ? est(g.mode, g.min, g.max, 'C', g.basis) : est(2, 1, 4, 'C', 'связь с целями не определена');
  // V4 качество и правовой риск
  const prob = pick(facts, 'problem');
  it.risk = prob && prob.v !== null ? est(Math.max(1, Math.min(5, prob.v)), Math.max(1, Math.min(5, prob.v)) - (prob.ev === 'A' ? 0 : 1), Math.min(5, prob.v + (prob.ev === 'A' ? 0 : 1)), prob.ev, 'факт о проблемности', [prob.id])
    : V2P.riskTypes.includes(rule.key) ? est(3, 2, 5, 'C', V2P.riskBasis)
    : est(2, 1, 4, 'C', 'нет данных о просрочках, ошибках, жалобах');
  // V5 срочность и сезонность
  it.urg = V2P.seasonal.test(p.name) ? est(4, 3, 5, 'C', 'сезонный или оперативный процесс')
    : pick(facts, 'term') ? est(3, 2, 5, 'B', 'есть срок по НПА', [pick(facts, 'term').id]) : est(2, 1, 4, 'C', 'сезонность не указана');
  // V6 сквозной охват и тиражируемость
  const rep = rule.repeat || 3;
  it.span = /^сквозн/i.test(p.cross || '') ? est(Math.min(5, 3 + (rep >= 5 ? 1 : 0)), 3, 5, 'B', 'сквозной процесс' + (rep >= 5 ? ', типовой — решение тиражируется' : ''))
    : /несквозн/i.test(p.cross || '') ? est(rep >= 5 ? 3 : 2, 1, rep >= 5 ? 4 : 3, 'B', 'несквозной' + (rep >= 5 ? ', но типовой — решение тиражируется' : ''))
    : est(3, 1, 5, 'C', 'не указано');
  // ручные оценки (card.v2[key] = { score, basis }) — уровень A
  for (const c of CRITERIA.value) if (over[c.key] && over[c.key].score) it[c.key] = manual(+over[c.key].score, over[c.key].basis);

  const V = k => CRITERIA.value.reduce((s, c) => s + c.w * it[c.key][k], 0) / 5;
  const B = { min: r1(V('min')), mode: r1(V('mode')), max: r1(V('max')) }; B.exp = r1(pert(B.min, B.mode, B.max));

  // К — пригодность: 1–5 → 0,2–1 (не ниже 0,1)
  // формат входа — строковые факты (подтверждённый, иначе из реестра)
  const pickF = name => { const ok = facts.filter(x => x.name === name && x.status === 'verified'); const pr = facts.filter(x => x.name === name && x.status === 'proposed'); return ok[ok.length - 1] || pr[pr.length - 1] || null; };
  const fmtF = ['format', 'machine', 'paper'].map(pickF).filter(Boolean), fmtSrc = fmtF.map(x => x.id), fmtEv = fmtF.length && fmtF.every(x => x.status === 'verified') ? 'A' : 'B';
  const rawFmt = fmtF.map(x => String(x.value || '')).join(' ').toLowerCase();
  const fi = {};
  fi.struct = /бумаж|скан/.test(rawFmt) ? est(1, 1, 2, fmtEv, 'бумажный вход или скан', fmtSrc) : /немашин/.test(rawFmt) ? est(2, 2, 3, fmtEv, 'немашиночитаемый', fmtSrc) : /цифров/.test(rawFmt) ? est(4, 3, 5, fmtEv, 'цифровой вход', fmtSrc) : est(3, 1, 5, 'C', 'формат входа не указан');
  fi.rules = est(rep, Math.max(1, rep - 1), Math.min(5, rep + 1), 'C', `типовость по типу процесса «${rule.type}»`);
  fi.stable = est(4, 3, 5, 'C', 'изменений НПА не ожидается — уточнить у владельца');
  for (const c of CRITERIA.fit) if (over[c.key] && over[c.key].score) fi[c.key] = manual(+over[c.key].score, over[c.key].basis);
  const Kof = k => Math.max(0.1, CRITERIA.fit.reduce((s, c) => s + fi[c.key][k], 0) / CRITERIA.fit.length / 5);
  const K = { min: r2(Kof('min')), mode: r2(Kof('mode')), max: r2(Kof('max')) }; K.exp = r2(pert(K.min, K.mode, K.max));

  // Р — размер работы по реализуемости типа процесса (уточняет исполнитель с ИТ)
  const f = rule.feas || {};
  let size = f.integ !== null && f.integ !== undefined && f.integ <= 2 ? 8 : f.mvp >= 5 ? 2 : f.mvp === 4 ? 3 : f.mvp === 3 ? 5 : f.mvp ? 8 : 5;
  let P, pBasis = f.mvp ? `по типу «${rule.type}»: MVP ${f.mvp}, интеграции ${f.integ}` : 'тип процесса не определён';
  if (over.size && FIB.includes(+over.size.score)) { size = +over.size.score; P = { min: size, mode: size, max: size, ev: 'A', manual: true }; pBasis = 'вручную: ' + (over.size.basis || ''); }
  else { const i = FIB.indexOf(size); P = { min: FIB[Math.max(0, i - 1)], mode: size, max: FIB[Math.min(FIB.length - 1, i + 1)], ev: 'C' }; }
  P.exp = r1(pert(P.min, P.mode, P.max)); P.basis = pBasis;

  // ИП и доверие
  const IP = { min: r1(B.min * K.min / P.max), mode: r1(B.mode * K.mode / P.mode), max: r1(B.max * K.max / P.min) }; IP.exp = r1(pert(IP.min, IP.mode, IP.max));
  const conf = r2(CRITERIA.value.reduce((s, c) => s + c.w * CONF[it[c.key].ev], 0) / 100);
  const score = r1(IP.exp * conf);
  // эффект: часы × К × ставка (TDABC: ставка от практического фонда)
  const effect = hours !== null && !suspect ? { rub: Math.round(hours * K.exp * C.rate / 1000) * 1000, hours: Math.round(hours * K.exp) } : null;
  // гейты и светофор
  const gatesFailed = Object.keys(GATES).filter(g => (card.gates || {})[g] === false);
  const v1Blockers = { owner: 'owner', legal: 'legal', data: 'data', measure: 'baseline' };
  for (const b of card.blockers || []) if (v1Blockers[b] && !gatesFailed.includes(v1Blockers[b])) gatesFailed.push(v1Blockers[b]);
  const light = card.light || null;
  const method = light === 'red' ? 'устранить или передать' : light === 'green' ? '—' : (K.mode >= 0.7 ? 'автоматизировать по правилам' : K.mode >= 0.5 ? 'упростить, затем автоматизировать' : 'упростить (бережливая оптимизация)');
  const evidence = EV.assess({ value: it, fit: fi, P, facts, card, CRITERIA });
  return { version: VERSION, items: it, fit: fi, B, K, P, IP, conf, score, effect, hours, suspect, gatesFailed, light, method, pm: FIB_PM[P.mode], evidence };
}

/** Портфель: ранжирование по score, линия отсечения по мощности команды, правило ценности информации. */
function portfolioV2(list, cfg = {}){
  const C = { ...DEFAULTS, ...cfg };
  const live = list.filter(x => x.v2.light !== 'green');
  const byScore = [...live].sort((a, b) => b.v2.score - a.v2.score || b.v2.IP.exp - a.v2.IP.exp);
  const rankOf = key => { const s = [...live].sort((a, b) => b.v2.IP[key] - a.v2.IP[key]); return Object.fromEntries(s.map((x, i) => [x.p.id, i + 1])); };
  const rMax = rankOf('max'), rMin = rankOf('min');
  let used = 0;
  byScore.forEach((x, i) => {
    const v = x.v2; v.rank = i + 1;
    if (v.gatesFailed.length) { v.decision = 'gate'; v.why = 'не пройден гейт: ' + v.gatesFailed.map(g => GATES[g]).join('; '); return; }
    if (rMax[x.p.id] <= 30 && rMin[x.p.id] > 30) { v.decision = 'measure'; v.why = `по максимуму — место ${rMax[x.p.id]}, по минимуму — ${rMin[x.p.id]}: сначала 5–10 замеров`; return; }
    if (used + v.pm <= C.capacityPM) { used += v.pm; v.decision = 'plan'; v.why = `в плане: ${v.pm} чел.-мес., всего занято ${used} из ${C.capacityPM}`; }
    else { v.decision = 'below'; v.why = `ниже линии мощности команды (${C.capacityPM} чел.-мес./год)`; }
  });
  list.filter(x => x.v2.light === 'green').forEach(x => { x.v2.rank = null; x.v2.decision = 'green'; x.v2.why = LIGHT.green; });
  return { used, capacity: C.capacityPM, ranked: byScore };
}

/** Кендалл τ-b между двумя рейтингами (одинаковые id). */
function kendall(a, b){
  const ids = a.filter(id => b.includes(id)); const ra = Object.fromEntries(ids.map(id => [id, a.indexOf(id)])), rb = Object.fromEntries(ids.map(id => [id, b.indexOf(id)]));
  let c = 0, d = 0; for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) { const s = Math.sign(ra[ids[i]] - ra[ids[j]]) * Math.sign(rb[ids[i]] - rb[ids[j]]); if (s > 0) c++; else if (s < 0) d++; }
  return c + d ? r2((c - d) / (c + d)) : null;
}

const DECISIONS = { plan: 'В план (по мощности команды)', measure: 'Сначала замерить', below: 'Ниже линии', gate: 'Не пройден гейт', green: 'Зелёный — не оптимизируем' };
module.exports = { VERSION, CRITERIA, GATES, LIGHT, DEFAULTS, DECISIONS, FIB_PM, EV, assessV2, portfolioV2, kendall };
