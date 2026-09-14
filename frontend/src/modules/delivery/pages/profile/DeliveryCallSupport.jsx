import React from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Phone,
  PhoneCall,
  Clock,
  ShieldAlert,
  HelpCircle,
  MessageCircle,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import { useSettings } from "@core/context/SettingsContext";
import { useAuth } from "@core/context/AuthContext";

const DeliveryCallSupport = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();

  const supportPhone = settings?.supportPhone || settings?.phone || "+91 98765 43210";
  const emergencyPhone = settings?.emergencyPhone || "112";

  const handleCall = (num) => {
    window.location.href = `tel:${String(num).replace(/\s+/g, "")}`;
  };

  const partnerIdStr = String(user?._id || user?.id || "N/A").slice(-6).toUpperCase();

  return (
    <div className="min-h-screen bg-gray-50 pb-24 text-gray-900 font-sans">
      {/* Header */}
      <div className="bg-white shadow-xs sticky top-0 z-10 border-b border-gray-100">
        <div className="flex items-center p-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-full hover:bg-gray-100 transition-colors mr-2 cursor-pointer text-gray-700"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="ds-h3 text-gray-900 leading-tight">Call Support</h1>
            <p className="text-[11px] text-gray-500 font-medium">
              Direct telephone assistance for delivery partners
            </p>
          </div>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto space-y-5">
        {/* Active Helpline Card */}
        <Card className="p-5 border border-teal-100 bg-gradient-to-br from-white via-teal-50/20 to-white shadow-xs rounded-2xl relative overflow-hidden">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-bold text-emerald-600 uppercase tracking-wider">
                Helpline Active • 24/7
              </span>
            </div>
            <div className="w-10 h-10 rounded-full bg-teal-100/70 text-teal-700 flex items-center justify-center shadow-2xs">
              <PhoneCall size={20} />
            </div>
          </div>

          <h3 className="font-extrabold text-base text-gray-900 mb-1">
            Rider Operations Helpline
          </h3>
          <p className="text-xs text-gray-500 mb-4 leading-relaxed">
            For issues with order pickups, store delays, customer unreachable, cash remittance, or payouts.
          </p>

          <div className="bg-white rounded-xl border border-teal-100 p-3.5 mb-4 flex items-center justify-between shadow-2xs">
            <div>
              <p className="text-[10px] uppercase font-bold text-gray-400">Toll-Free / Support Number</p>
              <p className="font-black text-gray-900 text-base">{supportPhone}</p>
            </div>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100">
              Free
            </span>
          </div>

          <Button
            onClick={() => handleCall(supportPhone)}
            className="w-full bg-primary hover:bg-primary/90 text-white font-bold py-3.5 rounded-xl shadow-md transition-all active:scale-[0.98] flex items-center justify-center gap-2 text-sm"
          >
            <Phone size={18} />
            Call Support Helpline
          </Button>
        </Card>

        {/* Emergency SOS Assistance Card */}
        <Card className="p-5 border border-rose-100 bg-gradient-to-br from-white via-rose-50/20 to-white shadow-xs rounded-2xl">
          <div className="flex items-center gap-2 mb-2 text-rose-600">
            <ShieldAlert size={20} />
            <h3 className="font-extrabold text-sm uppercase tracking-wide">
              Road Emergency & Safety (SOS)
            </h3>
          </div>
          <p className="text-xs text-gray-600 mb-4 leading-relaxed">
            In case of vehicle accident, physical injury, road hazard, or immediate security concern during delivery.
          </p>

          <div className="flex gap-2">
            <button
              onClick={() => handleCall(emergencyPhone)}
              className="flex-1 bg-rose-600 hover:bg-rose-700 active:scale-98 text-white font-bold py-3 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-2 shadow-xs cursor-pointer"
            >
              <AlertTriangle size={16} />
              Call Emergency ({emergencyPhone})
            </button>
            <button
              onClick={() => handleCall(supportPhone)}
              className="flex-1 bg-white hover:bg-rose-50 active:scale-98 text-rose-700 border border-rose-200 font-bold py-3 px-4 rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Phone size={15} />
              Safety Desk
            </button>
          </div>
        </Card>

        {/* Partner Info for Quick Support */}
        <Card className="p-4 bg-white border border-gray-100 rounded-2xl shadow-xs space-y-2.5">
          <h4 className="font-bold text-xs text-gray-700 uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle2 size={15} className="text-teal-600" />
            Tips Before Calling
          </h4>
          <ul className="text-xs text-gray-500 space-y-1.5 leading-relaxed pl-1">
            <li>
              • Your Delivery Partner ID is <strong className="text-gray-800">DC{partnerIdStr}</strong>. Keep it handy.
            </li>
            <li>• If calling about an active order, have the 6-digit Order ID ready.</li>
            <li>• Please park your vehicle safely off the road before initiating a call.</li>
          </ul>
        </Card>

        {/* Switch to Chat Option */}
        <div className="text-center pt-2">
          <p className="text-xs text-gray-500 mb-2">Prefer texting instead of calling?</p>
          <button
            onClick={() => navigate("/delivery/profile/chat")}
            className="text-xs font-bold text-primary hover:underline inline-flex items-center gap-1.5"
          >
            <MessageCircle size={15} />
            Open Rider Support Chat
          </button>
        </div>
      </div>
    </div>
  );
};

export default DeliveryCallSupport;
