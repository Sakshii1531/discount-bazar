import React from "react";
import { ChevronLeft, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@core/context/SettingsContext";

const RefundPage = () => {
    const navigate = useNavigate();
    const { settings } = useSettings();
    const appName = settings?.appName || "App";

    return (
        <div className="min-h-screen bg-slate-50 font-sans pb-10">
            <div className="bg-white sticky top-0 z-30 px-4 py-3 flex items-center gap-1 shadow-sm">
                <button
                    onClick={() => {
                        if (window.history.state && window.history.state.idx > 0) {
                            navigate(-1);
                        } else {
                            navigate("/");
                        }
                    }}
                    className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors"
                >
                    <ChevronLeft size={24} className="text-slate-600" />
                </button>
                <h1 className="text-lg font-black text-slate-800">Refund Policy</h1>
            </div>

            <div className="p-5 max-w-3xl mx-auto space-y-6">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="h-12 w-12 rounded-2xl bg-brand-50 flex items-center justify-center text-primary">
                            <RotateCcw size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Refund &amp; Return Policy</h2>
                            <p className="text-xs text-slate-500 font-medium">Last updated: Oct 2025</p>
                        </div>
                    </div>

                    <div className="prose prose-slate prose-sm max-w-none text-slate-600 space-y-4">
                        {settings?.refundPolicyText ? (
                            <div style={{ whiteSpace: "pre-wrap" }}>{settings.refundPolicyText}</div>
                        ) : (
                            <>
                                <p>
                                    At {appName}, we strive to ensure your complete satisfaction with every order. Please read our refund and return policy carefully.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">1. Eligibility for Returns</h3>
                                <p>
                                    Items may be returned within 24 hours of delivery if they are damaged, defective, or incorrect. Perishable goods (fruits, vegetables, dairy) must be reported within 2 hours of delivery.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">2. Non-Returnable Items</h3>
                                <p>
                                    Certain categories such as personal care products, medicines, and items marked as non-returnable at the time of purchase are not eligible for return.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">3. Refund Process</h3>
                                <p>
                                    Once your return is approved, the refund will be credited to your original payment method within 5-7 business days. COD orders will be refunded to your {appName} wallet.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">4. How to Request a Return</h3>
                                <p>
                                    Go to My Orders, select the order, and tap "Request Return". Our support team will review your request within 24 hours.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">5. Contact Us</h3>
                                <p>
                                    For refund queries, please contact our support team
                                    {settings?.supportEmail ? ` at ${settings.supportEmail}` : ""}
                                    {settings?.supportPhone ? ` or call ${settings.supportPhone}` : ""}.
                                </p>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RefundPage;
