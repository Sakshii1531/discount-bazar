import React, { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import Card from "@shared/components/ui/Card";
import Badge from "@shared/components/ui/Badge";
import Pagination from "@shared/components/ui/Pagination";
import { Plus, Search, Edit, Trash, X, Image } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { adminApi } from "../services/adminApi";
import { toast } from "sonner";

const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const makeSlug = (value) =>
  String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/-+/g, "-");

const emptyForm = { name: "", slug: "", description: "", status: "active" };

const BrandManagement = () => {
  const [brands, setBrands] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name-asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [logoFile, setLogoFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const fileInputRef = useRef(null);

  // Debounce search so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setSearchTerm(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [searchTerm, statusFilter, sortBy, pageSize]);

  const fetchBrands = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.getAdminBrands({
        page,
        limit: pageSize,
        search: searchTerm || undefined,
        status: statusFilter === "all" ? undefined : statusFilter,
        sort: sortBy,
      });
      const payload = res.data?.result || {};
      setBrands(Array.isArray(payload.items) ? payload.items : []);
      setTotal(payload.total || 0);
      setTotalPages(payload.totalPages || 1);
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to fetch brands");
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, searchTerm, statusFilter, sortBy]);

  useEffect(() => {
    fetchBrands();
  }, [fetchBrands]);

  // Release blob preview URLs when they are replaced or the modal closes.
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith("blob:")) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const openAddModal = () => {
    setEditingItem(null);
    setFormData(emptyForm);
    setLogoFile(null);
    setPreviewUrl(null);
    setIsModalOpen(true);
  };

  const openEditModal = (item) => {
    setEditingItem(item);
    setFormData({
      name: item.name || "",
      slug: item.slug || "",
      description: item.description || "",
      status: item.status || "active",
    });
    setLogoFile(null);
    setPreviewUrl(item.logo || null);
    setIsModalOpen(true);
  };

  const handleLogoChange = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please choose an image file");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("Logo must be 2 MB or smaller");
      return;
    }
    setLogoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const removeLogo = () => {
    setLogoFile(null);
    setPreviewUrl(null);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error("Brand name is required");
      return;
    }

    setIsSaving(true);
    try {
      const data = new FormData();
      data.append("name", formData.name.trim());
      data.append("slug", formData.slug || makeSlug(formData.name));
      data.append("description", formData.description.trim());
      data.append("status", formData.status);
      if (logoFile) {
        data.append("logo", logoFile);
      } else if (!previewUrl) {
        data.append("logo", ""); // logo removed
      }

      if (editingItem) {
        await adminApi.updateBrand(editingItem._id, data);
        toast.success("Brand updated");
      } else {
        await adminApi.createBrand(data);
        toast.success("Brand created");
      }
      setIsModalOpen(false);
      setEditingItem(null);
      fetchBrands();
    } catch (error) {
      toast.error(
        error.response?.data?.message ||
          (editingItem ? "Failed to update brand" : "Failed to create brand"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await adminApi.deleteBrand(deleteTarget._id);
      toast.success("Brand deleted");
      setDeleteTarget(null);
      fetchBrands();
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to delete brand");
      setDeleteTarget(null);
    }
  };

  const toggleStatus = async (brand) => {
    const next = brand.status === "active" ? "inactive" : "active";
    try {
      const data = new FormData();
      data.append("status", next);
      await adminApi.updateBrand(brand._id, data);
      setBrands((prev) => prev.map((b) => (b._id === brand._id ? { ...b, status: next } : b)));
      toast.success(`Brand marked ${next}`);
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to update status");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Brands</h1>
          <p className="text-gray-500 mt-1">
            Official brands sellers can pick when adding products
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 bg-black text-white px-4 py-2 rounded-lg hover:bg-brand-700 transition-colors">
          <Plus className="w-5 h-5" />
          Add New Brand
        </button>
      </div>

      <Card className="border-none shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-4 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
            <input
              type="text"
              placeholder="Search brands..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="min-w-[150px] px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500">
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="min-w-[150px] px-3 py-2 rounded-lg border border-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500">
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {["Logo", "Name", "Slug", "Products", "Status"].map((h) => (
                  <th
                    key={h}
                    className="text-left py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {h}
                  </th>
                ))}
                <th className="text-right py-3 px-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {isLoading ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-gray-500">
                    Loading...
                  </td>
                </tr>
              ) : brands.length === 0 ? (
                <tr>
                  <td colSpan="6" className="text-center py-8 text-gray-500">
                    {searchTerm || statusFilter !== "all"
                      ? "No brands match your filters"
                      : "No brands yet. Add your first brand."}
                  </td>
                </tr>
              ) : (
                brands.map((brand) => (
                  <tr key={brand._id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="w-10 h-10 rounded-lg bg-white overflow-hidden flex items-center justify-center border border-gray-200">
                        {brand.logo ? (
                          <img src={brand.logo} alt={brand.name} className="w-full h-full object-contain" />
                        ) : (
                          <span className="text-sm font-bold text-gray-400">
                            {brand.name?.charAt(0)?.toUpperCase()}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-medium text-gray-900">{brand.name}</td>
                    <td className="py-3 px-4 text-gray-500">{brand.slug}</td>
                    <td className="py-3 px-4 text-gray-700">{brand.productCount ?? 0}</td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => toggleStatus(brand)}
                        title={brand.status === "active" ? "Click to deactivate" : "Click to activate"}>
                        <Badge variant={brand.status === "active" ? "success" : "warning"}>
                          {brand.status}
                        </Badge>
                      </button>
                    </td>
                    <td className="py-3 px-4 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => openEditModal(brand)}
                        title="Edit brand"
                        className="p-1 text-gray-500 hover:text-brand-600 transition-colors">
                        <Edit className="w-5 h-5" />
                      </button>
                      <button
                        onClick={() => setDeleteTarget(brand)}
                        title="Delete brand"
                        className="p-1 text-gray-500 hover:text-red-600 transition-colors">
                        <Trash className="w-5 h-5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100">
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={(size) => setPageSize(size)}
            loading={isLoading}
          />
        </div>
      </Card>

      {/* Add/Edit Modal */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {isModalOpen && (
              <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-hidden">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden my-auto flex flex-col max-h-[90vh]">
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center shrink-0">
                    <h2 className="text-lg font-bold text-gray-900">
                      {editingItem ? "Edit Brand" : "Add Brand"}
                    </h2>
                    <button
                      onClick={() => setIsModalOpen(false)}
                      className="text-gray-400 hover:text-gray-600">
                      <X className="w-6 h-6" />
                    </button>
                  </div>

                  <div className="p-6 space-y-4 overflow-y-auto flex-1 overscroll-contain">
                    {/* Logo Upload */}
                    <div className="flex flex-col items-center gap-2">
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="w-24 h-24 rounded-xl bg-gray-50 border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-brand-500 overflow-hidden transition-colors">
                        {previewUrl ? (
                          <img src={previewUrl} alt="Logo preview" className="w-full h-full object-contain" />
                        ) : (
                          <div className="text-center">
                            <Image className="w-8 h-8 text-gray-400 mx-auto" />
                            <span className="text-xs text-gray-500 mt-1">Upload logo</span>
                          </div>
                        )}
                      </div>
                      {previewUrl && (
                        <button
                          type="button"
                          onClick={removeLogo}
                          className="text-xs text-red-600 hover:underline">
                          Remove logo
                        </button>
                      )}
                      <p className="text-[11px] text-gray-400">PNG/JPG/SVG/WebP, up to 2 MB</p>
                      <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        onChange={handleLogoChange}
                        accept="image/*"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Brand Name</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            name: e.target.value,
                            slug: makeSlug(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500"
                        placeholder="e.g., Amul"
                        maxLength={100}
                      />
                      {editingItem && (editingItem.productCount ?? 0) > 0 &&
                        formData.name.trim() !== editingItem.name && (
                          <p className="text-xs text-amber-600">
                            Renaming updates the brand on {editingItem.productCount} linked product
                            {editingItem.productCount === 1 ? "" : "s"}.
                          </p>
                        )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Slug</label>
                      <input
                        type="text"
                        value={formData.slug}
                        readOnly
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-gray-50 text-gray-600 focus:outline-none"
                        placeholder="e.g., amul"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">
                        Description <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      <textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        rows={3}
                        maxLength={500}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 resize-none"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium text-gray-700">Status</label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500">
                        <option value="active">Active (sellers can select it)</option>
                        <option value="inactive">Inactive (hidden from sellers)</option>
                      </select>
                    </div>
                  </div>

                  <div className="p-6 border-t border-gray-100 flex justify-end gap-3 bg-gray-50 shrink-0">
                    <button
                      onClick={() => setIsModalOpen(false)}
                      className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium">
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={isSaving}
                      className="px-4 py-2 bg-black text-white rounded-lg hover:bg-brand-700 font-medium disabled:opacity-50 flex items-center gap-2">
                      {isSaving && (
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      )}
                      {editingItem ? "Update Brand" : "Create Brand"}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* Delete Confirmation Modal */}
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {deleteTarget && (
              <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-hidden">
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-white rounded-xl shadow-xl w-full max-w-sm overflow-hidden my-auto">
                  <div className="p-6 text-center">
                    <div className="w-12 h-12 rounded-full bg-red-100 text-red-600 flex items-center justify-center mx-auto mb-4">
                      <Trash className="w-6 h-6" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 mb-2">Delete Brand?</h3>
                    {(deleteTarget.productCount ?? 0) > 0 ? (
                      <p className="text-gray-500 text-sm mb-6">
                        <span className="font-semibold text-gray-900">{deleteTarget.name}</span> is
                        used by {deleteTarget.productCount} product
                        {deleteTarget.productCount === 1 ? "" : "s"} and can't be deleted. Mark it
                        inactive to hide it from sellers instead.
                      </p>
                    ) : (
                      <p className="text-gray-500 text-sm mb-6">
                        Are you sure you want to delete{" "}
                        <span className="font-semibold text-gray-900">{deleteTarget.name}</span>?
                        This action cannot be undone.
                      </p>
                    )}
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={() => setDeleteTarget(null)}
                        className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">
                        Cancel
                      </button>
                      {(deleteTarget.productCount ?? 0) > 0 ? (
                        <button
                          onClick={() => {
                            if (deleteTarget.status === "active") toggleStatus(deleteTarget);
                            setDeleteTarget(null);
                          }}
                          className="px-4 py-2 bg-black text-white rounded-lg hover:bg-brand-700 font-medium transition-colors">
                          {deleteTarget.status === "active" ? "Mark Inactive" : "OK"}
                        </button>
                      ) : (
                        <button
                          onClick={handleDelete}
                          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
};

export default BrandManagement;
