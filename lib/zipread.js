/**
 * Минимальный читатель ZIP на встроенном zlib.
 *
 * Зачем свой: 7-Zip получает аргументы в кодировке консоли Windows и ломается
 * на кириллице в путях («СУР1-М-1-0625-АХП-ВОР1.xlsx» → мусор). Node работает
 * с путями нативно, поэтому для xlsx/docx (это обычные zip) внешний архиватор
 * не нужен вовсе. 7-Zip остаётся только для rar/7z.
 */
const fs = require('node:fs');
const zlib = require('node:zlib');

const EOCD = 0x06054b50, EOCD64_LOC = 0x07064b50, EOCD64 = 0x06064b50;
const CEN = 0x02014b50, LOC = 0x04034b50;

function findEOCD(buf) {
  const min = Math.max(0, buf.length - 66_000);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD) return i;
  }
  throw new Error('это не zip: не найден EOCD');
}

/** Читает центральный каталог. Возвращает Map<имя, {offset, method, csize, size}>. */
function readDirectory(buf) {
  const eocd = findEOCD(buf);
  let count = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: если поля забиты 0xFFFFFFFF, настоящие значения в отдельной записи.
  if (cdOffset === 0xffffffff || count === 0xffff) {
    for (let i = eocd - 20; i >= 0; i--) {
      if (buf.readUInt32LE(i) === EOCD64_LOC) {
        const z64 = Number(buf.readBigUInt64LE(i + 8));
        if (buf.readUInt32LE(z64) === EOCD64) {
          count = Number(buf.readBigUInt64LE(z64 + 32));
          cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
        }
        break;
      }
    }
  }

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== CEN) break;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nLen = buf.readUInt16LE(p + 28);
    const eLen = buf.readUInt16LE(p + 30);
    const cLen = buf.readUInt16LE(p + 32);
    let offset = buf.readUInt32LE(p + 42);

    // Имена внутри ooxml всегда ASCII, но флаг 0x800 означает UTF-8.
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nLen);

    if (offset === 0xffffffff) {                       // ZIP64-расширение
      const ex = buf.subarray(p + 46 + nLen, p + 46 + nLen + eLen);
      for (let q = 0; q + 4 <= ex.length;) {
        const id = ex.readUInt16LE(q), len = ex.readUInt16LE(q + 2);
        if (id === 0x0001) {
          let r = q + 4;
          if (size === 0xffffffff) r += 8;
          if (csize === 0xffffffff) r += 8;
          offset = Number(ex.readBigUInt64LE(r));
          break;
        }
        q += 4 + len;
      }
    }
    entries.set(name, { offset, method, csize, size });
    p += 46 + nLen + eLen + cLen;
  }
  return entries;
}

function extract(buf, e) {
  if (buf.readUInt32LE(e.offset) !== LOC) throw new Error('битый локальный заголовок');
  const nLen = buf.readUInt16LE(e.offset + 26);
  const eLen = buf.readUInt16LE(e.offset + 28);
  const start = e.offset + 30 + nLen + eLen;
  const raw = buf.subarray(start, start + (e.csize || buf.length - start));
  if (e.method === 0) return raw;
  if (e.method === 8) return zlib.inflateRawSync(raw, { maxOutputLength: 256 * 1024 * 1024 }); // zip-бомба не распакуется дальше 256 МБ
  throw new Error(`неизвестный метод сжатия ${e.method}`);
}

/** Открывает zip-файл. entry(name) -> Buffer|null, names() -> string[]. */
function openZip(file) {
  const buf = fs.readFileSync(file);
  const dir = readDirectory(buf);
  return {
    names: () => [...dir.keys()],
    entry(name) {
      const e = dir.get(name);
      return e ? extract(buf, e) : null;
    },
    text(name) {
      const b = this.entry(name);
      return b ? b.toString('utf8') : null;
    },
  };
}

// ────────────────────────────── запись zip ──────────────────────────────

/**
 * Собирает zip из [{name, data}] — этого достаточно для docx/xlsx.
 * Пишем без ZIP64: наши документы заведомо меньше 4 ГБ.
 */
function createZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const body = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(LOC, 0);
    lh.writeUInt16LE(20, 4);            // версия
    lh.writeUInt16LE(0x800, 6);         // имена в UTF-8
    lh.writeUInt16LE(8, 8);             // deflate
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(CEN, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);

    offset += 30 + nameBuf.length + body.length;
  }

  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, cd, eocd]);
}

module.exports = { openZip, createZip };
