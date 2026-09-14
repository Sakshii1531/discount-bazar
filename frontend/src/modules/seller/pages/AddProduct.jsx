import React, { useState, useMemo, useEffect, useRef } from "react";
import Button from "@shared/components/ui/Button";
import Badge from "@shared/components/ui/Badge";
import {
  HiOutlineArrowLeft,
  HiOutlineArrowRight,
  HiOutlineCube,
  HiOutlineTag,
  HiOutlineCurrencyDollar,
  HiOutlineSwatch,
  HiOutlineFolderOpen,
  HiOutlinePhoto,
  HiOutlineScale,
  HiOutlineArrowPath,
  HiOutlineTrash,
  HiOutlinePlus,
  HiOutlineSquaresPlus,
} from "react-icons/hi2";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { sellerApi } from "../services/sellerApi";

import ReturnPolicySection from "@shared/components/ui/ReturnPolicySection";

const TABS = [
  { id: "general", label: "General Info", icon: HiOutlineTag },
  { id: "variants", label: "Item Variants", icon: HiOutlineSwatch },
  { id: "category", label: "Groups", icon: HiOutlineFolderOpen },
  { id: "media", label: "Photos", icon: HiOutlinePhoto },
  { id: "returnPolicy", label: "Return Policy", icon: HiOutlineArrowPath },
];

const STORAGE_KEY = "seller_add_product_draft";
const TAB_STORAGE_KEY = "seller_add_product_tab";

const initialFormData = {
  name: "",
  slug: "",
  sku: "",
  description: "",
  price: "",
  salePrice: "",
  stock: "",
  lowStockAlert: 5,
  category: "",
  subcategory: "",
  header: "",
  status: "active",
  tags: "",
  weight: "",
  brand: "",
  shelfLife: "",
  countryOfOrigin: "",
  fssaiLicense: "",
  mainImage: null,
  galleryImages: [],
  returnPolicy: {
    isReturnable: false,
    returnWindowDays: 0,
    returnReasons: [],
  },
  variants: [
    {
      id: Date.now(),
      name: "",
      price: "",
      salePrice: "",
      stock: "",
      sku: "",
    },
  ],
};

const getInitialFormData = () => {
  if (typeof window === "undefined") return initialFormData;
  try {
    const raw =
      sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY);
    if (!raw) return initialFormData;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return initialFormData;

    return {
      ...initialFormData,
      ...parsed,
      returnPolicy: {
        ...initialFormData.returnPolicy,
        ...(parsed.returnPolicy || {}),
      },
      variants:
        Array.isArray(parsed.variants) && parsed.variants.length > 0
          ? parsed.variants
          : initialFormData.variants,
      galleryImages: Array.isArray(parsed.galleryImages)
        ? parsed.galleryImages
        : [],
    };
  } catch (err) {
    console.warn("Failed to parse product draft:", err);
    return initialFormData;
  }
};

const dataURLtoFile = (dataurl, filename) => {
  try {
    if (!dataurl || typeof dataurl !== "string" || !dataurl.startsWith("data:")) {
      return null;
    }
    const arr = dataurl.split(",");
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new File([u8arr], filename, { type: mime });
  } catch (err) {
    console.error("Error converting dataURL to file:", err);
    return null;
  }
};

