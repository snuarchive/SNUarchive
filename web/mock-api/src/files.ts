// Small but real files for seeded uploads, plus content sniffing for new ones.
import { crc32, deflateSync } from "node:zlib";
import type { ReportContentType } from "./types";

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** An RGB PNG of a bar chart, standing in for a photographed score slide. */
export function barChartPng(
  values: number[],
  width = 240,
  height = 120,
): Uint8Array {
  const bg = [250, 250, 250];
  const bar = [59, 130, 246];
  const axis = [80, 80, 80];
  const max = Math.max(...values, 1);
  const slot = Math.floor((width - 20) / values.length);
  const rows: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3); // filter byte 0 = None
    for (let x = 0; x < width; x++) {
      let px = bg;
      if (y === height - 10 || x === 10) px = axis;
      else if (x > 10 && y < height - 10) {
        const i = Math.floor((x - 12) / slot);
        const inBar = i >= 0 && i < values.length && (x - 12) % slot < slot - 4;
        const top = height - 10 - Math.round(((height - 25) * values[i]) / max);
        if (inBar && y >= top) px = bar;
      }
      row.set(px, 1 + x * 3);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A one-page PDF with a few lines of ASCII text and a correct xref table. */
export function textPdf(lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/[\\()]/g, (m) => `\\${m}`);
  const content = [
    "BT /F1 14 Tf 50 780 Td 18 TL",
    ...lines.map((l) => `(${esc(l)}) Tj T*`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Decides the type from leading bytes only, as the backend does. */
export function sniff(bytes: Uint8Array): ReportContentType | null {
  const b = Buffer.from(
    bytes.buffer,
    bytes.byteOffset,
    Math.min(bytes.byteLength, 16),
  );
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (
    b
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (
    b.subarray(0, 4).toString("latin1") === "RIFF" &&
    b.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}
