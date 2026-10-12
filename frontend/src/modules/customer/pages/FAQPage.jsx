import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ChevronLeft, ChevronDown, Search, HelpCircle, MessageCircle, Phone, Mail, FileQuestion } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import axiosInstance from '@core/api/axios';
import { useSettings } from '@core/context/SettingsContext';
import { getJSON, setJSON, STORAGE_KEYS } from '@core/utils/storage';

const FAQ_CACHE_KEY = STORAGE_KEYS.FAQ_CACHE;
const FAQ_CACHE_TTL_MS = 5 * 60 * 1000;

const FAQItem = ({ question, answer, isOpen, onToggle }) => {
    return (
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_2px_8px_rgba(0,0,0,0.03)] overflow-hidden transition-all duration-200 hover:border-slate-300">
            <button
                type="button"
                onClick={onToggle}
                className="w-full px-5 py-4 flex items-center justify-between text-left gap-4 select-none cursor-pointer"
                aria-expanded={isOpen}
            >
                <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <HelpCircle size={16} />
                    </div>
                    <span className="text-sm md:text-base font-bold text-slate-800 leading-snug">
                        {question}
                    </span>
                </div>
                <div className={cn(
                    "w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 shrink-0 transition-transform duration-300",
                    isOpen && "rotate-180 bg-primary/10 text-primary"
                )}>
                    <ChevronDown size={16} />
                </div>
            </button>

            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.25, ease: "easeInOut" }}
                    >
                        <div className="px-5 pb-5 pt-1 text-xs md:text-sm text-slate-600 leading-relaxed border-t border-slate-100/80 mt-1 whitespace-pre-line pl-16">
                            {answer}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

