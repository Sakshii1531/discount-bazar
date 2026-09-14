/**
 * Centralized Integer Currency Formatter
 * 
 * Formats monetary amounts as integer values using Math.ceil() for UI consistency.
 * 
 * Examples:
 *   formatCurrencyInteger(150)    => "₹150"
 *   formatCurrencyInteger(30)     => "₹30"
 *   formatCurrencyInteger(7.5)    => "₹8"
 *   formatCurrencyInteger(187.5)  => "₹188"
 *   formatCurrencyInteger(0)      => "₹0"
 *   formatCurrencyInteger(-7.5)   => "-₹8"
 */

export function formatPriceInteger(amount) {
  const num = Number(amount);
  if (!Number.isFinite(num)) return 0;
  if (num < 0) {
    return -Math.ceil(Math.abs(num));
  }
  return Math.ceil(num);
}

export function formatCurrencyInteger(amount, symbol = "₹") {
  const num = Number(amount);
  if (!Number.isFinite(num)) return `${symbol}0`;
  
  if (num < 0) {
    return `-${symbol}${Math.ceil(Math.abs(num))}`;
  }
  
  return `${symbol}${Math.ceil(num)}`;
}

export default formatCurrencyInteger;
