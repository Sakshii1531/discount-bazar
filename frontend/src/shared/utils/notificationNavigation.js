/**
 * Helper to resolve and navigate to the target route of any notification
 * across Admin, Seller, Delivery, and Customer roles.
 */

export function resolveNotificationRoute(notif, explicitRole) {
    if (!notif) return null;

    const currentPath = typeof window !== 'undefined' ? window.location.pathname : '';
    const role = (
        explicitRole ||
        notif?.role ||
        notif?.data?.role ||
        (currentPath.startsWith('/admin') ? 'admin' :
         currentPath.startsWith('/seller') ? 'seller' :
         currentPath.startsWith('/delivery') ? 'delivery' : 'customer')
    ).toLowerCase();

    const rawCandidate =
        notif?.data?.link ||
        notif?.link ||
        notif?.data?.url ||
        notif?.url ||
        notif?.data?.targetUrl ||
        notif?.targetUrl ||
        '';

    const raw = String(rawCandidate || '').trim();

    if (raw) {
        if (/^https?:\/\//i.test(raw)) {
            try {
                const currentOrigin = typeof window !== 'undefined' ? window.location.origin : '';
                const parsed = new URL(raw, currentOrigin || 'http://localhost');
                const path = parsed.pathname + parsed.search + parsed.hash;

                const isSameOrigin = currentOrigin && parsed.origin === currentOrigin;
                const hasAppPathPrefix =
                    parsed.pathname.startsWith('/admin') ||
                    parsed.pathname.startsWith('/seller') ||
                    parsed.pathname.startsWith('/delivery') ||
                    parsed.pathname.startsWith('/orders') ||
                    parsed.pathname.startsWith('/chat') ||
                    parsed.pathname.startsWith('/support') ||
                    parsed.pathname.startsWith('/categories') ||
                    parsed.pathname.startsWith('/product') ||
                    parsed.pathname.startsWith('/notifications') ||
                    parsed.pathname.startsWith('/profile') ||
                    parsed.pathname.startsWith('/wallet');

                // If origin matches, or port matches dev, or it points to an app path, route internally
                if (isSameOrigin || hasAppPathPrefix || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
                    if (path && path !== '/') {
                        return path;
                    }
                } else {
                    return { isExternal: true, url: raw };
                }
            } catch {
                /* fallback to path logic below */
            }
        } else if (raw.startsWith('/') && raw !== '/') {
            return raw;
        }
    }

    // Infer from event type and role
    const eventType = String(
        notif?.data?.eventType ||
        notif?.type ||
        notif?.eventType ||
        ''
    ).toUpperCase();

    const orderId = notif?.data?.orderId || notif?.orderId;
    const sellerId = notif?.data?.sellerId || notif?.sellerId;
    const ticketId = notif?.data?.ticketId || notif?.ticketId;
    const productId = notif?.data?.productId || notif?.productId;

    if (eventType === 'NEW_SELLER_REGISTRATION') {
        return '/admin/sellers/pending';
    }

    if (eventType === 'NEW_DELIVERY_REGISTRATION') {
        return '/admin/delivery-boys/pending';
    }

    if (eventType === 'WITHDRAWAL_REQUESTED') {
        if (role === 'seller') return '/seller/withdrawals';
        if (role === 'delivery') return '/delivery/profile/withdrawals';
        const tab = notif?.data?.tab || (notif?.data?.userModel === 'Seller' ? 'sellers' : 'delivery');
        return `/admin/withdrawals?tab=${encodeURIComponent(tab)}`;
    }

    if (eventType === 'WITHDRAWAL_STATUS_UPDATED') {
        if (role === 'seller') return '/seller/withdrawals';
        if (role === 'delivery') return '/delivery/profile/withdrawals';
        return '/admin/withdrawals';
    }

    if (eventType === 'PRODUCT_MODERATION_REQUEST') {
        if (role === 'admin') return '/admin/products';
        return '/seller/products';
    }

    if (eventType === 'LOW_STOCK_ALERT') {
        if (role === 'seller') {
            return productId ? `/seller/inventory?productId=${encodeURIComponent(productId)}` : '/seller/inventory';
        }
        return '/admin/products';
    }

    if (eventType === 'SUPPORT_TICKET_MESSAGE' || eventType === 'SUPPORT_TICKET_STATUS_UPDATED') {
        if (role === 'admin') {
            return ticketId ? `/admin/support-tickets?ticketId=${encodeURIComponent(ticketId)}` : '/admin/support-tickets';
        }
        return ticketId ? `/chat?ticketId=${encodeURIComponent(ticketId)}` : '/chat';
    }

    if (eventType === 'COMMUNICATION_ISSUE_REPORTED' || eventType === 'COMMUNICATION_ISSUE_ESCALATED') {
        if (role === 'admin') {
            return orderId ? `/admin/order-communications?orderId=${encodeURIComponent(orderId)}` : '/admin/order-communications';
        }
        if (role === 'seller') return '/seller/orders';
        if (role === 'delivery') return '/delivery/dashboard';
        return '/orders';
    }

    if (eventType.includes('RETURN')) {
        if (role === 'admin') return '/admin/returns';
        if (role === 'seller') return '/seller/returns';
        if (role === 'delivery') return '/delivery/dashboard';
        return '/orders';
    }

    if (eventType.includes('CANCEL')) {
        if (role === 'admin') return '/admin/cancellations';
        if (role === 'seller') return '/seller/orders';
        if (role === 'delivery') return '/delivery/dashboard';
        return '/orders';
    }

    if (
        eventType.includes('ORDER') ||
        eventType === 'NEW_DELIVERY_BROADCAST' ||
        eventType === 'NEW_RETURN_BROADCAST' ||
        eventType === 'DELIVERY_ASSIGNED'
    ) {
        if (role === 'admin') {
            return orderId ? `/admin/orders/view/${encodeURIComponent(orderId)}` : '/admin/orders/all';
        }
        if (role === 'seller') {
            return orderId ? `/seller/orders?orderId=${encodeURIComponent(orderId)}` : '/seller/orders';
        }
        if (role === 'delivery') {
            return orderId ? `/delivery/order-details/${encodeURIComponent(orderId)}` : '/delivery/dashboard';
        }
        return orderId ? `/orders/${encodeURIComponent(orderId)}` : '/orders';
    }

    // Role-based root fallbacks
    if (role === 'admin') return '/admin';
    if (role === 'seller') return '/seller';
    if (role === 'delivery') return '/delivery/dashboard';
    return '/notifications';
}

export function navigateToNotification(notif, navigate, onClose, explicitRole) {
    if (!notif) return;
    const target = resolveNotificationRoute(notif, explicitRole);
    if (!target) return;

    if (typeof onClose === 'function') {
        onClose();
    }

    if (typeof target === 'object' && target.isExternal) {
        window.open(target.url, '_blank', 'noopener,noreferrer');
        return;
    }

    const path = typeof target === 'string' ? target : target?.path;
    if (path && typeof navigate === 'function') {
        navigate(path);
    }
}

