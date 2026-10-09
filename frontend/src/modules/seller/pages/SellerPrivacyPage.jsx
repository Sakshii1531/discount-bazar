import React, { useEffect } from 'react';
import useSafeBack from "@/core/hooks/useSafeBack";
import { ChevronLeft, ShieldCheck, Store, CreditCard, Lock, FileText, AlertCircle, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useSettings } from '@core/context/SettingsContext';

const SellerPrivacyPage = () => {
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
  const handleClose = useSafeBack("/seller/auth");

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
          <h1 className="text-base font-black text-slate-900">Seller Partner Privacy Policy</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 bg-amber-50 text-amber-700 rounded-full border border-amber-200">
            Merchant Policy
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
            <div className="h-14 w-14 rounded-2xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-md">
              <Store size={28} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">
                {appName} Merchant & Seller Privacy Policy
              </h2>
              <p className="text-xs text-slate-500 font-medium mt-1">
                Seller Partner Data Protection & Governance • Updated Oct 2025
              </p>
            </div>
          </div>

          <div className="prose prose-slate max-w-none text-slate-700 space-y-6 text-sm leading-relaxed">
            <p>
              Welcome to the <strong>{appName} Seller Platform</strong>. This Privacy Policy governs the collection, usage, processing, and protection of information provided by merchant partners, vendors, and store owners (&ldquo;Sellers&rdquo; or &ldquo;Merchants&rdquo;) on {companyName}.
            </p>

            {/* Section 1 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <Store className="h-5 w-5 text-amber-600 shrink-0" />
                1. Information We Collect from Sellers
              </h3>
              <p className="text-slate-600">To enable onboarding, store verification, and order processing, we collect:</p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li><strong>Business & Store Profile:</strong> Business name, store address, store category, logo, operating hours, and contact details.</li>
                <li><strong>KYC & Tax Verification:</strong> GSTIN certificate, PAN card, business registration certificates, and owner identity proofs.</li>
                <li><strong>Settlement & Bank Details:</strong> Bank account numbers, IFSC codes, and payout verification documents required for fund transfers.</li>
                <li><strong>Product & Catalog Data:</strong> Product titles, descriptions, pricing, inventory numbers, barcode/SKU data, and images.</li>
              </ul>
            </div>

            {/* Section 2 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600 shrink-0" />
                2. Protection of Customer Data by Merchants
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>Sellers receive access to customer order items, delivery addresses, and contact numbers <strong>strictly for packaging and fulfilling orders</strong>.</li>
                <li>Sellers are prohibited from storing, exporting, selling, or using customer personal data for unsolicited marketing, external messaging, or any purpose outside of direct order dispatch.</li>
                <li>Breach of customer privacy or unauthorized disclosure of customer data will result in immediate termination of the seller account and legal liability.</li>
              </ul>
            </div>

            {/* Section 3 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-blue-600 shrink-0" />
                3. Financial Records & Settlement Processing
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>All sales transactions, commissions, tax deductions (TCS/TDS where applicable), and withdrawal requests are recorded in encrypted platform ledgers.</li>
                <li>Payment gateway partners process monetary transactions in compliance with PCI-DSS security standards.</li>
                <li>Ledger and invoice records are maintained in accordance with applicable tax and auditing statutes.</li>
              </ul>
            </div>

            {/* Section 4 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <Lock className="h-5 w-5 text-indigo-600 shrink-0" />
                4. Data Security & Storage
              </h3>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li>We implement 256-bit SSL encryption, tokenized authentication, and firewall barriers to protect merchant data.</li>
                <li>Login credentials, passwords, and API keys are stored using irreversible cryptographic hashes.</li>
                <li>Access to merchant administrative controls is restricted to authorized personnel.</li>
              </ul>
            </div>

            {/* Section 5 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <FileText className="h-5 w-5 text-purple-600 shrink-0" />
                5. Third-Party Disclosures
              </h3>
              <p className="text-slate-600">
                We do not sell merchant data to third parties. Merchant data is only shared with:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-slate-600">
                <li><strong>Assigned Delivery Partners:</strong> Store location and pickup details necessary to collect dispatched orders.</li>
                <li><strong>Payment Processors & Banking Partners:</strong> To route automated bank settlements.</li>
                <li><strong>Regulatory Authorities:</strong> When compelled by law, court order, or official tax/audit requirement.</li>
              </ul>
            </div>

            {/* Section 6 */}
            <div className="space-y-2">
              <h3 className="text-slate-900 font-black text-base flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-rose-600 shrink-0" />
                6. Merchant Account Deletion & Rights
              </h3>
              <p className="text-slate-600">
                Sellers may update store details, pause listings, or request full merchant account deactivation by contacting merchant support at{' '}
                <a href={`mailto:${supportEmail}`} className="text-primary font-bold hover:underline">
                  {supportEmail}
                </a>. Upon deactivation, active catalogs are removed from public consumer browsing, while statutory financial transaction records are retained for auditing as required by law.
              </p>
            </div>

            <div className="pt-4 border-t border-slate-100 text-xs text-slate-500 text-center">
              For privacy inquiries or compliance concerns, reach out to {appName} Merchant Support at{' '}
              <span className="font-semibold text-slate-700">{supportEmail}</span>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SellerPrivacyPage;
