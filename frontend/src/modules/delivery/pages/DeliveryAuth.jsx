import React, { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import {
  Phone,
  ArrowRight,
  CheckCircle,
  ShieldCheck,
  ChevronLeft,
  User,
  Bike,
  ChevronDown,
  Mail,
  MapPin,
  FileText,
  Upload,
  X,
  Camera,
  XCircle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import Lottie from "lottie-react";
import deliveryRiding from "@/assets/Delivery Riding.json";
import { deliveryApi } from "../services/deliveryApi";
import { useAuth } from "@core/context/AuthContext";
import { useSettings } from "@core/context/SettingsContext";
import { toast } from "sonner";
import Tesseract from "tesseract.js";
import axiosInstance from "@core/api/axios";
import { onDeliveryApproved } from "@core/services/orderSocket";
import {
  saveRegistrationFile,
  removeRegistrationFile,
  loadAllRegistrationFiles,
  clearAllRegistrationFiles,
} from "../utils/deliveryRegistrationStorage";

const VEHICLE_TYPES = [
  { value: "bike", label: "Bike" },
  { value: "scooter", label: "Scooter" },
  { value: "cycle", label: "Cycle" },
];

const DeliveryAuth = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const appName = settings?.appName || "App";
  const { login, token, user, isAuthenticated, role } = useAuth();
  const bottomRef = React.useRef(null);
  const isUnlockingRef = useRef(false);

  const authContainerRef = useRef(null);

  React.useEffect(() => {
    import('@core/auth/activeRoleStore').then(({ setActiveRole, ROLES }) => {
        setActiveRole(ROLES.DELIVERY);
    });
  }, []);

  React.useEffect(() => {
    if (isAuthenticated && role === "delivery" && user?.isVerified !== false) {
      navigate("/delivery/dashboard", { replace: true });
    }
  }, [isAuthenticated, role, user?.isVerified, navigate]);

  // mode: "login" | "signup"
  const [mode, setMode] = useState(() => {
    return sessionStorage.getItem("delivery_auth_mode") || "login";
  });
  const [step, setStep] = useState("form"); // "form" | "otp"

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (authContainerRef.current) {
      authContainerRef.current.scrollTop = 0;
    }
  }, [mode, step]);
  const [showPendingModal, setShowPendingModal] = useState(() => {
    return Boolean(
      sessionStorage.getItem("pending_delivery_id") ||
      sessionStorage.getItem("pending_delivery_phone") ||
      (typeof window !== "undefined" && localStorage.getItem("pending_delivery_id")) ||
      (typeof window !== "undefined" && localStorage.getItem("pending_delivery_phone")) ||
      (user && user.role === "delivery" && user.isVerified === false)
    );
  });

  // Login state
  const [loginPhone, setLoginPhone] = useState(() => {
    return sessionStorage.getItem("delivery_auth_login_phone") || "";
  });

  useEffect(() => {
    sessionStorage.setItem("delivery_auth_mode", mode);
  }, [mode]);

  useEffect(() => {
    sessionStorage.setItem("delivery_auth_login_phone", loginPhone);
  }, [loginPhone]);

  // Signup state – all fields restored from sessionStorage on refresh
  const [signupStep, setSignupStep] = useState(() => parseInt(sessionStorage.getItem("dsup_step") || "1", 10));
  const [signupName, setSignupName] = useState(() => sessionStorage.getItem("dsup_name") || "");
  const [signupPhone, setSignupPhone] = useState(() => sessionStorage.getItem("dsup_phone") || "");
  const [signupEmail, setSignupEmail] = useState(() => sessionStorage.getItem("dsup_email") || "");
  const [signupAddress, setSignupAddress] = useState(() => sessionStorage.getItem("dsup_address") || "");
  const [signupVehicle, setSignupVehicle] = useState(() => sessionStorage.getItem("dsup_vehicle") || "bike");
  const [signupVehicleNumber, setSignupVehicleNumber] = useState(() => sessionStorage.getItem("dsup_vehicleNumber") || "");
  const [signupDLNumber, setSignupDLNumber] = useState(() => sessionStorage.getItem("dsup_dlNumber") || "");
  const [signupPanNumber, setSignupPanNumber] = useState(() => sessionStorage.getItem("dsup_pan") || "");
  const [signupAadharNumber, setSignupAadharNumber] = useState(() => sessionStorage.getItem("dsup_aadhar") || "");
  const [signupAccountNumber, setSignupAccountNumber] = useState(() => sessionStorage.getItem("dsup_accountNumber") || "");
  const [signupIfsc, setSignupIfsc] = useState(() => sessionStorage.getItem("dsup_ifsc") || "");
  const [signupAccountHolder, setSignupAccountHolder] = useState(() => sessionStorage.getItem("dsup_accountHolder") || "");
  const [signupPreferredArea, setSignupPreferredArea] = useState(() => sessionStorage.getItem("dsup_area") || sessionStorage.getItem("signupPreferredArea") || "");
  const [signupDob, setSignupDob] = useState(() => sessionStorage.getItem("dsup_dob") || "");
  const [signupBloodGroup, setSignupBloodGroup] = useState(() => sessionStorage.getItem("dsup_bloodGroup") || "");
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false);
  const [profileImageFile, setProfileImageFile] = useState(null);
  const [profileImagePreview, setProfileImagePreview] = useState("");

  // Persist signup fields to sessionStorage
  useEffect(() => { sessionStorage.setItem("dsup_step", signupStep); }, [signupStep]);
  useEffect(() => { sessionStorage.setItem("dsup_name", signupName); }, [signupName]);
  useEffect(() => { sessionStorage.setItem("dsup_phone", signupPhone); }, [signupPhone]);
  useEffect(() => { sessionStorage.setItem("dsup_email", signupEmail); }, [signupEmail]);
  useEffect(() => { sessionStorage.setItem("dsup_address", signupAddress); }, [signupAddress]);
  useEffect(() => { sessionStorage.setItem("dsup_vehicle", signupVehicle); }, [signupVehicle]);
  useEffect(() => { sessionStorage.setItem("dsup_vehicleNumber", signupVehicleNumber); }, [signupVehicleNumber]);
  useEffect(() => { sessionStorage.setItem("dsup_dlNumber", signupDLNumber); }, [signupDLNumber]);
  useEffect(() => { sessionStorage.setItem("dsup_pan", signupPanNumber); }, [signupPanNumber]);
  useEffect(() => { sessionStorage.setItem("dsup_aadhar", signupAadharNumber); }, [signupAadharNumber]);
  useEffect(() => { sessionStorage.setItem("dsup_accountNumber", signupAccountNumber); }, [signupAccountNumber]);
  useEffect(() => { sessionStorage.setItem("dsup_ifsc", signupIfsc); }, [signupIfsc]);
  useEffect(() => { sessionStorage.setItem("dsup_accountHolder", signupAccountHolder); }, [signupAccountHolder]);
  useEffect(() => { sessionStorage.setItem("dsup_area", signupPreferredArea); }, [signupPreferredArea]);
  useEffect(() => { sessionStorage.setItem("dsup_dob", signupDob); }, [signupDob]);
  useEffect(() => { sessionStorage.setItem("dsup_bloodGroup", signupBloodGroup); }, [signupBloodGroup]);

  // Per-field validation errors
  const [fieldErrors, setFieldErrors] = useState({});

  const setFieldError = (field, msg) =>
    setFieldErrors((prev) => ({ ...prev, [field]: msg }));

  const clearFieldError = (field) =>
    setFieldErrors((prev) => { const next = { ...prev }; delete next[field]; return next; });

  // Document states
  const [aadharFile, setAadharFile] = useState(null);
  const [panFile, setPanFile] = useState(null);
  const [dlFile, setDlFile] = useState(null);

  // Restore uploaded registration photos & documents from IndexedDB on refresh
  useEffect(() => {
    let isMounted = true;
    loadAllRegistrationFiles().then((savedFiles) => {
      if (!isMounted || !savedFiles) return;
      if (savedFiles.profileImage) {
        setProfileImageFile(savedFiles.profileImage);
        setProfileImagePreview(URL.createObjectURL(savedFiles.profileImage));
      }
      if (savedFiles.aadhar) {
        setAadharFile(savedFiles.aadhar);
        setAadharVerified(true);
      }
      if (savedFiles.pan) {
        setPanFile(savedFiles.pan);
        setPanVerified(true);
      }
      if (savedFiles.dl) {
        setDlFile(savedFiles.dl);
        setDlVerified(true);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // OTP state
  const [otp, setOtp] = useState(["1", "2", "3", "4"]);
  const [agreed, setAgreed] = useState(true);
  const [loading, setLoading] = useState(false);
  const [timer, setTimer] = useState(30);

  // OCR States
  const [isScanning, setIsScanning] = useState(false);
  const [ocrProgress, setOcrProgress] = useState(0);
  const [dlVerified, setDlVerified] = useState(null);
  const [panVerified, setPanVerified] = useState(null);
  const [aadharVerified, setAadharVerified] = useState(null);

  useEffect(() => {
    let interval;
    if (step === "otp" && timer > 0) {
      interval = setInterval(() => setTimer((prev) => prev - 1), 1000);
    }
    return () => clearInterval(interval);
  }, [step, timer]);

  useEffect(() => {
    const handleFocusIn = (e) => {
      const target = e.target;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      ) {
        setTimeout(() => {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 450);
      }
    };
    window.addEventListener("focusin", handleFocusIn);
    return () => window.removeEventListener("focusin", handleFocusIn);
  }, []);

  const performOCR = async (file, type) => {
    setIsScanning(true);
    setOcrProgress(0);

    // Reset specific verification state
    if (type === "dl") setDlVerified(null);
    if (type === "pan") setPanVerified(null);
    if (type === "aadhar") setAadharVerified(null);

    try {
      const result = await Tesseract.recognize(file, 'eng', {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            setOcrProgress(Math.round(m.progress * 100));
          }
        },
      });

      const rawText = result.data.text.toLowerCase();
      const cleanText = rawText.replace(/[^a-z0-9]/g, "");

      // Handle common OCR character substitutions for more robust matching
      // e.g., '0' read as 'o', '5' as 's', '1' as 'i' or 'l'
      const normalize = (str) => str.replace(/o/g, "0").replace(/s/g, "5").replace(/[il]/g, "1");
      const normalizedCleanText = normalize(cleanText);

      console.log(`OCR Raw [${type}]:`, rawText);
      console.log(`OCR Cleaned [${type}]:`, cleanText);

      let isMatch = false;
      let targetNumber = "";

      if (type === "dl") {
        targetNumber = signupDLNumber.toLowerCase().replace(/[^a-z0-9]/g, "");
        const normalizedTarget = normalize(targetNumber);

        // Match either exact cleaned text or normalized text (handles 0/O, 5/S etc)
        isMatch = (targetNumber && cleanText.includes(targetNumber)) ||
          (normalizedTarget && normalizedCleanText.includes(normalizedTarget));

        const dlKeywords = ["driving", "licence", "license", "india", "union", "government", "transport", "validity", "form", "rj"];
        const hasDlKeywords = dlKeywords.some(k => rawText.includes(k));

        if (isMatch) {
          setDlVerified(true);
          setDlFile(file);
          saveRegistrationFile("dl", file);
          toast.success("Driving License Verified!");
        } else {
          setDlVerified(false);
          setDlFile(null);
          removeRegistrationFile("dl");
          toast.error("DL Number mismatch. Make sure you typed the exact number from the photo.");
        }
      } else if (type === "pan") {
        targetNumber = signupPanNumber.toLowerCase().replace(/[^a-z0-9]/g, "");
        const normalizedTarget = normalize(targetNumber);

        const panKeywords = ["permanent", "account", "income", "tax", "department", "india", "signature", "card", "govt"];
        const hasPanKeywords = panKeywords.some(k => rawText.includes(k));

        isMatch = (targetNumber && cleanText.includes(targetNumber)) ||
          (normalizedTarget && normalizedCleanText.includes(normalizedTarget));

        if (isMatch || (hasPanKeywords && isMatch)) {
          setPanVerified(true);
          setPanFile(file);
          saveRegistrationFile("pan", file);
          toast.success("PAN Card Verified!");
        } else {
          setPanVerified(false);
          setPanFile(null);
          removeRegistrationFile("pan");
          toast.error("PAN mismatch. Photo must be clear and show the PAN number.");
        }
      } else if (type === "aadhar") {
        targetNumber = signupAadharNumber.toLowerCase().replace(/[^a-z0-9]/g, "");
        const normalizedTarget = normalize(targetNumber);

        const aadharKeywords = ["government", "india", "male", "female", "unique", "identification", "authority", "enrollment", "birth", "dob", "address", "आधार", "भारत"];
        const hasAadharKeywords = aadharKeywords.some(k => rawText.includes(k));

        isMatch = (targetNumber && cleanText.includes(targetNumber)) ||
          (normalizedTarget && normalizedCleanText.includes(normalizedTarget));

        if (isMatch || (hasAadharKeywords && isMatch)) {
          setAadharVerified(true);
          setAadharFile(file);
          saveRegistrationFile("aadhar", file);
          toast.success("Aadhar Card Verified!");
        } else {
          setAadharVerified(false);
          setAadharFile(null);
          removeRegistrationFile("aadhar");
          toast.error("Aadhar mismatch. 12-digit number should be clearly visible.");
        }
      }
    } catch (error) {
      console.error("OCR Error:", error);
      toast.error("Failed to scan document. Please try again.");
    } finally {
      setIsScanning(false);
    }
  };

  const handleDLUpload = (file) => {
    if (file) {
      setDlFile(file);
      setDlVerified(true);
      saveRegistrationFile("dl", file);
    } else {
      setDlFile(null);
      setDlVerified(null);
      removeRegistrationFile("dl");
    }
  };

  const handlePanUpload = (file) => {
    if (file) {
      setPanFile(file);
      setPanVerified(true);
      saveRegistrationFile("pan", file);
    } else {
      setPanFile(null);
      setPanVerified(null);
      removeRegistrationFile("pan");
    }
  };

  const handleAadharUpload = (file) => {
    if (file) {
      setAadharFile(file);
      setAadharVerified(true);
      saveRegistrationFile("aadhar", file);
    } else {
      setAadharFile(null);
      setAadharVerified(null);
      removeRegistrationFile("aadhar");
    }
  };

  const handleSendOtp = async () => {
    try {
      if (mode === "login") {
        if (!loginPhone || !/^[6-9]\d{9}$/.test(loginPhone)) {
          toast.error("Please enter a valid 10-digit Indian phone number starting with 6, 7, 8, or 9");
          return;
        }
        setLoading(true);
        const res = await deliveryApi.sendLoginOtp({ phone: loginPhone });
        toast.success(res.data?.message || "OTP sent!");
      } else {
        if (!profileImageFile) {
          toast.error("Please upload your profile photo");
          return;
        }
        if (!signupName.trim() || signupName.trim().length < 3) {
          toast.error("Please enter your full name (minimum 3 characters)");
          return;
        }
        if (!signupPhone || !/^[6-9]\d{9}$/.test(signupPhone)) {
          toast.error("Please enter a valid 10-digit Indian phone number");
          return;
        }
        if (!signupEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail.trim())) {
          toast.error("Please enter a valid email address");
          return;
        }
        if (!signupAddress.trim() || signupAddress.trim().length < 10) {
          toast.error("Please enter your permanent address (minimum 10 characters)");
          return;
        }
        if (!signupDob) {
          toast.error("Please select your date of birth");
          return;
        }
        if (!aadharFile) {
          toast.error("Please upload your Aadhar Card document");
          return;
        }
        if (!panFile) {
          toast.error("Please upload your PAN Card document");
          return;
        }
        if (signupVehicle !== "cycle" && !dlFile) {
          toast.error("Please upload your Driving License document");
          return;
        }

        setLoading(true);

        const formData = new FormData();
        formData.append("name", signupName.trim());
        formData.append("phone", signupPhone);
        formData.append("vehicleType", signupVehicle);
        formData.append("email", signupEmail);
        formData.append("address", signupAddress);
        formData.append("vehicleNumber", signupVehicleNumber);
        formData.append("drivingLicenseNumber", signupDLNumber);
        formData.append("accountHolder", signupAccountHolder);
        formData.append("accountNumber", signupAccountNumber);
        formData.append("ifsc", signupIfsc);
        formData.append("dob", signupDob);
        formData.append("bloodGroup", signupBloodGroup);
        formData.append("currentArea", signupPreferredArea);

        if (profileImageFile) formData.append("profileImage", profileImageFile);
        if (aadharFile) formData.append("aadhar", aadharFile);
        if (panFile) formData.append("pan", panFile);
        if (dlFile) formData.append("dl", dlFile);

        const res = await deliveryApi.sendSignupOtp(formData);
        toast.success(res.data?.message || "OTP sent!");
      }
      setOtp(["", "", "", ""]);
      setTimer(30);
      setStep("otp");
    } catch (error) {
      console.error(error);
      if (mode === "login" && error.response?.status === 403) {
        const pId = error.response?.data?.result?.deliveryId;
        if (pId) sessionStorage.setItem("pending_delivery_id", String(pId));
        sessionStorage.setItem("pending_delivery_phone", String(loginPhone));
        setShowPendingModal(true);
        return;
      }
      toast.error(error.response?.data?.message || "Failed to send OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async () => {
    if (otp.some((d) => !d || d.trim() === "")) {
      toast.error("Please enter the complete 4-digit OTP code");
      return;
    }
    setLoading(true);
    try {
      const phone = mode === "login" ? loginPhone : signupPhone;
      const otpString = otp.join("");
      const response = await deliveryApi.verifyOtp({ phone, otp: otpString });
      
      if (response.data.result?.pendingApproval) {
        const pId = response.data.result?.deliveryId || response.data.result?.delivery?._id;
        const pToken = response.data.result?.token;
        if (pId) {
          sessionStorage.setItem("pending_delivery_id", String(pId));
          localStorage.setItem("pending_delivery_id", String(pId));
        }
        if (phone) {
          sessionStorage.setItem("pending_delivery_phone", String(phone));
          localStorage.setItem("pending_delivery_phone", String(phone));
        }
        if (pToken) {
          sessionStorage.setItem("pending_delivery_token", pToken);
          localStorage.setItem("pending_delivery_token", pToken);
        }
        if (pToken && response.data.result?.delivery) {
          login({ ...response.data.result.delivery, token: pToken, role: "delivery" });
        }
        setShowPendingModal(true);
        return;
      }

      const { token, delivery } = response.data.result;

      sessionStorage.removeItem("delivery_auth_mode");
      sessionStorage.removeItem("delivery_auth_login_phone");
      // Clear persisted signup fields on successful login
      ["dsup_step","dsup_name","dsup_phone","dsup_email","dsup_address","dsup_vehicle","dsup_vehicleNumber","dsup_dlNumber","dsup_pan","dsup_aadhar","dsup_accountNumber","dsup_ifsc","dsup_accountHolder","dsup_area","dsup_dob","dsup_bloodGroup"].forEach(k => sessionStorage.removeItem(k));
      clearAllRegistrationFiles();

      login({ ...delivery, token, role: "delivery" });

      toast.success("Welcome! Redirecting to dashboard...");
      navigate("/delivery/dashboard", { replace: true });
    } catch (error) {
      console.error(error);
      toast.error(error.response?.data?.message || "Invalid OTP");
    } finally {
      setLoading(false);
    }
  };

  const handleApproved = (payload) => {
    if (isUnlockingRef.current) return;
    isUnlockingRef.current = true;

    toast.success("Account approved! Unlocking dashboard...");

    const approvedRider = payload?.delivery || payload || {};
    const authToken =
      payload?.token ||
      (typeof window !== "undefined"
        ? sessionStorage.getItem("pending_delivery_token") || localStorage.getItem("pending_delivery_token")
        : "") ||
      token;

    if (authToken) {
      login({
        ...approvedRider,
        isVerified: true,
        token: authToken,
        role: "delivery",
      });
    }

    try {
      sessionStorage.removeItem("pending_delivery_id");
      sessionStorage.removeItem("pending_delivery_phone");
      sessionStorage.removeItem("pending_delivery_token");
      localStorage.removeItem("pending_delivery_id");
      localStorage.removeItem("pending_delivery_phone");
      localStorage.removeItem("pending_delivery_token");
      sessionStorage.removeItem("delivery_auth_mode");
      sessionStorage.removeItem("delivery_auth_login_phone");
      ["dsup_step","dsup_name","dsup_phone","dsup_email","dsup_address","dsup_vehicle","dsup_vehicleNumber","dsup_dlNumber","dsup_pan","dsup_aadhar","dsup_accountNumber","dsup_ifsc","dsup_accountHolder","dsup_area","dsup_dob","dsup_bloodGroup"].forEach(k => sessionStorage.removeItem(k));
      clearAllRegistrationFiles();
    } catch {
      /* ignore */
    }

    setShowPendingModal(false);

    // Refresh and unlock delivery dashboard cleanly
    setTimeout(() => {
      window.location.replace("/delivery/dashboard");
    }, 500);
  };

  useEffect(() => {
    if (!showPendingModal) return;
    if (isUnlockingRef.current) return;

    // If user is already verified in auth state, unlock immediately
    if (user?.isVerified === true && user?.role === "delivery") {
      handleApproved({ delivery: user, token });
      return;
    }

    const pendingId =
      (typeof window !== "undefined"
        ? sessionStorage.getItem("pending_delivery_id") || localStorage.getItem("pending_delivery_id")
        : "") ||
      user?._id ||
      user?.id ||
      "";
    const pendingPhone =
      (typeof window !== "undefined"
        ? sessionStorage.getItem("pending_delivery_phone") || localStorage.getItem("pending_delivery_phone")
        : "") ||
      loginPhone ||
      signupPhone ||
      "";

    const getToken = () =>
      token ||
      (typeof window !== "undefined"
        ? sessionStorage.getItem("pending_delivery_token") || localStorage.getItem("pending_delivery_token")
        : "") ||
      "";

    const offSocket = onDeliveryApproved(
      getToken,
      (payload) => {
        handleApproved(payload);
      },
      pendingId,
      pendingPhone
    );

    const checkStatus = async () => {
      if (isUnlockingRef.current) return;
      try {
        const params = {};
        if (pendingId) params.deliveryId = pendingId;
        if (pendingPhone) params.phone = pendingPhone;
        if (!params.deliveryId && !params.phone) return;

        const response = await axiosInstance.get("/delivery/application-status", {
          params,
        });
        const result = response.data?.result;
        if (result?.isApproved || result?.delivery?.isVerified) {
          handleApproved(result);
        }
      } catch (err) {
        // Silently retry on next tick
      }
    };

    // Immediate check on mount
    checkStatus();

    const intervalId = setInterval(checkStatus, 2000);

    return () => {
      offSocket?.();
      clearInterval(intervalId);
    };
  }, [showPendingModal, token, user, loginPhone, signupPhone]);

  const handleOtpChange = (index, value) => {
    if (isNaN(value)) return;
    const newOtp = [...otp];
    newOtp[index] = value;
    setOtp(newOtp);
    if (value && index < 3) {
      document.getElementById(`otp-${index + 1}`)?.focus();
    }
  };

  const handleKeyDown = (index, e) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      document.getElementById(`otp-${index - 1}`)?.focus();
    }
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setStep("form");
    setOtp(["", "", "", ""]);
  };

  const slideVariants = {
    hidden: { opacity: 0, x: 30 },
    visible: { opacity: 1, x: 0, transition: { duration: 0.3 } },
    exit: { opacity: 0, x: -30, transition: { duration: 0.2 } },
  };

  return (
    <div ref={authContainerRef} className="min-h-screen min-h-dvh bg-[#F0F4FF] flex flex-col items-center justify-start py-8 sm:py-10 px-4 sm:p-5 font-['Outfit',_sans-serif] overflow-y-auto" data-lenis-prevent>
      {/* Background blobs */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -left-32 w-80 h-80 bg-brand-200/40 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-purple-200/30 rounded-full blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-[420px] relative z-10 my-auto"
      >
        {/* Card */}
        <div className="bg-white rounded-[2.5rem] shadow-[0_24px_60px_rgba(99,102,241,0.1)] border border-brand-50 overflow-hidden flex flex-col">

          {/* Header with Lottie */}
          <div className="bg-gradient-to-br from-brand-50 to-purple-50 px-5 py-2 sm:px-6 sm:py-3 pb-3 flex flex-col items-center relative shrink-0">
            <div className="w-28 h-28 sm:w-32 sm:h-32 -mb-6 sm:-mb-8 mt-0">
              <Lottie animationData={deliveryRiding} loop />
            </div>
            <AnimatePresence mode="wait">
              <motion.div
                key={`${mode}-${step}-title`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="text-center mt-0"
              >
                <h1 className="text-2xl font-black text-gray-900">
                  {step === "otp"
                    ? "Verify OTP"
                    : mode === "login"
                      ? "Partner Login"
                      : "Partner Registration"}
                </h1>
                <p className="text-xs font-bold text-gray-400 mt-1">
                  {step === "otp"
                    ? `Code sent to +91 ${mode === "login" ? loginPhone : signupPhone}`
                    : mode === "login"
                      ? `Access your ${appName} delivery console`
                      : "Join our high-earning delivery fleet today"}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Tab Switch */}
          {step === "form" && (
            <div className="flex mx-6 mt-3 bg-gray-100/80 rounded-2xl p-1.5 shrink-0 border border-gray-100">
              {["login", "signup"].map((m) => (
                <button
                  key={m}
                  onClick={() => switchMode(m)}
                  className={`flex-1 py-2.5 text-xs font-black tracking-wide uppercase rounded-xl transition-all duration-200 ${
                    mode === m
                      ? "bg-white text-black shadow-md shadow-gray-200/60"
                      : "text-gray-500 hover:text-gray-800"
                  }`}
                >
                  {m === "login" ? "Login" : "Join Now"}
                </button>
              ))}
            </div>
          )}

          {/* Form Body */}
          <div className="p-6 pt-4 pb-8" data-lenis-prevent>
            <AnimatePresence mode="wait">
              {step === "form" && (
                <motion.div
                  key={`form-${mode}`}
                  variants={slideVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="space-y-4"
                >
                  {/* ────────── SIGNUP MODE ────────── */}
                  {mode === "signup" && (
                    <div className="space-y-4">
                      {/* Step 1: Personal Information */}
                      {signupStep === 1 && (
                        <motion.div
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="space-y-4"
                        >
                          {/* Profile Photo Capture */}
                          <div className="flex flex-col items-center justify-center py-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3 self-start ml-1">Profile Photo</label>
                            <div className="relative group">
                              <div className="w-24 h-24 rounded-3xl bg-brand-50 border-2 border-dashed border-brand-200 flex items-center justify-center overflow-hidden transition-all group-hover:border-brand-400">
                                {profileImagePreview ? (
                                  <img src={profileImagePreview} alt="Preview" className="w-full h-full object-cover" />
                                ) : (
                                  <User className="w-10 h-10 text-brand-300" />
                                )}
                              </div>
                              <input
                                type="file"
                                accept="image/*"
                                capture="user"
                                id="profile-upload"
                                className="hidden"
                                onChange={(e) => {
                                  const file = e.target.files[0];
                                  if (file) {
                                    setProfileImageFile(file);
                                    setProfileImagePreview(URL.createObjectURL(file));
                                    saveRegistrationFile("profileImage", file);
                                  }
                                }}
                              />
                              <label
                                htmlFor="profile-upload"
                                className="absolute -bottom-2 -right-2 p-2.5 bg-black text-white rounded-2xl shadow-lg shadow-brand-200 cursor-pointer hover:bg-brand-700 hover:scale-110 active:scale-95 transition-all"
                              >
                                <Camera className="w-4 h-4" />
                              </label>
                            </div>
                            <p className="text-[10px] text-gray-400 font-bold mt-3">Upload a clear photo of your face</p>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Full Name</label>
                            <div className="relative">
                              <User className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
                              <input
                                type="text"
                                value={signupName}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (/^[a-zA-Z\s]*$/.test(val)) {
                                    const capitalized = val.replace(/\b\w/g, (c) => c.toUpperCase());
                                    setSignupName(capitalized);
                                  }
                                  clearFieldError("name");
                                }}
                                onBlur={() => {
                                  if (!signupName.trim() || signupName.trim().length < 3)
                                    setFieldError("name", "Please enter your full name (min 3 characters)");
                                }}
                                className={`w-full pl-11 pr-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all capitalize ${fieldErrors.name ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                                placeholder="Enter your full name"
                              />
                            </div>
                            {fieldErrors.name && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.name}</p>}
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Phone Number</label>
                            <div className="relative">
                              <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
                              <span className="absolute left-10 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm border-r border-gray-200 pr-2.5">+91</span>
                              <input
                                type="tel"
                                value={signupPhone}
                                onChange={(e) => { setSignupPhone(e.target.value.replace(/\D/g, "").slice(0, 10)); clearFieldError("phone"); }}
                                onBlur={() => {
                                  if (!signupPhone || !/^[6-9]\d{9}$/.test(signupPhone))
                                    setFieldError("phone", "Enter a valid 10-digit number starting with 6-9");
                                }}
                                maxLength={10}
                                className={`w-full pl-24 pr-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${fieldErrors.phone ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                                placeholder="00000 00000"
                              />
                            </div>
                            {fieldErrors.phone && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.phone}</p>}
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Email Address</label>
                            <div className="relative">
                              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
                              <input
                                type="email"
                                value={signupEmail}
                                onChange={(e) => { setSignupEmail(e.target.value); clearFieldError("email"); }}
                                onBlur={() => {
                                  if (!signupEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail.trim()))
                                    setFieldError("email", "Enter a valid email address");
                                }}
                                className={`w-full pl-11 pr-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${fieldErrors.email ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                                placeholder="example@gmail.com"
                              />
                            </div>
                            {fieldErrors.email && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.email}</p>}
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Permanent Address</label>
                            <div className="relative">
                              <MapPin className="absolute left-4 top-4 text-gray-300 w-4 h-4" />
                              <textarea
                                value={signupAddress}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  if (/^[a-zA-Z0-9\s,.\-/#]*$/.test(val)) {
                                    setSignupAddress(val);
                                    clearFieldError("address");
                                  }
                                }}
                                onBlur={() => {
                                  if (!signupAddress.trim() || signupAddress.trim().length < 10)
                                    setFieldError("address", "Enter your complete address (min 10 characters)");
                                }}
                                className={`w-full pl-11 pr-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all resize-none h-24 ${fieldErrors.address ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                                placeholder="Complete building address..."
                              />
                            </div>
                            {fieldErrors.address && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.address}</p>}
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="space-y-1.5 flex-1">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Date of Birth</label>
                              <div className="relative">
                                <input
                                  type="date"
                                  value={signupDob}
                                  max={new Date().toISOString().split("T")[0]}
                                  onChange={(e) => {
                                    const selectedDate = e.target.value;
                                    const today = new Date().toISOString().split("T")[0];
                                    if (selectedDate && selectedDate > today) {
                                      toast.error("Date of birth cannot be in the future");
                                      return;
                                    }
                                    setSignupDob(selectedDate);
                                    clearFieldError("dob");
                                  }}
                                  onBlur={() => {
                                    if (!signupDob) {
                                      setFieldError("dob", "Please select your date of birth");
                                    } else {
                                      const dobDate = new Date(signupDob);
                                      const todayDate = new Date();
                                      let age = todayDate.getFullYear() - dobDate.getFullYear();
                                      const m = todayDate.getMonth() - dobDate.getMonth();
                                      if (m < 0 || (m === 0 && todayDate.getDate() < dobDate.getDate())) age--;
                                      if (age < 18) setFieldError("dob", "You must be at least 18 years old");
                                    }
                                  }}
                                  className={`w-full px-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${fieldErrors.dob ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                                />
                              </div>
                              {fieldErrors.dob && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.dob}</p>}
                            </div>
                            <div className="space-y-1.5 flex-1">
                              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-1">
                                <span>Blood Group</span>
                                <span className="font-normal text-[10px] text-gray-400 lowercase">(optional)</span>
                              </label>
                              <div className="relative">
                                <select
                                  value={signupBloodGroup}
                                  onChange={(e) => setSignupBloodGroup(e.target.value)}
                                  className="w-full px-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all appearance-none"
                                >
                                  <option value="">Select</option>
                                  <option value="A+">A+</option>
                                  <option value="A-">A-</option>
                                  <option value="B+">B+</option>
                                  <option value="B-">B-</option>
                                  <option value="AB+">AB+</option>
                                  <option value="AB-">AB-</option>
                                  <option value="O+">O+</option>
                                  <option value="O-">O-</option>
                                </select>
                                <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4 pointer-events-none" />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Preferred Delivery Area</label>
                            <div className="relative">
                              <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
                              <input
                                type="text"
                                value={signupPreferredArea}
                                onFocus={() => {
                                  setTimeout(() => {
                                    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
                                  }, 150);
                                }}
                                onChange={(e) => {
                                  setSignupPreferredArea(e.target.value);
                                  sessionStorage.setItem("signupPreferredArea", e.target.value);
                                  bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
                                }}
                                className="w-full pl-11 pr-4 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-400 transition-all"
                                placeholder="E.g. Downtown, North Side, etc."
                              />
                            </div>
                          </div>

                          <button
                            onClick={() => {
                              if (!profileImageFile) {
                                toast.error("Please upload a clear profile photo of your face");
                                return;
                              }
                              if (!signupName.trim() || signupName.trim().length < 3) {
                                toast.error("Please enter your full name (minimum 3 characters)");
                                return;
                              }
                              if (!signupPhone || !/^[6-9]\d{9}$/.test(signupPhone)) {
                                toast.error("Please enter a valid 10-digit Indian phone number starting with 6, 7, 8, or 9");
                                return;
                              }
                              if (!signupEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(signupEmail.trim())) {
                                toast.error("Please enter a valid email address");
                                return;
                              }
                              if (!signupAddress.trim() || signupAddress.trim().length < 10) {
                                toast.error("Please enter your complete permanent address (minimum 10 characters)");
                                return;
                              }
                              if (!signupDob) {
                                toast.error("Please select your date of birth");
                                return;
                              }
                              const today = new Date().toISOString().split("T")[0];
                              if (signupDob > today) {
                                toast.error("Date of birth cannot be in the future");
                                return;
                              }
                              const dobDate = new Date(signupDob);
                              const todayDate = new Date();
                              let age = todayDate.getFullYear() - dobDate.getFullYear();
                              const monthDiff = todayDate.getMonth() - dobDate.getMonth();
                              if (monthDiff < 0 || (monthDiff === 0 && todayDate.getDate() < dobDate.getDate())) {
                                age--;
                              }
                              if (age < 18) {
                                toast.error("You must be at least 18 years old to register as a delivery partner");
                                return;
                              }
                              if (!signupPreferredArea.trim() || signupPreferredArea.trim().length < 3) {
                                toast.error("Please enter your preferred delivery area (minimum 3 characters)");
                                return;
                              }
                              setSignupStep(2);
                            }}
                            className="w-full py-4 bg-black text-white rounded-2xl text-sm font-black tracking-widest uppercase shadow-lg shadow-brand-200 hover:bg-brand-700 transition-all flex items-center justify-center gap-2"
                          >
                            Next Step <ArrowRight className="w-4 h-4" />
                          </button>
                          <div ref={bottomRef} className="h-1" />
                        </motion.div>
                      )}

                      {/* Step 2: Vehicle Information */}
                      {signupStep === 2 && (
                        <motion.div
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="space-y-4"
                        >
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Vehicle Type</label>
                            <div className="relative">
                              <Bike className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
                              <button
                                type="button"
                                onClick={() => setShowVehicleDropdown(!showVehicleDropdown)}
                                className="w-full pl-11 pr-10 py-3.5 bg-gray-50 border border-gray-100 rounded-2xl text-sm font-bold text-gray-900 focus:outline-none text-left"
                              >
                                {VEHICLE_TYPES.find((v) => v.value === signupVehicle)?.label}
                              </button>
                              <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                              <AnimatePresence>
                                {showVehicleDropdown && (
                                  <motion.div
                                    initial={{ opacity: 0, y: -8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    exit={{ opacity: 0, y: -8 }}
                                    className="absolute top-full left-0 w-full bg-white border border-gray-100 rounded-2xl shadow-lg mt-2 overflow-hidden z-20"
                                  >
                                    {VEHICLE_TYPES.map((v) => (
                                      <button
                                        key={v.value}
                                        onClick={() => { 
                                          setSignupVehicle(v.value); 
                                          sessionStorage.setItem("signupVehicle", v.value);
                                          setShowVehicleDropdown(false); 
                                        }}
                                        className="w-full px-4 py-3 text-sm font-bold text-left hover:bg-brand-50 transition-colors"
                                      >
                                        {v.label}
                                      </button>
                                    ))}
                                  </motion.div>
                                )}
                              </AnimatePresence>
                            </div>
                          </div>

                          {signupVehicle !== 'cycle' && (
                            <>
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Vehicle Plate Number</label>
                            <div className="relative">
                              <ShieldCheck className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
                              <input
                                type="text"
                                maxLength={15}
                                value={signupVehicleNumber}
                                onChange={(e) => { 
                                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, '');
                                  setSignupVehicleNumber(val); 
                                  sessionStorage.setItem("signupVehicleNumber", val);
                                  clearFieldError("vehicleNumber"); 
                                }}
                                onBlur={() => {
                                  if (!signupVehicleNumber)
                                    setFieldError("vehicleNumber", "Please enter your vehicle plate number");
                                  else if (!/^[A-Z]{2}\s?[0-9]{1,2}\s?[A-Z]{0,3}\s?[0-9]{1,4}$/.test(signupVehicleNumber.trim()))
                                    setFieldError("vehicleNumber", "Invalid plate number (e.g. KA 05 MN 8921)");
                                }}
                                className={`w-full pl-11 pr-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${fieldErrors.vehicleNumber ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                                placeholder="KA 05 MN 8921"
                              />
                            </div>
                            {fieldErrors.vehicleNumber && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.vehicleNumber}</p>}
                          </div>

                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Driving License Number</label>
                            <div className="relative">
                              <FileText className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
                              <input
                                type="text"
                                maxLength={16}
                                value={signupDLNumber}
                                onChange={(e) => { 
                                  const val = e.target.value.toUpperCase().replace(/[^A-Z0-9\s-]/g, '');
                                  setSignupDLNumber(val); 
                                  sessionStorage.setItem("signupDLNumber", val);
                                  clearFieldError("dlNumber"); 
                                }}
                                onBlur={() => {
                                  if (!signupDLNumber)
                                    setFieldError("dlNumber", "Please enter your driving license number");
                                  else if (!/^[A-Z]{2}[0-9]{13}$/.test(signupDLNumber.replace(/[\s-]/g, '').trim()))
                                    setFieldError("dlNumber", "Invalid DL number (e.g. DL1420110012345)");
                                }}
                                className={`w-full pl-11 pr-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${fieldErrors.dlNumber ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                                placeholder="DL-1420110012345"
                              />
                            </div>
                            {fieldErrors.dlNumber && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.dlNumber}</p>}
                          </div>
                          </>
                          )}

                          <div className="flex gap-4 pt-2">
                            <button
                              onClick={() => setSignupStep(1)}
                              className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                            >
                              Back
                            </button>
                            <button
                              onClick={() => {
                                if (signupVehicle !== 'cycle') {
                                  if (!signupVehicleNumber) {
                                    toast.error("Please enter your vehicle plate number");
                                    return;
                                  }
                                  if (!/^[A-Z]{2}\s?[0-9]{1,2}\s?[A-Z]{0,3}\s?[0-9]{1,4}$/.test(signupVehicleNumber.trim())) {
                                    toast.error("Please enter a valid vehicle plate number (e.g. KA 05 MN 8921)");
                                    return;
                                  }
                                  if (!signupDLNumber) {
                                    toast.error("Please enter your driving license number");
                                    return;
                                  }
                                  if (!/^[A-Z]{2}[0-9]{13}$/.test(signupDLNumber.replace(/[\s-]/g, '').trim())) {
                                    toast.error("Please enter a valid driving license number (e.g. DL1420110012345)");
                                    return;
                                  }
                                }
                                setSignupStep(3);
                              }}
                              className="flex-[2] py-4 bg-black text-white rounded-2xl text-sm font-black tracking-widest uppercase shadow-lg shadow-brand-200 hover:bg-brand-700 transition-all flex items-center justify-center gap-2"
                            >
                              Next Step <ArrowRight className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      )}

                      {/* Step 3: Bank Information */}
                      {signupStep === 3 && (
                        <motion.div
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="space-y-4"
                        >
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Aadhar Number</label>
                            <input
                              type="text"
                              value={signupAadharNumber}
                              onChange={(e) => { 
                                const val = e.target.value.replace(/\D/g, "").slice(0, 12);
                                setSignupAadharNumber(val); 
                                sessionStorage.setItem("signupAadharNumber", val);
                                clearFieldError("aadhar"); 
                              }}
                              onBlur={() => {
                                if (!signupAadharNumber || signupAadharNumber.length !== 12)
                                  setFieldError("aadhar", "Enter a valid 12-digit Aadhar number");
                              }}
                              className={`w-full px-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all font-mono ${fieldErrors.aadhar ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                              placeholder="0000 0000 0000"
                            />
                            {fieldErrors.aadhar && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.aadhar}</p>}
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">PAN Card Number</label>
                            <input
                              type="text"
                              maxLength={10}
                              value={signupPanNumber}
                              onChange={(e) => { 
                                const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                                setSignupPanNumber(val); 
                                sessionStorage.setItem("signupPanNumber", val);
                                clearFieldError("pan"); 
                              }}
                              onBlur={(e) => {
                                if (!e.target.value)
                                  setFieldError("pan", "Please enter your PAN card number");
                                else if (!/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(e.target.value))
                                  setFieldError("pan", "Invalid PAN format (e.g. ABCDE1234F)");
                              }}
                              className={`w-full px-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all font-mono ${fieldErrors.pan ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                              placeholder="ABCDE1234F"
                            />
                            {fieldErrors.pan && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.pan}</p>}
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Account Holder Name <span className="normal-case text-[9px] font-normal">(First &amp; Last name)</span></label>
                            <input
                              type="text"
                              value={signupAccountHolder}
                              onChange={(e) => {
                                const val = e.target.value;
                                if (/^[a-zA-Z\s]*$/.test(val)) {
                                  const capitalized = val.replace(/\b\w/g, (c) => c.toUpperCase());
                                  setSignupAccountHolder(capitalized);
                                  sessionStorage.setItem("signupAccountHolder", capitalized);
                                  clearFieldError("accountHolder");
                                }
                              }}
                              onBlur={() => {
                                const trimmed = signupAccountHolder.trim();
                                const parts = trimmed.split(/\s+/).filter(Boolean);
                                if (!trimmed)
                                  setFieldError("accountHolder", "Account holder name is required");
                                else if (parts.length < 2)
                                  setFieldError("accountHolder", "Please enter both first and last name");
                                else if (trimmed.length < 5)
                                  setFieldError("accountHolder", "Name is too short");
                              }}
                              className={`w-full px-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all capitalize ${fieldErrors.accountHolder ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                              placeholder="First Name Last Name"
                            />
                            {fieldErrors.accountHolder && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.accountHolder}</p>}
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">Account Number</label>
                            <input
                              type="text"
                              maxLength={18}
                              value={signupAccountNumber}
                              onChange={(e) => { 
                                const val = e.target.value.replace(/\D/g, "");
                                setSignupAccountNumber(val); 
                                sessionStorage.setItem("signupAccountNumber", val);
                                clearFieldError("accountNumber"); 
                              }}
                              onBlur={() => {
                                if (!signupAccountNumber || signupAccountNumber.length < 9 || signupAccountNumber.length > 18)
                                  setFieldError("accountNumber", "Enter a valid account number (9–18 digits)");
                              }}
                              className={`w-full px-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${fieldErrors.accountNumber ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                              placeholder="000000000000"
                            />
                            {fieldErrors.accountNumber && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.accountNumber}</p>}
                          </div>
                          <div className="space-y-1.5">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest ml-1">IFSC Code</label>
                            <input
                              type="text"
                              maxLength={11}
                              value={signupIfsc}
                              onChange={(e) => { 
                                const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
                                setSignupIfsc(val); 
                                sessionStorage.setItem("signupIfsc", val);
                                clearFieldError("ifsc"); 
                              }}
                              onBlur={(e) => {
                                if (!e.target.value)
                                  setFieldError("ifsc", "Please enter your IFSC code");
                                else if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(e.target.value))
                                  setFieldError("ifsc", "Invalid IFSC format (e.g. HDFC0001234)");
                              }}
                              className={`w-full px-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all ${fieldErrors.ifsc ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                              placeholder="HDFC0001234"
                            />
                            {fieldErrors.ifsc && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.ifsc}</p>}
                          </div>

                          <div className="flex gap-4 pt-2">
                            <button
                              onClick={() => setSignupStep(2)}
                              className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                            >
                              Back
                            </button>
                            <button
                              onClick={() => {
                                if (!signupAadharNumber || signupAadharNumber.length !== 12) {
                                  toast.error("Please enter a valid 12-digit Aadhar number");
                                  return;
                                }
                                if (!signupPanNumber || !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(signupPanNumber)) {
                                  toast.error("Please enter a valid 10-character PAN card number (e.g. ABCDE1234F)");
                                  return;
                                }
                                const holderParts = signupAccountHolder.trim().split(/\s+/).filter(Boolean);
                                if (!signupAccountHolder.trim() || holderParts.length < 2) {
                                  toast.error("Please enter the account holder's first and last name");
                                  return;
                                }
                                if (!signupAccountNumber || signupAccountNumber.length < 9 || signupAccountNumber.length > 18) {
                                  toast.error("Please enter a valid bank account number (between 9 and 18 digits)");
                                  return;
                                }
                                if (!signupIfsc || !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(signupIfsc)) {
                                  toast.error("Please enter a valid 11-character bank IFSC code (e.g. HDFC0001234)");
                                  return;
                                }
                                setSignupStep(4);
                              }}
                              className="flex-[2] py-4 bg-black text-white rounded-2xl text-sm font-black tracking-widest uppercase shadow-lg shadow-brand-200 hover:bg-brand-700 transition-all flex items-center justify-center gap-2"
                            >
                              Next Step <ArrowRight className="w-4 h-4" />
                            </button>
                          </div>
                        </motion.div>
                      )}

                      {/* Step 4: Documents Upload */}
                      {signupStep === 4 && (
                        <motion.div
                          initial={{ opacity: 0, x: 20 }}
                          animate={{ opacity: 1, x: 0 }}
                          className="space-y-4"
                        >
                          <div className="space-y-3">
                            {[
                              { label: "Aadhar Card (Front/Back)", state: aadharFile, setter: setAadharFile, id: "aadhar" },
                              { label: "PAN Card", state: panFile, setter: setPanFile, id: "pan" },
                              { label: "Driving License", state: dlFile, setter: setDlFile, id: "dl" },
                            ].map((doc) => (
                              <div key={doc.id} className="relative">
                                <input
                                  type="file"
                                  id={doc.id}
                                  className="hidden"
                                  accept="image/*"
                                  onChange={(e) => {
                                    const file = e.target.files[0];
                                    if (doc.id === "dl") handleDLUpload(file);
                                    else if (doc.id === "pan") handlePanUpload(file);
                                    else if (doc.id === "aadhar") handleAadharUpload(file);
                                    else doc.setter(file);
                                  }}
                                />
                                <label
                                  htmlFor={doc.id}
                                  className={`flex items-center justify-between p-4 rounded-2xl border-2 border-dashed transition-all cursor-pointer ${doc.state
                                    ? "border-brand-200 bg-brand-50/50"
                                    : "border-gray-100 bg-gray-50 hover:border-brand-200 hover:bg-brand-50/30"
                                    }`}
                                >
                                  <div className="flex items-center gap-3">
                                    <div className={`p-2 rounded-xl ${doc.state ? "bg-brand-100 text-brand-600" : "bg-white text-gray-400 shadow-sm"}`}>
                                      {doc.state ? <CheckCircle className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                                    </div>
                                    <div className="text-left">
                                      <p className={`text-xs font-black uppercase tracking-tight ${doc.state ? "text-brand-700" : "text-gray-500"}`}>
                                        {doc.label}
                                      </p>
                                      <p className="text-[10px] text-gray-400 font-bold truncate max-w-[180px]">
                                        {doc.state ? doc.state.name : "Tap to upload document"}
                                      </p>
                                    </div>
                                  </div>
                                  {doc.state && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        if (doc.id === "dl") handleDLUpload(null);
                                        else if (doc.id === "pan") handlePanUpload(null);
                                        else if (doc.id === "aadhar") handleAadharUpload(null);
                                        else {
                                          doc.setter(null);
                                          removeRegistrationFile(doc.id);
                                        }
                                      }}
                                      className="p-1.5 hover:bg-brand-100 rounded-lg text-brand-600 transition-colors"
                                    >
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </label>

                              </div>
                            ))}
                            <p className="text-[10px] text-gray-400 italic px-1 flex items-center gap-1.5">
                              <ShieldCheck className="w-3 h-3 text-brand-300" />
                              Documents will be verified by our team after submission.
                            </p>
                          </div>

                          <div className="flex gap-3">
                            <button
                              onClick={() => setSignupStep(3)}
                              className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl text-sm font-black uppercase tracking-widest hover:bg-gray-200 transition-all"
                            >
                              Back
                            </button>
                            <button
                              onClick={handleSendOtp}
                              disabled={loading || !aadharFile || !panFile || (signupVehicle !== 'cycle' && !dlFile)}
                              className="flex-[2] py-4 bg-black text-white rounded-2xl text-sm font-black tracking-widest uppercase shadow-lg shadow-brand-200 hover:bg-brand-700 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              {loading ? (
                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                              ) : (
                                <>
                                  Register <ArrowRight className="w-4 h-4" />
                                </>
                              )}
                            </button>
                          </div>
                        </motion.div>
                      )}

                    </div>
                  )}

                  {/* ────────── LOGIN MODE ────────── */}
                  {mode === "login" && (
                    <div className="space-y-4">
                      {/* Phone */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-black text-gray-400 uppercase tracking-widest ml-1">
                          Phone Number
                        </label>
                        <div className="relative">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-300 w-4 h-4" />
                          <span className="absolute left-10 top-1/2 -translate-y-1/2 text-gray-500 font-bold text-sm border-r border-gray-200 pr-2.5">
                            +91
                          </span>
                          <input
                            type="tel"
                            value={loginPhone}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, "").slice(0, 10);
                              setLoginPhone(val);
                              clearFieldError("loginPhone");
                            }}
                            onBlur={() => {
                              if (!loginPhone || !/^[6-9]\d{9}$/.test(loginPhone))
                                setFieldError("loginPhone", "Enter a valid 10-digit number starting with 6-9");
                            }}
                            maxLength={10}
                            className={`w-full pl-24 pr-4 py-3.5 bg-gray-50 border rounded-2xl text-sm font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-500/20 transition-all placeholder:text-gray-300 ${fieldErrors.loginPhone ? "border-red-400 focus:border-red-400" : "border-gray-100 focus:border-brand-400"}`}
                            placeholder="00000 00000"
                          />
                        </div>
                        {fieldErrors.loginPhone && <p className="text-[10px] text-red-500 font-semibold ml-1 mt-0.5">{fieldErrors.loginPhone}</p>}
                      </div>

                      <button
                        onClick={handleSendOtp}
                        disabled={loading}
                        className="w-full py-4 bg-black text-white rounded-2xl text-sm font-black tracking-widest uppercase shadow-lg shadow-brand-200 hover:bg-brand-700 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 mt-2 disabled:opacity-60"
                      >
                        {loading ? (
                          <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                          <>Login Now <ArrowRight className="w-4 h-4" /></>
                        )}
                      </button>
                    </div>
                  )}
                </motion.div>
              )}

              {/* ─── OTP STEP ─── */}
              {step === "otp" && (
                <motion.div
                  key="otp"
                  variants={slideVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="space-y-5"
                >
                  {/* OTP Boxes */}
                  <div className="space-y-2 text-center">
                    <label className="text-xs font-black text-gray-400 uppercase tracking-widest">
                      Enter Security Code
                    </label>
                    <div className="flex justify-center gap-3 pt-1">
                      {otp.map((digit, index) => (
                        <input
                          key={index}
                          id={`otp-${index}`}
                          type="tel"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(index, e.target.value)}
                          onKeyDown={(e) => handleKeyDown(index, e)}
                          className="w-14 h-14 text-center text-2xl font-black border-2 border-gray-100 rounded-2xl focus:border-brand-500 focus:ring-4 focus:ring-brand-100 outline-none transition-all bg-gray-50 text-gray-900"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Timer / Resend */}
                  <div className="text-center">
                    {timer > 0 ? (
                      <p className="text-gray-400 text-sm font-medium">
                        Resend code in <span className="text-brand-600 font-bold">{timer}s</span>
                      </p>
                    ) : (
                      <button
                        onClick={handleSendOtp}
                        className="text-brand-600 font-black text-sm uppercase tracking-wide hover:underline"
                      >
                        Resend OTP
                      </button>
                    )}
                  </div>

                  {/* Verify Button */}
                  <button
                    onClick={handleVerifyOtp}
                    disabled={otp.some((d) => !d) || loading}
                    className="w-full py-4 bg-black text-white rounded-2xl text-sm font-black tracking-widest uppercase shadow-lg shadow-brand-200 hover:bg-brand-700 hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    ) : (
                      <>Verify &amp; Login <CheckCircle className="w-4 h-4" /></>
                    )}
                  </button>

                  {/* Back */}
                  <button
                    onClick={() => { setStep("form"); setOtp(["", "", "", ""]); }}
                    className="w-full flex items-center justify-center gap-1.5 text-gray-400 hover:text-gray-600 text-sm font-bold transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" /> Edit Phone Number
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex items-center justify-center gap-3 opacity-40">
          <span className="h-px w-8 bg-gray-400" />
          <ShieldCheck className="text-gray-500 w-4 h-4" />
          <span className="h-px w-8 bg-gray-400" />
        </div>
        <p className="text-center text-[10px] font-black text-gray-300 uppercase tracking-[4px] mt-2">
          {appName} Partner Ecosystem • v1.0
        </p>
      </motion.div>

      {/* Pending Approval Modal */}
      <AnimatePresence>
        {showPendingModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
              onClick={() => {
                setShowPendingModal(false);
                setStep("form");
                setMode("login");
                setOtp(["", "", "", ""]);
                try {
                  sessionStorage.removeItem("pending_delivery_id");
                  sessionStorage.removeItem("pending_delivery_phone");
                  sessionStorage.removeItem("pending_delivery_token");
                  localStorage.removeItem("pending_delivery_id");
                  localStorage.removeItem("pending_delivery_phone");
                  localStorage.removeItem("pending_delivery_token");
                } catch {
                  /* ignore */
                }
              }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-sm bg-white rounded-3xl p-6 shadow-2xl overflow-hidden text-center"
            >
              <div className="w-20 h-20 bg-brand-50 rounded-full flex items-center justify-center mx-auto mb-4 border border-brand-100">
                <FileText className="w-10 h-10 text-brand-500" />
              </div>
              <h3 className="ds-h3 mb-2 text-gray-900">Application Under Review</h3>
              
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 border border-amber-200">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                </span>
                Waiting for admin approval...
              </div>

              <p className="text-sm text-gray-500 mb-6">
                Your application has been successfully submitted! Our team is currently reviewing your documents and details. Dashboard access unlocks automatically once admin approves your account.
              </p>
              <button
                onClick={() => {
                  setShowPendingModal(false);
                  setStep("form");
                  setMode("login");
                  setOtp(["", "", "", ""]);
                  try {
                    sessionStorage.removeItem("pending_delivery_id");
                    sessionStorage.removeItem("pending_delivery_phone");
                    sessionStorage.removeItem("pending_delivery_token");
                    localStorage.removeItem("pending_delivery_id");
                    localStorage.removeItem("pending_delivery_phone");
                    localStorage.removeItem("pending_delivery_token");
                  } catch {
                    /* ignore */
                  }
                }}
                className="w-full py-4 bg-black text-white rounded-2xl text-sm font-black tracking-widest uppercase shadow-lg shadow-brand-200 hover:bg-brand-700 transition-all flex items-center justify-center gap-2"
              >
                Back to Login
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default DeliveryAuth;
