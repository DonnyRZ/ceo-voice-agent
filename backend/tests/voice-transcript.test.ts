import { describe, expect, test } from 'vitest';
import { createVoiceTranscript } from '../modules/ai/voice/transcript.js';

describe('Transkrip delegasi suara CEO', () => {
  test('merangkai penggalan yang terlambat dan mengabaikan ucapan setelah waktu delegasi', () => {
    const transcript = createVoiceTranscript();
    transcript.append({ eventId: 'input-2', role: 'user', text: 'Atlas?', startMs: 1_100, endMs: 1_390 });
    expect(transcript.registerDelegation({ id: 'delegation-1', offsetMs: 1_450 })).toBe(true);
    transcript.append({ eventId: 'input-1', role: 'user', text: 'Apa status proyek ', startMs: 200, endMs: 1_100 });
    transcript.append({ eventId: 'input-3', role: 'user', text: ' Dan siapa PIC-nya?', startMs: 1_420, endMs: 2_800 });

    expect(transcript.takeDelegation('delegation-1')).toEqual({
      id: 'delegation-1', offsetMs: 1_450, text: 'Apa status proyek Atlas?', history: [], userEndMs: 1_390,
    });
    expect(transcript.takeDelegation('delegation-1')).toBeNull();
    expect(transcript.registerDelegation({ id: 'delegation-1', offsetMs: 2_700 })).toBe(false);
  });

  test('mengirim pertanyaan lanjutan beserta konteks yang mendahuluinya', () => {
    const transcript = createVoiceTranscript();
    transcript.append({ eventId: 'input-1', role: 'user', text: 'Berapa tugas Atlas?', startMs: 200, endMs: 1_000 });
    transcript.registerDelegation({ id: 'delegation-1', offsetMs: 1_100 });
    transcript.takeDelegation('delegation-1');

    transcript.append({ eventId: 'reply-1', role: 'assistant', text: 'Untuk tanggal berapa?', startMs: 1_300, endMs: 2_200 });
    transcript.append({ eventId: 'input-2', role: 'user', text: 'Hari ini.', startMs: 2_340, endMs: 2_700 });
    transcript.append({ eventId: 'reply-2', role: 'assistant', text: 'Saya periksa.', startMs: 2_500, endMs: 3_000 });
    transcript.registerDelegation({ id: 'delegation-2', offsetMs: 3_050 });

    expect(transcript.takeDelegation('delegation-2')).toMatchObject({
      text: 'Hari ini.',
      history: [
        { role: 'user', text: 'Berapa tugas Atlas?' },
        { role: 'assistant', text: 'Untuk tanggal berapa?' },
      ],
    });
  });

  test('mencegah tayangan ulang dan delegasi tanpa ucapan pengguna yang baru', () => {
    const transcript = createVoiceTranscript();
    const input = { eventId: 'input-1', role: 'user', text: 'Status Atlas?', startMs: 200, endMs: 1_000 } as const;
    expect(transcript.append(input)).toBe(true);
    expect(transcript.append(input)).toBe(false);
    expect(transcript.registerDelegation({ id: 'delegation-1', offsetMs: 1_100 })).toBe(true);
    expect(transcript.registerDelegation({ id: 'duplicate', offsetMs: 1_100 })).toBe(true);
    expect(transcript.takeDelegation('delegation-1')?.text).toBe('Status Atlas?');
    expect(transcript.takeDelegation('duplicate')).toBeNull();
    expect(transcript.registerDelegation({ id: 'late', offsetMs: 1_080 })).toBe(false);

    transcript.append({ ...input, eventId: 'late-fragment', text: 'Atlas?', startMs: 900, endMs: 1_150 });
    transcript.append({ eventId: 'reply-1', role: 'assistant', text: 'Baik.', startMs: 1_200, endMs: 1_400 });
    transcript.registerDelegation({ id: 'no-input', offsetMs: 1_800 });
    expect(transcript.takeDelegation('no-input')).toBeNull();
  });

  test('membatasi jeda dan panjang riwayat sebelum pertanyaan terbaru', () => {
    const transcript = createVoiceTranscript();
    for (let index = 0; index < 16; index += 1) {
      const startMs = index * 200;
      transcript.append({
        eventId: `history-${index}`, role: index % 2 ? 'assistant' : 'user',
        text: `Pesan ${index}.`, startMs, endMs: startMs + 100,
      });
    }
    transcript.append({ eventId: 'current', role: 'user', text: 'Apa statusnya?', startMs: 5_000, endMs: 5_400 });
    transcript.registerDelegation({ id: 'current-delegation', offsetMs: 5_600 });
    const turn = transcript.takeDelegation('current-delegation');

    expect(turn?.text).toBe('Apa statusnya?');
    expect(turn?.history).toHaveLength(12);
    expect(turn?.history.at(0)?.text).toBe('Pesan 4.');
    expect(turn?.history.at(-1)?.text).toBe('Pesan 15.');

    transcript.append({ eventId: 'old', role: 'user', text: 'Pertanyaan lama.', startMs: 5_700, endMs: 5_900 });
    transcript.registerDelegation({ id: 'stale-delegation', offsetMs: 14_050 });
    expect(transcript.takeDelegation('stale-delegation')).toBeNull();
  });
});
