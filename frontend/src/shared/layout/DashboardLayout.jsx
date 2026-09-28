import React, { useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import Sidebar from './Sidebar';
import Topbar from './Topbar';
import BottomNav from './BottomNav';
import { sellerApi } from '@/modules/seller/services/sellerApi';
import { useAuth } from "@core/context/AuthContext";
import { motion, AnimatePresence } from 'framer-motion';
import { BellRing, Check, X, Clock, Truck, RotateCcw, AlertTriangle, Loader2, Eye, ChevronDown, Minimize2, ArrowUpRight, MapPin } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import SellerOrdersContext from '@/modules/seller/context/SellerOrdersContext';
import SellerEarningsContext, { defaultEarnings } from '@/modules/seller/context/SellerEarningsContext';
import { getOrderSocket, onSellerOrderNew, onReturnDropOtp, onSellerReturnRequested, onAdminWithdrawalNew } from '@/core/services/orderSocket';
import { createSocketTokenReader } from '@core/utils/authStorage';
import { STORAGE_KEYS } from '@core/utils/storage';
import orderAlertSound from '@/assets/sounds/order_alert.mp3';
import { formatAmount } from "@shared/utils/currency";

const POLL_INTERVAL_MS = 15000;

let synthInterval = null;
let audioCtx = null;

const playRingtoneChime = () => {
    try {
        const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === "suspended") {
            audioCtx.resume();
        }
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.3);

        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.4);

        osc.connect(gain);
        gain.connect(audioCtx.destination);

        osc.start();
        osc.stop(audioCtx.currentTime + 0.4);
    } catch (e) {
        /* ignore synth errors */
    }
};

const startWebAudioBeepRingtone = () => {
    if (synthInterval) return;
    playRingtoneChime();
    synthInterval = setInterval(() => {
        playRingtoneChime();
    }, 800);
};

const playRingingTone = () => {
    try {
        const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
        if (!Ctx) return;
        if (!audioCtx) audioCtx = new Ctx();
        if (audioCtx.state === "suspended") {
            audioCtx.resume().catch(() => {});
        }
        const now = audioCtx.currentTime;

        [800, 1000].forEach((freq) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.setValueAtTime(freq, now);
            gain.gain.setValueAtTime(0.35, now);
            gain.gain.exponentialRampToValueAtTime(0.01, now + 0.5);
            osc.connect(gain);
            gain.connect(audioCtx.destination);
            osc.start(now);
            osc.stop(now + 0.5);
        });

        const delay = 0.2;
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.type = "triangle";
        osc2.frequency.setValueAtTime(1200, now + delay);
        gain2.gain.setValueAtTime(0.35, now + delay);
        gain2.gain.exponentialRampToValueAtTime(0.01, now + delay + 0.5);
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.start(now + delay);
        osc2.stop(now + delay + 0.5);
    } catch (e) {
        /* ignore synth errors */
    }
};

const stopWebAudioBeepRingtone = () => {
    if (synthInterval) {
        clearInterval(synthInterval);
        synthInterval = null;
    }
};

/** Match server `sellerPendingExpiresAt` — never reset to a full 60s when the modal opens late. */
function secondsLeftUntilSellerExpiry(order) {
    if (!order) return 0;
    const raw = order.sellerPendingExpiresAt ?? order.expiresAt;
    if (!raw) return 3600;
    const ms = new Date(raw).getTime() - Date.now();
    return Math.max(0, Math.ceil(ms / 1000));
}

