/* ================================================================
   Проверка чисел по цитате («доказательность»).
   ----------------------------------------------------------------
   Идея из «Реестра процессов и ресурсов · Мост» (минлесхоз): число,
   которое модель или человек приписывает факту, должно буквально
   стоять в цитате из источника, с той же единицей. Проверка не
   доказывает смысл — только что число не выдумано.

   numericGrounding(name, value, quote, sourceText)
     → { ok:true, rule }            число найдено в цитате
     → { ok:false, reason }         не найдено / цитаты нет в источнике
   numbersIn(text)                  → все числа в тексте (для сверки гипотез)
   unsupportedNumbers(text, source) → числа текста, которых нет в источнике
   ================================================================ */
'use strict';

const NUM = '(?<![\\wа-яё.,])[-+−]?(?:\\d{1,3}(?:[ \\u00a0\\u202f]\\d{3})+|\\d+)(?:[.,]\\d+)?(?![\\wа-яё.,]?\\d)';
const RE_NUM = new RegExp(NUM, 'g');
const RE_PCT = new RegExp('(' + NUM + ')\\s*(?:%|процент[а-яё]*)', 'gi');
const RE_TIME = new RegExp('(' + NUM + ')\\s*(чел\\.?[ -]*[.−-]?\\s*ч\\.?|человеко[ -]*час[а-яё]*|час[а-яё]*|ч\\.(?![а-яё])|ч(?![а-яё])|минут[а-яё]*|мин\\.?)(?![а-яё])', 'gi');
const RE_DAYS = new RegExp('(' + NUM + ')\\s*(?:дн[а-яё]*|д\\.|суток|календарн[а-яё]* дн[а-яё]*|рабочих дн[а-яё]*)', 'gi');
const RE_ANNUAL = /(?:в|за)\s+(?:(?:полный|весь|последний|прошлый)\s+)?(?:20\d{2}\s*г(?:од[а-яё]*|\.)|год[а-яё]*)|годов[а-яё]*|экземпляров в год|случаев\/год|в год|ежегодно|чел\.-ч\.?\/год/i;

const toNum = s => parseFloat(String(s).replace(/[\s  ]/g, '').replace(',', '.').replace('−', '-'));
const same = (a, b) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 1e-6);
const normText = s => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[\s  ]+/g, ' ').trim();

/** Число — не точка измерения, если это «не более», «до», «от», граница диапазона «8–24». */
function literalAt(text, start, end){
  const before = text.slice(Math.max(0, start - 45), start), after = text.slice(end, end + 35);
  // \b в JS не видит кириллицу — границы слов через (?:^|[^а-яё])
  if (/(?:^|[^а-яё])(?:не(?:\s+(?:более|менее|больше|меньше))?|до|от|около|примерно)\s*$|[<>≤≥~]\s*$/i.test(before)) return false;
  if (/\d\s*[-–—]\s*$/.test(before)) return false;
  if (/^\s*(?:[-–—]|до)\s*\d/i.test(after)) return false;
  return true;
}

function candidates(name, quote){
  const out = [];
  if (name === 'count'){
    for (const m of quote.matchAll(RE_NUM)){
      if (!literalAt(quote, m.index, m.index + m[0].length)) continue;
      const tail = quote.slice(m.index + m[0].length, m.index + m[0].length + 14);
      if (/^\s*(?:%|процент|год|г\.|км(?![а-яё])|га(?![а-яё])|гектар|тыс\.?\s*га|руб|млн|тыс\.? руб|ч(?![а-яё])|час|мин)/i.test(tail)) continue; // год, процент, деньги, время — не количество
      out.push([toNum(m[0]), 'число в цитате']);
    }
  } else if (name === 'hours'){
    for (const m of quote.matchAll(RE_TIME)){
      if (!literalAt(quote, m.index, m.index + m[1].length)) continue;
      const unit = m[2].toLowerCase(); const n = toNum(m[1]);
      // «ожидание 4 часа» — не активный труд
      const before = quote.slice(Math.max(0, m.index - 70), m.index).toLowerCase();
      if (/ожидани|ожидал|ждал|срок/.test(before) && !/активн|работ|обработ|труд|затрат/.test(before)) continue;
      out.push(unit.startsWith('мин') ? [n / 60, 'минуты ÷ 60'] : [n, 'часы в цитате']);
    }
    // в реестре единица стоит в заголовке колонки, а в ячейке — голое число
    if (!out.length) for (const m of quote.matchAll(RE_NUM)){ if (literalAt(quote, m.index, m.index + m[0].length)) out.push([toNum(m[0]), 'число без единицы (единица — из колонки реестра)']); }
  } else if (name === 'term'){
    for (const m of quote.matchAll(RE_DAYS)){ if (literalAt(quote, m.index, m.index + m[1].length)) out.push([toNum(m[1]), 'дни в цитате']); }
    if (!out.length) for (const m of quote.matchAll(RE_NUM)){ if (literalAt(quote, m.index, m.index + m[0].length)) out.push([toNum(m[0]), 'число без единицы']); }
  } else if (name === 'problem'){
    for (const m of quote.matchAll(RE_NUM)) out.push([toNum(m[0]), 'число в цитате']);
  } else {
    for (const m of quote.matchAll(RE_PCT)){ if (literalAt(quote, m.index, m.index + m[1].length)) out.push([toNum(m[1]), 'процент в цитате']); }
    for (const m of quote.matchAll(RE_NUM)){ if (literalAt(quote, m.index, m.index + m[0].length)) out.push([toNum(m[0]), 'число в цитате']); }
  }
  return out;
}

