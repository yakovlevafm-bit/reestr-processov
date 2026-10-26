/* ================================================================
   Классификация процессов и гипотезы автоматизации — по ключевым словам
   (правила — в профиле ведомства, profiles/<id>/rules.json)
   названия и входа. Каждая гипотеза помечена «требует проверки»: это
   стартовая точка для карточки, а не вывод.
   ================================================================ */
'use strict';

// типы процессов — из профиля ведомства (profiles/<id>/rules.json)
const P = require('./profile.js').load();
const RULES = P.rules.types;
const OTHER = P.rules.other;

function classify(p){
  const text = (p.name || '') + ' ' + (p.input || '') + ' ' + (p.group || '');
  for (const r of RULES){ if (r.re.test(text) && (!r.and || r.and.test(text))) return r; }
  return OTHER;
}

module.exports = { RULES, OTHER, classify };
