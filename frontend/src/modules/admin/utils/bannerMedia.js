import { useEffect, useState } from "react";
import { adminApi } from "../services/adminApi";

const toMb = (bytes) => Number((bytes / (1024 * 1024)).toFixed(2));

export const hasBannerMedia = (banner) =>
  Boolean(banner?.imageUrl || (banner?.mediaType === "video" && banner?.videoUrl));

export const bannerMediaPayload = (banner) => ({
  imageUrl: banner.imageUrl || "",
  mediaType: banner.mediaType || "image",
  videoUrl: banner.videoUrl || "",
});

/** The upload limits set in the backend config (null until they have loaded). */
export const useBannerUploadConfig = () => {
  const [config, setConfig] = useState(null);
  useEffect(() => {
    let cancelled = false;
    adminApi
      .getBannerUploadConfig()
      .then((res) => {
        if (!cancelled) setConfig(res.data?.result || null);
      })
      // The server still enforces its limits when this cannot be read.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
};

export const bannerUploadAccept = (config) =>
  config?.allowedMimeTypes?.join(",") || "image/*,video/mp4";

export const bannerUploadHint = (config) =>
  config
    ? `JPG, PNG, WebP up to ${toMb(config.maxImageBytes)} MB, or MP4 up to ${config.maxVideoDurationSeconds} sec and ${toMb(config.maxVideoBytes)} MB`
    : "JPG, PNG, WebP or MP4";

const readVideoDuration = (file) =>
  new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(file);
    const finish = (settle, value) => {
      URL.revokeObjectURL(objectUrl);
      settle(value);
    };
    video.preload = "metadata";
    video.onloadedmetadata = () => finish(resolve, video.duration);
    video.onerror = () =>
      finish(reject, new Error("This video can't be played in the browser. Please export it as an H.264 MP4."));
    video.src = objectUrl;
  });

const assertWithinLimits = async (file, config) => {
  const isVideo = file.type.startsWith("video/");
  if (config) {
    if (!config.allowedMimeTypes.includes(file.type)) {
      throw new Error("Unsupported file. Please upload a JPG, PNG, WebP image or an MP4 video.");
    }
    const maxBytes = isVideo ? config.maxVideoBytes : config.maxImageBytes;
    if (file.size > maxBytes) {
      throw new Error(`${isVideo ? "Video" : "Image"} is too large. The maximum size is ${toMb(maxBytes)} MB.`);
    }
  }
  if (isVideo) {
    const duration = await readVideoDuration(file);
    if (config && duration > config.maxVideoDurationSeconds) {
      throw new Error(`Video is too long. The maximum length is ${config.maxVideoDurationSeconds} seconds.`);
    }
  }
};

/** Uploads an image or video and returns the banner fields to store for it. */
export const uploadBannerFile = async (file, config) => {
  await assertWithinLimits(file, config);
  const fd = new FormData();
  fd.append("image", file);
  let result;
  try {
    const res = await adminApi.uploadExperienceBanner(fd);
    result = res.data?.result;
  } catch (e) {
    throw new Error(e.response?.data?.message || "Failed to upload banner file", { cause: e });
  }
  if (!result?.url) throw new Error("Failed to upload banner file");
  return result.mediaType === "video"
    ? { mediaType: "video", videoUrl: result.url, imageUrl: result.posterUrl || "" }
    : { mediaType: "image", videoUrl: "", imageUrl: result.url };
};
