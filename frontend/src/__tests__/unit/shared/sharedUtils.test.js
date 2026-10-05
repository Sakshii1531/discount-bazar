import { renderHook, act } from '@testing-library/react';
import {
  formatPriceInteger,
  formatCurrencyInteger,
  formatAmount,
  computePurchaseGst,
} from '@shared/utils/currency';
import {
  getLegacyStatusFromOrder,
  getOrderStatusLabel,
  adminRouteMatchesOrder,
  WORKFLOW_STATUS,
} from '@shared/utils/orderStatus';
import {
  toLatLngLiteral,
  haversineMeters,
  snapToRoute,
  remainingPath,
  pathLengthMeters,
  snapThresholdFor,
  ROUTE_TRACKING,
} from '@shared/utils/routeGeometry';
import { cn } from '@/lib/utils';
import { useDebounce } from '@shared/hooks/useDebounce';
import { useFilters } from '@shared/hooks/useFilters';
import { usePagination } from '@shared/hooks/usePagination';
import { useApiState } from '@shared/hooks/useApiState';
import { useConfirmDialog } from '@shared/hooks/useConfirmDialog';

describe('shared/utils/currency', () => {
  it.each([
    [150, '₹150'],
    [7.5, '₹8'],
    [187.5, '₹188'],
    [0, '₹0'],
    [-7.5, '-₹8'],
    [72.00000000001, '₹72'],
    ['abc', '₹0'],
  ])('formatCurrencyInteger(%p) → %p', (input, expected) => {
    expect(formatCurrencyInteger(input)).toBe(expected);
  });

  it('supports custom symbols and integer helpers', () => {
    expect(formatCurrencyInteger(10.1, '$')).toBe('$11');
    expect(formatPriceInteger(10.1)).toBe(11);
    expect(formatPriceInteger(-10.1)).toBe(-11);
    expect(formatPriceInteger(NaN)).toBe(0);
  });

  it('formatAmount uses Indian grouping', () => {
    expect(formatAmount(1234.5)).toBe('1,235');
    expect(formatAmount(1234567)).toBe('12,34,567');
  });

  it('computePurchaseGst mirrors backend', () => {
    expect(computePurchaseGst(100, 18)).toEqual({ basePrice: 100, gstAmount: 18, finalPrice: 118 });
    expect(computePurchaseGst(118, 18, 'INCLUSIVE')).toEqual({ basePrice: 100, gstAmount: 18, finalPrice: 118 });
    expect(computePurchaseGst('', 5)).toEqual({ empty: true });
    expect(computePurchaseGst(100, 101).error).toMatch(/more than 100/);
    expect(computePurchaseGst(-1, 5).error).toMatch(/negative/);
    expect(computePurchaseGst('x', 5).error).toMatch(/valid number/);
    expect(computePurchaseGst(100, 'x').error).toMatch(/valid number/);
  });
});

describe('shared/utils/orderStatus', () => {
  it('keeps terminal statuses', () => {
    expect(getLegacyStatusFromOrder({ status: 'Delivered' })).toBe('delivered');
    expect(getLegacyStatusFromOrder({ status: 'cancelled', workflowVersion: 2 })).toBe('cancelled');
    expect(getLegacyStatusFromOrder(null)).toBe('pending');
  });

  it('maps v2 workflow statuses', () => {
    const v2 = (workflowStatus, status = 'pending') => ({ workflowVersion: 2, workflowStatus, status });
    expect(getLegacyStatusFromOrder(v2(WORKFLOW_STATUS.SELLER_PENDING))).toBe('pending');
    expect(getLegacyStatusFromOrder(v2(WORKFLOW_STATUS.SELLER_ACCEPTED))).toBe('confirmed');
    expect(getLegacyStatusFromOrder(v2(WORKFLOW_STATUS.PICKUP_READY, 'packed'))).toBe('packed');
    expect(getLegacyStatusFromOrder(v2(WORKFLOW_STATUS.OUT_FOR_DELIVERY))).toBe('out_for_delivery');
    expect(getLegacyStatusFromOrder(v2('delivered'))).toBe('delivered');
  });

  it('infers legacy status from rider progress', () => {
    expect(getLegacyStatusFromOrder({ status: 'pending', deliveryRiderStep: 3 })).toBe('out_for_delivery');
    expect(getLegacyStatusFromOrder({ status: 'pending', deliveryBoy: 'r1' })).toBe('confirmed');
    expect(getLegacyStatusFromOrder({ status: 'packed' })).toBe('packed');
    expect(getLegacyStatusFromOrder({ status: 'weird' })).toBe('pending');
  });

  it('labels orders including returns', () => {
    expect(getOrderStatusLabel({ status: 'out_for_delivery' })).toBe('Out for delivery');
    expect(getOrderStatusLabel({ status: 'delivered', returnStatus: 'refund_completed' })).toBe('Returned & Refunded');
    expect(getOrderStatusLabel({ status: 'delivered', returnStatus: 'custom_state' })).toBe('Custom State');
    expect(getOrderStatusLabel({ status: 'delivered', returnStatus: 'none' })).toBe('Delivered');
  });

  it('matches admin sidebar routes', () => {
    expect(adminRouteMatchesOrder('all', {})).toBe(true);
    expect(adminRouteMatchesOrder('processed', { status: 'packed' })).toBe(true);
    expect(adminRouteMatchesOrder('processed', { status: 'pending' })).toBe(false);
    expect(adminRouteMatchesOrder('out-for-delivery', { status: 'out_for_delivery' })).toBe(true);
    expect(adminRouteMatchesOrder('returned', { status: 'delivered', returnStatus: 'returned' })).toBe(true);
    expect(adminRouteMatchesOrder('returned', { status: 'delivered' })).toBeFalsy();
    expect(adminRouteMatchesOrder('cancelled', { status: 'cancelled' })).toBe(true);
  });
});

