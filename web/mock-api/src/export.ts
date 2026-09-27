// Log export encoders. JSON, JSONL, CSV and XLSX are real files; Parquet is a
// labelled placeholder (see README), since writing Parquet needs a real library.
import { crc32 } from "node:zlib";
import type { ExportFormat, S } from "./types";

type Entry = S<"ActivityLogEntry">;

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  json: "application/json",
  jsonl: "application/x-ndjson",
  csv: "text/csv",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  parquet: "application/vnd.apache.parquet",
};

const COLUMNS = [
  "id",
  "createdAt",
  "action",
  "userId",
  "userDisplayName",
  "ip",
  "metadata",
] as const;

function row(e: Entry): (string | number)[] {
  return [
    e.id,
    e.createdAt,
    e.action,
    e.user?.id ?? "",
    e.user?.displayName ?? "",
    e.ip ?? "",
    JSON.stringify(e.metadata),
  ];
}

export function encodeExport(
  format: ExportFormat,
  entries: Entry[],
): Uint8Array {
  switch (format) {
    case "json":
      return Buffer.from(JSON.stringify(entries));
    case "jsonl":
      return Buffer.from(
        entries.map((e) => JSON.stringify(e)).join("\n") +
          (entries.length ? "\n" : ""),
      );
    case "csv":
      return Buffer.from(
        [
          COLUMNS.join(","),
          ...entries.map((e) => row(e).map(csvCell).join(",")),
        ].join("\r\n") + "\r\n",
      );
    case "xlsx":
      return xlsx([[...COLUMNS], ...entries.map(row)]);
    case "parquet":
      return Buffer.concat([
        Buffer.from("PAR1"),
        Buffer.from(
          `mock placeholder: ${entries.length} rows; not a readable Parquet file\n`,
        ),
        Buffer.from("PAR1"),
      ]);
  }
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ------------------------------------------------------------------- xlsx

function xmlEscape(s: string): string {
  return s.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
  );
}

function colName(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26))
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function xlsx(rows: (string | number)[][]): Uint8Array {
  const sheetRows = rows
    .map((cells, r) => {
      const cs = cells
        .map((v, c) => {
          const ref = `${colName(c)}${r + 1}`;
          return typeof v === "number"
            ? `<c r="${ref}"><v>${v}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(v)}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cs}</row>`;
    })
    .join("");
  const files: [string, string][] = [
    [
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    ],
    [
      "_rels/.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ],
    [
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="logs" sheetId="1" r:id="rId1"/></sheets></workbook>',
    ],
    [
      "xl/_rels/workbook.xml.rels",
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    ],
    [
      "xl/worksheets/sheet1.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
    ],
  ];
  return storedZip(
    files.map(([name, text]) => [name, Buffer.from(text, "utf8")]),
  );
}

/** A ZIP archive with every entry stored uncompressed. */
function storedZip(entries: [string, Buffer][]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}
