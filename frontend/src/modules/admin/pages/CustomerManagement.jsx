import React, { useState, useMemo, useEffect } from 'react';
import Card from '@shared/components/ui/Card';
import Badge from '@shared/components/ui/Badge';
import Modal from '@shared/components/ui/Modal';
import PageHeader from '@shared/components/ui/PageHeader';
import StatCard from '@shared/components/ui/StatCard';
import {
    Users,
    Search,
    Download,
    Eye,
    Phone,
    ShoppingBag,
    MoreVertical,
    UserPlus,
    RotateCw,
    Activity,
    Loader2,
    AlertCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import Pagination from '@shared/components/ui/Pagination';
import { adminApi } from '../services/adminApi';
import { toast } from 'sonner';
import { exportToCSV } from '@/lib/exportUtils';

const CustomerManagement = () => {
    const navigate = useNavigate();
    const [searchTerm, setSearchTerm] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [isExporting, setIsExporting] = useState(false);
    const [customers, setCustomers] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [isNewCustomerModalOpen, setIsNewCustomerModalOpen] = useState(false);
    const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
    const [modalError, setModalError] = useState('');
    const [newCustomerForm, setNewCustomerForm] = useState({
        name: '',
        phone: '',
        email: '',
        status: 'active',
    });

    const handleCreateCustomer = async (e) => {
        e?.preventDefault();
        setModalError('');
        const { name, phone, email, status } = newCustomerForm;
        const cleanPhone = phone?.trim();

        if (!cleanPhone) {
            setModalError("Phone number is required");
            toast.error("Phone number is required");
            return;
        }

        try {
            setIsCreatingCustomer(true);
            const formattedName = name?.trim() ? name.trim().replace(/\b\w/g, (c) => c.toUpperCase()) : '';
            const { data } = await adminApi.createUser({
                name: formattedName || undefined,
                phone: cleanPhone,
                email: email?.trim() || undefined,
                status,
            });

            if (data?.success) {
                toast.success("Customer created successfully!");
                setIsNewCustomerModalOpen(false);
                setModalError('');
                setNewCustomerForm({
                    name: '',
                    phone: '',
                    email: '',
                    status: 'active',
                });
                fetchCustomers(1);
            } else {
                const msg = data?.message || "Failed to create customer";
                setModalError(msg);
                toast.error(msg);
            }
        } catch (error) {
            console.error("Create customer error:", error);
            const rawMsg = error.response?.data?.message || error.message || "Failed to create customer";
            let friendlyMsg = rawMsg;
            if (rawMsg.includes("E11000") || rawMsg.includes("duplicate key")) {
                if (rawMsg.includes("phone") || rawMsg.includes("phone_1")) {
                    friendlyMsg = "Customer with this phone number already exists";
                } else if (rawMsg.includes("email") || rawMsg.includes("email_1")) {
                    friendlyMsg = "Customer with this email address already exists";
                } else {
                    friendlyMsg = "A customer with these details already exists";
                }
            }
            setModalError(friendlyMsg);
            toast.error(friendlyMsg);
        } finally {
            setIsCreatingCustomer(false);
        }
    };

    useEffect(() => {
        const timer = setTimeout(() => {
            fetchCustomers(1);
        }, 500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageSize, searchTerm, filterStatus]);
    const fetchCustomers = async (requestedPage = 1) => {
        try {
            setLoading(true);
            const params = { page: requestedPage, limit: pageSize };
            if (searchTerm.trim()) params.search = searchTerm.trim();
            if (filterStatus !== 'all') params.status = filterStatus;
            const { data } = await adminApi.getUsers(params);
            if (data.success) {
                const payload = data.result || {};
                const list = Array.isArray(payload.items) ? payload.items : (data.results || []);
                setCustomers(list);
                if (typeof payload.total === 'number') {
                    setTotal(payload.total);
                } else {
                    setTotal(list.length);
                }
                if (typeof payload.page === 'number') {
                    setPage(payload.page);
                } else {
                    setPage(requestedPage);
                }
            }
        } catch (error) {
            console.error("Error fetching customers:", error);
            toast.error("Failed to load customers");
        } finally {
            setLoading(false);
        }
    };

    const stats = useMemo(() => {
        const safeCustomers = Array.isArray(customers) ? customers : [];
        return {
            total: total,
            active: safeCustomers.filter(c => c.status === 'active').length,
            newToday: safeCustomers.filter(c => {
                const today = new Date().toISOString().split('T')[0];
                const joined = new Date(c.joinedDate).toISOString().split('T')[0];
                return joined === today;
            }).length
        };
    }, [customers, total]);

    const filteredCustomers = useMemo(() => {
        const safeCustomers = Array.isArray(customers) ? customers : [];
        return safeCustomers.filter(c => {
            const matchesSearch = (c.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (c.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (c.phone || '').includes(searchTerm);
            const matchesStatus = filterStatus === 'all' || c.status === filterStatus;
            return matchesSearch && matchesStatus;
        });
    }, [customers, searchTerm, filterStatus]);

    const handleExport = async () => {
        try {
            setIsExporting(true);
            let exportList = filteredCustomers;
            try {
                const params = { page: 1, limit: 5000 };
                if (searchTerm.trim()) params.search = searchTerm.trim();
                if (filterStatus !== 'all') params.status = filterStatus;
                const { data } = await adminApi.getUsers(params);
                if (data?.success) {
                    const payload = data.result || {};
                    const list = Array.isArray(payload.items) ? payload.items : (data.results || []);
                    if (list.length > 0) exportList = list;
                }
            } catch (err) {
                console.warn("Falling back to loaded customers for export", err);
            }

            if (!exportList || exportList.length === 0) {
                toast.error('No customer data to export');
                return;
            }

            const formatted = exportList.map(c => ({
                "Customer ID": c.id || c._id || '',
                "Name": c.name || '',
                "Email": c.email || '',
                "Phone": c.phone || '',
                "Total Orders": c.totalOrders || 0,
                "Total Spent (INR)": c.totalSpent || 0,
                "Status": (c.status || 'active').toUpperCase(),
                "Joined Date": c.joinedDate ? new Date(c.joinedDate).toLocaleDateString('en-IN') : ''
            }));

            exportToCSV(formatted, 'Customer_Database');
            toast.success('Customer database exported successfully!');
        } catch (error) {
            console.error("Export error:", error);
            toast.error("Failed to export customer database");
        } finally {
            setIsExporting(false);
        }
    };

    const getTimeAgo = (date) => {
        if (!date) return 'Never';
        const now = new Date();
        const past = new Date(date);
        const diffInMs = now - past;
        const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));

        if (diffInHours < 1) return 'Recently';
        if (diffInHours < 24) return `${diffInHours}h ago`;
        const diffInDays = Math.floor(diffInHours / 24);
        return `${diffInDays}d ago`;
    };

    return (
        <div className="ds-section-spacing">
            <PageHeader
                title="Customers"
                description="Manage and track all customer accounts"
                badge={
                    <div className="ds-stat-card-icon bg-brand-50">
                        <Users className="ds-icon-lg text-brand-600" />
                    </div>
                }
                actions={
                    <>
                        <button
                            onClick={handleExport}
                            disabled={isExporting}
                            className="ds-btn ds-btn-md bg-white ring-1 ring-gray-200 text-gray-700 hover:bg-gray-50"
                        >
                            {isExporting ? <RotateCw className="ds-icon-sm animate-spin" /> : <Download className="ds-icon-sm" />}
                            {isExporting ? 'EXPORTING...' : 'EXPORT'}
                        </button>
                        <button
                            onClick={() => {
                                setIsNewCustomerModalOpen(true);
                                setModalError('');
                            }}
                            className="ds-btn ds-btn-md bg-primary text-primary-foreground shadow-lg shadow-primary/20 active:scale-95 transition-all"
                        >
                            <UserPlus className="ds-icon-sm" />
                            NEW CUSTOMER
                        </button>
                    </>
                }
            />

            {/* Quick Stats Grid */}
            <div className="ds-grid-cards-3">
                <StatCard
                    label="Total Customers"
                    value={stats.total}
                    icon={Users}
                    color="text-brand-600"
                    bg="bg-brand-50"
                />
                <StatCard
                    label="Active Users"
                    value={stats.active}
                    icon={Activity}
                    color="text-brand-600"
                    bg="bg-brand-50"
                />
                <StatCard
                    label="New Today"
                    value={stats.newToday}
                    icon={UserPlus}
                    color="text-brand-600"
                    bg="bg-brand-50"
                />
            </div>

            {/* Filter & Search Bar */}
            <Card className="ds-card-compact">
                <div className="flex flex-col lg:flex-row gap-3">
                    <div className="flex-1 relative group">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 ds-icon-sm text-gray-400 group-focus-within:text-primary transition-colors" />
                        <input
                            type="text"
                            placeholder="Search by name, email or phone..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="ds-input w-full !pl-9"
                            style={{ paddingLeft: '2.25rem' }}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="flex bg-gray-100 p-0.5 rounded-lg">
                            {['all', 'active', 'inactive'].map((status) => (
                                <button
                                    key={status}
                                    onClick={() => setFilterStatus(status)}
                                    className={cn(
                                        "px-3 py-1.5 rounded-md ds-caption transition-all",
                                        filterStatus === status ? "bg-white text-primary shadow-sm" : "text-gray-400 hover:text-gray-600"
                                    )}
                                >
                                    {status}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </Card>

            {/* Customer List Table */}
            <Card className="overflow-hidden relative min-h-[400px]">
                {loading && (
                    <div className="absolute inset-0 bg-white/60 backdrop-blur-[1px] z-10 flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2">
                            <Loader2 className="h-8 w-8 text-primary animate-spin" />
                            <p className="ds-caption text-gray-500 font-medium">Loading Customers...</p>
                        </div>
                    </div>
                )}

                <div className="overflow-x-auto">
                    <table className="ds-table">
                        <thead className="ds-table-header">
                            <tr>
                                <th className="ds-table-header-cell">Customer</th>
                                <th className="ds-table-header-cell">Activity</th>
                                <th className="ds-table-header-cell">Total Spend</th>
                                <th className="ds-table-header-cell">Status</th>
                                <th className="ds-table-header-cell text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {!loading && filteredCustomers.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="px-6 py-20 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <div className="p-4 bg-gray-50 rounded-full">
                                                <Users className="h-8 w-8 text-gray-300" />
                                            </div>
                                            <p className="ds-h4 text-gray-400">No customers found</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : (
                                filteredCustomers.map((cust) => (
                                    <tr key={cust.id} className="ds-table-row">
                                        <td className="ds-table-cell">
                                            <div className="flex items-center gap-3">
                                                <img
                                                    src="https://cdn-icons-png.flaticon.com/512/149/149071.png"
                                                    alt=""
                                                    className="h-10 w-10 rounded-lg bg-gray-100 ring-2 ring-white shadow-sm object-cover"
                                                />
                                                <div>
                                                    <p
                                                        onClick={() => navigate(`/admin/customers/${cust.id}`)}
                                                        className="ds-h4 hover:text-primary cursor-pointer transition-colors"
                                                    >
                                                        {cust.name}
                                                    </p>
                                                    <p className="ds-body-sm text-gray-500">{cust.email || 'No email'}</p>
                                                    <div className="flex items-center gap-1.5 mt-0.5">
                                                        <Phone className="ds-icon-sm text-gray-300" />
                                                        <span className="text-[9px] text-gray-400">{cust.phone}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </td>
                                        <td className="ds-table-cell">
                                            <div>
                                                <div className="flex items-center gap-1.5 ds-body font-semibold">
                                                    <ShoppingBag className="ds-icon-sm text-primary" />
                                                    {cust.totalOrders} Orders
                                                </div>
                                                <p className="ds-body-sm text-gray-400 mt-0.5">Last: {getTimeAgo(cust.lastOrderDate)}</p>
                                            </div>
                                        </td>
                                        <td className="ds-table-cell ds-h4">
                                            ₹{(cust.totalSpent || 0).toLocaleString()}
                                        </td>
                                        <td className="ds-table-cell">
                                            <Badge
                                                variant={cust.status === 'active' ? 'success' : 'error'}
                                                className="ds-badge"
                                            >
                                                {cust.status}
                                            </Badge>
                                        </td>
                                        <td className="ds-table-cell text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <button
                                                    onClick={() => navigate(`/admin/customers/${cust.id}`)}
                                                    className="p-2 bg-primary/10 text-primary rounded-lg hover:bg-primary hover:text-white transition-all"
                                                >
                                                    <Eye className="ds-icon-sm" />
                                                </button>
                                                <button className="p-2 bg-gray-50 text-gray-400 rounded-lg hover:bg-gray-900 hover:text-white transition-all">
                                                    <MoreVertical className="ds-icon-sm" />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <div className="px-6 py-3 border-t border-gray-100">
                    <Pagination
                        page={page}
                        totalPages={Math.ceil(total / pageSize) || 1}
                        total={total}
                        pageSize={pageSize}
                        onPageChange={(p) => fetchCustomers(p)}
                        onPageSizeChange={(newSize) => {
                            setPageSize(newSize);
                            setPage(1);
                        }}
                        loading={loading}
                    />
                </div>
            </Card>

            {/* Create Customer Modal */}
            <Modal
                isOpen={isNewCustomerModalOpen}
                onClose={() => {
                    setIsNewCustomerModalOpen(false);
                    setModalError('');
                }}
                title="Add New Customer"
                size="md"
            >
                <form onSubmit={handleCreateCustomer} className="space-y-4 py-2">
                    {modalError && (
                        <div className="flex items-center gap-2.5 p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-medium animate-in fade-in duration-200">
                            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                            <span>{modalError}</span>
                        </div>
                    )}
                    <div>
                        <label className="text-xs font-bold text-slate-700 block mb-1.5">
                            Customer Name
                        </label>
                        <input
                            type="text"
                            placeholder="e.g. Ramesh Kumar"
                            value={newCustomerForm.name}
                            autoCapitalize="words"
                            onChange={(e) => {
                                const val = e.target.value;
                                const capitalized = val.replace(/\b\w/g, (c) => c.toUpperCase());
                                setNewCustomerForm({ ...newCustomerForm, name: capitalized });
                            }}
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all capitalize placeholder:normal-case"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-700 block mb-1.5">
                            Phone Number <span className="text-rose-500">*</span>
                        </label>
                        <input
                            type="tel"
                            required
                            placeholder="e.g. 9876543210"
                            value={newCustomerForm.phone}
                            onChange={(e) => {
                                setNewCustomerForm({ ...newCustomerForm, phone: e.target.value });
                                if (modalError) setModalError('');
                            }}
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-700 block mb-1.5">
                            Email Address <span className="text-slate-400 font-normal">(Optional)</span>
                        </label>
                        <input
                            type="email"
                            placeholder="e.g. ramesh@example.com"
                            value={newCustomerForm.email}
                            onChange={(e) => {
                                setNewCustomerForm({ ...newCustomerForm, email: e.target.value });
                                if (modalError) setModalError('');
                            }}
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-slate-700 block mb-1.5">
                            Account Status
                        </label>
                        <select
                            value={newCustomerForm.status}
                            onChange={(e) => setNewCustomerForm({ ...newCustomerForm, status: e.target.value })}
                            className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                        >
                            <option value="active">Active</option>
                            <option value="inactive">Inactive</option>
                        </select>
                    </div>

                    <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setIsNewCustomerModalOpen(false)}
                            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isCreatingCustomer}
                            className="flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground font-bold text-xs rounded-xl shadow-lg shadow-primary/20 hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
                        >
                            {isCreatingCustomer && <RotateCw className="h-3.5 w-3.5 animate-spin" />}
                            {isCreatingCustomer ? 'Creating...' : 'Create Customer'}
                        </button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default CustomerManagement;
