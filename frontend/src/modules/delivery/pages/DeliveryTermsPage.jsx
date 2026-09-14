import React, { useEffect } from 'react';
import { ChevronLeft, ShieldCheck, Bike, Award, DollarSign, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@core/context/SettingsContext';

const DeliveryTermsPage = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const appName = settings?.appName || 'App';
  const companyName = settings?.companyName || appName;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-12">
      {/* Header */}
      <div className="bg-white sticky top-0 z-30 px-4 py-3.5 flex items-center justify-between shadow-xs border-b border-slate-100">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              if (window.history.length > 1) {
                navigate(-1);
              } else {
                window.close();
              }
            }}
            className="p-2 -ml-1 rounded-full hover:bg-slate-100 transition-colors"
          >
            <ChevronLeft size={22} className="text-slate-700" />
          </button>
          <h1 className="text-base font-black text-slate-900">Delivery Partner Terms</h1>
        </div>
        <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 bg-slate-100 text-slate-700 rounded-full border border-slate-200">
          Partner Policy
        </span>
      </div>

      <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
        <div className="bg-white rounded-3xl p-6 sm:p-8 shadow-xs border border-slate-100 space-y-6">
          {/* Header Banner */}
          <div className="flex items-start gap-4 pb-6 border-b border-slate-100">
            <div className="h-14 w-14 rounded-2xl bg-black text-white flex items-center justify-center shrink-0 shadow-md">
              <Bike size={28} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                {appName} Delivery Partner Terms & Conditions
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Independent Partner Agreement • Updated Oct 2025
              </p>
            </div>
          </div>

          <div className="prose prose-slate max-w-none text-slate-700 space-y-6 text-sm leading-relaxed">
            <p>
              Welcome to the <strong>{appName} Delivery Partner Network</strong>. By registering, onboarding, or accepting delivery orders on the {appName} Partner platform, you agree to abide by these Delivery Partner Terms & Conditions.
            </p>

            {/* Section 1 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                1. Eligibility & Verification Requirements
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>You must be at least <strong>18 years of age</strong> to register as a Delivery Partner.</li>
                <li>You must possess valid identity documents including <strong>Aadhar Card</strong> and <strong>PAN Card</strong>.</li>
                <li>For motorized vehicle deliveries (Bike/Scooter), you must possess a valid <strong>Driving License</strong> and vehicle registration proof.</li>
                <li>You agree to submit authentic, unaltered KYC documents for automated and manual admin verification.</li>
              </ul>
            </div>

            {/* Section 2 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <Bike className="h-5 w-5 text-blue-600" />
                2. Order Fulfillment & Transport Safety
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>Delivery Partners operate as <strong>independent service providers</strong> and maintain full flexibility over their active hours.</li>
                <li>You agree to pick up orders promptly from merchant locations and deliver packages safely to customer addresses.</li>
                <li>You must adhere strictly to all regional traffic laws, speed limits, and safety regulations during duty hours.</li>
                <li>Packages must be handled with utmost care to prevent spillage, damage, or tampering during transit.</li>
              </ul>
            </div>

            {/* Section 3 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-amber-600" />
                3. Payouts, Earnings & Cash on Delivery (COD)
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>Earnings are calculated per completed delivery order based on distance, surge, and applicable incentive structures.</li>
                <li>Payouts will be transferred directly to your verified bank account according to the payout schedule.</li>
                <li>For Cash on Delivery (COD) orders, collected cash remains the property of {companyName} and must be deposited or settled in accordance with platform COD limits.</li>
                <li>Tips provided by customers are 100% passed through to the Delivery Partner.</li>
              </ul>
            </div>

            {/* Section 4 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <Award className="h-5 w-5 text-purple-600" />
                4. Code of Conduct & Customer Ratings
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>Delivery Partners must maintain professional, polite, and respectful conduct towards customers and store staff.</li>
                <li>Customers may rate delivery performance (1–5 stars) and provide feedback tags. High rating performance qualifies partners for bonus rewards.</li>
                <li>Verification OTP must be obtained from the customer upon order handover before marking orders as 'Delivered'.</li>
              </ul>
            </div>

            {/* Section 5 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-rose-600" />
                5. Zero Tolerance & Account Suspension
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>{companyName} maintains a strict zero-tolerance policy towards theft, package tampering, fraudulent location spoofing, or aggressive behavior.</li>
                <li>Submitting fraudulent KYC documents or allowing unverified third parties to operate your partner account will result in immediate account deactivation.</li>
                <li>{companyName} reserves the right to suspend accounts failing to meet basic quality or safety standards.</li>
              </ul>
            </div>

            <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 text-center">
              For any partner support or policy queries, contact {appName} Partner Helpdesk via the Partner App or support channel.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeliveryTermsPage;