const AddProduct = () => {
  const navigate = useNavigate();
  const [modalTab, setModalTab] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem(TAB_STORAGE_KEY) || "general";
    }
    return "general";
  });
  const [isSaving, setIsSaving] = useState(false);
  const contentRef = useRef(null);

  const handleTabClick = (tabId) => {
    setModalTab(tabId);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(TAB_STORAGE_KEY, tabId);
    }
    setTimeout(() => {
      if (contentRef.current) {
        const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
        if (isMobile) {
          const yOffset = -70;
          const y =
            contentRef.current.getBoundingClientRect().top +
            window.pageYOffset +
            yOffset;
          window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });

          const firstField = contentRef.current.querySelector(
            "input:not([type=hidden]), textarea, select"
          );
          if (firstField) {
            firstField.focus({ preventScroll: true });
          }
        }
      }
    }, 80);
  };

  const currentTabIndex = TABS.findIndex((tab) => tab.id === modalTab);
  const safeTabIndex = currentTabIndex >= 0 ? currentTabIndex : 0;
  const hasNextTab = safeTabIndex < TABS.length - 1;
  const hasPrevTab = safeTabIndex > 0;
  const nextTab = hasNextTab ? TABS[safeTabIndex + 1] : null;
  const prevTab = hasPrevTab ? TABS[safeTabIndex - 1] : null;

  const handleNext = () => {
    if (hasNextTab) {
      handleTabClick(TABS[safeTabIndex + 1].id);
    }
  };

  const handlePrev = () => {
    if (hasPrevTab) {
      handleTabClick(TABS[safeTabIndex - 1].id);
    }
  };

  useEffect(() => {
    const handleFocusIn = (e) => {
      if (
        typeof window !== "undefined" &&
        window.innerWidth < 768 &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target?.tagName)
      ) {
        setTimeout(() => {
          e.target.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 200);
      }
    };
    window.addEventListener("focusin", handleFocusIn);
    return () => window.removeEventListener("focusin", handleFocusIn);
  }, []);

  const makeSku = (name, index = 1) => {
    const prefix =
      String(name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 5) || "item";
    return `${prefix}-${String(index).padStart(3, "0")}`;
  };

  const isAutoSku = (sku, name, index = 1) =>
    String(sku || "").toLowerCase() === makeSku(name, index);

  const [formData, setFormData] = useState(getInitialFormData);

  // Auto-save form draft across refreshes
  useEffect(() => {
    try {
      const { mainImageFile, galleryFiles, ...toSave } = formData;
      const serialized = JSON.stringify(toSave);
      try {
        localStorage.setItem(STORAGE_KEY, serialized);
      } catch (err) {
        // In case localStorage is exceeded by base64 images, save text fields without images
        const { mainImage, galleryImages, ...textOnly } = toSave;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(textOnly));
      }
      try {
        sessionStorage.setItem(STORAGE_KEY, serialized);
      } catch (e) {
        // ignore
      }
    } catch (e) {
      console.warn("Error saving product draft:", e);
    }
  }, [formData]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      try {
        const { mainImageFile, galleryFiles, ...toSave } = formData;
        const serialized = JSON.stringify(toSave);
        localStorage.setItem(STORAGE_KEY, serialized);
        sessionStorage.setItem(STORAGE_KEY, serialized);
      } catch (e) {}
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [formData]);

  const [dbCategories, setDbCategories] = useState([]);
  const [isLoadingCats, setIsLoadingCats] = useState(true);

  useEffect(() => {
    setFormData((prev) => {
      if (!prev.name) return prev;

      const nextSku =
        !prev.sku || isAutoSku(prev.sku, prev.name, 1)
          ? makeSku(prev.name, 1)
          : prev.sku;

      const nextVariants = prev.variants.map((variant, idx) => {
        const variantIndex = idx + 1;
        const shouldAuto =
          !variant.sku || isAutoSku(variant.sku, prev.name, variantIndex);
        return shouldAuto
          ? { ...variant, sku: makeSku(prev.name, variantIndex) }
          : variant;
      });

      const changed =
        nextSku !== prev.sku ||
        nextVariants.some((variant, idx) => variant !== prev.variants[idx]);

      return changed ? { ...prev, sku: nextSku, variants: nextVariants } : prev;
    });
  }, [formData.name]);

  React.useEffect(() => {
    const fetchCats = async () => {
      try {
        const res = await sellerApi.getCategoryTree();
        if (res.data.success) {
          setDbCategories(res.data.results || res.data.result || []);
        }
      } catch (error) {
        toast.error("Failed to load categories");
      } finally {
        setIsLoadingCats(false);
      }
    };
    fetchCats();
  }, []);

  const categories = dbCategories;

  const handleSave = async () => {
    // Validate required fields
    if (!formData.name) {
      toast.error("Please fill in the Product Title");
      return;
    }

    // Validate all three category levels are selected
    if (!formData.header || !formData.category || !formData.subcategory) {
      toast.error("Please select all three category levels: Main Group, Specific Category, and Sub-Category");
      return;
    }

    const firstVariant = formData.variants[0] || {};
    if (!firstVariant.price || !firstVariant.stock) {
      toast.error("Main variant must have price and stock");
      return;
    }

    const invalidVariant = formData.variants.find((v) => {
      const p = Number(v.price || 0);
      const s = Number(v.salePrice || 0);
      return s > 0 && s > p;
    });

    if (invalidVariant) {
      toast.error("Sale price cannot be greater than original price");
      return;
    }

    if (formData.returnPolicy?.isReturnable) {
      if (!formData.returnPolicy.returnWindowDays || Number(formData.returnPolicy.returnWindowDays) <= 0 || Number(formData.returnPolicy.returnWindowDays) > 30) {
        toast.error("Please enter a valid Return Window (1 to 30 days).");
        return;
      }
    }

    setIsSaving(true);
    try {
      const data = new FormData();

      // Basic fields
      data.append("name", formData.name);
      data.append("slug", formData.slug);
      data.append("sku", formData.sku);
      data.append("description", formData.description);
      data.append("brand", formData.brand);
      data.append("weight", formData.weight);
      data.append("shelfLife", formData.shelfLife || "");
      data.append("countryOfOrigin", formData.countryOfOrigin || "");
      data.append("fssaiLicense", formData.fssaiLicense || "");
      data.append("status", formData.status);

      // Return policy
      data.append("returnPolicy", JSON.stringify(formData.returnPolicy || { isReturnable: false, returnWindowDays: 0, returnReasons: [] }));

      // Map top-level price from first variant; compute master stock as sum of all variants
      data.append("price", firstVariant.price);
      data.append("salePrice", firstVariant.salePrice || 0);
      const totalStock = (formData.variants || []).reduce(
        (sum, v) => sum + Math.max(0, Number(v.stock) || 0),
        0
      );
      data.append("stock", totalStock);

      // Category IDs
      data.append("headerId", formData.header);
      data.append("categoryId", formData.category);
      data.append("subcategoryId", formData.subcategory);

      // Tags
      data.append("tags", formData.tags);

      // Images
      const effectiveMainFile =
        formData.mainImageFile ||
        dataURLtoFile(formData.mainImage, "main-image.jpg");
      if (effectiveMainFile) {
        data.append("mainImage", effectiveMainFile);
      }

      const effectiveGalleryFiles =
        formData.galleryFiles && formData.galleryFiles.length > 0
          ? formData.galleryFiles
          : (formData.galleryImages || [])
              .map((img, i) =>
                img instanceof File
                  ? img
                  : dataURLtoFile(img, `gallery_${i + 1}.jpg`)
              )
              .filter(Boolean);

      if (effectiveGalleryFiles && effectiveGalleryFiles.length > 0) {
        effectiveGalleryFiles.forEach((file) => {
          data.append("galleryImages", file);
        });
      }

      // Variants
      data.append("variants", JSON.stringify(formData.variants));

      const response = await sellerApi.createProduct(data);
      const approvalStatus = response?.data?.result?.approvalStatus;
      if (approvalStatus === "pending") {
        toast.success("Product submitted for admin approval");
      } else {
        toast.success(response?.data?.message || "Product saved successfully!");
      }

      try {
        localStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(STORAGE_KEY);
        sessionStorage.removeItem(TAB_STORAGE_KEY);
      } catch (e) {}

      navigate("/seller/products");
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to save product");
    } finally {
      setIsSaving(false);
    }
  };

  const handleImageUpload = (e, type) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const reader = new FileReader();
      reader.onloadend = () => {
        if (type === "main") {
          setFormData({
            ...formData,
            mainImage: reader.result,
            mainImageFile: file
          });
        } else {
          setFormData({
            ...formData,
            galleryImages: [...formData.galleryImages, reader.result],
            galleryFiles: [...(formData.galleryFiles || []), file]
          });
        }
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <Button
          variant="ghost"
          className="pl-0 hover:bg-transparent hover:text-primary-600"
          onClick={() => navigate(-1)}>
          <HiOutlineArrowLeft className="mr-2 h-5 w-5" />
          Back to Products
        </Button>
        <div className="flex gap-2 sm:gap-3 items-center">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          {hasNextTab && (
            <Button
              type="button"
              variant="outline"
              onClick={handleNext}
              className="flex items-center gap-1.5 border-primary/30 text-primary hover:bg-primary/5">
              <span>Next</span>
              <HiOutlineArrowRight className="h-4 w-4" />
            </Button>
          )}
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className="min-w-[130px]">
            {isSaving ? (
              <>
                <HiOutlineArrowPath className="mr-2 h-5 w-5 animate-spin" />
                Publishing...
              </>
            ) : (
              "Save & Publish"
            )}
          </Button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-xl overflow-hidden flex flex-col md:flex-row min-h-[600px] border border-slate-100">
        {/* Sidebar Tabs */}
        <div className="md:w-64 bg-slate-50/50 border-r border-slate-100 p-4 space-y-1 overflow-y-auto">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={cn(
                "w-full flex items-center space-x-3 px-4 py-3 rounded-md text-xs font-bold transition-all text-left",
                modalTab === tab.id
                  ? "bg-white text-primary shadow-sm ring-1 ring-slate-100"
                  : "text-slate-600 hover:bg-slate-100",
              )}>
              <tab.icon className="h-4 w-4" />
              <span>{tab.label}</span>
            </button>
          ))}

          <div className="pt-8 px-4">
            <div className="p-4 bg-brand-50 rounded-md border border-brand-100">
              <p className="text-[9px] font-bold text-brand-600 uppercase tracking-widest mb-1">
                Status
              </p>
              <select
                value={formData.status}
                onChange={(e) =>
                  setFormData({ ...formData, status: e.target.value })
                }
                className="w-full bg-transparent border-none text-xs font-bold text-brand-700 outline-none p-0 cursor-pointer focus:ring-0">
                <option value="active">PUBLISHED</option>
                <option value="inactive">DRAFT</option>
              </select>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div ref={contentRef} className="flex-1 p-4 sm:p-8 overflow-y-auto">
          {modalTab === "general" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <div className="space-y-1.5 flex flex-col">
                <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                  Product Title
                </label>
                <input
                  value={formData.name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setFormData((prev) => ({
                      ...prev,
                      name: nextName,
                      sku:
                        !prev.sku || isAutoSku(prev.sku, prev.name, 1)
                          ? makeSku(nextName, 1)
                          : prev.sku,
                      variants: prev.variants.map((variant, idx) => {
                        const variantIndex = idx + 1;
                        const shouldAuto =
                          !variant.sku ||
                          isAutoSku(variant.sku, prev.name, variantIndex);
                        return shouldAuto
                          ? { ...variant, sku: makeSku(nextName, variantIndex) }
                          : variant;
                      }),
                    }));
                  }}
                  className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-semibold outline-none ring-primary/5 focus:ring-2 transition-all"
                  placeholder="e.g. Premium Basmati Rice"
                />
              </div>
              <div className="space-y-1.5 flex flex-col">
                <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                  About this item
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  onWheel={(e) => e.stopPropagation()}
                  onTouchMove={(e) => e.stopPropagation()}
                  className="w-full px-4 py-3 bg-slate-100 border-none rounded-2xl text-sm font-semibold min-h-[160px] max-h-[260px] outline-none transition-all focus:ring-2 focus:ring-primary/5 resize-none overflow-y-auto custom-scrollbar"
                  placeholder="Describe the item here..."
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                    Brand Name
                  </label>
                  <input
                    value={formData.brand}
                    onChange={(e) =>
                      setFormData({ ...formData, brand: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-semibold outline-none ring-primary/5 focus:ring-2 transition-all"
                    placeholder="e.g. Amul"
                  />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                    Product Code
                  </label>
                  <input
                    value={formData.sku}
                    onChange={(e) =>
                      setFormData({ ...formData, sku: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-mono font-bold outline-none ring-primary/5 focus:ring-2 transition-all"
                    placeholder="AUTO-GENERATED"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                    Shelf Life
                  </label>
                  <input
                    value={formData.shelfLife}
                    onChange={(e) =>
                      setFormData({ ...formData, shelfLife: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-semibold outline-none ring-primary/5 focus:ring-2 transition-all"
                    placeholder="e.g. 3 Days, 6 Months"
                  />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                    Country of Origin
                  </label>
                  <input
                    value={formData.countryOfOrigin}
                    onChange={(e) =>
                      setFormData({ ...formData, countryOfOrigin: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-semibold outline-none ring-primary/5 focus:ring-2 transition-all"
                    placeholder="e.g. India"
                  />
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                    FSSAI License
                  </label>
                  <input
                    value={formData.fssaiLicense}
                    onChange={(e) =>
                      setFormData({ ...formData, fssaiLicense: e.target.value })
                    }
                    className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-semibold outline-none ring-primary/5 focus:ring-2 transition-all"
                    placeholder="e.g. 1001234567890"
                  />
                </div>
              </div>
            </div>
          )}

          {modalTab === "variants" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-900">
                    Product Variants
                  </h4>
                  <p className="text-xs text-slate-600 font-medium">
                    Add different sizes, colors or weights.
                  </p>
                </div>
                <button
                  onClick={() => {
                    const invalid = (formData.variants || []).find((v) => {
                      const p = Number(v.price || 0);
                      const s = Number(v.salePrice || 0);
                      return s > 0 && p > 0 && s > p;
                    });
                    if (invalid) {
                      toast.error("Please fix Sale Price before adding another variant.");
                      return;
                    }
                    setFormData((prev) => ({
                      ...prev,
                      variants: [
                        ...prev.variants,
                        {
                          id: Date.now(),
                          name: "",
                          price: "",
                          salePrice: "",
                          stock: "",
                          sku: makeSku(prev.name, prev.variants.length + 1),
                        },
                      ],
                    }));
                  }}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-[10px] font-bold hover:bg-primary/20 transition-all">
                  <HiOutlineSquaresPlus className="h-4 w-4" />
                  <span>ADD VARIANT</span>
                </button>
              </div>

              <div className="space-y-3">
                {(formData.variants || []).map((variant, index) => (
                  <div
                    key={variant.id}
                    className="p-4 bg-slate-50 rounded-2xl border border-slate-100 grid grid-cols-1 md:grid-cols-12 gap-4 items-end group relative">
                    <div className="col-span-12 md:col-span-3 space-y-1">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                        Variant Name
                      </label>
                      <input
                        value={variant.name}
                        onChange={(e) => {
                          const nextValue = e.target.value;
                          setFormData((prev) => {
                            const newVariants = prev.variants.map((item, idx) => {
                              if (idx !== index) return item;
                              return { ...item, name: nextValue };
                            });
                            return {
                              ...prev,
                              variants: newVariants,
                            };
                          });
                        }}
                        placeholder="e.g. 1kg, 1 pack, 1 liter..."
                        className="w-full px-3 py-2 bg-white ring-1 ring-slate-200 border-none rounded-xl text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/10"
                      />
                    </div>
                    <div className="col-span-6 md:col-span-2 space-y-1">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                        Price
                      </label>
                      <input
                        type="number"
                        min="0"
                        onKeyDown={(e) => {
                          if (['-', '+', 'e', 'E'].includes(e.key)) {
                            e.preventDefault();
                          }
                        }}
                        value={variant.price}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '' && Number(val) < 0) return;
                          const newVariants = [...formData.variants];
                          newVariants[index].price = val;
                          setFormData({ ...formData, variants: newVariants });
                        }}
                        placeholder="500"
                        className="w-full px-3 py-2 bg-white ring-1 ring-slate-200 border-none rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/10"
                      />
                    </div>
                    <div className="col-span-6 md:col-span-2 space-y-1">
                      <label className="text-[8px] font-bold text-brand-500 uppercase tracking-widest ml-1">
                        Sale
                      </label>
                      <input
                        type="number"
                        min="0"
                        onKeyDown={(e) => {
                          if (['-', '+', 'e', 'E'].includes(e.key)) {
                            e.preventDefault();
                          }
                        }}
                        value={variant.salePrice}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '' && Number(val) < 0) return;
                          const p = Number(variant.price || 0);
                          const s = Number(val || 0);
                          if (s > 0 && p > 0 && s > p) {
                            toast.error("Sale price cannot be more than Original Price (MRP).");
                          }
                          const newVariants = [...formData.variants];
                          newVariants[index].salePrice = val;
                          setFormData({ ...formData, variants: newVariants });
                        }}
                        placeholder="450"
                        className={`w-full px-3 py-2 border-none rounded-xl text-xs font-bold outline-none transition-all ${
                          Number(variant.salePrice || 0) > Number(variant.price || 0) && Number(variant.salePrice || 0) > 0 && Number(variant.price || 0) > 0
                            ? "bg-rose-50 ring-2 ring-rose-500 text-rose-700"
                            : "bg-brand-50 ring-1 ring-brand-100 text-brand-700 focus:ring-2 focus:ring-brand-200"
                        }`}
                      />
                    </div>
                    <div className="col-span-6 md:col-span-2 space-y-1">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                        Stock
                      </label>
                      <input
                        type="number"
                        min="0"
                        onKeyDown={(e) => {
                          if (['-', '+', 'e', 'E'].includes(e.key)) {
                            e.preventDefault();
                          }
                        }}
                        value={variant.stock}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val !== '' && Number(val) < 0) return;
                          const newVariants = [...formData.variants];
                          newVariants[index].stock = val;
                          setFormData({ ...formData, variants: newVariants });
                        }}
                        placeholder="10"
                        className="w-full px-3 py-2 bg-white ring-1 ring-slate-200 border-none rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-primary/10"
                      />
                    </div>
                    <div className="col-span-5 md:col-span-2 space-y-1">
                      <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                        Product Code
                      </label>
                      <input
                        value={variant.sku}
                        onChange={(e) => {
                          const newVariants = [...formData.variants];
                          newVariants[index].sku = e.target.value;
                          setFormData({ ...formData, variants: newVariants });
                        }}
                        placeholder={makeSku(formData.name, index + 1)}
                        className="w-full px-3 py-2 bg-white ring-1 ring-slate-200 border-none rounded-xl text-xs font-mono font-bold outline-none focus:ring-2 focus:ring-primary/10"
                      />
                    </div>
                    <div className="col-span-1 flex justify-end pb-1">
                      <button
                        onClick={() => {
                          if (formData.variants.length > 1) {
                            setFormData((prev) => {
                              const remaining = prev.variants
                                .map((variant, idx) => ({ variant, oldIndex: idx + 1 }))
                                .filter((item) => item.oldIndex !== index + 1)
                                .map((item, newIdx) => {
                                  const shouldAuto =
                                    !item.variant.sku ||
                                    isAutoSku(item.variant.sku, prev.name, item.oldIndex);
                                  return shouldAuto
                                    ? { ...item.variant, sku: makeSku(prev.name, newIdx + 1) }
                                    : item.variant;
                                });
                              return { ...prev, variants: remaining };
                            });
                          }
                        }}
                        className="p-2 text-slate-300 hover:text-rose-500 transition-colors">
                        <HiOutlineTrash className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {modalTab === "category" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                    Main Group <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.header}
                    onChange={(e) =>
                      setFormData({ ...formData, header: e.target.value, category: "", subcategory: "" })
                    }
                    className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-bold outline-none cursor-pointer focus:ring-2 focus:ring-primary/5 transition-all">
                    <option value="">Select Main Group</option>
                    {categories.map((h) => (
                      <option key={h._id || h.id} value={h._id || h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                    Specific Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.category}
                    onChange={(e) =>
                      setFormData({ ...formData, category: e.target.value, subcategory: "" })
                    }
                    disabled={!formData.header}
                    className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-bold outline-none cursor-pointer focus:ring-2 focus:ring-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    <option value="">Select Category</option>
                    {categories
                      .find((h) => (h._id || h.id) === formData.header)
                      ?.children?.map((c) => (
                        <option key={c._id || c.id} value={c._id || c.id}>
                          {c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-6">
                <div className="space-y-1.5 flex flex-col">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                    Sub-Category <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={formData.subcategory}
                    onChange={(e) =>
                      setFormData({ ...formData, subcategory: e.target.value })
                    }
                    disabled={!formData.category}
                    className="w-full px-4 py-2.5 bg-slate-100 border-none rounded-md text-sm font-bold outline-none cursor-pointer focus:ring-2 focus:ring-primary/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                    <option value="">Select Sub-Category</option>
                    {categories
                      .find((h) => (h._id || h.id) === formData.header)
                      ?.children?.find((c) => (c._id || c.id) === formData.category)
                      ?.children?.map((sc) => (
                        <option key={sc._id || sc.id} value={sc._id || sc.id}>
                          {sc.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
            </div>
          )}

          {modalTab === "media" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-2 duration-300">
              {/* Main Image Section */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                  Main Cover Photo
                </label>
                <div className="flex flex-col md:flex-row items-start gap-6">
                  <div className="w-48 aspect-square rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center group hover:border-primary hover:bg-primary/5 transition-all cursor-pointer overflow-hidden relative">
                    <input
                      type="file"
                      className="absolute inset-0 opacity-0 cursor-pointer z-10"
                      onChange={(e) => handleImageUpload(e, "main")}
                    />
                    {formData.mainImage ? (
                      <img
                        src={formData.mainImage}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <>
                        <HiOutlinePhoto className="h-10 w-10 text-slate-200 group-hover:text-primary transition-colors" />
                        <p className="text-[9px] font-bold text-slate-600 mt-2 uppercase tracking-widest group-hover:text-primary">
                          Upload Cover
                        </p>
                      </>
                    )}
                  </div>
                  <div className="flex-1 space-y-2 pt-2">
                    <p className="text-xs font-bold text-slate-900">
                      Choose a primary image
                    </p>
                    <p className="text-xs text-slate-600 font-medium leading-relaxed">
                      We show this image on the search page and the main
                      store listing. Make sure it is clear and bright.
                    </p>
                    <button className="text-[10px] font-black text-primary uppercase tracking-wider hover:underline">
                      Pick from Library
                    </button>
                  </div>
                </div>
              </div>

              {/* Gallery Section */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-600 uppercase tracking-widest ml-1">
                  Gallery Photos (Max 5)
                </label>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="aspect-square rounded-md border-2 border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center group hover:border-primary hover:bg-primary/5 transition-all cursor-pointer relative overflow-hidden">
                      {formData.galleryImages[i - 1] ? (
                        <img
                          src={formData.galleryImages[i - 1]}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <>
                          <input
                            type="file"
                            className="absolute inset-0 opacity-0 cursor-pointer z-10"
                            onChange={(e) => handleImageUpload(e, "gallery")}
                          />
                          <HiOutlinePlus className="h-5 w-5 text-slate-200 group-hover:text-primary transition-colors" />
                          <p className="text-[8px] font-bold text-slate-600 mt-1 uppercase tracking-widest group-hover:text-primary">
                            Add
                          </p>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <p className="text-xs text-slate-600 font-medium italic text-center pt-4 border-t border-slate-50">
                Quick Tip: Using WebP format at 800x800px makes your store load
                3x faster.
              </p>
            </div>
          )}

          {modalTab === "returnPolicy" && (
            <div className="space-y-6 animate-in fade-in slide-in-from-right-2 duration-300">
              <ReturnPolicySection
                returnPolicy={formData.returnPolicy}
                onChange={(newPolicy) =>
                  setFormData((prev) => ({ ...prev, returnPolicy: newPolicy }))
                }
              />
            </div>
          )}

          {/* Next / Previous Page Navigation Footer */}
          <div className="pt-6 mt-8 border-t border-slate-100 flex items-center justify-between gap-4">
            {hasPrevTab ? (
              <Button
                type="button"
                variant="outline"
                onClick={handlePrev}
                className="flex items-center gap-2 text-xs font-bold text-slate-700">
                <HiOutlineArrowLeft className="h-4 w-4" />
                <span>Back: {prevTab.label}</span>
              </Button>
            ) : (
              <div />
            )}

            {hasNextTab ? (
              <Button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-2 text-xs font-bold bg-primary text-white hover:bg-primary-600 shadow-sm ml-auto">
                <span>Next: {nextTab.label}</span>
                <HiOutlineArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="min-w-[140px] text-xs font-bold ml-auto">
                {isSaving ? (
                  <>
                    <HiOutlineArrowPath className="mr-2 h-5 w-5 animate-spin" />
                    Publishing...
                  </>
                ) : (
                  "Save & Publish"
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AddProduct;
