/**
 * Canned API data for Playwright E2E specs. Shapes mirror the real backend
 * responses (`{ success, message, result | results }`).
 */
export const LOCATION = { lat: 22.7196, lng: 75.8577 };

export const IDS = {
  customer: '64b7f0c2a1b2c3d4e5f60001',
  seller: '64b7f0c2a1b2c3d4e5f60002',
  admin: '64b7f0c2a1b2c3d4e5f60003',
  delivery: '64b7f0c2a1b2c3d4e5f60004',
  header: '64b7f0c2a1b2c3d4e5f60010',
  category: '64b7f0c2a1b2c3d4e5f60011',
  subcategory: '64b7f0c2a1b2c3d4e5f60012',
  milk: '64b7f0c2a1b2c3d4e5f60020',
  bread: '64b7f0c2a1b2c3d4e5f60021',
  rice: '64b7f0c2a1b2c3d4e5f60022',
  order: 'ORD-E2E-1001',
  ticket: '64b7f0c2a1b2c3d4e5f60030',
};

const IMG = 'https://res.cloudinary.com/demo/image/upload/sample.jpg';

export const settings = {
  appName: 'Discount Bazar',
  supportEmail: 'support@discountbazar.in',
  supportPhone: '+919999999999',
  currencySymbol: '₹',
  currencyCode: 'INR',
  timezone: 'Asia/Kolkata',
  primaryColor: '#0ea5e9',
  secondaryColor: '#64748b',
  codEnabled: true,
  onlineEnabled: true,
};

export const categories = [
  {
    _id: IDS.header,
    name: 'Grocery',
    slug: 'grocery',
    type: 'header',
    status: 'active',
    image: IMG,
  },
  {
    _id: IDS.category,
    name: 'Dairy & Breads',
    slug: 'dairy-breads',
    type: 'category',
    status: 'active',
    parentId: IDS.header,
    image: IMG,
  },
  {
    _id: IDS.subcategory,
    name: 'Milk',
    slug: 'milk',
    type: 'subcategory',
    status: 'active',
    parentId: IDS.category,
    image: IMG,
  },
];

export const categoryTree = [
  {
    ...categories[0],
    children: [{ ...categories[1], children: [{ ...categories[2], children: [] }] }],
  },
];

const product = (id, name, price, salePrice, stock = 50) => ({
  _id: id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, '-'),
  description: `${name} — fresh and delivered fast.`,
  price,
  salePrice,
  stock,
  weight: '1 unit',
  brand: 'E2E Farms',
  mainImage: IMG,
  galleryImages: [],
  headerId: IDS.header,
  categoryId: IDS.category,
  subcategoryId: IDS.subcategory,
  sellerId: IDS.seller,
  sellerName: 'E2E Mart',
  status: 'active',
  approvalStatus: 'approved',
  variants: [],
  returnPolicy: { isReturnable: false, returnWindowDays: 0, returnReasons: [] },
});

export const products = [
  product(IDS.milk, 'Fresh Milk', 60, 55),
  product(IDS.bread, 'Brown Bread', 50, 45),
  product(IDS.rice, 'Basmati Rice', 120, 99),
];

export const profiles = {
  customer: {
    _id: IDS.customer,
    name: 'E2E Customer',
    phone: '+919876543210',
    email: 'customer@e2e.test',
    role: 'user',
    isVerified: true,
    isActive: true,
    walletBalance: 250,
    createdAt: '2026-09-01T10:00:00.000Z',
    joinedDate: '2026-09-01T10:00:00.000Z',
    addresses: [
      {
        _id: 'addr1',
        label: 'Home',
        name: 'E2E Customer',
        phone: '9876543210',
        address: '12 MG Road, Indore',
        city: 'Indore',
        state: 'Madhya Pradesh',
        pincode: '452001',
        location: { type: 'Point', coordinates: [LOCATION.lng, LOCATION.lat] },
        isDefault: true,
      },
    ],
  },
  seller: {
    _id: IDS.seller,
    name: 'E2E Seller',
    email: 'seller@e2e.test',
    phone: '9876500000',
    shopName: 'E2E Mart',
    role: 'seller',
    isVerified: true,
    isActive: true,
    applicationStatus: 'approved',
    serviceRadius: 10,
    createdAt: '2026-09-01T10:00:00.000Z',
    location: { type: 'Point', coordinates: [LOCATION.lng, LOCATION.lat] },
  },
  admin: {
    _id: IDS.admin,
    name: 'E2E Admin',
    email: 'admin@e2e.test',
    role: 'admin',
    isVerified: true,
  },
  delivery: {
    _id: IDS.delivery,
    name: 'E2E Rider',
    phone: '9876511111',
    role: 'delivery',
    isVerified: true,
    isOnline: false,
    createdAt: '2026-09-01T10:00:00.000Z',
    vehicleType: 'bike',
    vehicleNumber: 'MP09AB1234',
    location: { type: 'Point', coordinates: [LOCATION.lng, LOCATION.lat] },
    ratingDistribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
  },
};

export const order = {
  _id: '64b7f0c2a1b2c3d4e5f60040',
  orderId: IDS.order,
  status: 'pending',
  workflowStatus: 'SELLER_PENDING',
  workflowVersion: 2,
  customer: { _id: IDS.customer, name: 'E2E Customer', phone: '+919876543210' },
  seller: { _id: IDS.seller, shopName: 'E2E Mart' },
  items: [
    {
      product: IDS.milk,
      productId: IDS.milk,
      name: 'Fresh Milk',
      quantity: 2,
      price: 55,
      image: IMG,
    },
  ],
  address: profiles.customer.addresses[0],
  pricing: { subtotal: 110, deliveryFee: 20, total: 130 },
  payment: { method: 'cod', status: 'pending' },
  paymentMode: 'COD',
  createdAt: '2026-10-01T10:00:00.000Z',
};

export const paged = (items, extra = {}) => ({
  items,
  page: 1,
  limit: 20,
  total: items.length,
  totalPages: 1,
  ...extra,
});
