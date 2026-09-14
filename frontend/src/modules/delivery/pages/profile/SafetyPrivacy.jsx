import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, UserPlus, Phone, Trash2, Shield, Lock, Eye, MapPin, User } from "lucide-react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Input from "@/shared/components/ui/Input";
import { toast } from "sonner";
import { useSettings } from "@core/context/SettingsContext";

const SafetyPrivacy = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const appName = settings?.appName || "App";

  const [contacts, setContacts] = useState(() => {
    const saved = localStorage.getItem('emergencyContacts');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return [];
  });

  React.useEffect(() => {
    localStorage.setItem('emergencyContacts', JSON.stringify(contacts));
  }, [contacts]);

  const [newContact, setNewContact] = useState({ name: "", phone: "" });
  const [showAddContact, setShowAddContact] = useState(false);
  const [shareLiveLocation, setShareLiveLocation] = useState(true);
  const [profileVisibility, setProfileVisibility] = useState(true);

  const handleAddContact = () => {
    if (newContact.name && newContact.phone) {
      setContacts([...contacts, { ...newContact, id: Date.now() }]);
      setNewContact({ name: "", phone: "" });
      setShowAddContact(false);
      toast.success("Emergency contact added!");
    }
  };

  const handleRemoveContact = (id) => {
    setContacts(contacts.filter((c) => c.id !== id));
    toast.success("Contact removed");
  };

  function getInitials(name = "") {
    return name
      .split(" ")
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase();
  }

  const avatarColors = ["bg-rose-100 text-rose-600", "bg-blue-100 text-blue-600", "bg-emerald-100 text-emerald-600", "bg-violet-100 text-violet-600", "bg-amber-100 text-amber-600"];

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="flex items-center p-4">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors mr-2"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="ds-h3 text-gray-900">Safety & Privacy</h1>
        </div>
      </div>

      {/* Hero Banner */}
      <div className="mx-4 mt-4 rounded-2xl overflow-hidden bg-gradient-to-br from-primary to-brand-700 p-5 flex items-center gap-4 shadow-lg shadow-primary/20">
        <div className="h-14 w-14 rounded-2xl bg-white/20 backdrop-blur-sm flex items-center justify-center flex-shrink-0">
          <Shield size={28} className="text-white" />
        </div>
        <div>
          <p className="text-white font-bold text-base leading-tight">Your safety comes first</p>
          <p className="text-white/75 text-xs mt-0.5 leading-snug">
            Manage emergency contacts and control your privacy settings.
          </p>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto space-y-6 mt-2">
        {/* Emergency Contacts */}
        <section>
          <div className="flex items-center mb-1">
            <div className="h-7 w-7 rounded-lg bg-red-100 flex items-center justify-center mr-2">
              <Shield size={15} className="text-red-500" />
            </div>
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Emergency Contacts</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-9">
            Notified instantly when you trigger the SOS alert during a delivery.
          </p>

          <div className="space-y-3">
            {contacts.map((contact, idx) => (
              <div
                key={contact.id}
                className="bg-white rounded-2xl p-4 flex items-center gap-3 shadow-sm border border-gray-100"
              >
                {/* Avatar */}
                <div className={`h-11 w-11 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${avatarColors[idx % avatarColors.length]}`}>
                  {getInitials(contact.name)}
                </div>
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 text-sm truncate">{contact.name}</p>
                  <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                    <Phone size={11} className="text-gray-300" />
                    {contact.phone}
                  </p>
                </div>
                {/* Delete */}
                <button
                  onClick={() => handleRemoveContact(contact.id)}
                  className="h-9 w-9 rounded-xl bg-red-50 flex items-center justify-center text-red-400 hover:bg-red-100 hover:text-red-600 transition-colors flex-shrink-0"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}

            {showAddContact ? (
              <div className="bg-white rounded-2xl p-4 border-2 border-dashed border-primary/30 shadow-sm">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3">New Contact</p>
                <Input
                  placeholder="Name (e.g. Wife, Brother)"
                  value={newContact.name}
                  onChange={(e) => {
                    const val = e.target.value.replace(/[^a-zA-Z\s]/g, "");
                    setNewContact({...newContact, name: val});
                  }}
                  className="mb-3 bg-gray-50"
                />
                <Input
                  placeholder="Phone Number (10 digits)"
                  value={newContact.phone}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setNewContact({...newContact, phone: val});
                  }}
                  className="mb-3 bg-gray-50"
                />
                <div className="flex gap-2">
                  <button
                    onClick={handleAddContact}
                    className="flex-1 py-2.5 rounded-xl bg-primary text-white text-sm font-bold transition-opacity hover:opacity-90"
                  >
                    Save Contact
                  </button>
                  <button
                    onClick={() => setShowAddContact(false)}
                    className="flex-1 py-2.5 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowAddContact(true)}
                className="w-full py-3.5 rounded-2xl border-2 border-dashed border-gray-200 flex items-center justify-center gap-2 text-gray-400 hover:border-primary hover:text-primary transition-colors bg-white"
              >
                <UserPlus size={17} />
                <span className="text-sm font-semibold">Add New Contact</span>
              </button>
            )}
          </div>
        </section>

        {/* Privacy Settings */}
        <section>
          <div className="flex items-center mb-1">
            <div className="h-7 w-7 rounded-lg bg-blue-100 flex items-center justify-center mr-2">
              <Lock size={15} className="text-blue-500" />
            </div>
            <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wider">Privacy Settings</h2>
          </div>
          <p className="text-xs text-gray-400 mb-4 ml-9">Control what information is shared with customers.</p>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
            {/* Share Live Location */}
            <div className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <MapPin size={18} className="text-emerald-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-sm">Share Live Location</p>
                <p className="text-xs text-gray-400 mt-0.5">Allow customers to track you during delivery</p>
              </div>
              {/* Toggle — Share Live Location */}
              <div
                onClick={() => setShareLiveLocation((v) => !v)}
                className={`relative inline-block w-12 h-6 rounded-full cursor-pointer flex-shrink-0 transition-colors duration-200 ${shareLiveLocation ? 'bg-primary' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-200 ease-in-out transform ${shareLiveLocation ? 'translate-x-6' : 'translate-x-1'}`} />
              </div>
            </div>

            {/* Profile Visibility */}
            <div className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-violet-50 flex items-center justify-center flex-shrink-0">
                <User size={18} className="text-violet-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-800 text-sm">Profile Visibility</p>
                <p className="text-xs text-gray-400 mt-0.5">Show your photo to customers</p>
              </div>
              {/* Toggle — Profile Visibility */}
              <div
                onClick={() => setProfileVisibility((v) => !v)}
                className={`relative inline-block w-12 h-6 rounded-full cursor-pointer flex-shrink-0 transition-colors duration-200 ${profileVisibility ? 'bg-primary' : 'bg-gray-300'}`}
              >
                <span className={`absolute top-1 bg-white w-4 h-4 rounded-full shadow-sm transition-transform duration-200 ease-in-out transform ${profileVisibility ? 'translate-x-6' : 'translate-x-1'}`} />
              </div>
            </div>
          </div>
        </section>

        {/* Info Banner */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 p-4 rounded-2xl flex items-start gap-3">
          <div className="h-8 w-8 rounded-xl bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
            <Eye size={15} className="text-blue-600" />
          </div>
          <p className="text-xs text-blue-800 leading-relaxed">
            <span className="font-bold">{appName}</span> values your privacy. Your location is only shared while you are on an active delivery.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SafetyPrivacy;


