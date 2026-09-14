import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Heart, Plus, Minus, Star, ShieldCheck, Clock, ArrowLeft, MessageSquare, Share2, Sparkles, Truck, Check, ChevronRight, PackageCheck, AlertCircle, ShoppingCart } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { useToast } from '@shared/components/ui/Toast';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { customerApi } from '../services/customerApi';
import { useLocation as useAppLocation } from '../context/LocationContext';
import { applyCloudinaryTransform } from '@/core/utils/imageUtils';
import { useSettings } from '@core/context/SettingsContext';
import Lottie from 'lottie-react';

const ProductDetailPage = () => {
    const { id } = useParams();
    const navigate = useNavigate();
    const { cart, addToCart, updateQuantity, cartCount } = useCart();
    const { toggleWishlist: toggleWishlistGlobal, isInWishlist } = useWishlist();
    const { showToast } = useToast();
    const { currentLocation } = useAppLocation();
    const { settings } = useSettings();

    const [product, setProduct] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeImage, setActiveImage] = useState('');
    const [reviews, setReviews] = useState([]);
    const [reviewLoading, setReviewLoading] = useState(false);
    const [isSubmittingReview, setIsSubmittingReview] = useState(false);
    const [newReview, setNewReview] = useState({ rating: 5, comment: '' });
    const [localHasReviewed, setLocalHasReviewed] = useState(false);
    const [noServiceData, setNoServiceData] = useState(null);

    // Dynamically load no-service Lottie on mount
    useEffect(() => {
        import('@/assets/lottie/animation.json')
            .then((m) => setNoServiceData(m.default))
            .catch(() => {});
    }, []);

    const fetchData = async (showLoader = true) => {
        if (showLoader) setIsLoading(true);
        setError(null);
        try {
            const hasValidLocation =
                Number.isFinite(currentLocation?.latitude) &&
                Number.isFinite(currentLocation?.longitude);

            const params = hasValidLocation ? {
                lat: currentLocation.latitude,
                lng: currentLocation.longitude
            } : {};

            const res = await customerApi.getProductById(id, params);
            if (res.data?.success) {
                const p = res.data.result;
                const formatted = {
                    ...p,
                    id: p._id,
                    images: [p.mainImage, ...(p.galleryImages || [])].filter(Boolean)
                };
                setProduct(formatted);
                setActiveImage(formatted.images[0] || 'https://images.unsplash.com/photo-1542838132-92c53300491e?q=80&w=600&auto=format&fit=crop');
                fetchReviews();
            } else {
                setError(res.data?.message || "Failed to load product");
            }
        } catch (err) {
            console.error("Fetch product error:", err);
            setError(err.response?.data?.message || "Failed to load product");
        } finally {
            setIsLoading(false);
        }
    };

    const [ratingSummary, setRatingSummary] = useState({ average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    const [selectedStarFilter, setSelectedStarFilter] = useState(null);

    const fetchReviews = async () => {
        try {
            setReviewLoading(true);
            const [reviewsRes, summaryRes] = await Promise.all([
                customerApi.getProductRatingsList(id, { rating: selectedStarFilter }),
                customerApi.getProductRatingSummary(id)
            ]);

            if (reviewsRes.data.success) {
                setReviews(reviewsRes.data.result?.items || reviewsRes.data.results || []);
            }
            if (summaryRes.data.success) {
                setRatingSummary(summaryRes.data.result || { average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
            }
        } catch (error) {
            console.error("Fetch product ratings error:", error);
        } finally {
            setReviewLoading(false);
        }
    };

    useEffect(() => {
        setNewReview({ rating: 5, comment: '' });
        setLocalHasReviewed(false);
        setReviews([]);
        if (id) {
            fetchData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id]);

    useEffect(() => {
        if (id && product) {
            fetchData(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentLocation?.latitude, currentLocation?.longitude]);

    const handleReviewSubmit = async (e) => {
        e.preventDefault();
        if (!newReview.comment.trim()) return;

        try {
            setIsSubmittingReview(true);
            const res = await customerApi.submitReview({
                productId: id,
                rating: newReview.rating,
                comment: newReview.comment
            });
            if (res.data.success) {
                showToast("Review submitted successfully", "success");
                setNewReview({ rating: 5, comment: '' });
                setLocalHasReviewed(true);
                setReviews(prev => [{
                    _id: 'temp-' + Date.now(),
                    rating: newReview.rating,
                    comment: newReview.comment,
                    createdAt: new Date().toISOString(),
                    userId: { name: 'You' },
                    status: 'pending'
                }, ...prev]);
            }
        } catch (error) {
            showToast(error.response?.data?.message || "Failed to submit review", "error");
        } finally {
            setIsSubmittingReview(false);
        }
    };

    const handleToggleWishlist = () => {
        if (!product) return;
        toggleWishlistGlobal(product);
        const isWishlisted = isInWishlist(product.id);
        showToast(
            isWishlisted ? `${product.name} removed from wishlist` : `${product.name} added to wishlist`,
            isWishlisted ? 'info' : 'success'
        );
    };

    const handleShare = async () => {
        if (!product) return;
        const effectivePrice = (product.salePrice && Number(product.salePrice) > 0 && Number(product.salePrice) < Number(product.price))
            ? product.salePrice
            : product.price;
        const appName = settings?.siteTitle || 'Zetbasket';
        const shareData = {
            title: `${product.name} on ${appName}`,
            text: `Check out ${product.name} on ${appName} for ₹${effectivePrice}!`,
            url: window.location.href,
        };

        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share(shareData);
                return;
            } catch (err) {
                if (err?.name === 'AbortError') return;
            }
        }

        try {
            await navigator.clipboard.writeText(window.location.href);
            showToast("Product link copied to clipboard!", "success");
        } catch {
            showToast("Link: " + window.location.href, "info");
        }
    };

    // NOTE: These useMemo hooks MUST be declared before any early returns
    // to comply with React's Rules of Hooks.
    const isOutOfStock = useMemo(() => {
        if (!product) return false;
        if (product.status === "out_of_stock" || product.status === "OUT_OF_STOCK") return true;
        if (product.inStock === false || product.isOutOfStock === true) return true;
        const masterStock =
            product.stock !== undefined && product.stock !== null
                ? Math.max(0, Number(product.stock))
                : 999;
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        if (variants.length > 0) {
            const allOut = variants.every((v) => {
                if (v.status === "out_of_stock" || v.status === "OUT_OF_STOCK" || v.inStock === false) return true;
                if (v.stock !== undefined && v.stock !== null) {
                    return Number(v.stock) <= 0;
                }
                return masterStock <= 0;
            });
            if (allOut) return true;
        }
        if (masterStock <= 0) {
            return true;
        }
        return false;
    }, [product]);

    const availableStock = useMemo(() => {
        if (!product || isOutOfStock) return 0;
        if (product.stock !== undefined && product.stock !== null) {
            return Math.max(0, Number(product.stock));
        }
        return 999;
    }, [product, isOutOfStock]);

    const discountPercentage = useMemo(() => {
        if (!product?.salePrice || !product?.price) return 0;
        const orig = Number(product.price);
        const sale = Number(product.salePrice);
        if (sale < orig && orig > 0) {
            return Math.round(((orig - sale) / orig) * 100);
        }
        return 0;
    }, [product]);

    const savingsAmount = useMemo(() => {
        if (!product?.salePrice || !product?.price) return 0;
        const orig = Number(product.price);
        const sale = Number(product.salePrice);
        if (sale < orig) return orig - sale;
        return 0;
    }, [product]);

    if (isLoading) {
        return (
            <div className="min-h-screen flex flex-col items-center justify-center bg-white">
                <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4" />
                <p className="text-xs font-black uppercase tracking-widest text-slate-400">Loading Product...</p>
            </div>
        );
    }

    if (error || !product) {
        return (
            <div className="min-h-screen bg-white py-20 px-8 flex flex-col items-center justify-center text-center">
                <div className="w-64 h-64 mb-6">
                    {noServiceData ? (
                        <Lottie animationData={noServiceData} loop={true} />
                    ) : (
                        <div className="w-64 h-64 flex items-center justify-center bg-slate-50 rounded-3xl">
                            <AlertCircle className="w-16 h-16 text-slate-300" />
                        </div>
                    )}
                </div>
                <h3 className="text-3xl font-[1000] text-slate-800 tracking-tighter mb-4 uppercase">
                    Item <span className="text-primary">Unavailable</span>
                </h3>
                <p className="text-slate-500 font-bold text-sm max-w-[280px] mb-8 leading-relaxed">
                    {error === "Product not available in your area" 
                        ? "This item is not available at your current location yet." 
                        : "We couldn't load this product details. Try again later!"}
                </p>
                <div className="flex flex-col gap-3 w-full max-w-xs">
                    <button 
                        onClick={() => navigate('/')}
                        className="px-10 py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 active:scale-95 transition-all shadow-xl shadow-black/10 cursor-pointer"
                    >
                        Go to Home
                    </button>
                    <button 
                        onClick={() => navigate(-1)}
                        className="px-10 py-4 bg-white text-slate-900 border border-slate-200 rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-50 active:scale-95 transition-all cursor-pointer"
                    >
                        Go Back
                    </button>
                </div>
            </div>
        );
    }

    const cartItem = cart.find(item => item.id === product.id);
    const quantity = cartItem ? cartItem.quantity : 0;
    const isWishlisted = isInWishlist(product.id);
    const effectivePrice = (product.salePrice && Number(product.salePrice) > 0 && Number(product.salePrice) < Number(product.price))
        ? product.salePrice
        : product.price;

    return (
        <div className="min-h-screen bg-slate-50/60 pb-28 md:pb-16 pt-4 md:pt-8">
            <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {/* Navigation Bar / Breadcrumb */}
                <div className="flex items-center justify-between py-3 mb-4">
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                if (window.history.length > 1) {
                                    navigate(-1);
                                } else {
                                    navigate('/');
                                }
                            }}
                            className="inline-flex items-center justify-center h-10 px-3.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:text-primary hover:border-primary/40 font-bold text-xs transition-all shadow-sm active:scale-95 cursor-pointer gap-1.5"
                        >
                            <ArrowLeft size={16} /> Back
                        </button>

                        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-400 font-bold pl-2">
                            <Link to="/" className="hover:text-primary transition-colors">Home</Link>
                            <ChevronRight size={13} />
                            {product.categoryId?.name && (
                                <>
                                    <span className="text-slate-600">{product.categoryId.name}</span>
                                    <ChevronRight size={13} />
                                </>
                            )}
                            <span className="text-slate-800 truncate max-w-[200px]">{product.name}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleShare}
                            aria-label="Share product"
                            className="h-10 px-3.5 rounded-xl bg-white border border-slate-200 text-slate-700 hover:text-primary hover:border-primary/40 transition-all shadow-sm active:scale-95 cursor-pointer flex items-center gap-1.5 text-xs font-bold"
                        >
                            <Share2 size={16} />
                            <span className="hidden sm:inline">Share</span>
                        </button>
                        <button
                            type="button"
                            onClick={handleToggleWishlist}
                            aria-label="Save to wishlist"
                            className={cn(
                                "h-10 w-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center transition-all shadow-sm active:scale-95 cursor-pointer",
                                isWishlisted ? "text-red-500 border-red-200 bg-red-50/50" : "text-slate-600 hover:text-red-500 hover:border-red-200"
                            )}
                        >
                            <Heart size={18} className={cn(isWishlisted && "fill-current")} />
                        </button>
                        <Link
                            to="/checkout"
                            aria-label="View Cart"
                            className="h-10 px-3 rounded-xl bg-white border border-slate-200 text-slate-700 hover:text-primary hover:border-primary/40 transition-all shadow-sm active:scale-95 flex items-center gap-1.5 relative cursor-pointer"
                        >
                            <ShoppingCart size={17} />
                            {cartCount > 0 && (
                                <span className="h-5 min-w-[20px] px-1 bg-primary text-white text-[10px] font-black rounded-full flex items-center justify-center">
                                    {cartCount}
                                </span>
                            )}
                        </Link>
                    </div>
                </div>

                {/* Main Product Hero Card */}
                <div className="bg-white rounded-3xl p-5 sm:p-8 lg:p-10 border border-slate-200/80 shadow-sm">
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12">
                        
                        {/* Left Column: Image Gallery */}
                        <div className="lg:col-span-5 flex flex-col gap-4">
                            <div className="relative aspect-square rounded-2xl bg-gradient-to-b from-slate-50 to-slate-100/50 border border-slate-100 overflow-hidden flex items-center justify-center group p-6">
                                {/* Discount Ribbon Badge */}
                                {discountPercentage > 0 && (
                                    <div className="absolute top-4 left-4 z-10 bg-gradient-to-r from-red-600 to-orange-500 text-white font-black text-xs px-3 py-1 rounded-lg shadow-md uppercase tracking-wider flex items-center gap-1">
                                        <Sparkles size={12} /> {discountPercentage}% OFF
                                    </div>
                                )}

                                <img
                                    src={applyCloudinaryTransform(activeImage, "f_auto,q_auto,w_800")}
                                    alt={product.name}
                                    loading="eager"
                                    className="w-full h-full object-contain mix-blend-multiply transition-transform duration-500 group-hover:scale-105"
                                />
                            </div>

                            {/* Thumbnail Gallery */}
                            {product.images?.length > 1 && (
                                <div className="flex gap-2.5 overflow-x-auto pb-1 scrollbar-none">
                                    {product.images.map((img, idx) => (
                                        <button
                                            key={idx}
                                            type="button"
                                            onClick={() => setActiveImage(img)}
                                            className={cn(
                                                "relative h-16 w-16 sm:h-20 sm:w-20 rounded-xl overflow-hidden flex-shrink-0 bg-slate-50 border-2 transition-all p-1.5 cursor-pointer",
                                                activeImage === img ? "border-primary ring-2 ring-primary/20 scale-95" : "border-slate-200/80 hover:border-slate-400 opacity-80 hover:opacity-100"
                                            )}
                                        >
                                            <img
                                                src={applyCloudinaryTransform(img, "f_auto,q_auto,w_160")}
                                                alt={`${product.name} angle ${idx + 1}`}
                                                className="w-full h-full object-contain"
                                            />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Right Column: Details & Actions */}
                        <div className="lg:col-span-7 flex flex-col justify-between">
                            <div>
                                {/* Category & Rating Pill */}
                                <div className="flex flex-wrap items-center gap-2.5 mb-3">
                                    <span className="bg-primary/10 text-primary px-3 py-1 rounded-lg text-xs font-black uppercase tracking-wider border border-primary/20">
                                        {product.categoryId?.name || 'Fresh Grocery'}
                                    </span>
                                    <div className="flex items-center gap-1 text-amber-600 font-bold bg-amber-50 border border-amber-200/60 px-2.5 py-1 rounded-lg text-xs">
                                        <Star size={13} className="fill-amber-400 text-amber-400" />
                                        <span>{ratingSummary.average > 0 ? ratingSummary.average.toFixed(1) : '4.8'}</span>
                                        <span className="text-amber-700/60">({ratingSummary.count > 0 ? ratingSummary.count : reviews.length || 'Verified'})</span>
                                    </div>
                                    {isOutOfStock ? (
                                        <span className="bg-red-50 text-red-600 border border-red-200 text-xs font-bold px-2.5 py-1 rounded-lg">
                                            Out of Stock
                                        </span>
                                    ) : (
                                        <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> In Stock
                                        </span>
                                    )}
                                </div>

                                {/* Product Name */}
                                <h1 className="text-2xl sm:text-3xl lg:text-4xl font-[900] text-slate-900 tracking-tight leading-snug mb-2">
                                    {product.name}
                                </h1>

                                {product.weight && (
                                    <p className="text-xs font-bold text-slate-500 mb-4 uppercase tracking-wider">
                                        Unit: <span className="text-slate-800 font-extrabold">{product.weight}</span>
                                    </p>
                                )}

                                {/* Pricing Section */}
                                <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-br from-slate-50 via-white to-slate-50 border border-slate-200/80 mb-6">
                                    <div className="flex flex-wrap items-baseline gap-3 mb-1.5">
                                        <span className="text-3xl sm:text-4xl font-black text-slate-900 tracking-tight">
                                            ₹{effectivePrice}
                                        </span>
                                        {discountPercentage > 0 && (
                                            <>
                                                <span className="text-lg sm:text-xl text-slate-400 line-through font-bold">
                                                    ₹{product.price}
                                                </span>
                                                <span className="bg-emerald-600 text-white text-xs font-black px-2.5 py-1 rounded-md shadow-sm uppercase tracking-wide">
                                                    Save ₹{savingsAmount} ({discountPercentage}% OFF)
                                                </span>
                                            </>
                                        )}
                                    </div>
                                    <p className="text-[11px] font-semibold text-slate-400">
                                        Inclusive of all applicable taxes
                                    </p>
                                </div>

                                {/* Description */}
                                {product.description && (
                                    <div className="mb-6">
                                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5">Product Description</h4>
                                        <p className="text-slate-600 text-sm sm:text-base leading-relaxed font-medium">
                                            {product.description}
                                        </p>
                                    </div>
                                )}

                                {/* Quick Highlights Grid */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6">
                                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Weight</p>
                                        <p className="text-xs sm:text-sm font-black text-slate-800 truncate">{product.weight || '1 unit'}</p>
                                    </div>
                                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Delivery</p>
                                        <p className="text-xs sm:text-sm font-black text-slate-800 truncate">10-15 Mins</p>
                                    </div>
                                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Brand</p>
                                        <p className="text-xs sm:text-sm font-black text-slate-800 truncate">{product.brand || 'Fresh'}</p>
                                    </div>
                                    <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/60 text-center">
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Returns</p>
                                        <p className={cn("text-xs sm:text-sm font-black truncate", product.returnPolicy?.isReturnable ? "text-emerald-600" : "text-rose-500")}>
                                            {product.returnPolicy?.isReturnable ? `${product.returnPolicy.returnWindowDays}d Return` : 'No Return'}
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Add to Cart CTA Row */}
                            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center gap-4">
                                {isOutOfStock ? (
                                    <Button
                                        disabled
                                        className="h-14 w-full sm:w-64 bg-slate-200 text-slate-500 text-sm font-black rounded-2xl cursor-not-allowed uppercase tracking-wider"
                                    >
                                        OUT OF STOCK
                                    </Button>
                                ) : quantity > 0 ? (
                                    <div className="flex items-center justify-between bg-primary text-white rounded-2xl h-14 w-full sm:w-56 px-2 shadow-lg shadow-primary/20">
                                        <button
                                            type="button"
                                            onClick={() => updateQuantity(product.id, -1, "")}
                                            className="w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-xl transition-all active:scale-90 cursor-pointer"
                                            aria-label="Decrease quantity"
                                        >
                                            <Minus size={20} strokeWidth={3} />
                                        </button>
                                        <span className="font-black text-lg">{quantity}</span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (availableStock > 0 && quantity >= availableStock) {
                                                    showToast(`Only ${availableStock} units available in stock`, 'info');
                                                    return;
                                                }
                                                updateQuantity(product.id, 1, "");
                                            }}
                                            className="w-10 h-10 flex items-center justify-center hover:bg-white/20 rounded-xl transition-all active:scale-90 cursor-pointer"
                                            aria-label="Increase quantity"
                                        >
                                            <Plus size={20} strokeWidth={3} />
                                        </button>
                                    </div>
                                ) : (
                                    <Button
                                        type="button"
                                        onClick={() => {
                                            if (isOutOfStock) {
                                                showToast(`${product.name} is currently out of stock`, 'error');
                                                return;
                                            }
                                            addToCart(product);
                                            showToast(`${product.name} added to cart!`, 'success');
                                        }}
                                        className="h-14 w-full sm:w-64 bg-primary hover:bg-primary/95 text-white text-sm font-black rounded-2xl shadow-xl shadow-primary/25 transition-all hover:-translate-y-0.5 active:scale-95 cursor-pointer uppercase tracking-wider"
                                    >
                                        <Plus className="mr-2" size={20} strokeWidth={3} /> ADD TO CART
                                    </Button>
                                )}

                                <div className="flex flex-col gap-1 text-center sm:text-left text-xs font-bold text-slate-500">
                                    <div className="flex items-center gap-1 text-emerald-700">
                                        <ShieldCheck size={15} />
                                        <span>100% Quality & Freshness Guarantee</span>
                                    </div>
                                    <div className="flex items-center gap-1 text-slate-400">
                                        <Clock size={15} />
                                        <span>Superfast instant delivery in 10-15 minutes</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>

                {/* Additional Specifications / Compliance (Shelf Life, Country, FSSAI) */}
                {(product.shelfLife || product.countryOfOrigin || product.fssaiLicense) && (
                    <div className="mt-6 bg-white rounded-3xl p-6 sm:p-8 border border-slate-200/80 shadow-sm">
                        <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">
                            <PackageCheck size={20} className="text-primary" /> Product Specifications & Origin
                        </h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {product.shelfLife && (
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Shelf Life</p>
                                    <p className="text-sm font-black text-slate-800">{product.shelfLife}</p>
                                </div>
                            )}
                            {product.countryOfOrigin && (
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Country of Origin</p>
                                    <p className="text-sm font-black text-slate-800">{product.countryOfOrigin}</p>
                                </div>
                            )}
                            {product.fssaiLicense && (
                                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-100">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">FSSAI License</p>
                                    <p className="text-sm font-black text-slate-800 break-all">{product.fssaiLicense}</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Reviews & Ratings Section */}
                <div className="mt-8 bg-white rounded-3xl p-6 sm:p-8 lg:p-10 border border-slate-200/80 shadow-sm">
                    <div className="flex flex-col lg:flex-row gap-10">
                        {/* Left: Write a review form */}
                        <div className="lg:w-[38%]">
                            <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/70">
                                <h3 className="text-xl font-black text-slate-900 mb-1">Customer Reviews</h3>
                                <p className="text-xs text-slate-500 font-medium mb-5">Share your feedback about this product</p>
                                
                                {product?.hasReviewed || localHasReviewed ? (
                                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
                                        <p className="text-xs font-bold text-emerald-700">Thank you! You have already reviewed this item.</p>
                                    </div>
                                ) : product?.hasPurchased ? (
                                    <form onSubmit={handleReviewSubmit} className="space-y-4">
                                        <div>
                                            <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider block mb-2">Rate this product</label>
                                            <div className="flex gap-1.5">
                                                {[1, 2, 3, 4, 5].map((star) => (
                                                    <button
                                                        key={star}
                                                        type="button"
                                                        onClick={() => setNewReview({ ...newReview, rating: star })}
                                                        className={cn(
                                                            "h-10 w-10 rounded-xl flex items-center justify-center transition-all cursor-pointer",
                                                            newReview.rating >= star ? "bg-amber-100 text-amber-500" : "bg-white border border-slate-200 text-slate-300 hover:text-amber-400"
                                                        )}
                                                    >
                                                        <Star className={cn("h-5 w-5", newReview.rating >= star && "fill-current")} />
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-[11px] font-black text-slate-400 uppercase tracking-wider block mb-2">Your Comments</label>
                                            <textarea
                                                value={newReview.comment}
                                                onChange={(e) => setNewReview({ ...newReview, comment: e.target.value })}
                                                placeholder="Write honest feedback about quality, freshness..."
                                                className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs font-medium min-h-[100px] outline-none ring-1 ring-transparent focus:ring-primary/30 transition-all"
                                            />
                                        </div>

                                        <Button
                                            type="submit"
                                            disabled={isSubmittingReview}
                                            className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-black rounded-xl text-xs uppercase tracking-wider transition-all"
                                        >
                                            {isSubmittingReview ? 'Submitting...' : 'Submit Review'}
                                        </Button>
                                    </form>
                                ) : (
                                    <div className="p-4 rounded-xl bg-white border border-slate-200/80 text-center">
                                        <p className="text-xs font-bold text-slate-500">Only verified purchasers of this item can leave a review.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Right: Reviews List & Rating Breakdown */}
                        <div className="lg:w-[62%] space-y-6">
                            {ratingSummary.count > 0 && (
                                <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200/70 flex flex-col sm:flex-row items-center gap-6">
                                    <div className="text-center sm:text-left shrink-0">
                                        <div className="text-4xl sm:text-5xl font-black text-slate-900">
                                            {ratingSummary.average > 0 ? ratingSummary.average.toFixed(1) : "0.0"}
                                        </div>
                                        <div className="flex justify-center sm:justify-start gap-1 my-1.5">
                                            {[1, 2, 3, 4, 5].map((s) => (
                                                <Star
                                                    key={s}
                                                    size={15}
                                                    className={cn(s <= Math.round(ratingSummary.average) ? "fill-amber-400 text-amber-400" : "text-slate-200")}
                                                />
                                            ))}
                                        </div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                            {ratingSummary.count} Ratings
                                        </p>
                                    </div>

                                    <div className="flex-1 w-full space-y-1.5">
                                        {[5, 4, 3, 2, 1].map((star) => {
                                            const count = ratingSummary.distribution?.[star] || 0;
                                            const percent = ratingSummary.count > 0 ? Math.round((count / ratingSummary.count) * 100) : 0;
                                            return (
                                                <div key={star} className="flex items-center gap-2 text-xs font-bold text-slate-600">
                                                    <span className="w-5 text-right text-[11px] shrink-0">{star}★</span>
                                                    <div className="flex-1 h-2 bg-slate-200 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-amber-400 rounded-full transition-all duration-300"
                                                            style={{ width: `${percent}%` }}
                                                        />
                                                    </div>
                                                    <span className="w-8 text-right text-[10px] text-slate-400 shrink-0">{percent}%</span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {reviewLoading ? (
                                <div className="flex justify-center py-12">
                                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                                </div>
                            ) : reviews.length > 0 ? (
                                <div className="space-y-3">
                                    {reviews.map((review) => (
                                        <div key={review.id || review._id} className="p-4 sm:p-5 rounded-2xl bg-white border border-slate-100 shadow-xs space-y-2">
                                            <div className="flex justify-between items-start">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="h-9 w-9 rounded-xl bg-emerald-50 text-emerald-700 font-black text-xs flex items-center justify-center border border-emerald-100">
                                                        {review.customerName?.[0] || "U"}
                                                    </div>
                                                    <div>
                                                        <h5 className="font-bold text-slate-800 text-xs sm:text-sm">
                                                            {review.customerName || "Customer"}
                                                        </h5>
                                                        <div className="flex items-center gap-1 mt-0.5">
                                                            {[...Array(5)].map((_, i) => (
                                                                <Star
                                                                    key={i}
                                                                    size={11}
                                                                    className={cn(i < review.rating ? "text-amber-400 fill-amber-400" : "text-slate-200")}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                                <span className="text-[10px] font-bold text-slate-400">
                                                    {new Date(review.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                </span>
                                            </div>

                                            {review.comment && (
                                                <p className="text-slate-700 text-xs sm:text-sm leading-relaxed pl-1">
                                                    "{review.comment}"
                                                </p>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="py-12 text-center rounded-2xl bg-slate-50 border border-slate-200/60">
                                    <p className="text-xs font-black text-slate-400 uppercase tracking-wider">No reviews yet for this product</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

            </div>

            {/* Mobile Floating Sticky Bottom CTA */}
            <div className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-3 shadow-2xl flex items-center justify-between gap-3">
                <div className="flex flex-col">
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Price</span>
                    <div className="flex items-baseline gap-1.5">
                        <span className="text-xl font-black text-slate-900">₹{effectivePrice}</span>
                        {discountPercentage > 0 && (
                            <span className="text-xs text-slate-400 line-through font-bold">₹{product.price}</span>
                        )}
                    </div>
                </div>

                <div className="flex-1 max-w-[200px]">
                    {isOutOfStock ? (
                        <Button
                            disabled
                            className="h-11 w-full bg-slate-200 text-slate-500 text-xs font-black rounded-xl cursor-not-allowed"
                        >
                            OUT OF STOCK
                        </Button>
                    ) : quantity > 0 ? (
                        <div className="flex items-center justify-between bg-primary text-white rounded-xl h-11 px-2 shadow-md">
                            <button
                                type="button"
                                onClick={() => updateQuantity(product.id, -1, "")}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/20 active:scale-90"
                            >
                                <Minus size={16} strokeWidth={3} />
                            </button>
                            <span className="font-black text-sm">{quantity}</span>
                            <button
                                type="button"
                                onClick={() => {
                                    if (availableStock > 0 && quantity >= availableStock) {
                                        showToast(`Only ${availableStock} units available`, 'info');
                                        return;
                                    }
                                    updateQuantity(product.id, 1, "");
                                }}
                                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-white/20 active:scale-90"
                            >
                                <Plus size={16} strokeWidth={3} />
                            </button>
                        </div>
                    ) : (
                        <Button
                            type="button"
                            onClick={() => {
                                addToCart(product);
                                showToast(`${product.name} added to cart!`, 'success');
                            }}
                            className="h-11 w-full bg-primary hover:bg-primary/95 text-white text-xs font-black rounded-xl shadow-lg shadow-primary/20 active:scale-95 uppercase tracking-wider"
                        >
                            <Plus size={16} className="mr-1" strokeWidth={3} /> ADD TO CART
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ProductDetailPage;