/**
 * Числовой факт обоснован цитатой? Для текстовых фактов (формат, машиночитаемость) проверяется только,
 * что цитата есть в источнике и значение в ней упомянуто.
 */
function numericGrounding(name, value, quote, sourceText){
  quote = String(quote || '').trim();
  if (!quote) return { ok: false, reason: 'нет цитаты' };
  if (sourceText && !normText(sourceText).includes(normText(quote))) return { ok: false, reason: 'цитаты нет в тексте источника' };
  const n = typeof value === 'number' ? value : toNum(value);
  if (!Number.isFinite(n)){
    // текстовое значение: ключевое слово значения должно быть в цитате
    const key = normText(value).split(' ').filter(w => w.length > 3)[0];
    return key && normText(quote).includes(key) ? { ok: true, rule: 'слово значения есть в цитате' } : { ok: false, reason: 'значение не упомянуто в цитате' };
  }
  if (name === 'count' && !RE_ANNUAL.test(quote) && !/в год|год/i.test(quote)) {
    // количество без указания года допускаем только если цитата — голая ячейка реестра («120»)
    if (!/^[\d\s.,]+$/.test(quote)) return { ok: false, reason: 'в цитате нет годового периода — месячные или разовые значения не пересчитываются' };
  }
  const c = candidates(name, quote);
  const hit = c.find(([v]) => same(n, v));
  if (hit) return { ok: true, rule: hit[1] };
  return { ok: false, reason: c.length ? `в цитате другие числа: ${[...new Set(c.map(x => x[0]))].slice(0, 5).join(', ')}` : 'в цитате нет числа с нужной единицей' };
}

/** Все числа текста как строки-ключи (нормализованные), кроме годов, номеров законов и нумерации «1)», «2.». */
function numbersIn(text){
  const out = [];
  const t = String(text || '');
  for (const m of t.matchAll(RE_NUM)){
    const s = m[0], after = t.slice(m.index + s.length, m.index + s.length + 6), before = t.slice(Math.max(0, m.index - 12), m.index);
    const n = toNum(s);
    if (!Number.isFinite(n)) continue;
    if (n >= 1900 && n <= 2100 && /^\s*(г\.|год|-го|$)/.test(after)) continue;          // год
    if (/№\s*$|ФЗ|ОЗ|-ФЗ|приказ|постановл|закон/i.test(before) || /^\s*-?(ФЗ|ОЗ)/.test(after)) continue; // номер документа
    if (/^[.)]\s/.test(after) && m.index < 3) continue;                                   // нумерация в начале
    if (/(?:^|[^а-яё])(п|пп|ст|ч)\.\s*$/i.test(before)) continue;                         // пункт, статья
    out.push({ n, s, pos: m.index, ctx: t.slice(Math.max(0, m.index - 30), m.index + s.length + 30).replace(/\s+/g, ' ') });
  }
  return out;
}

/** Числа текста, выданные за текущее состояние (с единицей труда/объёма), которых нет среди чисел источника.
    Цели («до 10 ч», «≈ 2 чел-ч»), объёмы пилота («на 5 заявках за 3 месяца») и проценты эффекта — оценки модели, не флагуются. */
function unsupportedNumbers(text, sourceText){
  const src = new Set(numbersIn(sourceText).map(x => x.n));
  const srcList = [...src];
  const t = String(text || '');
  return numbersIn(t).filter(x => {
    if (src.has(x.n)) return false;
    const before = t.slice(Math.max(0, x.pos - 40), x.pos), after = t.slice(x.pos + x.s.length, x.pos + x.s.length + 25);
    if (!/^\s*(?:чел|ч(?![а-яё])|час|мин|случа|заяв|обращ|документ|отч[её]т|пис[ье]м|дел(?![а-яё])|экз|запрос|шт|свидетельств|проверк|договор|в год|тыс|млн)/i.test(after)) return false; // без единицы факта — не утверждение
    if (/(?:до|<|≤|≥|>|≈|~|около|примерно|не более|не менее|на|за|в течение|из|для|по|пилот[^.]{0,40}|тест[^.]{0,30})\s*$/i.test(before)) return false; // цель или объём пилота
    if (/\d\s*[-–—‑]\s*$/.test(before)) return false;                                         // вторая граница диапазона «3‑4»
    if (/[А-ЯЁ]{1,4}[‑-]$/.test(before)) return false;                                        // код формы: ГП‑87
    // утверждение о текущем состоянии: «с 20 чел-ч до…», «сейчас 30 ч», «занимает 2 ч», «составляет …», либо годовой объём
    if (!/(?:(?:^|[^а-яё])с|сейчас|сегодня|в настоящее время|текущ[а-яё]*|занимает|тратит(?:ся)?|требует(?:ся)?|составляет|уходит|вручную)\s*(?:[—–-]\s*)?$/i.test(before) && !/в год|\/год/i.test(after)) return false;
    if (srcList.some(v => same(x.n, v * 60) || same(x.n, v / 60))) return false;             // перевод минут/часов
    if (/%/.test(x.ctx) && x.n <= 100) return false;
    return true;
  });
}

module.exports = { numericGrounding, numbersIn, unsupportedNumbers, normText };
