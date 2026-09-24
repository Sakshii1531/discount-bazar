import axiosInstance from '@core/api/axios';

export const posApi = {
    getCatalog: (params) => axiosInstance.get('/seller/pos/catalog', { params }),
    createSale: (data, idempotencyKey) =>
        axiosInstance.post('/seller/pos/sale', data, {
            headers: { 'Idempotency-Key': idempotencyKey },
        }),
    previewSale: (data) => axiosInstance.post('/seller/pos/sale/preview', data),
    getSales: (params) => axiosInstance.get('/seller/pos/sales', { params }),
    getOrderForReturn: (orderId) =>
        axiosInstance.get(`/seller/pos/returns/order/${encodeURIComponent(orderId)}`),
    editSale: (orderId, data) => axiosInstance.put(`/seller/pos/sales/${encodeURIComponent(orderId)}`, data),
    createReturn: (data) => axiosInstance.post('/seller/pos/returns', data),
    getReturns: (params) => axiosInstance.get('/seller/pos/returns', { params }),
};
