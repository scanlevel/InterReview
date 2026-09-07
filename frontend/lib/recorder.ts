// Browser-side recording, WAV conversion, and simple VAD measurements.

import type {
  AudioTimeline,
  SpeechClassification,
  SpeechClassificationKind,
  SpeechMetrics,
  WordTimestamp,
} from "./types";
import type { MicVAD, NonRealTimeVAD } from "@ricky0123/vad-web";

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

const TARGET_SAMPLE_RATE = 16000;
const VAD_FRAME_MS = 20;
export const VAD_RMS_THRESHOLD = 0.015;
export const LONG_PAUSE_SEC = 2;
export const SILERO_POSITIVE_SPEECH_THRESHOLD = 0.6;
export const SILERO_NEGATIVE_SPEECH_THRESHOLD = 0.35;
export const SILERO_MIN_SPEECH_MS = 250;
export const SILERO_SILENCE_REDEMPTION_MS = 4000;
const SILERO_PRE_SPEECH_PAD_MS = 250;
const SILERO_ASSET_PATH = "/vad/";
// ponytail: one fixed initial tolerance; tune with labeled Korean audio before
// making the alignment boundary stricter or more permissive.
const ALIGNMENT_BOUNDARY_TOLERANCE_SEC = 0.05;
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

export function canTranscribeRecording(
  questionId: string | null,
  isRecording: boolean,
  requestInFlight: boolean,
): questionId is string {
  return questionId !== null && isRecording && !requestInFlight;
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

function balanceClassificationDurations(
  totalDuration: number,
  durations: Record<SpeechClassificationKind, number>,
): Record<SpeechClassificationKind, number> {
  const keys: SpeechClassificationKind[] = [
    "transcribed_speech",
    "untranscribed_speech",
    "vad_silence",
    "pending",
  ];
  const balanced = Object.fromEntries(
    keys.map((key) => [key, round(durations[key])]),
  ) as Record<SpeechClassificationKind, number>;
  const target = round(totalDuration);
  const difference = round(
    target - keys.reduce((sum, key) => sum + balanced[key], 0),
  );
  if (difference > 0) {
    balanced.pending = round(balanced.pending + difference);
  } else if (difference < 0) {
    let remaining = -difference;
    for (const key of [...keys].sort((left, right) => balanced[right] - balanced[left])) {
      const reduction = Math.min(balanced[key], remaining);
      balanced[key] = round(balanced[key] - reduction);
      remaining = round(remaining - reduction);
      if (remaining === 0) break;
    }
  }
  return balanced;
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
  classificationFrames?: SpeechClassificationKind[],
): AudioTimeline | null {
  if (!frameRms.length) return null;
  const binCount = Math.min(MAX_AUDIO_TIMELINE_BINS, frameRms.length);
  const scale = Math.max(percentile(frameRms, 0.95), VAD_RMS_THRESHOLD);
  const timeline: AudioTimeline = {
    energy: [],
    speech: [],
    long_pause: [],
    classification: classificationFrames ? [] : null,
  };

  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor((bin * frameRms.length) / binCount);
    const end = Math.max(
      start + 1,
      Math.floor(((bin + 1) * frameRms.length) / binCount),
    );
    let energy = 0;
    let speechCount = 0;
    let hasLongPause = false;
    const classificationCounts = new Map<SpeechClassificationKind, number>();
    for (let index = start; index < end; index += 1) {
      energy += frameRms[index];
      if (speechFrames[index]) speechCount += 1;
      if (longPauseFrames[index]) hasLongPause = true;
      const kind = classificationFrames?.[index];
      if (kind) classificationCounts.set(kind, (classificationCounts.get(kind) ?? 0) + 1);
    }
    const frameCount = end - start;
    timeline.energy.push(round(Math.min(1, (energy / frameCount) / scale), 3));
    timeline.speech.push(speechCount / frameCount >= 0.5);
    timeline.long_pause.push(hasLongPause);
    if (classificationFrames) {
      const kind = [...classificationCounts.entries()].sort(
        (left, right) => right[1] - left[1],
      )[0]?.[0];
      timeline.classification?.push(kind ?? "vad_silence");
    }
  }
  return timeline;
}

export interface SpeechVadAnalysis {
  frameRms: number[];
  speechFrames: boolean[];
  longPauseFrames: boolean[];
  frameDurations: number[];
  totalDurationSec: number;
}

