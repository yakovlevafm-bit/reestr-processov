/* ================================================================
   Хранилище данных ведомства — две реализации за одним интерфейсом:
     json   — файлы в каталоге данных (как раньше), запись атомарная (tmp → rename),
              изменения «прочитал-изменил-записал» — под файловой блокировкой;
     sqlite — один файл reestr.sqlite (встроенный node:sqlite, Node ≥ 22), документы
              в таблице docs, журнал в таблице log, изменения — в транзакции BEGIN IMMEDIATE.
   Интерфейс: get(name, def) · put(name, value) · update(name, def, fn) · appendLog(obj) · readLog() · backup(dir) · info()
   Каталог данных: REESTR_DATA, иначе <корень>/data. Хранилище: REESTR_STORAGE, иначе config.json → storage, иначе json.
   config.json всегда остаётся файлом — из него читается, какое хранилище включено.
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const DATA = process.env.REESTR_DATA ? path.resolve(process.env.REESTR_DATA) : path.join(ROOT, 'data');
// каталог выгрузок (анкеты, отчёты, снимки): REESTR_EXPORT, иначе <корень>/export — у каждого ведомства свой
const EXPORT = process.env.REESTR_EXPORT ? path.resolve(process.env.REESTR_EXPORT) : path.join(ROOT, 'export');
const BUSY = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY']);
const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function readConfig(){ try { return JSON.parse(fs.readFileSync(path.join(DATA, 'config.json'), 'utf8')); } catch { return {}; } }

/* ---------- JSON-файлы ---------- */
function jsonBackend(){
  const F = n => path.join(DATA, n + (n.includes('.') ? '' : '.json'));
  // Windows: пока другой процесс читает или удаляет файл, rename/открытие дают EPERM/EBUSY — повторяем
  const retry = fn => { for (let i = 0; ; i++){ try { return fn(); } catch (e){ if (!BUSY.has(e.code) || i > 500) throw e; sleep(5 + Math.random() * 10); } } };
  const writeAtomic = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp-' + process.pid; fs.writeFileSync(tmp, text); retry(() => fs.renameSync(tmp, file)); };
  const get = (name, def) => { let t; try { t = retry(() => fs.readFileSync(F(name), 'utf8')); } catch { return def; } try { return JSON.parse(t); } catch { return def; } };
  const put = (name, value) => writeAtomic(F(name), JSON.stringify(value, null, 1));
  // блокировка на время «прочитал-изменил-записал»: файл <имя>.lock, зависшая (старше 30 с) снимается
  function withLock(name, fn){
    const lock = F(name) + '.lock'; fs.mkdirSync(DATA, { recursive: true });
    for (let i = 0; ; i++){
      try { fs.writeFileSync(lock, String(process.pid), { flag: 'wx' }); break; }
      catch (e){ if (!BUSY.has(e.code)) throw e; try { if (Date.now() - fs.statSync(lock).mtimeMs > 30000) fs.unlinkSync(lock); } catch {} if (i > 3000) throw new Error('хранилище занято: ' + lock); sleep(10); }
    }
    try { return fn(); } finally { try { fs.unlinkSync(lock); } catch {} }
  }
  const update = (name, def, fn) => withLock(name, () => { const v = get(name, def); const r = fn(v); put(name, v); return r; });
  const appendLog = o => { fs.mkdirSync(DATA, { recursive: true }); fs.appendFileSync(path.join(DATA, 'log.jsonl'), JSON.stringify(o) + '\n'); };
  const readLog = () => { try { return fs.readFileSync(path.join(DATA, 'log.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const backup = (dir, names = ['facts', 'cards']) => { fs.mkdirSync(dir, { recursive: true }); for (const n of names) if (fs.existsSync(F(n))) fs.copyFileSync(F(n), path.join(dir, path.basename(F(n)))); return dir; };
  return { kind: 'json', get, put, update, appendLog, readLog, backup, info: () => ({ kind: 'json', dir: DATA }) };
}

/* ---------- SQLite (node:sqlite) ---------- */
function sqliteBackend(file = path.join(DATA, 'reestr.sqlite')){
  const { DatabaseSync } = require('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // busy_timeout — первым: смена журнала на WAL и создание таблиц берут блокировку, и при одновременном
  // открытии несколькими процессами без него сразу падают «database is locked»; на всякий случай — повтор
  db.exec('PRAGMA busy_timeout = 30000');
  for (let i = 0; ; i++){
    try { db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS docs (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS log (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, act TEXT, json TEXT NOT NULL);`); break; }
    catch (e){ if (!/locked|busy/i.test(e.message) || i >= 50) throw e; sleep(100); }
  }
  const qGet = db.prepare('SELECT json FROM docs WHERE name = ?');
  const qPut = db.prepare('INSERT INTO docs (name, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at');
  const qLog = db.prepare('INSERT INTO log (at, act, json) VALUES (?, ?, ?)');
  const stamp = () => new Date().toISOString();
  const get = (name, def) => { const r = qGet.get(name); return r ? JSON.parse(r.json) : def; };
  const put = (name, value) => { qPut.run(name, JSON.stringify(value), stamp()); };
  const update = (name, def, fn) => {
    db.exec('BEGIN IMMEDIATE');
    try { const v = get(name, def); const r = fn(v); put(name, v); db.exec('COMMIT'); return r; }
    catch (e){ try { db.exec('ROLLBACK'); } catch {} throw e; }
  };
  const appendLog = o => { qLog.run(o.at || '', o.act || '', JSON.stringify(o)); };
  const readLog = () => db.prepare('SELECT json FROM log ORDER BY id').all().map(r => JSON.parse(r.json));
  const backup = dir => { fs.mkdirSync(dir, { recursive: true }); const to = path.join(dir, 'reestr.sqlite'); if (fs.existsSync(to)) fs.unlinkSync(to); db.exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`); return dir; };
  const names = () => db.prepare('SELECT name, length(json) AS size, updated_at FROM docs ORDER BY name').all();
  return { kind: 'sqlite', get, put, update, appendLog, readLog, backup, names, close: () => db.close(), info: () => ({ kind: 'sqlite', file }) };
}

let current = null;
function backend(){
  if (current) return current;
  const kind = process.env.REESTR_STORAGE || readConfig().storage || 'json';
  current = kind === 'sqlite' ? sqliteBackend() : jsonBackend();
  return current;
}

/** Перенос JSON → SQLite (рабочий JSON не меняется). Возвращает, что перенесено. */
function migrateJsonToSqlite(file){
  const J = jsonBackend(), S = sqliteBackend(file);
  const DOCS = ['processes', 'facts', 'manual', 'cards', 'staff', 'versions', 'polozhenie_gaps'];
  const out = {};
  for (const n of DOCS){ const v = J.get(n, undefined); if (v === undefined) continue; S.put(n, v); out[n] = Array.isArray(v) ? v.length : v && v.processes ? v.processes.length : Object.keys(v || {}).length; }
  const log = J.readLog(); for (const o of log) S.appendLog(o); out.log = log.length;
  S.close(); return out;
}

module.exports = { backend, jsonBackend, sqliteBackend, migrateJsonToSqlite, readConfig, DATA, EXPORT, ROOT };
