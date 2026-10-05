/** Builds an unsigned JWT-shaped string for client-side decoding tests. */
const b64url = (obj) =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

export function makeJwt(payload = {}, { expiresInSec = 3600 } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, ...(expiresInSec != null ? { exp: now + expiresInSec } : {}), ...payload };
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(body)}.signature`;
}
