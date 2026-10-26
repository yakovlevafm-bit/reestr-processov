/* ================================================================
   Хранилище: JSON-файлы в data/ (данные остаются на этом компьютере).
     processes.json — реестр после импорта
     facts.json     — факты {id, pid, name, value, unit, period, source, role, status, basis, by, at}
     manual.json    — ручные оценки критериев {pid: {key: {score, basis}}}
     cards.json     — карточка: {pid: {pilot, solution, mvp, hyps:[{text, effect, status}], notes, history:[]}}
     staff.json     — штат [{dept, position, rate, occupied, hoursPerRate}]
     versions.json  — редакции реестра [{n, file, sheet, at, rows, added, removed, changed}], снимки в data/versions/
     config.json    — настройки (localAddress для «Моста» и т. п.)
     log.jsonl      — журнал действий
   Факт: {id, pid, name, value, unit, period, source, role, status, basis, by, at, quote?, check?, replaces?, stale?}
     status: ai | proposed | verified | rejected | superseded (см. lib/method.js)
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
// где лежат данные (JSON-файлы или SQLite, каталог REESTR_DATA или data/) — lib/storage.js
const ST = require('./storage.js');
const { ROOT, DATA } = ST;
const B = () => ST.backend();
const doc = n => n.replace(/\.json$/, '');
const load = (n, def) => B().get(doc(n), def);
const save = (n, v) => B().put(doc(n), v);
const now = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const log = o => B().appendLog({ at: now(), ...o });
// настройки — всегда файл config.json в каталоге данных (из него же читается, какое хранилище включено)
const cfgFile = () => path.join(DATA, 'config.json');
const loadConfig = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const saveConfigFile = v => { fs.mkdirSync(DATA, { recursive: true }); const t = cfgFile() + '.tmp-' + process.pid; fs.writeFileSync(t, JSON.stringify(v, null, 1)); fs.renameSync(t, cfgFile()); };

const FACT_NAMES = {
  format: 'Цифровой формат', machine: 'Машиночитаемость', paper: 'Бумажность', count: 'Количество выполнений в год',
  hours: 'Активное время на один случай', annual: 'Годовой объём труда (чел.-ч/год)', problem: 'Проблемность (1–5)', term: 'Срок выполнения', other: 'Другое',
};
const FACT_UNITS = { count: 'случаев/год', hours: 'чел.-ч/случай', annual: 'чел.-ч/год', term: 'дней', problem: '', format: '', machine: '', paper: '', other: '' };

const store = {
  processes(){ return load('processes.json', { processes: [], meta: {} }); },
  saveProcesses(v){ save('processes.json', v); },
  facts(){ return load('facts.json', []); },
  saveFacts(v){ save('facts.json', v); },
  manual(){ return load('manual.json', {}); },
  saveManual(v){ save('manual.json', v); },
  cards(){ return load('cards.json', {}); },
  saveCards(v){ save('cards.json', v); },
  staff(){ return load('staff.json', []); },
  saveStaff(v){ save('staff.json', v); },
  versions(){ return load('versions.json', []); },
  saveVersions(v){ save('versions.json', v); },
  config(){ return loadConfig(); },
  saveConfig(v){ saveConfigFile(v); },
  doc(name, def){ return load(name, def); },
  saveDoc(name, v){ save(name, v); },
  readLog(){ return B().readLog(); },
  backup(dir){ return B().backup(dir); },
  storageInfo(){ return B().info(); },
  log, now, FACT_NAMES, FACT_UNITS,

  // изменения одной записи — атомарно (блокировка файла или транзакция SQLite): параллельные процессы не затирают друг друга
  addFact(f){ B().update('facts', [], all => { f.id = 'f' + (all.length + 1) + '-' + Date.now().toString(36); f.at = now(); all.push(f); }); log({ act: 'fact', pid: f.pid, name: f.name, status: f.status }); return f; },
  setFactStatus(id, status, patch = {}){ const f = B().update('facts', [], all => { const x = all.find(y => y.id === id); if (x) Object.assign(x, patch, { status, at: now() }); return x || null; }); if (f) log({ act: 'fact_' + status, id, pid: f.pid }); return f; },
  /** Подтверждение: без основания не принимается; изменённое значение не затирает исходное — старый факт
      получает статус «заменено», новый подтверждённый ссылается на него (история сохраняется). */
  verifyFact(id, { value, period, role, basis, by }){
    if (!String(basis || '').trim()) throw new Error('Без основания (источник, дата, кто проверил) факт не подтверждается');
    const r = B().update('facts', [], all => {
      const f = all.find(x => x.id === id); if (!f) throw new Error('Факт не найден');
      const changed = String(value ?? '').trim() !== '' && String(value).trim() !== String(f.value).trim();
      if (!changed){ Object.assign(f, { period: period || f.period, role: role || f.role, basis, by, status: 'verified', at: now(), stale: undefined }); return { fact: f, ev: { act: 'fact_verified', id, pid: f.pid } }; }
      f.status = 'superseded'; f.at = now();
      const nf = { id: 'f' + (all.length + 1) + '-' + Date.now().toString(36), at: now(), pid: f.pid, name: f.name, value: isNaN(parseFloat(String(value).replace(',', '.'))) ? value : parseFloat(String(value).replace(/\s/g, '').replace(',', '.')), unit: f.unit, period: period || f.period, source: f.source, role, status: 'verified', basis, by, replaces: f.id, quote: f.quote };
      all.push(nf); return { fact: nf, ev: { act: 'fact_replaced', id, by: nf.id, pid: f.pid } };
    });
    log(r.ev); return r.fact;
  },
  card(pid){ const c = this.cards(); return c[pid] || { pilot: false, solution: '', mvp: '', hyps: null, notes: '', history: [] }; },
  saveCard(pid, patch, who = 'оператор'){ const next = B().update('cards', {}, c => { const cur = c[pid] || { pilot: false, solution: '', mvp: '', hyps: null, notes: '', history: [] }; const nx = { ...cur, ...patch }; nx.history = [...(cur.history || []), { at: now(), who, what: Object.keys(patch).join(', ') }].slice(-50); c[pid] = nx; return nx; }); log({ act: 'card', pid, what: Object.keys(patch) }); return next; },
};

