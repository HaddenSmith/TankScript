import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';

// The upstream directory packer writes Windows separators. Java resources need '/'.
// Sorting also makes the custom archives independent of filesystem traversal order.
for (const name of ['compile-classlib-teavm.bin', 'runtime-classlib-teavm.bin']) {
  const file = new URL('./generated/assets/' + name, import.meta.url);
  const bytes = gunzipSync(await readFile(file));
  const entries = [];
  let offset = 0;
  while (offset < bytes.length) {
    const nameLength = bytes.readUInt16BE(offset); offset += 2;
    const entryName = bytes.subarray(offset, offset + nameLength).toString().replaceAll('\\', '/'); offset += nameLength;
    const dataLength = bytes.readUInt32BE(offset); offset += 4;
    const data = bytes.subarray(offset, offset + dataLength); offset += dataLength;
    entries.push({ entryName, data });
  }
  entries.sort((a,b) => a.entryName < b.entryName ? -1 : a.entryName > b.entryName ? 1 : 0);
  const parts = entries.map(({ entryName, data }) => {
    const name = Buffer.from(entryName);
    const header = Buffer.alloc(2); header.writeUInt16BE(name.length);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    return Buffer.concat([header, name, size, data]);
  });
  await writeFile(file, gzipSync(Buffer.concat(parts), { level: 9 }));
  console.log('Normalized', name, entries.length, 'entries');
}
