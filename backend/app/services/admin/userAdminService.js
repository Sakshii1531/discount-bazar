import mongoose from "mongoose";
import User from "../../models/customer.js";
import Order from "../../models/order.js";
import { normalizePhoneNumber } from "../../utils/phone.js";

export async function getUsersData({ page, limit, skip }) {
  const pipeline = [
    { $match: { role: "user" } },
    {
      $lookup: {
        from: "orders",
        localField: "_id",
        foreignField: "customer",
        as: "userOrders",
      },
    },
    {
      $project: {
        id: { $toString: "$_id" },
        name: { $ifNull: ["$name", "Unnamed Customer"] },
        email: 1,
        phone: 1,
        joinedDate: "$createdAt",
        status: {
          $cond: [{ $eq: ["$isActive", false] }, "inactive", "active"],
        },
        totalOrders: { $size: "$userOrders" },
        totalSpent: { $sum: "$userOrders.pricing.total" },
        lastOrderDate: { $max: "$userOrders.createdAt" },
        avatar: {
          $concat: [
            "https://api.dicebear.com/7.x/avataaars/svg?seed=",
            { $ifNull: ["$name", "Customer"] },
          ],
        },
      },
    },
    { $sort: { totalOrders: -1 } },
  ];

  const [result] = await User.aggregate([
    ...pipeline,
    {
      $facet: {
        totalCount: [{ $count: "count" }],
        items: [{ $skip: skip }, { $limit: limit }],
      },
    },
  ]);

  const total = result?.totalCount?.[0]?.count ?? 0;
  const items = result?.items ?? [];

  return {
    items,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
  };
}

export async function getUserByIdData(id) {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId(id),
        role: "user",
      },
    },
    {
      $lookup: {
        from: "orders",
        localField: "_id",
        foreignField: "customer",
        as: "userOrders",
      },
    },
    {
      $project: {
        id: { $toString: "$_id" },
        name: { $ifNull: ["$name", "Unnamed Customer"] },
        email: 1,
        phone: 1,
        joinedDate: "$createdAt",
        status: {
          $cond: [{ $eq: ["$isActive", false] }, "inactive", "active"],
        },
        totalOrders: { $size: "$userOrders" },
        totalSpent: { $sum: "$userOrders.pricing.total" },
        lastOrderDate: { $max: "$userOrders.createdAt" },
        avatar: {
          $concat: [
            "https://api.dicebear.com/7.x/avataaars/svg?seed=",
            { $ifNull: ["$name", "Customer"] },
          ],
        },
        addresses: { $ifNull: ["$addresses", []] },
      },
    },
  ]);

  if (!user || user.length === 0) {
    return null;
  }

  const recentOrders = await Order.find({ customer: id })
    .sort({ createdAt: -1 })
    .limit(10)
    .populate("items.product", "name mainImage");

  const selectedUser = user[0];
  const addresses = Array.isArray(selectedUser.addresses)
    ? selectedUser.addresses
    : [];

  return {
    ...selectedUser,
    addresses,
    recentOrders: recentOrders.map((order) => ({
      id: order.orderId,
      _id: order._id,
      itemsCount: order.items.length,
      amount: order.pricing.total,
      date: order.createdAt,
      status: order.status,
    })),
  };
}

export async function createUserData({ name, email, phone, status }) {
  const cleanPhone = phone?.trim();
  if (!cleanPhone) {
    throw new Error("Phone number is required");
  }

  const normalizedPhone = normalizePhoneNumber(cleanPhone);
  const existingPhone = await User.findOne({
    $or: [
      { phone: normalizedPhone },
      { phone: cleanPhone },
    ],
  });
  if (existingPhone) {
    throw new Error("Customer with this phone number already exists");
  }

  if (email?.trim()) {
    const existingEmail = await User.findOne({ email: email.trim().toLowerCase() });
    if (existingEmail) {
      throw new Error("Customer with this email already exists");
    }
  }

  const trimmedName = name?.trim() || "";
  const customerName = trimmedName ? trimmedName.replace(/\b\w/g, (c) => c.toUpperCase()) : "Customer";
  const user = await User.create({
    name: customerName,
    email: email?.trim() ? email.trim().toLowerCase() : undefined,
    phone: normalizedPhone || cleanPhone,
    role: "user",
    isActive: status === "inactive" ? false : true,
    avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(customerName)}`,
  });

  return {
    id: user._id.toString(),
    _id: user._id,
    name: user.name,
    email: user.email || "",
    phone: user.phone,
    joinedDate: user.createdAt,
    status: user.isActive ? "active" : "inactive",
    totalOrders: 0,
    totalSpent: 0,
    lastOrderDate: null,
    avatar: user.avatar,
  };
}
