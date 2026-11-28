import { useSyncExternalStore } from 'react';
import { hasInstalledApplication, isStandalone } from './evidence';

type PromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export type InstallPhase = 'unavailable' | 'ready' | 'prompting' | 'waiting' | 'installed' | 'cancelled' | 'failed' | 'unconfirmed';
type InstallState = { phase: InstallPhase; nativeAvailable: boolean };
let deferred: PromptEvent | undefined;
let state: InstallState = { phase: isStandalone() ? 'installed' : 'unavailable', nativeAvailable: false };
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const publish = (phase: InstallPhase) => {
  state = { phase, nativeAvailable: Boolean(deferred) };
  listeners.forEach((listener) => listener());
};

function markInstalled() {
  ++generation;
  clearTimeout(timer);
  deferred = undefined;
  publish('installed');
}
async function detect() {
  const turn = generation;
  if (await hasInstalledApplication() && turn === generation) {
    markInstalled();
  }
}
function waitForInstallation(turn: number, deadline: number) {
  if (turn !== generation) return;
  void hasInstalledApplication().then((installed) => {
    if (turn !== generation) return;
    if (installed) { markInstalled(); return; }
    if (Date.now() >= deadline) { publish('unconfirmed'); return; }
    timer = setTimeout(() => waitForInstallation(turn, deadline), 1500);
  });
}
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferred = event as PromptEvent;
  if (state.phase !== 'prompting' && state.phase !== 'waiting') publish('ready');
});
// Android can dispatch this before its WebAPK is ready. It only triggers a check.
window.addEventListener('appinstalled', () => { void detect(); });
window.addEventListener('pageshow', () => { void detect(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) void detect(); });
window.matchMedia('(display-mode: standalone)').addEventListener('change', () => { void detect(); });
void detect();

export function requestInstall() {
  if (!deferred) { void detect(); return; }
  const event = deferred;
  deferred = undefined;
  const turn = ++generation;
  clearTimeout(timer);
  publish('prompting');
  // Call synchronously within the click handler to retain browser user activation.
  let shown: Promise<void>;
  try { shown = event.prompt(); }
  catch { publish('failed'); return; }
  void shown.then(() => event.userChoice).then(({ outcome }) => {
    if (turn !== generation) return;
    if (outcome === 'dismissed') { publish('cancelled'); return; }
    publish('waiting');
    waitForInstallation(turn, Date.now() + 45_000);
  }).catch(() => { if (turn === generation) publish('failed'); });
}
export function retryInstallCheck() {
  const turn = ++generation;
  clearTimeout(timer);
  publish('waiting');
  waitForInstallation(turn, Date.now() + 15_000);
}
export function leaveInstallWait() {
  ++generation;
  clearTimeout(timer);
  if (state.phase !== 'installed') publish(deferred ? 'ready' : 'unavailable');
  void detect();
}
export const getInstallationState = () => state;
export function useInstallation() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, getInstallationState);
}
