/**
 * HEIF / HEIC photos for browsers that can't open them as images (Chrome on Android, desktop
 * Chrome / Firefox): the file's HEVC picture (one image, or a grid of tiles) is read from the
 * container here and decoded by the browser's own video decoder (WebCodecs), then drawn into a
 * canvas. No library, no WASM: only the boxes needed for the primary picture are read.
 *
 * A HEIF file is a list of boxes: `ftyp`, then `meta` with `pitm` (the primary item), `iinf`
 * (item types: `hvc1` = an HEVC picture, `grid` = tiles), `iloc` (where each item's bytes are),
 * `iref` (`dimg`: a grid's tiles) and `iprp` (properties: `hvcC` decoder setup, `ispe` size,
 * `irot` / `imir` turn and mirror), and the picture data itself (`mdat`, or `idat` in `meta`).
 */

interface Box {
  type: string;
  /** Where the box's content starts (after its header) and ends, in the file. */
  start: number;
  end: number;
}

interface Extent {
  offset: number;
  length: number;
}

interface ItemLocation {
  method: number;
  extents: Extent[];
}

/** A HEIF file's primary picture, ready to decode. */
export interface HeifPicture {
  /** `hvc1` codec string for VideoDecoder. */
  codec: string;
  /** The HEVCDecoderConfigurationRecord (the `hvcC` box's content). */
  description: Uint8Array;
  /** One tile (a single picture) or rows × columns tiles, in reading order. */
  tiles: Uint8Array[];
  rows: number;
  columns: number;
  /** The tiles' size (the decoded picture's, before cropping a grid to `width × height`). */
  tileWidth: number;
  tileHeight: number;
  width: number;
  height: number;
  /** Quarter turns anticlockwise (irot), then mirror: 0 none · 1 top-bottom · 2 left-right. */
  rotation: number;
  mirror: 0 | 1 | 2;
}

const text = (b: Uint8Array, at: number) =>
  String.fromCharCode(b[at]!, b[at + 1]!, b[at + 2]!, b[at + 3]!);

class Reader {
  constructor(
    readonly b: Uint8Array,
    public at: number,
  ) {}
  u8(): number {
    return this.b[this.at++]!;
  }
  u16(): number {
    const v = (this.b[this.at]! << 8) | this.b[this.at + 1]!;
    this.at += 2;
    return v;
  }
  u32(): number {
    const v =
      ((this.b[this.at]! << 24) >>> 0) +
      (this.b[this.at + 1]! << 16) +
      (this.b[this.at + 2]! << 8) +
      this.b[this.at + 3]!;
    this.at += 4;
    return v;
  }
  /** An unsigned number of 0, 4 or 8 bytes (8-byte values must fit a JS number). */
  sized(size: number): number {
    if (size === 0) return 0;
    if (size === 4) return this.u32();
    if (size === 8) return this.u32() * 2 ** 32 + this.u32();
    if (size === 2) return this.u16();
    throw new Error(`HEIF: field size ${size}`);
  }
}

function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const out: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    const r = new Reader(b, at);
    let size = r.u32();
    const type = text(b, at + 4);
    let header = 8;
    if (size === 1) {
      r.at = at + 8;
      size = r.sized(8);
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) break;
    out.push({ type, start: at + header, end: at + size });
    at += size;
  }
  return out;
}

const child = (list: Box[], type: string) => list.find((x) => x.type === type);

