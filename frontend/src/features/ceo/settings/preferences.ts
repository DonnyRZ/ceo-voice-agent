import { useCallback, useSyncExternalStore } from 'react';
import { useCurrentSessionUser } from '../../../shared/session';

const changedEvent = 'ruangkerja:ceo-preferences-changed';
const storageKey = (userId: string) => `ruangkerja:ceo:preferences:${userId}`;

export function getVoicePlaybackPreference(userId: string): boolean {
  try {
    const stored = window.localStorage.getItem(storageKey(userId));
    if (!stored) return true;
    const value: unknown = JSON.parse(stored);
    if (typeof value !== 'object' || value === null) return true;
    const preference = value as { version?: unknown; playVoiceAnswers?: unknown };
    return preference.version === 1 && typeof preference.playVoiceAnswers === 'boolean'
      ? preference.playVoiceAnswers : true;
  } catch {
    return true;
  }
}

function subscribe(listener: () => void) {
  window.addEventListener('storage', listener);
  window.addEventListener(changedEvent, listener);
  return () => {
    window.removeEventListener('storage', listener);
    window.removeEventListener(changedEvent, listener);
  };
}

/** Playback affects this account on this browser, never server-side interpretation. */
export function useCeoPreferences() {
  const { id } = useCurrentSessionUser();
  const getSnapshot = useCallback(() => getVoicePlaybackPreference(id), [id]);
  const playVoiceAnswers = useSyncExternalStore(subscribe, getSnapshot, () => true);
  const setPlayVoiceAnswers = useCallback((enabled: boolean) => {
    window.localStorage.setItem(storageKey(id), JSON.stringify({ version: 1, playVoiceAnswers: enabled }));
    window.dispatchEvent(new Event(changedEvent));
  }, [id]);
  return { playVoiceAnswers, setPlayVoiceAnswers };
}
