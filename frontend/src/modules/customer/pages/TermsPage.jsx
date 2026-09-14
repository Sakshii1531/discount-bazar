import React from 'react';
import { ChevronLeft, ScrollText, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@core/context/SettingsContext';

// Helper to parse inline markdown formatting (bold, etc.)
const parseInline = (text) => {
    if (!text) return null;
    const regex = /(\*\*[^*]+\*\*)/g;
    const segments = text.split(regex);

    return segments.map((seg, idx) => {
        if (seg.startsWith('**') && seg.endsWith('**')) {
            return (
                <strong key={idx} className="font-bold text-slate-900">
                    {seg.slice(2, -2)}
                </strong>
            );
        }
        return seg;
    });
};

// Line-by-line renderer for markdown formatted text
const renderFormattedContent = (content) => {
    if (!content) return null;

    const rawLines = content.split(/\r?\n/);
    const elements = [];
    let currentParagraphLines = [];
    let currentListItems = [];

    const flushParagraph = () => {
        if (currentParagraphLines.length > 0) {
            const text = currentParagraphLines.join(' ').trim();
            if (text) {
                elements.push(
                    <p key={`p-${elements.length}`} className="text-sm text-slate-600 leading-relaxed">
                        {parseInline(text)}
                    </p>
                );
            }
            currentParagraphLines = [];
        }
    };

    const flushList = () => {
        if (currentListItems.length > 0) {
            elements.push(
                <ul key={`ul-${elements.length}`} className="space-y-1.5 my-2 pl-1">
                    {currentListItems.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-2 text-sm text-slate-600 leading-relaxed">
                            <span className="w-1.5 h-1.5 rounded-full bg-primary/70 mt-2 shrink-0" />
                            <span>{parseInline(item)}</span>
                        </li>
                    ))}
                </ul>
            );
            currentListItems = [];
        }
    };

    for (let i = 0; i < rawLines.length; i++) {
        const line = rawLines[i].trim();

        if (!line) {
            flushParagraph();
            flushList();
            continue;
        }

        // Check for headings (#, ##, ###, ####)
        const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            flushParagraph();
            flushList();
            const title = headingMatch[2];
            elements.push(
                <div key={`h-${elements.length}`} className="pt-4 first:pt-0">
                    <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2.5 mb-1.5">
                        <span className="w-1.5 h-4 sm:h-5 bg-primary rounded-full shrink-0" />
                        <span>{parseInline(title)}</span>
                    </h3>
                </div>
            );
            continue;
        }

        // Check for bullet or numbered lists (-, *, •, 1., 2.)
        const listMatch = line.match(/^([*\-•]|\d+\.)\s+(.+)$/);
        if (listMatch) {
            flushParagraph();
            currentListItems.push(listMatch[2]);
            continue;
        }

        // Regular paragraph line
        flushList();
        currentParagraphLines.push(line);
    }

    flushParagraph();
    flushList();

    return elements;
};