/** Reads the primary picture of a HEIF file (its bytes); throws when it isn't an HEVC one. */
export function readHeif(b: Uint8Array): HeifPicture {
  const top = boxes(b, 0, b.length);
  const meta = child(top, 'meta');
  if (!meta) throw new Error('HEIF: no meta box');
  // `meta` is a full box: 4 bytes of version and flags before its children.
  const inMeta = boxes(b, meta.start + 4, meta.end);

  const pitm = child(inMeta, 'pitm');
  if (!pitm) throw new Error('HEIF: no primary item');
  const pr = new Reader(b, pitm.start);
  const primary = pr.u8() === 0 ? ((pr.at += 3), pr.u16()) : ((pr.at += 3), pr.u32());

  // Item types.
  const types = new Map<number, string>();
  const iinf = child(inMeta, 'iinf');
  if (!iinf) throw new Error('HEIF: no item list');
  const ir = new Reader(b, iinf.start);
  const iinfVersion = ir.u8();
  ir.at += 3;
  ir.at += iinfVersion === 0 ? 2 : 4;
  for (const infe of boxes(b, ir.at, iinf.end)) {
    if (infe.type !== 'infe') continue;
    const r = new Reader(b, infe.start);
    const version = r.u8();
    r.at += 3;
    if (version < 2) continue;
    const id = version === 2 ? r.u16() : r.u32();
    r.at += 2; // protection index
    types.set(id, text(b, r.at));
  }

  // Item locations.
  const locations = new Map<number, ItemLocation>();
  const iloc = child(inMeta, 'iloc');
  if (!iloc) throw new Error('HEIF: no item locations');
  {
    const r = new Reader(b, iloc.start);
    const version = r.u8();
    r.at += 3;
    const sizes = r.u16();
    const offsetSize = sizes >> 12;
    const lengthSize = (sizes >> 8) & 15;
    const baseSize = (sizes >> 4) & 15;
    const indexSize = version === 1 || version === 2 ? sizes & 15 : 0;
    const count = version < 2 ? r.u16() : r.u32();
    for (let i = 0; i < count; i++) {
      const id = version < 2 ? r.u16() : r.u32();
      const method = version === 1 || version === 2 ? r.u16() & 15 : 0;
      r.u16(); // data reference index
      const base = r.sized(baseSize);
      const extentCount = r.u16();
      const extents: Extent[] = [];
      for (let e = 0; e < extentCount; e++) {
        if (indexSize) r.sized(indexSize);
        const offset = r.sized(offsetSize);
        const length = r.sized(lengthSize);
        extents.push({ offset: base + offset, length });
      }
      locations.set(id, { method, extents });
    }
  }
  const idat = child(inMeta, 'idat');
  const bytesOf = (id: number): Uint8Array => {
    const loc = locations.get(id);
    if (!loc) throw new Error(`HEIF: item ${id} has no data`);
    const origin = loc.method === 1 ? (idat?.start ?? 0) : 0;
    if (loc.method > 1) throw new Error('HEIF: unsupported item location');
    const total = loc.extents.reduce((n, e) => n + e.length, 0);
    if (loc.extents.length === 1) {
      const e = loc.extents[0]!;
      return b.subarray(origin + e.offset, origin + e.offset + e.length);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const e of loc.extents) {
      out.set(b.subarray(origin + e.offset, origin + e.offset + e.length), at);
      at += e.length;
    }
    return out;
  };

  // Properties and which items use them.
  const iprp = child(inMeta, 'iprp');
  if (!iprp) throw new Error('HEIF: no properties');
  const inIprp = boxes(b, iprp.start, iprp.end);
  const ipco = child(inIprp, 'ipco');
  if (!ipco) throw new Error('HEIF: no properties');
  const props = boxes(b, ipco.start, ipco.end);
  const assoc = new Map<number, number[]>();
  for (const ipma of inIprp.filter((x) => x.type === 'ipma')) {
    const r = new Reader(b, ipma.start);
    const version = r.u8();
    const flags = (r.u8() << 16) | r.u16();
    const count = r.u32();
    for (let i = 0; i < count; i++) {
      const id = version < 1 ? r.u16() : r.u32();
      const n = r.u8();
      const list = assoc.get(id) ?? [];
      for (let k = 0; k < n; k++) {
        const v = flags & 1 ? r.u16() & 0x7fff : r.u8() & 0x7f;
        if (v > 0) list.push(v - 1);
      }
      assoc.set(id, list);
    }
  }
  const propOf = (id: number, type: string) =>
    (assoc.get(id) ?? []).map((i) => props[i]).find((p) => p?.type === type);

  // Grid tiles (`dimg` references from the grid item).
  const tilesOf = (gridId: number): number[] => {
    const iref = child(inMeta, 'iref');
    if (!iref) return [];
    const r = new Reader(b, iref.start);
    const version = r.u8();
    r.at += 3;
    for (const ref of boxes(b, r.at, iref.end)) {
      const rr = new Reader(b, ref.start);
      const from = version === 0 ? rr.u16() : rr.u32();
      const n = rr.u16();
      const to: number[] = [];
      for (let i = 0; i < n; i++) to.push(version === 0 ? rr.u16() : rr.u32());
      if (ref.type === 'dimg' && from === gridId) return to;
    }
    return [];
  };

  const kind = types.get(primary);
  let tileIds: number[];
  let rows = 1;
  let columns = 1;
  let width = 0;
  let height = 0;
  if (kind === 'grid') {
    const data = bytesOf(primary);
    const gr = new Reader(data, 0);
    gr.u8(); // version
    const big = gr.u8() & 1;
    rows = gr.u8() + 1;
    columns = gr.u8() + 1;
    width = big ? gr.u32() : gr.u16();
    height = big ? gr.u32() : gr.u16();
    tileIds = tilesOf(primary);
    if (tileIds.length !== rows * columns) throw new Error('HEIF: grid tiles missing');
  } else if (kind === 'hvc1') {
    tileIds = [primary];
  } else {
    throw new Error(`HEIF: primary picture is ${kind ?? 'unknown'}, not HEVC`);
  }
  const first = tileIds[0]!;
  if (types.get(first) !== 'hvc1') throw new Error('HEIF: tiles are not HEVC');
  const hvcC = propOf(first, 'hvcC');
  if (!hvcC) throw new Error('HEIF: no decoder setup');
  const description = b.subarray(hvcC.start, hvcC.end);
  const ispe = propOf(first, 'ispe');
  let tileWidth = 0;
  let tileHeight = 0;
  if (ispe) {
    const r = new Reader(b, ispe.start + 4);
    tileWidth = r.u32();
    tileHeight = r.u32();
  }
  if (kind !== 'grid') {
    width = tileWidth;
    height = tileHeight;
  }
  const irot = propOf(primary, 'irot');
  const imir = propOf(primary, 'imir');
  return {
    codec: hevcCodec(description),
    description,
    tiles: tileIds.map(bytesOf),
    rows,
    columns,
    tileWidth,
    tileHeight,
    width,
    height,
    rotation: irot ? b[irot.start]! & 3 : 0,
    mirror: imir ? ((b[imir.start]! & 1) === 0 ? 1 : 2) : 0,
  };
}

