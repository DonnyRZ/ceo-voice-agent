import type { Page } from "@playwright/test";

export const syntheticOffer = "v=0\r\no=voice-test 0 0 IN IP4 127.0.0.1\r\ns=Ruang Kerja test offer\r\n";
export const syntheticAnswer = "v=0\r\no=voice-test 1 1 IN IP4 127.0.0.1\r\ns=Ruang Kerja test answer\r\n";

type TransportStatus = {
  microphoneRequests: number;
  tracks: { enabled: boolean; readyState: string }[];
  peers: { state: string; answer: string | undefined }[];
  streams: { url: string; closed: boolean }[];
  remoteTrackEnabled: boolean[];
  audiblePlays: number;
};

interface TransportControl {
  allowMicrophone(): void;
  disconnect(peer?: number): void;
  emit(event: Record<string, unknown>, stream?: number): void;
  localSpeech(): Promise<void>;
  status(): TransportStatus;
}

declare global {
  interface Window { rkVoiceTest: TransportControl }
}

export async function installVoiceTransport(page: Page, denyMicrophone = false, nativePlayback = false) {
  await page.addInitScript(({ offer, denied, nativePlayback }) => {
    let permissionDenied = denied;
    let microphoneRequests = 0;
    let audiblePlays = 0;
    const tracks: MediaStreamTrack[] = [];
    const peers: SyntheticPeer[] = [];
    const streams: SyntheticEventSource[] = [];
    const audioContexts: AudioContext[] = [];
    const microphones: { context: AudioContext; destination: MediaStreamAudioDestinationNode }[] = [];

    function audioStream() {
      const context = new AudioContext();
      audioContexts.push(context);
      return context.createMediaStreamDestination().stream;
    }

    class SyntheticDataChannel extends EventTarget {
      readyState = "open";
      send() { /* The control stream is injected independently of the media peer. */ }
      close() { this.readyState = "closed"; }
    }

    class SyntheticPeer extends EventTarget {
      iceGatheringState = "complete";
      connectionState = "new";
      iceConnectionState = "new";
      localDescription?: RTCSessionDescriptionInit;
      remoteDescription?: RTCSessionDescriptionInit;
      onconnectionstatechange?: (event: Event) => void;
      oniceconnectionstatechange?: (event: Event) => void;
      ontrack?: (event: Event) => void;
      private senders: { track: MediaStreamTrack }[] = [];
      private remoteAudio?: MediaStream;

      constructor() { super(); peers.push(this); }
      async createOffer() { return { type: "offer", sdp: offer }; }
      async setLocalDescription(description: RTCSessionDescriptionInit) { this.localDescription = description; }
      createDataChannel() { return new SyntheticDataChannel(); }
      addTrack(track: MediaStreamTrack) {
        const sender = { track };
        this.senders.push(sender);
        return sender;
      }
      getSenders() { return this.senders; }

      changeState(state: string) {
        this.connectionState = state;
        this.iceConnectionState = state;
        const connection = new Event("connectionstatechange");
        this.dispatchEvent(connection);
        this.onconnectionstatechange?.(connection);
        const ice = new Event("iceconnectionstatechange");
        this.dispatchEvent(ice);
        this.oniceconnectionstatechange?.(ice);
      }

      async setRemoteDescription(description: RTCSessionDescriptionInit) {
        this.remoteDescription = description;
        this.remoteAudio = audioStream();
        const stream = this.remoteAudio;
        const trackEvent = new Event("track");
        Object.defineProperties(trackEvent, {
          streams: { value: [stream] }, track: { value: stream.getAudioTracks()[0] },
        });
        this.dispatchEvent(trackEvent);
        this.ontrack?.(trackEvent);
        this.changeState("connected");
      }

      close() {
        this.connectionState = "closed";
        this.iceConnectionState = "closed";
        this.remoteAudio?.getTracks().forEach((track) => track.stop());
      }

      remoteTrackEnabled() { return this.remoteAudio?.getAudioTracks()[0]?.enabled; }
    }

    class SyntheticEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readonly url: string;
      readyState = SyntheticEventSource.OPEN;
      onmessage?: (event: MessageEvent) => void;
      onopen?: (event: Event) => void;

      constructor(url: string) {
        super();
        this.url = new URL(url, window.location.href).href;
        streams.push(this);
        queueMicrotask(() => {
          if (this.readyState !== SyntheticEventSource.OPEN) return;
          const event = new Event("open");
          this.dispatchEvent(event);
          this.onopen?.(event);
        });
      }

      emit(payload: Record<string, unknown>) {
        // A queued callback may arrive after close; the app still has to reject it.
        const message = new MessageEvent("message", { data: JSON.stringify(payload) });
        this.dispatchEvent(message);
        this.onmessage?.(message);
      }

      close() { this.readyState = SyntheticEventSource.CLOSED; }
    }

    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => {
        microphoneRequests++;
        if (permissionDenied) throw new DOMException("Microphone denied by fixture", "NotAllowedError");
        const context = new AudioContext();
        audioContexts.push(context);
        const destination = context.createMediaStreamDestination();
        microphones.push({ context, destination });
        const { stream } = destination;
        tracks.push(...stream.getAudioTracks());
        return stream;
      },
    });
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: SyntheticPeer });
    Object.defineProperty(window, "EventSource", { configurable: true, value: SyntheticEventSource });
    if (!nativePlayback) Object.defineProperty(HTMLMediaElement.prototype, "play", {
      configurable: true,
      value: async function (this: HTMLMediaElement) {
        if (!this.muted) {
          audiblePlays++;
          queueMicrotask(() => this.dispatchEvent(new Event("playing")));
        }
      },
    });

    window.rkVoiceTest = {
      allowMicrophone: () => { permissionDenied = false; },
      disconnect: (peer = peers.length - 1) => peers[peer]?.changeState("disconnected"),
      emit: (event, stream = streams.length - 1) => streams[stream]?.emit(event),
      async localSpeech() {
        const microphone = microphones.at(-1);
        if (!microphone) throw new Error("No synthetic microphone");
        const { context, destination } = microphone;
        await context.resume();
        const tone = context.createOscillator();
        const volume = context.createGain();
        volume.gain.value = 0.2;
        tone.connect(volume).connect(destination);
        tone.start();
        tone.stop(context.currentTime + 0.3);
      },
      status: () => ({
        microphoneRequests, audiblePlays,
        tracks: tracks.map(({ enabled, readyState }) => ({ enabled, readyState })),
        peers: peers.map(({ connectionState, remoteDescription }) => ({ state: connectionState, answer: remoteDescription?.sdp })),
        streams: streams.map(({ url, readyState }) => ({ url, closed: readyState === SyntheticEventSource.CLOSED })),
        remoteTrackEnabled: peers.flatMap((peer) => peer.remoteTrackEnabled() ?? []),
      }),
    };
  }, { offer: syntheticOffer, denied: denyMicrophone, nativePlayback });
}

export function readTransport(page: Page) {
  return page.evaluate(() => window.rkVoiceTest.status());
}

export function emitVoice(page: Page, event: Record<string, unknown>, stream?: number) {
  return page.evaluate(({ event, stream }) => window.rkVoiceTest.emit(event, stream), { event, stream });
}
