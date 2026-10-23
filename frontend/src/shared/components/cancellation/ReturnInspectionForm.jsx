import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";

const clampInt = (value) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/**
 * Inspection of a cancelled parcel returned to the store. Every unit must be
 * marked sellable, damaged or missing; only sellable units go back on sale.
 */
const ReturnInspectionForm = ({ items = [], onSubmit, submitting = false, onCancel }) => {
  const [rows, setRows] = useState(() =>
    items.map((item) => ({
      itemIndex: item.itemIndex,
      name: item.name,
      quantity: Number(item.quantity) || 0,
      sellableQty: Number(item.quantity) || 0,
      damagedQty: 0,
      missingQty: 0,
      note: "",
    })),
  );
  const [note, setNote] = useState("");

  const invalid = useMemo(
    () => rows.filter((r) => r.sellableQty + r.damagedQty + r.missingQty !== r.quantity),
    [rows],
  );

  const update = (index, field, value) =>
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: field === "note" ? value : clampInt(value) } : r)));

  const handleSubmit = (e) => {
    e.preventDefault();
    if (invalid.length || submitting) return;
    onSubmit({
      items: rows.map(({ itemIndex, sellableQty, damagedQty, missingQty, note: itemNote }) => ({
        itemIndex,
        sellableQty,
        damagedQty,
        missingQty,
        note: itemNote || undefined,
      })),
      note: note.trim() || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <p className="text-xs text-slate-500">
        Check each item for damage, missing units and opened packaging. Only units marked sellable return to stock.
      </p>
      {rows.map((row, index) => {
        const bad = row.sellableQty + row.damagedQty + row.missingQty !== row.quantity;
        return (
          <div key={row.itemIndex} className={`rounded-xl border p-3 ${bad ? "border-rose-300 bg-rose-50/40" : "border-slate-200"}`}>
            <div className="flex justify-between gap-2 text-sm">
              <span className="font-semibold text-slate-900 truncate">{row.name || `Item ${index + 1}`}</span>
              <span className="text-slate-500 shrink-0">Qty {row.quantity}</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2">
              {[
                ["sellableQty", "Sellable"],
                ["damagedQty", "Damaged"],
                ["missingQty", "Missing"],
              ].map(([field, label]) => (
                <label key={field} className="text-[11px] font-semibold text-slate-500">
                  {label}
                  <input
                    type="number"
                    min={0}
                    max={row.quantity}
                    inputMode="numeric"
                    value={row[field]}
                    onChange={(e) => update(index, field, e.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-900"
                  />
                </label>
              ))}
            </div>
            <input
              type="text"
              value={row.note}
              onChange={(e) => update(index, "note", e.target.value.slice(0, 200))}
              placeholder="Condition note (optional)"
              className="mt-2 w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs"
            />
            {bad && (
              <p className="mt-1 text-[11px] font-semibold text-rose-600">
                Sellable + damaged + missing must equal {row.quantity}.
              </p>
            )}
          </div>
        );
      })}
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value.slice(0, 500))}
        rows={2}
        placeholder="Overall inspection note (optional)"
        className="w-full rounded-xl border border-slate-200 p-2 text-sm"
      />
      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-700">
            Back
          </button>
        )}
        <button
          type="submit"
          disabled={invalid.length > 0 || submitting}
          className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold flex items-center gap-2 disabled:opacity-50"
        >
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Save inspection
        </button>
      </div>
    </form>
  );
};

export default ReturnInspectionForm;
