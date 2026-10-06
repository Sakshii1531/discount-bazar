import React, { useState } from "react";
import { cn } from "@/lib/utils";
import { useToast } from "@shared/components/ui/Toast";
import { adminApi } from "../services/adminApi";
import { SIDE_IMAGE_OPTIONS, getSectionSideImage } from "@/shared/constants/offerSectionOptions";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Side/hero image for an offer section: upload a custom image or pick a preset.
 * A custom image (sideImageUrl) wins over the preset (sideImageKey).
 * onChange receives a patch: { sideImageUrl } or { sideImageKey, sideImageUrl: "" }.
 */
const SideImagePicker = ({ label, sideImageKey, sideImageUrl, onChange, onUploadingChange, inputId }) => {
  const { showToast } = useToast();
  const [uploading, setUploading] = useState(false);
  const id = inputId || "side-image-file";

  const setBusy = (v) => {
    setUploading(v);
    onUploadingChange?.(v);
  };

  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      showToast("Please choose an image file", "warning");
      return;
    }
    if (file.size > MAX_BYTES) {
      showToast("Image must be 5 MB or smaller", "warning");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await adminApi.uploadExperienceBanner(fd);
      const url = res.data?.result?.url || res.data?.url;
      if (!url) throw new Error("Upload failed");
      onChange({ sideImageUrl: url });
      showToast("Image uploaded", "success");
    } catch (e) {
      showToast(e.response?.data?.message || e.message || "Upload failed", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{label}</label>
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-slate-200 p-3" data-testid="side-image-upload">
        <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-xl bg-slate-100">
          <img
            src={getSectionSideImage({ sideImageKey, sideImageUrl })}
            alt="Selected image"
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex-1 space-y-1">
          <input
            id={id}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="flex flex-wrap gap-2">
            <label
              htmlFor={id}
              className="cursor-pointer rounded-lg bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-slate-800"
            >
              {uploading ? "Uploading…" : sideImageUrl ? "Change custom image" : "Upload custom image"}
            </label>
            {sideImageUrl && !uploading && (
              <button
                type="button"
                onClick={() => onChange({ sideImageUrl: "" })}
                className="rounded-lg px-3 py-1.5 text-[11px] font-bold text-rose-600 hover:bg-rose-50"
              >
                Remove
              </button>
            )}
          </div>
          <p className="text-[10px] text-slate-400">
            {sideImageUrl
              ? "Your image is used for this section. Pick a preset below to switch back."
              : "PNG/JPG up to 5 MB, square works best. Or pick a preset below."}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {SIDE_IMAGE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onChange({ sideImageKey: opt.key, sideImageUrl: "" })}
            className={cn(
              "rounded-xl overflow-hidden border-2 transition-all aspect-square bg-slate-100",
              !sideImageUrl && sideImageKey === opt.key
                ? "border-primary ring-2 ring-primary/30"
                : "border-slate-200 hover:border-slate-300",
            )}
          >
            <img src={opt.imageUrl} alt={opt.label} className="w-full h-full object-cover" />
            <span className="block text-[10px] font-bold text-slate-600 p-1 truncate">{opt.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default SideImagePicker;
