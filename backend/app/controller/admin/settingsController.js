import Setting from "../../models/setting.js";
import handleResponse from "../../utils/helper.js";
import { normalizeProductApprovalConfig } from "../../services/productModerationService.js";
import { invalidate } from "../../services/cacheService.js";

function flattenForMongoSet(prefix, value, target) {
  if (value === undefined) return;

  const isPlainObject =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    !(value instanceof Date);

  if (!isPlainObject) {
    target[prefix] = value;
    return;
  }

  const keys = Object.keys(value);
  if (!keys.length) {
    target[prefix] = value;
    return;
  }

  for (const key of keys) {
    flattenForMongoSet(`${prefix}.${key}`, value[key], target);
  }
}

export const getPlatformSettings = async (req, res) => {
  try {
    let settings = await Setting.findOne({});

    if (!settings) {
      settings = await Setting.create({});
    }

    const result = settings?.toObject?.() || settings || {};
    result.productApproval = normalizeProductApprovalConfig(result);

    return handleResponse(
      res,
      200,
      "Platform settings fetched successfully",
      result,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};

export const updatePlatformSettings = async (req, res) => {
  try {
    const payload = req.body || {};
    for (const key of ["codEnabled", "onlineEnabled"]) {
      if (payload[key] !== undefined && typeof payload[key] !== "boolean") {
        return handleResponse(res, 400, key + " must be true or false");
      }
    }
    if (payload.codEnabled === false || payload.onlineEnabled === false) {
      const current = (await Setting.findOne({}).select("codEnabled onlineEnabled").lean()) || {};
      const codOn = payload.codEnabled ?? current.codEnabled ?? true;
      const onlineOn = payload.onlineEnabled ?? current.onlineEnabled ?? true;
      if (codOn === false && onlineOn === false) {
        return handleResponse(res, 400, "Keep at least one payment method (Online or Cash on Delivery) enabled");
      }
    }
    const toSet = {};
    for (const [key, value] of Object.entries(payload)) {
      flattenForMongoSet(key, value, toSet);
    }

    const settings = await Setting.findOneAndUpdate(
      {},
      { $set: toSet },
      { new: true, upsert: true },
    );
    // Storefront reads cached /settings; refresh it so changes show at once.
    await invalidate("cache:platform:settings:*").catch(() => {});

    const result = settings?.toObject?.() || settings || {};
    result.productApproval = normalizeProductApprovalConfig(result);

    return handleResponse(
      res,
      200,
      "Platform settings updated successfully",
      result,
    );
  } catch (error) {
    return handleResponse(res, 500, error.message);
  }
};
