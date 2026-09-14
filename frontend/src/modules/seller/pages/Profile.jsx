import React, { useState, useEffect } from "react";
import {
  User,
  Mail,
  Phone,
  Store,
  Shield,
  Edit2,
  Save,
  X,
  Rocket,
  Globe,
  MapPin,
  CheckCircle,
  BadgeCheck,
  Building2,
  Bell,
  Volume2,
  Smartphone,
  Send,
  Loader2,
} from "lucide-react";
import { sellerApi } from "../services/sellerApi";
import { toast } from "sonner";
import MapPicker from "../../../shared/components/MapPicker";
import axiosInstance from "@core/api/axios";

const SETTINGS_KEY = "seller_app_settings";
const DEFAULT_NOTIF_SETTINGS = {
  pushNotifications: true,
  sound: true,
  vibration: true,
};

function loadSellerSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_NOTIF_SETTINGS };
    return { ...DEFAULT_NOTIF_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_NOTIF_SETTINGS };
  }
}

const SellerProfile = () => {
  const [profile, setProfile] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isMapOpen, setIsMapOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    shopName: "",
    phone: "",
    email: "",
    lat: null,
    lng: null,
    radius: 5,
    address: "",
    pincode: "",
  });

  const [notifSettings, setNotifSettings] = useState(loadSellerSettings);
  const [isTestingPush, setIsTestingPush] = useState(false);

  useEffect(() => {
    fetchProfile();
    // Sync notification preferences from server
    axiosInstance
      .get("/push/preferences")
      .then((res) => {
        const pref = res?.data?.data || res?.data;
        if (!pref) return;
        setNotifSettings((prev) => {
          const merged = {
            ...prev,
            ...(typeof pref.pushNotifications === "boolean" && { pushNotifications: pref.pushNotifications }),
            ...(typeof pref.sound === "boolean" && { sound: pref.sound }),
            ...(typeof pref.vibration === "boolean" && { vibration: pref.vibration }),
          };
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged)); } catch (_) {}
          return merged;
        });
      })
      .catch(() => {});
  }, []);

  const handleToggleNotif = async (key) => {
    const nextVal = !notifSettings[key];
    const updated = { ...notifSettings, [key]: nextVal };
    setNotifSettings(updated);
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated)); } catch (_) {}

    if (key === "pushNotifications" && nextVal) {
      try {
        const { ensureFcmTokenRegistered } = await import("@core/firebase/pushClient");
        await ensureFcmTokenRegistered({ role: "seller", platform: "web" });
      } catch (err) {
        toast.error("Please grant notification permission in your browser.");
      }
    }

    axiosInstance
      .patch("/push/preferences", { [key]: nextVal })
      .catch(() => {});
    toast.success("Notification settings updated");
  };

  const handleSendTestPush = async () => {
    setIsTestingPush(true);
    try {
      const { ensureFcmTokenRegistered } = await import("@core/firebase/pushClient");
      await ensureFcmTokenRegistered({ role: "seller", platform: "web" });
      await axiosInstance.post("/push/test", {
        type: "NEW_ORDER",
        title: "Test Order Notification 🔔",
        body: "Your seller push notifications & order ringtone are working!",
        data: {
          role: "seller",
          eventType: "NEW_ORDER",
          sound: "order_alert",
          link: "/seller/orders",
        },
      });
      toast.success("Test notification sent to your device!");
    } catch (err) {
      toast.error(err?.response?.data?.message || err?.message || "Failed to send test push");
    } finally {
      setIsTestingPush(false);
    }
  };

  const fetchProfile = async () => {
    try {
      const response = await sellerApi.getProfile();
      const data = response.data.result;
      setProfile(data);
      const extractedPincode = data.pincode || data.address?.match(/\b\d{6}\b/)?.[0] || "";
      setFormData({
        name: data.name || "",
        shopName: data.shopName || "",
        phone: data.phone || "",
        email: data.email || "",
        lat: data.location?.coordinates[1] || null,
        lng: data.location?.coordinates[0] || null,
        radius: data.serviceRadius || 5,
        address: data.address || "",
        pincode: extractedPincode,
      });
    } catch (error) {
      toast.error("Failed to fetch profile");
    } finally {
      setIsLoading(false);
    }
  };

  const handleLocationSelect = (location) => {
    const pincodeFromAddr = location.address?.match(/\b\d{6}\b/)?.[0] || "";
    setFormData((prev) => ({
      ...prev,
      lat: location.lat,
      lng: location.lng,
      radius: location.radius,
      address: location.address,
      pincode: pincodeFromAddr || prev.pincode,
    }));
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    if (name === "name") {
      const cleaned = value.replace(/[0-9]/g, "");
      setFormData({ ...formData, [name]: cleaned });
    } else if (name === "phone") {
      const digitsOnly = value.replace(/[^0-9]/g, "").slice(0, 10);
      setFormData({ ...formData, [name]: digitsOnly });
    } else if (name === "email") {
      setFormData({ ...formData, [name]: value.trimStart() });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!/^[0-9]{10}$/.test(formData.phone)) {
      toast.error("Please enter a valid 10-digit phone number.");
      return;
    }
    if (!formData.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setIsSaving(true);
    try {
      const payload = {
        ...formData,
        lat: formData.lat,
        lng: formData.lng,
        radius: formData.radius,
        pincode: formData.pincode || formData.address?.match(/\b\d{6}\b/)?.[0] || "",
      };
      await sellerApi.updateProfile(payload);
      toast.success("Profile updated successfully");
      setIsEditing(false);
      fetchProfile();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update profile");
    } finally {
      setIsSaving(false);
    }
  };

  const toggleStatus = async () => {
    try {
      const newStatus = !profile.isActive;
      await sellerApi.updateProfile({ isActive: newStatus });
      setProfile((prev) => ({ ...prev, isActive: newStatus }));
      toast.success(`Shop is now ${newStatus ? "Active" : "Inactive"}`);
    } catch (error) {
      toast.error("Failed to update shop status");
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 mb-3"></div>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Loading Profile...</p>
      </div>
    );
  }

  return (
    <div className="w-full p-1 sm:p-6 space-y-4 sm:space-y-6 font-['Outfit'] pb-20 sm:pb-8">
      {/* Header Profile Summary Card */}
      <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row items-center sm:items-start justify-between gap-4">
          <div className="flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left min-w-0 w-full sm:w-auto">
            {/* Avatar Circle */}
            <div className="relative shrink-0">
              <div className="h-16 w-16 sm:h-20 sm:w-20 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-2xl sm:text-3xl shadow-md">
                {profile?.name?.charAt(0)?.toUpperCase()}
              </div>
              {profile?.isVerified && (
                <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-white p-1 rounded-full ring-2 ring-white" title="Verified Merchant">
                  <CheckCircle className="h-3.5 w-3.5" />
                </div>
              )}
            </div>

            {/* Seller Name & Store */}
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <span className="px-2.5 py-0.5 bg-slate-100 text-slate-700 text-[10px] font-extrabold uppercase tracking-wider rounded-md border border-slate-200">
                  {profile?.role || 'SELLER'}
                </span>
                <button
                  onClick={toggleStatus}
                  type="button"
                  className={`flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider rounded-full border transition-all active:scale-95 cursor-pointer ${
                    profile?.isActive
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100"
                      : "bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100"
                  }`}>
                  <span className={`w-2 h-2 rounded-full ${profile?.isActive ? "bg-emerald-500 animate-pulse" : "bg-rose-500"}`} />
                  {profile?.isActive ? "Active" : "Inactive"}
                </button>
              </div>

              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight truncate">
                {profile?.name}
              </h1>
              <p className="text-xs font-bold text-slate-500 flex items-center justify-center sm:justify-start gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-brand-600 shrink-0" />
                <span className="truncate">{profile?.shopName}</span>
              </p>
            </div>
          </div>

          {/* Action Edit / Save Buttons */}
          <div className="w-full sm:w-auto shrink-0 flex justify-center">
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="w-full sm:w-auto bg-slate-900 hover:bg-black text-white text-xs font-bold px-5 py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-sm active:scale-95 transition-all">
                <Edit2 className="h-3.5 w-3.5" />
                <span>Edit Profile</span>
              </button>
            ) : (
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={() => setIsEditing(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold px-4 py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all">
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
                <button
                  onClick={handleSubmit}
                  disabled={isSaving}
                  className="bg-slate-900 hover:bg-black text-white text-xs font-black px-5 py-2.5 rounded-xl flex items-center justify-center gap-1.5 shadow-sm active:scale-95 transition-all">
                  {isSaving ? "Saving..." : <><Save className="h-3.5 w-3.5" /> Save Changes</>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6">
        {/* Main Details Section */}
        <div className="md:col-span-2 space-y-4 sm:space-y-6">
          {/* Business Information Card */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="h-9 w-9 bg-slate-100 text-slate-800 rounded-xl flex items-center justify-center shrink-0">
                <Store className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-black text-slate-900">Business Details</h3>
                <p className="text-[11px] text-slate-500 font-medium">Personal and store credentials</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-slate-400" /> Seller Name
                </label>
                <input
                  type="text"
                  name="name"
                  maxLength={50}
                  value={formData.name}
                  onChange={(e) => {
                    e.target.value = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                    handleChange(e);
                  }}
                  disabled={!isEditing}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all disabled:opacity-75"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <Store className="h-3.5 w-3.5 text-slate-400" /> Store Name
                </label>
                <input
                  type="text"
                  name="shopName"
                  value={formData.shopName}
                  onChange={handleChange}
                  disabled={!isEditing}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all disabled:opacity-75"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <Phone className="h-3.5 w-3.5 text-slate-400" /> Phone Number
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  disabled={!isEditing}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all disabled:opacity-75"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <Mail className="h-3.5 w-3.5 text-slate-400" /> Email Address
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleChange}
                  disabled={!isEditing}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm font-semibold text-slate-800 outline-none focus:bg-white focus:border-slate-900 focus:ring-1 focus:ring-slate-900/10 transition-all disabled:opacity-75"
                />
              </div>
            </form>
          </div>

          {/* Location & Coverage Card */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 bg-brand-50 text-brand-600 rounded-xl flex items-center justify-center shrink-0">
                  <MapPin className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm sm:text-base font-black text-slate-900">Location & Delivery Area</h3>
                  <p className="text-[11px] text-slate-500 font-medium">Store coordinates & service radius</p>
                </div>
              </div>
              {isEditing && (
                <button
                  type="button"
                  onClick={() => setIsMapOpen(true)}
                  className="bg-slate-900 hover:bg-black text-white rounded-lg px-3 py-1.5 text-[10px] font-bold tracking-wider transition-all shrink-0">
                  CHANGE PIN
                </button>
              )}
            </div>

            <div className="space-y-3">
              <div className="bg-slate-50 p-3.5 sm:p-4 rounded-xl border border-slate-100 space-y-3">
                <div className="flex items-start gap-2.5">
                  <MapPin className="h-4 w-4 text-brand-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5 min-w-0">
                    <p className="text-[11px] font-bold text-slate-900 uppercase tracking-wider">Store Address</p>
                    <p className="text-xs text-slate-600 font-medium leading-relaxed break-words">
                      {formData.address || "No address set. Use Change Pin to select location."}
                    </p>
                  </div>
                </div>

                {formData.lat && (
                  <div className="pt-3 border-t border-slate-200/60 grid grid-cols-3 gap-2 text-center sm:text-left">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase block">Service Radius</span>
                      <span className="text-xs font-black text-slate-900">{formData.radius} KM</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase block">Latitude</span>
                      <span className="text-xs font-mono font-bold text-slate-700">{formData.lat.toFixed(4)}</span>
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase block">Longitude</span>
                      <span className="text-xs font-mono font-bold text-slate-700">{formData.lng.toFixed(4)}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-start gap-2.5 p-3 bg-amber-50 rounded-xl border border-amber-100 text-amber-800">
                <Shield className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-[11px] font-medium leading-relaxed">
                  Store location determines delivery rider routing and nearby customer visibility.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Account Info Sidebar Card */}
        <div className="space-y-4">
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="h-9 w-9 bg-slate-900 text-white rounded-xl flex items-center justify-center shrink-0">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-black text-slate-900">Account Trust</h4>
                <p className="text-[11px] text-slate-500 font-medium">Verification status</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="h-8 w-8 rounded-lg bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
                  <BadgeCheck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Merchant Status</p>
                  <p className="text-xs font-bold text-slate-900">
                    {profile?.isVerified ? "Verified Merchant" : "Verification Pending"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="h-8 w-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                  <Rocket className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Partner Tier</p>
                  <p className="text-xs font-bold text-slate-900">Standard Growth</p>
                </div>
              </div>

              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                  <Globe className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Region</p>
                  <p className="text-xs font-bold text-slate-900">Pan India Delivery</p>
                </div>
              </div>
            </div>
          </div>

          {/* Notification & Sound Settings Card */}
          <div className="bg-white border border-slate-200/80 rounded-2xl p-4 sm:p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
              <div className="h-9 w-9 bg-brand-50 text-brand-600 rounded-xl flex items-center justify-center shrink-0">
                <Bell className="h-4 w-4" />
              </div>
              <div>
                <h4 className="text-sm font-black text-slate-900">Notification & Sound Settings</h4>
                <p className="text-[11px] text-slate-500 font-medium">Alerts for new orders, returns & payouts</p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Push Notifications Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center shrink-0">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">Push Notifications</p>
                    <p className="text-[10px] text-slate-500 font-medium">Alerts when phone is locked or app in background</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleNotif("pushNotifications")}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                    notifSettings.pushNotifications ? "bg-brand-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                      notifSettings.pushNotifications ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Order Ringtone Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                    <Volume2 className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">Order & Return Ringtone</p>
                    <p className="text-[10px] text-slate-500 font-medium">Play loud audio alert for new & return orders</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleNotif("sound")}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                    notifSettings.sound ? "bg-brand-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                      notifSettings.sound ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Vibration Toggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 border border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center shrink-0">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-900">Device Vibration</p>
                    <p className="text-[10px] text-slate-500 font-medium">Vibrate phone on incoming order alerts</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleNotif("vibration")}
                  className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${
                    notifSettings.vibration ? "bg-brand-600" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                      notifSettings.vibration ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>

              {/* Test Notification Button */}
              <div className="pt-1">
                <button
                  type="button"
                  onClick={handleSendTestPush}
                  disabled={isTestingPush}
                  className="w-full py-2.5 px-4 bg-slate-900 hover:bg-black text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow transition-all active:scale-95 disabled:opacity-75"
                >
                  {isTestingPush ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {isTestingPush ? "Sending Test..." : "Send Test Notification"}
                </button>
                <p className="text-[10px] text-center text-slate-400 mt-1.5 font-medium">
                  Sends a test notification to verify audio & push on this device
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {isMapOpen && (
        <MapPicker
          isOpen={isMapOpen}
          onClose={() => setIsMapOpen(false)}
          onConfirm={handleLocationSelect}
          initialLocation={
            formData.lat ? { lat: formData.lat, lng: formData.lng } : null
          }
          initialRadius={formData.radius}
        />
      )}
    </div>
  );
};

export default SellerProfile;
