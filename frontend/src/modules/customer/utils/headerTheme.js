/** Shift hex color channels by amount (negative = darker). */
export function shiftHex(hex, amount) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) return hex;

  const normalized =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;

  const value = normalized.slice(1);
  if (value.length !== 6) return hex;

  const clamp = (num) => Math.max(0, Math.min(255, num + amount));
  const r = clamp(parseInt(value.slice(0, 2), 16));
  const g = clamp(parseInt(value.slice(2, 4), 16));
  const b = clamp(parseInt(value.slice(4, 6), 16));

  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

const DEFAULT_BASE = "var(--primary)";

const isHex = (c) => typeof c === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);

// Same shading as shiftHex / mixHexWithWhite, but also for CSS colours the JS
// can't read (e.g. "var(--primary)", the admin brand colour): the browser mixes them.
function shade(base, amount) {
  if (isHex(base)) return shiftHex(base, amount);
  const pct = Math.min(100, Math.round((Math.abs(amount) / 255) * 100));
  return `color-mix(in srgb, ${base}, ${amount < 0 ? "black" : "white"} ${pct}%)`;
}

function tint(base, t) {
  if (isHex(base)) return mixHexWithWhite(base, t);
  return `color-mix(in srgb, ${base}, white ${Math.round(t * 100)}%)`;
}

/** Blend hex toward white (t=0 base, t≈1 near-white). */
export function mixHexWithWhite(hex, t) {
  if (!hex || typeof hex !== "string" || !hex.startsWith("#")) {
    return "#f8fafc";
  }
  const normalized =
    hex.length === 4
      ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
      : hex;
  const value = normalized.slice(1);
  if (value.length !== 6) return "#f8fafc";

  const mix = (c) => Math.round(c + (255 - c) * t);
  const r = mix(parseInt(value.slice(0, 2), 16));
  const g = mix(parseInt(value.slice(2, 4), 16));
  const b = mix(parseInt(value.slice(4, 6), 16));
  return `#${[r, g, b]
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Search field surface: tinted header theme, a bit darker than near-white. */
export function buildSearchBarBackgroundColor(baseHeaderColor) {
  const base = baseHeaderColor || DEFAULT_BASE;
  return tint(base, 0.7);
}

/**
 * Same gradient as the main location header (category-driven).
 */
export function buildHeaderGradient(baseHeaderColor) {
  const base = baseHeaderColor || DEFAULT_BASE;
  return `linear-gradient(to bottom, ${shade(base, -18)} 0%, ${shade(base, 20)} 54%, ${shade(base, 165)} 100%)`;
}

/** Solid fill for floating cart pill: header mid tone, slightly darker. */
export function buildMiniCartColor(baseHeaderColor) {
  const base = baseHeaderColor || DEFAULT_BASE;
  const mid = shade(base, 20);
  return shade(mid, -26);
}

/** Gradient for floating mini cart pill (same palette as header, horizontal). */
export function buildMiniCartGradient(baseHeaderColor) {
  const base = baseHeaderColor || DEFAULT_BASE;
  const top = shade(base, -12);
  const mid = shade(base, 20);
  const deep = shade(mid, -32);
  return `linear-gradient(135deg, ${top} 0%, ${mid} 48%, ${deep} 100%)`;
}

