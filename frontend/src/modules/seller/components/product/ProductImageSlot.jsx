import React from "react";
import { HiOutlinePencilSquare, HiOutlineTrash } from "react-icons/hi2";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { applyCloudinaryTransform } from "@/core/utils/imageUtils";

// Reads a picked file as a data URL, which is also how the form previews it.
const readImageFile = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

/**
 * One product photo in the seller form. A filled slot has always-visible Replace
 * and Delete buttons (phones have no hover); an empty slot opens the file picker.
 * `onSelect` receives the picked photo as a data URL.
 */
const ProductImageSlot = ({ src, label, onSelect, onRemove, className, children }) => {
  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // lets the same file be picked again after a delete
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    try {
      onSelect(await readImageFile(file));
    } catch {
      toast.error("Could not read that image. Please try another one.");
    }
  };

  if (!src) {
    return (
      <div className={cn("group flex cursor-pointer flex-col items-center justify-center overflow-hidden border-2 border-dashed border-slate-200 bg-slate-50 transition-all hover:border-primary hover:bg-primary/5 relative", className)}>
        <input
          type="file"
          accept="image/*"
          aria-label={`Upload ${label}`}
          className="absolute inset-0 z-10 cursor-pointer opacity-0"
          onChange={handleFile}
        />
        {children}
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden border-2 border-dashed border-slate-200 bg-slate-50", className)}>
      <img src={applyCloudinaryTransform(src)} alt={label} className="h-full w-full object-cover" />
      <div className="absolute right-1.5 top-1.5 flex gap-1.5">
        <label
          title="Replace photo"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-white text-slate-700 shadow-md transition-colors hover:text-primary focus-within:ring-2 focus-within:ring-primary"
        >
          <input
            type="file"
            accept="image/*"
            aria-label={`Replace ${label}`}
            className="sr-only"
            onChange={handleFile}
          />
          <HiOutlinePencilSquare className="h-4 w-4" />
        </label>
        <button
          type="button"
          title="Delete photo"
          aria-label={`Delete ${label}`}
          onClick={onRemove}
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-rose-600 shadow-md transition-colors hover:bg-rose-50"
        >
          <HiOutlineTrash className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
};

export default ProductImageSlot;
