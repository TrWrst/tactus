# Tactus — metronome PWA

A precise, mobile-first practice metronome. React + TypeScript + Vite, installable as a PWA,
works offline, no backend. All click sounds are synthesized with Web Audio. There are no audio files.

## Run it

Requires Node 20+.

```bash
npm install
npm run dev        # http://localhost:5173  (hot reload, no service worker)
npm test           # Vitest unit tests
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ on http://localhost:4173 (service worker / offline / install)
```

To try it on a phone, run `npm run preview -- --host` and open the printed LAN URL. Note that wake
lock, install and the service worker need HTTPS on non-localhost origins. Use a tunnel or deploy `dist/`
to any static host.

### Try it on your phone (Wi-Fi, HTTPS)

Phones only allow the microphone on HTTPS pages. `npm run lan` serves the app over HTTPS on your local
network, using a self-signed certificate. Nothing is exposed to the internet.

```bash
# one-time: create a 30-day certificate for this Mac's Wi-Fi address
IP=$(ipconfig getifaddr en0); mkdir -p .cert && openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout .cert/key.pem -out .cert/cert.pem -days 30 -subj "/CN=Tactus local dev" \
  -addext "subjectAltName=IP:$IP,DNS:localhost"
npm run lan        # → https://<that IP>:4443
```

To open it on the iPhone (same Wi-Fi):
1. Open the address in Safari.
2. At "This connection is not private", tap **Show Details**, then **visit this website**.
3. Allow the microphone when asked.

If the Mac's IP changes, recreate the certificate. With a self-signed certificate the service worker
doesn't register, so offline mode and "Add to Home Screen" won't work on this test link. A real HTTPS
host fixes that.

Add `?debug` to the URL (or turn on **Options → Show timing stats**) to see live scheduler stats.

## Architecture

```
src/
  engine/              framework-free; no React imports
    types.ts           settings + BeatEvent types
    rhythm.ts          BPM clamp, subdivision offsets, swing, meters, tempo markings
    accents.ts         accent cycle, default patterns per meter, resize
    tapTempo.ts        tap averaging (last 2–8 taps, pause + outlier reset)
    sequencer.ts       pure lookahead beat math → BeatEvent[] (runs the trainers too)
    practice.ts        trainers: muted bars / random mutes, tempo ramp, stop-after, seeded RNG
    onsetDetector.ts   percussive hit detector (pure, sample-accurate)
    micWorklet.ts      AudioWorklet that runs the detector on the mic signal
    accuracy.ts        hit ↔ grid matching, timing stats, loopback-calibration maths
    accuracyMeter.ts   mic access, worklet graph, calibration, Bluetooth heuristics
    stats.ts           jitter / lateness statistics
    sounds.ts          7 synthesized voices (oscillators + generated noise)
    timerWorker.ts     25 ms wake-up tick in a Web Worker
    audioEngine.ts     AudioContext, scheduler loop, stop bus, visual clock
    platform.ts        wake lock, Media Session, Safari audioSession, vibration
  state/
    settings.ts        defaults, validation, localStorage persistence
    useMetronome.ts    React hook: engine ⇄ settings glue
    useAccuracy.ts     React hook: meter ⇄ sessions, live readout, results
  ui/                  TempoDial, BeatDots, TempoControls, BottomSheet, sheets, PracticeSheet, Stopwatch,
                       StatsPanel, MeterSheet (setup), ResultsSheet (charts), HitMeter (live)
  App.tsx, main.tsx, styles.css
```

### Timing model

1. **The wake-up timer is not the beat clock.** A Web Worker posts a `tick` every 25 ms. A worker
   keeps ticking while the main thread is busy, and background throttling is milder there.
2. On each tick, `MetronomeEngine.tick()` asks the `Sequencer` for every event with
   `time < audioContext.currentTime + 0.1 s`. It schedules each click with Web Audio at that exact
   `time`, so audio placement is sample-accurate. Timer jitter only shrinks the safety margin; it never
   moves a click.
