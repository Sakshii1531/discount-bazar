/**
 * Small CSV reader/writer for the bulk product import (RFC 4180 style:
 * quoted fields, "" escapes, commas/newlines inside quotes, CRLF or LF, BOM).
 */
export function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ""));
}

/** First row is the header; returns one object per data row. */
export function csvToObjects(text) {
  const [header = [], ...data] = parseCsv(text);
  const keys = header.map((h) => String(h).trim());
  return data.map((cells) =>
    Object.fromEntries(keys.map((k, idx) => [k, String(cells[idx] ?? "").trim()])),
  );
}

const escapeCell = (value) => {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows) {
  return rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
}
