/**
 * Seed helpers for API E2E suites. Each returns plain lean documents.
 */
import Admin from "../../../app/models/admin.js";
import Customer from "../../../app/models/customer.js";
import Seller from "../../../app/models/seller.js";
import Delivery from "../../../app/models/delivery.js";
import Category from "../../../app/models/category.js";
import Product from "../../../app/models/product.js";

// Indore city centre.
export const STORE_LOCATION = { lat: 22.7196, lng: 75.8577 };

let counter = 0;
const uniq = () => `${Date.now()}${(counter += 1)}`;

export async function ensureIndexes() {
  await Promise.all([Seller.init(), Delivery.init(), Product.init(), Customer.init(), Category.init()]);
}

export async function createAdmin(overrides = {}) {
  const password = overrides.password || "Str0ngPassword1";
  const admin = await Admin.create({
    name: "Root Admin",
    email: `admin${uniq()}@test.com`,
    password,
    ...overrides,
  });
  return { ...admin.toObject(), plainPassword: password };
}

export async function createCustomer(overrides = {}) {
  const customer = await Customer.create({
    name: "Test Customer",
    phone: `9${uniq().slice(-9)}`,
    ...overrides,
  });
  return customer.toObject();
}

export async function createSeller(overrides = {}) {
  const password = overrides.password || "SellerPass123";
  const seller = await Seller.create({
    name: "Test Seller",
    email: `seller${uniq()}@test.com`,
    phone: `8${uniq().slice(-9)}`,
    password,
    shopName: "Test Mart",
    isVerified: true,
    isActive: true,
    applicationStatus: "approved",
    serviceRadius: 10,
    location: { type: "Point", coordinates: [STORE_LOCATION.lng, STORE_LOCATION.lat] },
    ...overrides,
  });
  return { ...seller.toObject(), plainPassword: password };
}

export async function createDelivery(overrides = {}) {
  const delivery = await Delivery.create({
    name: "Test Rider",
    phone: `7${uniq().slice(-9)}`,
    isVerified: true,
    ...overrides,
  });
  return delivery.toObject();
}

export async function createCategoryTree() {
  const s = uniq();
  const header = await Category.create({ name: `Grocery ${s}`, slug: `grocery-${s}`, type: "header" });
  const category = await Category.create({
    name: `Dairy ${s}`,
    slug: `dairy-${s}`,
    type: "category",
    parentId: header._id,
  });
  const subcategory = await Category.create({
    name: `Milk ${s}`,
    slug: `milk-${s}`,
    type: "subcategory",
    parentId: category._id,
  });
  return { header: header.toObject(), category: category.toObject(), subcategory: subcategory.toObject() };
}

export async function createProduct(seller, tree, overrides = {}) {
  const s = uniq();
  const product = await Product.create({
    name: `Fresh Milk ${s}`,
    slug: `fresh-milk-${s}`,
    sku: `SKU-${s}`,
    price: 60,
    salePrice: 55,
    stock: 50,
    mainImage: "https://res.cloudinary.com/demo/image/upload/milk.jpg",
    headerId: tree.header._id,
    categoryId: tree.category._id,
    subcategoryId: tree.subcategory._id,
    sellerId: seller._id,
    status: "active",
    approvalStatus: "approved",
    ...overrides,
  });
  return product.toObject();
}
