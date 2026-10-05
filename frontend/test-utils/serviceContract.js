/**
 * Helpers for API-service unit tests. Call every method on a service object
 * with placeholder arguments and record the HTTP method + URL each one hits
 * on the (mocked) shared axios instance.
 */
export const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export function createAxiosMock() {
  const mock = {};
  for (const m of HTTP_METHODS) {
    mock[m] = jest.fn(() => Promise.resolve({ data: { success: true, result: {} } }));
  }
  mock.interceptors = { request: { use: jest.fn() }, response: { use: jest.fn() } };
  mock.defaults = { headers: { common: {} } };
  return mock;
}

export function lastCall(axiosMock) {
  let best = null;
  for (const m of HTTP_METHODS) {
    const { calls, invocationCallOrder } = axiosMock[m].mock;
    if (!calls.length) continue;
    const order = invocationCallOrder[invocationCallOrder.length - 1];
    if (!best || order > best.order) {
      best = { order, method: m, url: calls[calls.length - 1][0], args: calls[calls.length - 1] };
    }
  }
  return best && { method: best.method, url: best.url, args: best.args };
}

/** Invoke every function on `service` and return [{ name, method, url }]. */
export async function collectServiceCalls(service, axiosMock, argsFor = () => ['ID123', 'ID456', 'ID789']) {
  const out = [];
  for (const [name, fn] of Object.entries(service)) {
    if (typeof fn !== 'function') continue;
    HTTP_METHODS.forEach((m) => axiosMock[m].mockClear());
    try {
      await fn(...argsFor(name));
    } catch {
      /* some wrappers post-process responses; the request is what we check */
    }
    const call = lastCall(axiosMock);
    out.push({ name, method: call?.method ?? null, url: call?.url ?? null });
  }
  return out;
}
