import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, Smartphone } from "lucide-react";
import Card from "@/shared/components/ui/Card";
import { toast } from "sonner";
import axiosInstance from "@core/api/axios";

const SETTINGS_KEY = "delivery_app_settings";

const DEFAULT_SETTINGS = {
  pushNotifications: true,
  sound: true,
  vibration: true,
};

function loadSettingsFromStorage() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettingsToStorage(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

const Settings = () => {
  const navigate = useNavigate();

  // Initialize from localStorage immediately (no flicker on re-open)
  const [settings, setSettings] = useState(loadSettingsFromStorage);

  // Sync from server on mount to stay in sync with backend
  useEffect(() => {
    axiosInstance
      .get("/push/preferences")
      .then((res) => {
        const pref = res?.data?.data || res?.data;
        if (!pref) return;
        setSettings((prev) => {
          const merged = {
            ...prev,
            ...(typeof pref.pushNotifications === "boolean" && { pushNotifications: pref.pushNotifications }),
            ...(typeof pref.sound === "boolean" && { sound: pref.sound }),
            ...(typeof pref.vibration === "boolean" && { vibration: pref.vibration }),
          };
          saveSettingsToStorage(merged);
          return merged;
        });
      })
      .catch(() => {
        /* silently ignore — localStorage values are still used */
      });
  }, []);

  const toggleSetting = (key) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      // Persist to localStorage immediately so it survives navigation
      saveSettingsToStorage(updated);

      // Sync push/sound/vibration to backend
      if (key === "pushNotifications" || key === "sound" || key === "vibration") {
        axiosInstance
          .patch("/push/preferences", {
            pushNotifications: updated.pushNotifications,
            sound: updated.sound,
            vibration: updated.vibration,
          })
          .catch(() => {
            /* ignore network errors — localStorage already updated */
          });
      }

      return updated;
    });
    toast.success("Settings updated");
  };

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
          <h1 className="ds-h3 text-gray-900">App Settings</h1>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto space-y-6">
        {/* Notifications */}
        <section>
          <h2 className="text-sm uppercase font-bold text-gray-500 mb-3 tracking-wider ml-1">Notifications</h2>
          <Card className="divide-y divide-gray-100">
            <div className="p-4 flex justify-between items-center cursor-pointer" onClick={() => toggleSetting('pushNotifications')}>
              <div className="flex items-center">
                <Bell size={20} className="text-gray-400 mr-3" />
                <div>
                  <h4 className="font-medium text-gray-800">Push Notifications</h4>
                </div>
              </div>
              <div className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${settings.pushNotifications ? 'bg-primary' : 'bg-gray-300'}`}>
                <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${settings.pushNotifications ? 'translate-x-6' : 'translate-x-0'}`} />
              </div>
            </div>
            
            <div className="p-4 flex justify-between items-center cursor-pointer" onClick={() => toggleSetting('sound')}>
              <div className="flex items-center">
                <Smartphone size={20} className="text-gray-400 mr-3" />
                <div>
                  <h4 className="font-medium text-gray-800">Sound & Vibration</h4>
                </div>
              </div>
              <div className={`w-12 h-6 rounded-full p-1 transition-colors duration-200 ease-in-out ${settings.sound ? 'bg-primary' : 'bg-gray-300'}`}>
                <div className={`bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${settings.sound ? 'translate-x-6' : 'translate-x-0'}`} />
              </div>
            </div>
          </Card>
        </section>


      </div>
    </div>
  );
};

export default Settings;
