import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { newAttempt, type VoiceAttempt } from './voice-attempt';
import { connectVoiceAttempt } from './voice-connect';
import type { VoiceStage } from './voice-protocol';

const transport = vi.hoisted(() => ({
  closeVoiceSession: vi.fn(), gatherOffer: vi.fn(), openVoiceEvents: vi.fn(),
  startVoiceSession: vi.fn(), stopStream: vi.fn(),
}));
vi.mock('./voice-transport', () => transport);
vi.mock('./voice-activity', () => ({
  monitorVoiceActivity: () => ({ ready: Promise.resolve(), attach: vi.fn(), close: vi.fn() }),
}));

function pending<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

class Peer {
  connectionState = 'new';
  onconnectionstatechange?: () => void;
  ontrack?: ({ track }: { track: { kind: string; enabled: boolean } }) => void;
  createDataChannel = vi.fn();
  addTrack = vi.fn();
  setRemoteDescription = vi.fn(async () => undefined);
}

describe('voice media connection lifecycle', () => {
  const track = { enabled: true, addEventListener: vi.fn() };
  const stream = { getAudioTracks: () => [track] } as unknown as MediaStream;
  let microphone: ReturnType<typeof vi.fn>;
  let attempt: VoiceAttempt;
  let active: boolean;
  let handlers: {
    current(): boolean; close: Mock<(stage: VoiceStage, error?: string) => void>; speech: Mock<() => void>;
    sync: Mock<() => void>; event: Mock<(data: unknown) => void>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout, clearTimeout });
    vi.stubGlobal('RTCPeerConnection', Peer);
    microphone = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: microphone } });
    transport.gatherOffer.mockResolvedValue('offer');
    transport.startVoiceSession.mockResolvedValue({ id: 'session-current', sdp: 'answer' });
    transport.openVoiceEvents.mockReturnValue({ onmessage: null, onerror: null });
    active = true;
    attempt = newAttempt(null);
    handlers = { current: () => active, close: vi.fn(), speech: vi.fn(), sync: vi.fn(), event: vi.fn() };
  });

  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('stops microphone acquired after cancellation without opening a provider session', async () => {
    const request = pending<MediaStream>();
    microphone.mockReturnValue(request.promise);
    const connection = connectVoiceAttempt(attempt, handlers);
    active = false;
    request.resolve(stream);
    await connection;
    expect(transport.stopStream).toHaveBeenCalledWith(stream);
    expect(transport.startVoiceSession).not.toHaveBeenCalled();
    expect(attempt.peer).toBeNull();
  });

  it('closes a server session completed after cancellation and never binds its audio', async () => {
    const request = pending<{ id: string; sdp: string }>();
    transport.startVoiceSession.mockReturnValue(request.promise);
    const connection = connectVoiceAttempt(attempt, handlers);
    await vi.waitFor(() => expect(transport.startVoiceSession).toHaveBeenCalledOnce());
    active = false;
    request.resolve({ id: 'orphaned-session', sdp: 'stale-answer' });
    await connection;
    expect(transport.closeVoiceSession).toHaveBeenCalledWith('orphaned-session');
    expect(transport.openVoiceEvents).not.toHaveBeenCalled();
    expect(attempt.peer?.setRemoteDescription).not.toHaveBeenCalled();
  });

  it('keeps unverified remote media disabled and ignores a disconnected old peer', async () => {
    await connectVoiceAttempt(attempt, handlers);
    const peer = attempt.peer as unknown as Peer;
    const remoteTrack = { kind: 'audio', enabled: true };
    peer.ontrack?.({ track: remoteTrack });
    expect(remoteTrack.enabled).toBe(false);
    expect(track.enabled).toBe(false);
    active = false;
    peer.connectionState = 'disconnected';
    peer.onconnectionstatechange?.();
    expect(handlers.close).not.toHaveBeenCalled();
  });
});
