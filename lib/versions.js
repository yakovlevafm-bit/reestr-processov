/* ================================================================
   Редакции реестра. Новый xlsx не затирает старый: процессы сопоставляются
   по названию (+ владелец), id сохраняются, у изменившихся строк
   подтверждённые факты помечаются «устарело» — их нужно перепроверить.
   ----------------------------------------------------------------
   importVersion(file) → { n, added, removed, changed, unchanged, stale }
   snapshots: data/versions/<n>.json (полный реестр редакции)
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { store, seedFromRegistry, DATA } = require('./store.js');
const { importRegistry } = require('./registry_import.js');

const VDIR = path.join(DATA, 'versions');
const key = p => (p.name || '').toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim().slice(0, 120);
const FIELDS = ['name', 'owner', 'group', 'status', 'client', 'input', 'output', 'kind', 'hoursRaw', 'perYearRaw', 'cross', 'crossWith', 'role', 'paper', 'format', 'machine', 'place'];
const FACT_COLS = { hoursRaw: 'hours', perYearRaw: 'count', format: 'format', machine: 'machine', paper: 'paper' };

function snapshot(n, reg){ fs.mkdirSync(VDIR, { recursive: true }); fs.writeFileSync(path.join(VDIR, n + '.json'), JSON.stringify(reg, null, 1)); }

/** Сопоставление: точное совпадение названия; при нескольких одинаковых — по владельцу, затем по порядку. */
function match(oldList, newList){
  const byKey = new Map(); for (const p of oldList){ const k = key(p); (byKey.get(k) || byKey.set(k, []).get(k)).push(p); }
  const pairs = [], used = new Set();
  for (const q of newList){
    const cands = (byKey.get(key(q)) || []).filter(p => !used.has(p.id));
    if (!cands.length){ pairs.push([null, q]); continue; }
    const p = cands.find(c => c.owner === q.owner) || cands.find(c => c.row === q.row) || cands[0];
    used.add(p.id); pairs.push([p, q]);
  }
  const removed = oldList.filter(p => !used.has(p.id));
  return { pairs, removed };
}

function importVersion(file){
  const cur = store.processes();
  const reg = importRegistry(file);
  const versions = store.versions();
  const n = (versions.length ? versions[versions.length - 1].n : (cur.processes.length ? 1 : 0)) + 1;
  if (!versions.length && cur.processes.length) snapshot(1, cur); // первая редакция — то, что было до этого импорта
  const result = { n, file: path.basename(file), sheet: reg.sheet, at: store.now(), rows: reg.processes.length, added: [], removed: [], changed: [], unchanged: 0, stale: 0, duplicates: reg.meta.duplicates };
  if (!cur.processes.length){
    store.saveProcesses(reg); snapshot(n, reg);
    result.added = reg.processes.map(p => ({ id: p.id, name: p.name }));
    result.facts = seedFromRegistry(reg, path.basename(file) + ' · лист «' + reg.sheet + '»');
    versions.push({ ...result, added: result.added.length, removed: 0, changed: 0 }); store.saveVersions(versions);
    return result;
  }
  const { pairs, removed: gone } = match(cur.processes, reg.processes);
  // процессы, добавленные вручную (source: 'manual', например по данным ДЕЛА), в xlsx нет — они не «исключены»,
  // а переносятся в новую редакцию как есть; если строка с таким названием появится в xlsx — сопоставится и станет обычной
  const keepManual = gone.filter(p => p.source === 'manual' || p.source === 'anketa'); // добавленные вручную или по анкетам отделов — не из xlsx
  const removed = gone.filter(p => p.source !== 'manual');
  let maxId = Math.max(...cur.processes.map(p => +(p.id.split('-')[1]) || 0), 0);
  const next = [];
  const facts = store.facts();
  for (const [p, q] of pairs){
    if (!p){ maxId++; const np = { ...q, id: require('./profile.js').load().org.idPrefix + '-' + maxId }; next.push(np); result.added.push({ id: np.id, name: np.name, row: q.row }); continue; }
    const diff = FIELDS.filter(f => (p[f] || '') !== (q[f] || ''));
    const np = { ...q, id: p.id, duplicateOf: q.duplicateOf ? (pairs.find(([pp, qq]) => pp && qq.id === q.duplicateOf) || [{}])[0].id || q.duplicateOf : undefined, prevRow: p.row !== q.row ? p.row : undefined };
    if (!np.duplicateOf) delete np.duplicateOf;
    next.push(np);
    if (!diff.length){ result.unchanged++; continue; }
    result.changed.push({ id: p.id, name: q.name, fields: diff.map(f => ({ field: f, was: p[f] || '', now: q[f] || '' })) });
    // изменилась исходная ячейка → подтверждения по этому факту устарели
    for (const f of diff){ const fn = FACT_COLS[f]; if (!fn) continue; for (const x of facts) if (x.pid === p.id && x.name === fn && x.status === 'verified' && !x.stale){ x.stale = `редакция ${n}: в реестре теперь «${(q[f] || '—').slice(0, 60)}», было «${(p[f] || '—').slice(0, 60)}»`; result.stale++; } }
  }
  next.push(...keepManual);
  result.removed = removed.map(p => ({ id: p.id, name: p.name, row: p.row }));
  const newReg = { sheet: reg.sheet, processes: next, meta: { ...reg.meta, version: n, previous: cur.meta, removedIds: removed.map(p => p.id) } };
  // удалённые из реестра строки остаются в архиве редакции, карточки и факты не трогаем
  store.saveProcesses(newReg); snapshot(n, newReg); store.saveFacts(facts);
  // факты из реестра добавляются только по новым строкам и по строкам, где изменились ячейки с фактами (старые предложения не дублируются)
  const seedIds = new Set([...result.added.map(x => x.id), ...result.changed.filter(x => x.fields.some(f => FACT_COLS[f.field])).map(x => x.id)]);
  result.facts = seedFromRegistry({ ...newReg, processes: next.filter(p => seedIds.has(p.id)) }, path.basename(file) + ' · лист «' + reg.sheet + '» · ред. ' + n);
  versions.push({ ...result, added: result.added.length, removed: result.removed.length, changed: result.changed.length });
  store.saveVersions(versions);
  fs.writeFileSync(path.join(VDIR, n + '-diff.json'), JSON.stringify(result, null, 1));
  store.log({ act: 'version', n, added: result.added.length, removed: result.removed.length, changed: result.changed.length, stale: result.stale });
  return result;
}

function diffOf(n){ try { return JSON.parse(fs.readFileSync(path.join(VDIR, n + '-diff.json'), 'utf8')); } catch { return null; } }
function archived(){ const m = store.processes().meta || {}; if (!m.removedIds || !m.removedIds.length) return []; const prev = m.version ? JSON.parse(fs.readFileSync(path.join(VDIR, (m.version - 1) + '.json'), 'utf8')) : null; return prev ? prev.processes.filter(p => m.removedIds.includes(p.id)) : []; }

module.exports = { importVersion, diffOf, archived, match, VDIR };
