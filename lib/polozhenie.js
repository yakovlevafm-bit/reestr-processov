/* ================================================================
   Сверка реестра процессов с Положением о министерстве через «Мост».
   ----------------------------------------------------------------
   1. Пачками по BATCH процессов модель относит каждый процесс к функциям
      Положения (разд. II, п. 3.2) или к категориям «обесп.» / «взаим.»,
      даёт уверенность 1–5 и замечание (дубль, вне компетенции, неясно).
      Результат — card.fn.ai; ключевые слова (lib/functions.js) остаются
      как card.fn.auto для сравнения.
   2. По функциям без процессов модель ищет, где они выполняются фактически,
      и предлагает, какой процесс должен появиться в реестре.
   3. Excel «Сверка реестра с Положением»: по процессам, по функциям,
      расхождения, функции без процессов.
   ================================================================ */
'use strict';
const fs = require('fs'), path = require('path');
const { store, ROOT } = require('./store.js');
const FN = require('./functions.js');
const bridge = require('./bridge.js');
const { buildXlsx, S } = require('./xlsxwrite.js');

const BATCH = 12;
const ALL = [...FN.FUNCTIONS, FN.SUPPORT, FN.INTERACT];
const fnList = () => ALL.map(f => `${f.id} — ${f.name}`).join('\n');

const PRF = require('./profile.js').load(); // ведомство и реквизиты положения — из профиля
const SYSTEM = `Ты аналитик процессов ${PRF.org.gen}. Дан перечень функций ${PRF.org.kindGen} по Положению (${PRF.functions.npa.title}) и процессы из реестра процессов ${PRF.org.kindGen}.
Задача: для каждого процесса указать, какие функции Положения он реализует.
Правила:
- 1–2 функции на процесс, самые точные; если процесс — внутреннее обеспечение органа (кадры, бухучёт, АХД, делопроизводство, ИТ), укажи «обесп.»; если это отчётность или запросы других органов власти без своей функции — «взаим.».
- Если процесс не относится ни к одной функции и не является обеспечением — укажи пустой список и объясни в note (возможно, вне компетенции ${PRF.org.kindGen} или функция в Положении не описана).
- В note кратко отметь проблемы формулировки: дубль другого процесса из списка, несколько процессов в одной строке, неясный вход/выход. Если проблем нет — пустая строка.
- confidence: 5 — очевидно, 3 — вероятно, 1 — догадка.
Отвечай ТОЛЬКО JSON: {"items":[{"id":"${PRF.org.idPrefix}-1","functions":["2.2"],"confidence":5,"note":""}]}`;

const GAP_SYSTEM = `Ты аналитик процессов ${PRF.org.gen}. Даны функции из Положения о ${PRF.org.kindPrep}, для которых в реестре процессов не нашлось ни одного процесса, и полный список названий процессов реестра.
Для каждой такой функции ответь: 1) какие процессы из списка фактически её реализуют (по названиям, если такие есть); 2) если нет — какой процесс должен быть добавлен в реестр: название, вход, выход, ориентировочная периодичность; 3) нужна ли вообще цифровизация (кратко).
Не выдумывай сведения о ${PRF.org.kindPrep}, опирайся только на список. Отвечай ТОЛЬКО JSON: {"gaps":[{"id":"2.6","found":["названия процессов из списка или пусто"],"proposed":{"name":"","input":"","output":"","period":""},"digital":"","comment":""}]}`;

function procText(p){ return `${p.id} | ${p.name} | группа: ${p.group || '—'} | вход: ${(p.input || '—').slice(0, 160)} | выход: ${(p.output || '—').slice(0, 160)} | отдел: ${p.owner || '—'}`; }
function parseJson(text){ const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error('в ответе нет JSON'); return JSON.parse(m[0]); }

async function run({ force = false, log = console.log } = {}){
  const reg = store.processes().processes; const cards = store.cards();
  const todo = reg.filter(p => force || !(cards[p.id] && cards[p.id].fn && cards[p.id].fn.ai));
  log(`Сверка с Положением: процессов ${reg.length}, к обработке ${todo.length}, пачек ${Math.ceil(todo.length / BATCH)}`);
  let tokens = 0, ok = 0, err = 0;
  for (let i = 0; i < todo.length; i += BATCH){
    const batch = todo.slice(i, i + BATCH);
    const user = `ФУНКЦИИ ПОЛОЖЕНИЯ:\n${fnList()}\n\nПРОЦЕССЫ РЕЕСТРА:\n${batch.map(procText).join('\n')}`;
    try {
      const r = await bridge.chat([{ role: 'system', content: SYSTEM }, { role: 'user', content: user }]);
      tokens += r.usage ? r.usage.total_tokens || 0 : 0;
      const j = parseJson(r.content); const items = j.items || [];
      for (const p of batch){
        const it = items.find(x => x.id === p.id); if (!it){ log(`${p.id} нет в ответе`); err++; continue; }
        const ids = (it.functions || []).map(String).filter(id => FN.byId[id]);
        store.saveCard(p.id, { fn: { auto: FN.classifyFunctions(p), ai: { functions: ids, confidence: +it.confidence || null, note: String(it.note || ''), at: new Date().toISOString().slice(0, 16).replace('T', ' '), model: r.model } } }, '«Мост»: Положение');
        ok++;
      }
      log(`пачка ${Math.floor(i / BATCH) + 1}: ${batch.length} процессов, ${(r.ms / 1000).toFixed(1)} с, токенов ${r.usage ? r.usage.total_tokens : '?'}`);
    } catch (e) { err += batch.length; log(`пачка ${Math.floor(i / BATCH) + 1} ОШИБКА: ${e.message}`); }
  }
  // функции без процессов — по объединённой привязке
  const cards2 = store.cards();
  const covered = new Set(); for (const p of reg) for (const id of FN.functionsOf(p, cards2[p.id]).ids) covered.add(id);
  const gaps = FN.FUNCTIONS.filter(f => !covered.has(f.id));
  let gapResult = null;
  if (gaps.length){
    try {
      const user = `ФУНКЦИИ БЕЗ ПРОЦЕССОВ:\n${gaps.map(f => `${f.id} — ${f.name}`).join('\n')}\n\nВСЕ ПРОЦЕССЫ РЕЕСТРА:\n${reg.map(p => `${p.id} ${p.name}`).join('\n')}`;
      const r = await bridge.chat([{ role: 'system', content: GAP_SYSTEM }, { role: 'user', content: user }]);
      tokens += r.usage ? r.usage.total_tokens || 0 : 0; gapResult = parseJson(r.content).gaps || [];
      store.saveDoc('polozhenie_gaps', { at: new Date().toISOString(), gaps: gapResult });
      log(`функции без процессов: ${gaps.length}, ответ получен`);
    } catch (e) { log(`функции без процессов ОШИБКА: ${e.message}`); }
  }
  log(`Готово: ${ok} процессов, ошибок ${err}, токенов ${tokens.toLocaleString('ru')}`);
  return { ok, err, tokens, gaps: gapResult };
}

