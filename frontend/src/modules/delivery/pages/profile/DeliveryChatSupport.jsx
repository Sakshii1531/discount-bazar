import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Send,
  Phone,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  X,
  Headphones,
  Package,
  HelpCircle,
  AlertTriangle,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useSettings } from "@core/context/SettingsContext";
import { useAuth } from "@core/context/AuthContext";
import axiosInstance from "@core/api/axios";
import { deliveryApi } from "../../services/deliveryApi";
import {
  joinTicketRoom,
  leaveTicketRoom,
  onTicketMessage,
} from "@/core/services/orderSocket";
import { toast } from "sonner";

function formatTime(value) {
  if (!value) return "";
  try {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function normalizeTicketMessages(rawMessages = []) {
  const list = Array.isArray(rawMessages) ? rawMessages : [];
  return list.map((m, idx) => {
    const createdAt = m?.createdAt || null;
    return {
      id: m?._id || m?.id || `${createdAt || Date.now()}-${idx}`,
      text: m?.text || "",
      mediaUrl: m?.mediaUrl || "",
      mediaType: m?.mediaType || "",
      sender: m?.isAdmin ? "support" : "user",
      createdAt,
      time: formatTime(createdAt),
    };
  });
}

function mergeIncomingMessage(prev, incoming) {
  const next = Array.isArray(prev) ? prev : [];
  if (!incoming) return next;

  const last = next[next.length - 1];
  if (
    last &&
    last.text === incoming.text &&
    String(last.mediaUrl || "") === String(incoming.mediaUrl || "") &&
    last.sender === incoming.sender &&
    (last.createdAt && incoming.createdAt ? last.createdAt === incoming.createdAt : true)
  ) {
    return next;
  }

  return [...next, incoming];
}

const QUICK_TOPICS = [
  "📦 Order Issue",
  "💰 Payout / Cash Query",
  "📍 Customer Address Not Found",
  "🚨 Road Emergency / Accident",
];

const DeliveryChatSupport = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { settings } = useSettings();

  const [ticketId, setTicketId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [selectedImageFile, setSelectedImageFile] = useState(null);
  const [selectedImagePreview, setSelectedImagePreview] = useState(null);

  const messagesEndRef = useRef(null);
  const fileInputRef = useRef(null);
  const ticketIdRef = useRef(null);
  ticketIdRef.current = ticketId;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, selectedImagePreview]);

  // Load existing ticket or prepare for new
  const loadTicketData = async () => {
    try {
      setLoading(true);
      const res = await deliveryApi.getMyTickets();
      const tickets = res?.data?.result || res?.data?.data || [];

      // Look for the latest open/processing ticket for Delivery
      const activeTicket = tickets.find(
        (t) => t.status === "open" || t.status === "processing"
      ) || tickets[0];

      if (activeTicket?._id) {
        setTicketId(activeTicket._id);
        ticketIdRef.current = activeTicket._id;
        joinTicketRoom(activeTicket._id);
        setMessages(normalizeTicketMessages(activeTicket.messages));
      } else {
        setTicketId(null);
        ticketIdRef.current = null;
        setMessages([]);
      }
    } catch (err) {
      console.error("Failed to load delivery support chat:", err);
      toast.error("Could not load support chat");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTicketData();

    const cleanupSocket = onTicketMessage((incoming) => {
      const currentId = ticketIdRef.current;
      if (!currentId || String(incoming.ticketId) !== String(currentId)) {
        return;
      }
      const raw = incoming.message;
      const normalized = {
        id: raw._id || raw.id || `${Date.now()}-${Math.random()}`,
        text: raw.text || "",
        mediaUrl: raw.mediaUrl || "",
        mediaType: raw.mediaType || "",
        sender: raw.isAdmin ? "support" : "user",
        createdAt: raw.createdAt || new Date().toISOString(),
        time: formatTime(raw.createdAt || new Date()),
      };
      setMessages((prev) => mergeIncomingMessage(prev, normalized));
    });

    return () => {
      if (ticketIdRef.current) {
        leaveTicketRoom(ticketIdRef.current);
      }
      if (typeof cleanupSocket === "function") {
        cleanupSocket();
      }
    };
  }, []);

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
      setSelectedImageFile(file);
      setSelectedImagePreview(evt?.target?.result || null);
    };
    reader.readAsDataURL(file);
    if (e.target) e.target.value = "";
  };

  const handleSend = async (overrideText) => {
    const textToSend = typeof overrideText === "string" ? overrideText : inputText;
    const trimmed = String(textToSend || "").trim();
    if (!trimmed && !selectedImageFile) return;
    if (isSending) return;

    try {
      setIsSending(true);

      let mediaUrl = "";
      if (selectedImageFile) {
        const uploadForm = new FormData();
        uploadForm.append("file", selectedImageFile);
        const uploadRes = await axiosInstance.post("/media/upload", uploadForm, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        mediaUrl =
          uploadRes.data?.result?.url ||
          uploadRes.data?.data?.url ||
          uploadRes.data?.url ||
          "";
        if (!mediaUrl) {
          throw new Error("Failed to upload image");
        }
      }

      if (!ticketIdRef.current) {
        // Create new ticket with userType "Delivery"
        const res = await deliveryApi.createTicket({
          subject: "Rider Support Inquiry",
          description: trimmed || (mediaUrl ? "Sent an attachment" : ""),
          priority: "high",
          userType: "Delivery",
          mediaUrl,
          mediaType: mediaUrl ? "image" : "",
          mimeType: selectedImageFile?.type || "",
        });
        const created = res?.data?.result;
        if (created?._id) {
          setTicketId(created._id);
          ticketIdRef.current = created._id;
          joinTicketRoom(created._id);
          setMessages(normalizeTicketMessages(created.messages));
        }
      } else {
        const res = await deliveryApi.replyTicket(ticketIdRef.current, trimmed, {
          mediaUrl,
          mediaType: mediaUrl ? "image" : "",
          mimeType: selectedImageFile?.type || "",
        });
        const updated = res?.data?.result;
        if (updated?.messages) {
          setMessages(normalizeTicketMessages(updated.messages));
        }
      }

      setInputText("");
      setSelectedImageFile(null);
      setSelectedImagePreview(null);
    } catch (err) {
      console.error("Failed to send message:", err);
      toast.error(err?.response?.data?.message || "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-gray-900 font-sans">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-4 py-3 sticky top-0 z-20 shadow-xs flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-1 rounded-full hover:bg-gray-100 transition-colors cursor-pointer text-gray-700"
            aria-label="Back"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-teal-50 border border-teal-100 flex items-center justify-center text-teal-600 font-bold">
              <Headphones size={20} />
            </div>
            <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-emerald-500 ring-2 ring-white animate-pulse" />
          </div>
          <div>
            <h1 className="font-extrabold text-sm text-gray-900 leading-tight">
              Rider Support Chat
            </h1>
            <p className="text-[11px] font-semibold text-emerald-600 flex items-center gap-1">
              <span>●</span> Support Team Active
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={loadTicketData}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-gray-500"
            title="Refresh conversation"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => navigate("/delivery/profile/call")}
            className="p-2 rounded-full hover:bg-gray-100 transition-colors text-teal-600 font-semibold"
            title="Call Support"
          >
            <Phone size={18} />
          </button>
        </div>
      </div>

      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400">
            <Loader2 size={28} className="animate-spin text-teal-600 mb-2" />
            <p className="text-xs font-semibold">Loading conversation…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div className="w-14 h-14 rounded-2xl bg-teal-50 text-teal-600 flex items-center justify-center mb-3">
              <Headphones size={28} />
            </div>
            <h3 className="font-bold text-gray-800 text-base mb-1">
              How can we help you, {user?.name?.split(" ")?.[0] || "Partner"}?
            </h3>
            <p className="text-xs text-gray-500 max-w-xs mb-6">
              Our partner operations team is here to assist you with order, payout, or delivery issues.
            </p>

            {/* Quick action chips */}
            <div className="w-full max-w-sm space-y-2">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider text-left pl-1">
                Quick Inquiries
              </p>
              <div className="grid grid-cols-1 gap-2">
                {QUICK_TOPICS.map((topic, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(topic)}
                    className="w-full text-left px-3.5 py-2.5 rounded-xl bg-white border border-gray-200/80 hover:border-teal-400 hover:bg-teal-50/40 text-xs font-semibold text-gray-700 transition-all shadow-2xs cursor-pointer active:scale-98"
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((m) => {
            const isMe = m.sender === "user";
            return (
              <motion.div
                key={m.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col ${isMe ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-xs shadow-2xs leading-relaxed ${
                    isMe
                      ? "bg-primary text-white rounded-br-xs"
                      : "bg-white text-gray-800 border border-gray-100 rounded-bl-xs"
                  }`}
                >
                  {m.mediaUrl && (
                    <div className="mb-2 rounded-lg overflow-hidden max-w-xs">
                      <img
                        src={m.mediaUrl}
                        alt="attachment"
                        className="w-full max-h-48 object-cover rounded-lg"
                      />
                    </div>
                  )}
                  {m.text && <p className="whitespace-pre-wrap">{m.text}</p>}
                  <p
                    className={`text-[9px] mt-1 font-semibold text-right ${
                      isMe ? "text-white/75" : "text-gray-400"
                    }`}
                  >
                    {m.time}
                  </p>
                </div>
              </motion.div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Selected Image Preview */}
      <AnimatePresence>
        {selectedImagePreview && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="p-3 bg-white border-t border-gray-100 flex items-center gap-3"
          >
            <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-gray-200">
              <img
                src={selectedImagePreview}
                alt="Selected"
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => {
                  setSelectedImageFile(null);
                  setSelectedImagePreview(null);
                }}
                className="absolute top-1 right-1 bg-black/60 text-white rounded-full p-0.5"
              >
                <X size={12} />
              </button>
            </div>
            <p className="text-xs text-gray-500 font-medium truncate flex-1">
              Ready to send photo
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Input Bar */}
      <div className="bg-white border-t border-gray-100 p-3 sticky bottom-0 z-20 shadow-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-2"
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept="image/*"
            className="hidden"
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-full text-gray-500 hover:text-teal-600 hover:bg-gray-100 transition-colors"
            title="Attach image"
          >
            <ImageIcon size={19} />
          </button>

          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type your message to support..."
            disabled={isSending}
            className="flex-1 bg-gray-50 border border-gray-200/80 rounded-2xl px-4 py-2.5 text-xs text-gray-900 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all placeholder:text-gray-400"
          />

          <button
            type="submit"
            disabled={(!inputText.trim() && !selectedImageFile) || isSending}
            className={`w-10 h-10 rounded-full flex items-center justify-center text-white transition-all shadow-sm ${
              (!inputText.trim() && !selectedImageFile) || isSending
                ? "bg-gray-300 cursor-not-allowed"
                : "bg-primary hover:bg-primary/90 active:scale-95"
            }`}
          >
            {isSending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default DeliveryChatSupport;
