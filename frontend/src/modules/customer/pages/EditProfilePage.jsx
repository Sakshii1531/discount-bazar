import React, { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Phone, Mail, Camera, Save, Loader2, Image as ImageIcon, Trash2, X, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

import axiosInstance from '@core/api/axios';
import { useAuth } from '@core/context/AuthContext';
import { customerApi } from '../services/customerApi';

const EditProfilePage = () => {
    const navigate = useNavigate();
    const { user, login, updateUser, refreshUser } = useAuth();
    const galleryInputRef = useRef(null);
    const cameraInputRef = useRef(null);
    const videoRef = useRef(null);

    const [isLoading, setIsLoading] = useState(false);
    const [isUploadingPhoto, setIsUploadingPhoto] = useState(false);
    const [showPhotoOptions, setShowPhotoOptions] = useState(false);
    const [isWebcamOpen, setIsWebcamOpen] = useState(false);
    const [mediaStream, setMediaStream] = useState(null);
    const [facingMode, setFacingMode] = useState('user');

    const [photoPreview, setPhotoPreview] = useState(user?.profileImage || user?.avatar || '');
    const [formData, setFormData] = useState({
        name: user?.name || '',
        phone: user?.phone || '',
        email: user?.email || '',
        bio: user?.bio || '',
        profileImage: user?.profileImage || user?.avatar || ''
    });

    useEffect(() => {
        if (isWebcamOpen && mediaStream && videoRef.current) {
            videoRef.current.srcObject = mediaStream;
            videoRef.current.play().catch((err) => console.log('Video play error:', err));
        }
    }, [isWebcamOpen, mediaStream]);

    useEffect(() => {
        return () => {
            if (mediaStream) {
                mediaStream.getTracks().forEach((track) => track.stop());
            }
        };
    }, [mediaStream]);

    const isMobileDevice = () => {
        if (typeof window === 'undefined') return false;
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
            (window.matchMedia && window.matchMedia('(max-width: 768px)').matches && 'ontouchstart' in window);
    };

    const processImageFile = async (file) => {
        if (!file) return;

        if (!file.type.startsWith('image/')) {
            toast.error('Please select a valid image file');
            return;
        }

        if (file.size > 5 * 1024 * 1024) {
            toast.error('Image size must be less than 5MB');
            return;
        }

        // Show immediate local preview
        const localUrl = URL.createObjectURL(file);
        setPhotoPreview(localUrl);

        try {
            setIsUploadingPhoto(true);
            const uploadForm = new FormData();
            uploadForm.append('file', file);
            uploadForm.append('entityType', 'profile');

            const res = await axiosInstance.post('/media/upload', uploadForm, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });

            const uploadedUrl = res.data?.result?.url || res.data?.result?.secureUrl || res.data?.url;
            if (uploadedUrl) {
                setFormData((prev) => ({ ...prev, profileImage: uploadedUrl }));
                setPhotoPreview(uploadedUrl);
                toast.success('Photo uploaded!');
            } else {
                throw new Error('Upload failed');
            }
        } catch (err) {
            console.error('Media upload error, falling back to data URL:', err);
            const reader = new FileReader();
            reader.onloadend = () => {
                setFormData((prev) => ({ ...prev, profileImage: reader.result }));
                setPhotoPreview(reader.result);
                toast.success('Photo selected!');
            };
            reader.readAsDataURL(file);
        } finally {
            setIsUploadingPhoto(false);
        }
    };

    const handlePhotoSelect = async (e) => {
        const file = e.target.files?.[0];
        if (file) {
            await processImageFile(file);
        }
        if (e.target) e.target.value = '';
    };

    const handleCameraClick = () => {
        setShowPhotoOptions(false);
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            startWebcam();
        } else {
            cameraInputRef.current?.click();
        }
    };

    const handleGalleryClick = () => {
        setShowPhotoOptions(false);
        galleryInputRef.current?.click();
    };

    const handleRemovePhoto = () => {
        setShowPhotoOptions(false);
        setPhotoPreview('');
        setFormData((prev) => ({ ...prev, profileImage: '' }));
        toast.success('Photo removed');
    };

    const startWebcam = async () => {
        try {
            setIsWebcamOpen(true);
            let stream;
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode: { ideal: facingMode }, width: { ideal: 720 }, height: { ideal: 720 } }
                });
            } catch {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: { facingMode }
                });
            }
            setMediaStream(stream);
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
            }
        } catch (err) {
            console.error('Webcam error:', err);
            setIsWebcamOpen(false);
            toast.error('Could not access camera. Opening camera input.');
            cameraInputRef.current?.click();
        }
    };

    const stopWebcam = () => {
        if (mediaStream) {
            mediaStream.getTracks().forEach((track) => track.stop());
            setMediaStream(null);
        }
        setIsWebcamOpen(false);
    };

    const toggleFacingMode = async () => {
        const newMode = facingMode === 'user' ? 'environment' : 'user';
        setFacingMode(newMode);
        if (mediaStream) {
            mediaStream.getTracks().forEach((track) => track.stop());
        }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: newMode, width: { ideal: 720 }, height: { ideal: 720 } }
            });
            setMediaStream(stream);
        } catch (err) {
            console.error('Failed to flip camera:', err);
        }
    };

    const captureWebcamPhoto = () => {
        if (!videoRef.current) return;
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 640;
        const ctx = canvas.getContext('2d');
        if (facingMode === 'user') {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        canvas.toBlob((blob) => {
            if (!blob) {
                toast.error('Failed to capture photo');
                return;
            }
            const file = new File([blob], `profile-photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
            stopWebcam();
            processImageFile(file);
        }, 'image/jpeg', 0.92);
    };

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setIsLoading(true);
        try {
            const response = await customerApi.updateProfile(formData);
            const updatedUser = response.data?.result || response.data?.data || response.data || {};

            const mergedUser = {
                ...user,
                ...(typeof updatedUser === 'object' ? updatedUser : {}),
                profileImage: formData.profileImage || photoPreview || user?.profileImage,
                avatar: formData.profileImage || photoPreview || user?.avatar,
                name: formData.name,
                bio: formData.bio,
                email: formData.email,
            };

            // Update local auth state immediately so the new photo displays instantly
            if (updateUser) {
                updateUser(mergedUser);
            }
            if (login) {
                login(mergedUser);
            }
            if (refreshUser) {
                refreshUser().catch(() => {});
            }

            toast.success('Profile updated successfully!');
            navigate('/profile');
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to update profile');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 font-sans pb-10">
            {/* Header */}
            <div className="bg-white sticky top-0 z-30 px-4 py-3 flex items-center gap-3 shadow-sm">
                <Link to="/profile" className="p-2 -ml-2 rounded-full hover:bg-slate-100 transition-colors">
                    <ArrowLeft size={24} className="text-slate-600" />
                </Link>
                <h1 className="text-lg font-black text-slate-800">Edit Profile</h1>
            </div>

            <div className="max-w-xl mx-auto p-5">

                {/* Profile Picture Upload */}
                <div className="flex flex-col items-center mb-8">
                    {/* Hidden inputs for camera capture and gallery selection */}
                    <input
                        type="file"
                        ref={cameraInputRef}
                        accept="image/*"
                        capture="user"
                        onChange={handlePhotoSelect}
                        className="hidden"
                    />
                    <input
                        type="file"
                        ref={galleryInputRef}
                        accept="image/*"
                        onChange={handlePhotoSelect}
                        className="hidden"
                    />

                    <div 
                        className="relative cursor-pointer group"
                        onClick={() => setShowPhotoOptions(true)}
                        title="Click to change photo"
                    >
                        <div className="h-28 w-28 rounded-full bg-slate-200 border-4 border-white shadow-md flex items-center justify-center overflow-hidden">
                            {photoPreview ? (
                                <img
                                    src={photoPreview}
                                    alt="Profile"
                                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                                />
                            ) : (
                                <User size={48} className="text-slate-400" />
                            )}
                        </div>
                        <button
                            type="button"
                            disabled={isUploadingPhoto}
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowPhotoOptions(true);
                            }}
                            className="absolute bottom-0 right-0 p-2.5 bg-primary text-primary-foreground rounded-full border-2 border-white shadow-sm hover:bg-primary/90 active:scale-95 transition-all cursor-pointer"
                            aria-label="Change photo"
                        >
                            {isUploadingPhoto ? (
                                <Loader2 size={18} className="animate-spin" />
                            ) : (
                                <Camera size={18} />
                            )}
                        </button>
                    </div>
                    <button
                        type="button"
                        disabled={isUploadingPhoto}
                        onClick={() => setShowPhotoOptions(true)}
                        className="mt-3 text-sm font-bold text-primary hover:underline cursor-pointer active:scale-95 transition-all"
                    >
                        {isUploadingPhoto ? 'Uploading photo...' : 'Change Photo'}
                    </button>
                </div>

                {/* Edit Form */}
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 space-y-5">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full Name</label>
                            <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all">
                                <User size={20} className="text-slate-400" />
                                <input
                                    type="text"
                                    name="name"
                                    maxLength={50}
                                    pattern="[a-zA-Z\s]*"
                                    value={formData.name}
                                    onChange={(e) => {
                                        e.target.value = e.target.value.replace(/[^a-zA-Z\s]/g, '');
                                        handleChange(e);
                                    }}
                                    className="bg-transparent w-full text-slate-800 font-bold outline-none placeholder:font-medium"
                                    placeholder="Enter your name"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Phone Number</label>
                            <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all">
                                <Phone size={20} className="text-slate-400" />
                                <input
                                    type="tel"
                                    name="phone"
                                    value={formData.phone}
                                    onChange={handleChange}
                                    className="bg-transparent w-full text-slate-800 font-bold outline-none placeholder:font-medium"
                                    placeholder="Enter phone number"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Email Address</label>
                            <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 focus-within:border-primary focus-within:ring-4 focus-within:ring-primary/10 transition-all">
                                <Mail size={20} className="text-slate-400" />
                                <input
                                    type="email"
                                    name="email"
                                    value={formData.email}
                                    onChange={handleChange}
                                    className="bg-transparent w-full text-slate-800 font-bold outline-none placeholder:font-medium"
                                    placeholder="Enter email address"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Bio</label>
                            <textarea
                                name="bio"
                                value={formData.bio}
                                onChange={handleChange}
                                rows="3"
                                className="w-full bg-slate-50 px-4 py-3 rounded-xl border border-slate-200 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all outline-none text-slate-800 font-medium resize-none"
                                placeholder="Tell us about yourself..."
                            ></textarea>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading || isUploadingPhoto}
                        className="w-full py-4 bg-primary text-primary-foreground font-bold rounded-2xl shadow-lg shadow-brand-200 hover:bg-[#0a701a] active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                        {isLoading ? (
                            <div className="h-5 w-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                            <Save size={20} />
                        )}
                        {isLoading ? 'Saving...' : 'Save Changes'}
                    </button>
                </form>

            </div>

            {/* Photo Options Action Sheet / Modal */}
            {showPhotoOptions && (
                <div 
                    className="fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
                    onClick={() => setShowPhotoOptions(false)}
                >
                    <div 
                        className="bg-white w-full max-w-sm rounded-t-[32px] sm:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom-10 duration-200"
                        style={{ paddingBottom: 'max(1.75rem, env(safe-area-inset-bottom, 24px))' }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-4 sm:hidden" />
                        <h3 className="text-lg font-black text-slate-800 mb-1 text-center">Profile Photo</h3>
                        <p className="text-xs font-semibold text-slate-400 text-center mb-6">Choose an option to update your photo</p>

                        <div className="space-y-3">
                            {/* Camera Option */}
                            <button
                                type="button"
                                onClick={handleCameraClick}
                                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-50 hover:bg-emerald-50 text-slate-700 hover:text-emerald-700 border border-slate-100 hover:border-emerald-200 transition-all group font-bold text-sm cursor-pointer"
                            >
                                <div className="w-11 h-11 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <Camera size={22} />
                                </div>
                                <div className="text-left">
                                    <div className="font-extrabold text-slate-800 group-hover:text-emerald-800">Take Photo</div>
                                    <div className="text-[11px] text-slate-400 font-medium">Use camera to click a photo</div>
                                </div>
                            </button>

                            {/* Gallery Option */}
                            <button
                                type="button"
                                onClick={handleGalleryClick}
                                className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-50 hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-100 hover:border-blue-200 transition-all group font-bold text-sm cursor-pointer"
                            >
                                <div className="w-11 h-11 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                                    <ImageIcon size={22} />
                                </div>
                                <div className="text-left">
                                    <div className="font-extrabold text-slate-800 group-hover:text-blue-800">Choose from Gallery</div>
                                    <div className="text-[11px] text-slate-400 font-medium">Select photo from files or gallery</div>
                                </div>
                            </button>

                            {/* Remove Photo Option (if photo exists) */}
                            {(photoPreview || formData.profileImage) && (
                                <button
                                    type="button"
                                    onClick={handleRemovePhoto}
                                    className="w-full flex items-center gap-4 p-4 rounded-2xl bg-slate-50 hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-slate-100 hover:border-rose-200 transition-all group font-bold text-sm cursor-pointer"
                                >
                                    <div className="w-11 h-11 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center group-hover:scale-110 transition-transform">
                                        <Trash2 size={22} />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-extrabold text-rose-600">Remove Photo</div>
                                        <div className="text-[11px] text-rose-400 font-medium">Delete current profile picture</div>
                                    </div>
                                </button>
                            )}
                        </div>

                        <button
                            type="button"
                            onClick={() => setShowPhotoOptions(false)}
                            className="w-full mt-4 py-3.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-sm transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {/* Live Webcam Modal */}
            {isWebcamOpen && (
                <div className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="bg-slate-900 text-white w-full max-w-md rounded-3xl p-6 shadow-2xl flex flex-col items-center relative border border-slate-800 animate-in zoom-in-95 duration-200">
                        <button
                            type="button"
                            onClick={stopWebcam}
                            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                        >
                            <X size={20} />
                        </button>

                        <h3 className="text-lg font-black mb-1">Take Profile Photo</h3>
                        <p className="text-xs text-slate-400 mb-4">Position your face within the frame</p>

                        <div className="relative w-64 h-64 rounded-full overflow-hidden border-4 border-primary shadow-lg bg-black mb-6">
                            <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                muted
                                className={`w-full h-full object-cover ${facingMode === 'user' ? 'transform -scale-x-100' : ''}`}
                            />
                        </div>

                        <div className="flex items-center gap-3 w-full justify-center">
                            <button
                                type="button"
                                onClick={toggleFacingMode}
                                className="p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors flex items-center justify-center cursor-pointer"
                                title="Flip Camera"
                            >
                                <RefreshCw size={18} />
                            </button>
                            <button
                                type="button"
                                onClick={stopWebcam}
                                className="px-5 py-2.5 rounded-full bg-white/10 hover:bg-white/20 text-sm font-bold transition-colors cursor-pointer"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={captureWebcamPhoto}
                                className="px-6 py-2.5 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground font-black text-sm flex items-center gap-2 shadow-lg shadow-brand-500/30 active:scale-95 transition-all cursor-pointer"
                            >
                                <Camera size={18} />
                                Capture
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default EditProfilePage;
