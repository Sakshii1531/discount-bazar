import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, User, Mail, Phone, MapPin, Calendar, Droplet, Camera, Loader2 } from "lucide-react";
import Button from "@/shared/components/ui/Button";
import Input from "@/shared/components/ui/Input";
import { toast } from "sonner";
import { useAuth } from "@core/context/AuthContext";
import { cn } from "@/lib/utils";
import { deliveryApi } from "../../services/deliveryApi";
import axiosInstance from "@core/api/axios";

const PersonalDetails = () => {
  const navigate = useNavigate();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { user, refreshUser } = useAuth();
  const fileInputRef = useRef(null);

  const [formData, setFormData] = useState({
    fullName: user?.name || "",
    phone: user?.phone || "",
    email: user?.email || "",
    address: user?.address || "",
    dob: user?.dob || "",
    bloodGroup: user?.bloodGroup || "",
    profileImage: user?.profileImage || "",
  });

  useEffect(() => {
    if (user) {
      setFormData({
        fullName: user.name || "",
        phone: user.phone || "",
        email: user.email || "",
        address: user.address || "",
        dob: user.dob || "",
        bloodGroup: user.bloodGroup || "",
        profileImage: user.profileImage || "",
      });
    }
  }, [user]);

  const handlePhotoClick = () => {
    if (!isEditing || isUploading) return;
    fileInputRef.current?.click();
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please select a valid image file");
      return;
    }

    try {
      setIsUploading(true);
      const uploadForm = new FormData();
      uploadForm.append("file", file);
      uploadForm.append("entityType", "profile");

      const res = await axiosInstance.post("/media/upload", uploadForm, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (res.data?.success && res.data?.result?.url) {
        const uploadedUrl = res.data.result.url;
        setFormData((prev) => ({ ...prev, profileImage: uploadedUrl }));
        toast.success("Profile photo uploaded!");
      } else {
        toast.error("Failed to upload photo");
      }
    } catch (err) {
      console.error("Photo upload error:", err);
      toast.error(err.response?.data?.message || "Error uploading profile photo");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.fullName.trim() || formData.fullName.trim().length < 3) {
      toast.error("Please enter your full name (minimum 3 characters)");
      return;
    }
    if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      toast.error("Please enter a valid email address");
      return;
    }
    if (formData.address.trim() && formData.address.trim().length < 10) {
      toast.error("Please enter your full address (minimum 10 characters)");
      return;
    }
    if (formData.dob) {
      const today = new Date().toISOString().split("T")[0];
      if (formData.dob > today) {
        toast.error("Date of birth cannot be in the future");
        return;
      }
    }
    try {
      setIsSaving(true);
      const payload = {
        name: formData.fullName,
        email: formData.email,
        address: formData.address,
        dob: formData.dob,
        bloodGroup: formData.bloodGroup,
        profileImage: formData.profileImage,
      };

      const res = await deliveryApi.updateProfile(payload);
      if (res.data?.success) {
        toast.success("Personal details updated successfully!");
        if (typeof refreshUser === "function") {
          await refreshUser();
        }
        setIsEditing(false);
      } else {
        toast.error(res.data?.message || "Failed to update profile");
      }
    } catch (err) {
      console.error("Update profile error:", err);
      toast.error(err.response?.data?.message || "Failed to save profile");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Hidden File Input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handlePhotoChange}
      />

      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="flex items-center p-4">
          <button 
            onClick={() => navigate(-1)} 
            className="p-2 rounded-full hover:bg-gray-100 transition-colors mr-2"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="ds-h3 text-gray-900">Personal Details</h1>
          <div className="ml-auto">
            {isEditing ? (
              <Button 
                size="sm" 
                onClick={handleSave} 
                disabled={isSaving || isUploading}
                className="h-8 px-3"
              >
                {isSaving ? (
                  <span className="flex items-center gap-1">
                    <Loader2 size={14} className="animate-spin" /> Saving...
                  </span>
                ) : (
                  "Save"
                )}
              </Button>
            ) : (
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setIsEditing(true)} 
                className="text-primary hover:bg-primary/5"
              >
                Edit
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto space-y-6">
        {/* Profile Photo */}
        <div className="flex flex-col items-center justify-center py-6">
          <div className="relative">
            <div 
              onClick={handlePhotoClick}
              className={`w-24 h-24 rounded-full p-1 bg-white shadow-md relative group ${
                isEditing ? "cursor-pointer ring-2 ring-primary ring-offset-2" : ""
              }`}
            >
              <img
                src={formData.profileImage || "https://api.dicebear.com/7.x/avataaars/svg?seed=Felix"}
                alt="Profile"
                className="w-full h-full rounded-full object-cover bg-gray-100"
              />
              {isUploading && (
                <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center text-white">
                  <Loader2 size={24} className="animate-spin" />
                </div>
              )}
            </div>
            {isEditing ? (
              <button 
                type="button"
                onClick={handlePhotoClick}
                disabled={isUploading}
                className="absolute bottom-0 right-0 bg-primary text-primary-foreground p-2 rounded-full shadow-lg hover:bg-primary/90 transition-colors"
                title="Change profile picture"
              >
                {isUploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
            ) : (
              <div
                className={cn(
                  "absolute bottom-0 right-0 w-6 h-6 border-2 border-white rounded-full transition-all duration-300 flex items-center justify-center shadow-md",
                  user?.isOnline !== false
                    ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]"
                    : "bg-rose-500"
                )}>
                <span className={cn(
                  "w-2 h-2 rounded-full bg-white",
                  user?.isOnline !== false ? "animate-pulse" : ""
                )} />
              </div>
            )}
          </div>
          <p className="mt-3 text-sm text-gray-500">Delivery Partner ID: {String(user?._id || user?.id || "").slice(-6).toUpperCase()}</p>
        </div>

        {/* Form Fields */}
        <div className="space-y-4 bg-white p-4 rounded-xl shadow-sm">
          <Input
            label="Full Name"
            value={formData.fullName}
            readOnly={!isEditing}
            onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
            icon={User}
            className={!isEditing ? "bg-gray-50 border-transparent" : ""}
          />
          
          <Input
            label="Phone Number"
            value={formData.phone}
            readOnly={true}
            icon={Phone}
            className="bg-gray-50 border-transparent text-gray-500"
            helperText="Contact support to change phone number"
          />

          <Input
            label="Email Address"
            value={formData.email}
            readOnly={!isEditing}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            icon={Mail}
            type="email"
            className={!isEditing ? "bg-gray-50 border-transparent" : ""}
          />

          <div className="relative">
            <label className="block text-xs font-medium text-gray-700 mb-1 ml-1">Current Address</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                <MapPin size={18} />
              </div>
              <textarea
                value={formData.address}
                readOnly={!isEditing}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className={`w-full pl-10 pr-4 py-2 rounded-xl text-sm border focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all resize-none ${
                  !isEditing ? "bg-gray-50 border-transparent text-gray-600" : "bg-white border-gray-200"
                }`}
                rows={3}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Date of Birth"
              type="date"
              value={formData.dob}
              readOnly={!isEditing}
              onChange={(e) => setFormData({ ...formData, dob: e.target.value })}
              icon={Calendar}
              className={!isEditing ? "bg-gray-50 border-transparent text-gray-600" : ""}
            />
            <Input
              label="Blood Group"
              value={formData.bloodGroup}
              readOnly={!isEditing}
              onChange={(e) => setFormData({ ...formData, bloodGroup: e.target.value })}
              icon={Droplet}
              className={!isEditing ? "bg-gray-50 border-transparent" : ""}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default PersonalDetails;
