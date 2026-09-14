/**
 * Universal mobile-friendly file downloader.
 * Fixes "Download failed: Exception: Network error or URL revoked" on mobile WebViews.
 *
 * Strategy:
 * 1. Primary: Blob URL with long-deferred revocation (5 minutes).
 *    Never revoke immediately — Android's native downloader reads the blob async.
 * 2. Fallback: Base64 Data URL via FileReader (bypasses blob: URL entirely).
 *    Used if creating the object URL fails for any reason.
 *
 * NOTE: Web Share API is intentionally NOT used here.
 * navigator.share() resolves the promise before Android finishes the share action,
 * causing the downstream blob URL to be revoked while the native handler is still reading it,
 * resulting in "Download failed: Unknown error" in the Android download manager.
 */
export const downloadBlob = async (blob, fileName) => {
    if (!blob) return;

    // Primary: Blob URL with 5-minute deferred revocation
    // Android's native download interceptor reads blobs asynchronously,
    // so we must never call revokeObjectURL sooner than it finishes.
    const triggerBlobDownload = () => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        link.setAttribute("download", fileName);
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        // Revoke after 5 minutes — safe for any network speed / device lag
        setTimeout(() => {
            try { document.body.removeChild(link); } catch (e) {}
            try { URL.revokeObjectURL(url); } catch (e) {}
        }, 5 * 60 * 1000);
    };

    // Fallback: Base64 Data URL (no blob: URL involved at all)
    const triggerDataUrlDownload = () => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                try {
                    const dataUrl = reader.result;
                    const link = document.createElement("a");
                    link.href = dataUrl;
                    link.download = fileName;
                    link.setAttribute("download", fileName);
                    link.style.display = "none";
                    document.body.appendChild(link);
                    link.click();
                    setTimeout(() => {
                        try { document.body.removeChild(link); } catch (e) {}
                        resolve();
                    }, 1000);
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = (e) => reject(e);
            reader.readAsDataURL(blob);
        });
    };

    try {
        triggerBlobDownload();
    } catch (e) {
        try {
            await triggerDataUrlDownload();
        } catch (e2) {
            console.error("downloadBlob: all strategies failed", e2);
            throw e2;
        }
    }
};

/**
 * Exports data to a CSV file and triggers a mobile-safe download.
 * @param {Array} data - Array of objects to export.
 * @param {string} fileName - Name of the file (without extension).
 * @param {Object} headersMap - Optional mapping of keys to header labels (e.g., { id: "Transaction ID" }).
 */
export const exportToCSV = async (data, fileName, headersMap = null) => {
    if (!data || !data.length) return;

    // 1. Prepare Headers
    const keys = Object.keys(data[0]);
    const headers = headersMap
        ? keys.map(key => headersMap[key] || key)
        : keys;

    // 2. Convert Data to Rows
    const csvContent = [
        headers.join(','), // Header row
        ...data.map(item =>
            keys.map(key => {
                let cell = item[key] === null || item[key] === undefined ? "" : item[key];
                // Handle strings with commas by wrapping in quotes
                cell = typeof cell === 'string' ? `"${cell.replace(/"/g, '""')}"` : cell;
                return cell;
            }).join(',')
        )
    ].join('\n');

    // 3. Trigger Download (Add BOM for Excel UTF-8 support)
    const BOM = "\uFEFF";
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const fullFileName = `${fileName}_${new Date().toISOString().split('T')[0]}.csv`;
    await downloadBlob(blob, fullFileName);
};
