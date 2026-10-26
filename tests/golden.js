// Эталон расчётов реестра: снимок до рефакторинга и сверка после.
// node tests/golden.js save   — сохранить эталон в tests/golden/ (не в репозитории: там названия и владельцы процессов)
// node tests/golden.js check  — пересчитать и сравнить; выход 1 при любом расхождении
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { store } = require(ROOT + '/lib/store.js');
const { classify } = require(ROOT + '/lib/rules.js');
const v11 = require(ROOT + '/lib/method.js'), M2 = require(ROOT + '/lib/method_v2.js');
const { deptOf } = require(ROOT + '/lib/anketa.js');
const FN = require(ROOT + '/lib/functions.js');

function snapshot(){
  const reg = store.processes(), facts = store.facts(), manual = store.manual(), cards = store.cards();
  const out = {};
  for (const p of reg.processes){
    const f = facts.filter(x => x.pid === p.id), rule = classify(p), c = cards[p.id] || {};
    const a = v11.assess(p, f, rule, manual[p.id], c), b = M2.assessV2(p, f, rule, c);
    out[p.id] = {
      type: rule.type, key: rule.key, dept: deptOf(p.owner), fn: FN.functionsOf(p, c).ids,
      v11: { value: [a.value.min, a.value.max, a.value.exp], feas: [a.feas.min, a.feas.max, a.feas.exp], group: a.group, quadrant: a.quadrant, labor: a.labor, conf: a.confidence, items: Object.fromEntries(Object.entries(a.items).map(([k, i]) => [k, [i.min, i.max, i.sure]])) },
      v2: { B: b.B, K: b.K, P: [b.P.min, b.P.mode, b.P.max], IP: b.IP, conf: b.conf, score: b.score, effect: b.effect, suspect: b.suspect, gates: b.gatesFailed, method: b.method },
    };
  }
  return out;
}
const dir = path.join(__dirname, 'golden'), file = path.join(dir, 'assess.json');
const mode = process.argv[2];
if (mode === 'save'){ fs.mkdirSync(dir, { recursive: true }); const s = snapshot(); fs.writeFileSync(file, JSON.stringify(s, null, 1)); console.log('эталон сохранён:', Object.keys(s).length, 'процессов →', file); }
else if (mode === 'check'){
  const old = JSON.parse(fs.readFileSync(file, 'utf8')), now = snapshot(); const diffs = [];
  const walk = (a, b, p) => { if (JSON.stringify(a) === JSON.stringify(b)) return; if (a && b && typeof a === 'object' && typeof b === 'object'){ for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], p + '.' + k); } else diffs.push(`${p}: ${JSON.stringify(a)} → ${JSON.stringify(b)}`); };
  walk(old, now, '');
  if (diffs.length){ console.log('РАСХОЖДЕНИЙ:', diffs.length); diffs.slice(0, 40).forEach(d => console.log(' ', d)); process.exit(1); }
  console.log('эталон совпадает:', Object.keys(now).length, 'процессов');
} else console.log('node tests/golden.js save|check');
