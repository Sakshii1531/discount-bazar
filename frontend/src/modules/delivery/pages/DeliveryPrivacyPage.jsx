import React, { useEffect } from 'react';
import useSafeBack from "@/core/hooks/useSafeBack";
import { ChevronLeft, ShieldCheck, Bike, MapPin, Camera, Lock, DollarSign, AlertCircle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@core/context/SettingsContext';

const DeliveryPrivacyPage = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const appName = settings?.appName || 'Discount Bazar';
  const companyName = settings?.companyName || appName;
  const supportEmail = settings?.supportEmail || `support@${appName.toLowerCase().replace(/\s+/g, '')}.com`;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  // Back stays inside the app even when this page was opened directly.
  const handleClose = useSafeBack("/delivery/auth");

  return (
    <div className="min-h-screen bg-slate-50 font-sans pb-12">
      {/* Header */}
      <div className="bg-white sticky top-0 z-30 px-4 py-3.5 flex items-center justify-between shadow-xs border-b border-slate-100">
        <div className="flex items-center gap-2">
          <button
            onClick={handleClose}
            className="p-2 -ml-1 rounded-full hover:bg-slate-100 transition-colors"
            aria-label="Back"
          >
            <ChevronLeft size={22} className="text-slate-700" />
          </button>
          <h1 className="text-base font-black text-slate-900">Delivery Partner Privacy Policy</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full border border-emerald-200">
            Partner Policy
          </span>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
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
                {appName} Delivery Partner Privacy Policy
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Rider & Delivery Personnel Data Protection • Updated Oct 2025
              </p>
            </div>
          </div>

          <div className="prose prose-slate max-w-none text-slate-700 space-y-6 text-sm leading-relaxed">
            <p>
              Welcome to the <strong>{appName} Delivery Partner Network</strong>. This Delivery Partner Privacy Policy outlines how {companyName} collects, tracks, utilizes, and protects the personal and location data of registered delivery partners, riders, and transport agents (&ldquo;Riders&rdquo; or &ldquo;Partners&rdquo;).
            </p>

            {/* Section 1 - Location Disclosure (Crucial for Google Play Console) */}
            <div className="space-y-2 bg-blue-50/70 border border-blue-200 p-4 sm:p-5 rounded-2xl">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <MapPin className="h-5 w-5 text-blue-600 shrink-0" />
                1. Location Data Collection & Background Tracking (Prominent Disclosure)
              </h3>
              <p className="text-slate-700 font-medium text-xs sm:text-sm">
                <strong>{appName} Delivery Partner App</strong> collects real-time location data (including precise GPS coordinates):
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-slate-700 text-xs sm:text-sm">
                <li>
                  <strong>When On-Duty / In Active Shift:</strong> Location data is gathered both in the <strong>foreground (while app is open)</strong> and in the <strong>background (when the app is closed, minimized, or screen is locked)</strong> while your duty status is active or while an assigned delivery order is underway.
                </li>
                <li>
                  <strong>Purpose of Location Tracking:</strong>
                  <ul className="list-circle pl-5 mt-1 space-y-1 text-slate-600">
                    <li>To dispatch and allocate pickup orders based on proximity to merchant stores.</li>
                    <li>To calculate route distances and rider delivery payouts accurately.</li>
                    <li>To provide real-time order tracking updates to the purchasing customer and store merchant until delivery handover is confirmed.</li>
                    <li>To ensure delivery agent safety and verify genuine transit paths.</li>
                  </ul>
                </li>
                <li>
                  <strong>Off-Duty Privacy:</strong> When you switch your status to <strong>&lsquo;Offline&rsquo;</strong> or conclude your delivery shift, real-time background location collection is ceased.
                </li>
              </ul>
            </div>

            {/* Section 2 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                2. Information We Collect from Delivery Partners
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li><strong>Identity & KYC Documents:</strong> Legal full name, phone number, email address, profile photo, Aadhar Card, PAN Card, and Driving License.</li>
                <li><strong>Vehicle Information:</strong> Vehicle type (bike, scooter, cycle), registration number, and related vehicular documents.</li>
                <li><strong>Banking & Financial Records:</strong> Bank account number, IFSC code, and UPI identifier for disbursing weekly/daily delivery payouts and customer tips.</li>
                <li><strong>Emergency Contacts:</strong> Nominated emergency contact names and phone numbers saved for SOS and safety escalation.</li>
              </ul>
            </div>

            {/* Section 3 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <Camera className="h-5 w-5 text-amber-600 shrink-0" />
                3. Device Hardware & App Permissions
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li><strong>Camera Access:</strong> Used exclusively to photograph onboarding documents, OCR verification of IDs, and Proof of Delivery (POD) where required.</li>
                <li><strong>Storage / Media:</strong> Required to upload KYC documentation and cache operational map assets.</li>
                <li><strong>Push Notifications:</strong> Required to deliver instant alerts for newly incoming pickup tasks, route updates, and payout summaries.</li>
              </ul>
            </div>

            {/* Section 4 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-violet-600 shrink-0" />
                4. Cash on Delivery (COD) & Payout Data
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>All cash collected from customers during COD deliveries is tracked within your partner app wallet ledger.</li>
                <li>Settlement logs, incentives, tips, and deductions are maintained accurately to safeguard rider compensation.</li>
              </ul>
            </div>

            {/* Section 5 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <Lock className="h-5 w-5 text-indigo-600 shrink-0" />
                5. Confidentiality of Customer Information
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>Delivery partners receive customer delivery addresses and phone numbers solely for the purpose of executing the delivery.</li>
                <li>Partners are strictly prohibited from copying, calling after delivery completion, or misusing customer phone numbers and residential locations for any non-delivery purpose.</li>
              </ul>
            </div>

            {/* Section 6 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
                6. Account Deletion & Data Rights
              </h3>
              <p className="text-slate-600">
                Delivery partners may request account closure, deregistration, and deletion of personal profile data by contacting our partner desk at{' '}
                <a href={`mailto:${supportEmail}`} className="text-primary font-bold hover:underline">
                  {supportEmail}
                </a>. Certain KYC verification proofs and financial payout audit trails may be retained for the minimum statutory timeframe mandated by tax and labor regulations.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 text-center">
              Have questions regarding rider privacy? Contact the {appName} Partner Team at{' '}
              <span className="font-semibold text-slate-700">{supportEmail}</span>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeliveryPrivacyPage;
