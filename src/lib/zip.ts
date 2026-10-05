import zlib from "node:zlib";

/**
 * 最小 ZIP 读取实现：只依赖 Node 内置模块，支持 STORED 与 DEFLATE 两种压缩方式。
 *
 * 之所以不引第三方库：需要读的 ZIP 只有两类 —— 本项目 archiver 产出的包，以及
 * 用户自己重新压缩过的包（Windows / macOS / 7-Zip 默认都是 deflate）。两者都在
 * 这里覆盖得到。写入仍由 `archiver` 负责（见 pack/service.ts）。
 *
 * 注意：`scripts/repair-pack.mjs` 里有一份等价实现（那边是 .mjs，无法直接复用
 * TypeScript 模块）。两处逻辑若改动需保持同步。
 */

export interface ZipEntry {
  name: string;
  content: Buffer;
  date: Date;
}

/** 从文件尾部向前找 EOCD（End Of Central Directory）签名。 */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** MS-DOS 时间格式 → Date。 */
function dosToDate(time: number, date: number): Date {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = Math.max((date >> 5) & 0x0f, 1);
  const day = Math.max(date & 0x1f, 1);
  return new Date(year, month - 1, day, (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2);
}

/**
 * 读出 ZIP 的条目（名称 + 解压后内容 + 修改时间）。
 *
 * 以中央目录为准：本地头在流式写入（带 data descriptor）时长度字段可能是 0，
 * 而中央目录里始终是最终值。
 *
 * `filter` 用于只取需要的条目（例如只读 `metadata.json`），命中的条目才解压，
 * 避免为了读一个几 KB 的清单把整包图片都 inflate 一遍。
 */
export function readZipEntries(buf: Buffer, filter?: (name: string) => boolean): ZipEntry[] {
  if (buf.length < 22) throw new Error("不是有效的 ZIP：文件过小");
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("不是有效的 ZIP：找不到 EOCD");
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) {
      throw new Error("ZIP 中央目录损坏");
    }
    const method = buf.readUInt16LE(off + 10);
    const time = buf.readUInt16LE(off + 12);
    const date = buf.readUInt16LE(off + 14);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      throw new Error(`ZIP 本地头损坏：${name}`);
    }
    const localNameLen = buf.readUInt16LE(localOff + 26);
    const localExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + localNameLen + localExtraLen;
    if (!filter || filter(name)) {
      const raw = buf.subarray(start, start + compSize);
      entries.push({
        name,
        content: method === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw),
        date: dosToDate(time, date)
      });
    }
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}
