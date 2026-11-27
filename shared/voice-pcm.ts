export const voicePcmSampleRate = 24_000;
export const voicePcmBytesPerSample = 2;
export const voicePcmBytesPerMs = voicePcmSampleRate * voicePcmBytesPerSample / 1_000;
export const maximumVoiceClipMs = 12_000;
export const maximumVoiceClipBytes = maximumVoiceClipMs * voicePcmBytesPerMs;
export const voiceWavHeaderBytes = 44;
export const maximumVoiceWavBytes = voiceWavHeaderBytes + maximumVoiceClipBytes;
