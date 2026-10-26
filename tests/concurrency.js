// Одновременная запись из нескольких процессов: ни одна карточка и ни один факт не должны потеряться.
// node tests/concurrency.js            — оба хранилища (json, sqlite) во временных каталогах
// (запускает сам себя дочерними процессами: node tests/concurrency.js child <n> <m>)
'use strict';
const fs = require('fs'), path = require('path'), os = require('os');
const { spawn } = require('child_process');

if (process.argv[2] === 'child'){
  const { store } = require('../lib/store.js');
  const n = +process.argv[3], m = +process.argv[4];
  for (let i = 0; i < m; i++){
    store.saveCard(`T-${n}-${i}`, { notes: `процесс ${n}, запись ${i}` }, 'тест');
    store.addFact({ pid: `T-${n}-${i}`, name: 'count', value: i, unit: 'случаев/год', status: 'proposed', source: 'тест' });
  }
  process.exit(0);
}

const N = 4, M = 40;
async function run(kind){
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reestr-conc-'));
  fs.writeFileSync(path.join(dir, 'config.json'), '{}');
  const env = { ...process.env, REESTR_DATA: dir, REESTR_STORAGE: kind };
  const t0 = Date.now();
  await Promise.all(Array.from({ length: N }, (_, n) => new Promise((res, rej) => {
    const c = spawn(process.execPath, [__filename, 'child', String(n), String(M)], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    let err = ''; c.stderr.on('data', d => err += d); c.on('exit', code => code === 0 ? res() : rej(new Error(`${kind}: дочерний процесс ${n} — код ${code}: ${err.slice(0, 300)}`)));
  })));
  delete require.cache[require.resolve('../lib/storage.js')]; delete require.cache[require.resolve('../lib/store.js')];
  process.env.REESTR_DATA = dir; process.env.REESTR_STORAGE = kind;
  const { store } = require('../lib/store.js');
  const cards = Object.keys(store.cards()).filter(k => k.startsWith('T-')).length, facts = store.facts().length, ids = new Set(store.facts().map(f => f.id)).size;
  const want = N * M, ok = cards === want && facts === want && ids === want;
  console.log(`${kind.padEnd(6)} ${ok ? 'OK ' : 'ОШИБКА'} карточек ${cards}/${want}, фактов ${facts}/${want}, уникальных ID фактов ${ids}, ${Date.now() - t0} мс`);
  const b = require('../lib/storage.js').backend(); if (b.close) b.close();
  delete require.cache[require.resolve('../lib/storage.js')]; delete require.cache[require.resolve('../lib/store.js')];
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  return ok;
}
(async () => { const a = await run('json'), b = await run('sqlite'); process.exit(a && b ? 0 : 1); })().catch(e => { console.error(e.message); process.exit(1); });