/** 3599 -> "59m 59s", 45 -> "45 seconds" */
function formatAcceptCountdown(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds));
    if (s < 60) return `${s} ${s === 1 ? "second" : "seconds"}`;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}h ${m}m ${sec}s` : `${m}m ${String(sec).padStart(2, "0")}s`;
}

function isSellerAlertEligible(order) {
    if (!order?.orderId) return false;
    const ws = String(order.workflowStatus || '').toUpperCase();
    const status = String(order.status || '').toLowerCase();
    const hasExpiry = Boolean(order.sellerPendingExpiresAt ?? order.expiresAt);

    if (hasExpiry && secondsLeftUntilSellerExpiry(order) <= 0) return false;
    if (ws) return ws === 'SELLER_PENDING';

    // Backward compatibility: older payloads may not include workflowStatus.
    return status === 'pending';
}

const isEarningsRoute = (path) =>
    path.includes('earnings') || path.includes('withdrawals') || path.includes('transactions');

const DashboardLayout = ({ children, navItems, title }) => {
    const [newOrderAlert, setNewOrderAlert] = useState(null);
    const [newReturnAlert, setNewReturnAlert] = useState(null);
    const [shownOrderIds, setShownOrderIds] = useState(() => new Set());
    const [shownReturnOrderIds, setShownReturnOrderIds] = useState(() => new Set());
    const [timeLeft, setTimeLeft] = useState(0);
    /** Total seconds in this acceptance window (for progress bar), set when modal opens */
    const acceptWindowTotalRef = useRef(3600);
    // "View Details" panel inside the new-order popup
    const [orderDetailsOpen, setOrderDetailsOpen] = useState(false);
    const [orderDetails, setOrderDetails] = useState(null);
    const [orderDetailsLoading, setOrderDetailsLoading] = useState(false);
    // New-order popup can be minimized to a floating card so the seller can use the panel
    // (check stock / products) while deciding; alarm pauses while minimized.
    const [orderAlertMinimized, setOrderAlertMinimized] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [returnDropOtpAlert, setReturnDropOtpAlert] = useState(null); // { orderId, otp, expiresAt }
    const [returnActionLoading, setReturnActionLoading] = useState(false);
    const [showRejectInput, setShowRejectInput] = useState(false);
    const [rejectReturnReason, setRejectReturnReason] = useState("");
    const [pushPermission, setPushPermission] = useState(() => {
        if (typeof Notification === 'undefined') return 'granted';
        return Notification.permission;
    });
    const [isPermissionBannerDismissed, setIsPermissionBannerDismissed] = useState(() => {
        if (typeof window === 'undefined') return false;
        return sessionStorage.getItem('seller_dismissed_notif_banner') === '1';
    });
    const [isEnablingPush, setIsEnablingPush] = useState(false);
    const { user, logout, role } = useAuth();
    const location = useLocation();
    const navigate = useNavigate();

    const handleEnablePushNotifications = async () => {
        setIsEnablingPush(true);
        try {
            const { ensureFcmTokenRegistered } = await import('@core/firebase/pushClient');
            const token = await ensureFcmTokenRegistered({ role: 'seller', platform: 'web' });
            if (token) {
                setPushPermission('granted');
                toast.success("Order & return push notifications enabled!");
            } else {
                toast.info("Notifications are enabled for your store.");
            }
        } catch (err) {
            console.error("Failed to enable notifications:", err);
            toast.error(err?.message || "Please allow notifications in your browser settings.");
        } finally {
            setIsEnablingPush(false);
        }
    };

    // Ensure all dashboard/seller pages open from the top when navigating
    useEffect(() => {
        const resetScroll = () => {
            window.scrollTo({ top: 0, left: 0, behavior: "instant" });
            document.documentElement.scrollTop = 0;
            document.body.scrollTop = 0;
            const scrollables = document.querySelectorAll(
                "main, .overflow-y-auto, .overflow-auto, [data-lenis-prevent]"
            );
            scrollables.forEach((el) => {
                el.scrollTop = 0;
            });
        };
        resetScroll();
        const raf = requestAnimationFrame(resetScroll);
        const timer = setTimeout(resetScroll, 50);
        return () => {
            cancelAnimationFrame(raf);
            clearTimeout(timer);
        };
    }, [location.pathname, location.search]);

    // Shared data for seller – single source, avoids duplicate API calls
    const [sellerOrders, setSellerOrders] = useState([]);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [sellerEarningsData, setSellerEarningsData] = useState(defaultEarnings);
    const [earningsLoading, setEarningsLoading] = useState(false);

    const shownOrderIdsRef = useRef(new Set());
    const shownReturnOrderIdsRef = useRef(new Set());
    const isFirstLoadRef = useRef(true);
    const newOrderAlertRef = useRef(null);
    const newReturnAlertRef = useRef(null);
    const fetchOrdersRef = useRef(null);
    const isOrdersFetchInFlightRef = useRef(false);
    const earningsFetchedRef = useRef(false);
    const orderRingtoneRef = useRef(null);
    const ringtoneRetryTimerRef = useRef(null);
    const ringtoneUnlockHandlerRef = useRef(null);
    const withdrawalAudioRef = useRef(null);
    const withdrawalRingTimerRef = useRef(null);
    const lastToastWithdrawalIdRef = useRef(null);

    const playWithdrawalRing = () => {
        try {
            if (!withdrawalAudioRef.current) {
                withdrawalAudioRef.current = new Audio(orderAlertSound);
                withdrawalAudioRef.current.preload = 'auto';
            }
            const a = withdrawalAudioRef.current;
            a.volume = 1;
            a.muted = false;
            a.currentTime = 0;
            const p = a.play();
            if (p && typeof p.catch === 'function') {
                p.catch((err) => {
                    console.warn("[DashboardLayout] withdrawalAudio play error, falling back:", err);
                    try {
                        const fallback = new Audio('/sounds/order_alert.mp3');
                        fallback.volume = 1;
                        fallback.currentTime = 0;
                        fallback.play().catch(() => {
                            // Fallback to synth tone only if audio files are blocked
                            playRingingTone();
                        });
                        withdrawalAudioRef.current = fallback;
                    } catch (_) {
                        playRingingTone();
                    }
                });
            }
        } catch (err) {
            console.warn("[DashboardLayout] audio play failed:", err);
            playRingingTone();
        }

        setTimeout(() => {
            stopWithdrawalRing();
        }, 8000);
    };

    const stopWithdrawalRing = () => {
        if (withdrawalRingTimerRef.current) {
            clearInterval(withdrawalRingTimerRef.current);
            withdrawalRingTimerRef.current = null;
        }
        if (withdrawalAudioRef.current) {
            try {
                withdrawalAudioRef.current.pause();
                withdrawalAudioRef.current.currentTime = 0;
            } catch (_) {}
        }
    };

    const getOrderRingtone = () => {
        if (!orderRingtoneRef.current) {
            const audio = new Audio(orderAlertSound);
            audio.loop = true;
            audio.preload = 'auto';
            orderRingtoneRef.current = audio;
        }
        return orderRingtoneRef.current;
    };

    useEffect(() => {
        const unlockAudio = () => {
            if (!withdrawalAudioRef.current) {
                withdrawalAudioRef.current = new Audio(orderAlertSound);
                withdrawalAudioRef.current.preload = 'auto';
            }
            withdrawalAudioRef.current.play().then(() => {
                withdrawalAudioRef.current.pause();
                withdrawalAudioRef.current.currentTime = 0;
            }).catch(() => {});

            const audio = getOrderRingtone();
            audio.play().then(() => {
                audio.pause();
                audio.currentTime = 0;
            }).catch(() => {});
            const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
            if (Ctx) {
                if (!audioCtx) audioCtx = new Ctx();
                if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
            }
        };

        window.addEventListener("pointerdown", unlockAudio, { once: true });
        window.addEventListener("touchstart", unlockAudio, { once: true });
        window.addEventListener("keydown", unlockAudio, { once: true });

        const keepResumed = () => {
            const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
            if (Ctx && audioCtx && audioCtx.state === "suspended") {
                audioCtx.resume().catch(() => {});
            }
        };
        window.addEventListener("pointerdown", keepResumed);
        window.addEventListener("keydown", keepResumed);

        return () => {
            window.removeEventListener("pointerdown", unlockAudio);
            window.removeEventListener("touchstart", unlockAudio);
            window.removeEventListener("keydown", unlockAudio);
            window.removeEventListener("pointerdown", keepResumed);
            window.removeEventListener("keydown", keepResumed);
        };
    }, []);

    const startOrderRingtone = () => {
        const audio = getOrderRingtone();
        audio.loop = true;
        audio.preload = 'auto';
        audio.muted = false;
        audio.volume = 1;
        audio.play().catch(() => { });
        startWebAudioBeepRingtone();

        if (!ringtoneRetryTimerRef.current) {
            ringtoneRetryTimerRef.current = setInterval(() => {
                const currentAudio = getOrderRingtone();
                if (currentAudio.paused) {
                    currentAudio.play().catch(() => { });
                }
            }, 1200);
        }

        if (!ringtoneUnlockHandlerRef.current && typeof window !== 'undefined' && typeof document !== 'undefined') {
            const unlockPlayback = () => {
                const currentAudio = getOrderRingtone();
                if (currentAudio.paused) {
                    currentAudio.play().catch(() => { });
                }
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (Ctx && audioCtx && audioCtx.state === "suspended") {
                    audioCtx.resume();
                }
            };
            ringtoneUnlockHandlerRef.current = unlockPlayback;
            window.addEventListener('focus', unlockPlayback);
            document.addEventListener('visibilitychange', unlockPlayback);
            document.addEventListener('pointerdown', unlockPlayback);
            document.addEventListener('touchstart', unlockPlayback);
            document.addEventListener('keydown', unlockPlayback);
        }
    };

    const stopOrderRingtone = () => {
        stopWebAudioBeepRingtone();
        const audio = orderRingtoneRef.current;
        if (ringtoneRetryTimerRef.current) {
            clearInterval(ringtoneRetryTimerRef.current);
            ringtoneRetryTimerRef.current = null;
        }
        if (ringtoneUnlockHandlerRef.current && typeof window !== 'undefined' && typeof document !== 'undefined') {
            window.removeEventListener('focus', ringtoneUnlockHandlerRef.current);
            document.removeEventListener('visibilitychange', ringtoneUnlockHandlerRef.current);
            document.removeEventListener('pointerdown', ringtoneUnlockHandlerRef.current);
            document.removeEventListener('touchstart', ringtoneUnlockHandlerRef.current);
            document.removeEventListener('keydown', ringtoneUnlockHandlerRef.current);
            ringtoneUnlockHandlerRef.current = null;
        }
        if (!audio) return;
        audio.pause();
        audio.currentTime = 0;
    };

    useEffect(() => {
        shownOrderIdsRef.current = shownOrderIds;
    }, [shownOrderIds]);
    useEffect(() => {
        shownReturnOrderIdsRef.current = shownReturnOrderIds;
    }, [shownReturnOrderIds]);
    useEffect(() => {
        newOrderAlertRef.current = newOrderAlert;
    }, [newOrderAlert]);
    useEffect(() => {
        newReturnAlertRef.current = newReturnAlert;
    }, [newReturnAlert]);

    useEffect(() => {
        if (role !== 'seller') {
            setSellerOrders([]);
            setOrdersLoading(false);
            return;
        }
        setOrdersLoading(true);

        const fetchOrders = async () => {
            if (isOrdersFetchInFlightRef.current) return;
            isOrdersFetchInFlightRef.current = true;
            try {
                const res = await sellerApi.getOrders();
                if (!res?.data?.success) return;

                const payload = res.data.result || {};
                const rawOrders = Array.isArray(payload.items)
                    ? payload.items
                    : (res.data.results || []);
                const allOrders = Array.isArray(rawOrders) ? rawOrders : [];
                setSellerOrders(allOrders);

                const pendingOrders = allOrders.filter(isSellerAlertEligible);

                if (isFirstLoadRef.current) {
                    isFirstLoadRef.current = false;
                }

                // Popup opened from a lightweight socket event → fill in its figures from the full order
                const openAlert = newOrderAlertRef.current;
                if (openAlert && !openAlert.paymentBreakdown) {
                    const full = allOrders.find((o) => o.orderId === openAlert.orderId);
                    if (full?.paymentBreakdown) {
                        const merged = { ...full, ...openAlert, paymentBreakdown: full.paymentBreakdown };
                        newOrderAlertRef.current = merged;
                        setNewOrderAlert(merged);
                    }
                }

                const newOrder = pendingOrders.find((o) => !shownOrderIdsRef.current.has(o.orderId));
                if (newOrder && !newOrderAlertRef.current) {
                    setNewOrderAlert(newOrder);
                    setShownOrderIds((prev) => new Set(prev).add(newOrder.orderId));
                    shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(newOrder.orderId);
                    newOrderAlertRef.current = newOrder;
                } else if (!newOrderAlertRef.current && !newReturnAlertRef.current) {
                    const returnRequestedOrders = allOrders.filter(
                        (o) => o.returnStatus === 'return_requested' || o.orderStatus === 'return_requested'
                    );
                    const unhandledReturn = returnRequestedOrders.find(
                        (o) => !shownReturnOrderIdsRef.current.has(o.orderId)
                    );
                    if (unhandledReturn) {
                        setNewReturnAlert(unhandledReturn);
                        setShownReturnOrderIds((prev) => new Set(prev).add(unhandledReturn.orderId));
                        shownReturnOrderIdsRef.current = new Set(shownReturnOrderIdsRef.current).add(unhandledReturn.orderId);
                        newReturnAlertRef.current = unhandledReturn;
                    }
                }
            } catch (error) {
                console.error("Polling Error:", error);
            } finally {
                isOrdersFetchInFlightRef.current = false;
                setOrdersLoading(false);
            }
        };

        fetchOrdersRef.current = fetchOrders;
        fetchOrders();
    }, [role]);

    // Resilient fallback when socket events are missed (tab backgrounded/suspended).
    useEffect(() => {
        if (role !== 'seller') return undefined;

        const syncOrders = () => {
            if (fetchOrdersRef.current) fetchOrdersRef.current();
        };

        const timer = setInterval(syncOrders, POLL_INTERVAL_MS);
        const onFocus = () => syncOrders();
        const onVisible = () => {
            if (document.visibilityState === 'visible') syncOrders();
        };
        const onOnline = () => syncOrders();

        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);

        return () => {
            clearInterval(timer);
            window.removeEventListener('focus', onFocus);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
        };
    }, [role]);

    useEffect(() => {
        if ((newOrderAlert && !orderAlertMinimized) || newReturnAlert) {
            startOrderRingtone();
            return undefined;
        }
        stopOrderRingtone();
        return undefined;
    }, [newOrderAlert, newReturnAlert, orderAlertMinimized]);

    // Lock background scroll when new order or return alert modal is visible
    useEffect(() => {
        if ((newOrderAlert && !orderAlertMinimized) || newReturnAlert) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [newOrderAlert, newReturnAlert, orderAlertMinimized]);

    useEffect(() => {
        return () => {
            stopOrderRingtone();
            stopWithdrawalRing();
        };
    }, []);

    useEffect(() => {
        if (role === 'seller') return;
        stopOrderRingtone();
    }, [role]);

    useEffect(() => {
        if (role !== 'seller') return undefined;
        const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_SELLER);
        getOrderSocket(getToken);
        const unsubscribeSellerNew = onSellerOrderNew(getToken, (payload) => {
            // POS (walk-in) sales also emit `order:new` — so open tabs / the
            // unified terminal refresh instantly via fetchOrders() below —
            // but they're created already-completed (workflowStatus:
            // DELIVERED, no seller-accept step, no delivery assignment) and
            // must never pop the accept/reject modal or ring the alert.
            // Reuse the same eligibility check the polling path already
            // applies so both paths agree on what counts as "needs accept".
            if (payload?.orderId && isSellerAlertEligible(payload)) {
                const incoming = {
                    orderId: payload.orderId,
                    ...payload,
                };
                setNewOrderAlert(incoming);
                setShownOrderIds((prev) => new Set(prev).add(payload.orderId));
                shownOrderIdsRef.current = new Set(shownOrderIdsRef.current).add(payload.orderId);
                newOrderAlertRef.current = incoming;
                startOrderRingtone();
            }
            if (fetchOrdersRef.current) fetchOrdersRef.current();
        });

        const unsubscribeReturnReq = onSellerReturnRequested(getToken, (payload) => {
            console.log("[DashboardLayout] Received return:requested:", payload);
            if (payload?.orderId) {
                const incoming = {
                    orderId: payload.orderId,
                    ...payload,
                };
                setNewReturnAlert(incoming);
                setShownReturnOrderIds((prev) => new Set(prev).add(payload.orderId));
                shownReturnOrderIdsRef.current = new Set(shownReturnOrderIdsRef.current).add(payload.orderId);
                newReturnAlertRef.current = incoming;
            }
            if (fetchOrdersRef.current) fetchOrdersRef.current();
            startOrderRingtone();
        });

        const unsubscribeDrop = onReturnDropOtp(getToken, (payload) => {
            console.log("[DashboardLayout] Received return drop OTP:", payload);
            setReturnDropOtpAlert(payload);
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.play().catch(() => { });
        });

        return () => {
            unsubscribeSellerNew();
            unsubscribeReturnReq();
            unsubscribeDrop();
        };
    }, [role]);

    // Admin listener for money requests (withdrawals) with audible ring and direct navigation toast
    useEffect(() => {
        if (role !== 'admin') return undefined;
        const getToken = createSocketTokenReader(STORAGE_KEYS.AUTH_ADMIN);
        getOrderSocket(getToken);

        const unsubscribeWithdrawal = onAdminWithdrawalNew(getToken, (payload) => {
            const toastId = `wdr-${payload?.id || payload?.reference || payload?.amount || Date.now()}`;
            if (lastToastWithdrawalIdRef.current === toastId) {
                return;
            }
            lastToastWithdrawalIdRef.current = toastId;
            setTimeout(() => {
                if (lastToastWithdrawalIdRef.current === toastId) {
                    lastToastWithdrawalIdRef.current = null;
                }
            }, 6000);

            playWithdrawalRing();

            const targetTab = payload?.tab || (payload?.userModel === 'Seller' ? 'sellers' : 'delivery');
            const link = payload?.link || `/admin/withdrawals?tab=${targetTab}`;
            const requester = payload?.userName || (payload?.userModel === 'Seller' ? 'Seller' : 'Delivery Partner');
            const amount = payload?.amount ? `₹${payload.amount}` : '';

            toast.info(`New Money Request: ${requester} requested ${amount}`, {
                id: toastId,
                description: 'Click to review and settle this payout request.',
                duration: 8000,
                action: {
                    label: 'View',
                    onClick: () => {
                        stopWithdrawalRing();
                        navigate(link);
                    },
                },
                onDismiss: () => {
                    stopWithdrawalRing();
                },
                onAutoClose: () => {
                    stopWithdrawalRing();
                },
            });
        });

        return () => {
            unsubscribeWithdrawal();
            stopWithdrawalRing();
        };
    }, [role, navigate]);

    // Single earnings fetch when seller is on earnings/withdrawals/transactions – no duplicate calls
    useEffect(() => {
        if (role !== 'seller' || !isEarningsRoute(location.pathname)) {
            if (!isEarningsRoute(location.pathname)) earningsFetchedRef.current = false;
            return;
        }
        if (earningsFetchedRef.current) return;
        earningsFetchedRef.current = true;
        setEarningsLoading(true);

        sellerApi
            .getEarnings()
            .then((response) => {
                const raw = response?.data?.result ?? response?.data?.data;
                if (response?.data?.success && raw && typeof raw === 'object') {
                    setSellerEarningsData({
                        balances: raw.balances ?? {},
                        ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
                        monthlyChart: Array.isArray(raw.monthlyChart) ? raw.monthlyChart : [],
                    });
                }
            })
            .catch((err) => console.error("Earnings Fetch Error:", err))
            .finally(() => setEarningsLoading(false));
    }, [role, location.pathname]);

    const refreshOrders = () => {
        if (fetchOrdersRef.current) fetchOrdersRef.current();
    };
    const refreshEarnings = () => {
        earningsFetchedRef.current = false;
        setEarningsLoading(true);
        sellerApi
            .getEarnings()
            .then((response) => {
                const raw = response?.data?.result ?? response?.data?.data;
                if (response?.data?.success && raw && typeof raw === 'object') {
                    setSellerEarningsData({
                        balances: raw.balances ?? {},
                        ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
                        monthlyChart: Array.isArray(raw.monthlyChart) ? raw.monthlyChart : [],
                    });
                }
            })
            .catch((err) => console.error("Earnings Fetch Error:", err))
            .finally(() => {
                setEarningsLoading(false);
                earningsFetchedRef.current = true;
            });
    };

    useEffect(() => {
        setIsSidebarOpen(false);
    }, [location.pathname]);

    // Timer: driven by server expiry (sellerPendingExpiresAt), not a local 60s from modal open
    useEffect(() => {
        if (!newOrderAlert) return undefined;

        const left = secondsLeftUntilSellerExpiry(newOrderAlert);
        if (left <= 0) {
            setNewOrderAlert(null);
            toast.error("This order has already expired — you can no longer accept it.");
            return undefined;
        }

        acceptWindowTotalRef.current = left;
        setTimeLeft(left);

        const timer = setInterval(() => {
            const next = secondsLeftUntilSellerExpiry(newOrderAlertRef.current);
            setTimeLeft(next);
            if (next <= 0) {
                clearInterval(timer);
                setNewOrderAlert(null);
                toast.error("Order timed out!");
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [newOrderAlert]);

    // Collapse the details panel whenever a different order pops up
    useEffect(() => {
        setOrderDetailsOpen(false);
        setOrderDetails(null);
        setOrderDetailsLoading(false);
        setOrderAlertMinimized(false);
    }, [newOrderAlert?.orderId]);

    // Minimize, then open the seller's Products page filtered to this item to verify stock.
    const checkItemInProducts = (name) => {
        setOrderAlertMinimized(true);
        navigate(`/seller/products${name ? `?q=${encodeURIComponent(name)}` : ""}`);
    };

    const toggleOrderDetails = async () => {
        const orderId = newOrderAlert?.orderId;
        if (!orderId) return;
        if (orderDetailsOpen) {
            setOrderDetailsOpen(false);
            return;
        }
        setOrderDetailsOpen(true);
        if (orderDetails?.orderId === orderId) return;
        setOrderDetailsLoading(true);
        try {
            const res = await sellerApi.getOrderDetails(orderId);
            const data = res?.data?.result ?? res?.data?.results ?? res?.data?.data;
            if (newOrderAlertRef.current?.orderId === orderId) {
                setOrderDetails(data ? { ...data, orderId: data.orderId || orderId } : null);
            }
        } catch (error) {
            toast.error(error?.response?.data?.message || "Failed to load order details");
            // Fall back to whatever the alert payload already carries
            setOrderDetails({ ...newOrderAlertRef.current, orderId });
        } finally {
            setOrderDetailsLoading(false);
        }
    };

    const handleAcceptOrder = async (orderId) => {
        try {
            await sellerApi.updateOrderStatus(orderId, { status: 'confirmed' });
            toast.success(`Order #${orderId} Accepted!`);
            stopOrderRingtone();
            setNewOrderAlert(null);
        } catch (error) {
            const msg =
                error?.response?.data?.message ||
                "Failed to accept order";
            const normalizedMsg = String(msg).toLowerCase();
            if (
                normalizedMsg.includes('not available') ||
                normalizedMsg.includes('expired')
            ) {
                stopOrderRingtone();
                setNewOrderAlert(null);
                if (fetchOrdersRef.current) fetchOrdersRef.current();
            }
            toast.error(msg);
        }
    };

    const handleDeclineOrder = async (orderId) => {
        try {
            await sellerApi.updateOrderStatus(orderId, { status: 'cancelled' });
            toast.error(`Order #${orderId} Declined`);
            stopOrderRingtone();
            setNewOrderAlert(null);
        } catch (error) {
            const msg =
                error?.response?.data?.message ||
                "Failed to update order";
            toast.error(msg);
        }
    };

    const handleApproveReturn = async (orderId) => {
        try {
            setReturnActionLoading(true);
            await sellerApi.approveReturn(orderId, {});
            toast.success(`Return for Order #${orderId} approved successfully!`);
            stopOrderRingtone();
            setNewReturnAlert(null);
            setShowRejectInput(false);
            setRejectReturnReason("");
            if (fetchOrdersRef.current) fetchOrdersRef.current();
        } catch (error) {
            const msg = error?.response?.data?.message || "Failed to approve return";
            toast.error(msg);
        } finally {
            setReturnActionLoading(false);
        }
    };

    const handleRejectReturn = async (orderId, explicitReason) => {
        const finalReason = (explicitReason || rejectReturnReason || "").trim();
        if (!finalReason) {
            toast.error("Please provide a reason to reject this return");
            return;
        }
        try {
            setReturnActionLoading(true);
            await sellerApi.rejectReturn(orderId, { reason: finalReason });
            toast.success(`Return for Order #${orderId} rejected`);
            stopOrderRingtone();
            setNewReturnAlert(null);
            setShowRejectInput(false);
            setRejectReturnReason("");
            if (fetchOrdersRef.current) fetchOrdersRef.current();
        } catch (error) {
            const msg = error?.response?.data?.message || "Failed to reject return";
            toast.error(msg);
        } finally {
            setReturnActionLoading(false);
        }
    };

    const handleDismissReturnAlert = () => {
        stopOrderRingtone();
        setNewReturnAlert(null);
        setShowRejectInput(false);
        setRejectReturnReason("");
    };

    const handleViewReturnDetails = () => {
        handleDismissReturnAlert();
        navigate("/seller/returns");
    };

    return (
        <div className="min-h-screen mesh-gradient-light relative overflow-x-hidden">
            {/* Background Blobs for depth */}
            <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/5 rounded-full blur-[120px] -z-10 animate-pulse pointer-events-none"></div>
            <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand-500/5 rounded-full blur-[120px] -z-10 animate-pulse pointer-events-none" style={{ animationDelay: '2s' }}></div>

            <Sidebar
                items={navItems}
                title={title}
                isOpen={isSidebarOpen}
                onClose={() => setIsSidebarOpen(false)}
            />
            <div className={cn("transition-all duration-300 overflow-x-hidden max-w-full", (role === "admin" || role === "seller") ? "pl-0 md:pl-72" : "pl-72")}>
                <Topbar onMenuClick={() => setIsSidebarOpen(true)} />
                <main className={cn("p-4 md:p-6 min-h-screen overflow-x-hidden max-w-full", (role === "admin" || role === "seller") ? "pt-20 md:pt-24 pb-24 md:pb-6" : "pt-20")}>
                    <div className="w-full pb-12">
                        {role === "seller" && pushPermission !== "granted" && !isPermissionBannerDismissed && (
                            <div className="mb-4 bg-gradient-to-r from-red-600 via-rose-600 to-red-700 text-white rounded-2xl p-4 shadow-lg shadow-red-500/10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border border-red-500/20">
                                <div className="flex items-center gap-3">
                                    <div className="h-10 w-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                                        <BellRing className="h-5 w-5 text-white" />
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-white">Enable Order & Return Notifications</h4>
                                        <p className="text-xs text-white/85">Get instant ringtone alerts for new orders, return requests, and payouts even when your phone is locked.</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                                    <button
                                        type="button"
                                        onClick={handleEnablePushNotifications}
                                        disabled={isEnablingPush}
                                        className="px-4 py-2 bg-white text-red-600 hover:bg-red-50 text-xs font-bold rounded-xl shadow transition-all active:scale-95 flex items-center gap-1.5"
                                    >
                                        {isEnablingPush ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BellRing className="h-3.5 w-3.5" />}
                                        Enable Notifications
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            sessionStorage.setItem("seller_dismissed_notif_banner", "1");
                                            setIsPermissionBannerDismissed(true);
                                        }}
                                        className="p-2 text-white/80 hover:text-white rounded-lg transition-colors"
                                        title="Dismiss"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                        )}
                        <SellerOrdersContext.Provider
                            value={{
                                orders: role === 'seller' ? sellerOrders : [],
                                ordersLoading: role === 'seller' ? ordersLoading : false,
                                refreshOrders,
                            }}>
                            <SellerEarningsContext.Provider
                                value={{
                                    earningsData: role === 'seller' ? sellerEarningsData : defaultEarnings,
                                    earningsLoading: role === 'seller' ? earningsLoading : false,
                                    refreshEarnings,
                                }}>
                                {children}
                            </SellerEarningsContext.Provider>
                        </SellerOrdersContext.Provider>
                    </div>
                </main>
            </div>

            {/* Global Order Alert Modal */}
            <AnimatePresence>
                {newOrderAlert && !orderAlertMinimized && (
                    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ scale: 0.95, opacity: 0, y: 16 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.95, opacity: 0, y: 16 }}
                            className="relative bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 max-h-[90vh] flex flex-col overflow-hidden"
                        >
                            {/* Header */}
                            <div className="px-5 pt-5 pb-4 bg-gradient-to-b from-primary/10 to-white border-b border-slate-100">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className="relative shrink-0">
                                            <span className="absolute inset-0 rounded-2xl bg-primary/30 animate-ping" />
                                            <div className="relative h-12 w-12 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center shadow-lg shadow-primary/30">
                                                <BellRing className="h-6 w-6" />
                                            </div>
                                        </div>
                                        <div className="min-w-0">
                                            <h2 className="text-lg font-black text-slate-900 leading-tight">New Order Received</h2>
                                            <span className="inline-flex items-center mt-1 px-2 py-0.5 rounded-lg bg-white border border-primary/20 text-primary text-xs font-bold font-mono truncate max-w-full">
                                                #{newOrderAlert.orderId}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setOrderAlertMinimized(true)}
                                        title="Minimize — keep using your panel, the order waits here"
                                        aria-label="Minimize"
                                        className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-bold text-slate-500 bg-white/80 border border-slate-200 hover:text-slate-800 hover:bg-white transition-colors"
                                    >
                                        <Minimize2 className="h-3.5 w-3.5" />
                                        Minimize
                                    </button>
                                </div>

                                {/* Countdown — driven by the real server deadline */}
                                <div className="mt-4">
                                    <div className="flex items-center justify-between text-xs font-bold mb-1.5">
                                        <span className={cn("flex items-center gap-1.5", timeLeft < 15 ? "text-rose-600" : "text-slate-600")}>
                                            <Clock className={cn("h-3.5 w-3.5", timeLeft < 15 && "animate-pulse")} />
                                            Accept within
                                        </span>
                                        <span className={cn("tabular-nums", timeLeft < 15 ? "text-rose-600" : "text-slate-900")}>
                                            {formatAcceptCountdown(timeLeft)}
                                        </span>
                                    </div>
                                    <div className="w-full bg-slate-200/70 h-1.5 rounded-full overflow-hidden">
                                        <div
                                            className={cn(
                                                "h-full rounded-full transition-[width] duration-1000 ease-linear",
                                                timeLeft < 15 ? "bg-rose-500" : "bg-primary",
                                            )}
                                            style={{
                                                width: `${acceptWindowTotalRef.current > 0 ? (timeLeft / acceptWindowTotalRef.current) * 100 : 0}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* Scrollable body */}
                            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                                {/* Item Amount & Net Earning */}
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                        <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Item Amount</p>
                                        <p className="text-xl font-black text-slate-900 mt-0.5">
                                            ₹{formatAmount(newOrderAlert.itemAmount ?? newOrderAlert.paymentBreakdown?.productSubtotal ?? newOrderAlert.pricing?.subtotal ?? newOrderAlert.pricing?.total ?? newOrderAlert.total ?? 0)}
                                        </p>
                                    </div>
                                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                                        <p className="text-[10px] font-bold text-emerald-700 uppercase tracking-wider">Net Earning</p>
                                        <p className="text-xl font-black text-emerald-700 mt-0.5">
                                            ₹{formatAmount(newOrderAlert.netEarnings ?? newOrderAlert.paymentBreakdown?.sellerPayoutTotal ?? 0)}
                                        </p>
                                    </div>
                                </div>

                                {/* View order details before accepting / declining */}
                                <div className="rounded-2xl border border-slate-200 overflow-hidden">
                                    <button
                                        type="button"
                                        onClick={toggleOrderDetails}
                                        aria-expanded={orderDetailsOpen}
                                        className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-white hover:bg-slate-50 transition-colors"
                                    >
                                        <span className="flex items-center gap-2 text-sm font-bold text-slate-800">
                                            <Eye className="h-4 w-4 text-primary" />
                                            {orderDetailsOpen ? "Hide Order Details" : "View Order Details"}
                                        </span>
                                        <ChevronDown className={cn("h-4 w-4 text-slate-500 transition-transform", orderDetailsOpen && "rotate-180")} />
                                    </button>

                                    {orderDetailsOpen && (
                                        <div className="border-t border-slate-100 bg-slate-50/60 p-3 text-left">
                                            {orderDetailsLoading ? (
                                                <div className="flex items-center justify-center gap-2 py-6 text-sm font-semibold text-slate-500">
                                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading order details…
                                                </div>
                                            ) : (() => {
                                                const d = orderDetails || {};
                                                const items = Array.isArray(d.items) ? d.items : [];
                                                const totalQty = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
                                                const payMode = String(d.paymentMode || d.payment?.method || "").toUpperCase();
                                                const addr = d.address || {};
                                                return (
                                                    <>
                                                        <div className="flex items-center justify-between mb-2.5 px-1">
                                                            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                                                Items ({items.length}) · Qty {totalQty}
                                                            </span>
                                                            {payMode && (
                                                                <span className={cn(
                                                                    "text-[10px] font-black px-2 py-0.5 rounded-full border",
                                                                    payMode === "COD" || payMode === "CASH"
                                                                        ? "bg-amber-50 border-amber-200 text-amber-700"
                                                                        : "bg-sky-50 border-sky-200 text-sky-700",
                                                                )}>
                                                                    {payMode === "COD" || payMode === "CASH" ? "Cash on Delivery" : "Paid Online"}
                                                                </span>
                                                            )}
                                                        </div>

                                                        {items.length === 0 ? (
                                                            <p className="text-sm text-slate-500 py-2 px-1">No item details available for this order.</p>
                                                        ) : (
                                                            <ul className="space-y-2">
                                                                {items.map((it, idx) => {
                                                                    const product = it.product && typeof it.product === "object" ? it.product : {};
                                                                    const name = it.name || product.name || "Item";
                                                                    const image = it.image || product.mainImage;
                                                                    const qty = Number(it.quantity) || 0;
                                                                    const price = Number(it.price) || 0;
                                                                    // Stock is reserved for this order at placement, so this is what's left after it.
                                                                    const variant = Array.isArray(product.variants)
                                                                        ? product.variants.find((v) => it.variantSlot && (v?.sku === it.variantSlot || v?.name === it.variantSlot))
                                                                        : null;
                                                                    const rawLeft = variant?.stock ?? product.stock;
                                                                    const stockLeft = rawLeft == null || rawLeft === "" || !Number.isFinite(Number(rawLeft)) ? null : Math.max(0, Number(rawLeft));
                                                                    const lowAt = Number(product.lowStockAlert) > 0 ? Number(product.lowStockAlert) : 5;
                                                                    const stockBadge =
                                                                        stockLeft == null
                                                                            ? null
                                                                            : stockLeft === 0
                                                                              ? { text: "Last unit(s) — 0 left after this order", cls: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" }
                                                                              : stockLeft <= lowAt
                                                                                ? { text: `Low stock — ${stockLeft} left after this order`, cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" }
                                                                                : { text: `In stock — ${stockLeft} left after this order`, cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
                                                                    return (
                                                                        <li key={`${product._id || it.product || name}-${it.variantSlot || ""}-${idx}`} className="flex gap-3 bg-white rounded-xl border border-slate-100 p-2.5 shadow-sm">
                                                                            {image ? (
                                                                                <img src={image} alt={name} className="h-14 w-14 rounded-lg object-cover bg-slate-100 shrink-0" />
                                                                            ) : (
                                                                                <div className="h-14 w-14 rounded-lg bg-slate-100 shrink-0" />
                                                                            )}
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="flex items-start justify-between gap-2">
                                                                                    <p className="text-sm font-bold text-slate-900 truncate" title={name}>{name}</p>
                                                                                    <p className="text-sm font-black text-slate-900 shrink-0">₹{formatAmount(price * qty)}</p>
                                                                                </div>
                                                                                <p className="text-xs text-slate-500 truncate">
                                                                                    {it.variantSlot ? `${it.variantSlot} · ` : ""}₹{price} × {qty}
                                                                                </p>
                                                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                                                                                    {stockBadge && (
                                                                                        <span className={cn("inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-md border", stockBadge.cls)}>
                                                                                            <span className={cn("h-1.5 w-1.5 rounded-full", stockBadge.dot)} />
                                                                                            {stockBadge.text}
                                                                                        </span>
                                                                                    )}
                                                                                    <button
                                                                                        type="button"
                                                                                        onClick={() => checkItemInProducts(name)}
                                                                                        className="inline-flex items-center gap-0.5 text-[11px] font-bold text-primary hover:underline"
                                                                                    >
                                                                                        Check in Products
                                                                                        <ArrowUpRight className="h-3 w-3" />
                                                                                    </button>
                                                                                </div>
                                                                            </div>
                                                                        </li>
                                                                    );
                                                                })}
                                                            </ul>
                                                        )}

                                                        {(addr.name || addr.address || addr.city) && (
                                                            <div className="mt-3 flex items-start gap-2 rounded-xl bg-white border border-slate-100 px-3 py-2.5 text-xs text-slate-600">
                                                                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                                                                <span>
                                                                    <span className="font-bold text-slate-700">Deliver to: </span>
                                                                    {[
                                                                        addr.name,
                                                                        addr.address,
                                                                        addr.city && !String(addr.address || "").includes(addr.city) ? addr.city : null,
                                                                    ].filter(Boolean).join(", ")}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Actions — always visible */}
                            <div className="px-5 py-4 border-t border-slate-100 bg-white grid grid-cols-[1fr_1.6fr] gap-3">
                                <button
                                    onClick={() => handleDeclineOrder(newOrderAlert.orderId)}
                                    className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border border-slate-200 bg-white text-slate-600 font-bold hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 transition-colors"
                                >
                                    <X className="h-5 w-5" />
                                    Decline
                                </button>
                                <button
                                    onClick={() => handleAcceptOrder(newOrderAlert.orderId)}
                                    className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold hover:bg-primary/90 shadow-lg shadow-primary/25 transition-all active:scale-95"
                                >
                                    <Check className="h-5 w-5" />
                                    Accept Order
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}

                {/* Minimized new-order card: panel stays usable, order can be reopened / actioned */}
                {newOrderAlert && orderAlertMinimized && (
                    <motion.div
                        initial={{ y: 30, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 30, opacity: 0 }}
                        className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 z-[998] w-[calc(100%-2rem)] max-w-sm bg-white rounded-2xl shadow-2xl border border-primary/30 p-4"
                    >
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                                <div className="h-9 w-9 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                                    <BellRing className="h-5 w-5 text-primary animate-pulse" />
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-black text-slate-900 truncate">New order #{newOrderAlert.orderId}</p>
                                    <p className={cn("text-xs font-bold", timeLeft < 15 ? "text-rose-500" : "text-slate-500")}>
                                        Accept within {formatAcceptCountdown(timeLeft)}
                                    </p>
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => setOrderAlertMinimized(false)}
                                className="shrink-0 text-xs font-bold text-primary hover:underline"
                            >
                                Review
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-3">
                            <button
                                onClick={() => handleDeclineOrder(newOrderAlert.orderId)}
                                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-slate-100 text-slate-600 text-sm font-bold hover:bg-slate-200 transition-colors"
                            >
                                <X className="h-4 w-4" />
                                Decline
                            </button>
                            <button
                                onClick={() => handleAcceptOrder(newOrderAlert.orderId)}
                                className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-all active:scale-95"
                            >
                                <Check className="h-4 w-4" />
                                Accept
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Global Return Request Alert Modal */}
                {newReturnAlert && (
                    <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-3xl p-6 md:p-8 max-w-lg w-full shadow-2xl border border-rose-100 max-h-[90vh] overflow-y-auto"
                        >
                            <div className="flex flex-col items-center text-center">
                                <div className="h-20 w-20 bg-rose-50 rounded-full flex items-center justify-center mb-4 animate-bounce text-rose-600 shadow-inner">
                                    <RotateCcw className="h-10 w-10" />
                                </div>

                                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-100 text-rose-700 text-xs font-bold uppercase tracking-wider mb-2">
                                    <AlertTriangle className="h-3.5 w-3.5" /> Return Requested
                                </div>

                                <h2 className="text-2xl font-black text-slate-900 mb-1">
                                    Customer Return Request!
                                </h2>
                                <p className="text-slate-600 font-medium mb-4 text-sm">
                                    Order{" "}
                                    <span className="text-rose-600 font-bold font-mono">
                                        #{newReturnAlert.orderId}
                                    </span>
                                </p>

                                {/* Reason and Info Box */}
                                <div className="w-full bg-slate-50 border border-slate-200/70 rounded-2xl p-4 text-left mb-5">
                                    <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                                        Reason for return:
                                    </div>
                                    <div className="text-sm font-bold text-slate-900 mb-2">
                                        {newReturnAlert.returnReason || "Product issue"}
                                    </div>
                                    {newReturnAlert.returnReasonDetail && (
                                        <div className="text-xs text-slate-600 bg-white p-2.5 rounded-xl border border-slate-100 mb-2">
                                            &ldquo;{newReturnAlert.returnReasonDetail}&rdquo;
                                        </div>
                                    )}

                                    {/* Items Summary if available */}
                                    {Array.isArray(newReturnAlert.returnItems) && newReturnAlert.returnItems.length > 0 && (
                                        <div className="mt-3 pt-3 border-t border-slate-200/60">
                                            <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                                                Returning Items:
                                            </div>
                                            <div className="space-y-1.5 max-h-28 overflow-y-auto">
                                                {newReturnAlert.returnItems.map((item, idx) => (
                                                    <div key={idx} className="flex items-center justify-between text-xs bg-white px-3 py-2 rounded-xl border border-slate-100">
                                                        <span className="font-semibold text-slate-700 truncate max-w-[200px]">{item.name}</span>
                                                        <span className="font-bold text-slate-900">Qty: {item.quantity}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}

                                    {newReturnAlert.refundAmount > 0 && (
                                        <div className="mt-3 flex items-center justify-between text-xs font-bold text-slate-700 pt-2 border-t border-slate-200/60">
                                            <span>Refund Amount:</span>
                                            <span className="text-rose-600 text-sm font-black">₹{formatAmount(newReturnAlert.refundAmount)}</span>
                                        </div>
                                    )}
                                </div>

                                {/* Rejection Input Panel */}
                                {showRejectInput ? (
                                    <div className="w-full bg-rose-50/60 border border-rose-200/80 rounded-2xl p-4 mb-4 text-left">
                                        <label className="block text-xs font-bold text-rose-900 mb-2 uppercase tracking-wide">
                                            Select or type rejection reason:
                                        </label>
                                        <div className="flex flex-wrap gap-1.5 mb-2.5">
                                            {["Product used/damaged", "Policy period passed", "Incorrect return claim", "Tags/box missing"].map((preset) => (
                                                <button
                                                    key={preset}
                                                    type="button"
                                                    onClick={() => setRejectReturnReason(preset)}
                                                    className={cn(
                                                        "text-[11px] px-2.5 py-1 rounded-full border transition-all font-medium",
                                                        rejectReturnReason === preset
                                                            ? "bg-rose-600 text-white border-rose-600 font-bold"
                                                            : "bg-white text-slate-700 border-slate-200 hover:border-rose-400"
                                                    )}
                                                >
                                                    {preset}
                                                </button>
                                            ))}
                                        </div>
                                        <input
                                            type="text"
                                            value={rejectReturnReason}
                                            onChange={(e) => setRejectReturnReason(e.target.value)}
                                            placeholder="Type rejection reason..."
                                            className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-rose-500 mb-3"
                                        />
                                        <div className="flex gap-2">
                                            <button
                                                disabled={returnActionLoading}
                                                onClick={() => setShowRejectInput(false)}
                                                className="flex-1 py-2.5 rounded-xl bg-slate-200 text-slate-700 font-bold text-xs hover:bg-slate-300 transition-colors"
                                            >
                                                Back
                                            </button>
                                            <button
                                                disabled={returnActionLoading || !rejectReturnReason.trim()}
                                                onClick={() => handleRejectReturn(newReturnAlert.orderId)}
                                                className="flex-1 py-2.5 rounded-xl bg-rose-600 text-white font-bold text-xs hover:bg-rose-700 transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50"
                                            >
                                                {returnActionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                                                Confirm Reject
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3 w-full mb-4">
                                        <button
                                            disabled={returnActionLoading}
                                            onClick={() => setShowRejectInput(true)}
                                            className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-rose-50 text-rose-700 border border-rose-200 font-bold text-sm hover:bg-rose-100 transition-colors active:scale-95"
                                        >
                                            <X className="h-4 w-4" />
                                            Reject Return
                                        </button>
                                        <button
                                            disabled={returnActionLoading}
                                            onClick={() => handleApproveReturn(newReturnAlert.orderId)}
                                            className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 shadow-lg shadow-emerald-600/20 transition-all active:scale-95 disabled:opacity-50"
                                        >
                                            {returnActionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                                            Accept Return
                                        </button>
                                    </div>
                                )}

                                <div className="flex items-center justify-between w-full pt-1 px-1">
                                    <button
                                        onClick={handleDismissReturnAlert}
                                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                                    >
                                        Dismiss Sound
                                    </button>
                                    <button
                                        onClick={handleViewReturnDetails}
                                        className="text-xs font-bold text-primary hover:underline"
                                    >
                                        View in Returns Tab &rarr;
                                    </button>
                                </div>
                            </div>
                        </motion.div>
                    </div>
                )}

                {/* Global Return Drop OTP Modal */}
                {returnDropOtpAlert && (
                    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-md">
                        <motion.div
                            initial={{ scale: 0.9, opacity: 0, y: 20 }}
                            animate={{ scale: 1, opacity: 1, y: 0 }}
                            exit={{ scale: 0.9, opacity: 0, y: 20 }}
                            className="bg-white rounded-3xl p-8 max-w-md w-full shadow-2xl border border-brand-100"
                        >
                            <div className="flex flex-col items-center text-center">
                                <div className="h-20 w-20 bg-brand-50 rounded-full flex items-center justify-center mb-6 animate-pulse">
                                    <Truck className="h-10 w-10 text-brand-600" />
                                </div>

                                <h2 className="text-2xl font-black text-slate-900 mb-2">Rider at Store!</h2>
                                <p className="text-slate-600 font-medium mb-6">
                                    A rider is at your store for Return <span className="text-brand-600 font-bold">#{returnDropOtpAlert.orderId}</span>.
                                    Please share the OTP below:
                                </p>

                                <div className="flex items-center justify-center gap-3 mb-8">
                                    {returnDropOtpAlert.otp.split('').map((char, i) => (
                                        <div key={i} className="h-16 w-14 bg-slate-50 rounded-2xl shadow-sm border border-brand-100 flex items-center justify-center text-4xl font-black text-slate-900 border-b-4 border-b-brand-600">
                                            {char}
                                        </div>
                                    ))}
                                </div>

                                <p className="text-xs font-bold text-slate-500 mb-8">
                                    Confirm receipt of the product by sharing this code.
                                </p>

                                <button
                                    onClick={() => setReturnDropOtpAlert(null)}
                                    className="w-full py-4 rounded-2xl bg-primary text-primary-foreground font-black hover:bg-primary/90 shadow-xl shadow-primary/20 transition-all active:scale-95 uppercase tracking-widest text-xs"
                                >
                                    Dismiss Alert
                                </button>
                            </div>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>

            {(role === "admin" || role === "seller") && <BottomNav navItems={navItems} />}
        </div>
    );
};

export default DashboardLayout;
