import { useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "@noshen/ui/ui";
import { useT } from "@noshen/ui/i18n";
import { clock, posterUrl, videoUrl } from "@noshen/shared/photos";

/** How long the controls stay up while the video plays, after the last touch or mouse move. */
const IDLE_MS = 2500;

/**
 * A listing's video, as one slide of the photo carousel. Nothing loads until the buyer taps play (video is heavy on
 * mobile data), and data saver plays the light copy. The video sits whole on a blurred copy of its own still frame
 * (or of the cover photo, when there's no still), whatever its shape. It pauses when it's swiped away, and its
 * controls fade while it plays. `playRef` lets the "Watch video" button start it from another slide.
 */
export function VideoSlide({ videoKey, seconds, backdrop, lite, title, playRef }: {
  videoKey: string; seconds: number | null; backdrop?: string; lite: boolean; title: string;
  playRef?: RefObject<(() => void) | null>;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [started, setStarted] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [muted, setMuted] = useState(false);
  const [idle, setIdle] = useState(false);
  const [time, setTime] = useState(0);
  const [length, setLength] = useState(seconds ?? 0);

  const wake = () => {
    setIdle(false);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setIdle(true), IDLE_MS);
  };
  const play = () => {
    const v = video.current;
    if (!v) return;
    setStarted(true);
    wake();
    v.play().catch(() => setPlaying(false));
  };
  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (v.paused) play();
    else { v.pause(); wake(); }
  };
  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = video.current;
    if (!v || !length) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length;
    wake();
  };
  const fullScreen = () => {
    const el = box.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) { document.exitFullscreen().catch(() => {}); return; }
    // iPhones can only put the video itself full screen, with their own controls.
    if (el?.requestFullscreen) el.requestFullscreen().catch(() => v?.webkitEnterFullscreen?.());
    else if (el?.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else v?.webkitEnterFullscreen?.();
  };

  if (playRef) playRef.current = play;

  // Swiped to another photo, or scrolled off the page: pause.
  useEffect(() => {
    const el = box.current;
    if (!el || typeof IntersectionObserver !== "function") return;
    const io = new IntersectionObserver(([e]) => { if (!e.isIntersecting) video.current?.pause(); }, { threshold: 0.6 });
    io.observe(el);
    return () => { io.disconnect(); clearTimeout(idleTimer.current); };
  }, []);

  const cls = ["video-slide", started && "started", playing && "playing", waiting && "waiting", playing && idle && "idle"].filter(Boolean).join(" ");
  const backdrops = [`url("${posterUrl(videoKey)}")`, backdrop ? `url("${backdrop}")` : null].filter(Boolean).join(", ");
  return (
    <div ref={box} className={cls} role="group" aria-label={t("Video of {title}", { title })} onPointerMove={playing ? wake : undefined}>
      <div className="video-backdrop" style={{ backgroundImage: backdrops }} aria-hidden="true" />
      <video ref={video} src={videoUrl(videoKey, lite ? "small" : undefined)} poster={posterUrl(videoKey)} preload="none" playsInline
        onClick={toggle} onPlay={() => setPlaying(true)} onPause={() => { setPlaying(false); setWaiting(false); }}
        onEnded={() => { setPlaying(false); setTime(0); }} onWaiting={() => setWaiting(true)} onPlaying={() => setWaiting(false)}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)} onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
        onLoadedMetadata={(e) => { if (Number.isFinite(e.currentTarget.duration)) setLength(e.currentTarget.duration); }} />
      <div className="video-shade" aria-hidden="true" />

      {!playing ? (
        <button type="button" className="video-play" onClick={play}
          aria-label={seconds !== null && !started ? t("Play the video, {time} long", { time: clock(seconds) }) : t("Play the video")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.5 5.6v12.8a1 1 0 0 0 1.52 .85l10.4 -6.4a1 1 0 0 0 0 -1.7l-10.4 -6.4a1 1 0 0 0 -1.52 .85z" /></svg>
        </button>
      ) : null}
      {waiting ? <span className="video-spinner" aria-hidden="true" /> : null}

      {!started ? (
        <span className="video-chip caption"><Icon name="video" size={14} />{seconds !== null ? `${t("Video")} · ${clock(seconds)}` : t("Video")}</span>
      ) : (
        <>
          <div className="video-controls">
            <button type="button" className="video-btn" onClick={toggle} aria-label={playing ? t("Pause") : t("Play")}><Icon name={playing ? "player-pause" : "player-play"} size={16} className="filled" /></button>
            <span className="video-time caption" aria-hidden="true">{clock(time)} / {clock(length)}</span>
            <button type="button" className="video-btn" onClick={() => { if (video.current) video.current.muted = !muted; wake(); }}
              aria-label={muted ? t("Turn the sound on") : t("Turn the sound off")}><Icon name={muted ? "volume-3" : "volume"} size={16} /></button>
            <button type="button" className="video-btn" onClick={fullScreen} aria-label={t("Full screen")}><Icon name="maximize" size={16} /></button>
          </div>
          <div className="video-progress" onClick={seek} aria-hidden="true">
            <span style={{ transform: `scaleX(${length ? Math.min(1, time / length) : 0})` }} />
          </div>
        </>
      )}
    </div>
  );
}
