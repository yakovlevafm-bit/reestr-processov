/* ================================================================
   Паспорт процесса — то, без чего не работает каскад отбора:
     вид        — основной / обеспечивающий / управления
     поток      — внутри подразделения / между подразделениями / межведомственный,
                  с кем и роль ведомства (владелец потока или участник)
     владелец   — должностное лицо, отвечающее за результат процесса целиком (не отдел)
     получатель — тип (граждане, бизнес, МСУ, федеральные и региональные органы,
                  подведомственные, внутренний) и кто конкретно.
   Значения: «реестр» (как записано в шаблоне), «авто» (разметка по тексту
   реестра), «подтверждено» (отдел или аналитик с основанием — card.passport).
   Отраслевые слова (названия получателей отрасли, «свои» прежние названия ведомства) — в профиле, ключ passport.
   ================================================================ */
'use strict';
const PRF = require('./profile.js').load();
const PP = PRF.passport || {};
const W = '[а-яёa-z]'; // \b в JS не работает с кириллицей — границы слов через просмотр
const wre = (src, flags = 'i') => new RegExp(src.replace(/\\w</g, `(?<!${W})`).replace(/\\w>/g, `(?!${W})`), flags);
const orx = (base, extra) => extra ? new RegExp(base.source + '|' + extra.re, extra.flags || 'i') : base;

const KIND = { main: 'основной', support: 'обеспечивающий', manage: 'управления' };
const CROSS = { dept: 'внутри подразделения', inter: 'между подразделениями', agency: 'межведомственный' };
const ROLE = { owner: 'владелец потока', part: 'участник' };
const RTYPE = { // порядок — приоритет «основного» получателя
  citizens: 'Граждане', business: (PP.labels && PP.labels.business) || 'Организации и ИП', municipal: 'Органы МСУ',
  external: 'Внешние, не уточнено', federal: 'Федеральные органы', regional: 'Региональные органы',
  subordinate: 'Подведомственные', internal: 'Внутренний', unknown: 'Не определён',
};
const RGROUP = { citizens: 'ext', business: 'ext', municipal: 'ext', external: 'ext', federal: 'gov', regional: 'gov', subordinate: 'gov', internal: 'int', unknown: '' };
const GROUP = { ext: 'внешний (граждане, бизнес, МСУ)', gov: 'органы власти', int: 'внутренний' };

const E = PP.recipients || {};
const RX = { // проверяются по порядку для каждой части через запятую/точку с запятой
  self: E.self ? new RegExp(E.self.re, E.self.flags || 'i') : null,
  federal: orx(wre('\\w<РФ\\w>|Росси|Российск|федеральн|\\w<ФНС|ФГБУ|Президент|Казначейств|\\w<Мин[а-я]+ России|Минэкономразвития|\\w<суд|прокуратур|\\w<МВД|\\w<Рос[а-я]*надзор|\\w<ГД\\w>|Государственн[а-я]* Дум'), E.federal),
  municipal: orx(wre('\\w<ОМСУ|муниципальн|мунципальн|\\w<МО\\w>|администраци|\\w<округ|\\w<район|поселени'), E.municipal),
  subordinate: orx(wre('\\w<ОКУ\\w>|\\w<ОБУ\\w>|\\w<ОАУ\\w>|подведомствен'), E.subordinate),
  citizens: orx(wre('граждан|\\w<физ|\\w<ФЛ\\w>|\\w<ЛПХ\\w>|Вуз'), E.citizens),
  business: orx(wre('\\w<ЮЛ\\w>|\\w<ИП\\w>|юриди|предприят|предпринимат|организаци|банк|\\w<П?АО\\w>|\\w<ОАО|\\w<ООО|кооператив|товаропроизвод'), E.business),
  external: orx(wre('заявител|заинтересованн|претендент|участник'), E.external),
  staff: wre('сотрудник'),
  regional: orx(wre('\\w<ИОГВ|\\w<ОИГВ|\\w<МОГВ|\\w<ОИВ\\w>|Правительств|губернатор|\\w<управлени|министерств|комисси|\\w<ГРБС'), E.regional),
  internal: orx(wre('\\w<отдел|руководств'), E.internal),
};
// «сильные» признаки берутся все сразу («юрлица и муниципальные районы»); «слабые» (сотрудники, область,
// управление, отдел) — только если сильных нет: «ИП … в области животноводства» — бизнес, а не регион
const STRONG = ['federal', 'municipal', 'subordinate', 'citizens', 'business', 'external'];

/** Получатель: типы по каждой части текста «Клиент» (без повторов, в порядке приоритета). */
function recipientTypes(text){
  const parts = String(text || '').split(/[,;\n]|\s+и\s+/).map(s => s.trim()).filter(Boolean);
  const out = new Set();
  for (const s of parts){
    if (RX.self && RX.self.test(s)) { out.add('internal'); continue; } // прежние и нынешние названия самого ведомства
    const hit = STRONG.filter(k => RX[k].test(s));
    if (hit.length) hit.forEach(k => out.add(k));
    else if (RX.staff.test(s)) out.add('internal');
    else if (RX.regional.test(s)) out.add('regional');
    else if (RX.internal.test(s)) out.add('internal');
    else out.add('unknown');
  }
  const keys = Object.keys(RTYPE); const list = [...out].sort((a, b) => keys.indexOf(a) - keys.indexOf(b));
  return list.length > 1 ? list.filter(k => k !== 'unknown') : list.length ? list : ['unknown'];
}

