import React from "react";
import { flushSync } from "react-dom";
import { Volume2, VolumeX } from "lucide-react";
import { cn } from "@/lib/utils";

const prefersNoAutoplay = () =>
  Boolean(navigator.connection?.saveData) ||
  Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

const usePageLoaded = () => {
  const [loaded, setLoaded] = React.useState(() => document.readyState === "complete");
  React.useEffect(() => {
    if (loaded) return undefined;
    const onLoad = () => setLoaded(true);
    window.addEventListener("load", onLoad);
    return () => window.removeEventListener("load", onLoad);
  }, [loaded]);
  return loaded;
};

const usePageVisible = () => {
  const [visible, setVisible] = React.useState(() => !document.hidden);
  React.useEffect(() => {
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, []);
  return visible;
};

// Seconds played with no audio decoded before Chromium browsers call a video silent.
const SILENT_AFTER_SECONDS = 1.5;

// True or false once the browser can tell whether the file has sound, otherwise null.
const readHasAudio = (video) => {
  if (typeof video.mozHasAudio === "boolean") return video.mozHasAudio;
  if (video.audioTracks) return video.audioTracks.length > 0;
  if (typeof video.webkitAudioDecodedByteCount !== "number") return null;
  if (video.webkitAudioDecodedByteCount > 0) return true;
  return video.currentTime >= SILENT_AFTER_SECONDS ? false : null;
};

const remainingPlayMs = (video) =>
  Number.isFinite(video.duration) ? (video.duration - video.currentTime) * 1000 : 0;

// Only one banner is audible at a time, across every carousel on the page.
let muteAudibleVideo = null;

// A press on the sound button must not start the carousel's swipe, which listens natively.
const stopNativePropagation = (e) => e.stopPropagation();
const attachSwipeGuard = (button) => button?.addEventListener("pointerdown", stopNativePropagation);

/**
 * Looping banner video that autoplays muted, as browsers require, with a button
 * for the original sound. `poster` is the banner's ordinary <img>: it stays
 * underneath and sets the slide's size, so the video fades in over it and the
 * poster remains if the video cannot play. No video data is requested until the
 * page has loaded and the slide is both active and on screen. `onHold` tells the
 * carousel how many ms to stay on this slide: one full play, or for as long as
 * the customer is listening.
 */
const BannerVideo = ({ src, poster, active, onHold }) => {
  const wrapperRef = React.useRef(null);
  const videoRef = React.useRef(null);
  const announcedRef = React.useRef(false);
  const [inView, setInView] = React.useState(false);
  const [requested, setRequested] = React.useState(false);
  const [playing, setPlaying] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const [soundOn, setSoundOn] = React.useState(false);
  const [hasAudio, setHasAudio] = React.useState(null);
  const [startedByUser, setStartedByUser] = React.useState(false);
  const pageLoaded = usePageLoaded();
  const pageVisible = usePageVisible();
  const [autoplayAllowed] = React.useState(() => !prefersNoAutoplay());
  const muteThisVideo = React.useCallback(() => setSoundOn(false), []);

  React.useEffect(() => {
    const node = wrapperRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return undefined;
    }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(
    () => () => {
      if (muteAudibleVideo === muteThisVideo) muteAudibleVideo = null;
    },
    [muteThisVideo],
  );

  const shouldPlay = (autoplayAllowed || startedByUser) && !failed && active && inView && pageLoaded && pageVisible;

  React.useEffect(() => {
    if (shouldPlay) setRequested(true);
  }, [shouldPlay]);

  const play = React.useCallback((video) => {
    video.play()?.catch((err) => {
      // The browser refused sound (no permission from a tap): keep playing muted.
      if (err?.name === "NotAllowedError" && !video.muted) {
        video.muted = true;
        setSoundOn(false);
        video.play()?.catch(() => {});
      }
    });
  }, []);

  React.useEffect(() => {
    if (!active) announcedRef.current = false;
    const video = videoRef.current;
    if (!video || !requested) return;
    // React does not reliably reflect `muted`, and browsers only autoplay muted video.
    video.muted = !soundOn;
    if (shouldPlay) {
      play(video);
    } else {
      video.pause();
    }
  }, [active, play, requested, shouldPlay, soundOn]);

  React.useEffect(() => {
    const video = videoRef.current;
    if (active && video && !video.paused) onHold?.(soundOn ? Infinity : remainingPlayMs(video));
  }, [active, onHold, soundOn]);

  const handlePlaying = (e) => {
    setPlaying(true);
    if (announcedRef.current) return; // a loop restart also fires "playing"
    if (!soundOn && !Number.isFinite(e.currentTarget.duration)) return;
    announcedRef.current = true;
    onHold?.(soundOn ? Infinity : remainingPlayMs(e.currentTarget));
  };

  const detectAudio = (e) => {
    if (hasAudio !== null) return;
    const detected = readHasAudio(e.currentTarget);
    if (detected === null) return;
    setHasAudio(detected);
    if (!detected) setSoundOn(false);
  };

  const handleError = () => {
    setFailed(true);
    setSoundOn(false);
    onHold?.(0);
  };

  const toggleSound = (e) => {
    e.stopPropagation(); // the slide around the button is the banner's link
    if (soundOn) {
      setSoundOn(false);
      return;
    }
    if (muteAudibleVideo !== muteThisVideo) muteAudibleVideo?.();
    muteAudibleVideo = muteThisVideo;
    // Commit first: phones only allow sound from inside the tap, so a video not
    // loaded yet (data saver, reduced motion) needs its source before play().
    flushSync(() => {
      setStartedByUser(true);
      setRequested(true);
      setSoundOn(true);
    });
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    if (video.volume === 0) video.volume = 1;
    play(video);
  };

  const showSoundButton = !failed && hasAudio !== false && (requested || !autoplayAllowed);
  const SoundIcon = soundOn ? Volume2 : VolumeX;

  return (
    <div ref={wrapperRef} className={cn("relative w-full", !poster && "min-h-32 bg-slate-100")}>
      {poster}
      {!failed && (
        <video
          ref={videoRef}
          src={requested ? src : undefined}
          muted={!soundOn}
          loop
          playsInline
          preload="none"
          aria-hidden="true"
          onPlaying={handlePlaying}
          onLoadedMetadata={detectAudio}
          onTimeUpdate={detectAudio}
          onError={handleError}
          className={cn(
            "pointer-events-none object-contain transition-opacity duration-300",
            poster ? "absolute inset-0 h-full w-full" : "h-auto w-full",
            poster && !playing && "opacity-0"
          )}
          data-testid="banner-video"
        />
      )}
      {showSoundButton && (
        <button
          ref={attachSwipeGuard}
          type="button"
          onClick={toggleSound}
          onKeyDown={(e) => e.stopPropagation()}
          aria-label={soundOn ? "Turn sound off" : "Turn sound on"}
          aria-pressed={soundOn}
          title={soundOn ? "Turn sound off" : "Turn sound on"}
          className="absolute bottom-3 right-3 z-10 flex h-11 w-11 touch-manipulation items-center justify-center rounded-full bg-black/70 text-white shadow-lg ring-1 ring-white/40 transition-colors hover:bg-black/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          data-testid="banner-sound-button"
        >
          <SoundIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

export default BannerVideo;
