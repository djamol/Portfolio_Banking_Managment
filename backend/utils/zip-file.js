const zlib = require('zlib');

/** CRC-32 (ISO 3309 / ZIP) */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * Build a ZIP archive containing a single file (DEFLATE).
 * @param {string} entryName name inside the zip (e.g. portfolio.sql)
 * @param {Buffer|string} content file contents
 * @returns {Buffer}
 */
function createSingleFileZip(entryName, content) {
  const nameBuf = Buffer.from(String(entryName), 'utf8');
  const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
  const compressed = zlib.deflateRawSync(data, { level: 9 });
  const checksum = crc32(data);
  const now = new Date();
  // DOS time/date
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((Math.floor(now.getSeconds() / 2) & 0x1f));
  const dosDate =
    (((now.getFullYear() - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0xf) << 5) |
    (now.getDate() & 0x1f);

  const localHeader = Buffer.concat([
    u32(0x04034b50),
    u16(20), // version needed
    u16(0), // flags
    u16(8), // deflate
    u16(dosTime),
    u16(dosDate),
    u32(checksum),
    u32(compressed.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0), // extra length
    nameBuf
  ]);

  const centralHeader = Buffer.concat([
    u32(0x02014b50),
    u16(20), // version made by
    u16(20), // version needed
    u16(0),
    u16(8),
    u16(dosTime),
    u16(dosDate),
    u32(checksum),
    u32(compressed.length),
    u32(data.length),
    u16(nameBuf.length),
    u16(0), // extra
    u16(0), // comment
    u16(0), // disk start
    u16(0), // int attr
    u32(0), // ext attr
    u32(0), // relative offset of local header
    nameBuf
  ]);

  const endRecord = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(centralHeader.length),
    u32(localHeader.length + compressed.length),
    u16(0)
  ]);

  return Buffer.concat([localHeader, compressed, centralHeader, endRecord]);
}

module.exports = {
  createSingleFileZip,
  crc32
};
