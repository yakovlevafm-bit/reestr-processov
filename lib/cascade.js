/* ================================================================
   Отбор процессов по каскаду (основная схема с 22.10.2026; формула v2 — только
   очерёдность внутри прошедших). Шаги идут строго по порядку, без возмещения:
   процесс останавливается на первом непройденном шаге, и видно, почему.
     0 гейты     — дубль, «светофор» (зелёный/красный), стоп-факторы v2;
     1 ценность  — для кого результат (паспорт) и объём ручного труда, ч/год;
     2 проблема  — срывы сроков, долгое прохождение, переделки, жалобы (анкета, ДЕЛО, ручная оценка);
     3 поток     — межведомственный / между отделами, передачи (не отсекает — отметки и очерёдность);
     4 реализуемость — владелец, размер ≤ 6 мес., базовая линия (отметки) → очерёдность по ИП × доверие
                   и линия мощности команды.
   Прошедшие отбор (план и резерв) образуют короткий список на обследование — не больше surveyN за цикл.
   Нет данных на шаге — решение «сначала замерить», а не отсев. Отдельная дорожка «быстрые победы»:
   остановленные на шагах 1–2, но маленькие и хорошо автоматизируемые.
   Пороги — data/config.json, ключ cascade.
   ================================================================ */
'use strict';
const PS = require('./passport.js');

const DEFAULTS = {
  minHours: 200,          // ч/год — порог объёма для внешнего получателя и органов власти
  minHoursInternal: 500,  // ч/год — для внутреннего получателя (обеспечивающие процессы)
  grey: 0.2,              // серая зона ниже порога: проходит с отметкой
  deloVolume: 50,         // документов ДЕЛА в год — объём, когда часы не известны
  deloMin: 5,             // минимум документов для выводов по ДЕЛУ
  lateMax: 10,            // % позже срока — проблема
  vppRatio: 2, vppMin: 5, // ВПП процесса не меньше vppMin раб. дн. и во столько раз дольше фона отдела — проблема
  handMax: 4,             // уровней резолюций — потери на передачах
  capacityPM: 24,         // чел.-мес. в год — мощность команды (как в v2)
  quickK: 0.7, quickMaxSize: 2, quickMinHours: 100, quickPM: 6, // быстрые победы
  surveyN: 20,            // мощность обследования — процессов в коротком списке за цикл (15–25)
};
const DEC = {
  dup: [0, 'Дубль — объединить до оценки'], green: [0, 'Зелёный — процесс в норме'], red: [0, 'Красный — устранить или передать функцию'], gate: [0, 'Не пройден гейт'],
  m1: [1, 'Сначала замерить объём'], low: [1, 'Малый объём для получателя'],
  m2: [2, 'Сначала замерить проблему'], calm: [2, 'Проблем не выявлено'],
  plan: [4, 'В план'], reserve: [4, 'Резерв — ниже линии мощности'],
};
const GROUP_RANK = { ext: 1, gov: 2, '': 2, int: 3 };
const fmt = v => Math.round(v).toLocaleString('ru');

/** Объём ручного труда, ч/год: подтверждённый, правдоподобный из реестра или с поправкой единиц (с отметкой). */
function volume(x, lab){
  if (!lab || lab.labor === null) return null;
  if (lab.sure) return { h: lab.labor, ev: 'A', note: 'подтверждено' };
  if (lab.verdict === 'правдоподобно') return { h: lab.labor, ev: 'B', note: 'по реестру или анкете' };
  if (lab.fixed) return { h: lab.fixed, ev: 'C', note: `с поправкой единиц («${lab.verdict}») — проверить`, doubt: true };
  return null;
}

