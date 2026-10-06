import React, { useRef, useState } from "react";
import { HiOutlineXMark, HiOutlineArrowDownTray, HiOutlineArrowUpTray } from "react-icons/hi2";
import { sellerApi } from "../../services/sellerApi";
import { csvToObjects, toCsv } from "../../utils/csv";

const MAX_ROWS = 500;

export const TEMPLATE_HEADERS = [
  "name",
  "sku",
  "category",
  "subcategory",
  "price",
  "salePrice",
  "stock",
  "weight",
  "brand",
  "description",
  "barcode",
  "purchaseCost",
  "gstPercent",
  "imageUrl",
  "status",
  "productDeliveryFee",
  "productDeliveryTimeMinutes",
];

const TEMPLATE_EXAMPLE = [
  "Red Label Tea 250g",
  "",
  "Tea & Coffee",
  "Tea",
  "100",
  "98",
  "50",
  "250g",
  "Brooke Bond",
  "Strong tea",
  "",
  "80",
  "5",
  "",
  "active",
  "20",
  "20",
];

const downloadTemplate = () => {
  const csv = toCsv([TEMPLATE_HEADERS, TEMPLATE_EXAMPLE]);
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "product-import-template.csv";
  a.click();
  URL.revokeObjectURL(url);
};

const BulkProductUpload = ({ open, onClose, onDone }) => {
  const fileRef = useRef(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState(null);

  if (!open) return null;

  const reset = () => {
    setFileName("");
    setRows([]);
    setError("");
    setReport(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    if (!/\.csv$/i.test(file.name)) {
      setError("Please upload a .csv file. In Excel use File → Save As → CSV (Comma delimited).");
      return;
    }
    try {
      const parsed = csvToObjects(await file.text());
      if (parsed.length === 0) {
        setError("The file has no product rows.");
        return;
      }
      if (parsed.length > MAX_ROWS) {
        setError(`The file has ${parsed.length} rows. Please upload at most ${MAX_ROWS} at a time.`);
        return;
      }
      setRows(parsed);
    } catch {
      setError("Could not read this file.");
    }
  };

  const handleUpload = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await sellerApi.bulkUploadProducts(rows);
      setReport(res.data?.result || null);
      onDone?.();
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Import failed");
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose?.();
  };

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Bulk upload products">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-black text-slate-900">Bulk upload products</h3>
          <button type="button" onClick={close} className="p-1 text-slate-400 hover:text-slate-700" aria-label="Close">
            <HiOutlineXMark className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6 text-sm">
          <ol className="list-decimal space-y-1 pl-5 text-slate-600">
            <li>Download the template and fill one product per row (it opens in Excel).</li>
            <li>
              <strong>name, category, subcategory and price</strong> are required for new products. Category and subcategory
              can be names or IDs.
            </li>
            <li>
              <strong>productDeliveryFee</strong> (₹) and <strong>productDeliveryTimeMinutes</strong> (whole minutes) are
              added to the platform&apos;s delivery fee and time. Leave empty for 0; negative values are rejected.
            </li>
            <li>
              A row with the <strong>SKU of an existing product</strong> updates that product&apos;s details and delivery
              fee/time (price and stock are not changed).
            </li>
            <li>Save as CSV and upload it here (max {MAX_ROWS} rows).</li>
          </ol>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={downloadTemplate}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 font-bold text-slate-700 hover:bg-slate-50">
              <HiOutlineArrowDownTray className="h-4 w-4" /> Download template
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              data-testid="bulk-upload-file"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 font-bold text-white hover:bg-slate-800">
              <HiOutlineArrowUpTray className="h-4 w-4" /> Choose CSV file
            </button>
          </div>

          {fileName && (
            <p className="text-slate-600">
              {fileName}
              {rows.length > 0 && ` — ${rows.length} product row${rows.length === 1 ? "" : "s"} ready`}
            </p>
          )}
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 font-semibold text-rose-700">{error}</p>}

          {rows.length > 0 && !report && (
            <button
              type="button"
              onClick={handleUpload}
              disabled={busy}
              className="w-full rounded-xl bg-primary py-3 font-black text-primary-foreground disabled:opacity-60">
              {busy ? "Importing…" : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
            </button>
          )}

          {report && (
            <div className="space-y-3" data-testid="bulk-upload-report">
              <p className="font-bold text-slate-800">
                {report.summary.created} created · {report.summary.updated} updated · {report.summary.failed} failed
              </p>
              {report.results.some((r) => r.status === "error") && (
                <div className="max-h-60 overflow-y-auto rounded-lg border border-rose-100">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-rose-50 text-rose-800">
                      <tr>
                        <th className="px-3 py-2">Row</th>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Problem</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.results
                        .filter((r) => r.status === "error")
                        .map((r) => (
                          <tr key={r.row} className="border-t border-rose-50">
                            <td className="px-3 py-2 font-bold">{r.row}</td>
                            <td className="px-3 py-2">{r.name || r.sku || "—"}</td>
                            <td className="px-3 py-2 text-rose-700">{(r.errors || []).join("; ")}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              <button type="button" onClick={reset} className="font-bold text-primary">
                Upload another file
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default BulkProductUpload;
