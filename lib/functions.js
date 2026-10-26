/* ================================================================
   Функции ведомства по положению о нём — список и реквизиты из профиля
   (profiles/<id>/functions.json). Каждый процесс реестра относится к одной
   или нескольким функциям по ключевым словам названия / входа / выхода /
   группы; что не подошло — «обеспечение деятельности» (кадры, АХД, бухучёт)
   или «взаимодействие с органами власти» (отчётность, запросы, штабы).
   В JS \w не видит кириллицу — только классы [а-яё].
   ================================================================ */
'use strict';

// функции, запасные категории и реквизиты положения — из профиля ведомства (profiles/<id>/functions.json)
const P = require('./profile.js').load();
const FUNCTIONS = P.functions.list;
const SUPPORT = P.functions.support;
const INTERACT = P.functions.interact;
const NPA = P.functions.npa;

function classifyFunctions(p){
  const text = [p.name, p.input, p.output, p.group, p.code].filter(Boolean).join(' · ');
  const hits = FUNCTIONS.filter(f => f.re.test(text)).map(f => f.id);
  if (hits.length) return hits;
  if (SUPPORT.re.test(text) || /^ВП/.test(p.code || '') || /обеспечива/i.test(p.group || '')) return [SUPPORT.id];
  if (INTERACT.re.test(text)) return [INTERACT.id];
  return [];
}

const byId = Object.fromEntries([...FUNCTIONS, SUPPORT, INTERACT].map(f => [f.id, f]));
const nameOf = id => (byId[id] || {}).name || id;

/** Итоговая привязка: ответ «ИИ-шлюза» (card.fn.ai), если есть, иначе ключевые слова */
function functionsOf(p, card){
  const ai = card && card.fn && card.fn.ai;
  if (ai && Array.isArray(ai.functions) && ai.functions.length) return { ids: ai.functions.filter(id => byId[id]), source: 'ai', confidence: ai.confidence, note: ai.note };
  return { ids: classifyFunctions(p), source: 'auto' };
}

const COUNT_II = NPA.countII; // число функций раздела II по положению (для доли покрытия)

module.exports = { FUNCTIONS, SUPPORT, INTERACT, NPA, classifyFunctions, functionsOf, nameOf, byId, COUNT_II };