/** Признаки проблемы: [{yes, text, ev}] — yes=false означает подтверждённое отсутствие. */
function problems(x, dm, dept, C){
  const out = [];
  const f = x.facts.filter(y => y.name === 'problem' && (y.status === 'verified' || y.status === 'proposed'));
  const pf = f.find(y => y.status === 'verified') || f[f.length - 1];
  if (pf){ const v = +String(pf.value).replace(',', '.'); if (v >= 3) out.push({ yes: true, ev: pf.status === 'verified' ? 'A' : 'B', text: `анкета: проблемность ${v} из 5` }); else if (v) out.push({ yes: false, ev: 'B', text: `анкета: проблем нет (${v})` }); }
  // ручная оценка риска — только если её поставил аналитик; из анкеты (⑥ «цена ошибки») — это тяжесть последствий, а не наличие проблемы
  const mr = x.card.v2 && x.card.v2.risk; if (mr && mr.score && !/^анкета/.test(mr.basis || '')){ if (+mr.score >= 3) out.push({ yes: true, ev: 'A', text: `ручная оценка риска ${mr.score}: ${mr.basis || ''}` }); else out.push({ yes: false, ev: 'A', text: `ручная оценка риска ${mr.score}` }); }
  if (dm){
    let any = false;
    if (dm.late.of >= C.deloMin){ any = true; if (dm.late.pct >= C.lateMax) out.push({ yes: true, ev: 'A', text: `ДЕЛО: позже срока ${dm.late.pct} % (${dm.late.n} из ${dm.late.of})` }); }
    if (dm.vpp.n >= C.deloMin && dept && dept.vpp.med){ any = true; if (dm.vpp.med >= C.vppMin && dm.vpp.med >= C.vppRatio * dept.vpp.med) out.push({ yes: true, ev: 'A', text: `ДЕЛО: прохождение ${String(dm.vpp.med).replace('.', ',')} раб. дн. при ${String(dept.vpp.med).replace('.', ',')} у отдела` }); }
    if (dm.n >= C.deloMin && dm.hand.med >= C.handMax) out.push({ yes: true, ev: 'A', text: `ДЕЛО: ${String(dm.hand.med).replace('.', ',')} уровня резолюций` });
    if (any && !out.some(y => y.yes && /^ДЕЛО/.test(y.text))) out.push({ yes: false, ev: 'A', text: `ДЕЛО: сроки и прохождение в норме (${dm.n} док.)` });
  }
  return out;
}

