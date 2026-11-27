import {
  maximumVoiceClipBytes, voicePcmBytesPerSample, voicePcmSampleRate, voiceWavHeaderBytes,
} from '../../../../shared/voice-pcm.js';

export function verifiedVoiceWav(pcm: Buffer) {
  if (!pcm.length || pcm.length > maximumVoiceClipBytes || pcm.length % voicePcmBytesPerSample !== 0) return;
  const header = Buffer.alloc(voiceWavHeaderBytes);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(voicePcmSampleRate, 24);
  header.writeUInt32LE(voicePcmSampleRate * voicePcmBytesPerSample, 28);
  header.writeUInt16LE(voicePcmBytesPerSample, 32);
  header.writeUInt16LE(voicePcmBytesPerSample * 8, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
