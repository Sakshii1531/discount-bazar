import React from "react";

/** Lets the admin watch an uploaded video before saving the banner. */
const BannerVideoPreview = ({ banner }) => {
  if (banner?.mediaType !== "video" || !banner.videoUrl) return null;
  return (
    <video
      key={banner.videoUrl}
      src={banner.videoUrl}
      poster={banner.imageUrl || undefined}
      controls
      loop
      playsInline
      preload="metadata"
      className="w-full max-h-48 rounded-xl bg-black object-contain"
      data-testid="banner-video-preview"
    />
  );
};

export default BannerVideoPreview;
