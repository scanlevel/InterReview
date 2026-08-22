// Browser-side recording, WAV conversion, and simple VAD measurements.

import type { AudioTimeline, SpeechMetrics } from "./types";

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const TARGET_SAMPLE_RATE = 16000;
const VAD_FRAME_MS = 20;
const VAD_RMS_THRESHOLD = 0.015;
export const LONG_PAUSE_SEC = 2;
const MAX_AUDIO_TIMELINE_BINS = 120;

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface AnswerRecorder {
  start: () => void;
  stop: () => Promise<Blob>;
  isRecording: () => boolean;
}

/** Create a recorder over the audio tracks of a media stream. */
export function createRecorder(stream: MediaStream): AnswerRecorder {
  const audioStream = new MediaStream(stream.getAudioTracks());
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(
    audioStream,
    mimeType ? { mimeType } : undefined,
  );
  let chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  return {
    start() {
      chunks = [];
      recorder.start();
    },
    stop() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () =>
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        recorder.stop();
      });
    },
    isRecording() {
      return recorder.state === "recording";
    },
  };
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function countTranscriptEojeol(transcript: string): number {
  return transcript.trim() ? transcript.trim().split(/\s+/u).length : 0;
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction));
  return sorted[index];
}

function buildAudioTimeline(
  frameRms: number[],
  speechFrames: boolean[],
  longPauseFrames: boolean[],
): AudioTimeline | null {
  if (!frameRms.length) return null;
  const binCount = Math.min(MAX_AUDIO_TIMELINE_BINS, frameRms.length);
  const scale = Math.max(percentile(frameRms, 0.95), VAD_RMS_THRESHOLD);
  const timeline: AudioTimeline = { energy: [], speech: [], long_pause: [] };

  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor((bin * frameRms.length) / binCount);
    const end = Math.max(
      start + 1,
      Math.floor(((bin + 1) * frameRms.length) / binCount),
    );
    let energy = 0;
    let speechCount = 0;
    let hasLongPause = false;
    for (let index = start; index < end; index += 1) {
      energy += frameRms[index];
      if (speechFrames[index]) speechCount += 1;
      if (longPauseFrames[index]) hasLongPause = true;
    }
    const frameCount = end - start;
    timeline.energy.push(round(Math.min(1, (energy / frameCount) / scale), 3));
    timeline.speech.push(speechCount / frameCount >= 0.5);
    timeline.long_pause.push(hasLongPause);
  }
  return timeline;
}

/** Measure speech/silence runs from mono PCM samples without storing raw media. */
export function calculateSpeechMetrics(
  samples: Float32Array,
  sampleRate: number,
  transcript = "",
): SpeechMetrics {
  if (!samples.length || sampleRate <= 0) {
    return {
      total_duration_sec: 0,
      speech_duration_sec: 0,
      speech_rate_eojeol_per_min: null,
      silence_duration_sec: 0,
      silence_ratio: 0,
      long_pause_count: 0,
      max_pause_sec: 0,
      long_pause_threshold_sec: LONG_PAUSE_SEC,
      audio_timeline: null,
    };
  }

  const totalDuration = samples.length / sampleRate;
  const frameSamples = Math.max(1, Math.round((sampleRate * VAD_FRAME_MS) / 1000));
  const frameRms: number[] = [];
  const speechFrames: boolean[] = [];
  const longPauseFrames: boolean[] = [];
  let speechDuration = 0;
  let silentRun = 0;
  let silentStartFrame: number | null = null;
  let longPauseCount = 0;
  let maxPause = 0;

  const closeSilence = (endExclusive = longPauseFrames.length) => {
    if (silentRun <= 0) return;
    maxPause = Math.max(maxPause, silentRun);
    if (silentRun >= LONG_PAUSE_SEC) {
      longPauseCount += 1;
      if (silentStartFrame !== null) {
        for (let index = silentStartFrame; index < endExclusive; index += 1) {
          longPauseFrames[index] = true;
        }
      }
    }
    silentRun = 0;
    silentStartFrame = null;
  };

  for (let start = 0; start < samples.length; start += frameSamples) {
    const end = Math.min(samples.length, start + frameSamples);
    let energy = 0;
    for (let index = start; index < end; index += 1) {
      energy += samples[index] * samples[index];
    }
    const frameDuration = (end - start) / sampleRate;
    const rms = Math.sqrt(energy / Math.max(1, end - start));
    const isSpeech = rms >= VAD_RMS_THRESHOLD;
    frameRms.push(rms);
    speechFrames.push(isSpeech);
    longPauseFrames.push(false);
    if (isSpeech) {
      speechDuration += frameDuration;
      closeSilence(longPauseFrames.length - 1);
    } else {
      if (silentStartFrame === null) silentStartFrame = frameRms.length - 1;
      silentRun += frameDuration;
    }
  }
  closeSilence();

  const silenceDuration = Math.max(0, totalDuration - speechDuration);
  const rate = speechDuration > 0
    ? (countTranscriptEojeol(transcript) / speechDuration) * 60
    : null;
  return {
    total_duration_sec: round(totalDuration),
    speech_duration_sec: round(speechDuration),
    speech_rate_eojeol_per_min: rate === null ? null : round(rate),
    silence_duration_sec: round(silenceDuration),
    silence_ratio: round(silenceDuration / totalDuration, 3),
    long_pause_count: longPauseCount,
    max_pause_sec: round(maxPause),
    long_pause_threshold_sec: LONG_PAUSE_SEC,
    audio_timeline: buildAudioTimeline(frameRms, speechFrames, longPauseFrames),
  };
}

export function addTranscriptRate(
  metrics: SpeechMetrics,
  transcript: string,
): SpeechMetrics {
  const rate = metrics.speech_duration_sec > 0
    ? (countTranscriptEojeol(transcript) / metrics.speech_duration_sec) * 60
    : null;
  return {
    ...metrics,
    speech_rate_eojeol_per_min: rate === null ? null : round(rate),
  };
}

async function decodeAndResample(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeContext = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeContext.decodeAudioData(arrayBuffer);
  } finally {
    await decodeContext.close();
  }

  const frameCount = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  if (frameCount <= 0) return new Float32Array(0);

  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Decode a recorded blob and re-encode it as a 16 kHz mono 16-bit WAV. */
export async function blobToWav16k(blob: Blob): Promise<Blob> {
  return encodeWav(await decodeAndResample(blob));
}

export async function blobToWav16kWithMetrics(
  blob: Blob,
  transcript = "",
): Promise<{ wav: Blob; metrics: SpeechMetrics }> {
  const samples = await decodeAndResample(blob);
  return {
    wav: encodeWav(samples),
    metrics: calculateSpeechMetrics(samples, TARGET_SAMPLE_RATE, transcript),
  };
}

function encodeWav(samples: Float32Array): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: "audio/wav" });
}