/// <reference lib="webworker" />
/**
 * Wake-up timer for the lookahead scheduler. It only says "check now" every
 * ~25 ms; beat times are never derived from it (they come from
 * AudioContext.currentTime). Running in a worker keeps it ticking while the
 * main thread is busy and makes background throttling milder.
 */
let id: ReturnType<typeof setInterval> | undefined;

self.onmessage = (e: MessageEvent<{ cmd: 'start'; interval: number } | { cmd: 'stop' }>) => {
  if (id !== undefined) clearInterval(id);
  id = undefined;
  if (e.data.cmd === 'start') id = setInterval(() => self.postMessage('tick'), e.data.interval);
};