const FAQPage = () => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';
    const supportPhone = settings?.supportPhone || '';
    const supportEmail = settings?.supportEmail || '';

    const [faqs, setFaqs] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [openIndex, setOpenIndex] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState('All');

    useEffect(() => {
        let isMounted = true;
        const fetchFaqs = async () => {
            const cached = getJSON(FAQ_CACHE_KEY, null, { storage: 'session' });
            if (cached && Array.isArray(cached.items) && cached.items.length > 0) {
                if (isMounted) {
                    setFaqs(cached.items);
                    setIsLoading(false);
                }
                return;
            }

            try {
                const response = await axiosInstance.get('/public/faqs', {
                    params: { category: 'Customer', status: 'published' }
                });
                const data = response.data?.result ?? response.data;
                const list = Array.isArray(data?.items) ? data.items : Array.isArray(data?.results) ? data.results : [];
                if (isMounted) {
                    setFaqs(list);
                    setIsLoading(false);
                }
                setJSON(
                    FAQ_CACHE_KEY,
                    { items: list },
                    { storage: 'session', ttlMs: FAQ_CACHE_TTL_MS }
                );
            } catch (error) {
                console.error('Failed to load FAQs:', error);
                if (isMounted) {
                    setIsLoading(false);
                }
            }
        };

        fetchFaqs();
        return () => { isMounted = false; };
    }, []);

    // Filter categories
    const categories = useMemo(() => {
        const unique = new Set(faqs.map(f => f.category).filter(Boolean));
        return ['All', ...Array.from(unique)];
    }, [faqs]);

    const filteredFaqs = useMemo(() => {
        return faqs.filter(faq => {
            const matchesCategory = selectedCategory === 'All' || faq.category === selectedCategory;
            const query = searchQuery.trim().toLowerCase();
            const matchesQuery = !query ||
                (faq.question && faq.question.toLowerCase().includes(query)) ||
                (faq.answer && faq.answer.toLowerCase().includes(query));
            return matchesCategory && matchesQuery;
        });
    }, [faqs, selectedCategory, searchQuery]);

    const handleToggle = (idx) => {
        setOpenIndex(prev => prev === idx ? null : idx);
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans pb-24">
            {/* Header */}
            <div className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 px-4 py-3.5 shadow-xs">
                <div className="max-w-4xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                if (window.history.length > 1) {
                                    navigate(-1);
                                } else {
                                    navigate('/');
                                }
                            }}
                            aria-label="Go back"
                            className="p-1.5 -ml-1 hover:bg-slate-100 rounded-full transition-colors text-slate-700"
                        >
                            <ChevronLeft size={22} />
                        </button>
                        <h1 className="text-lg md:text-xl font-black text-slate-900 tracking-tight">
                            Frequently Asked Questions
                        </h1>
                    </div>
                    <Link
                        to="/support"
                        className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                    >
                        Contact Support
                    </Link>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 pt-6 space-y-6">
                {/* Hero / Banner */}
                <div className="bg-gradient-to-br from-primary/10 via-primary/5 to-emerald-500/10 rounded-3xl p-6 md:p-8 border border-primary/20 relative overflow-hidden">
                    <div className="relative z-10 max-w-xl">
                        <span className="inline-block text-[10px] font-black uppercase tracking-widest bg-primary text-white px-2.5 py-0.5 rounded-full mb-3">
                            Help Center
                        </span>
                        <h2 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight leading-tight mb-2">
                            How can we help you today?
                        </h2>
                        <p className="text-xs md:text-sm text-slate-600 font-medium">
                            Find answers to commonly asked questions about orders, delivery, refunds, and your {appName} account.
                        </p>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
                    <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search answers (e.g. refund, delivery, payment)..."
                        className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-2xl text-sm font-medium text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all shadow-xs"
                    />
                </div>

                {/* Category Pills (if more than 1 category) */}
                {categories.length > 2 && (
                    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
                        {categories.map((cat) => (
                            <button
                                key={cat}
                                type="button"
                                onClick={() => setSelectedCategory(cat)}
                                className={cn(
                                    "px-4 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
                                    selectedCategory === cat
                                        ? "bg-primary text-white shadow-sm"
                                        : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                                )}
                            >
                                {cat}
                            </button>
                        ))}
                    </div>
                )}

                {/* FAQ List */}
                <div className="space-y-3">
                    {isLoading ? (
                        <div className="space-y-3">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <div key={i} className="h-16 bg-white rounded-2xl border border-slate-100 animate-pulse" />
                            ))}
                        </div>
                    ) : filteredFaqs.length > 0 ? (
                        filteredFaqs.map((faq, idx) => (
                            <FAQItem
                                key={faq._id || idx}
                                question={faq.question}
                                answer={faq.answer}
                                isOpen={openIndex === idx}
                                onToggle={() => handleToggle(idx)}
                            />
                        ))
                    ) : (
                        <div className="bg-white rounded-3xl p-10 text-center border border-slate-100 shadow-xs space-y-3">
                            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
                                <FileQuestion size={26} />
                            </div>
                            <h3 className="text-base font-bold text-slate-800">No matching questions found</h3>
                            <p className="text-xs text-slate-500 max-w-sm mx-auto">
                                We couldn't find any questions matching "{searchQuery}". Try different keywords or contact our support team.
                            </p>
                        </div>
                    )}
                </div>

                {/* Still Need Help Box */}
                <div className="bg-white rounded-3xl p-6 md:p-8 border border-slate-200/80 shadow-xs">
                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div>
                            <h3 className="text-base md:text-lg font-black text-slate-900">
                                Still have questions?
                            </h3>
                            <p className="text-xs md:text-sm text-slate-500 mt-1">
                                Can't find the answer you're looking for? Reach out directly to our customer support.
                            </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            {supportPhone && (
                                <a
                                    href={`tel:${supportPhone}`}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-colors"
                                >
                                    <Phone size={14} /> Call
                                </a>
                            )}
                            {supportEmail && (
                                <a
                                    href={`mailto:${supportEmail}`}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-bold rounded-xl transition-colors"
                                >
                                    <Mail size={14} /> Email
                                </a>
                            )}
                            <Link
                                to="/support"
                                className="inline-flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-white text-xs font-bold rounded-xl transition-all shadow-xs"
                            >
                                <MessageCircle size={14} /> Help &amp; Support
                            </Link>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default FAQPage;
