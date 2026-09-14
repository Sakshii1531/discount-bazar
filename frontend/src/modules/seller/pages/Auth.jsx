import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@core/context/AuthContext";
import { useSettings } from "@core/context/SettingsContext";
import { UserRole } from "@core/constants/roles";
import {
  Mail,
  Lock,
  User,
  Phone,
  ArrowRight,
  Store,
  ShoppingBag,
  TrendingUp,
  Rocket,
  Globe,
  MapPin,
  LayoutList,
  FileText,
  Upload,
  CheckCircle,
  Navigation,
  Loader2,
  Eye,
  EyeOff,
} from "lucide-react";
import { toast } from "sonner";
import Lottie from "lottie-react";
import sellerAnimation from "../../../assets/INSTANT_6.json";
import { sellerApi } from "../services/sellerApi";
import MapPicker from "../../../shared/components/MapPicker";

const createInitialVerificationState = () => ({
  status: "idle",
  otp: "",
  token: "",
  isOtpVisible: false,
  isSending: false,
  isVerifying: false,
  verifiedValue: "",
  exists: false,
});

const REQUIRED_DOCUMENT_CONFIG = [
  { id: "tradeLicense", label: "Trade License" },
  { id: "gstCertificate", label: "GST Certificate" },
  { id: "idProof", label: "ID Proof" },
];

