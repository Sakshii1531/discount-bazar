import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Landmark, CreditCard, AlertTriangle, CheckCircle2, Loader2, Eye, EyeOff } from "lucide-react";
import Button from "@/shared/components/ui/Button";
import Card from "@/shared/components/ui/Card";
import Input from "@/shared/components/ui/Input";
import { deliveryApi } from "../../services/deliveryApi";
import { toast } from "sonner";

const IFSC_BANK_MAP = {
  SBIN: "State Bank of India",
  HDFC: "HDFC Bank",
  ICIC: "ICICI Bank",
  UTIB: "Axis Bank",
  PUNB: "Punjab National Bank",
  BARB: "Bank of Baroda",
  CNRB: "Canara Bank",
  UBIN: "Union Bank of India",
  IDIB: "Indian Bank",
  IOBA: "Indian Overseas Bank",
  KKBK: "Kotak Mahindra Bank",
  YESB: "Yes Bank",
  INDB: "IndusInd Bank",
  BKID: "Bank of India",
  CBIN: "Central Bank of India",
  ANDB: "Andhra Bank",
  CORP: "Corporation Bank",
  ALLA: "Allahabad Bank",
  SYNB: "Syndicate Bank",
  VIJB: "Vijaya Bank",
  MAHB: "Bank of Maharashtra",
  PSIB: "Punjab & Sind Bank",
  UCOB: "UCO Bank",
  IDFB: "IDFC FIRST Bank",
  FDRL: "Federal Bank",
  AUBL: "AU Small Finance Bank",
  AIRP: "Airtel Payments Bank",
  PYTM: "Paytm Payments Bank",
  IPOS: "India Post Payments Bank"
};

const resolveBankNameFromIfsc = (ifsc) => {
  if (!ifsc || typeof ifsc !== 'string') return null;
  const prefix = ifsc.trim().substring(0, 4).toUpperCase();
  return IFSC_BANK_MAP[prefix] || (prefix ? `${prefix} Bank` : "Bank Account");
};

