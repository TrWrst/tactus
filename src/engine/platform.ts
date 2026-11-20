/**
 * Platform helpers that keep the metronome alive: screen wake lock, Media
 * Session (lock-screen / headset play-pause), and the audio-session category
 * on Safari so clicks play with the silent switch on and in the background.
 */

type WakeLockSentinelLike = { release(): Promise<void>; released?: boolean };

let wakeLock: WakeLockSentinelLike | null = null;
let wantWakeLock = false;

async function acquireWakeLock(): Promise<void> {
  const wl = (navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> } })
    .wakeLock;
  if (!wl || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await wl.request('screen');
  } catch {
    wakeLock = null; // denied (battery saver, etc.) — playback continues regardless
  }
}

export async function setKeepAwake(on: boolean): Promise<void> {
  wantWakeLock = on;
  if (on) {
    if (!wakeLock || wakeLock.released) await acquireWakeLock();
  } else if (wakeLock) {
    const wl = wakeLock;
    wakeLock = null;
    await wl.release().catch(() => {});
  }
}

if (typeof document !== 'undefined') {
  // Wake locks are dropped when the page is hidden; take it back on return.
  document.addEventListener('visibilitychange', () => {
    if (wantWakeLock && document.visibilityState === 'visible') void acquireWakeLock();
  });
}

/** Ask Safari to treat Web Audio as media playback (ignores the ring/silent switch). */
export function setPlaybackAudioSession(): void {
  const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (s) {
    try {
      s.type = 'playback';
    } catch {
      /* not supported */
    }
  }
}

export interface MediaSessionHandlers {
  onPlay(): void;
  onPause(): void;
}

export function setupMediaSession(handlers: MediaSessionHandlers): void {
  if (!('mediaSession' in navigator)) return;
  const ms = navigator.mediaSession;
  const set = (action: MediaSessionAction, fn: () => void) => {
    try {
      ms.setActionHandler(action, fn);
    } catch {
      /* action not supported */
    }
  };
  set('play', handlers.onPlay);
  set('pause', handlers.onPause);
  set('stop', handlers.onPause);
}

export function updateMediaSession(playing: boolean, bpm: number, meter: string): void {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `${bpm} BPM · ${meter}`,
      artist: 'Tactus Metronome',
      artwork: [{ src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }],
    });
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  } catch {
    /* ignore */
  }
}

export const canVibrate = (): boolean => typeof navigator !== 'undefined' && 'vibrate' in navigator;

export function vibrate(ms: number): void {
  if (canVibrate()) navigator.vibrate(ms);
}