3. The `Sequencer` is pure. It tracks bar / beat / sub position and the start time of the current beat.
   Tempo, subdivision and swing are locked at the start of each beat, so a change never stretches a beat
   halfway through. Beat times are accumulated sums of `60 / bpm`. A unit test checks 100 000 beats for drift.
4. **While the page is hidden or the screen is off**, the lookahead grows to 1 s so throttled timers can't
   starve the audio. If the scheduler falls more than 50 ms behind (frozen tab), it skips ahead silently
   rather than playing a burst of clicks.
5. **Practice trainers are evaluated inside the sequencer, on the audio timeline.** At each beat
   boundary it decides the beat's tempo (ramp), whether the beat is silenced (muting trainer) and whether
   the playback counter has run out. That makes them as precise as the clicks themselves. Silenced beats
   still advance time and still show on screen as an outlined dot. When the counter runs out, the engine
   stops itself at the end of the last beat.
6. **Stop** fades out a per-run gain bus, so clicks already scheduled up to 100 ms ahead never leak out.
7. **Visuals** come from a `requestAnimationFrame` loop. It emits each event when
   `currentTime − outputLatency` reaches it, so the pulse lines up with what you hear. React only
   re-renders once per beat.

### Keeping it alive

- **Screen Wake Lock** is held while playing and re-acquired when the page becomes visible again.
- **Media Session** sets the title (`120 BPM · 4/4`) and adds play/pause/stop handlers for the lock
  screen and headsets.
- **Safari 17+**: `navigator.audioSession.type = 'playback'` lets clicks play with the silent switch on.
- **Limitation:** if the user locks the screen manually, iOS may still suspend Web Audio in a browser tab
  or PWA. Playback resumes when the app is back in front. A truly locked-screen iOS metronome needs a
  native wrapper.

## Measured scheduling jitter

Chromium (in-app browser), Apple Silicon Mac, production build, mobile viewport:

| Scenario | Timer interval (mean ± sd) | p99 / max | Min lead before click | Late clicks |
|---|---|---|---|---|
| 100 BPM, quarters, idle UI (≈10 s) | 25.07 ± 2.80 ms | 30.1 / 54.0 ms | 50.0 ms* | 0 / 17 |
| 240 BPM, sixteenths, idle UI (10 s) | 24.99 ± 2.59 ms | 30.2 / 37.9 ms | 70.6 ms | 0 / 153 |
| 240 BPM, sixteenths, **UI blocked 60 ms every 120 ms** (15 s) | 25.04 ± 26.87 ms | 83.5 / 84.9 ms | 17.9 ms | 0 / 234 |

\* The first click is scheduled 50 ms after Start.

"Lead" is how far ahead of its play time each click was handed to Web Audio. As long as it stays above 0,
the click plays exactly on time. The budget is the 100 ms lookahead minus the longest main-thread stall.
A single blocking task longer than about 75 ms can therefore make clicks late (the stats panel counts
these). Use **Stress UI** in the stats panel to reproduce the third row.

## Feature checklist

### Phase 1 — core metronome ✅
- [x] Tempo 20–300 BPM: big readout, −/+ (hold to repeat), circular dial (drag / wheel / arrow keys)
- [x] Tap tempo (averages the last 2–8 taps, resets after a 2 s pause or a sudden tempo change)
- [x] Direct numeric entry (tap the number)
- [x] Large start/stop button
- [x] Time signatures 2/4, 3/4, 4/4, 5/4, 6/8, 7/8, 12/8 + custom (1–16 over 2/4/8/16)
- [x] Per-beat accents: tap a beat to cycle Accent → Normal → Soft → Muted; sensible defaults for compound and odd meters
- [x] Subdivisions: beat, eighths, triplets, sixteenths, quintuplets, sextuplets, septuplets
- [x] Swing 50–75% (eighths, sixteenths, sextuplets)
- [x] 7 synthesized sounds with preview: Blip, Wood, Tick, Bell, Shaker, Thump, Beep; volume
- [x] Count-in 0 / 1 / 2 bars (beats only, distinct pitch, teal indicator)
- [x] Visual modes: pulse ring, dots only, full-screen flash (disabled with reduced motion)
- [x] Dark / light / auto theme; vibration on beat (where the browser supports it)
- [x] Last-used settings saved to localStorage (validated on load)
- [x] PWA: installable, offline after first load
- [x] Wake lock + Media Session; larger lookahead while hidden
- [x] Keyboard: Space start/stop, ↑/↓ tempo (Shift ×10), T tap
- [x] Live jitter stats + UI stress test

