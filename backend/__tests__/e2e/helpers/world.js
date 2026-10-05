/**
 * Seeds a realistic marketplace for the API matrix suites: an admin, an
 * approved seller with products, a pending seller, verified and pending
 * riders, two customers (one with a saved address), and a category tree.
 */
import * as fx from "./fixtures.js";
import { bearer } from "./testApp.js";
import Customer from "../../../app/models/customer.js";

export async function seedWorld() {
  await fx.ensureIndexes();
  const admin = await fx.createAdmin({ name: "Root Admin" });
  const seller = await fx.createSeller({ name: "Main Seller", shopName: "Main Mart" });
  const otherSeller = await fx.createSeller({ name: "Other Seller", shopName: "Other Mart" });
  const pendingSeller = await fx.createSeller({
    name: "Pending Seller",
    shopName: "Pending Kirana",
    isVerified: false,
    applicationStatus: "pending",
  });
  const rider = await fx.createDelivery({
    name: "Main Rider",
    isOnline: true,
    location: { type: "Point", coordinates: [fx.STORE_LOCATION.lng, fx.STORE_LOCATION.lat] },
  });
  const pendingRider = await fx.createDelivery({ name: "Pending Rider", isVerified: false });
  const customer = await fx.createCustomer({ name: "Main Customer", isVerified: true });
  await Customer.updateOne(
    { _id: customer._id },
    {
      $set: {
        addresses: [
          {
            label: "home",
            fullAddress: "12 MG Road, Indore",
            city: "Indore",
            state: "Madhya Pradesh",
            pincode: "452001",
            location: { lat: fx.STORE_LOCATION.lat, lng: fx.STORE_LOCATION.lng },
          },
        ],
      },
    },
  );
  const otherCustomer = await fx.createCustomer({ name: "Other Customer", isVerified: true });
  const tree = await fx.createCategoryTree();
  const milk = await fx.createProduct(seller, tree, { name: "Fresh Milk", price: 60, salePrice: 55, stock: 100 });
  const bread = await fx.createProduct(seller, tree, { name: "Brown Bread", price: 50, salePrice: 45, stock: 100 });
  const otherProduct = await fx.createProduct(otherSeller, tree, { name: "Other Rice", price: 120, salePrice: 99 });

  return {
    admin,
    seller,
    otherSeller,
    pendingSeller,
    rider,
    pendingRider,
    customer,
    otherCustomer,
    tree,
    milk,
    bread,
    otherProduct,
    location: fx.STORE_LOCATION,
    auth: {
      admin: bearer("admin", admin._id),
      seller: bearer("seller", seller._id),
      otherSeller: bearer("seller", otherSeller._id),
      pendingSeller: bearer("seller", pendingSeller._id),
      delivery: bearer("delivery", rider._id),
      pendingDelivery: bearer("delivery", pendingRider._id),
      customer: bearer("customer", customer._id),
      otherCustomer: bearer("customer", otherCustomer._id),
    },
  };
}

/** Standard "list" response check: success + array in result.items or results. */
export function listOf(res) {
  const r = res.body.result;
  if (Array.isArray(res.body.results)) return res.body.results;
  if (Array.isArray(r)) return r;
  if (r && Array.isArray(r.items)) return r.items;
  throw new Error(`expected a list response, got ${JSON.stringify(res.body).slice(0, 300)}`);
}
