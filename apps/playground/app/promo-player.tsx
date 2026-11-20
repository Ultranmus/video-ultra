'use client';

/**
 * The home page's promo video, shown on a laptop screen. It plays muted and loops (the captions
 * are part of the picture); the control bar has play / pause, a seek bar, the time, sound and
 * full screen. Reduced motion: it waits for a press instead of playing by itself.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';

const ICONS = {
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M7 5h3.5v14H7zM13.5 5H17v14h-3.5z',
  soundOn: 'M4 9v6h4l5 4V5L8 9H4zm12.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z',
  soundOff: 'M4 9v6h4l5 4V5L8 9H4zm12 .5 5 5m0-5-5 5',
  full: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',
  exitFull: 'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',
} as const;

function Icon({ d, fill = false }: { d: string; fill?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d={d}
        fill={fill ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

/** The promo on a laptop screen, with its own controls. */
export function PromoVideo() {
  const screen = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [full, setFull] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    // The length may arrive before React listens: read it once here too.
    if (video.readyState >= 1 && Number.isFinite(video.duration)) setDuration(video.duration);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    void video.play().catch(() => {
      // Autoplay refused (data saver, low power): the big play button stays.
    });
  }, []);
  useEffect(() => {
    const update = () => setFull(document.fullscreenElement === screen.current);
    document.addEventListener('fullscreenchange', update);
    return () => document.removeEventListener('fullscreenchange', update);
  }, []);

  const video = () => ref.current;
  const toggle = () => {
    const v = video();
    if (!v) return;
    if (v.paused) void v.play();
    else v.pause();
  };
  const sound = () => {
    const v = video();
    if (!v) return;
    const next = !muted;
    v.muted = next;
    setMuted(next);
    if (!next && !started) {
      // Sound on for the first time: start from the top so the voiceover makes sense.
      v.currentTime = 0;
      setStarted(true);
    }
    if (!next) void v.play();
  };
  const fullscreen = () => {
    const el = screen.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else if (el.requestFullscreen) void el.requestFullscreen();
    // iPhone Safari: only the video element itself can go full screen.
    else (video() as HTMLVideoElement & { webkitEnterFullscreen?: () => void })?.webkitEnterFullscreen?.();
  };

  const progress = duration ? (time / duration) * 100 : 0;
  return (
    <figure className="home-promo">
      <div className="home-laptop">
        <div className="home-laptop-screen" ref={screen} data-full={full ? '' : undefined}>
          <video
            ref={ref}
            src="/home/promo.mp4"
            poster="/home/promo-poster.jpg"
            muted
            loop
            playsInline
            preload="metadata"
            aria-label="VideoUltra in about a minute: a travel video made in the editor, then added to an app"
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
          >
            <track kind="captions" src="/home/promo.vtt" srcLang="en" label="English" />
          </video>
          {playing ? null : (
            <button
              type="button"
              className="home-promo-big"
              onClick={() => {
                setStarted(true);
                void video()?.play();
              }}
            >
              <Icon d={ICONS.play} fill />
              <span>Watch the tour</span>
            </button>
          )}
          <div className="home-promo-bar">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? 'Pause' : 'Play'}
              title={playing ? 'Pause' : 'Play'}
            >
              <Icon d={playing ? ICONS.pause : ICONS.play} fill />
            </button>
            <input
              className="home-promo-seek"
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={time}
              aria-label="Seek"
              aria-valuetext={`${clock(time)} of ${clock(duration)}`}
              style={{ '--seek': `${progress}%` } as CSSProperties}
              onChange={(e) => {
                const v = video();
                if (v) v.currentTime = Number(e.target.value);
              }}
            />
            <span className="home-promo-time">
              {clock(time)} / {clock(duration)}
            </span>
            <button
              type="button"
              onClick={sound}
              aria-pressed={!muted}
              aria-label={muted ? 'Turn the sound on' : 'Turn the sound off'}
              title={muted ? 'Sound on' : 'Sound off'}
            >
              <Icon d={muted ? ICONS.soundOff : ICONS.soundOn} />
            </button>
            <button
              type="button"
              onClick={fullscreen}
              aria-label={full ? 'Leave full screen' : 'Full screen'}
              title={full ? 'Leave full screen' : 'Full screen'}
            >
              <Icon d={full ? ICONS.exitFull : ICONS.full} />
            </button>
          </div>
        </div>
        <div className="home-laptop-base" aria-hidden="true" />
      </div>
    </figure>
  );
}