const BankAccount = () => {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showFullAccount, setShowFullAccount] = useState(false);

  const [bankDetails, setBankDetails] = useState({
    accountHolder: "",
    accountNumber: "",
    ifsc: "",
    bankName: "Bank Account",
    status: "Active",
  });

  const [newAccount, setNewAccount] = useState("");
  const [confirmAccount, setConfirmAccount] = useState("");
  const [ifscCode, setIfscCode] = useState("");
  
  const [accountError, setAccountError] = useState("");
  const [confirmError, setConfirmError] = useState("");
  const [ifscError, setIfscError] = useState("");

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setLoading(true);
        const res = await deliveryApi.getProfile();
        const profile = res.data?.result || res.data?.data || {};
        const accNum = profile.accountNumber || "";
        const ifscVal = profile.ifsc || "";
        const holder = profile.accountHolder || profile.name || "Partner";

        setBankDetails({
          accountHolder: holder,
          accountNumber: accNum,
          ifsc: ifscVal,
          bankName: resolveBankNameFromIfsc(ifscVal) || "Bank Account",
          status: accNum ? "Active" : "Not Set",
        });
      } catch (err) {
        console.error("Failed to fetch bank details:", err);
        toast.error("Failed to load bank details");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleNewAccountChange = (e) => {
    const value = e.target.value.replace(/\D/g, "");
    setNewAccount(value);
    
    if (value.length > 0 && (value.length < 9 || value.length > 18)) {
      setAccountError("Account number must be between 9 and 18 digits");
    } else {
      setAccountError("");
    }
    
    if (confirmAccount && value !== confirmAccount) {
      setConfirmError("Account numbers do not match");
    } else if (confirmAccount) {
      setConfirmError("");
    }
  };

  const handleConfirmAccountChange = (e) => {
    const value = e.target.value.replace(/\D/g, "");
    setConfirmAccount(value);
    
    if (value && value !== newAccount) {
      setConfirmError("Account numbers do not match");
    } else {
      setConfirmError("");
    }
  };

  const handleIfscChange = (e) => {
    const value = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    setIfscCode(value);
    
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (value.length > 0 && !ifscRegex.test(value)) {
      setIfscError("Invalid IFSC format (e.g. HDFC0001234)");
    } else {
      setIfscError("");
    }
  };

  const handleUpdate = async () => {
    if (!newAccount || newAccount.length < 9 || newAccount.length > 18) {
      setAccountError("Enter a valid account number (9–18 digits)");
      return;
    }
    if (newAccount !== confirmAccount) {
      setConfirmError("Account numbers do not match");
      return;
    }
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(ifscCode)) {
      setIfscError("Enter a valid 11-digit IFSC code");
      return;
    }

    try {
      setIsUpdating(true);
      const res = await deliveryApi.updateProfile({
        accountNumber: newAccount,
        ifsc: ifscCode,
        accountHolder: bankDetails.accountHolder || undefined,
      });

      if (res.data?.success) {
        toast.success("Bank account updated successfully!");
        setBankDetails((prev) => ({
          ...prev,
          accountNumber: newAccount,
          ifsc: ifscCode,
          bankName: resolveBankNameFromIfsc(ifscCode) || "Bank Account",
          status: "Active",
        }));
        setNewAccount("");
        setConfirmAccount("");
        setIfscCode("");
        setAccountError("");
        setConfirmError("");
        setIfscError("");
      } else {
        toast.error(res.data?.message || "Failed to update bank details");
      }
    } catch (err) {
      console.error("Update error:", err);
      toast.error(err.response?.data?.message || "Failed to update bank details");
    } finally {
      setIsUpdating(false);
    }
  };

  const formatDisplayAccount = (acc) => {
    if (!acc) return "Not Provided";
    if (showFullAccount) return acc;
    if (acc.length <= 4) return acc;
    return `•••• •••• •••• ${acc.slice(-4)}`;
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      {/* Header */}
      <div className="bg-white shadow-sm sticky top-0 z-10">
        <div className="flex items-center p-4">
          <button 
            onClick={() => navigate(-1)} 
            className="p-2 rounded-full hover:bg-gray-100 transition-colors mr-2"
          >
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <h1 className="ds-h3 text-gray-900">Bank Account</h1>
        </div>
      </div>

      <div className="p-4 max-w-lg mx-auto space-y-6">
        {/* Bank Card Visual */}
        <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white p-6 rounded-2xl shadow-xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
          
          <div className="flex justify-between items-start mb-8 relative z-10">
            <Landmark size={32} className="text-white/80" />
            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border flex items-center ${
              bankDetails.accountNumber 
                ? "bg-green-500/20 text-green-400 border-green-500/30"
                : "bg-amber-500/20 text-amber-400 border-amber-500/30"
            }`}>
              <CheckCircle2 size={12} className="mr-1" /> {bankDetails.status}
            </span>
          </div>

          <div className="space-y-1 relative z-10">
            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-xs uppercase tracking-wider">Account Number</p>
              {bankDetails.accountNumber && (
                <button
                  type="button"
                  onClick={() => setShowFullAccount(!showFullAccount)}
                  className="text-gray-400 hover:text-white flex items-center gap-1 text-[11px] transition-colors"
                >
                  {showFullAccount ? <EyeOff size={14} /> : <Eye size={14} />}
                  <span>{showFullAccount ? "Hide" : "Show"}</span>
                </button>
              )}
            </div>
            {loading ? (
              <div className="h-8 w-40 bg-white/10 rounded animate-pulse my-1" />
            ) : (
              <p className="font-mono text-2xl tracking-widest select-all">
                {formatDisplayAccount(bankDetails.accountNumber)}
              </p>
            )}
          </div>

          <div className="flex justify-between items-end mt-8 relative z-10">
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wider mb-1">Account Holder</p>
              {loading ? (
                <div className="h-5 w-28 bg-white/10 rounded animate-pulse" />
              ) : (
                <p className="font-bold text-lg">{bankDetails.accountHolder || "Not Configured"}</p>
              )}
            </div>
            <div className="text-right">
              {loading ? (
                <div className="h-5 w-24 bg-white/10 rounded animate-pulse mb-1 ml-auto" />
              ) : (
                <>
                  <p className="text-white font-bold">{bankDetails.bankName}</p>
                  <p className="text-gray-400 text-xs font-mono">{bankDetails.ifsc || "IFSC Not Set"}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-yellow-50 border border-yellow-100 p-4 rounded-xl flex items-start">
          <AlertTriangle size={20} className="text-yellow-600 mr-3 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-yellow-800 font-bold text-sm mb-1">Payment Information</h4>
            <p className="text-xs text-yellow-700 leading-relaxed">
              Your weekly earnings will be deposited to this account. 
              Changes to bank details may take a short time to verify before your next payout.
            </p>
          </div>
        </div>

        {/* Change Request Form */}
        <div className="pt-4">
          <h3 className="ds-h4 text-gray-900 mb-4">Request Change</h3>
          <div className="space-y-4">
            <Input 
              label="New Account Number" 
              placeholder="Enter account number" 
              icon={CreditCard}
              value={newAccount}
              onChange={handleNewAccountChange}
              helperText={accountError}
              error={!!accountError}
            />
            <Input 
              label="Confirm Account Number" 
              placeholder="Re-enter account number" 
              icon={CreditCard}
              value={confirmAccount}
              onChange={handleConfirmAccountChange}
              helperText={confirmError}
              error={!!confirmError}
            />
            <Input 
              label="IFSC Code" 
              placeholder="Enter IFSC code" 
              icon={Landmark}
              value={ifscCode}
              onChange={handleIfscChange}
              helperText={ifscError}
              error={!!ifscError}
              maxLength={11}
            />
            <Button 
              className="w-full mt-2" 
              variant="outline"
              disabled={isUpdating || !!accountError || !!confirmError || !!ifscError || !newAccount || !confirmAccount || !ifscCode}
              onClick={handleUpdate}
            >
              {isUpdating ? (
                <span className="flex items-center justify-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Updating...
                </span>
              ) : (
                "Verify & Update"
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BankAccount;