### Phase 2 — practice trainers ✅
All in the **Practice** sheet (the button turns orange while any trainer is on). The trainers can be combined.
- [x] Muted bars: play N bars, then mute N bars, repeating (status shows "silent")
- [x] Random muted beats: each beat is silenced with a chosen probability (5–95%). All of its subdivisions go silent with it
- [x] Tempo ramp: ±X BPM every N bars or N seconds towards a target (up or down). At the target: Hold, Reverse (ping-pong) or Restart
  - Starts from your set tempo, and the dial shows the live tempo while ramping. Your saved tempo is unchanged when you stop
  - Seconds are measured on the audio clock from the first bar after the count-in. A change lands on the next beat
- [x] Playback counter: stop after N bars or after a duration (stops on the first beat boundary at or after it; the count-in doesn't count). Shows "Finished ✓"
- [x] Session stopwatch in the top bar: time since Start, freezes on Stop
- [x] Practice settings are saved and validated like the others

Verified in the browser: 120 BPM, +10 every bar to 160, play 1 / mute 1, stop after 4 bars. Bars took
2.00 / 1.84 / 1.71 / 1.59 s (expected for 120 / 130 / 140 / 150 BPM), bars 2 and 4 were silent, and it
stopped at 7.26 s with the tempo back at 120.

### Accuracy meter — speaker or wired headphones ✅
Listens through the microphone while you play (sticks on a pad, a pillow, clapping) and scores each hit
against the click. Turn it on in **Practice → Accuracy meter**, then **Set up & calibrate**.

- [x] Onset detection in an **AudioWorklet** on the same AudioContext clock as the clicks, so hit and
      click times compare directly. Echo cancellation, noise suppression and auto-gain are switched off
- [x] Each hit is matched to the nearest note of the full subdivision grid (window = half the gap to the
      neighbouring notes, max ±150 ms). Hits outside any window, and second hits on a note, count as
      "extra". Count-in hits are ignored
- [x] **Two output modes**, chosen at the top of setup:
  - **Speaker (default):** while the meter is on, the click plays as a pure **Tone** of about 2.5–5.7 kHz
    (pitch per voice) with a 4 ms soft start. The detector listens only below 800 Hz (6th-order low-pass,
    its 0.7 ms delay compensated). The tone is about 60 dB down there, while stick, clap and pillow hits
    keep plenty of energy. Your chosen sound returns when the meter is off
  - **Wired headphones:** normal sounds, full-band listening
- [x] **Loopback calibration** times 10 clicks from speaker/earbud to mic, which measures output + input
      latency without your own timing mixed in, so early/late stays meaningful. With headphones you hold an
      earbud to the mic; with the speaker you just stay quiet.
  - The clicks are irregularly spaced, and the delay is searched from −250 to +750 ms (the densest 4 ms
    cluster wins), so a browser that shifts mic timing can't break it
  - Speaker mode adds a **click check**: 8 tone clicks (every voice) play while you're silent, and any that
    register as hits are reported, with advice to lower the volume
- [x] Safeguards: a measured latency above 100 ms is rejected as "Bluetooth". The app warns if a device name
      looks like Bluetooth. Uncalibrated results hide the early/late figure and only show consistency
- [x] Diagnostics panel in setup: browser, input device and state, sample rates, whether processing is really
      off, latencies, details of the last calibration
- [x] Live readout under the BPM: last hit on a ±50 ms track, plus "−9 ms early" and the running spread
- [x] Results (open automatically when you stop): consistency (SD) with a verdict, average early/late,
      % within ±10/±25 ms, hit timeline, histogram, average per beat, drift per minute, accuracy on silent
      (muted-trainer) beats vs. clicked beats, and a full hit table
- [x] Mic selector (desktop), sensitivity 1–10, live input level and hit counter in setup
- [x] Audio is analysed on the device as you play. Nothing is recorded or uploaded

**Verified** in Chromium without a real mic, by feeding audio straight into the meter (`?debug`):
- Loopback calibration heard 10/10 clicks: 0.57 ms latency, 0.00 ms spread.
- Synthetic hits planned at +15 / −5 ms were measured as +14.4 / −5.6 ms on every hit, with 0 extras.
  The constant 0.6 ms is the calibration offset.

Speaker mode, simulated with a 12 ms "room" delay and the tone clicks fed into the meter at full level:
- Calibration measured 12.4 ms with 0 spread, and the click check passed: 0 of 8 tones counted as hits.
- Hits planned at +12 / −7 ms on top of the clicks (with 8th-note sub-clicks and count-in) were measured
  as +11.9 / −7.1 ms, with 0 extras.
- This found and fixed a Web Audio pitfall. Parameters scheduled only as an event at the start time render
  their *default* value first (an oscillator at 440 Hz), which leaked a low blip into the meter. All
  oscillator, filter and gain values are now set directly as well.

**Not yet verified:** a real microphone or a real iPhone.

**Platforms.** It's one web app: the iPhone home-screen app *is* this PWA, same code. It needs HTTPS
(or localhost) for the microphone.
- **iPhone (Safari or home-screen app):** USB-C or Lightning wired earbuds. With EarPods that have an
  in-line mic, iOS records from that mic, which works fine. The audio session switches to play-and-record
  while listening. iOS can't use the mic while the screen is locked.
- **Android Chrome:** wired or USB-C headphones.
- **Mac / Windows / Linux (Chrome, Edge, Firefox, Safari):** laptop or USB mic plus wired headphones. You
  can pick the input device in setup.
- **Speakers** work in speaker mode at moderate volume. Bluetooth speakers are rejected (too much delay).

### Train tab — gamified timing curriculum ✅
A bottom tab bar switches between **Metronome**, **Train** and **Progress**. Lessons use the accuracy meter
(speaker or wired headphones), so it must be calibrated first.

**Curriculum** (`src/train/curriculum.ts`), original material: 5 stages × 6 lessons + a stage test, 35 in all.
- **1 · Pulse:** quarters at 80 / 100 / 60, 3/4, 8ths, 16-bar hold
- **2 · Subdivide:** 8ths and 16ths with only quarter-note clicks, triplets, switching 8ths ↔ triplets each bar,
  accents without rushing
- **3 · Inner clock:** gap click 3/1, 2/2, 1/3 bars; click on 2 and 4; click on 1 only; random 25% silence;
  test = 1 bar on, 7 off
- **4 · Rudiments in time:** single strokes, doubles, single paradiddle, paradiddle-diddle (sextuplets),
  displaced accents. Rudiment names follow the Percussive Arts Society's public rudiment list. Sticking is
  shown as a guide but not scored, since the mic can't tell hands apart
- **5 · Extremes:** 50 and 40 BPM, fast 16ths at 120, a tempo ramp 80→120, an off-beat click (play on the
  "and"), 3-minute endurance, and a final exam

**Scoring** (`src/train/scorer.ts`)
- Every expected note gets a judgment: Perfect ≤10 ms, Great ≤20, Good ≤35. A hit inside the note's window
  but beyond that is "Off". Unplayed notes are Misses. Combos count runs of Good or better.
- Only sounds outside every note's window count as **Extra**. These are not scored at all:
  - taps during the count-in or after the last note,
  - a quieter sound within 60 ms of a hit (stick rebound, echo, rattle),
  - a quieter second sound on a note that already has a hit.
- A clearly louder (1.5×) second sound replaces a faint first one on the same note, e.g. a click leak or grace
  note followed by the real stroke. The free-play meter uses the same rules.
- Stars: ★ at least 70% of notes within ±35 ms · ★★ spread ≤15 ms · ★★★ spread ≤8 ms and at least 90% within ±20 ms.
- One star unlocks the next lesson; a stage test needs two stars to open the next stage.

**Gamification** (`src/train/progress.ts`)
- XP and levels (150 / 450 / 900 … XP), a daily streak, and 10 badges.
- **Daily warm-up:** 3 short rounds (pulse, your weakest skill based on recent spread, a gap check), with a
  +30 XP bonus once a day.
- **Find your edge:** 4-bar rounds; +4 BPM after a 2-star round, −4 after a loose one; ends after 3 loose
  rounds. Keeps your record per pattern (quarters, 8ths, 16ths, paradiddles).
- **Progress tab:** level, streak, stars, a spread-over-time chart, spread per skill, top clean tempos, badges,
  and a reset button.
- Progress lives in localStorage on this device only.

**How a lesson runs** (`src/train/useLessonRunner.ts`)
- The lesson temporarily takes over the engine (tempo, click pattern, trainers, stop after N bars, and the
  tone click in speaker mode). Expected notes are built from the scheduled beats, so tempo ramps, gap clicks
  and off-beat placement are all exact.
- Your own metronome settings are restored afterwards, and free-play scoring is switched off while training.

**Verified** in Chromium with simulated playing through the real meter (tone click → 12 ms "room" → detector):
- "First pulse" with hits at +6 / −4 / +2 / −7 ms and one skipped note scored 31 Perfect, 1 Miss, ±5.1 ms,
  3 stars, and awarded the "First steps" badge.
- Find your edge went clean at 72, then loose at 76, 72 and 68; the run ended with a 72 BPM record.
- Your Metronome settings and sound were restored afterwards.

## Tests

`npm test` runs 138 Vitest unit tests covering:

- **Sequencer:** beat spacing, bar wrap, start offset, every subdivision, swing placement, muted beats,
  tempo changes landing on the next beat, horizon semantics, count-in, shortening the bar mid-bar,
  no drift over 100k beats
- **Swing offsets:** straight, triplet, sixteenth pairs, odd groupings, clamping
- **Accents:** cycle order, defaults for 9 meters, resize
- **Tap tempo:** averaging, 8-tap window, pause reset, outlier reset, clamp, duplicate timestamps
- **Muted-beats trainer:** play/mute cycle, whole-bar silence including subs, count-in never muted,
  random rate ≈ chosen %, whole beats muted together, seed reproducibility
- **Accelerando:** step counting (bars/seconds), hold / restart / reverse, slowing down, clamping,
  exact beat times in the sequencer, seconds counted after the count-in
- **Playback counter:** stop after N bars, after a duration, count-in excluded
- **Onset detector:** ≤1 ms attack accuracy across 128-sample blocks, peak scaling, noise rejection,
  no double-trigger on ringing hits (hysteresis), fast 16ths, sensitivity; speaker mode: tone clicks at every
  voice pitch ignored, hits on top of a click still found within 1 ms, low/full band timing agree
- **Accuracy scoring:** early/late matching, extras, dense-grid windows, flams, count-in exclusion,
  silent-beat marking, mean/SD/windows, drift per minute, silent vs. audible accuracy
- **Calibration:** stable latency, shifted timelines (−120 / +420 ms), irregular probes, Bluetooth rejection,
  too few clicks, scattered readings, stray noises
- **Lessons:** judgment windows, expected notes (count-in skipped, 16ths from quarter clicks, alternating
  8ths/triplets, off-beat shift, gap silences, tempo ramp), combos, misses, extras (count-in taps, rebounds, doubles and ghost replacement; extras before the next
  note is scheduled), stars, silent-beat accuracy
- **Progress:** 35 lessons with unique ids and sane tempos and lengths, unlock rules, best stars and spread, XP,
  streaks (including gaps and month ends), badges awarded once, levels, warm-up targeting, find-your-edge
  staircase and records, storage round-trip
- **Jitter stats:** interval stats, late counting, pause gaps
- **Settings:** sanitization, clamping, accent repair, storage round-trip, corrupt JSON, practice and meter settings
