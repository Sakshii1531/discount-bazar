import axiosInstance from '@core/api/axios';

/**
 * Admin order and return endpoints.
 * Per-domain split (P4.5).
 */
export const adminOrdersApi = {
    getOrders: (params) =>
        axiosInstance.get('/orders/seller-orders', { params }),
    getOrderDetails: (orderId) =>
        axiosInstance.get(`/orders/details/${orderId}`),
    updateOrderStatus: (orderId, data) =>
        axiosInstance.put(`/orders/status/${orderId}`, data),

    getReturns: (params) =>
        axiosInstance.get('/orders/seller-returns', { params }),
    getReturnDetails: (orderId) =>
        axiosInstance.get(`/orders/${orderId}/returns`),
    approveReturn: (orderId, data) =>
        axiosInstance.put(`/orders/returns/${orderId}/approve`, data),
    rejectReturn: (orderId, data) =>
        axiosInstance.put(`/orders/returns/${orderId}/reject`, data),
    assignReturnDelivery: (orderId, data) =>
        axiosInstance.put(`/orders/returns/${orderId}/assign-delivery`, data),
    updateReturnQc: (orderId, data) =>
        axiosInstance.put(`/orders/returns/${orderId}/qc`, data),

    // Order cancellations
    getCancellations: (params) =>
        axiosInstance.get('/cancellations/admin', { params }),
    getCancellation: (id) =>
        axiosInstance.get(`/cancellations/admin/${id}`),
    getCancellationReports: (params) =>
        axiosInstance.get('/cancellations/admin/reports', { params }),
    reviewCancellation: (id) =>
        axiosInstance.post(`/cancellations/admin/${id}/review`),
    approveCancellation: (id, data) =>
        axiosInstance.post(`/cancellations/admin/${id}/approve`, data),
    rejectCancellation: (id, data) =>
        axiosInstance.post(`/cancellations/admin/${id}/reject`, data),
    retryCancellationRefund: (id, data) =>
        axiosInstance.post(`/cancellations/admin/${id}/refund/retry`, data),
    resolveCancellationRefund: (id, data) =>
        axiosInstance.post(`/cancellations/admin/${id}/refund/resolve`, data),
    confirmCancellationReturn: (id, data) =>
        axiosInstance.post(`/cancellations/admin/${id}/return/confirm`, data),
    inspectCancellationReturn: (id, data) =>
        axiosInstance.post(`/cancellations/admin/${id}/inspection`, data),
    adminCancelOrder: (orderId, data) =>
        axiosInstance.post(`/cancellations/admin/orders/${orderId}/cancel`, data),
    getCancellationPolicy: () =>
        axiosInstance.get('/cancellations/admin/policy'),
    updateCancellationPolicy: (data) =>
        axiosInstance.put('/cancellations/admin/policy', data),
};

export default adminOrdersApi;
