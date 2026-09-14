export const handleResponse = (res, statusCode, message, data = {}) => {
  const success = statusCode >= 200 && statusCode < 300;

  const sanitize = (item) => {
    if (!item) return item;

    let obj = item;
    if (typeof item.toObject === 'function') {
      obj = item.toObject();
    }

    if (obj instanceof Date || obj instanceof RegExp || Buffer.isBuffer(obj)) {
      return obj;
    }

    if (typeof obj?.toHexString === 'function' || obj?.constructor?.name === 'ObjectId') {
      return obj.toString();
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }

    if (typeof obj === 'object') {
      const cleaned = {};
      for (const [key, val] of Object.entries(obj)) {
        if (key === 'updatedAt' || key === '__v' || key === 'password') {
          continue;
        }
        cleaned[key] = sanitize(val);
      }
      return cleaned;
    }

    return obj;
  };

  const sanitizedData = sanitize(data);

  const responsePayload = {
    success,
    error: !success,
    message,
  };

  if (Array.isArray(sanitizedData)) {
    responsePayload.results = sanitizedData;
  } else {
    responsePayload.result = sanitizedData;
  }

  return res.status(statusCode).json(responsePayload);
};

export const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the Earth in km
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) *
            Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c;
    return distance; // Distance in km
};

export default handleResponse;