// процессы управления: в шаблоне ОГВ этого вида нет, «основной/вспомогательный» — только по названию
// (стратегия, госпрограммы, КПЭ, контроль исполнения, план работы ведомства, внутренний контроль); отчёт во внешний орган — не управление
const MANAGE = orx(wre('стратеги[ия] |государственн[а-я]* программ|госпрограмм|\\w<КПЭ|ключев[а-я]* показател|показател[а-я]* эффективност|контрол[ья] исполнени|исполнительск[а-я]* дисциплин|протокол[а-я]* совещани|\\w<коллеги[ия]|\\w<план[а-я]* (работы|деятельности) (министерств|комитет|управлени|ведомств)|внутренн[а-я]* (финансов[а-я]* )?(контрол|аудит)|управлени[а-я]* риск|реинжиниринг|оптимизац[а-я]* процесс|развити[юя] конкуренц'), PP.manage);

const FIO = /[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.\s?(?:[А-ЯЁ]\.)?|[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:на|ич|вна)(?![а-яё])/;

/** Паспорт процесса: { kind, cross, crossWith, role, owner, recipient } — у каждого поля value, src (реестр/авто/подтверждено), note. */
function passportOf(p, card = {}, staff = []){
  const c = card.passport || {}; const conf = k => c[k] !== undefined && c[k] !== '' && c[k] !== null;
  const fld = (k, value, src, note = '') => conf(k) ? { value: c[k], src: 'подтверждено', note: c.basis || '' } : { value, src, note };
  // вид
  const rk = (p.kind || '').toLowerCase(), mg = MANAGE.test((p.name || '').slice(0, 80)); // только начало названия: «… в рамках госпрограммы» — не управление
  const kind = fld('kind', mg ? 'manage' : /основн/.test(rk) ? 'main' : /вспомог|обеспеч/.test(rk) ? 'support' : '',
    mg ? 'авто' : rk ? 'реестр' : '', mg ? `по названию — процесс управления (в реестре: ${p.kind || 'пусто'})` : '');
  // поток
  const rc = (p.cross || '').toLowerCase(), withTypes = p.crossWith ? recipientTypes(p.crossWith) : [];
  const agency = withTypes.some(t => RGROUP[t] === 'gov' || t === 'municipal');
  const cross = fld('cross', /несквозн/.test(rc) ? 'dept' : /сквозн/.test(rc) ? (agency ? 'agency' : 'inter') : '',
    agency ? 'авто' : rc ? 'реестр' : '', agency ? 'по графе «С кем сквозной»' : /^сквозн/.test(rc) && !p.crossWith ? 'в реестре «сквозной», но не указано, с кем — не подтверждено' : '');
  const crossWith = fld('crossWith', p.crossWith || '', p.crossWith ? 'реестр' : '');
  const role = fld('role', /владел/i.test(p.role || '') ? 'owner' : /участ|соисполн/i.test(p.role || '') ? 'part' : '', p.role ? 'реестр' : '');
  // владелец: в шаблоне — подразделение (иногда ФИО исполнителя); должность — подсказка по штату
  const dept = PRF.deptOf(p.owner), isFio = FIO.test(p.owner || '') && !/отдел|управлени|министерств|руководств/i.test(p.owner || '');
  const posts = staff.filter(s => s.dept === dept).map(s => s.position);
  const post = posts.find(x => /^начальник/i.test(x)) || posts.find(x => /^заместитель/i.test(x)) || '';
  const owner = conf('ownerPost') ? { value: c.ownerPost, dept, src: 'подтверждено', note: c.basis || '' }
    : { value: post ? `${post} (${dept})` : '', dept, src: post ? 'авто' : '', note: isFio ? 'в реестре указан исполнитель (ФИО), а не владелец' : post ? 'по штату: руководитель подразделения из графы «Ответственный» — подтвердить' : 'должность владельца не указана' };
  // получатель
  const types = conf('recipientTypes') ? [].concat(c.recipientTypes) : recipientTypes(p.client);
  const recipient = { types, group: RGROUP[types[0]] || '', value: conf('recipient') ? c.recipient : p.client || '', src: conf('recipientTypes') ? 'подтверждено' : p.client ? 'авто' : '', note: !p.client ? 'графа «Клиент» пуста' : types.includes('unknown') || types.includes('external') ? 'тип получателя не ясен из реестра — уточнить' : '' };
  // вид и получатель должны сходиться: основной процесс создаёт результат для внешнего получателя
  if (kind.src !== 'подтверждено' && kind.value === 'support' && recipient.group === 'ext') { kind.conflict = true; kind.note = 'в реестре «вспомогательный», но результат получают внешние — по определению это основной процесс'; }
  if (kind.src !== 'подтверждено' && kind.value === 'main' && recipient.group === 'int') { kind.conflict = true; kind.note = 'в реестре «основной», но получатель только внутренний — похоже на обеспечивающий'; }
  const confirmed = ['kind', 'cross', 'ownerPost', 'recipientTypes'].filter(conf).length;
  return { kind, cross, crossWith, role, owner, recipient, confirmed, complete: confirmed === 4 };
}

const label = { kind: v => KIND[v] || '—', cross: v => CROSS[v] || '—', role: v => ROLE[v] || '—', rtype: v => RTYPE[v] || v, group: v => GROUP[v] || '—' };
module.exports = { passportOf, recipientTypes, KIND, CROSS, ROLE, RTYPE, RGROUP, GROUP, label };
