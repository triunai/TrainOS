/**
 * A tiny, dependency-free JPEG writer for demo session photos.
 *
 * The golden path needs "photos" whose EXIF says where and when they were
 * taken (GPS at the venue, DateTimeOriginal inside the training days), so the
 * real `evidence.photo_exif` handler can verify them. Pulling in an image
 * library (or Python) for that would make the demo depend on more than the
 * app does, so this file writes the bytes itself:
 *
 *   SOI
 *   APP1  "Exif\0\0" + a big-endian TIFF block:
 *           IFD0      Make, Model, Orientation, -> Exif IFD, -> GPS IFD
 *           Exif IFD  ExifVersion, DateTimeOriginal, CreateDate,
 *                     OffsetTimeOriginal, PixelX/YDimension
 *           GPS IFD   GPSVersionID, Lat/Lng refs and DMS rationals
 *   DQT, SOF0 (baseline, 3 components, 4:4:4), DHT (DC + AC), SOS
 *   entropy-coded data, EOI
 *
 * The picture is a flat-colour-per-8x8-block image: every block carries only
 * its DC coefficient and an end-of-block, which keeps the encoder to a page
 * while still producing a valid baseline JPEG any decoder opens. `scene`
 * paints one RGB colour per block, so a demo photo can look like a room.
 */

export interface ExifPhotoSpec {
  /** Decimal degrees; south / west are negative. */
  lat: number;
  lng: number;
  /** Local wall-clock time the camera recorded, `YYYY-MM-DDTHH:MM:SS`. */
  takenAt: string;
  /** The camera's UTC offset for `takenAt`, written as OffsetTimeOriginal. Omit to leave it out. */
  offset?: string | null;
  make?: string;
  model?: string;
  /** Pixel size; rounded up to whole 8x8 blocks. Defaults 160 x 120. */
  width?: number;
  height?: number;
  /** RGB (0-255) for the block at block column `bx`, block row `by`. */
  scene?: (bx: number, by: number, blocksWide: number, blocksHigh: number) => [number, number, number];
}

// ------------------------------------------------------------------ TIFF / EXIF

const TYPE = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5, UNDEFINED: 7 } as const;
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  /** The value, already serialised big-endian. */
  value: Uint8Array;
}

class ByteWriter {
  private readonly chunks: number[] = [];
  get length(): number {
    return this.chunks.length;
  }
  u8(v: number): this {
    this.chunks.push(v & 0xff);
    return this;
  }
  u16(v: number): this {
    return this.u8(v >>> 8).u8(v);
  }
  u32(v: number): this {
    return this.u16(v >>> 16).u16(v & 0xffff);
  }
  bytes(values: ArrayLike<number>): this {
    for (let i = 0; i < values.length; i += 1) this.u8(values[i]);
    return this;
  }
  toBytes(): Uint8Array {
    return Uint8Array.from(this.chunks);
  }
}

const ascii = (text: string): Uint8Array => {
  if (!/^[\x20-\x7e]*$/.test(text)) throw new Error(`EXIF ASCII value must be printable ASCII: ${text}`);
  return Uint8Array.from([...text].map((c) => c.charCodeAt(0)).concat(0));
};

const asciiEntry = (tag: number, text: string): IfdEntry => {
  const value = ascii(text);
  return { tag, type: TYPE.ASCII, count: value.length, value };
};

const shortEntry = (tag: number, v: number): IfdEntry => ({ tag, type: TYPE.SHORT, count: 1, value: new ByteWriter().u16(v).toBytes() });
const longEntry = (tag: number, v: number): IfdEntry => ({ tag, type: TYPE.LONG, count: 1, value: new ByteWriter().u32(v).toBytes() });

const rationalEntry = (tag: number, parts: Array<[number, number]>): IfdEntry => {
  const w = new ByteWriter();
  for (const [num, den] of parts) w.u32(num).u32(den);
  return { tag, type: TYPE.RATIONAL, count: parts.length, value: w.toBytes() };
};

