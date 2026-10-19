import React from 'react';
import { Link } from 'react-router-dom';
import { ShoppingBag, ArrowRight } from 'lucide-react';
import { formatAmount } from '@shared/utils/currency';
import { minimumOrderMessage } from '../../utils/minimumOrder';

/** "Add ₹X more" banner shown while the cart is below the minimum order value. */
const MinimumOrderNotice = ({ status, tone = 'light', compact = false, className = '' }) => {
  if (!status || status.isMet) return null;
  const progress = Math.min(100, Math.max(0, (status.eligibleSubtotal / status.minOrderValue) * 100));
  const dark = tone === 'dark';

  if (compact) {
    return (
      <div role="status" aria-live="polite" data-testid="minimum-order-notice" className={className}>
        <div className="flex items-center justify-between gap-3 text-xs font-black text-amber-800">
          <span>{minimumOrderMessage(status.remainingAmount)}</span>
          <Link to="/categories" className="shrink-0 text-amber-700 underline underline-offset-2">Add items</Link>
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-amber-100">
          <div className="h-full rounded-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="minimum-order-notice"
      className={`rounded-2xl border p-4 ${dark ? 'border-amber-300/30 bg-amber-400/10' : 'border-amber-200 bg-amber-50'} ${className}`}
    >
      <div className="flex items-start gap-3">
        <div className={`rounded-xl p-2 ${dark ? 'bg-amber-400/20 text-amber-300' : 'bg-amber-100 text-amber-700'}`}>
          <ShoppingBag size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-black ${dark ? 'text-amber-200' : 'text-amber-900'}`}>
            {minimumOrderMessage(status.remainingAmount)}
          </p>
          <p className={`mt-0.5 text-xs font-medium ${dark ? 'text-white/60' : 'text-amber-800/80'}`}>
            Minimum order value is ₹{formatAmount(status.minOrderValue)} (items only, excluding delivery &amp; fees).
          </p>
          <div className={`mt-3 h-1.5 overflow-hidden rounded-full ${dark ? 'bg-white/10' : 'bg-amber-100'}`}>
            <div className="h-full rounded-full bg-amber-500 transition-all duration-300" style={{ width: `${progress}%` }} />
          </div>
          <Link
            to="/categories"
            className={`mt-3 inline-flex items-center gap-1 text-xs font-black ${dark ? 'text-amber-300 hover:text-amber-200' : 'text-amber-800 hover:text-amber-900'}`}
          >
            Add more items <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </div>
  );
};

export default MinimumOrderNotice;