const TermsPage = () => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const appName = settings?.appName || 'App';
    const companyName = settings?.companyName || appName;

    const handleClose = () => {
        if (window.history.length > 1) {
            navigate(-1);
        } else {
            window.close();
        }
    };

    return (
        <div className="min-h-screen bg-slate-50/80 font-sans pb-12">
            {/* Sticky Modern Header */}
            <div className="bg-white/95 backdrop-blur-md sticky top-0 z-30 px-4 py-3 flex items-center justify-between border-b border-slate-100 shadow-2xs">
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleClose}
                        className="p-2 -ml-1 rounded-full hover:bg-slate-100 active:scale-95 transition-all text-slate-700"
                        aria-label="Back"
                    >
                        <ChevronLeft size={22} />
                    </button>
                    <h1 className="text-base sm:text-lg font-black text-slate-800 tracking-tight">Terms & Conditions</h1>
                </div>
                <button
                    onClick={handleClose}
                    className="p-2 -mr-1 rounded-full hover:bg-slate-100 active:scale-95 transition-all text-slate-500 hover:text-slate-700"
                    aria-label="Close"
                >
                    <X size={20} />
                </button>
            </div>

            <div className="px-3 py-4 sm:p-6 max-w-3xl mx-auto space-y-4">
                <div className="bg-white rounded-2xl sm:rounded-3xl p-5 sm:p-8 shadow-xs border border-slate-100 space-y-5">
                    {/* Header Banner */}
                    <div className="flex items-center gap-3.5 pb-5 border-b border-slate-100">
                        <div className="h-12 w-12 rounded-2xl bg-brand-50 flex items-center justify-center text-primary shrink-0 shadow-2xs">
                            <ScrollText size={24} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                <h2 className="text-lg sm:text-xl font-bold text-slate-800 tracking-tight">
                                    Terms of Use
                                </h2>
                                <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 bg-brand-50 text-brand-700 border border-brand-100 rounded-full">
                                    Official
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 font-medium mt-0.5 flex items-center gap-1.5">
                                <span>{appName} Customer Agreement</span>
                                <span>•</span>
                                <span>Last updated: Oct 2025</span>
                            </p>
                        </div>
                    </div>

                    {/* Content Section */}
                    <div className="space-y-4 text-slate-600">
                        {settings?.termsConditionsText ? (
                            renderFormattedContent(settings.termsConditionsText)
                        ) : (
                            <>
                                <p className="text-sm text-slate-600 leading-relaxed">
                                    Welcome to {appName}. By accessing or using our mobile application and services, you agree to be bound by these Terms and Conditions.
                                </p>

                                <div className="pt-4">
                                    <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2.5 mb-1.5">
                                        <span className="w-1.5 h-4 sm:h-5 bg-primary rounded-full shrink-0" />
                                        <span>1. Acceptance of Terms</span>
                                    </h3>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        By creating an account or using our services, you agree to comply with these terms. If you do not agree, you may not use our services.
                                    </p>
                                </div>

                                <div className="pt-4">
                                    <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2.5 mb-1.5">
                                        <span className="w-1.5 h-4 sm:h-5 bg-primary rounded-full shrink-0" />
                                        <span>2. Use of Service</span>
                                    </h3>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        You must be at least 18 years old to use our services. You agree to provide accurate information during registration and to keep your account secure.
                                    </p>
                                </div>

                                <div className="pt-4">
                                    <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2.5 mb-1.5">
                                        <span className="w-1.5 h-4 sm:h-5 bg-primary rounded-full shrink-0" />
                                        <span>3. Orders and Payments</span>
                                    </h3>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        All orders are subject to availability. Prices are subject to change without notice. We reserve the right to cancel orders at our discretion.
                                    </p>
                                </div>

                                <div className="pt-4">
                                    <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2.5 mb-1.5">
                                        <span className="w-1.5 h-4 sm:h-5 bg-primary rounded-full shrink-0" />
                                        <span>4. Intellectual Property</span>
                                    </h3>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        All content, trademarks, and data on this app are the property of {companyName} and are protected by law.
                                    </p>
                                </div>

                                <div className="pt-4">
                                    <h3 className="text-base sm:text-lg font-black text-slate-900 flex items-center gap-2.5 mb-1.5">
                                        <span className="w-1.5 h-4 sm:h-5 bg-primary rounded-full shrink-0" />
                                        <span>5. Termination</span>
                                    </h3>
                                    <p className="text-sm text-slate-600 leading-relaxed">
                                        We reserve the right to end or suspend your account at any time for violation of these terms.
                                    </p>
                                </div>
                            </>
                        )}
                    </div>

                    {/* Footer Contact Note */}
                    <div className="pt-5 border-t border-slate-100 text-xs text-slate-400 text-center leading-relaxed">
                        If you have any questions regarding these Terms & Conditions, please contact us at{' '}
                        <span className="font-semibold text-slate-600">
                            {settings?.supportEmail || `support@${appName.toLowerCase().replace(/\s+/g, '')}.com`}
                        </span>.
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TermsPage;