/** Bytes an IFD occupies: count, entries, next-IFD pointer, then out-of-line values (word aligned). */
function ifdSize(entries: IfdEntry[]): number {
  let size = 2 + entries.length * 12 + 4;
  for (const e of entries) if (e.value.length > 4) size += e.value.length + (e.value.length % 2);
  return size;
}

/** Serialise one IFD that starts at `offset` (relative to the TIFF header). */
function writeIfd(w: ByteWriter, entries: IfdEntry[], offset: number): void {
  const sorted = [...entries].sort((a, b) => a.tag - b.tag);
  let dataOffset = offset + 2 + sorted.length * 12 + 4;
  const overflow: Uint8Array[] = [];
  w.u16(sorted.length);
  for (const e of sorted) {
    if (e.value.length !== TYPE_SIZE[e.type] * e.count) throw new Error(`EXIF tag 0x${e.tag.toString(16)} has a malformed value`);
    w.u16(e.tag).u16(e.type).u32(e.count);
    if (e.value.length <= 4) {
      w.bytes(e.value);
      for (let i = e.value.length; i < 4; i += 1) w.u8(0);
    } else {
      w.u32(dataOffset);
      overflow.push(e.value);
      dataOffset += e.value.length + (e.value.length % 2);
    }
  }
  w.u32(0); // no next IFD
  for (const value of overflow) {
    w.bytes(value);
    if (value.length % 2) w.u8(0);
  }
}