/** items — как в server.js all(): { p, facts, card, a, pp } + v2 (assessV2) + hy (hypothesis.assess, необязательно); labor — lib/labor.js check().rows; delo — документ delo_metrics. */
function run(items, { labor = [], delo = null, cfg = {} } = {}){
  const C = { ...DEFAULTS, ...cfg };
  const L = Object.fromEntries(labor.map(r => [r.id, r]));
  for (const x of items){
    const flags = [], cs = x.cs = { step: 0, decision: '', why: '', flags, ev: {} };
    const stop = (d, why) => { cs.decision = d; cs.step = DEC[d][0]; cs.why = why; };
    const pp = x.pp, v2 = x.v2, dm = delo && delo.procs[x.p.id], dept = delo && delo.depts[delo.owner[x.p.id]];
    // шаг 0
    if (x.p.duplicateOf){ stop('dup', `дубль ${x.p.duplicateOf}`); continue; }
    if (x.card.light === 'green'){ stop('green', 'светофор: зелёный'); continue; }
    if (x.card.light === 'red'){ stop('red', 'светофор: красный — функция избыточна или не своя'); continue; }
    if (v2.gatesFailed.length){ stop('gate', v2.gatesFailed.map(g => require('./method_v2.js').GATES[g]).map(s => 'нет: ' + s).join('; ')); continue; }
    // шаг 1: для кого результат и сколько ручного труда
    const g = pp.recipient.group, th = g === 'int' ? C.minHoursInternal : C.minHours;
    const vol = cs.ev.volume = volume(x, L[x.p.id]);
    const who = g ? PS.label.group(g) : 'получатель не определён';
    if (!g) flags.push('получатель не определён — уточнить в паспорте');
    if (!vol){
      if (dm && dm.perYear >= C.deloVolume) flags.push(`объём по ДЕЛУ: ≈${dm.perYear} документов в год; часы не известны`);
      else { stop('m1', `${who}; трудозатраты не известны — анкета отдела или хронометраж`); continue; }
    } else if (vol.h < th * (1 - C.grey)){
      // по значению с поправкой единиц не отсекаем: оно под вопросом
      if (vol.doubt) stop('m1', `${who}; ${fmt(vol.h)} ч/год ${vol.note} — ниже порога ${fmt(th)}, но единицы под вопросом`);
      else stop('low', `${who}; ${fmt(vol.h)} ч/год при пороге ${fmt(th)}`);
      continue;
    }
    else if (vol.h < th) flags.push(`серая зона: ${fmt(vol.h)} ч/год при пороге ${fmt(th)}`);
    if (vol && vol.doubt) flags.push(`объём ${fmt(vol.h)} ч/год ${vol.note}`);
    // шаг 2: есть ли проблема
    const pr = cs.ev.problems = problems(x, dm, dept, C);
    if (!pr.some(y => y.yes)){
      // «проблем нет» — только по анкете или ручной оценке: ДЕЛО видит лишь переписку и может проблему подтвердить, но не опровергнуть
      const no = pr.filter(y => !y.yes && !/^ДЕЛО/.test(y.text));
      if (no.length) stop('calm', pr.map(y => y.text).join('; '));
      else stop('m2', (pr.length ? pr.map(y => y.text).join('; ') + '; но ' : '') + 'нет данных о срывах, переделках, жалобах в самой работе — анкета отдела, хронометраж');
      continue;
    }
    // шаг 3: поток (отметки)
    if (pp.cross.value === 'agency') flags.push('межведомственный поток — нужен владелец потока');
    if (dm && dm.n >= C.deloMin && dm.multi >= 30) flags.push(`в ДЕЛЕ у ${dm.multi} % документов исполнители из 2+ отделов`);
    if (pp.kind.conflict) flags.push(pp.kind.note);
    const ar = x.card.v2 && x.card.v2.risk; if (ar && +ar.score >= 4 && /^анкета/.test(ar.basis || '')) flags.push('по анкете цена ошибки высокая: жалоба, проверка, бюджетные деньги или права заявителя');
    // шаг 4: реализуемость (отметки), очерёдность — ниже
    if (pp.owner.src !== 'подтверждено') flags.push('подтвердить владельца процесса');
    // размер и реализуемость — по выбранной (лучшей) гипотезе, если гипотезы оценены (lib/hypothesis.js); иначе по типу процесса (v2.P)
    const hy = x.hy; cs.pm = hy ? hy.pm : v2.pm; cs.size = hy ? hy.size : v2.P.mode;
    if (hy) for (const f of hy.flags) flags.push(f);
    if (cs.size >= 8) flags.push('больше 6 мес. — разбить на этапы');
    if (!x.facts.some(f => f.status === 'verified')) flags.push('нет подтверждённой базовой линии — замер «до»');
    cs.step = 4; cs.decision = 'cand'; cs.why = pr.filter(y => y.yes).map(y => y.text).join('; ');
  }
  // очерёдность прошедших: сначала внешний получатель, затем органы власти, затем внутренний; внутри — ИП × доверие (v2)
  const cand = items.filter(x => x.cs.decision === 'cand').sort((a, b) => GROUP_RANK[a.pp.recipient.group] - GROUP_RANK[b.pp.recipient.group] || b.v2.score - a.v2.score);
  let used = 0;
  cand.forEach((x, i) => { x.cs.order = i + 1; if (used + x.cs.pm <= C.capacityPM){ used += x.cs.pm; x.cs.decision = 'plan'; } else x.cs.decision = 'reserve'; });
  // короткий список на обследование (единая схема, этап 2): первые surveyN прошедших отбор в порядке очерёдности;
  // card.short = { in: true|false, basis } — ручное включение (в т. ч. не прошедшего отбор) или исключение с основанием
  const manual = x => x.card.short && typeof x.card.short.in === 'boolean' ? x.card.short.in : null;
  const pool = [...cand.filter(x => manual(x) !== false), ...items.filter(x => manual(x) === true && x.cs.decision !== 'plan' && x.cs.decision !== 'reserve')];
  pool.slice(0, C.surveyN).forEach((x, i) => { x.cs.short = true; x.cs.shortOrder = i + 1; });
  // быстрые победы: остановленные на шагах 1–2, но маленькие и хорошо автоматизируемые
  let qUsed = 0;
  const quick = items.filter(x => ['low', 'm2', 'calm'].includes(x.cs.decision) && x.v2.K.mode >= C.quickK && (x.hy ? x.hy.size : x.v2.P.mode) <= C.quickMaxSize && x.cs.ev.volume && x.cs.ev.volume.h >= C.quickMinHours)
    .sort((a, b) => b.v2.score - a.v2.score);
  for (const x of quick){ const pm = x.hy ? x.hy.pm : x.v2.pm; if (qUsed + pm > C.quickPM) break; qUsed += pm; x.cs.quick = true; x.cs.pm = pm; }
  const count = {}; for (const x of items) count[x.cs.decision] = (count[x.cs.decision] || 0) + 1;
  const funnel = [items.length, items.filter(x => x.cs.step >= 1).length, items.filter(x => x.cs.step >= 2).length, items.filter(x => x.cs.step >= 4).length, count.plan || 0];
  return { cfg: C, used, qUsed, count, funnel, quick: items.filter(x => x.cs.quick).length, short: items.filter(x => x.cs.short).length, pool: pool.length };
}

module.exports = { run, DEFAULTS, DEC };