/* ---------- первичное наполнение фактов из реестра (статус proposed — «предложение из реестра») ---------- */
function seedFromRegistry(reg, source){
  const facts = store.facts(); const have = new Set(facts.map(f => f.pid + '|' + f.name + '|' + f.source));
  let n = 0;
  const add = f => { const k = f.pid + '|' + f.name + '|' + f.source; if (have.has(k)) return; have.add(k); facts.push({ id: 'f' + (facts.length + 1) + '-seed', at: now(), by: 'импорт', ...f }); n++; };
  for (const p of reg.processes){
    const src = `${source} · строка ${p.row}`;
    if (p.format) add({ pid: p.id, name: 'format', value: p.format, unit: '', period: '2025', source: src + ' · колонка Q', role: 'реестр', status: 'proposed' });
    if (p.machine) add({ pid: p.id, name: 'machine', value: p.machine, unit: '', period: '2025', source: src + ' · колонка R', role: 'реестр', status: 'proposed' });
    if (p.paper) add({ pid: p.id, name: 'paper', value: p.paper, unit: '', period: '2025', source: src + ' · колонка P', role: 'реестр', status: 'proposed' });
    if (p.perYear !== null) add({ pid: p.id, name: 'count', value: p.perYear, unit: 'случаев/год', period: '2025', source: src + ' · колонка L', role: 'реестр', status: 'proposed', basis: p.perYear >= 1000 ? 'крупное значение — уточнить, экземпляры это или документы' : '' });
    if (p.hours !== null){
      const doubt = p.hours > 100 || (p.perYear && p.hours * p.perYear > 5000);
      add({ pid: p.id, name: 'hours', value: p.hours, unit: p.hoursUnit ? 'чел.-' + p.hoursUnit + '/случай' : 'чел.-ч/случай (единица в реестре не указана)', period: '2025', source: src + ' · колонка K', role: 'реестр', status: 'proposed',
        basis: doubt ? `сомнительно: ${p.hours} × ${p.perYear ?? '?'} = ${Math.round(p.hours * (p.perYear || 1)).toLocaleString('ru')} ч/год — возможно, минуты или часы за год` : '' });
    }
  }
  store.saveFacts(facts); log({ act: 'seed', n }); return n;
}

module.exports = { store, seedFromRegistry, ROOT, DATA };
