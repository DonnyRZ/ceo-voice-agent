import { afterEach, describe, expect, test, vi } from 'vitest';
import { createLiveAdapter, LiveCreateHttpError } from '../modules/ai/voice/live-adapter.js';

interface TestSocket {
  url: string;
  options: { headers: { Authorization: string } };
  sent: unknown[];
  readyState: number;
  open(): void;
  message(event: object): void;
  terminate(): void;
}

const { sockets } = vi.hoisted(() => ({ sockets: [] as TestSocket[] }));

vi.mock('ws', async () => {
  const { EventEmitter } = await import('node:events');

  class Socket extends EventEmitter implements TestSocket {
    static OPEN = 1;
    readyState = 0;
    sent: unknown[] = [];

    constructor(readonly url: string, readonly options: TestSocket['options']) {
      super();
      sockets.push(this);
    }

    open() { this.readyState = 1; this.emit('open'); }
    message(event: object) { this.emit('message', Buffer.from(JSON.stringify(event)), false); }
    send(body: string) { this.sent.push(JSON.parse(body)); }
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
  }

  return { default: Socket };
});

const adapter = () => createLiveAdapter({ apiKey: 'fake-test-key', model: 'gpt-live-1.1' });
const sessionId = 'live_example';

afterEach(() => {
  for (const socket of sockets) socket.terminate();
  sockets.length = 0;
  vi.restoreAllMocks();
});

describe('Adapter OpenAI Live', () => {
  test('membuat sesi WebRTC dengan delegasi dan izin frontend dibatasi', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      session: { id: sessionId }, transport: { type: 'webrtc', sdp: 'answer' },
    }));
    await expect(adapter().createSession('offer', new AbortController().signal)).resolves.toEqual({ id: sessionId, sdp: 'answer' });

    const [url, options] = request.mock.calls[0];
    expect(String(url)).toBe('https://api.openai.com/v1/live/sessions');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(String(options?.body))).toMatchObject({
      session: {
        model: 'gpt-live-1.1',
        wake_policy: { type: 'speech' },
        idle_timeout_s: 10,
        store: false,
        delegation: { type: 'client', acknowledgement_delay_ms: 800 },
        client: { data_channel: { allowed_client_events: [], allowed_server_events: [] } },
      },
      transport: { type: 'webrtc', sdp: 'offer' },
    });
  });

  test('membedakan status HTTP dan tidak mengulang permintaan pembuatan saat penyedia gagal', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ error: 'overloaded' }, { status: 503 }));

    await expect(adapter().createSession('offer', new AbortController().signal)).rejects.toBeInstanceOf(LiveCreateHttpError);
    expect(request).toHaveBeenCalledTimes(1);
  });

  test('meneruskan acara sideband dan menunggu penggunaan akhir sebelum menutup soket', async () => {
    const provider = adapter();
    const handlers = { onEvent: vi.fn(), onDisconnect: vi.fn() };
    const pending = provider.attach(sessionId, handlers, new AbortController().signal);
    const socket = sockets[0];
    expect(socket.url).toBe(`wss://api.openai.com/v1/live/sessions/${sessionId}/attach`);
    expect(socket.options.headers.Authorization).toBe('Bearer fake-test-key');
    socket.open();
    socket.message({ type: 'session.resumed' });
    socket.message({ type: 'session.input_audio.append', audio: 'AAAA' });
    const sideband = await pending;
    sideband.silenceAcknowledgment?.('delegation-1');
    sideband.sendCommentary('event-1', 'delegation-1', 'Atlas memiliki 2 tugas.');
    const stopping = provider.closeSession(sessionId, sideband);

    expect(socket.sent).toEqual([
      { type: 'session.thinking.append', event_id: expect.any(String), delegation_id: 'delegation-1', content: expect.stringContaining('Belum ada hasil') },
      { type: 'session.commentary.append', event_id: 'event-1', delegation_id: 'delegation-1', content: 'Atlas memiliki 2 tugas.' },
      { type: 'session.close' },
    ]);
    socket.message({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 13 } });
    await stopping;
    expect(handlers.onEvent.mock.calls).toEqual([[{ type: 'active' }], [{ type: 'closed', seconds: 13, reason: 'ended' }]]);
    expect(handlers.onDisconnect).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(3);
    expect(sockets).toHaveLength(1);
  });

  test('menutup sesi lewat satu koneksi pemulihan jika sideband terputus', async () => {
    const provider = adapter();
    const handlers = { onEvent: vi.fn(), onDisconnect: vi.fn() };
    const startup = new AbortController();
    const pending = provider.attach(sessionId, handlers, startup.signal);
    sockets[0].open();
    const sideband = await pending;
    startup.abort();
    expect(sockets[0].readyState).toBe(1);
    sockets[0].terminate();
    expect(handlers.onDisconnect).toHaveBeenCalledOnce();

    const onFinal = vi.fn();
    const stopping = provider.closeSession(sessionId, sideband, onFinal);
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    const cleanup = sockets[1];
    cleanup.open();
    cleanup.message({ type: 'session.resumed' });
    await vi.waitFor(() => expect(cleanup.sent).toEqual([{ type: 'session.close' }]));
    cleanup.message({ type: 'session.closed', reason: 'close_requested', usage: { seconds: 17 } });
    await stopping;
    expect(onFinal.mock.calls).toEqual([[{ type: 'closed', seconds: 17, reason: 'ended' }]]);
    expect(cleanup.readyState).toBe(3);
  });

  test('membatalkan handshake dan menutup koneksi saat penyedia menutup sesi', async () => {
    const provider = adapter();
    const handlers = { onEvent: vi.fn(), onDisconnect: vi.fn() };
    const controller = new AbortController();
    const cancelled = provider.attach(sessionId, handlers, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
    expect(sockets[0].readyState).toBe(3);

    const pending = provider.attach(sessionId, handlers, new AbortController().signal);
    sockets[1].open();
    const sideband = await pending;
    sockets[1].message({ type: 'session.closed', usage: { seconds: 11 } });
    expect(sockets[1].readyState).toBe(3);
    await expect(sideband.finish()).resolves.toBe(true);
    expect(handlers.onDisconnect).not.toHaveBeenCalled();
  });
});
