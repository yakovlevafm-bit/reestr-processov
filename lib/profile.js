/* ================================================================
   Профиль ведомства. Ядро не знает о конкретном органе власти: название,
   подразделения, типы процессов, функции по положению, контекст для ИИ —
   в profiles/<id>/ (profile.json, rules.json, functions.json).
   Какой профиль: переменная REESTR_PROFILE, иначе data/config.json → profile, иначе mcx-lo.
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');

let cache = null;
function profileId(){
  if (process.env.REESTR_PROFILE) return process.env.REESTR_PROFILE;
  const c = require('./storage.js').readConfig(); if (c.profile) return c.profile; // config.json в каталоге данных (REESTR_DATA или data/)
  // профиль не задан: единственный установленный, иначе первый по алфавиту (demo-kultura — пример в поставке)
  const dirs = fs.existsSync(path.join(ROOT, 'profiles')) ? fs.readdirSync(path.join(ROOT, 'profiles')).filter(d => fs.existsSync(path.join(ROOT, 'profiles', d, 'profile.json'))).sort() : [];
  const real = dirs.filter(d => !/^demo-/.test(d));
  return real.length === 1 ? real[0] : (dirs[0] || 'demo-kultura');
}
const rx = o => o ? new RegExp(o.re, o.flags) : null;

function load(){
  if (cache) return cache;
  const id = profileId(), dir = path.join(ROOT, 'profiles', id);
  if (!fs.existsSync(path.join(dir, 'profile.json'))) throw new Error(`Профиль ведомства «${id}» не найден: ${dir}`);
  const read = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  const p = read('profile.json');
  // подразделения
  const match = p.departments.match.map(m => [rx(m), m.to]);
  const official = (p.departments.official || []).map(m => [rx(m), m.to]);
  const deptOf = owner => { const o = (owner || '').trim(); if (!o) return p.departments.empty; for (const [re, d] of match) if (re.test(o)) return d || o; return o; };
  const officialOf = owner => { const d = deptOf(owner); for (const [re, to] of official) if (re.test(d)) return to; return d; };
  // типы процессов
  const R = read('rules.json');
  const types = R.types.map(t => ({ key: t.key, re: rx(t.match), ...(t.and ? { and: rx(t.and) } : {}), type: t.type, hyps: t.hyps, mvp: t.mvp, tool: t.tool, feas: t.feas, repeat: t.repeat }));
  // функции по положению (~ — окончание слова)
  const F = read('functions.json');
  const fn = f => ({ id: f.id, name: f.name, re: new RegExp(f.re.split('~').join(F.tilde), f.flags) });
  cache = { id, dir, ...p, deptOf, officialOf, rules: { types, other: R.other }, functions: { npa: F.npa, list: F.functions.map(fn), support: fn(F.support), interact: fn(F.interact) } };
  return cache;
}
const reset = () => { cache = null; }; // для тестов: сменить профиль

module.exports = { load, reset, profileId };