// ponytail: keep the historical metrics function stable; this second linear scan
// exposes only transient VAD frames needed for alignment and is cheaper than a
// larger shared-state refactor until the audio path is profiled.
function analyzeVad(samples: Float32Array, sampleRate: number): SpeechVadAnalysis {
  if (!samples.length || sampleRate <= 0) {
    return {
      frameRms: [],
      speechFrames: [],
      longPauseFrames: [],
      frameDurations: [],
      totalDurationSec: 0,
    };
  }
  const totalDurationSec = samples.length / sampleRate;
  const frameSamples = Math.max(1, Math.round((sampleRate * VAD_FRAME_MS) / 1000));
  const frameRms: number[] = [];
  const speechFrames: boolean[] = [];
  const longPauseFrames: boolean[] = [];
  const frameDurations: number[] = [];
  let silentRun = 0;
  let silentStartFrame: number | null = null;

  const closeSilence = (endExclusive = longPauseFrames.length) => {
    if (silentRun < LONG_PAUSE_SEC || silentStartFrame === null) {
      silentRun = 0;
      silentStartFrame = null;
      return;
    }
    for (let index = silentStartFrame; index < endExclusive; index += 1) {
      longPauseFrames[index] = true;
    }
    silentRun = 0;
    silentStartFrame = null;
  };

  for (let start = 0; start < samples.length; start += frameSamples) {
    const end = Math.min(samples.length, start + frameSamples);
    let energy = 0;
    for (let index = start; index < end; index += 1) energy += samples[index] * samples[index];
    const frameDuration = (end - start) / sampleRate;
    const rms = Math.sqrt(energy / Math.max(1, end - start));
    const isSpeech = rms >= VAD_RMS_THRESHOLD;
    frameRms.push(rms);
    speechFrames.push(isSpeech);
    longPauseFrames.push(false);
    frameDurations.push(frameDuration);
    if (isSpeech) {
      closeSilence(longPauseFrames.length - 1);
    } else {
      if (silentStartFrame === null) silentStartFrame = frameRms.length - 1;
      silentRun += frameDuration;
    }
  }
  closeSilence();
  return { frameRms, speechFrames, longPauseFrames, frameDurations, totalDurationSec };
}

export interface SpeechClassificationAnalysis {
  frameKinds: SpeechClassificationKind[];
  summary: SpeechClassification;
}

/** Partition the same VAD frames by CLOVA word-alignment overlap. */
export function classifySpeechFrames(
  vad: SpeechVadAnalysis,
  words: readonly WordTimestamp[],
): SpeechClassificationAnalysis | null {
  if (!vad.frameRms.length || !words.length) return null;
  const validWords = words.filter(
    (word) => Number.isFinite(word.start_ms) && Number.isFinite(word.end_ms) && word.end_ms > word.start_ms,
  );
  if (!validWords.length) return null;
  let frameStart = 0;
  const frameKinds = vad.speechFrames.map((isSpeech, index) => {
    const frameEnd = frameStart + vad.frameDurations[index];
    const aligned = validWords.some(
      (word) =>
        word.start_ms / 1000 < frameEnd + ALIGNMENT_BOUNDARY_TOLERANCE_SEC &&
        word.end_ms / 1000 > frameStart - ALIGNMENT_BOUNDARY_TOLERANCE_SEC,
    );
    const kind: SpeechClassificationKind = isSpeech
      ? aligned ? "transcribed_speech" : "untranscribed_speech"
      : aligned ? "pending" : "vad_silence";
    frameStart = frameEnd;
    return kind;
  });
  const durationByKind: Record<SpeechClassificationKind, number> = {
    transcribed_speech: 0,
    untranscribed_speech: 0,
    vad_silence: 0,
    pending: 0,
  };
  const countByKind: Record<SpeechClassificationKind, number> = {
    transcribed_speech: 0,
    untranscribed_speech: 0,
    vad_silence: 0,
    pending: 0,
  };
  let previous: SpeechClassificationKind | null = null;
  frameKinds.forEach((kind, index) => {
    durationByKind[kind] += vad.frameDurations[index];
    if (kind !== previous) countByKind[kind] += 1;
    previous = kind;
  });
  const balancedDurations = balanceClassificationDurations(vad.totalDurationSec, durationByKind);
  return {
    frameKinds,
    summary: {
      total_analysis_duration_sec: round(vad.totalDurationSec),
       transcribed_speech_duration_sec: balancedDurations.transcribed_speech,
      transcribed_speech_segment_count: countByKind.transcribed_speech,
       untranscribed_speech_duration_sec: balancedDurations.untranscribed_speech,
      untranscribed_speech_segment_count: countByKind.untranscribed_speech,
       vad_silence_duration_sec: balancedDurations.vad_silence,
      vad_silence_segment_count: countByKind.vad_silence,
       pending_duration_sec: balancedDurations.pending,
      pending_segment_count: countByKind.pending,
    },
  };
}

