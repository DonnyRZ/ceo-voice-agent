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

  test('memasukkan akhir fragmen yang melintasi delegasi tanpa mengambil ucapan baru setelahnya', () => {
    const transcript = createVoiceTranscript();
    transcript.append({ eventId: 'prefix', role: 'user', text: 'Cek rekap di divisi', startMs: 500, endMs: 2_600 });
    transcript.registerDelegation({ id: 'pause-turn', offsetMs: 3_000 });
    transcript.append({ eventId: 'finish', role: 'user', text: ' IT.', startMs: 2_900, endMs: 3_200 });
    transcript.append({ eventId: 'next', role: 'user', text: ' Ganti ke Finance.', startMs: 3_200, endMs: 3_400 });
    expect(transcript.takeDelegation('pause-turn', true)?.text).toBe('Cek rekap di divisi IT.');
    transcript.registerDelegation({ id: 'next-turn', offsetMs: 3_500 });
    expect(transcript.takeDelegation('next-turn', true)?.text).toBe('Ganti ke Finance.');
  });

  test('memulihkan kata terakhir tepat pada batas setelah standby dan menolak replay dari giliran sebelumnya', () => {
    const transcript = createVoiceTranscript();
    const previous = { eventId: 'previous', role: 'user', text: 'Status proyek lama?', startMs: 1_400, endMs: 5_400 } as const;
    transcript.append(previous);
    transcript.pause();
    expect(transcript.append({ ...previous, eventId: 'replayed' })).toBe(false);
    transcript.append({
      eventId: 'prefix', role: 'user', text: 'Boleh periksa status proyek pengisian kabel seratan di divisi',
      startMs: 23_600, endMs: 26_200,
    });
    transcript.registerDelegation({ id: 'standby-turn', offsetMs: 26_600 });
    transcript.append({ eventId: 'ending', role: 'user', text: ' IT', startMs: 26_600, endMs: 26_800 });
    expect(transcript.takeDelegation('standby-turn', true)).toMatchObject({
      text: 'Boleh periksa status proyek pengisian kabel seratan di divisi IT',
      userEndMs: 26_800,
      history: [{ role: 'user', text: 'Status proyek lama?' }],
    });
  });

  test('menjaga permulaan pada batas yang tak bertetangga untuk delegasinya sendiri', () => {
    const transcript = createVoiceTranscript();
    transcript.append({ eventId: 'earlier', role: 'user', text: 'Status Atlas?', startMs: 1_000, endMs: 1_800 });
    transcript.registerDelegation({ id: 'earlier-turn', offsetMs: 3_000 });
    transcript.append({ eventId: 'later', role: 'user', text: 'Tidak.', startMs: 3_000, endMs: 3_200 });
    expect(transcript.takeDelegation('earlier-turn', true)?.text).toBe('Status Atlas?');
    transcript.registerDelegation({ id: 'later-turn', offsetMs: 3_400 });
    expect(transcript.takeDelegation('later-turn', true)?.text).toBe('Tidak.');
  });

  test('memutar ulang fragmen uji nyata yang terputus pada koreksi dalam satu pertanyaan', () => {
    const transcript = createVoiceTranscript();
    const frames = [
      [' Apa', 1_000, 1_200], [' status', 1_400, 1_600], [' tugas', 1_600, 1_800],
      [' validasi', 2_200, 2_400], [' alur', 2_600, 2_800], [' login', 3_000, 3_200],
      ['? Maaf', 3_600, 3_800], [', maksud', 4_200, 4_400], [' saya', 4_600, 4_800],
      [' tugas', 5_000, 5_200], [' uji', 5_200, 5_400], [' notifikasi', 6_000, 6_200],
    ] as const;
    frames.forEach(([text, startMs, endMs], index) => {
      transcript.append({ eventId: String(index), role: 'user', text, startMs, endMs });
    });
    transcript.registerDelegation({ id: 'inline-correction', offsetMs: 6_000 });
    expect(transcript.takeDelegation('inline-correction', true)).toMatchObject({
      text: 'Apa status tugas validasi alur login? Maaf, maksud saya tugas uji notifikasi',
      userEndMs: 6_200,
    });
  });

  test.each([
    [5_400, 6_001, 6_200],
    [5_000, 6_000, 6_200],
    [5_400, 6_000, 6_400],
  ])('menahan paket terpisah dari perpanjangan satu frame di batas', (prefixEnd, startMs, endMs) => {
    const transcript = createVoiceTranscript();
    transcript.append({ eventId: 'first', role: 'user', text: 'Status Atlas?', startMs: 4_000, endMs: prefixEnd });
    transcript.registerDelegation({ id: 'first-turn', offsetMs: 6_000 });
    transcript.append({ eventId: 'next', role: 'user', text: 'Ganti ke Finance.', startMs, endMs });
    expect(transcript.takeDelegation('first-turn', true)?.text).toBe('Status Atlas?');
    transcript.registerDelegation({ id: 'second-turn', offsetMs: 6_600 });
    expect(transcript.takeDelegation('second-turn', true)?.text).toBe('Ganti ke Finance.');
  });

  test('tidak meneruskan akhiran yang saling bertabrakan ke giliran berikutnya', () => {
    const transcript = createVoiceTranscript();
    transcript.append({ eventId: 'prefix', role: 'user', text: 'Status proyek', startMs: 100, endMs: 900 });
    transcript.registerDelegation({ id: 'uncertain', offsetMs: 1_000 });
    transcript.append({ eventId: 'tail-1', role: 'user', text: ' Atlas', startMs: 980, endMs: 1_100 });
    transcript.append({ eventId: 'tail-2', role: 'user', text: ' Bumi', startMs: 1_000, endMs: 1_200 });
    expect(transcript.takeDelegation('uncertain', true)).toBeNull();
    transcript.append({ eventId: 'next', role: 'user', text: 'Cek proyek Cakra.', startMs: 1_200, endMs: 1_800 });
    transcript.registerDelegation({ id: 'clean', offsetMs: 2_000 });
    expect(transcript.takeDelegation('clean', true)?.text).toBe('Cek proyek Cakra.');
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
