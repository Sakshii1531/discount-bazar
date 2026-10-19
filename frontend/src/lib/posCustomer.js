// Who a POS bill is for. The linked ledger customer (`posCustomer`, populated
// as { _id, name, phone } by the sales/return APIs) wins over the typed
// `walkInCustomer` snapshot; "Walk-in" is only the fallback when neither exists.

const linkedCustomer = (order) =>
    order?.posCustomer && typeof order.posCustomer === 'object' ? order.posCustomer : null;

export function posBillCustomer(order, fallback = 'Walk-in') {
    const linked = linkedCustomer(order);
    const name = String(linked?.name || '').trim() || String(order?.walkInCustomer?.name || '').trim();
    const phone = String(linked?.phone || '').trim() || String(order?.walkInCustomer?.phone || '').trim();
    return { name: name || fallback, phone, isWalkIn: !name };
}

/** The linked ledger customer's id whether `posCustomer` is populated or a bare id. */
export const posCustomerIdOf = (order) => String(linkedCustomer(order)?._id || order?.posCustomer || '');
