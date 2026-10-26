#!/usr/bin/env node
/* ================================================================
   РЕЕСТР ПРОЦЕССОВ — инструмент анализа и отбора процессов органа власти для оптимизации.
   Ядро не знает о конкретном ведомстве: всё отраслевое — в profiles/<id>/ (см. docs/ПРОФИЛЬ.md).
   ----------------------------------------------------------------
   node reestr.js demo                 пример: профиль demo-kultura, искусственный реестр → можно смотреть интерфейс
   node reestr.js import [файл.xlsx]   импорт реестра по шаблону ОГВ (по умолчанию — файл из профиля, files.registry)
                                       + факты из колонок реестра (статус «предложение»); повторный импорт —
                                       новая редакция: дифф по названиям, устаревшие подтверждения помечаются
   node reestr.js versions             список редакций реестра
   node reestr.js labor                сверка трудозатрат (единицы, фонд подразделения, противоречия) → export/
   node reestr.js check-numbers        числа в гипотезах ИИ, которых нет в реестре → пометка в карточках
   node reestr.js facts-ai <id>|--pilot|--all [--force]   ИИ-шлюз извлекает факты с цитатами (статус «предложение ИИ»)
   node reestr.js bridge-probe         подобрать исходящий адрес для ИИ-шлюза при VPN (сохраняется в data/config.json)
   node reestr.js bridge-key [ключ|--where]   спрятать ключ ИИ-шлюза в data/bridge.key (DPAPI учётной записи)
   node reestr.js seed                 начальная загрузка ведомства (profiles/<id>/seed.js, если есть)
   node reestr.js stats                сводка: типы, оценки, сколько фактов подтверждено
   node reestr.js export               итоговый Excel в export/
   node reestr.js anketa [--srok дд.мм.гггг] [--komu "кому вернуть"]   анкеты для подразделений (вопросы ИИ, факты, гипотезы)
   node reestr.js anketa-import <файл|папка> [кто] [--dry]   загрузить заполненные анкеты (повтор не задваивает)
   node reestr.js anketa-status [--napominanie] [--today дд.мм.гггг]   контроль сдачи → export/анкеты/
   node reestr.js anketa2 / anketa2-import <файл|папка> [--dry] [--add-new] / anketa2-status   простые анкеты (6 вопросов)
   node reestr.js opros                опросник владельцев процессов (паспорт: владелец, поток, получатель, вид)
   node reestr.js opros-import <файл|папка> [--dry]   загрузить опросник → паспорт «подтверждено» (спорное → разбор)
   node reestr.js html <id>|--pilot|--all   карточки как самостоятельные HTML-файлы → export/html/
   node reestr.js snapshot             статический снимок реестра без фамилий и форм → export/snapshot/
   node reestr.js polozhenie [--force] / polozhenie-export   сверка реестра с положением о ведомстве через ИИ-шлюз
   node reestr.js storage [migrate]    где лежат данные; перенос JSON → SQLite
   node reestr.js test                 автотесты ядра, одновременная запись, демо-ведомство, эталон расчётов
   node reestr.js serve                веб-интерфейс http://localhost:8650
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { importRegistry, readSheet } = require('./lib/registry_import.js');
const { store, seedFromRegistry, ROOT } = require('./lib/store.js');
const { classify } = require('./lib/rules.js');
const { assess, CRITERIA } = require('./lib/method.js');
const { buildXlsx, S } = require('./lib/xlsxwrite.js');
const { classifyFunctions, nameOf } = require('./lib/functions.js');

const cmd = process.argv[2];
const arg = process.argv[3];

function assessAll(){
  const reg = store.processes(), facts = store.facts(), manual = store.manual(), cards = store.cards();
  return reg.processes.map(p => { const rule = classify(p); const f = facts.filter(x => x.pid === p.id); const card = cards[p.id] || {}; const a = assess(p, f, rule, manual[p.id], card); return { p, rule, facts: f, a, card }; });
}
const pickItems = (items, a) => a === '--pilot' ? items.filter(x => x.card.pilot) : a === '--all' || !a ? items : items.filter(x => x.p.id === a);

if (cmd === 'demo'){
  // пример работы: профиль demo-kultura, искусственный реестр из profiles/demo-kultura/example.js → data/ (если данных ещё нет)
  const ST = require('./lib/storage.js'); const cfgFile = path.join(ST.DATA, 'config.json');
  if (fs.existsSync(path.join(ST.DATA, 'processes.json')) || fs.existsSync(path.join(ST.DATA, 'reestr.sqlite'))){ console.log('В каталоге данных уже есть реестр — пример не загружаю:', ST.DATA); process.exit(1); }
  fs.mkdirSync(ST.DATA, { recursive: true }); const cfg = ST.readConfig(); cfg.profile = 'demo-kultura'; fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 1));
  const file = require('./profiles/demo-kultura/example.js').writeRegistry(path.join(ST.DATA, 'Реестр процессов ДКТ (пример).xlsx'));
  const r = require('child_process').spawnSync(process.execPath, [__filename, 'import', file], { stdio: 'inherit', env: { ...process.env, REESTR_PROFILE: 'demo-kultura' } });
  if (r.status === 0) console.log('Пример загружен. Дальше: node reestr.js serve → http://localhost:8650');
  process.exit(r.status || 0);
} else if (cmd === 'import'){
  // первый импорт — реестр целиком; повторный — новая редакция: сопоставление по названию, дифф, устаревшие подтверждения
  const file = arg || path.join(ROOT, require('./lib/profile.js').load().files.registry);
  const r = require('./lib/versions.js').importVersion(file);
  console.log(`Редакция ${r.n}: процессов ${r.rows}, добавлено ${r.added.length}, исключено ${r.removed.length}, изменено ${r.changed.length}, без изменений ${r.unchanged}; фактов из реестра добавлено ${r.facts}; подтверждений помечено «устарело»: ${r.stale}`);
  for (const x of r.added.slice(0, 20)) console.log('  + ' + x.id + ' ' + x.name.slice(0, 80));
  for (const x of r.removed.slice(0, 20)) console.log('  − ' + x.id + ' ' + x.name.slice(0, 80));
  for (const x of r.changed.slice(0, 20)) console.log('  ~ ' + x.id + ' ' + x.fields.map(f => f.field).join(', ') + ' — ' + x.name.slice(0, 60));
} else if (cmd === 'versions'){
  for (const v of store.versions()) console.log(`ред. ${v.n}  ${v.at}  ${v.file} · «${v.sheet}»  строк ${v.rows}  +${v.added} −${v.removed} ~${v.changed}  устарело ${v.stale || 0}`);
  if (!store.versions().length) console.log('Редакций нет: реестр импортирован до появления версий; следующий import создаст редакции 1 (текущая) и 2 (новая).');
} else if (cmd === 'labor'){
  // сверка трудозатрат: где реестр противоречит сам себе (единицы, фонд отдела, подтверждённые факты)
  const L = require('./lib/labor.js'); const r = L.check(assessAll(), store.staff());
  for (const [k, v] of Object.entries(r.summary).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(4), k);
  console.log(`Сумма как записано: ${Math.round(r.rawTotal).toLocaleString('ru')} ч/год; с поправкой единиц: ${Math.round(r.fixedTotal).toLocaleString('ru')} ч/год`);
  console.log(L.exportXlsx(r));
} else if (cmd === 'check-numbers'){
  // числа в гипотезах и резюме «ИИ-шлюза», которых нет в строке реестра и фактах → пометка в карточке
  const { unsupportedNumbers } = require('./lib/evidence.js');
  let flagged = 0, total = 0;
  for (const x of assessAll()){
    const src = [x.p.name, x.p.input, x.p.output, x.p.hoursRaw, x.p.perYearRaw, x.p.place, ...x.facts.map(f => f.value + ' ' + (f.unit || ''))].join(' \n ');
    const found = [];
    for (const [k, h] of (x.card.hyps || []).entries()) if (/^(Мост|ИИ-шлюз)$/.test(h.source || '')) for (const n of unsupportedNumbers(h.text + ' ' + (h.effect || '') + ' ' + (h.mvp || ''), src)) found.push({ where: 'гипотеза ' + (k + 1), n: n.s, ctx: n.ctx });
    if (x.card.ai && x.card.ai.summary) for (const n of unsupportedNumbers(x.card.ai.summary, src)) found.push({ where: 'резюме', n: n.s, ctx: n.ctx });
    if (x.card.ai) total++;
    if (found.length){ flagged++; store.saveCard(x.p.id, { numCheck: { at: store.now(), unsupported: found } }, 'проверка чисел'); }
    else if (x.card.numCheck) store.saveCard(x.p.id, { numCheck: { at: store.now(), unsupported: [] } }, 'проверка чисел');
  }
  console.log(`Карточек с ответом «ИИ-шлюза»: ${total}; с числами, которых нет в реестре: ${flagged}`);
} else if (cmd === 'facts-ai'){
  // node reestr.js facts-ai <id>|--pilot|--all [--force]  — «ИИ-шлюз» извлекает факты с цитатами; число проверяется по цитате; статус «предложение ИИ»
  const bridge = require('./lib/bridge.js');
  if (!bridge.available()){ console.log('Нет ключа «ИИ-шлюза»: setx BRIDGE_API_KEY <ключ>'); process.exit(1); }
  const force = process.argv.includes('--force');
  let items = pickItems(assessAll(), arg);
  if (!force) items = items.filter(x => !(x.card.aiFacts && x.card.aiFacts.at));
  (async () => {
    let ok = 0, nf = 0, bad = 0;
    for (const it of items){
      try {
        const r = await bridge.extractFacts(it.p);
        const facts = store.facts(); const have = new Set(facts.filter(f => f.pid === it.p.id && f.status === 'ai').map(f => f.name + '|' + f.value));
        for (const f of r.facts){
          if (have.has(f.name + '|' + f.value)) continue;
          store.addFact({ pid: it.p.id, name: f.name, value: f.value, unit: f.unit, period: f.period || '2025', source: 'строка реестра, извлечено «ИИ-шлюзом» ' + r.at, role: 'ИИ', status: 'ai', by: '«ИИ-шлюз»', quote: f.quote, check: f.check, basis: f.note });
          nf++; if (!f.check.ok) bad++;
        }
        store.saveCard(it.p.id, { aiFacts: { at: r.at, n: r.facts.length, unsupported: r.facts.filter(f => !f.check.ok).length, usage: r.usage } }, '«ИИ-шлюз»: факты');
        ok++; console.log(`${it.p.id.padEnd(9)} фактов ${r.facts.length}, не по цитате ${r.facts.filter(f => !f.check.ok).length}, ${(r.ms / 1000).toFixed(1)} с — ${it.p.name.slice(0, 60)}`);
      } catch (e) { console.log(`${it.p.id.padEnd(9)} ОШИБКА: ${e.message}`); if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|таймаут/.test(e.message)) { console.log('Сеть: node reestr.js bridge-probe'); break; } }
    }
    console.log(`Готово: ${ok} из ${items.length}; фактов добавлено ${nf}, из них число не подтверждено цитатой: ${bad}`);
  })();
} else if (cmd === 'bridge-key'){
  // node reestr.js bridge-key [ключ]  — спрятать ключ «ИИ-шлюза» в data/bridge.key под DPAPI и убрать его из реестра Windows
  const bridge = require('./lib/bridge.js');
  if (arg === '--where'){ console.log('Источник ключа:', bridge.keySource()); }
  else { try { const r = bridge.storeKey(arg); console.log('Ключ сохранён:', r.file, '(расшифровать может только учётная запись', process.env.USERNAME + ' на этом компьютере)'); console.log(r.removedFromRegistry ? 'Из HKCU\\Environment ключ удалён.' : 'В HKCU\\Environment ключа не было.'); if (r.envStillSet) console.log('ВНИМАНИЕ: в текущей сессии ещё задана переменная BRIDGE_API_KEY — закройте окно терминала.'); console.log('Проверка:', bridge.available() ? 'ключ читается' : 'ключ НЕ читается'); } catch (e) { console.log('Ошибка:', e.message); process.exit(1); } }
} else if (cmd === 'bridge-probe'){
  // какой исходящий адрес доходит до «ИИ-шлюза» (обход VPN); рабочий сохраняется в data/config.json
  require('./lib/bridge.js').probe().then(r => { for (const x of r.results) console.log((x.ok ? 'OK  ' : 'нет ') + (x.adapter + ' ' + x.address).padEnd(50) + (x.ok ? x.status + ' за ' + x.ms + ' мс' : x.error)); console.log(r.best ? (r.best.address ? 'Сохранён исходящий адрес ' + r.best.address + ' (' + r.best.adapter + ')' : 'Прямое подключение работает, привязка адреса не нужна') : 'Ни один адрес не доходит до «ИИ-шлюза»: проверьте сеть и VPN'); });
} else if (cmd === 'seed'){
  // начальная загрузка, своя у каждого ведомства — profiles/<id>/seed.js
  const P = require('./lib/profile.js').load(); const f = path.join(P.dir, 'seed.js');
  if (!fs.existsSync(f)){ console.log('У профиля «' + P.id + '» нет начальной загрузки (seed.js)'); process.exit(0); }
  require(f)({ ROOT, store, fs, path });
} else if (cmd === 'stats'){
  const all = assessAll();
  const by = {}; all.forEach(x => by[x.rule.type] = (by[x.rule.type] || 0) + 1);
  console.log('Процессов:', all.length, '| в пилоте:', all.filter(x => x.card.pilot).length, '| полная оценка:', all.filter(x => x.a.complete).length);
  console.log('Фактов:', store.facts().length, '| подтверждено:', store.facts().filter(f => f.status === 'verified').length);
  Object.entries(by).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(String(v).padStart(4), k));
  console.log('\nТоп по ожидаемой ценности (методика v1.1):');
  all.sort((a, b) => (b.a.value.exp - a.a.value.exp) || (b.a.feas.exp - a.a.feas.exp) || (b.a.confidence - a.a.confidence)).slice(0, 15).forEach(x => console.log(`${x.p.id.padEnd(9)} ц ${x.a.value.min}–${x.a.value.max} ~${x.a.value.exp}  р ~${x.a.feas.exp}  ${x.a.group.padEnd(13)} ${x.p.name.slice(0, 70)}`));
} else if (cmd === 'export'){
  const all = assessAll();
  const dir = path.join(require('./lib/storage.js').EXPORT); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, require('./lib/profile.js').load().ui.exportName + ' — оценка ' + new Date().toISOString().slice(0, 10) + '.xlsx');
  const { GROUPS } = require('./lib/method.js'); const gname = Object.fromEntries(GROUPS.map(g => [g[0], g[1]]));
  const head = ['ID', 'Строка', 'Группа', 'Отдел', 'Процесс', 'Тип', 'Функция по ' + require('./lib/profile.js').load().functions.npa.short, 'В пилоте', 'Ценность min', 'Ценность max', 'Реализуемость min', 'Реализуемость max', 'Квадрант', 'Группа приоритета', 'Причина', 'Полная оценка', 'Экз./год', 'Ч/случай', 'Чел.-ч/год', 'Фактов подтв.', 'Гипотезы', 'Вариант решения', 'MVP', 'Дубль', 'Ценность ожид.', 'Реализуемость ожид.', 'Подтверждено веса, %', 'Методика', 'Вид процесса (паспорт)', 'Поток', 'С кем', 'Получатель — тип', 'Владелец процесса (должность)', 'Паспорт: замечания', 'Паспорт подтверждён'];
  const PS = require('./lib/passport.js'), staff = store.staff();
  const rows = [head.map(v => ({ v, s: S.HEAD }))];
  for (const x of all.sort((a, b) => (b.a.value.exp - a.a.value.exp) || (b.a.feas.exp - a.a.feas.exp) || (b.a.confidence - a.a.confidence))){
    const hyps = (x.card.hyps || x.rule.hyps.map(h => ({ text: h[0], effect: h[1] }))).map(h => '• ' + h.text + (h.effect ? ' → ' + h.effect : '')).join('\n');
    const cnt = x.facts.find(f => f.name === 'count' && f.status === 'verified') || x.facts.find(f => f.name === 'count');
    const hrs = x.facts.find(f => f.name === 'hours' && f.status === 'verified') || x.facts.find(f => f.name === 'hours');
    rows.push([x.p.id, x.p.row, x.p.group, x.p.owner, x.p.name, x.rule.type, classifyFunctions(x.p).map(id => id + ' ' + nameOf(id)).join('; '), x.card.pilot ? 'да' : '', x.a.value.min, x.a.value.max, x.a.feas.min, x.a.feas.max, x.a.quadrant, gname[x.a.group] || x.a.group, x.a.reason, x.a.complete ? 'да' : 'нет',
      cnt ? cnt.value : '', hrs ? hrs.value : '', x.a.labor !== null ? Math.round(x.a.labor) : '', x.facts.filter(f => f.status === 'verified').length, hyps, x.card.solution || '', x.card.mvp || x.rule.mvp, x.p.duplicateOf || '', x.a.value.exp, x.a.feas.exp, x.a.confidence, 'v' + x.a.version, ...(pp => [PS.label.kind(pp.kind.value), PS.label.cross(pp.cross.value), pp.crossWith.value, pp.recipient.types.map(PS.label.rtype).join(', '), pp.owner.value, [pp.kind.note, pp.cross.note, pp.owner.src !== 'подтверждено' ? pp.owner.note : '', pp.recipient.note].filter(Boolean).join('; '), pp.complete ? 'да' : 'нет'])(PS.passportOf(x.p, x.card, staff))]
      .map((v, i) => ({ v, s: typeof v === 'number' ? S.NUM : (i === 4 || i === 6 || i === 14 || i === 20 || i === 21) ? S.WRAP : S.TEXT })));
  }
  const fr = [['ID', 'Процесс', 'Факт', 'Значение', 'Ед.', 'Период', 'Источник', 'Роль', 'Статус', 'Основание', 'Цитата', 'Число по цитате', 'Устарело', 'Кто', 'Когда'].map(v => ({ v, s: S.HEAD }))];
  const byId = Object.fromEntries(all.map(x => [x.p.id, x.p.name]));
  const { FACT_STATUS } = require('./lib/method.js');
  for (const f of store.facts()) fr.push([f.pid, byId[f.pid] || '', store.FACT_NAMES[f.name] || f.name, f.value, f.unit, f.period, f.source, f.role, FACT_STATUS[f.status] || f.status, f.basis || '', f.quote || '', f.check ? (f.check.ok ? 'да: ' + f.check.rule : 'НЕТ: ' + f.check.reason) : '', f.stale || '', f.by || '', f.at].map(v => ({ v, s: typeof v === 'number' ? S.NUM : S.WRAP })));
  fs.writeFileSync(out, buildXlsx([
    { name: 'Оценка', rows, widths: [9, 6, 26, 26, 60, 26, 40, 8, 9, 9, 9, 9, 24, 26, 60, 8, 8, 8, 10, 8, 70, 60, 40, 9], freeze: 1, autoFilter: `A1:X${rows.length}` },
    { name: 'Факты', rows: fr, widths: [9, 50, 26, 12, 16, 8, 60, 14, 14, 50, 40, 30, 30, 12, 16], freeze: 1, autoFilter: `A1:O${fr.length}` },
  ]));
  console.log(out);
} else if (cmd === 'ai'){
  // node reestr.js ai <id> | --pilot | --all [--force]   — гипотезы через «ИИ-шлюз» (карточки без ai или все при --force)
  const bridge = require('./lib/bridge.js');
  if (!bridge.available()){ console.log('Нет ключа «ИИ-шлюза»: setx BRIDGE_API_KEY <ключ>'); process.exit(1); }
  const force = process.argv.includes('--force');
  let items = assessAll();
  if (arg === '--pilot') items = items.filter(x => x.card.pilot); else if (arg !== '--all') items = items.filter(x => x.p.id === arg);
  if (!force) items = items.filter(x => !x.card.ai);
  (async () => {
    let tokens = 0, ok = 0;
    for (const it of items){
      try {
        const r = await bridge.proposeHypotheses(it.p, it.facts, it.rule, it.card);
        const cur = it.card.hyps || it.rule.hyps.map(h => ({ text: h[0], effect: h[1], status: 'proposed', source: 'правила' }));
        const have = new Set(cur.map(h => h.text.toLowerCase().slice(0, 60)));
        const merged = [...cur, ...r.hyps.filter(h => !have.has(h.text.toLowerCase().slice(0, 60)))];
        store.saveCard(it.p.id, { hyps: merged, ai: { at: r.at, model: r.model, ms: r.ms, usage: r.usage, questions: r.questions, feasibility: r.feasibility, summary: r.summary } }, '«ИИ-шлюз»');
        tokens += r.usage ? r.usage.total_tokens || 0 : 0; ok++;
        console.log(`${it.p.id.padEnd(9)} +${merged.length - cur.length} гипотез, ${r.questions.length} вопросов, ${(r.ms / 1000).toFixed(1)} с — ${it.p.name.slice(0, 60)}`);
      } catch (e) { console.log(`${it.p.id.padEnd(9)} ОШИБКА: ${e.message}`); }
    }
    console.log(`Готово: ${ok} из ${items.length}, токенов ${tokens.toLocaleString('ru')}`);
  })();
} else if (cmd === 'v2-ai'){
  // node reestr.js v2-ai <id> | --pilot | --all [--force]  — предложения оценок v2 через «ИИ-шлюз» (card.v2ai); в расчёт — только после подтверждения в карточке
  const bridge = require('./lib/bridge.js');
  if (!bridge.available()){ console.log('Нет ключа «ИИ-шлюза»: setx BRIDGE_API_KEY <ключ>'); process.exit(1); }
  const force = process.argv.includes('--force');
  let items = pickItems(assessAll(), arg);
  if (!force) items = items.filter(x => !(x.card.v2ai && x.card.v2ai.at));
  (async () => {
    let ok = 0, tokens = 0, ungrounded = 0, fails = 0, stop = false;
    const queue = [...items], CONC = +(process.env.V2AI_CONC || 1); // «ИИ-шлюз» допускает 1 одновременный запрос на организацию; рассуждения модели — low: ~20 с на процесс вместо ~100
    const worker = async () => { while (queue.length && !stop){ const it = queue.shift();
      try {
        let r; for (let t = 1; ; t++){ try { r = await bridge.proposeV2(it.p, it.facts, it.rule, it.card, { extra: { reasoning_effort: 'low' } }); break; } catch (e) { if (!/ 429/.test(e.message) || t >= 6) throw e; await new Promise(res => setTimeout(res, 3000 * t)); } } // 429 — лимит одновременных запросов: подождать и повторить
        store.saveCard(it.p.id, { v2ai: r }, '«ИИ-шлюз»: оценки v2');
        const n = Object.keys(r.items).length, ug = Object.values(r.items).filter(x => x.grounded === false).length; ungrounded += ug;
        tokens += r.usage ? r.usage.total_tokens || 0 : 0; ok++; fails = 0;
        console.log(`${it.p.id.padEnd(9)} критериев ${n}, Р ${r.size ? r.size.score : '—'}, светофор ${r.light ? r.light.value : '—'}${ug ? ', цитата не найдена: ' + ug : ''}, ${(r.ms / 1000).toFixed(1)} с — ${it.p.name.slice(0, 60)}`);
      } catch (e) { console.log(`${it.p.id.padEnd(9)} ОШИБКА: ${e.message}`); if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|таймаут/.test(e.message) || ++fails >= 5) { console.log('Остановлено: проверьте сеть (node reestr.js bridge-probe)'); stop = true; } }
    } };
    await Promise.all(Array.from({ length: CONC }, worker));
    console.log(`Готово: ${ok} из ${items.length}; токенов ${tokens.toLocaleString('ru')}; цитат, не найденных в карточке: ${ungrounded}`);
  })();
} else if (cmd === 'anketa'){
  const { build } = require('./lib/anketa.js');
  const opt = n => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };
  const r = build(assessAll, { srok: opt('srok'), komu: opt('komu') });
  for (const d of r.summary) console.log(String(d.n).padStart(4), 'проц.', String(d.q).padStart(4), 'вопр.', String(d.f).padStart(4), 'факт.', String(d.h).padStart(4), 'гип. —', d.file);
  console.log('Папка:', r.dir); console.log('Сводка:', r.sumFile);
} else if (cmd === 'test'){
  // node reestr.js test — автотесты ядра (node:test), одновременная запись, сверка с эталоном расчётов (если он сохранён)
  const { spawnSync } = require('child_process'); let fail = 0;
  const run = (title, args) => { console.log('\n== ' + title); const r = spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'inherit' }); if (r.status !== 0) fail++; };
  run('автотесты ядра', ['--test', path.join('tests', 'core.test.js'), ...fs.readdirSync(path.join(ROOT, 'tests')).filter(f => /^profile-.*.test.js$/.test(f)).map(f => path.join('tests', f))]); // проверки профилей ведомств — если есть
  run('одновременная запись', [path.join('tests', 'concurrency.js')]);
  run('демо-ведомство другой отрасли (JSON)', [path.join('tests', 'demo.js')]);
  if (fs.existsSync(path.join(ROOT, 'tests', 'golden', 'assess.json'))) run('эталон расчётов', [path.join('tests', 'golden.js'), 'check']);
  else console.log('\n== эталон не сохранён (node tests/golden.js save) — пропущено');
  console.log(fail ? `\nНЕ ПРОЙДЕНО: ${fail}` : '\nВсё пройдено'); process.exit(fail ? 1 : 0);
} else if (cmd === 'storage'){
  // node reestr.js storage                — где лежат данные (JSON-файлы или SQLite)
  // node reestr.js storage migrate [файл] — перенести JSON → SQLite (JSON не меняется); включить: config.json "storage": "sqlite"
  const ST = require('./lib/storage.js');
  if (arg === 'migrate'){
    const file = process.argv[4] || path.join(ST.DATA, 'reestr.sqlite');
    if (fs.existsSync(file)){ console.log('Файл уже есть, перенос остановлен (удалите или укажите другой):', file); process.exit(1); }
    const r = ST.migrateJsonToSqlite(file); console.log('Перенесено в', file); console.log(r);
    console.log('Включить: в', path.join(ST.DATA, 'config.json'), 'поставить "storage": "sqlite" (или REESTR_STORAGE=sqlite)');
  } else { const i = store.storageInfo(); console.log('Хранилище:', i.kind, '|', i.file || i.dir, '| профиль:', require('./lib/profile.js').profileId()); }
} else if (cmd === 'anketa2'){
  // node reestr.js anketa2 — простые анкеты отделов (строка = процесс, 7 жёлтых столбцов) → export/анкеты2/; затем lib/anketa2_dv.ps1 (выпадающие списки)
  const r = require('./lib/anketa2.js').build2();
  for (const f of r.files) console.log(String(f.n).padStart(4), 'проц.', String(f.dup).padStart(3), 'дубл. —', path.basename(f.file));
  console.log('Папка:', r.dir, '\nВыпадающие списки: powershell -File lib\\anketa2_dv.ps1 -Json "' + path.join(r.dir, 'lists.json') + '"');
} else if (cmd === 'opros'){
  // node reestr.js opros — опросник владельцев процессов (паспорт: владелец, поток, получатель, вид) → export/опросник/; затем lib/opros_dv.ps1 (выпадающие списки)
  const r = require('./lib/opros.js').build();
  for (const f of r.files) console.log(String(f.n).padStart(4), 'проц. —', path.basename(f.file));
  console.log('Папка:', r.dir, '\nВыпадающие списки: powershell -File lib\\opros_dv.ps1 -Json "' + path.join(r.dir, 'lists.json') + '"');
} else if (cmd === 'opros-import'){
  // node reestr.js opros-import <файл.xlsx | папка> [--dry]  → паспорт процесса «подтверждено» (основание — опросник)
  if (!arg || !fs.existsSync(arg)){ console.log('Укажите файл опросника или папку'); process.exit(1); }
  const { importOpros } = require('./lib/opros.js'); const dry = process.argv.includes('--dry');
  const files = fs.statSync(arg).isDirectory() ? fs.readdirSync(arg).filter(f => /^Опросник — .+\.xlsx$/i.test(f) && !f.startsWith('~$')).map(f => path.join(arg, f)) : [arg];
  for (const f of files){ try { const r = importOpros(f, { dry }); console.log(`${path.basename(f)}: строк ${r.rows}, паспортов ${r.saved}, на разбор ${r.review.length}${r.reportFile ? ' → ' + r.reportFile : ''}${dry ? ' (пробно)' : ''}`); } catch (e) { console.log(path.basename(f) + ': ОШИБКА ' + e.message); } }
} else if (cmd === 'anketa2-status'){
  // node reestr.js anketa2-status [--today гггг-мм-дд]  → export/анкеты2/Контроль сдачи анкет.xlsx; присланные файлы класть в export/анкеты2/получено
  const i = process.argv.indexOf('--today'); const r = require('./lib/anketa2.js').status2({ today: i > 0 ? process.argv[i + 1] : undefined });
  for (const x of r.rows) console.log(`${x.file ? '✓' : '·'} ${x.dept.slice(0, 70).padEnd(70)} ${String(x.n).padStart(3)} проц. ${x.fill !== null && x.fill >= 0 ? String(x.fill).padStart(3) + ' заполн.' : '           '} ${x.status}`);
  console.log(`Получено ${r.rows.filter(x => x.file).length} из ${r.rows.length} (на ${r.today}, срок ${r.srok})`); console.log('Таблица:', r.file); console.log('Папка для присланных анкет:', r.inbox);
} else if (cmd === 'anketa2-import'){
  // node reestr.js anketa2-import <файл.xlsx | папка> [--dry]
  if (!arg || !fs.existsSync(arg)){ console.log('Укажите файл анкеты или папку'); process.exit(1); }
  // --add-new: строки без кода, но с названием — добавить в реестр как новые процессы отдела (source: anketa)
  const { importSimple } = require('./lib/anketa2.js'); const dry = process.argv.includes('--dry'), addNew = process.argv.includes('--add-new');
  const files = fs.statSync(arg).isDirectory() ? fs.readdirSync(arg).filter(f => /Анкета.+\.xlsx$/i.test(f) && !f.startsWith('~$')).map(f => path.join(arg, f)) : [arg];
  for (const f of files){ try { const r = importSimple(f, { dry, addNew }); console.log(`${path.basename(f)}: строк ${r.rows}, фактов ${r.facts}, решений по дублям ${r.dedup}, оценок v2 ${r.v2}, новых процессов ${r.added.length}, на разбор ${r.review.length}${r.reportFile ? ' → ' + r.reportFile : ''}${dry ? ' (пробно)' : ''}`); } catch (e) { console.log(path.basename(f) + ': ОШИБКА ' + e.message); } }
} else if (cmd === 'anketa-import'){
  // node reestr.js anketa-import <файл.xlsx | папка> [кто] [--dry]   (папка — все «Анкета — *.xlsx» в ней)
  if (!arg || !fs.existsSync(arg)){ console.log('Укажите файл анкеты или папку с анкетами'); process.exit(1); }
  const { importAnswers } = require('./lib/anketa.js');
  const dry = process.argv.includes('--dry'); const who = process.argv.slice(4).find(a => a !== '--dry');
  const files = fs.statSync(arg).isDirectory() ? fs.readdirSync(arg).filter(f => /^Анкета — .+\.xlsx$/i.test(f) && !f.startsWith('~$')).map(f => path.join(arg, f)) : [arg];
  let failed = 0;
  for (const file of files){
    try {
      const r = importAnswers(file, { who, dry });
      console.log(`${dry ? '[пробно] ' : ''}${r.dept || r.file} (${r.by}): подтверждено ${r.verified}, заменено ${r.replaced}, отклонено ${r.rejected}, новых ${r.added}, «нет данных» ${r.unknown}, уже было ${r.dup}; ответов ${r.answers}; гипотез ${r.hyps}; на разбор ${r.review.length}`);
      if (r.reportFile) console.log('  разбор:', r.reportFile);
      if (r.backup) console.log('  копия до загрузки:', r.backup);
    } catch (e) { failed++; console.log('ОШИБКА', path.basename(file) + ':', e.message); }
  }
  if (failed) process.exit(2);
} else if (cmd === 'anketa-status'){
  // node reestr.js anketa-status [--napominanie] [--today дд.мм.гггг]  → export/анкеты/Контроль сдачи анкет.xlsx
  const { status, iso } = require('./lib/anketa_control.js');
  const i = process.argv.indexOf('--today'); const today = i > 0 ? iso(process.argv[i + 1]) : undefined;
  if (i > 0 && !today){ console.log('Дата в виде дд.мм.гггг'); process.exit(1); }
  const r = status({ today, napominanie: process.argv.includes('--napominanie') });
  for (const x of r.rows) console.log(`${x.submitted ? '✓' : '·'} ${x.dept.slice(0, 70).padEnd(70)} ${(x.otv || '—').slice(0, 24).padEnd(24)} ${x.status}`);
  console.log(`Получено ${r.rows.filter(x => x.submitted).length} из ${r.rows.length}; ответственных ${r.rows.filter(x => x.otv).length} из ${r.rows.length} (на ${r.today})`);
  console.log('Таблица:', r.file); console.log('Папка для присланных анкет:', r.inbox);
  if (r.rem) console.log(`Напоминание (${r.rem.n} отд.):`, r.rem.file); else if (process.argv.includes('--napominanie')) console.log('Напоминание не нужно — все анкеты получены');
} else if (cmd === 'snapshot'){
  // node reestr.js snapshot — статический снимок всего реестра для свода: export/snapshot/<маршрут>.html
  // Страницы снимаются с внутреннего сервера с заголовками туннеля (ссылки с префиксом /reestr, фамилии скрыты),
  // формы и кнопки вырезаются. На сервере index.php в режиме snapshot отдаёт <маршрут>.html по тем же адресам.
  const items = assessAll();
  const dir = path.join(require('./lib/storage.js').EXPORT, 'snapshot'); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(path.join(dir, 'process'), { recursive: true });
  const token = store.config().tunnelToken || '';
  const srv = require('./server.js').start(0);
  srv.on('listening', async () => {
    const base = 'http://127.0.0.1:' + srv.address().port, prefix = '/reestr';
    const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const headers = { 'X-Forwarded-Prefix': prefix, 'X-Tunnel-Token': token, 'X-Public-View': '1' };
    const strip = h => h
      .replace(/<form[^>]*>/g, '<div>').replace(/<\/form>/g, '</div>')
      .replace(/<button[^>]*>[\s\S]*?<\/button>/g, '')
      .replace(/<(input|select|textarea)\b/g, '<$1 disabled')
      .replace(/<a href="\/reestr\/(export|versions|staff)[^"]*">[^<]*<\/a>/g, '')                  // разделов без смысла в снимке нет
      .replace(/<div class="small">[\s\S]*?<\/div><\/nav>/, `<div class="small">Снимок от ${date}<br>только просмотр, фамилии скрыты<br><br>Рабочая версия — у куратора цифровизации.</div></nav>`)
      .replace(/<a href="\/reestr\/export\/file\/[^"]*">([^<]*)<\/a>/g, '$1');
    const get = async (route, file) => { const r = await fetch(base + prefix + route, { headers }); if (!r.ok) throw new Error(route + ' → ' + r.status); fs.writeFileSync(path.join(dir, file), strip(await r.text())); };
    try {
      await get('/', 'index.html');
      for (const r of ['processes', 'functions', 'labor', 'method']) await get('/' + r, r + '.html');
      let n = 0;
      for (const x of items){ await get('/process/' + encodeURIComponent(x.p.id), path.join('process', x.p.id + '.html')); n++; }
      fs.writeFileSync(path.join(dir, 'СНИМОК.txt'), `Снимок реестра процессов ${require('./lib/profile.js').load().org.short} от ${date}: портфель, процессы, функции, сверка труда, методика, карточек ${n}. Фамилии скрыты, формы отключены.\n`);
      console.log(`Снимок: ${dir} — страниц ${n + 5}, ${date}`);
    } catch (e) { console.log('ОШИБКА снимка:', e.message); process.exitCode = 1; }
    srv.close();
  });
} else if (cmd === 'html'){
  // страницы снимаются с внутреннего сервера на случайном порту, формы отключаются — файл только для чтения
  let items = assessAll();
  if (arg === '--pilot') items = items.filter(x => x.card.pilot); else if (arg !== '--all') items = items.filter(x => x.p.id === arg);
  if (!items.length){ console.log('Нет таких процессов'); process.exit(1); }
  const dir = path.join(require('./lib/storage.js').EXPORT, 'html'); fs.mkdirSync(dir, { recursive: true });
  const srv = require('./server.js').start(0);
  srv.on('listening', async () => {
    const base = 'http://127.0.0.1:' + srv.address().port;
    const strip = h => h.replace(/<form[^>]*>/g, '<div>').replace(/<\/form>/g, '</div>').replace(/<button[^>]*>[\s\S]*?<\/button>/g, '').replace(/<(input|select|textarea)\b/g, '<$1 disabled').replace(/<nav>[\s\S]*?<\/nav>/, '<nav><h1>Реестр процессов<br><span style="font-weight:400;font-size:12px">' + require('./lib/profile.js').load().org.navSub + ' · снимок ' + new Date().toISOString().slice(0, 10) + ', только для чтения</span></h1></nav>').replace(/href="\/[^"]*"/g, 'href="#"');
    const idx = [];
    for (const x of items){
      const html = strip(await (await fetch(base + '/process/' + encodeURIComponent(x.p.id))).text());
      const f = path.join(dir, x.p.id + '.html'); fs.writeFileSync(f, html); idx.push(f); console.log(f);
    }
    if (items.length > 1){ const p = path.join(dir, 'портфель.html'); fs.writeFileSync(p, strip(await (await fetch(base + '/')).text())); console.log(p); }
    srv.close();
  });
} else if (cmd === 'polozhenie'){
  const pz = require('./lib/polozhenie.js');
  pz.run({ force: process.argv.includes('--force') }).then(() => { const e = pz.exportXlsx(); console.log('Excel:', e.out, '| процессов', e.n, '| расхождений', e.diff, '| функций без процессов', e.gaps); });
} else if (cmd === 'polozhenie-export'){
  const e = require('./lib/polozhenie.js').exportXlsx(); console.log(e.out, '| процессов', e.n, '| расхождений', e.diff);
} else if (cmd === 'serve'){
  require('./server.js').start();
} else {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].split('\n').slice(1).join('\n'));
}

module.exports = { assessAll };
