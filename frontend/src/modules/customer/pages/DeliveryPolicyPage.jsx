import React from "react";
import { ChevronLeft, Truck } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useSettings } from "@core/context/SettingsContext";

const DeliveryPolicyPage = () => {
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
                <h1 className="text-lg font-black text-slate-800">Delivery Policy</h1>
            </div>

            <div className="p-5 max-w-3xl mx-auto space-y-6">
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-slate-100">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="h-12 w-12 rounded-2xl bg-brand-50 flex items-center justify-center text-primary">
                            <Truck size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-slate-800">Delivery Policy</h2>
                            <p className="text-xs text-slate-500 font-medium">Last updated: Oct 2025</p>
                        </div>
                    </div>

                    <div className="prose prose-slate prose-sm max-w-none text-slate-600 space-y-4">
                        {settings?.deliveryPolicyText ? (
                            <div style={{ whiteSpace: "pre-wrap" }}>{settings.deliveryPolicyText}</div>
                        ) : (
                            <>
                                <p>
                                    At {appName}, we are committed to delivering your orders quickly and safely. Please review our delivery policy below.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">1. Delivery Areas</h3>
                                <p>
                                    We deliver to select areas in your city. You can check serviceability by entering your PIN code on our home page. We are constantly expanding our delivery network.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">2. Delivery Time</h3>
                                <p>
                                    Most orders are delivered within 12–30 minutes depending on your location and current demand. Estimated delivery time is displayed at checkout.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">3. Delivery Charges</h3>
                                <p>
                                    Delivery charges vary based on distance and order value. The exact delivery fee will be shown on the checkout page before you place your order.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">4. Missed Deliveries</h3>
                                <p>
                                    If you are unavailable at the time of delivery, our partner will attempt to contact you. If the delivery cannot be completed, the order may be cancelled and a refund will be processed as per our refund policy.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">5. Delivery Hours</h3>
                                <p>
                                    We operate 24/7 in most areas. Delivery hours may vary by location and are subject to change during public holidays.
                                </p>
                                <h3 className="text-slate-800 font-bold text-base mt-6">6. Contact Us</h3>
                                <p>
                                    For delivery-related queries, please reach out to our support team
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

export default DeliveryPolicyPage;
