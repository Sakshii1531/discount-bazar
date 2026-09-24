import React, { useEffect } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import DashboardLayout from "@shared/layout/DashboardLayout";
import { setActiveRole, ROLES } from "@core/auth/activeRoleStore";
import Orders from "../pages/Orders";
import SellerScrollToTop from "../components/SellerScrollToTop";
import {
  HiOutlineSquares2X2,
  HiOutlineCube,
  HiOutlineCurrencyDollar,
  HiOutlineUser,
  HiOutlineTruck,
  HiOutlineArchiveBox,
  HiOutlineChartBarSquare,
  HiOutlineCreditCard,
  HiOutlineMapPin,
  HiOutlineCalculator,
  HiOutlineBookOpen,
} from "react-icons/hi2";

const Dashboard = React.lazy(() => import("../pages/Dashboard"));
const PosTerminal = React.lazy(() => import("../pages/PosTerminal"));
const Business = React.lazy(() => import("../pages/Business"));
const ProductManagement = React.lazy(
  () => import("../pages/ProductManagement"),
);
const StockManagement = React.lazy(() => import("../pages/StockManagement"));
const AddProduct = React.lazy(() => import("../pages/AddProduct"));
// Note: Orders is imported eagerly above to avoid dynamic import issues
const Returns = React.lazy(() => import("../pages/Returns"));
const Earnings = React.lazy(() => import("../pages/Earnings"));
const Analytics = React.lazy(() => import("../pages/Analytics"));
const Transactions = React.lazy(() => import("../pages/Transactions"));
const DeliveryTracking = React.lazy(() => import("../pages/DeliveryTracking"));
const Profile = React.lazy(() => import("../pages/Profile"));
const Withdrawals = React.lazy(() => import("../pages/Withdrawals"));

const navItems = [
  { label: "Dashboard", path: "/seller", icon: HiOutlineSquares2X2, end: true },
  {
    label: "POS",
    path: "/seller/pos",
    icon: HiOutlineCalculator,
    children: [
      { label: "New Sale", path: "/seller/pos", end: true },
      { label: "Sales History", path: "/seller/pos/sales" },
      { label: "Online Orders", path: "/seller/pos/online-orders" },
      { label: "Returns", path: "/seller/pos/returns" },
    ],
  },
  {
    label: "Business",
    path: "/seller/business",
    icon: HiOutlineBookOpen,
    children: [
      { label: "Dashboard", path: "/seller/business", end: true },
      { label: "Purchases", path: "/seller/business/purchases" },
      { label: "Ledgers", path: "/seller/business/ledgers" },
      { label: "Day Book & Cash", path: "/seller/business/cash" },
      { label: "Reports", path: "/seller/business/reports" },
    ],
  },
  { label: "Products", path: "/seller/products", icon: HiOutlineCube },
  { label: "Stock", path: "/seller/inventory", icon: HiOutlineArchiveBox },
  { label: "Orders", path: "/seller/orders", icon: HiOutlineTruck },
  { label: "Returns", path: "/seller/returns", icon: HiOutlineArchiveBox },
  { label: "Track Orders", path: "/seller/tracking", icon: HiOutlineMapPin },
  {
    label: "Sales Reports",
    path: "/seller/analytics",
    icon: HiOutlineChartBarSquare,
  },
  {
    label: "Money Request",
    path: "/seller/withdrawals",
    icon: HiOutlineCurrencyDollar,
  },
  {
    label: "Payment History",
    path: "/seller/transactions",
    icon: HiOutlineCreditCard,
  },
  {
    label: "Earnings",
    path: "/seller/earnings",
    icon: HiOutlineCurrencyDollar,
  },
  { label: "Profile", path: "/seller/profile", icon: HiOutlineUser },
];

const SellerRoutes = () => {
  useEffect(() => {
    setActiveRole(ROLES.SELLER);
  }, []);

  return (
    <>
      <SellerScrollToTop />
      <DashboardLayout navItems={navItems} title="Seller Panel">
        <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pos/:section?" element={<PosTerminal />} />
        <Route path="/business" element={<Business />} />
        <Route path="/business/:section" element={<Business />} />
        <Route path="/products" element={<ProductManagement />} />
        <Route path="/products/add" element={<AddProduct />} />
        <Route path="/inventory" element={<StockManagement />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/returns" element={<Returns />} />
        <Route path="/tracking" element={<DeliveryTracking />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/earnings" element={<Earnings />} />
        <Route path="/withdrawals" element={<Withdrawals />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </DashboardLayout>
    </>
  );
};

export default SellerRoutes;
