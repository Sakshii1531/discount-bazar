import axiosInstance from '@core/api/axios';

const B = '/seller/business';

export const businessApi = {
    dashboard: () => axiosInstance.get(`${B}/dashboard`),
    report: (type, params) => axiosInstance.get(`${B}/reports/${type}`, { params }),

    listSuppliers: () => axiosInstance.get(`${B}/suppliers`),
    saveSupplier: (data, id) => (id ? axiosInstance.put(`${B}/suppliers/${id}`, data) : axiosInstance.post(`${B}/suppliers`, data)),
    listCustomers: () => axiosInstance.get(`${B}/customers`),
    saveCustomer: (data, id) => (id ? axiosInstance.put(`${B}/customers/${id}`, data) : axiosInstance.post(`${B}/customers`, data)),
    partyLedger: (kind, id) => axiosInstance.get(`${B}/${kind}/${id}/ledger`),
    recordPayment: (data) => axiosInstance.post(`${B}/payments`, data),

    listPurchases: (params) => axiosInstance.get(`${B}/purchases`, { params }),
    createPurchase: (data) => axiosInstance.post(`${B}/purchases`, data),
    updatePurchase: (id, data) => axiosInstance.put(`${B}/purchases/${id}`, data),
    confirmPurchase: (id) => axiosInstance.post(`${B}/purchases/${id}/confirm`),
    cancelPurchase: (id) => axiosInstance.post(`${B}/purchases/${id}/cancel`),
    createPurchaseReturn: (data) => axiosInstance.post(`${B}/purchase-returns`, data),

    addExpense: (data) => axiosInstance.post(`${B}/expenses`, data),
    addCashEntry: (data) => axiosInstance.post(`${B}/cash-entries`, data),
    setOpening: (data) => axiosInstance.put(`${B}/cash-register/opening`, data),
    getSettings: () => axiosInstance.get(`${B}/settings`),
    saveSettings: (data) => axiosInstance.put(`${B}/settings`, data),
    closeDay: (data) => axiosInstance.post(`${B}/cash-register/close`, data),
    reopenDay: (data) => axiosInstance.post(`${B}/cash-register/reopen`, data),
    cashToday: (date) => axiosInstance.get(`${B}/cash-register/today`, { params: { date } }),
};
