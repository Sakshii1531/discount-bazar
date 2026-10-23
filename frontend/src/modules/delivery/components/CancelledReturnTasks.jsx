import React, { useCallback, useEffect, useState } from "react";
import { Undo2, Loader2, Store } from "lucide-react";
import { toast } from "sonner";
import { deliveryApi } from "../services/deliveryApi";
import { onSocketEvent } from "@/core/services/orderSocket";
import { createSocketTokenReader } from "@core/utils/authStorage";
import { STORAGE_KEYS } from "@core/utils/storage";

/**
 * Orders cancelled after pickup: the rider must stop the delivery, bring the
 * parcel back to the store and confirm the return here.
 */
const CancelledReturnTasks = () => {
  const [tasks, setTasks] = useState([]);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await deliveryApi.getCancellationReturns();
      setTasks((res.data?.result || res.data?.data)?.items || []);
    } catch {
      /* supplementary panel */
    }
  }, []);

  useEffect(() => {
    load();
    const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_DELIVERY);
    const off = onSocketEvent(getToken, "order:cancelled", (payload) => {
      if (payload?.returnToStore) {
        toast.warning(`Order #${payload.orderId} was cancelled. Stop the delivery and return the parcel to the store.`);
      }
      load();
    });
    window.addEventListener("focus", load);
    return () => {
      off();
      window.removeEventListener("focus", load);
    };
  }, [load]);

  const confirm = async (task) => {
    if (busyId) return;
    setBusyId(task.id);
    try {
      await deliveryApi.confirmCancellationReturn(task.id);
      toast.success("Return confirmed. Thank you!");
      load();
    } catch (error) {
      toast.error(error?.response?.data?.message || "Could not confirm the return");
      load();
    } finally {
      setBusyId(null);
    }
  };

  if (!tasks.length) return null;

  return (
    <section className="mx-4 mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4">
      <h2 className="text-sm font-black text-rose-900 flex items-center gap-2">
        <Undo2 size={16} /> Return cancelled parcels to the store
      </h2>
      <ul className="mt-3 space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="rounded-xl bg-white p-3 text-sm">
            <p className="font-bold text-slate-900">Order #{task.orderId}</p>
            {task.store && (
              <p className="mt-0.5 flex items-start gap-1 text-xs text-slate-600">
                <Store size={12} className="mt-0.5 shrink-0" />
                {task.store.name}{task.store.address ? ` — ${task.store.address}` : ""}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-0.5">
              {task.items.map((i) => `${i.name} × ${i.quantity}`).join(", ")}
            </p>
            <button
              type="button"
              onClick={() => confirm(task)}
              disabled={busyId === task.id}
              className="mt-2 w-full py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {busyId === task.id && <Loader2 size={14} className="animate-spin" />}
              I have returned the parcel to the store
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default CancelledReturnTasks;
