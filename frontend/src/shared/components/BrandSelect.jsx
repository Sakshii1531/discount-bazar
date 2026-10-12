import { useEffect, useMemo, useState } from "react";
import SearchableSelect from "@shared/components/ui/SearchableSelect";
import { loadActiveBrands, brandNameKey as nameKey } from "@shared/utils/brands";

/**
 * Searchable dropdown of admin-approved brands.
 *
 * `value` is the brand id; `legacyName` is the product's stored brand text,
 * used to preselect a matching brand for products created before brands
 * were managed, or to tell the seller their old brand needs re-selecting.
 * `onChange(id, name)` receives "" for both when cleared.
 */
const BrandSelect = ({ value = "", legacyName = "", onChange, className, disabled = false }) => {
  const [brands, setBrands] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadActiveBrands()
      .then((list) => {
        if (!cancelled) setBrands(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const options = useMemo(() => {
    const opts = brands.map((b) => ({ id: b._id, label: b.name }));
    // Keep a product's current brand visible even if an admin deactivated it.
    if (value && !opts.some((o) => String(o.id) === String(value)) && legacyName) {
      opts.unshift({ id: value, label: `${legacyName} (inactive)` });
    }
    return opts;
  }, [brands, value, legacyName]);

  // Products saved with free-text brands: link to the matching official brand.
  useEffect(() => {
    if (value || !legacyName || brands.length === 0) return;
    const match = brands.find((b) => nameKey(b.name) === nameKey(legacyName));
    if (match) onChange?.(match._id, match.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, legacyName, brands]);

  const unmatchedLegacy =
    !isLoading && !value && legacyName &&
    !brands.some((b) => nameKey(b.name) === nameKey(legacyName));

  const handleChange = (id) => {
    if (!id) return onChange?.("", "");
    const brand = brands.find((b) => String(b._id) === String(id));
    onChange?.(id, brand?.name || legacyName || "");
  };

  return (
    <div className="space-y-1">
      <SearchableSelect
        options={options}
        value={value}
        onChange={handleChange}
        disabled={disabled || isLoading}
        placeholder={isLoading ? "Loading brands..." : "Select a brand"}
        searchPlaceholder="Search brands..."
        emptyMessage={
          loadError
            ? "Couldn't load brands. Please refresh."
            : "No matching brand. Ask the admin to add it."
        }
        className={className}
      />
      {unmatchedLegacy && (
        <p className="text-[11px] text-amber-600 ml-1">
          Current brand "{legacyName}" isn't in the approved list. Select a brand or clear it.
        </p>
      )}
    </div>
  );
};

export default BrandSelect;