/** Decimal degrees to EXIF degrees/minutes/seconds rationals (seconds to 1/10000). */
export function toDmsRationals(decimal: number): Array<[number, number]> {
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutesFloat = (abs - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const seconds = Math.round((minutesFloat - minutes) * 60 * 10_000);
  return [
    [degrees, 1],
    [minutes, 1],
    [seconds, 10_000],
  ];
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

function exifDateTime(local: string): string {
  const m = LOCAL_TIME.exec(local);
  if (!m) throw new Error(`takenAt must be local time YYYY-MM-DDTHH:MM:SS, got ${local}`);
  return `${m[1]}:${m[2]}:${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

function tiffBlock(spec: ExifPhotoSpec, width: number, height: number): Uint8Array {
  if (!Number.isFinite(spec.lat) || Math.abs(spec.lat) > 90) throw new Error(`Latitude out of range: ${spec.lat}`);
  if (!Number.isFinite(spec.lng) || Math.abs(spec.lng) > 180) throw new Error(`Longitude out of range: ${spec.lng}`);
  if (spec.offset && !/^[+-]\d{2}:\d{2}$/.test(spec.offset)) throw new Error(`Offset must look like +08:00, got ${spec.offset}`);
  const when = exifDateTime(spec.takenAt);

  const exif: IfdEntry[] = [
    { tag: 0x9000, type: TYPE.UNDEFINED, count: 4, value: Uint8Array.from([0x30, 0x32, 0x33, 0x32]) }, // "0232"
    asciiEntry(0x9003, when), // DateTimeOriginal
    asciiEntry(0x9004, when), // CreateDate (DateTimeDigitized)
    ...(spec.offset ? [asciiEntry(0x9011, spec.offset)] : []), // OffsetTimeOriginal
    longEntry(0xa002, width),
    longEntry(0xa003, height),
  ];
  const gps: IfdEntry[] = [
    { tag: 0x0000, type: TYPE.BYTE, count: 4, value: Uint8Array.from([2, 3, 0, 0]) },
    asciiEntry(0x0001, spec.lat >= 0 ? "N" : "S"),
    rationalEntry(0x0002, toDmsRationals(spec.lat)),
    asciiEntry(0x0003, spec.lng >= 0 ? "E" : "W"),
    rationalEntry(0x0004, toDmsRationals(spec.lng)),
  ];
  const ifd0Base: IfdEntry[] = [
    asciiEntry(0x010f, spec.make ?? "Agentic TPMS"),
    asciiEntry(0x0110, spec.model ?? "Demo session camera"),
    shortEntry(0x0112, 1),
  ];
  // The pointer entries are fixed-size, so sizes are known before the offsets are.
  const ifd0Size = ifdSize([...ifd0Base, longEntry(0x8769, 0), longEntry(0x8825, 0)]);
  const exifOffset = 8 + ifd0Size;
  const gpsOffset = exifOffset + ifdSize(exif);
  const ifd0 = [...ifd0Base, longEntry(0x8769, exifOffset), longEntry(0x8825, gpsOffset)];

  const w = new ByteWriter();
  w.bytes([0x4d, 0x4d]).u16(0x002a).u32(8); // "MM", 42, IFD0 at 8
  writeIfd(w, ifd0, 8);
  writeIfd(w, exif, exifOffset);
  writeIfd(w, gps, gpsOffset);
  return w.toBytes();
}

// ------------------------------------------------------------------ baseline JPEG, DC only

/** ITU-T T.81 Annex K.3 luminance DC table (categories 0-11). */
const DC_BITS = [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0];
const DC_VALUES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
/** Every block ends straight after its DC value, so the AC table needs two symbols: EOB and ZRL. */
const AC_BITS = [0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
const AC_VALUES = [0x00, 0xf0];
/** The DC step: a uniform block's DC coefficient is 8 x (level - 128), so Q = 8 stores the level itself. */
const DC_QUANT = 8;

/** Canonical Huffman codes from the (bits, values) form a DHT segment carries. */
function huffmanCodes(bits: number[], values: number[]): Map<number, { code: number; length: number }> {
  const codes = new Map<number, { code: number; length: number }>();
  let code = 0;
  let k = 0;
  for (let length = 1; length <= 16; length += 1) {
    for (let i = 0; i < bits[length - 1]; i += 1) {
      codes.set(values[k], { code, length });
      code += 1;
      k += 1;
    }
    code <<= 1;
  }
  return codes;
}

class BitWriter {
  private readonly out: number[] = [];
  private acc = 0;
  private count = 0;
  write(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i -= 1) {
      this.acc = (this.acc << 1) | ((value >> i) & 1);
      this.count += 1;
      if (this.count === 8) this.flushByte();
    }
  }
  private flushByte(): void {
    this.out.push(this.acc);
    if (this.acc === 0xff) this.out.push(0x00); // byte stuffing
    this.acc = 0;
    this.count = 0;
  }
  /** Pad the last byte with 1-bits, as T.81 requires. */
  finish(): number[] {
    if (this.count > 0) this.write(0xff, 8 - this.count);
    return this.out;
  }
}

const clampByte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

function toYCbCr([r, g, b]: [number, number, number]): [number, number, number] {
  return [
    clampByte(0.299 * r + 0.587 * g + 0.114 * b),
    clampByte(128 - 0.168736 * r - 0.331264 * g + 0.5 * b),
    clampByte(128 + 0.5 * r - 0.418688 * g - 0.081312 * b),
  ];
}

/** A plain "training room": wall, a projected slide, a trainer, and rows of seated participants. */
export function trainingRoomScene(variant = 0) {
  return (bx: number, by: number, bw: number, bh: number): [number, number, number] => {
    const wall: [number, number, number] = variant % 2 ? [214, 205, 188] : [222, 214, 199];
    const floor: [number, number, number] = [120, 96, 72];
    const screenL = Math.floor(bw * 0.3);
    const screenR = Math.floor(bw * 0.7);
    if (by >= 1 && by <= Math.floor(bh * 0.45) && bx >= screenL && bx <= screenR) {
      if (by === 1) return [31, 91, 255]; // slide header bar
      return [246, 247, 249];
    }
    const trainerX = variant % 2 ? screenR + 2 : screenL - 2;
    if (bx === trainerX && by >= Math.floor(bh * 0.3) && by <= Math.floor(bh * 0.6)) return by === Math.floor(bh * 0.3) ? [92, 64, 51] : [24, 26, 31];
    if (by >= Math.floor(bh * 0.65)) {
      const row = by - Math.floor(bh * 0.65);
      const seat = (bx + row + variant) % 3 === 0;
      if (seat && row % 2 === 0) return [40 + ((bx * 37) % 60), 40 + ((bx * 53) % 50), 45 + ((bx * 29) % 70)];
      return floor;
    }
    return wall;
  };
}

function jpegBody(width: number, height: number, scene: NonNullable<ExifPhotoSpec["scene"]>): number[] {
  const bw = Math.ceil(width / 8);
  const bh = Math.ceil(height / 8);
  const out = new ByteWriter();

  // DQT: one table, DC step 8, every AC step 16 (no AC coefficient is ever coded).
  out.u16(0xffdb).u16(2 + 1 + 64).u8(0x00).u8(DC_QUANT);
  for (let i = 1; i < 64; i += 1) out.u8(16);

  // SOF0: 8-bit, height, width, three components (Y, Cb, Cr), 1x1 sampling, table 0.
  out.u16(0xffc0).u16(8 + 3 * 3).u8(8).u16(height).u16(width).u8(3);
  for (const id of [1, 2, 3]) out.u8(id).u8(0x11).u8(0);

  // DHT: DC table 0 and AC table 0.
  out.u16(0xffc4).u16(2 + 1 + 16 + DC_VALUES.length).u8(0x00).bytes(DC_BITS).bytes(DC_VALUES);
  out.u16(0xffc4).u16(2 + 1 + 16 + AC_VALUES.length).u8(0x10).bytes(AC_BITS).bytes(AC_VALUES);

  // SOS: all three components, spectral selection 0..63, no approximation.
  out.u16(0xffda).u16(6 + 2 * 3).u8(3);
  for (const id of [1, 2, 3]) out.u8(id).u8(0x00);
  out.u8(0).u8(63).u8(0);

  const dc = huffmanCodes(DC_BITS, DC_VALUES);
  const eob = huffmanCodes(AC_BITS, AC_VALUES).get(0x00);
  if (!eob) throw new Error("AC table has no end-of-block code");
  const bits = new BitWriter();
  const previous = [0, 0, 0];
  for (let by = 0; by < bh; by += 1) {
    for (let bx = 0; bx < bw; bx += 1) {
      const ycc = toYCbCr(scene(bx, by, bw, bh));
      for (let c = 0; c < 3; c += 1) {
        const level = ycc[c] - 128; // the quantised DC coefficient
        const diff = level - previous[c];
        previous[c] = level;
        const magnitude = Math.abs(diff);
        const category = magnitude === 0 ? 0 : Math.floor(Math.log2(magnitude)) + 1;
        const code = dc.get(category);
        if (!code) throw new Error(`No DC code for category ${category}`);
        bits.write(code.code, code.length);
        if (category > 0) bits.write(diff >= 0 ? diff : diff + (1 << category) - 1, category);
        bits.write(eob.code, eob.length);
      }
    }
  }
  out.bytes(bits.finish());
  out.u16(0xffd9); // EOI
  return Array.from(out.toBytes());
}

/** A complete JPEG file (SOI, APP1 Exif, image, EOI). */
export function buildExifJpeg(spec: ExifPhotoSpec): Uint8Array {
  const width = Math.max(8, Math.ceil((spec.width ?? 160) / 8) * 8);
  const height = Math.max(8, Math.ceil((spec.height ?? 120) / 8) * 8);
  const tiff = tiffBlock(spec, width, height);
  const app1Length = 2 + 6 + tiff.length;
  if (app1Length > 0xffff) throw new Error("EXIF block too large for one APP1 segment");

  const w = new ByteWriter();
  w.u16(0xffd8); // SOI
  w.u16(0xffe1).u16(app1Length).bytes([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]).bytes(tiff);
  w.bytes(jpegBody(width, height, spec.scene ?? trainingRoomScene()));
  return w.toBytes();
}