export function addSpeechClassification(
  metrics: SpeechMetrics,
  vad: SpeechVadAnalysis,
  words: readonly WordTimestamp[] | null | undefined,
): SpeechMetrics {
  const classification = words ? classifySpeechFrames(vad, words) : null;
  if (!classification) return { ...metrics, speech_classification: null };
  return {
    ...metrics,
    audio_timeline: buildAudioTimeline(
      vad.frameRms,
      vad.speechFrames,
      vad.longPauseFrames,
      classification.frameKinds,
    ),
    speech_classification: classification.summary,
  };
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

function calculateSpeechMetricsFromVad(
  vad: SpeechVadAnalysis,
  transcript = "",
): SpeechMetrics {
  if (!vad.frameRms.length) {
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
  const totalDuration = vad.totalDurationSec;
  const speechDuration = vad.speechFrames.reduce(
    (sum, isSpeech, index) => sum + (isSpeech ? vad.frameDurations[index] : 0),
    0,
  );
  let silentRun = 0;
  let longPauseCount = 0;
  let maxPause = 0;
  for (const [index, isSpeech] of vad.speechFrames.entries()) {
    if (isSpeech) {
      if (silentRun >= LONG_PAUSE_SEC) longPauseCount += 1;
      maxPause = Math.max(maxPause, silentRun);
      silentRun = 0;
    } else {
      silentRun += vad.frameDurations[index];
    }
  }
  if (silentRun >= LONG_PAUSE_SEC) longPauseCount += 1;
  maxPause = Math.max(maxPause, silentRun);
  const silenceDuration = Math.max(0, totalDuration - speechDuration);
  const rate = speechDuration > 0
    ? (countTranscriptEojeol(transcript) / speechDuration) * 60
    : null;
  return {
    total_duration_sec: round(totalDuration),
    speech_duration_sec: round(speechDuration),
    speech_rate_eojeol_per_min: rate === null ? null : round(rate),
    silence_duration_sec: round(silenceDuration),
    silence_ratio: totalDuration > 0 ? round(silenceDuration / totalDuration, 3) : 0,
    long_pause_count: longPauseCount,
    max_pause_sec: round(maxPause),
    long_pause_threshold_sec: LONG_PAUSE_SEC,
    audio_timeline: buildAudioTimeline(
      vad.frameRms,
      vad.speechFrames,
      vad.longPauseFrames,
    ),
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

export function mergeSpeechMetrics(metricsList: readonly SpeechMetrics[]): SpeechMetrics | null {
  if (!metricsList.length) return null;
  const total = metricsList.reduce((sum, item) => sum + item.total_duration_sec, 0);
  const speech = metricsList.reduce((sum, item) => sum + item.speech_duration_sec, 0);
  const silence = metricsList.reduce((sum, item) => sum + item.silence_duration_sec, 0);
  const timelines = metricsList.map((item) => item.audio_timeline);
  const canMergeTimeline = timelines.every((timeline) => timeline !== null && timeline !== undefined);
  const flatEnergy = canMergeTimeline ? timelines.flatMap((timeline) => timeline?.energy ?? []) : [];
  const flatSpeech = canMergeTimeline ? timelines.flatMap((timeline) => timeline?.speech ?? []) : [];
  const flatLongPause = canMergeTimeline ? timelines.flatMap((timeline) => timeline?.long_pause ?? []) : [];
  const canMergeClassification = metricsList.every(
    (item) => item.speech_classification && item.audio_timeline?.classification,
  );
  const flatKinds = canMergeClassification
    ? timelines.flatMap((timeline) => timeline?.classification ?? [])
    : [];
  const classification = canMergeClassification
    ? metricsList.reduce<SpeechClassification>((sum, item) => {
        const value = item.speech_classification!;
        return {
          total_analysis_duration_sec: sum.total_analysis_duration_sec + value.total_analysis_duration_sec,
          transcribed_speech_duration_sec: sum.transcribed_speech_duration_sec + value.transcribed_speech_duration_sec,
          transcribed_speech_segment_count: sum.transcribed_speech_segment_count + value.transcribed_speech_segment_count,
          untranscribed_speech_duration_sec: sum.untranscribed_speech_duration_sec + value.untranscribed_speech_duration_sec,
          untranscribed_speech_segment_count: sum.untranscribed_speech_segment_count + value.untranscribed_speech_segment_count,
          vad_silence_duration_sec: sum.vad_silence_duration_sec + value.vad_silence_duration_sec,
          vad_silence_segment_count: sum.vad_silence_segment_count + value.vad_silence_segment_count,
          pending_duration_sec: sum.pending_duration_sec + value.pending_duration_sec,
          pending_segment_count: sum.pending_segment_count + value.pending_segment_count,
        };
      }, {
        total_analysis_duration_sec: 0,
        transcribed_speech_duration_sec: 0,
        transcribed_speech_segment_count: 0,
        untranscribed_speech_duration_sec: 0,
        untranscribed_speech_segment_count: 0,
        vad_silence_duration_sec: 0,
        vad_silence_segment_count: 0,
        pending_duration_sec: 0,
        pending_segment_count: 0,
      })
    : null;
  const balancedClassification = classification
    ? balanceClassificationDurations(classification.total_analysis_duration_sec, {
        transcribed_speech: classification.transcribed_speech_duration_sec,
        untranscribed_speech: classification.untranscribed_speech_duration_sec,
        vad_silence: classification.vad_silence_duration_sec,
        pending: classification.pending_duration_sec,
      })
    : null;
  const first = metricsList[0];
  return {
    total_duration_sec: round(total),
    speech_duration_sec: round(speech),
    speech_rate_eojeol_per_min: null,
    silence_duration_sec: round(silence),
    silence_ratio: total > 0 ? round(silence / total, 3) : 0,
    long_pause_count: metricsList.reduce((sum, item) => sum + item.long_pause_count, 0),
    max_pause_sec: Math.max(...metricsList.map((item) => item.max_pause_sec)),
    long_pause_threshold_sec: first.long_pause_threshold_sec,
    audio_timeline: canMergeTimeline
      ? buildAudioTimeline(
          flatEnergy,
          flatSpeech,
          flatLongPause,
          canMergeClassification ? flatKinds : undefined,
        )
      : null,
    speech_classification: classification && balancedClassification
      ? {
          ...classification,
          total_analysis_duration_sec: round(classification.total_analysis_duration_sec),
          transcribed_speech_duration_sec: balancedClassification.transcribed_speech,
          untranscribed_speech_duration_sec: balancedClassification.untranscribed_speech,
          vad_silence_duration_sec: balancedClassification.vad_silence,
          pending_duration_sec: balancedClassification.pending,
        }
      : null,
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
): Promise<{ wav: Blob; metrics: SpeechMetrics; vad: SpeechVadAnalysis }> {
  const samples = await decodeAndResample(blob);
  let vad: SpeechVadAnalysis;
  try {
    vad = await analyzeSileroVad(samples, TARGET_SAMPLE_RATE);
  } catch {
    // Keep the answer/session usable if local browser model assets fail to load.
    vad = analyzeVad(samples, TARGET_SAMPLE_RATE);
  }
  return {
    wav: encodeWav(samples),
    metrics: calculateSpeechMetricsFromVad(vad, transcript),
    vad,
  };
}

export interface RealtimeVadMonitor {
  stop: () => void;
  ready: Promise<void>;
}

export function createSpeechEndGate(onLongSilence: () => void): {
  markValidSpeech: () => void;
  markSilence: () => void;
} {
  let validSpeechSeen = false;
  let notified = false;
  return {
    markValidSpeech() {
      validSpeechSeen = true;
    },
    markSilence() {
      if (!validSpeechSeen || notified) return;
      notified = true;
      onLongSilence();
    },
  };
}

function rmsForFrame(samples: Float32Array, start: number, end: number): number {
  let energy = 0;
  for (let index = start; index < end; index += 1) energy += samples[index] * samples[index];
  return Math.sqrt(energy / Math.max(1, end - start));
}

function analysisFromSpeechFrames(
  samples: Float32Array,
  sampleRate: number,
  speechFrames: boolean[],
  frameSamples: number,
): SpeechVadAnalysis {
  const frameRms: number[] = [];
  const longPauseFrames: boolean[] = [];
  const frameDurations: number[] = [];
  let silentRun = 0;
  let silentStartFrame: number | null = null;
  const closeSilence = (endExclusive = longPauseFrames.length) => {
    if (silentRun >= LONG_PAUSE_SEC && silentStartFrame !== null) {
      for (let index = silentStartFrame; index < endExclusive; index += 1) {
        longPauseFrames[index] = true;
      }
    }
    silentRun = 0;
    silentStartFrame = null;
  };

  for (let start = 0; start < samples.length; start += frameSamples) {
    const end = Math.min(samples.length, start + frameSamples);
    const frameDuration = (end - start) / sampleRate;
    const isSpeech = speechFrames[frameRms.length] ?? false;
    frameRms.push(rmsForFrame(samples, start, end));
    longPauseFrames.push(false);
    frameDurations.push(frameDuration);
    if (isSpeech) {
      closeSilence(longPauseFrames.length - 1);
    } else {
      silentStartFrame ??= frameRms.length - 1;
      silentRun += frameDuration;
    }
  }
  closeSilence();
  return {
    frameRms,
    speechFrames: speechFrames.slice(0, frameRms.length),
    longPauseFrames,
    frameDurations,
    totalDurationSec: samples.length / sampleRate,
  };
}

let offlineVadPromise: Promise<NonRealTimeVAD> | null = null;

async function getOfflineVad(): Promise<NonRealTimeVAD> {
  if (!offlineVadPromise) {
    offlineVadPromise = (async () => {
      const runtime = await import("onnxruntime-web");
      runtime.env.wasm.wasmPaths = SILERO_ASSET_PATH;
      const { NonRealTimeVAD } = await import("@ricky0123/vad-web");
      return NonRealTimeVAD.new({
        modelURL: SILERO_ASSET_PATH + "silero_vad_legacy.onnx",
        positiveSpeechThreshold: SILERO_POSITIVE_SPEECH_THRESHOLD,
        negativeSpeechThreshold: SILERO_NEGATIVE_SPEECH_THRESHOLD,
        redemptionMs: SILERO_SILENCE_REDEMPTION_MS,
        preSpeechPadMs: SILERO_PRE_SPEECH_PAD_MS,
        minSpeechMs: SILERO_MIN_SPEECH_MS,
        submitUserSpeechOnPause: false,
      });
    })().catch((error) => {
      offlineVadPromise = null;
      throw error;
    });
  }
  return offlineVadPromise;
}

async function analyzeSileroVad(
  samples: Float32Array,
  sampleRate: number,
): Promise<SpeechVadAnalysis> {
  if (!samples.length || sampleRate <= 0) {
    return analysisFromSpeechFrames(samples, sampleRate, [], 1);
  }
  const vad = await getOfflineVad();
  const segments: Array<{ start: number; end: number }> = [];
  for await (const segment of vad.run(samples, sampleRate)) {
    segments.push({ start: segment.start, end: segment.end });
  }
  const frameSamples = Math.max(1, Math.round((sampleRate * VAD_FRAME_MS) / 1000));
  const speechFrames = Array.from(
    { length: Math.ceil(samples.length / frameSamples) },
    (_, index) => {
      const startMs = (index * frameSamples * 1000) / sampleRate;
      const endMs =
        (Math.min(samples.length, (index + 1) * frameSamples) * 1000) / sampleRate;
      return segments.some(
        (segment) => segment.start < endMs && segment.end > startMs,
      );
    },
  );
  return analysisFromSpeechFrames(samples, sampleRate, speechFrames, frameSamples);
}

/** Monitor the shared mic with local Silero VAD; the stream tracks stay owned by the recorder. */
export function createRealtimeVadMonitor(
  stream: MediaStream,
  onLongSilence: () => void,
  onError?: (error: unknown) => void,
): RealtimeVadMonitor {
  let stopped = false;
  let vad: MicVAD | null = null;
  const speechEndGate = createSpeechEndGate(onLongSilence);
  const ready = (async () => {
    try {
      const { MicVAD } = await import("@ricky0123/vad-web");
      const nextVad = await MicVAD.new({
        model: "legacy",
        baseAssetPath: SILERO_ASSET_PATH,
        onnxWASMBasePath: SILERO_ASSET_PATH,
        positiveSpeechThreshold: SILERO_POSITIVE_SPEECH_THRESHOLD,
        negativeSpeechThreshold: SILERO_NEGATIVE_SPEECH_THRESHOLD,
        redemptionMs: SILERO_SILENCE_REDEMPTION_MS,
        preSpeechPadMs: SILERO_PRE_SPEECH_PAD_MS,
        minSpeechMs: SILERO_MIN_SPEECH_MS,
        submitUserSpeechOnPause: false,
        startOnLoad: false,
        getStream: async () => stream,
        pauseStream: async () => undefined,
        resumeStream: async () => stream,
        onSpeechStart: () => undefined,
        onSpeechRealStart: () => speechEndGate.markValidSpeech(),
        onVADMisfire: () => undefined,
        onSpeechEnd: () => {
          if (!stopped) speechEndGate.markSilence();
        },
      });
      if (stopped) {
        await nextVad.destroy();
        return;
      }
      vad = nextVad;
      await vad.start();
    } catch (error) {
      if (!stopped) onError?.(error);
      throw error;
    }
  })();
  return {
    ready,
    stop() {
      if (stopped) return;
      stopped = true;
      const activeVad = vad;
      if (activeVad) void activeVad.pause().catch(() => undefined);
    },
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