const Auth = () => {
  const [isLogin, setIsLogin] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode") === "signup" || params.get("register") === "true") {
      return false;
    }
    const saved = sessionStorage.getItem("seller_auth_is_login");
    if (saved !== null) {
      return saved === "true";
    }
    return true;
  });
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [signupStep, setSignupStep] = useState(() => {
    const saved = sessionStorage.getItem("seller_auth_signup_step");
    return saved ? parseInt(saved, 10) : 1;
  });
  const [isMapOpen, setIsMapOpen] = useState(false);
  const { login, isAuthenticated, role } = useAuth();
  const { settings } = useSettings();
  const navigate = useNavigate();

  React.useEffect(() => {
    import('@core/auth/activeRoleStore').then(({ setActiveRole, ROLES }) => {
        setActiveRole(ROLES.SELLER);
    });
  }, []);

  React.useEffect(() => {
    if (isAuthenticated && role === "seller") {
      navigate("/seller", { replace: true });
    }
  }, [isAuthenticated, role, navigate]);

  const appName = settings?.appName || "App";
  const logoUrl = settings?.logoUrl || "";
  const [verifications, setVerifications] = useState(() => {
    const saved = sessionStorage.getItem("seller_auth_verifications");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          email: { ...createInitialVerificationState(), ...(parsed?.email || {}), isSending: false, isVerifying: false },
          phone: { ...createInitialVerificationState(), ...(parsed?.phone || {}), isSending: false, isVerifying: false },
        };
      } catch (e) {
        // ignore
      }
    }
    return {
      email: createInitialVerificationState(),
      phone: createInitialVerificationState(),
    };
  });
  const [forgotPasswordStep, setForgotPasswordStep] = useState(0);
  const [fieldErrors, setFieldErrors] = useState({});

  const setFieldError = (name, msg) => {
    setFieldErrors((prev) => ({ ...prev, [name]: msg }));
  };

  const clearFieldError = (name) => {
    setFieldErrors((prev) => {
      const copy = { ...prev };
      delete copy[name];
      return copy;
    });
  };

  const [resetData, setResetData] = useState({
    channel: "email",
    rawValue: "",
    otp: "",
    newPassword: "",
    confirmPassword: "",
    token: "",
    isSending: false,
    isVerifying: false,
    isResetting: false,
  });

  const [formData, setFormData] = useState(() => {
    const defaultData = {
      email: "",
      password: "",
      name: "",
      shopName: "",
      phone: "",
      locality: "",
      pincode: "",
      city: "",
      state: "",
      category: "",
      description: "",
      lat: null,
      lng: null,
      radius: 5,
      address: "",
    };
    const saved = sessionStorage.getItem("seller_auth_form_data");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...defaultData,
          ...parsed,
          password: "",
        };
      } catch (e) {
        // ignore
      }
    }
    return defaultData;
  });

  useEffect(() => {
    sessionStorage.setItem("seller_auth_is_login", String(isLogin));
  }, [isLogin]);

  useEffect(() => {
    if (!isLogin) {
      sessionStorage.setItem("seller_auth_signup_step", String(signupStep));
    }
  }, [isLogin, signupStep]);

  useEffect(() => {
    if (!isLogin) {
      const { password, ...safeData } = formData;
      sessionStorage.setItem("seller_auth_form_data", JSON.stringify(safeData));
    }
  }, [isLogin, formData]);

  useEffect(() => {
    if (!isLogin) {
      sessionStorage.setItem("seller_auth_verifications", JSON.stringify(verifications));
    }
  }, [isLogin, verifications]);

  useEffect(() => {
    if (isAuthenticated && role === "seller") return;
    // Synchronize browser history so hardware/phone back button opens previous page or login page instead of exiting
    if (!isLogin) {
      window.history.replaceState(
        { sellerAuth: true, isLogin: true, signupStep: 1, isMapOpen: false, forgotStep: 0 },
        ""
      );
      for (let s = 1; s <= signupStep; s++) {
        window.history.pushState(
          { sellerAuth: true, isLogin: false, signupStep: s, isMapOpen: false, forgotStep: 0 },
          ""
        );
      }
    } else {
      window.history.replaceState(
        { sellerAuth: true, isLogin: true, signupStep: 1, isMapOpen: false, forgotStep: 0 },
        ""
      );
    }
  }, [isAuthenticated, role]);

  useEffect(() => {
    const handlePopState = (event) => {
      const state = event.state;
      if (state && state.sellerAuth) {
        setIsLogin(Boolean(state.isLogin));
        setSignupStep(state.signupStep || 1);
        setIsMapOpen(Boolean(state.isMapOpen));
        setForgotPasswordStep(state.forgotStep || 0);
      } else {
        // Popped past sellerAuth states while on signup
        if (!isLogin) {
          setIsLogin(true);
          setSignupStep(1);
          setIsMapOpen(false);
          setForgotPasswordStep(0);
        }
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isLogin]);

  const handleLocationSelect = (location) => {
    setFormData((prev) => ({
      ...prev,
      lat: location.lat,
      lng: location.lng,
      radius: location.radius,
      address: location.address || prev.address,
      locality: location.locality || prev.locality,
      pincode: location.pincode || prev.pincode,
      city: location.city || prev.city,
      state: location.state || prev.state,
    }));
    setFieldErrors((prev) => ({
      ...prev,
      address: "",
      locality: "",
      pincode: "",
      city: "",
      state: "",
    }));
    if (window.history.state?.isMapOpen) {
      window.history.back();
    } else {
      setIsMapOpen(false);
    }
  };

  const [documents, setDocuments] = useState({
    tradeLicense: null,
    gstCertificate: null,
    idProof: null,
  });

  const getMissingRequiredDocuments = () =>
    REQUIRED_DOCUMENT_CONFIG.filter((doc) => !documents[doc.id]);

  const updateVerificationState = (field, updates) => {
    setVerifications((prev) => ({
      ...prev,
      [field]: {
        ...prev[field],
        ...updates,
      },
    }));
  };

  const resetVerificationState = (field) => {
    setVerifications((prev) => ({
      ...prev,
      [field]: createInitialVerificationState(),
    }));
  };

  const getVerificationPayload = (field) => {
    const channel = field === "email" ? "email" : "phone";
    return channel === "email"
      ? { channel, email: formData.email }
      : { channel, phone: formData.phone };
  };

  const validateField = (name, val) => {
    const value = val !== undefined ? val : formData[name] || "";
    if (name === "name" && !isLogin && signupStep === 1) {
      if (!value.trim()) setFieldError("name", "Owner Name is required");
      else if (value.trim().length < 3) setFieldError("name", "Owner Name must be at least 3 characters");
      else clearFieldError("name");
    } else if (name === "shopName" && !isLogin && signupStep === 1) {
      if (!value.trim()) setFieldError("shopName", "Shop Name is required");
      else if (value.trim().length < 3) setFieldError("shopName", "Shop Name must be at least 3 characters");
      else clearFieldError("shopName");
    } else if (name === "email") {
      if (!value.trim()) setFieldError("email", isLogin ? "Email or Phone is required" : "Business Email is required");
      else if (!isLogin && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) setFieldError("email", "Enter a valid email address");
      else clearFieldError("email");
    } else if (name === "phone" && !isLogin && signupStep === 1) {
      if (!value.trim()) setFieldError("phone", "Contact Number is required");
      else if (!/^[6-9]\d{9}$/.test(value)) setFieldError("phone", "Enter a valid 10-digit mobile number");
      else clearFieldError("phone");
    } else if (name === "password") {
      if (!value) setFieldError("password", "Password is required");
      else if (value.length < 6) setFieldError("password", "Password must be at least 6 characters");
      else clearFieldError("password");
    } else if (name === "locality" && !isLogin && signupStep === 2) {
      if (!value.trim()) setFieldError("locality", "Locality / Area is required");
      else if (value.trim().length < 2) setFieldError("locality", "Locality must be at least 2 characters");
      else clearFieldError("locality");
    } else if (name === "pincode" && !isLogin && signupStep === 2) {
      if (!value.trim()) setFieldError("pincode", "Pincode is required");
      else if (!/^\d{6}$/.test(value)) setFieldError("pincode", "Enter a valid 6-digit pincode");
      else clearFieldError("pincode");
    } else if (name === "city" && !isLogin && signupStep === 2) {
      if (!value.trim()) setFieldError("city", "City is required");
      else clearFieldError("city");
    } else if (name === "state" && !isLogin && signupStep === 2) {
      if (!value.trim()) setFieldError("state", "State is required");
      else clearFieldError("state");
    } else if (name === "address" && !isLogin && signupStep === 2) {
      if (!value.trim()) setFieldError("address", "Full address is required");
      else if (value.trim().length < 10) setFieldError("address", "Full address must be at least 10 characters");
      else clearFieldError("address");
    }
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    let cleanedValue = value;

    if (name === "name") {
      cleanedValue = value.replace(/[^a-zA-Z\s]/g, "").replace(/\b\w/g, (c) => c.toUpperCase());
    } else if (name === "shopName") {
      cleanedValue = value.replace(/\b\w/g, (c) => c.toUpperCase());
    } else if (name === "email") {
      cleanedValue = value.replace(/\s+/g, "").toLowerCase();
      if (cleanedValue !== formData.email) {
        resetVerificationState("email");
      }
    } else if (name === "phone") {
      cleanedValue = value.replace(/[^0-9]/g, "").slice(0, 10);
      if (cleanedValue !== formData.phone) {
        resetVerificationState("phone");
      }
    } else if (name === "city" || name === "state") {
      cleanedValue = value.replace(/[^a-zA-Z\s]/g, "");
    } else if (name === "pincode") {
      cleanedValue = value.replace(/[^0-9]/g, "").slice(0, 6);
    }

    setFormData((prev) => ({ ...prev, [name]: cleanedValue }));
    validateField(name, cleanedValue);
  };

  const handleBlur = async (e) => {
    const { name, value } = e.target;
    validateField(name, value);

    if (isLogin) return;

    if ((name === "email" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) || 
        (name === "phone" && /^[6-9]\d{9}$/.test(value))) {
      try {
        const res = await sellerApi.checkExists({ [name]: value });
        if (res.data?.result?.exists) {
          updateVerificationState(name, { exists: true });
          setFieldError(name, `A seller with this ${name} already exists.`);
          toast.error(`A seller with this ${name} already exists.`);
        } else {
          updateVerificationState(name, { exists: false });
        }
      } catch (err) {
        // ignore errors on blur
      }
    }
  };

  const handleDocumentChange = (e, docName) => {
    setDocuments({ ...documents, [docName]: e.target.files[0] });
  };

  const handleSendVerificationOtp = async (field) => {
    const currentValue = formData[field];
    const isEmailField = field === "email";

    if (isEmailField) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(currentValue || "") || fieldErrors.email) {
        toast.error(fieldErrors.email || "Enter a valid email before requesting OTP.");
        return;
      }
    } else {
      if (!/^[6-9]\d{9}$/.test(currentValue || "") || fieldErrors.phone) {
        toast.error(fieldErrors.phone || "Enter a valid 10-digit mobile number before requesting OTP.");
        return;
      }
    }

    updateVerificationState(field, {
      isSending: true,
      isOtpVisible: true,
      otp: "",
      token: "",
      status: "sending",
    });

    try {
      await sellerApi.sendVerificationOtp(getVerificationPayload(field));
      updateVerificationState(field, {
        isSending: false,
        isOtpVisible: true,
        status: "otp-sent",
      });
      toast.success(
        isEmailField
          ? "Verification OTP sent to your email."
          : "Verification OTP sent to your phone.",
      );
    } catch (error) {
      updateVerificationState(field, {
        isSending: false,
        isOtpVisible: false,
        status: "idle",
      });
      toast.error(error.response?.data?.message || "Failed to send OTP");
    }
  };

  const handleVerifyOtp = async (field) => {
    if (field === "phone") {
      if (!/^[6-9]\d{9}$/.test(formData.phone || "") || fieldErrors.phone) {
        toast.error(fieldErrors.phone || "Cannot verify an invalid phone number.");
        return;
      }
    } else if (field === "email") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email || "") || fieldErrors.email) {
        toast.error(fieldErrors.email || "Cannot verify an invalid email address.");
        return;
      }
    }

    const verificationState = verifications[field];
    if (!/^\d{4}$/.test(verificationState.otp || "")) {
      toast.error("Enter a valid 4-digit OTP.");
      return;
    }

    updateVerificationState(field, {
      isVerifying: true,
    });

    try {
      const response = await sellerApi.verifyVerificationOtp({
        ...getVerificationPayload(field),
        otp: verificationState.otp,
      });
      const verificationToken =
        response.data?.result?.verificationToken || "";

      updateVerificationState(field, {
        isVerifying: false,
        isOtpVisible: false,
        status: "verified",
        otp: "",
        token: verificationToken,
        verifiedValue: formData[field],
      });
      toast.success(
        field === "email"
          ? "Email verified successfully."
          : "Phone number verified successfully.",
      );
    } catch (error) {
      updateVerificationState(field, {
        isVerifying: false,
      });
      toast.error(error.response?.data?.message || "Failed to verify OTP");
    }
  };

  const handlePanelWheel = (e) => {
    const panel = e.currentTarget;
    if (panel.scrollHeight <= panel.clientHeight) {
      return;
    }

    e.preventDefault();
    panel.scrollTop += e.deltaY;
  };


  // --- Forgot Password Handlers ---
  const handleSendResetOtp = async (e) => {
    e.preventDefault();
    if (!resetData.rawValue) return;
    setResetData(prev => ({ ...prev, isSending: true }));
    try {
      await sellerApi.sendResetOtp({ channel: resetData.channel, rawValue: resetData.rawValue });
      toast.success(`OTP sent to ${resetData.rawValue}`);
      window.history.pushState(
        { sellerAuth: true, isLogin: true, signupStep: 1, isMapOpen: false, forgotStep: 2 },
        ""
      );
      setForgotPasswordStep(2);
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to send OTP");
    } finally {
      setResetData(prev => ({ ...prev, isSending: false }));
    }
  };

  const handleVerifyResetOtp = async (e) => {
    e.preventDefault();
    if (resetData.otp.length !== 4) return;
    setResetData(prev => ({ ...prev, isVerifying: true }));
    try {
      const payload = {
        channel: resetData.channel,
        rawValue: resetData.rawValue,
        otp: resetData.otp
      };
      const response = await sellerApi.verifyResetOtp(payload);
      setResetData(prev => ({ ...prev, token: response.data?.result?.verificationToken || response.data?.result?.token || response.data?.verificationToken }));
      toast.success("OTP verified successfully");
      window.history.pushState(
        { sellerAuth: true, isLogin: true, signupStep: 1, isMapOpen: false, forgotStep: 3 },
        ""
      );
      setForgotPasswordStep(3);
    } catch (error) {
      toast.error(error.response?.data?.message || "Invalid OTP");
    } finally {
      setResetData(prev => ({ ...prev, isVerifying: false }));
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (resetData.newPassword !== resetData.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setResetData(prev => ({ ...prev, isResetting: true }));
    try {
      await sellerApi.resetPassword({
        channel: resetData.channel,
        rawValue: resetData.rawValue,
        token: resetData.token,
        newPassword: resetData.newPassword
      });
      toast.success("Password reset successfully. Please login.");
      window.history.replaceState(
        { sellerAuth: true, isLogin: true, signupStep: 1, isMapOpen: false, forgotStep: 0 },
        ""
      );
      setForgotPasswordStep(0);
      setResetData({ channel: "email", rawValue: "", otp: "", newPassword: "", confirmPassword: "", token: "", isSending: false, isVerifying: false, isResetting: false });
    } catch (error) {
      toast.error(error.response?.data?.message || "Failed to reset password");
    } finally {
      setResetData(prev => ({ ...prev, isResetting: false }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    try {
      // Basic client-side validation for signup
      if (!isLogin) {
        const email = formData.email || "";
        const phone = formData.phone || "";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          toast.error("Please enter a valid business email address.");
          setIsLoading(false);
          return;
        }
        if (!/^[6-9]\d{9}$/.test(phone)) {
          toast.error("Please enter a valid 10-digit mobile number.");
          return;
        }
        if (verifications.email.status !== "verified" || !verifications.email.token) {
          toast.error("Please verify your business email before continuing.");
          return;
        }
        if (verifications.phone.status !== "verified" || !verifications.phone.token) {
          toast.error("Please verify your contact number before continuing.");
          return;
        }
      }
      // Password: min 6 characters
      const pwd = (formData.password || "").trim();
      if (pwd.length < 6) {
        toast.error(
          "Password must be at least 6 characters.",
        );
        return;
      }

      if (!isLogin && signupStep < 3) {
        const nextStep = signupStep + 1;
        window.history.pushState(
          { sellerAuth: true, isLogin: false, signupStep: nextStep, isMapOpen: false, forgotStep: 0 },
          ""
        );
        setSignupStep(nextStep);
        return;
      }

      if (!isLogin) {
        const missingRequiredDocuments = getMissingRequiredDocuments();
        if (missingRequiredDocuments.length > 0) {
          toast.error(
            `Please upload all required documents: ${missingRequiredDocuments
              .map((doc) => doc.label)
              .join(", ")}`,
          );
          return;
        }
      }

      setIsLoading(true);
      // Note: backend expects a single address string, derive from city + state
      const address =
        formData.address ||
        [
          formData.locality,
          formData.city,
          formData.state,
          formData.pincode,
        ]
          .filter(Boolean)
          .join(", ");

      const response = isLogin
        ? await sellerApi.login({
          emailOrPhone: formData.email,
          password: formData.password,
        })
        : await (() => {
          const signupPayload = new FormData();

          Object.entries({
            ...formData,
            address,
            lat: formData.lat,
            lng: formData.lng,
            radius: formData.radius,
            emailVerificationToken: verifications.email.token,
            phoneVerificationToken: verifications.phone.token,
          }).forEach(([key, value]) => {
            if (value !== null && value !== undefined && value !== "") {
              signupPayload.append(key, value);
            }
          });

          Object.entries(documents).forEach(([key, file]) => {
            if (file) {
              signupPayload.append(key, file);
            }
          });

          return sellerApi.signup(signupPayload);
        })();

      if (isLogin) {
        const { token, seller } = response.data.result;
        login({
          ...seller,
          token,
          role: "seller",
        });
        toast.success("Welcome back, Partner!");
        navigate("/seller", { replace: true });
      } else {
        sessionStorage.removeItem("seller_auth_is_login");
        sessionStorage.removeItem("seller_auth_signup_step");
        sessionStorage.removeItem("seller_auth_form_data");
        sessionStorage.removeItem("seller_auth_verifications");
        setIsLogin(true);
        setSignupStep(1);
        setDocuments({
          tradeLicense: null,
          gstCertificate: null,
          idProof: null,
        });
        setVerifications({
          email: createInitialVerificationState(),
          phone: createInitialVerificationState(),
        });
        setFormData({
          email: "",
          password: "",
          name: "",
          shopName: "",
          phone: "",
          locality: "",
          pincode: "",
          city: "",
          state: "",
          category: "",
          description: "",
          lat: null,
          lng: null,
          radius: 5,
          address: "",
        });
        const registeredSeller = response.data?.result?.seller;
        const registeredToken = response.data?.result?.token;
        const sellerId = registeredSeller?._id || registeredSeller?.id;
        if (sellerId) {
          sessionStorage.setItem("pending_seller_id", String(sellerId));
        }
        if (registeredToken) {
          sessionStorage.setItem("pending_seller_token", registeredToken);
        }
        if (registeredSeller && registeredToken) {
          login({
            ...registeredSeller,
            token: registeredToken,
            role: "seller",
          });
        }

        toast.success(
          "Application submitted. Login is enabled only after admin approval.",
        );
        navigate("/seller/pending-approval", {
          replace: true,
          state: {
            approvalRequired: true,
            applicationStatus: "pending",
            sellerId,
            seller: registeredSeller,
            token: registeredToken,
          },
        });
      }
    } catch (error) {
      if (isLogin && error.response?.status === 403) {
        const applicationStatus =
          error.response?.data?.result?.applicationStatus || "pending";
        const rejectionReason =
          error.response?.data?.result?.rejectionReason || "";
        const pendingSellerId = error.response?.data?.result?.sellerId;
        const pendingToken = error.response?.data?.result?.token;
        if (pendingSellerId) {
          sessionStorage.setItem("pending_seller_id", String(pendingSellerId));
        }
        if (pendingToken) {
          sessionStorage.setItem("pending_seller_token", pendingToken);
        }
        navigate("/seller/pending-approval", {
          replace: true,
          state: {
            approvalRequired: true,
            applicationStatus,
            rejectionReason,
            sellerId: pendingSellerId,
            token: pendingToken,
          },
        });
      }
      if (!isLogin && error.response?.status === 409) {
        setIsLogin(true);
      }
      toast.error(error.response?.data?.message || "Authentication failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#fcfaff] py-8 px-4 font-['Outfit'] overflow-y-auto relative">
      {/* Elegant Ambient Background */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-5%] w-[60%] h-[60%] bg-slate-100/50 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-5%] right-[-5%] w-[40%] h-[40%] bg-slate-50/50 rounded-full blur-[100px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        className="relative z-10 w-full max-w-[1000px] my-auto bg-white rounded-2xl shadow-[0_30px_90px_rgba(0,0,0,0.06)] border border-slate-100 flex flex-col md:flex-row overflow-hidden">
        {/* Visual Side Panel */}
        <div className="hidden md:flex w-[45%] bg-linear-to-br from-slate-900 via-slate-950 to-black relative flex-col items-center justify-center p-10 overflow-hidden">
          {/* Abstract Decorative Circles */}
          <div className="absolute inset-0 opacity-20">
            <div className="absolute top-0 left-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
            <div className="absolute bottom-0 right-0 w-96 h-96 bg-slate-500/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2" />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
            className="relative z-10 w-full flex flex-col items-center">
            {/* Lottie Animation for Seller */}
            <div className="w-full max-w-[350px] drop-shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
              <Lottie
                animationData={sellerAnimation}
                loop={true}
                className="w-full h-auto"
              />
            </div>

            <div className="mt-8 text-center space-y-4">
              <h2 className="text-2xl font-black text-white tracking-tight leading-tight uppercase underline decoration-white/20 underline-offset-8">
                Seller <span className="text-slate-600">Expansion.</span>
              </h2>
            </div>
          </motion.div>

          {/* Partner Badges */}
          <div className="absolute bottom-12 left-0 right-0 px-12 flex justify-between items-center opacity-60">
            <div className="flex items-center gap-2 text-white/80">
              <Rocket size={16} />
              <span className="text-[10px] font-black uppercase tracking-widest">
                Growth First
              </span>
            </div>
            <div className="flex items-center gap-2 text-white/80">
              <Globe size={16} />
              <span className="text-[10px] font-black uppercase tracking-widest">
                Pan India
              </span>
            </div>
          </div>
        </div>

        {/* Form Content Side */}
        <div
          className="w-full md:w-[55%] p-6 md:p-10 flex flex-col justify-center bg-white relative">
          <AnimatePresence mode="wait">
            <motion.div
              key={isLogin ? "login" : `signup-step-${signupStep}`}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              className="space-y-8 py-4 md:py-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="inline-block px-4 py-1 bg-slate-100 text-slate-800 rounded-full text-[10px] font-black uppercase tracking-widest border border-slate-200 whitespace-nowrap shrink-0">
                    {isLogin
                      ? "Welcome Back"
                      : `New Partnership - Step ${signupStep} of 3`}
                  </span>
                  <div className="w-16 h-16 rounded-2xl bg-slate-50 border border-slate-200 shadow-sm flex items-center justify-center overflow-hidden shrink-0">
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={`${appName} logo`}
                        className="w-12 h-12 object-contain"
                      />
                    ) : (
                      <Store size={28} className="text-slate-700" />
                    )}
                  </div>
                </div>
                <h1 className="text-3xl font-black text-slate-900 tracking-tighter">
                  Seller{" "}
                  <span className="text-slate-900">
                    {isLogin ? "Login" : "Signup"}
                  </span>
                </h1>
                <p className="text-slate-600 font-medium text-base leading-relaxed">
                  {isLogin
                    ? "Access your unified seller dashboard and manage orders."
                    : signupStep === 1
                      ? "Register your store and start selling instantly."
                      : signupStep === 2
                        ? "Set your shop address and service area precisely."
                        : "Upload verification documents to complete your application."}
                </p>
              </div>

                            {forgotPasswordStep > 0 ? (
                <div className="space-y-4">
                  {forgotPasswordStep === 1 && (
                    <form onSubmit={handleSendResetOtp} className="space-y-4">
                      <div className="relative group">
                        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                          <User size={18} />
                        </div>
                        <input
                          type="text"
                          required
                          placeholder="Email or Phone Number"
                          className="w-full pl-12 pr-6 py-4 bg-slate-50 border-2 border-transparent rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-slate-200 transition-all placeholder:text-slate-300"
                          value={resetData.rawValue}
                          onChange={(e) => {
                            const val = e.target.value;
                            const isPhone = /^\d/.test(val);
                            setResetData({ ...resetData, rawValue: val, channel: isPhone ? 'phone' : 'email' });
                          }}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={resetData.isSending || !resetData.rawValue}
                        className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white p-4 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {resetData.isSending ? <Loader2 className="w-5 h-5 animate-spin" /> : "Send OTP"}
                        <ArrowRight size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.history.state?.forgotStep) {
                            window.history.back();
                          } else {
                            setForgotPasswordStep(0);
                          }
                        }}
                        className="w-full flex items-center justify-center bg-slate-100 text-slate-700 p-4 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-slate-200 transition-colors"
                      >
                        Back to Login
                      </button>
                    </form>
                  )}
                  {forgotPasswordStep === 2 && (
                    <form onSubmit={handleVerifyResetOtp} className="space-y-4">
                      <div className="relative group">
                        <input
                          type="text"
                          required
                          maxLength={4}
                          placeholder="Enter 4-digit OTP"
                          className="w-full px-6 py-4 text-center tracking-[0.5em] bg-slate-50 border-2 border-transparent rounded-lg text-xl font-black text-slate-700 outline-none focus:bg-white focus:border-slate-200 transition-all placeholder:text-slate-300 placeholder:tracking-normal placeholder:font-bold placeholder:text-sm"
                          value={resetData.otp}
                          onChange={(e) => setResetData({ ...resetData, otp: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={resetData.isVerifying || resetData.otp.length !== 4}
                        className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white p-4 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {resetData.isVerifying ? <Loader2 className="w-5 h-5 animate-spin" /> : "Verify OTP"}
                        <ArrowRight size={18} />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (window.history.state?.forgotStep) {
                            window.history.back();
                          } else {
                            setForgotPasswordStep(1);
                          }
                        }}
                        className="w-full flex items-center justify-center bg-slate-100 text-slate-700 p-4 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-slate-200 transition-colors"
                      >
                        Change Contact Info
                      </button>
                    </form>
                  )}
                  {forgotPasswordStep === 3 && (
                    <form onSubmit={handleResetPassword} className="space-y-4">
                      <div className="relative group">
                        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                          <Lock size={18} />
                        </div>
                        <input
                          type={showPassword ? "text" : "password"}
                          required
                          placeholder="New Password"
                          className="w-full pl-12 pr-14 py-4 bg-slate-50 border-2 border-transparent rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-slate-200 transition-all placeholder:text-slate-300"
                          value={resetData.newPassword}
                          onChange={(e) => setResetData({ ...resetData, newPassword: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors px-2"
                        >
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      <div className="relative group">
                        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                          <Lock size={18} />
                        </div>
                        <input
                          type={showPassword ? "text" : "password"}
                          required
                          placeholder="Confirm New Password"
                          className="w-full pl-12 pr-14 py-4 bg-slate-50 border-2 border-transparent rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white focus:border-slate-200 transition-all placeholder:text-slate-300"
                          value={resetData.confirmPassword}
                          onChange={(e) => setResetData({ ...resetData, confirmPassword: e.target.value })}
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={resetData.isResetting}
                        className="w-full flex items-center justify-center gap-2 bg-slate-900 text-white p-4 rounded-xl text-sm font-black uppercase tracking-widest hover:bg-black transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {resetData.isResetting ? <Loader2 className="w-5 h-5 animate-spin" /> : "Reset Password"}
                        <ArrowRight size={18} />
                      </button>
                    </form>
                  )}
                </div>
              ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* LOGIN OR SIGNUP STEP 1 */}
                {(isLogin || signupStep === 1) && (
                  <>
                    {!isLogin && (
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <div className="relative group">
                            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                              <User size={18} />
                            </div>
                            <input
                              type="text"
                              name="name"
                              required
                              maxLength={50}
                              pattern="[a-zA-Z\s]*"
                              autoCapitalize="words"
                              placeholder="Owner Name"
                              className={`w-full pl-12 pr-6 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all capitalize placeholder:normal-case placeholder:text-slate-300 ${fieldErrors.name ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                              value={formData.name}
                              onChange={(e) => {
                                  e.target.value = e.target.value.replace(/[^a-zA-Z\s]/g, '').replace(/\b\w/g, (c) => c.toUpperCase());
                                  handleChange(e);
                              }}
                              onBlur={handleBlur}
                            />
                          </div>
                          {fieldErrors.name && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.name}</p>}
                        </div>
                        <div>
                          <div className="relative group">
                            <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                              <Store size={18} />
                            </div>
                            <input
                              type="text"
                              name="shopName"
                              required
                              autoCapitalize="words"
                              placeholder="Shop / Business Name"
                              className={`w-full pl-12 pr-6 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all capitalize placeholder:normal-case placeholder:text-slate-300 ${fieldErrors.shopName ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                              value={formData.shopName}
                              onChange={(e) => {
                                  e.target.value = e.target.value.replace(/\b\w/g, (c) => c.toUpperCase());
                                  handleChange(e);
                              }}
                              onBlur={handleBlur}
                            />
                          </div>
                          {fieldErrors.shopName && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.shopName}</p>}
                        </div>
                      </div>
                    )}

                    <div>
                      <div className="relative group">
                        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                          <Mail size={18} />
                        </div>
                        <input
                          type={isLogin ? "text" : "email"}
                          name="email"
                          required
                          inputMode={isLogin ? "text" : "email"}
                          autoComplete="email"
                          placeholder={isLogin ? "Email or Phone Number" : "Business Email"}
                          className={`w-full pl-12 ${isLogin ? "pr-4" : "pr-24"} py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all placeholder:text-slate-300 ${fieldErrors.email ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                          value={formData.email}
                          onChange={handleChange}
                          onBlur={handleBlur}
                        />
                        {!isLogin && (
                          <button
                            type="button"
                            onClick={() => handleSendVerificationOtp("email")}
                            disabled={
                              verifications.email.isSending ||
                              verifications.email.status === "verified" ||
                              verifications.email.exists ||
                              Boolean(fieldErrors.email) ||
                              !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email || "")
                            }
                            className={`absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${verifications.email.status === "verified"
                              ? "bg-brand-100 text-brand-700 cursor-default"
                              : "bg-slate-900 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
                              }`}>
                            {verifications.email.isSending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : verifications.email.status === "verified" ? (
                              "Verified"
                            ) : verifications.email.isOtpVisible ? (
                              "Resend"
                            ) : (
                              "Verify"
                            )}
                          </button>
                        )}
                      </div>
                      {fieldErrors.email && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.email}</p>}
                    </div>

                    {!isLogin && verifications.email.isOtpVisible && verifications.email.status !== "verified" && (
                      <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 overflow-hidden">
                        <input
                          type="text"
                          inputMode="numeric"
                          maxLength={4}
                          placeholder="Enter email OTP"
                          value={verifications.email.otp}
                          onChange={(e) =>
                            updateVerificationState("email", {
                              otp: e.target.value.replace(/\D/g, "").slice(0, 4),
                            })
                          }
                          className="flex-1 min-w-0 bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400"
                        />
                        <button
                          type="button"
                          onClick={() => handleVerifyOtp("email")}
                          disabled={verifications.email.isVerifying || verifications.email.otp.length !== 4}
                          className="shrink-0 whitespace-nowrap rounded-md bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50"
                        >
                          {verifications.email.isVerifying ? "Checking..." : "Confirm OTP"}
                        </button>
                      </div>
                    )}
                    {!isLogin && verifications.email.status === "verified" && (
                      <div className="flex items-center gap-2 text-[11px] font-bold text-brand-600">
                        <CheckCircle className="h-4 w-4" />
                        <span>Email verified successfully.</span>
                      </div>
                    )}

                    {!isLogin && (
                      <div>
                        <div className="relative group">
                          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                            <Phone size={18} />
                          </div>
                          <input
                            type="tel"
                            name="phone"
                            required
                            placeholder="Contact Number"
                            className={`w-full pl-12 pr-28 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all placeholder:text-slate-300 ${fieldErrors.phone ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                            value={formData.phone}
                            onChange={handleChange}
                            onBlur={handleBlur}
                          />
                          <button
                            type="button"
                            onClick={() => handleSendVerificationOtp("phone")}
                            disabled={
                              verifications.phone.isSending ||
                              verifications.phone.status === "verified" ||
                              verifications.phone.exists ||
                              Boolean(fieldErrors.phone) ||
                              !/^[6-9]\d{9}$/.test(formData.phone || "")
                            }
                            className={`absolute right-3 top-1/2 -translate-y-1/2 px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-wider transition-all ${verifications.phone.status === "verified"
                              ? "bg-brand-100 text-brand-700 cursor-default"
                              : "bg-slate-900 text-white hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed"
                              }`}>
                            {verifications.phone.isSending ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : verifications.phone.status === "verified" ? (
                              "Verified"
                            ) : verifications.phone.isOtpVisible ? (
                              "Resend"
                            ) : (
                              "Verify"
                            )}
                          </button>
                        </div>
                        {fieldErrors.phone && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.phone}</p>}
                        {verifications.phone.isOtpVisible && verifications.phone.status !== "verified" && (
                          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 overflow-hidden mt-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={4}
                              placeholder="Enter phone OTP"
                              value={verifications.phone.otp}
                              onChange={(e) =>
                                updateVerificationState("phone", {
                                  otp: e.target.value.replace(/\D/g, "").slice(0, 4),
                                })
                              }
                              className="flex-1 min-w-0 bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400"
                            />
                            <button
                              type="button"
                              onClick={() => handleVerifyOtp("phone")}
                              disabled={verifications.phone.isVerifying || verifications.phone.otp.length !== 4}
                              className="shrink-0 whitespace-nowrap rounded-md bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-700 shadow-sm ring-1 ring-slate-200 hover:bg-slate-100 disabled:opacity-50"
                            >
                              {verifications.phone.isVerifying ? "Checking..." : "Confirm OTP"}
                            </button>
                          </div>
                        )}
                        {verifications.phone.status === "verified" && (
                          <div className="flex items-center gap-2 text-[11px] font-bold text-brand-600 mt-1">
                            <CheckCircle className="h-4 w-4" />
                            <span>Phone number verified successfully.</span>
                          </div>
                        )}
                      </div>
                    )}

                    <div>
                      <div className="relative group">
                        <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                          <Lock size={18} />
                        </div>
                        <input
                          type={showPassword ? "text" : "password"}
                          name="password"
                          required
                          minLength={6}
                          autoComplete="current-password"
                          placeholder="Enter your password"
                          className={`w-full pl-12 pr-14 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all placeholder:text-slate-300 ${fieldErrors.password ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                          value={formData.password}
                          onChange={handleChange}
                          onBlur={handleBlur}
                        />

                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-600 transition-colors px-2"
                          tabIndex="-1">
                          {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                      </div>
                      {fieldErrors.password && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.password}</p>}
                    </div>
                    {isLogin && (
                      <div className="flex justify-end mt-1">
                        <button
                          type="button"
                          onClick={() => {
                            window.history.pushState(
                              { sellerAuth: true, isLogin: true, signupStep: 1, isMapOpen: false, forgotStep: 1 },
                              ""
                            );
                            setForgotPasswordStep(1);
                          }}
                          className="text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors"
                        >
                          Forgot Password?
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* SIGNUP STEP 2 (Shop address and service area) */}
                {!isLogin && signupStep === 2 && (
                  <div className="space-y-4">
                    <div className="pt-2">
                      <p className="text-sm font-black text-slate-600 uppercase tracking-widest mb-3">
                        Shop Location & Service Area
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          window.history.pushState(
                            { sellerAuth: true, isLogin: false, signupStep: 2, isMapOpen: true, forgotStep: 0 },
                            ""
                          );
                          setIsMapOpen(true);
                        }}
                        className={`w-full flex items-center justify-between p-4 rounded-lg border-2 border-dashed transition-all cursor-pointer overflow-hidden ${formData.lat
                          ? "border-brand-200 bg-brand-50/50"
                          : "border-slate-200 bg-slate-50 hover:border-slate-300"
                          }`}>
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div
                            className={`p-2 rounded-md shrink-0 ${formData.lat ? "bg-brand-100 text-brand-600" : "bg-white text-slate-600 shadow-sm"}`}>
                            {formData.lat ? (
                              <CheckCircle className="w-4 h-4" />
                            ) : (
                              <MapPin className="w-4 h-4" />
                            )}
                          </div>
                          <div className="text-left min-w-0 flex-1">
                            <p
                              className={`text-xs font-bold truncate ${formData.lat ? "text-brand-700" : "text-slate-600"}`}>
                              {formData.lat
                                ? "Location Selected"
                                : "Pin Shop on Map"}
                            </p>
                            <p className="text-xs text-slate-600 font-medium truncate" title={formData.address ? `${formData.address} (${formData.radius}km)` : ""}>
                              {formData.lat
                                ? `${formData.address} (${formData.radius}km)`
                                : "Precisely mark your shop location"}
                            </p>
                          </div>
                        </div>
                        {formData.lat && (
                          <span className="text-[10px] font-black text-brand-600 bg-brand-100 px-2 py-0.5 rounded-full uppercase tracking-tighter shrink-0 ml-2">
                            Verified
                          </span>
                        )}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <div className="relative group">
                          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                            <MapPin size={18} />
                          </div>
                          <input
                            type="text"
                            name="locality"
                            required
                            placeholder="Locality / Area"
                            className={`w-full pl-12 pr-6 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all placeholder:text-slate-300 ${fieldErrors.locality ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                            value={formData.locality}
                            onChange={handleChange}
                            onBlur={handleBlur}
                          />
                        </div>
                        {fieldErrors.locality && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.locality}</p>}
                      </div>
                      <div>
                        <div className="relative group">
                          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                            <MapPin size={18} />
                          </div>
                          <input
                            type="text"
                            name="pincode"
                            required
                            placeholder="Pincode"
                            className={`w-full pl-12 pr-6 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all placeholder:text-slate-300 ${fieldErrors.pincode ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                            value={formData.pincode}
                            onChange={handleChange}
                            onBlur={handleBlur}
                          />
                        </div>
                        {fieldErrors.pincode && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.pincode}</p>}
                      </div>
                      <div>
                        <div className="relative group">
                          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                            <MapPin size={18} />
                          </div>
                          <input
                            type="text"
                            name="city"
                            required
                            placeholder="City"
                            className={`w-full pl-12 pr-6 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all placeholder:text-slate-300 ${fieldErrors.city ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                            value={formData.city}
                            onChange={handleChange}
                            onBlur={handleBlur}
                          />
                        </div>
                        {fieldErrors.city && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.city}</p>}
                      </div>
                      <div>
                        <div className="relative group">
                          <div className="absolute left-5 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                            <MapPin size={18} />
                          </div>
                          <input
                            type="text"
                            name="state"
                            required
                            placeholder="State"
                            className={`w-full pl-12 pr-6 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all placeholder:text-slate-300 ${fieldErrors.state ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                            value={formData.state}
                            onChange={handleChange}
                            onBlur={handleBlur}
                          />
                        </div>
                        {fieldErrors.state && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.state}</p>}
                      </div>
                    </div>

                    <div>
                      <div className="relative group">
                        <div className="absolute left-5 top-5 text-slate-300 group-focus-within:text-violet-600 transition-colors">
                          <MapPin size={18} />
                        </div>
                        <textarea
                          name="address"
                          rows={3}
                          required
                          placeholder="Full address"
                          className={`w-full pl-12 pr-6 py-4 bg-slate-50 border-2 rounded-lg text-sm font-bold text-slate-700 outline-none focus:bg-white transition-all placeholder:text-slate-300 resize-none ${fieldErrors.address ? "border-red-400 focus:border-red-400" : "border-transparent focus:border-slate-200"}`}
                          value={formData.address}
                          onChange={handleChange}
                          onBlur={handleBlur}
                        />
                      </div>
                      {fieldErrors.address && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.address}</p>}
                    </div>
                  </div>
                )}

                {/* SIGNUP STEP 3 (Verification documents) */}
                {!isLogin && signupStep === 3 && (
                  <div className="space-y-4">
                    <div className="pt-2">
                      <p className="text-sm font-black text-slate-600 uppercase tracking-widest mb-3">
                        Verification Documents
                      </p>
                      <div className="space-y-3">
                        {REQUIRED_DOCUMENT_CONFIG.map((doc) => (
                          <div key={doc.id} className="relative">
                            <input
                              type="file"
                              id={doc.id}
                              className="hidden"
                              accept="image/*,.pdf"
                              onChange={(e) => handleDocumentChange(e, doc.id)}
                            />
                            <label
                              htmlFor={doc.id}
                              className={`flex items-center justify-between p-3.5 rounded-lg border-2 border-dashed transition-all cursor-pointer ${documents[doc.id]
                                ? "border-brand-200 bg-brand-50/50"
                                : "border-slate-200 bg-slate-50 hover:border-slate-300"
                                }`}>
                              <div className="flex items-center gap-3">
                                <div
                                  className={`p-2 rounded-md ${documents[doc.id] ? "bg-brand-100 text-brand-600" : "bg-white text-slate-600 shadow-sm"}`}>
                                  {documents[doc.id] ? (
                                    <CheckCircle className="w-4 h-4" />
                                  ) : (
                                    <Upload className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="text-left">
                                  <p
                                    className={`text-xs font-bold ${documents[doc.id] ? "text-brand-700" : "text-slate-600"}`}>
                                    {doc.label}
                                  </p>
                                  <p className="text-xs text-slate-600 font-medium truncate max-w-[150px]">
                                    {documents[doc.id]
                                      ? documents[doc.id].name
                                      : "Upload secure PDF or image"}
                                  </p>
                                </div>
                              </div>
                            </label>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="flex gap-3 pt-2">
                  {!isLogin && signupStep > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.history.state?.sellerAuth && window.history.state?.signupStep > 1) {
                          window.history.back();
                        } else {
                          setSignupStep((prev) => Math.max(1, prev - 1));
                        }
                      }}
                      className="w-1/3 bg-slate-100 text-slate-600 rounded-lg py-4 text-sm font-black tracking-[2px] transition-all hover:bg-slate-200">
                      BACK
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isLoading}
                    className={`${!isLogin && signupStep > 1 ? "w-2/3" : "w-full"} bg-slate-900 text-white rounded-lg py-4 text-sm font-black tracking-[2px] shadow-[0_25px_50px_-12px_rgba(0,0,0,0.3)] hover:bg-black transition-all active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3 group`}>
                    {isLoading
                      ? "WORKING..."
                      : isLogin
                        ? "ENTER DASHBOARD"
                        : signupStep < 3
                          ? "NEXT STEP"
                          : "SUBMIT APPLICATION"}
                    <ArrowRight
                      className="group-hover:translate-x-2 transition-transform"
                      size={20}
                    />
                  </button>
                </div>
              </form>
              )}

              <div className="pt-1 border-t border-slate-50 flex flex-col items-center gap-1">
                <p className="text-slate-600 font-bold text-sm">
                  {isLogin ? "New to the platform?" : "Already part of us?"}{" "}
                  <button
                    onClick={() => {
                      const nextIsLogin = !isLogin;
                      if (nextIsLogin) {
                        sessionStorage.removeItem("seller_auth_signup_step");
                        sessionStorage.removeItem("seller_auth_form_data");
                        sessionStorage.removeItem("seller_auth_verifications");
                        if (window.history.state?.sellerAuth && !window.history.state?.isLogin) {
                          window.history.go(-signupStep);
                        } else {
                          setIsLogin(true);
                          setSignupStep(1);
                          window.history.replaceState(
                            { sellerAuth: true, isLogin: true, signupStep: 1, isMapOpen: false, forgotStep: 0 },
                            ""
                          );
                        }
                      } else {
                        window.history.pushState(
                          { sellerAuth: true, isLogin: false, signupStep: 1, isMapOpen: false, forgotStep: 0 },
                          ""
                        );
                        setIsLogin(false);
                        setSignupStep(1);
                      }
                      setVerifications({
                        email: createInitialVerificationState(),
                        phone: createInitialVerificationState(),
                      });
                    }}
                    className="text-slate-900 hover:text-black transition-colors px-2">
                    {isLogin ? "Register Store" : "Sign In"}
                  </button>
                </p>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </motion.div>

      {/* Bottom Tagline */}
      <div className="absolute bottom-3 left-0 right-0 flex items-center justify-center text-center px-4 pointer-events-none z-10">
        <span className="text-slate-400 text-[9px] sm:text-[10px] font-black uppercase tracking-[2px] sm:tracking-[4px] truncate max-w-[90vw]">
          Empowering Business Digitalization
        </span>
      </div>

      {isMapOpen && (
        <MapPicker
          isOpen={isMapOpen}
          onClose={() => {
            if (window.history.state?.isMapOpen) {
              window.history.back();
            } else {
              setIsMapOpen(false);
            }
          }}
          onConfirm={handleLocationSelect}
          preferCurrentLocationOnOpen={!formData.lat}
          initialLocation={
            formData.lat ? { lat: Number(formData.lat), lng: Number(formData.lng) } : null
          }
          initialAddress={formData.address || ""}
          initialRadius={formData.radius}
        />
      )}
    </div>
  );
};

export default Auth;
