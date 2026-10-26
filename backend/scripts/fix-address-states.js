/**
 * One-time fix for saved customer addresses that carry the wrong state.
 *
 * Older saves could store a state that did not belong to the address (e.g. one
 * picked up from "detect location" or the old hardcoded Indore default), and the
 * address was then geocoded with that state in the query, so its coordinates can
 * be off as well. Each address is geocoded again from its own text, city and
 * pincode (no stored state); where the state differs, the state, coordinates and
 * place details are replaced.
 *
 * Usage:
 *   node scripts/fix-address-states.js           # dry run: list what would change
 *   node scripts/fix-address-states.js --apply   # write the fixes
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../app/models/customer.js";
import { geocodeAddress } from "../app/services/mapsGeocodeService.js";

dotenv.config();

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || "mongodb://localhost:27017/turbocart";
const APPLY = process.argv.includes("--apply");

const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected. Mode: ${APPLY ? "APPLY" : "DRY RUN (pass --apply to write)"}`);

  const users = User.find({ "addresses.0": { $exists: true } }).select("name phone addresses").lean().cursor();
  let checked = 0;
  let wrong = 0;
  let fixed = 0;
  let failed = 0;

  for await (const user of users) {
    for (const addr of user.addresses || []) {
      checked += 1;
      const query = [addr.fullAddress, addr.landmark, addr.city, addr.pincode].filter(Boolean).join(", ");
      let geo;
      try {
        geo = await geocodeAddress(query);
      } catch (e) {
        failed += 1;
        console.warn(`  ! ${user._id} "${query}": ${e.message}`);
        continue;
      }
      if (!geo.state || same(geo.state, addr.state)) continue;

      wrong += 1;
      console.log(`  ${user.name || user.phone || user._id}: "${query}"  ${addr.state || "(none)"} -> ${geo.state}`);
      if (!APPLY) continue;

      // Positional update of just this address, so concurrent edits to others are kept.
      const res = await User.updateOne(
        { _id: user._id, "addresses._id": addr._id },
        {
          $set: {
            "addresses.$.state": geo.state,
            "addresses.$.location": { lat: geo.lat, lng: geo.lng },
            ...(geo.placeId ? { "addresses.$.placeId": geo.placeId } : {}),
            ...(geo.formattedAddress ? { "addresses.$.formattedAddress": geo.formattedAddress } : {}),
            ...(!addr.pincode && geo.pincode ? { "addresses.$.pincode": geo.pincode } : {}),
          },
        },
      );
      fixed += res.modifiedCount;
    }
  }

  console.log(`Checked ${checked} addresses: ${wrong} with a wrong state, ${fixed} fixed, ${failed} could not be geocoded.`);
}

run()
  .then(() => mongoose.disconnect().then(() => process.exit(0)))
  .catch((error) => {
    console.error("Address state fix failed:", error);
    process.exit(1);
  });
