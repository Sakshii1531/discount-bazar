/**
 * deliveryRegistrationStorage.js
 *
 * Persists uploaded registration documents and photos across page reloads
 * using IndexedDB (avoiding localStorage/sessionStorage 5MB quota restrictions for binary blobs).
 */

const DB_NAME = "zetbasket_delivery_registration_db";
const DB_VERSION = 1;
const STORE_NAME = "registration_files";

function openRegistrationDB() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !window.indexedDB) {
      return reject(new Error("IndexedDB not available"));
    }
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open IndexedDB"));
  });
}

/**
 * Save an uploaded File/Blob to IndexedDB for delivery registration
 * @param {'profileImage' | 'aadhar' | 'pan' | 'dl'} key
 * @param {File | Blob} file
 */
export async function saveRegistrationFile(key, file) {
  if (!file) {
    return removeRegistrationFile(key);
  }
  try {
    const db = await openRegistrationDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);

      // Extract a clean Blob to avoid serialization errors in various browser WebViews
      const blob = file instanceof Blob ? file.slice(0, file.size, file.type) : new Blob([file], { type: file.type });
      const record = {
        id: key,
        blob,
        name: file.name || `${key}.jpg`,
        type: file.type || "image/jpeg",
        lastModified: file.lastModified || Date.now(),
      };

      const req = store.put(record);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[deliveryRegistrationStorage] Failed to save ${key}:`, err);
    return false;
  }
}

/**
 * Retrieve a saved registration File by key from IndexedDB
 * @param {'profileImage' | 'aadhar' | 'pan' | 'dl'} key
 * @returns {Promise<File | null>}
 */
export async function getRegistrationFile(key) {
  try {
    const db = await openRegistrationDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        const record = req.result;
        if (!record || !record.blob) {
          return resolve(null);
        }
        try {
          const reconstructedFile = new File([record.blob], record.name, {
            type: record.type || "image/jpeg",
            lastModified: record.lastModified || Date.now(),
          });
          resolve(reconstructedFile);
        } catch {
          const fallbackBlob = record.blob;
          fallbackBlob.name = record.name;
          resolve(fallbackBlob);
        }
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[deliveryRegistrationStorage] Failed to get ${key}:`, err);
    return null;
  }
}

/**
 * Remove a single registration file by key
 * @param {'profileImage' | 'aadhar' | 'pan' | 'dl'} key
 */
export async function removeRegistrationFile(key) {
  try {
    const db = await openRegistrationDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn(`[deliveryRegistrationStorage] Failed to remove ${key}:`, err);
    return false;
  }
}

/**
 * Load all registration files at once
 * @returns {Promise<{ profileImage: File|null, aadhar: File|null, pan: File|null, dl: File|null }>}
 */
export async function loadAllRegistrationFiles() {
  try {
    const [profileImage, aadhar, pan, dl] = await Promise.all([
      getRegistrationFile("profileImage"),
      getRegistrationFile("aadhar"),
      getRegistrationFile("pan"),
      getRegistrationFile("dl"),
    ]);
    return { profileImage, aadhar, pan, dl };
  } catch (err) {
    console.warn("[deliveryRegistrationStorage] Failed to load files:", err);
    return { profileImage: null, aadhar: null, pan: null, dl: null };
  }
}

/**
 * Clear all registration files upon successful registration/approval
 */
export async function clearAllRegistrationFiles() {
  try {
    const db = await openRegistrationDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("[deliveryRegistrationStorage] Failed to clear files:", err);
    return false;
  }
}