function exportXlsx(){
  const reg = store.processes().processes; const cards = store.cards();
  const H = v => ({ v, s: S.HEAD }), T = v => ({ v, s: S.WRAP }), N = v => ({ v, s: S.NUM }), W = v => ({ v, s: S.WARN });
  const nm = ids => ids.map(id => id + ' ' + FN.nameOf(id)).join('; ');
  const rows = [['ID', 'Процесс', 'Отдел', 'Группа реестра', 'Функции по ключевым словам', 'Функции по «Мосту»', 'Совпадает', 'Уверенность', 'Замечание «Моста»', 'Итоговая привязка'].map(H)];
  const diff = [rows[0]];
  const perFn = {}; ALL.forEach(f => perFn[f.id] = { auto: 0, ai: 0, final: 0, pilot: 0 });
  for (const p of reg){
    const c = cards[p.id] || {}; const auto = FN.classifyFunctions(p); const ai = c.fn && c.fn.ai ? c.fn.ai : null; const fin = FN.functionsOf(p, c);
    const same = ai ? (auto.slice().sort().join(',') === ai.functions.slice().sort().join(',') ? 'да' : auto.some(x => ai.functions.includes(x)) ? 'частично' : 'нет') : '';
    const r = [p.id, T(p.name), T(p.owner), T(p.group), T(nm(auto)), T(ai ? nm(ai.functions) : ''), same === 'нет' ? W(same) : same, ai && ai.confidence ? N(ai.confidence) : '', T(ai ? ai.note : ''), T(nm(fin.ids) + (fin.source === 'ai' ? '' : ' (по ключевым словам)'))];
    rows.push(r); if (ai && (same !== 'да' || ai.note || !ai.functions.length)) diff.push(r);
    auto.forEach(id => perFn[id] && perFn[id].auto++); if (ai) ai.functions.forEach(id => perFn[id] && perFn[id].ai++); fin.ids.forEach(id => { if (perFn[id]){ perFn[id].final++; if (c.pilot) perFn[id].pilot++; } });
  }
  const fr = [['Пункт', 'Функция по Положению', 'Процессов по ключевым словам', 'Процессов по «Мосту»', 'Итого процессов', 'В пилоте 2026', 'Статус'].map(H)];
  for (const f of ALL){ const x = perFn[f.id]; fr.push([f.id, T(f.name), N(x.auto), N(x.ai), N(x.final), N(x.pilot), x.final ? '' : W('нет процессов в реестре')]); }
  const gapsDoc = store.doc('polozhenie_gaps', null); const gr = [['Пункт', 'Функция', 'Где выполняется фактически (по мнению «Моста»)', 'Предлагаемый процесс', 'Вход', 'Выход', 'Периодичность', 'Нужна ли цифровизация', 'Комментарий'].map(H)];
  if (gapsDoc){ for (const g of gapsDoc.gaps || []){ const pr = g.proposed || {}; gr.push([g.id, T(FN.nameOf(g.id)), T((g.found || []).join('; ')), T(pr.name || ''), T(pr.input || ''), T(pr.output || ''), T(pr.period || ''), T(g.digital || ''), T(g.comment || '')]); } }
  const dir = path.join(require('./storage.js').EXPORT); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'Сверка реестра с ' + PRF.functions.npa.short.replace(/^Положение/, 'Положением') + ' ' + new Date().toISOString().slice(0, 10) + '.xlsx');
  fs.writeFileSync(out, buildXlsx([
    { name: 'По процессам', rows, widths: [9, 55, 28, 26, 40, 40, 10, 10, 50, 40], freeze: 1, autoFilter: `A1:J${rows.length}` },
    { name: 'По функциям', rows: fr, widths: [8, 70, 14, 14, 12, 12, 28], freeze: 1 },
    { name: 'Расхождения', rows: diff, widths: [9, 55, 28, 26, 40, 40, 10, 10, 50, 40], freeze: 1, autoFilter: `A1:J${diff.length}` },
    { name: 'Функции без процессов', rows: gr, widths: [8, 45, 50, 40, 30, 30, 14, 30, 50], freeze: 1 },
  ]));
  return { out, n: rows.length - 1, diff: diff.length - 1, gaps: gr.length - 1 };
}

module.exports = { run, exportXlsx };
