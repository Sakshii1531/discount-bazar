import { resolveNotificationRoute, navigateToNotification } from '@/shared/utils/notificationNavigation';

describe('notificationNavigation utility', () => {
    beforeEach(() => {
        // Mock window.location
        const mockLocation = new URL('http://localhost:5173/admin/dashboard');
        delete window.location;
        window.location = mockLocation;
    });

    describe('resolveNotificationRoute', () => {
        it('normalizes full localhost URL in notif.data.link for new seller registration', () => {
            const notif = {
                type: 'NEW_SELLER_REGISTRATION',
                data: {
                    eventType: 'NEW_SELLER_REGISTRATION',
                    sellerId: 'seller123',
                    link: 'http://localhost:5173/admin/sellers/pending',
                },
            };
            const route = resolveNotificationRoute(notif, 'admin');
            expect(route).toBe('/admin/sellers/pending');
        });

        it('normalizes production URL matching app paths', () => {
            const notif = {
                type: 'NEW_SELLER_REGISTRATION',
                data: {
                    eventType: 'NEW_SELLER_REGISTRATION',
                    sellerId: 'seller123',
                    link: 'https://discountbazar.online/admin/sellers/pending',
                },
            };
            const route = resolveNotificationRoute(notif, 'admin');
            expect(route).toBe('/admin/sellers/pending');
        });

        it('returns already relative path unchanged', () => {
            const notif = {
                type: 'NEW_DELIVERY_REGISTRATION',
                data: {
                    link: '/admin/delivery-boys/pending',
                },
            };
            const route = resolveNotificationRoute(notif, 'admin');
            expect(route).toBe('/admin/delivery-boys/pending');
        });

        it('infers route when link is missing or root /', () => {
            const notifSeller = {
                type: 'NEW_SELLER_REGISTRATION',
                data: {},
            };
            expect(resolveNotificationRoute(notifSeller, 'admin')).toBe('/admin/sellers/pending');

            const notifWithdrawal = {
                type: 'WITHDRAWAL_REQUESTED',
                data: { tab: 'sellers' },
            };
            expect(resolveNotificationRoute(notifWithdrawal, 'admin')).toBe('/admin/withdrawals?tab=sellers');

            const notifLowStock = {
                type: 'LOW_STOCK_ALERT',
                data: { productId: 'p100' },
            };
            expect(resolveNotificationRoute(notifLowStock, 'seller')).toBe('/seller/inventory?productId=p100');
        });

        it('routes customer orders properly', () => {
            const notifOrder = {
                type: 'ORDER_PLACED',
                data: { orderId: 'ORD99' },
            };
            expect(resolveNotificationRoute(notifOrder, 'customer')).toBe('/orders/ORD99');
        });

        it('routes delivery orders properly', () => {
            const notifDelivery = {
                type: 'NEW_DELIVERY_BROADCAST',
                data: { orderId: 'ORD101' },
            };
            expect(resolveNotificationRoute(notifDelivery, 'delivery')).toBe('/delivery/order-details/ORD101');
        });
    });

    describe('navigateToNotification', () => {
        it('calls navigate with normalized path and closes popup', () => {
            const navigate = jest.fn();
            const onClose = jest.fn();
            const notif = {
                type: 'NEW_SELLER_REGISTRATION',
                data: {
                    link: 'http://localhost:5173/admin/sellers/pending',
                },
            };

            navigateToNotification(notif, navigate, onClose, 'admin');

            expect(onClose).toHaveBeenCalled();
            expect(navigate).toHaveBeenCalledWith('/admin/sellers/pending');
        });
    });
});