/** `hvc1.…` codec string from an HEVCDecoderConfigurationRecord (ISO/IEC 14496-15 E.3). */
export function hevcCodec(c: Uint8Array): string {
  const space = c[1]! >> 6;
  const tier = (c[1]! >> 5) & 1;
  const profile = c[1]! & 31;
  const compat = ((c[2]! << 24) >>> 0) + (c[3]! << 16) + (c[4]! << 8) + c[5]!;
  let reversed = 0;
  for (let i = 0; i < 32; i++) if (compat & (2 ** i)) reversed += 2 ** (31 - i);
  const level = c[12]!;
  const constraints = [c[6]!, c[7]!, c[8]!, c[9]!, c[10]!, c[11]!];
  while (constraints.length > 1 && constraints[constraints.length - 1] === 0) constraints.pop();
  const spaceText = ['', 'A', 'B', 'C'][space]!;
  return [
    'hvc1',
    `${spaceText}${profile}`,
    reversed.toString(16).toUpperCase(),
    `${tier ? 'H' : 'L'}${level}`,
    ...constraints.map((x) => x.toString(16).toUpperCase()),
  ].join('.');
}

/**
 * Decodes a HEIF file's primary picture into a canvas (tiles stitched, cropped, turned and
 * mirrored). Throws when this browser can't decode its HEVC.
 */
export async function decodeHeif(file: Blob, signal?: AbortSignal): Promise<OffscreenCanvas> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pic = readHeif(bytes);
  if (typeof VideoDecoder === 'undefined') throw new Error('No WebCodecs');
  const config: VideoDecoderConfig = {
    codec: pic.codec,
    description: pic.description,
    codedWidth: pic.tileWidth || undefined,
    codedHeight: pic.tileHeight || undefined,
  } as VideoDecoderConfig;
  const support = await VideoDecoder.isConfigSupported(config);
  if (!support.supported) throw new Error("This browser can't decode the photo's HEVC");

  const tw = pic.tileWidth;
  const th = pic.tileHeight;
  const fullW = pic.width || tw * pic.columns;
  const fullH = pic.height || th * pic.rows;
  const sideways = pic.rotation % 2 === 1;
  const canvas = new OffscreenCanvas(sideways ? fullH : fullW, sideways ? fullW : fullH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No 2D canvas');
  // Turn and mirror around the picture's centre, then draw the tiles in place.
  ctx.translate(canvas.width / 2, canvas.height / 2);
  if (pic.mirror === 1) ctx.scale(1, -1);
  if (pic.mirror === 2) ctx.scale(-1, 1);
  ctx.rotate((-pic.rotation * Math.PI) / 2);
  ctx.translate(-fullW / 2, -fullH / 2);

  let failed: unknown = null;
  let drawn = 0;
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        const i = frame.timestamp;
        const x = (i % pic.columns) * (tw || frame.displayWidth);
        const y = Math.floor(i / pic.columns) * (th || frame.displayHeight);
        ctx.drawImage(frame, x, y);
        drawn++;
      } finally {
        frame.close();
      }
    },
    error: (e) => {
      failed = e;
    },
  });
  try {
    decoder.configure(config);
    // Each tile is its own key frame (timestamp = its index); a few at a time (backpressure).
    for (let i = 0; i < pic.tiles.length; i++) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (failed) throw failed;
      while (decoder.decodeQueueSize > 4) await new Promise((r) => setTimeout(r, 2));
      decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: i, data: pic.tiles[i]! }));
    }
    await decoder.flush();
    if (failed) throw failed;
    if (drawn !== pic.tiles.length) throw new Error('HEIF: some tiles did not decode');
    return canvas;
  } finally {
    if (decoder.state !== 'closed') decoder.close();
  }
}

/** A HEIF photo as a JPEG file (same name, `.jpg`), for browsers that can't open HEIF. */
export async function heifToJpeg(file: File, signal?: AbortSignal): Promise<File> {
  const canvas = await decodeHeif(file, signal);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  const name = file.name.replace(/\.(heic|heif|hif)$/i, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
}
