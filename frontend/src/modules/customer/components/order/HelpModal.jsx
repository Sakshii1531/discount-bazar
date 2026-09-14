import React, { useState, useEffect } from 'react';
import { X, MessageCircle, Phone, ChevronRight, AlertCircle, PackageX, Truck, PlusCircle, Send, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { customerApi } from '../../services/customerApi';
import { useToast } from '@shared/components/ui/Toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const HelpModal = ({ isOpen, onClose, orderId }) => {
    const { showToast } = useToast();
    const [isTicketMode, setIsTicketMode] = useState(false);
    const [ticketLoading, setTicketLoading] = useState(false);
    const [ticketData, setTicketData] = useState({
        subject: '',
        description: '',
        priority: 'medium'
    });

    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    const issues = [
        { icon: PackageX, label: 'Items missing or incorrect', sub: 'Get a refund or replacement' },
        { icon: AlertCircle, label: 'Item quality issue', sub: 'Report damaged or expired items' },
        { icon: Truck, label: 'Delivery delay', sub: 'Track your order status' },
    ];

    const handleIssueClick = (item) => {
        setTicketData(prev => ({
            ...prev,
            subject: `${item.label} - Order ${orderId || ''}`.trim()
        }));
        setIsTicketMode(true);
    };

    const handleTicketSubmit = async (e) => {
        e.preventDefault();
        try {
            setTicketLoading(true);
            const res = await customerApi.createTicket({
                ...ticketData,
                userType: 'Customer'
            });
            if (res.data.success) {
                showToast("Ticket raised successfully", "success");
                setTicketData({ subject: '', description: '', priority: 'medium' });
                setIsTicketMode(false);
                onClose();
            }
        } catch (error) {
            showToast(error.response?.data?.message || "Failed to create ticket", "error");
        } finally {
            setTicketLoading(false);
        }
    };

    const handleClose = () => {
        setIsTicketMode(false);
        onClose();
    };

    return (
        <AnimatePresence>
            {isOpen && (
                <>
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={handleClose}
                        className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center sm:p-4 bg-black/60 backdrop-blur-sm"
                    >
                        <motion.div
                            initial={{ y: "100%" }}
                            animate={{ y: 0 }}
                            exit={{ y: "100%" }}
                            transition={{ type: "spring", damping: 25, stiffness: 300 }}
                            onClick={(e) => e.stopPropagation()}
                            className="bg-white rounded-t-[2rem] sm:rounded-3xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
                        >
                            {!isTicketMode ? (
                                // View 1: Issue Selection
                                <div className="p-6 overflow-y-auto">
                                    <div className="flex items-center justify-between mb-6">
                                        <div>
                                            <h2 className="text-xl font-black text-slate-800">Need Help?</h2>
                                            <p className="text-sm text-slate-500 font-medium">Select an issue with your order</p>
                                        </div>
                                        <button onClick={handleClose} className="p-2 bg-slate-50 rounded-full hover:bg-slate-100 transition-colors">
                                            <X size={20} className="text-slate-500" />
                                        </button>
                                    </div>

                                    <div className="space-y-3 mb-8">
                                        {issues.map((item, idx) => (
                                            <button 
                                                key={idx}
                                                onClick={() => handleIssueClick(item)}
                                                className="w-full flex items-center justify-between p-4 rounded-2xl border border-slate-100 hover:border-brand-200 hover:bg-brand-50/50 transition-all group"
                                            >
                                                <div className="flex items-center gap-4">
                                                    <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-500 group-hover:bg-white group-hover:text-primary transition-colors">
                                                        <item.icon size={20} />
                                                    </div>
                                                    <div className="text-left">
                                                        <h3 className="font-bold text-slate-800 text-sm group-hover:text-primary transition-colors">{item.label}</h3>
                                                        <p className="text-xs text-slate-400 font-medium">{item.sub}</p>
                                                    </div>
                                                </div>
                                                <ChevronRight size={18} className="text-slate-300 group-hover:text-primary transition-colors" />
                                            </button>
                                        ))}
                                    </div>

                                    <div className="grid grid-cols-2 gap-3">
                                        <button onClick={() => setIsTicketMode(true)} className="col-span-2 py-3.5 rounded-xl border-2 border-primary text-primary font-bold flex items-center justify-center gap-2 hover:bg-brand-50 transition-colors shadow-lg shadow-brand-50">
                                            <PlusCircle size={18} /> Raise a Ticket
                                        </button>
                                        <Link to="/chat" className="py-3.5 rounded-xl bg-slate-900 text-white font-bold flex items-center justify-center gap-2 hover:bg-slate-800 transition-colors">
                                            <MessageCircle size={18} /> Chat Us
                                        </Link>
                                        <button className="py-3.5 rounded-xl border border-slate-200 text-slate-700 font-bold flex items-center justify-center gap-2 hover:bg-slate-50 transition-colors">
                                            <Phone size={18} /> Call Us
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                // View 2: Ticket Form
                                <div className="p-6 overflow-y-auto">
                                    <div className="flex items-center justify-between mb-8">
                                        <div className="flex items-center gap-3">
                                            <button onClick={() => setIsTicketMode(false)} className="p-2 bg-slate-50 rounded-full hover:bg-slate-100 transition-colors">
                                                <ArrowLeft size={20} className="text-slate-500" />
                                            </button>
                                            <div>
                                                <h2 className="text-xl font-black text-slate-800">Raise a Ticket</h2>
                                                <p className="text-sm text-slate-500 font-medium">Describe your issue in detail</p>
                                            </div>
                                        </div>
                                        <button onClick={handleClose} className="p-2 bg-slate-50 rounded-full hover:bg-slate-100 transition-colors">
                                            <X size={20} className="text-slate-500" />
                                        </button>
                                    </div>

                                    <form onSubmit={handleTicketSubmit} className="space-y-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Subject</label>
                                            <input
                                                type="text"
                                                required
                                                value={ticketData.subject}
                                                onChange={(e) => setTicketData({ ...ticketData, subject: e.target.value })}
                                                placeholder="What's the issue about?"
                                                className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 text-sm font-bold outline-none ring-1 ring-transparent focus:ring-primary/20 transition-all"
                                            />
                                        </div>

                                        <div className="grid grid-cols-3 gap-3">
                                            {['low', 'medium', 'high'].map((p) => (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    onClick={() => setTicketData({ ...ticketData, priority: p })}
                                                    className={cn(
                                                        "py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border",
                                                        ticketData.priority === p
                                                            ? "bg-primary text-primary-foreground border-primary shadow-lg shadow-brand-100"
                                                            : "bg-white text-slate-400 border-slate-100 hover:bg-slate-50"
                                                    )}
                                                >
                                                    {p}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-1">Description</label>
                                            <textarea
                                                required
                                                value={ticketData.description}
                                                onChange={(e) => setTicketData({ ...ticketData, description: e.target.value })}
                                                placeholder="Please explain the issue clearly..."
                                                className="w-full bg-slate-50 border-none rounded-2xl px-5 py-4 text-sm font-bold min-h-[150px] outline-none ring-1 ring-transparent focus:ring-primary/20 transition-all"
                                            />
                                        </div>

                                        <Button
                                            type="submit"
                                            disabled={ticketLoading}
                                            className="w-full h-14 bg-primary hover:bg-[#0b721b] text-white text-lg font-black rounded-2xl shadow-xl shadow-brand-100 transition-all active:scale-95"
                                        >
                                            {ticketLoading ? (
                                                <div className="flex items-center gap-2 text-center w-full justify-center">
                                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    SUBMITTING...
                                                </div>
                                            ) : (
                                                <div className="flex items-center gap-2 text-center w-full justify-center">
                                                    <Send size={20} /> SUBMIT TICKET
                                                </div>
                                            )}
                                        </Button>
                                    </form>
                                </div>
                            )}
                        </motion.div>
                    </motion.div>
                </>
            )}
        </AnimatePresence>
    );
};

export default HelpModal;
