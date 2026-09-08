import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateSpeechMetrics,
  canTranscribeRecording,
  claimAnswerProcessing,
  classifySpeechFrames,
  createSharedVadStreamCallbacks,
  createSileroVadOptions,
  createSpeechEndGate,
  deriveVadCalibration,
  getSileroVadCacheKey,
  SILERO_LEGACY_FRAME_MS,
  SILERO_MIN_SPEECH_MS,
  SILERO_MIN_SPEECH_FRAMES,
  SILERO_NEGATIVE_SPEECH_THRESHOLD,
  SILERO_POSITIVE_SPEECH_THRESHOLD,
  SILERO_SILENCE_REDEMPTION_MS,
  SILERO_SILENCE_REDEMPTION_FRAMES,
} from "./recorder.ts";

test("uses the approved initial Silero VAD policy", () => {
  assert.equal(SILERO_POSITIVE_SPEECH_THRESHOLD, 0.6);
  assert.equal(SILERO_NEGATIVE_SPEECH_THRESHOLD, 0.35);
  assert.equal(SILERO_MIN_SPEECH_MS, 250);
  assert.equal(SILERO_SILENCE_REDEMPTION_MS, 4000);
  assert.equal(SILERO_LEGACY_FRAME_MS, 96);
  assert.equal(SILERO_MIN_SPEECH_FRAMES, 2);
  assert.equal(SILERO_SILENCE_REDEMPTION_FRAMES, 41);
});

test("matches installed Silero frame semantics during calibration validation", () => {
  const sample = (probability: number, rms = 0.1) => ({
    probability,
    rms,
    durationSec: SILERO_LEGACY_FRAME_MS / 1000,
  });
  const noise = [
    ...Array.from({ length: 38 }, () => sample(0.05, 0.01)),
    sample(0.9, 0.02),
    sample(0.9, 0.02),
  ];
  assert.equal(
    deriveVadCalibration({
      noise,
      speech: Array.from({ length: 12 }, () => sample(0.8)),
    }),
    null,
  );

  const speech = [
    sample(0.8),
    sample(0.45),
    sample(0.1),
    sample(0.8),
    ...Array.from({ length: 8 }, () => sample(0.8)),
  ];
  assert.ok(
    deriveVadCalibration({
      noise: Array.from({ length: 12 }, () => sample(0.05, 0.01)),
      speech,
    }),
  );
});

test("shares calibrated options and refreshes the offline cache key", () => {
  const calibration = {
    positiveSpeechThreshold: 0.72,
    negativeSpeechThreshold: 0.41,
    rmsThreshold: null,
  };
  const options = createSileroVadOptions(calibration);
  assert.equal(options.positiveSpeechThreshold, calibration.positiveSpeechThreshold);
  assert.equal(options.negativeSpeechThreshold, calibration.negativeSpeechThreshold);
  assert.equal(options.redemptionMs, SILERO_SILENCE_REDEMPTION_MS);
  assert.equal(options.preSpeechPadMs, 250);
  assert.equal(options.minSpeechMs, SILERO_MIN_SPEECH_MS);
  assert.equal(options.submitUserSpeechOnPause, false);
  assert.notEqual(getSileroVadCacheKey(), getSileroVadCacheKey(calibration));
  assert.equal(getSileroVadCacheKey(calibration), getSileroVadCacheKey(calibration));
});

test("calibration monitor stream callbacks preserve the shared microphone", async () => {
  let stoppedTracks = 0;
  const stream = {
    getAudioTracks: () => [{ stop: () => { stoppedTracks += 1; } }],
  } as unknown as MediaStream;
  const callbacks = createSharedVadStreamCallbacks(stream);
  assert.equal(await callbacks.getStream(), stream);
  await callbacks.pauseStream();
  assert.equal(stoppedTracks, 0);
  assert.equal(await callbacks.resumeStream(), stream);
});

test("derives separated Silero and RMS thresholds from session samples", () => {
  const frames = (probability: number, rms: number) =>
    Array.from({ length: 12 }, () => ({
      probability,
      rms,
      durationSec: 0.1,
    }));
  const calibration = deriveVadCalibration({
    noise: frames(0.05, 0.01),
    speech: frames(0.8, 0.1),
  });

  assert.ok(calibration);
  assert.ok(Math.abs(calibration.negativeSpeechThreshold - 0.3) < 1e-9);
  assert.ok(Math.abs(calibration.positiveSpeechThreshold - 0.55) < 1e-9);
  assert.ok(Math.abs((calibration.rmsThreshold ?? 0) - 0.055) < 1e-9);
});

test("rejects inseparable calibration samples and keeps RMS fallback partial", () => {
  const frames = (probability: number, rms: number) =>
    Array.from({ length: 12 }, () => ({
      probability,
      rms,
      durationSec: 0.1,
    }));
  assert.equal(
    deriveVadCalibration({
      noise: frames(0.4, 0.01),
      speech: frames(0.45, 0.1),
    }),
    null,
  );
  const partial = deriveVadCalibration({
    noise: frames(0.05, 0.01),
    speech: frames(0.8, 0.012),
  });
  assert.ok(partial);
  assert.equal(partial.rmsThreshold, null);
  assert.equal(
    deriveVadCalibration({
      noise: [...frames(0.05, 0.01), {
        probability: Number.NaN,
        rms: 0.01,
        durationSec: 0.1,
      }],
      speech: frames(0.8, 0.1),
    }),
    null,
  );
});