describe('shared/utils/routeGeometry', () => {
  const path = [
    { lat: 22.7, lng: 75.8 },
    { lat: 22.7, lng: 75.81 },
    { lat: 22.71, lng: 75.81 },
  ];

  it('normalizes literal and google LatLng objects', () => {
    expect(toLatLngLiteral({ lat: () => 1, lng: () => 2 })).toEqual({ lat: 1, lng: 2 });
    expect(toLatLngLiteral({ lat: 'x', lng: 1 })).toBeNull();
    expect(haversineMeters({ lat: 0, lng: 0 }, null)).toBeNull();
  });

  it('computes distances', () => {
    expect(haversineMeters(path[0], path[0])).toBe(0);
    const total = pathLengthMeters(path);
    expect(total).toBeGreaterThan(2000);
    expect(total).toBeLessThan(2300);
    expect(pathLengthMeters([path[0]])).toBe(0);
  });

  it('snaps GPS onto the nearest segment', () => {
    const snap = snapToRoute(path, { lat: 22.7001, lng: 75.805 });
    expect(snap.segmentIndex).toBe(0);
    expect(snap.distance).toBeLessThan(20);
    expect(snap.point.lat).toBeCloseTo(22.7, 4);
    expect(snapToRoute([path[0]], path[0])).toBeNull();
  });

  it('builds the remaining path from a snap', () => {
    const snap = snapToRoute(path, { lat: 22.705, lng: 75.8101 });
    const rest = remainingPath(path, snap);
    expect(rest[0]).toEqual(snap.point);
    expect(rest[rest.length - 1]).toEqual(path[2]);
    expect(remainingPath(path, null)).toBe(path);
  });

  it('bounds snap thresholds by accuracy', () => {
    expect(snapThresholdFor(undefined)).toBe(ROUTE_TRACKING.SNAP_MAX_M);
    expect(snapThresholdFor(5)).toBe(25);
    expect(snapThresholdFor(30)).toBe(45);
    expect(snapThresholdFor(500)).toBe(60);
  });
});

describe('lib/utils cn', () => {
  it('merges classes and resolves tailwind conflicts', () => {
    const hidden = false;
    expect(cn('p-2', hidden && 'hidden', 'p-4', { 'text-red-500': true })).toBe('p-4 text-red-500');
  });
});

describe('shared hooks', () => {
  it('useDebounce delays updates', () => {
    jest.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 300), { initialProps: { v: 'a' } });
    rerender({ v: 'ab' });
    expect(result.current).toBe('a');
    act(() => jest.advanceTimersByTime(300));
    expect(result.current).toBe('ab');
    jest.useRealTimers();
  });

  it('useFilters tracks, detects and resets filters', () => {
    const { result } = renderHook(() => useFilters({ status: 'all', q: '', tags: [] }));
    expect(result.current.hasActiveFilters).toBe(false);
    act(() => result.current.setFilter('status', 'pending'));
    expect(result.current.filters.status).toBe('pending');
    expect(result.current.hasActiveFilters).toBe(true);
    act(() => result.current.reset());
    expect(result.current.filters.status).toBe('all');
    act(() => result.current.setFilter('tags', ['a']));
    expect(result.current.hasActiveFilters).toBe(true);
    act(() => result.current.replaceAll(null));
    expect(result.current.filters).toEqual({});
  });

  it('usePagination clamps pages', () => {
    const { result } = renderHook(() => usePagination({ initialLimit: 10, total: 35 }));
    expect(result.current.totalPages).toBe(4);
    expect(result.current.hasPrev).toBe(false);
    act(() => result.current.setPage(10));
    expect(result.current.page).toBe(4);
    expect(result.current.hasNext).toBe(false);
    act(() => result.current.prevPage());
    expect(result.current.page).toBe(3);
    act(() => result.current.setPage(-2));
    expect(result.current.page).toBe(1);
    act(() => result.current.nextPage());
    act(() => result.current.reset());
    expect(result.current.page).toBe(1);
  });

  it('useApiState loads data, unwraps axios responses and captures errors', async () => {
    const ok = jest.fn().mockResolvedValue({ data: { items: [1] } });
    const { result } = renderHook(() => useApiState(ok, []));
    expect(result.current.loading).toBe(true);
    await act(async () => {});
    expect(result.current.data).toEqual({ items: [1] });
    expect(result.current.loading).toBe(false);

    const err = new Error('nope');
    const bad = jest.fn().mockRejectedValue(err);
    const failed = renderHook(() => useApiState(bad, []));
    await act(async () => {});
    expect(failed.result.current.error).toBe(err);
  });

  it('useApiState respects enabled=false', () => {
    const fetcher = jest.fn();
    const { result } = renderHook(() => useApiState(fetcher, [], { enabled: false }));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
  });

  it('useConfirmDialog opens, confirms and stays open on failure', async () => {
    const { result } = renderHook(() => useConfirmDialog());
    const onConfirm = jest.fn().mockResolvedValue();
    act(() => result.current.open({ title: 'Delete?', onConfirm }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.confirmLabel).toBe('Confirm');
    await act(async () => result.current.handleConfirm());
    expect(onConfirm).toHaveBeenCalled();
    expect(result.current.isOpen).toBe(false);

    act(() => result.current.open({ onConfirm: () => Promise.reject(new Error('x')) }));
    await act(async () => result.current.handleConfirm());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.loading).toBe(false);
    act(() => result.current.close());
    expect(result.current.isOpen).toBe(false);
  });
});