test("uses a calibrated RMS threshold when measuring fallback speech", () => {
  const samples = new Float32Array(1000);
  samples.fill(0.02, 0, 500);
  const metrics = calculateSpeechMetrics(samples, 1000, "", 0.05);
  assert.equal(metrics.speech_duration_sec, 0);
  assert.equal(metrics.silence_duration_sec, 1);
});

test("auto-end waits for valid speech and notifies only once", () => {
  let notifications = 0;
  const gate = createSpeechEndGate(() => {
    notifications += 1;
  });
  gate.markSilence();
  assert.equal(notifications, 0);
  gate.markValidSpeech();
  gate.markSilence();
  gate.markSilence();
  assert.equal(notifications, 1);
});

test("transcribes only a recording that was explicitly started", () => {
  assert.equal(canTranscribeRecording(null, false, false), false);
  assert.equal(canTranscribeRecording(null, true, false), false);
  assert.equal(canTranscribeRecording("q1", false, false), false);
  assert.equal(canTranscribeRecording("q1", true, true), false);
  assert.equal(canTranscribeRecording("q1", true, false), true);
});

test("runs recorder stop, STT, and finalization once for a manual/VAD race", async () => {
  const processingIds = new Set<string>();
  let recorderStops = 0;
  let sttRequests = 0;
  let finalizations = 0;
  const finalize = async () => {
    if (!claimAnswerProcessing("q1", processingIds, false)) return;
    try {
      recorderStops += 1;
      await Promise.resolve();
      sttRequests += 1;
      await Promise.resolve();
      finalizations += 1;
    } finally {
      processingIds.delete("q1");
    }
  };
  await Promise.all([finalize(), finalize()]);
  assert.equal(recorderStops, 1);
  assert.equal(sttRequests, 1);
  assert.equal(finalizations, 1);
});

test("calculates speech time, pauses, and transcript rate", () => {
  const sampleRate = 1000;
  const samples = new Float32Array(sampleRate * 6);
  const mark = (start: number, end: number) => {
    for (let index = start * sampleRate; index < end * sampleRate; index += 1) {
      samples[index] = 0.1;
    }
  };
  mark(1, 2.2);
  mark(4.4, 5.2);

  const metrics = calculateSpeechMetrics(samples, sampleRate, "하나 둘 셋 넷");
  assert.equal(metrics.total_duration_sec, 6);
  assert.equal(metrics.speech_duration_sec, 2);
  assert.equal(metrics.silence_duration_sec, 4);
  assert.equal(metrics.long_pause_count, 1);
  assert.equal(metrics.max_pause_sec, 2.2);
  assert.equal(metrics.speech_rate_eojeol_per_min, 120);
  assert.ok(metrics.audio_timeline);
  assert.equal(metrics.audio_timeline.energy.length, 120);
  assert.equal(metrics.audio_timeline.speech.length, 120);
  assert.equal(metrics.audio_timeline.long_pause.length, 120);
  assert.ok(metrics.audio_timeline.speech.some(Boolean));
  assert.ok(metrics.audio_timeline.long_pause.some(Boolean));
  assert.ok(metrics.audio_timeline.energy.every((value) => value >= 0 && value <= 1));
});

test("returns empty measurements for empty audio", () => {
  const metrics = calculateSpeechMetrics(new Float32Array(), 16000);
  assert.equal(metrics.total_duration_sec, 0);
  assert.equal(metrics.speech_rate_eojeol_per_min, null);
  assert.equal(metrics.audio_timeline, null);
});

test("partitions VAD frames by aligned words without treating unmatched speech as filler", () => {
  const result = classifySpeechFrames(
    {
      frameRms: [0.1, 0, 0, 0.1],
      speechFrames: [true, false, false, true],
      longPauseFrames: [false, false, false, false],
      frameDurations: [0.25, 0.25, 0.25, 0.25],
      totalDurationSec: 1,
    },
    [
      { start_ms: 0, end_ms: 150, text: "하나" },
      { start_ms: 600, end_ms: 650, text: "둘" },
    ],
  );

  assert.ok(result);
  assert.deepEqual(result.frameKinds, [
    "transcribed_speech",
    "vad_silence",
    "pending",
    "untranscribed_speech",
  ]);
  assert.equal(result.summary.total_analysis_duration_sec, 1);
  assert.equal(
    result.summary.transcribed_speech_duration_sec +
      result.summary.untranscribed_speech_duration_sec +
      result.summary.vad_silence_duration_sec +
      result.summary.pending_duration_sec,
    result.summary.total_analysis_duration_sec,
  );
  assert.equal(result.summary.untranscribed_speech_segment_count, 1);
  assert.equal(result.summary.pending_segment_count, 1);
});
