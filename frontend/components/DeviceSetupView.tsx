"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GazeDebugOverlay from "@/components/GazeDebugOverlay";
import InterviewerStage from "@/components/InterviewerStage";
import {
  CALIBRATION_PATH_DURATION_MS,
  CALIBRATION_CONTINUOUS_TARGET_DELAY_MS,
  CALIBRATION_GRID_POINTS,
  CALIBRATION_GRID_ORDER,
  CALIBRATION_POINT_SETTLE_MS,
  CALIBRATION_POINT_COLLECT_MS,
  calibrationPathPoints,
  calibrationTargetAt,
  createGazeCalibration,
  createBrowserGazeTracker,
  type BrowserGazeTracker,
  type CalibrationPath,
  type CalibrationTargetHistoryEntry,
  type GazeCalibrationSample,
  type GazeCalibration,
  type GazeDebugFrame,
  type GazeQuality,
  type GazePoint,
} from "@/lib/gaze";
import {
  DEFAULT_TTS_VOICE_ID,
  synthesizeSpeech,
  TTS_VOICE_IDS,
  transcribe,
  type TtsVoiceId,
} from "@/lib/api";
import { blobToWav16k, createRecorder, type AnswerRecorder } from "@/lib/recorder";
import { useMicLevel } from "@/components/InterviewView";
import { playAudioBlob, type SpeechCancellationRef } from "@/lib/ttsPlayback";
const CAN_DEBUG_GAZE = process.env.NODE_ENV !== "production";

const TEST_SENTENCE = "안녕하세요. 지금부터 모의 면접을 시작하겠습니다.";
const VOICE_PREVIEW_TEXT = "반갑습니다";
const CALIBRATION_START_COUNTDOWN_SEC = 3;
const CALIBRATION_PHASE_GUIDE_MS = 1500;
const CALIBRATION_DIRECTION_PREVIEW_MS = 600;
const CALIBRATION_POINT_PREVIEW_MS = 1000;
const CALIBRATION_MIN_SAMPLES = 120;
const CALIBRATION_PATHS: readonly CalibrationPath[] = ["plus", "x"];
const CALIBRATION_STAGE_COUNT = 3;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function gazeQualityMessage(quality: GazeQuality | null): string {
  switch (quality) {
    case "ok":
      return "시선이 인식되고 있습니다.";
    case "face_missing":
      return "얼굴이 카메라에 보이지 않습니다.";
    case "eye_too_small":
      return "눈이 작게 보입니다. 카메라에 조금 가까이 앉아 주세요.";
    case "blink":
      return "눈을 뜨고 잠시 시선을 고정해 주세요.";
    case "eyes_disagree":
      return "양쪽 눈의 위치가 불안정합니다. 얼굴을 정면에 가깝게 유지해 주세요.";
    case "invalid":
      return "시선 좌표를 안정적으로 읽지 못했습니다.";
    case "frame_error":
      return "카메라 프레임을 읽지 못했습니다.";
    case "processing_error":
      return "시선 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
    default:
      return "시선 상태를 확인하는 중입니다.";
  }
}

function formatCalibrationPx(value: number | null): string {
  return value === null || !Number.isFinite(value) ? "—" : String(Math.round(value)) + "px";
}

function voiceLabel(voiceId: TtsVoiceId): string {
  return `${voiceId.startsWith("F") ? "여성" : "남성"} ${voiceId.slice(1)}`;
}

export interface DeviceSetupResult {
  stream: MediaStream;
  calibration: GazeCalibration | null;
  voiceId: TtsVoiceId;
}

type CalibrationState = "idle" | "running" | "success" | "failed" | "skipped";
type CalibrationPhase = "idle" | "countdown" | "preview" | "settle" | "moving" | "collecting" | "training" | "retry";
type CalibrationStage = "moving" | "static" | null;
type CalibrationGuide = "moving" | "static" | null;
type SttState = "idle" | "recording" | "checking" | "review" | "success" | "failed" | "skipped";

export default function DeviceSetupView({
  interviewerImageSrc,
  onReady,
  onCancel,
  onVoiceChange,
}: {
  interviewerImageSrc?: string | null;
  onReady: (result: DeviceSetupResult) => void;
  onCancel: () => void;
  onVoiceChange?: (voiceId: TtsVoiceId) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");
  const [voiceId, setVoiceId] = useState<TtsVoiceId>(DEFAULT_TTS_VOICE_ID);
  const [deviceState, setDeviceState] = useState<"loading" | "ready" | "failed">("loading");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [gazeState, setGazeState] = useState<"loading" | "ready" | "failed">("loading");
  const [gazeFrame, setGazeFrame] = useState<GazeDebugFrame | null>(null);
  const [calibrationState, setCalibrationState] = useState<CalibrationState>("idle");
  const [calibrationPhase, setCalibrationPhase] = useState<CalibrationPhase>("idle");
  const [calibrationStage, setCalibrationStage] = useState<CalibrationStage>(null);
  const [calibrationGuide, setCalibrationGuide] = useState<CalibrationGuide>(null);
  const [calibration, setCalibration] = useState<GazeCalibration | null>(null);
  const [calibrationCountdown, setCalibrationCountdown] = useState<number | null>(null);
  const [calibrationPath, setCalibrationPath] = useState<CalibrationPath | null>(null);
  const [calibrationPathSegmentIndex, setCalibrationPathSegmentIndex] = useState<number | null>(null);
  const [calibrationTarget, setCalibrationTarget] = useState<GazePoint | null>(null);
  const [calibrationGridPointIndex, setCalibrationGridPointIndex] = useState<number | null>(null);
  const [calibrationGridPreview, setCalibrationGridPreview] = useState(false);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(null);
  const [sttState, setSttState] = useState<SttState>("idle");
  const [sttMessage, setSttMessage] = useState<string | null>(null);
  const [sttTranscript, setSttTranscript] = useState<string | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [voicePreviewState, setVoicePreviewState] = useState<
    "idle" | "loading" | "playing" | "failed"
  >("idle");
  const [voicePreviewMessage, setVoicePreviewMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const calibrationStageRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gazeTrackerRef = useRef<BrowserGazeTracker | null>(null);
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const calibrationRunRef = useRef(0);
  const calibrationSamplesRef = useRef<GazeCalibrationSample[]>([]);
  const calibrationTargetHistoryRef = useRef<CalibrationTargetHistoryEntry[]>([]);
  const calibrationCollectingRef = useRef(false);
  const calibrationSourceRef = useRef<"plus" | "x" | "grid" | null>(null);
  const calibrationPointIdRef = useRef<number | null>(null);
  const calibrationTargetRef = useRef<GazePoint | null>(null);
  const calibrationAnimationRef = useRef<number | null>(null);
  const calibrationCancelRef = useRef<(() => void) | null>(null);
  const latestGazeQualityRef = useRef<GazeQuality | null>(null);
  const transferredRef = useRef(false);
  const disposedRef = useRef(false);
  const voicePreviewRequestRef = useRef<AbortController | null>(null);
  const voicePreviewCancellationRef = useRef<SpeechCancellationRef["current"]>(null);
  const micLevel = useMicLevel(stream, sttState === "recording");

  const cancelVoicePreview = useCallback(() => {
    voicePreviewRequestRef.current?.abort();
    voicePreviewRequestRef.current = null;
    voicePreviewCancellationRef.current?.();
    voicePreviewCancellationRef.current = null;
    setVoicePreviewState("idle");
    setVoicePreviewMessage(null);
  }, []);

  async function previewVoice() {
    cancelVoicePreview();
    const controller = new AbortController();
    voicePreviewRequestRef.current = controller;
    setVoicePreviewState("loading");
    try {
      const blob = await synthesizeSpeech(VOICE_PREVIEW_TEXT, controller.signal, voiceId);
      if (voicePreviewRequestRef.current !== controller) return;
      setVoicePreviewState("playing");
      await playAudioBlob(blob, VOICE_PREVIEW_TEXT, voicePreviewCancellationRef);
      if (voicePreviewRequestRef.current === controller) setVoicePreviewState("idle");
    } catch (error) {
      if (controller.signal.aborted || voicePreviewRequestRef.current !== controller) return;
      setVoicePreviewState("failed");
      setVoicePreviewMessage(
        error instanceof Error ? error.message : "음성 미리듣기에 실패했습니다.",
      );
    } finally {
      if (voicePreviewRequestRef.current === controller) {
        voicePreviewRequestRef.current = null;
        voicePreviewCancellationRef.current = null;
      }
    }
  }

  const onGazeFrame = useCallback((frame: GazeDebugFrame) => {
    setGazeFrame(frame);
    latestGazeQualityRef.current = frame.quality;
    const source = calibrationSourceRef.current;
    if (!calibrationCollectingRef.current || !source || !frame.rawGaze) return;
    const target =
      source === "grid"
        ? calibrationTargetRef.current
        : calibrationTargetAt(
            calibrationTargetHistoryRef.current,
            performance.now() - CALIBRATION_CONTINUOUS_TARGET_DELAY_MS,
          );
    if (!target) return;
    calibrationSamplesRef.current.push({
      gaze: frame.rawGaze,
      target,
      eyeWidthPx: frame.eyeWidthPx ?? undefined,
      source,
      pointId: source === "grid" ? calibrationPointIdRef.current ?? undefined : undefined,
    });
  }, []);

  const configureDevices = useCallback(async (nextCameraId = "", nextMicrophoneId = "") => {
    cancelVoicePreview();
    setDeviceState("loading");
    setStream(null);
    setDeviceError(null);
    setGazeState("loading");
    setGazeFrame(null);
    calibrationRunRef.current += 1;
    setCalibration(null);
    setCalibrationState("idle");
    setCalibrationPhase("idle");
    setCalibrationStage(null);
    setCalibrationGuide(null);
    setCalibrationCountdown(null);
    setCalibrationPath(null);
    setCalibrationPathSegmentIndex(null);
    setCalibrationTarget(null);
    setCalibrationGridPointIndex(null);
    setCalibrationGridPreview(false);
    setCalibrationProgress(0);
    setCalibrationMessage(null);
    calibrationSamplesRef.current = [];
    calibrationTargetHistoryRef.current = [];
    calibrationCancelRef.current?.();
    calibrationCancelRef.current = null;
    calibrationCollectingRef.current = false;
    calibrationSourceRef.current = null;
    calibrationPointIdRef.current = null;
    calibrationTargetRef.current = null;
    latestGazeQualityRef.current = null;
    if (calibrationAnimationRef.current !== null) {
      cancelAnimationFrame(calibrationAnimationRef.current);
      calibrationAnimationRef.current = null;
    }
    setSttState("idle");
    setSttMessage(null);
    setSttTranscript(null);
    recorderRef.current = null;

    gazeTrackerRef.current?.close();
    gazeTrackerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());

    if (!navigator.mediaDevices?.getUserMedia) {
      setDeviceState("failed");
      setGazeState("failed");
      setDeviceError(
        "카메라·마이크는 HTTPS 또는 http://localhost:3000에서만 사용할 수 있습니다.",
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: nextCameraId
          ? {
              deviceId: { exact: nextCameraId },
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            }
          : {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 30 },
            },
        audio: {
          ...(nextMicrophoneId ? { deviceId: { exact: nextMicrophoneId } } : {}),
          channelCount: { ideal: 1 },
          echoCancellation: { ideal: true },
          noiseSuppression: { ideal: true },
          autoGainControl: { ideal: false },
        },
      });
      if (disposedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
      setStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      const available = await navigator.mediaDevices.enumerateDevices();
      setDevices(available);
      setCameraId(stream.getVideoTracks()[0]?.getSettings().deviceId ?? nextCameraId);
      setMicrophoneId(stream.getAudioTracks()[0]?.getSettings().deviceId ?? nextMicrophoneId);
      setDeviceState("ready");

      if (videoRef.current) {
        try {
          const tracker = await createBrowserGazeTracker(videoRef.current, onGazeFrame);
          if (disposedRef.current || streamRef.current !== stream) {
            tracker.close();
            return;
          }
          gazeTrackerRef.current = tracker;
          tracker.start();
          setGazeState("ready");
        } catch {
          setGazeState("failed");
        }
      }
    } catch (error) {
      setDeviceState("failed");
      setGazeState("failed");
      setDeviceError(
        "카메라·마이크를 열 수 없습니다. 브라우저 권한과 다른 앱의 장치 사용 여부를 확인하세요. " +
          (error instanceof Error ? `(${error.message})` : ""),
      );
    }
  }, [cancelVoicePreview, onGazeFrame]);

  useEffect(() => {
    disposedRef.current = false;
    const startupTimer = setTimeout(() => void configureDevices(), 0);
    return () => {
      disposedRef.current = true;
      calibrationRunRef.current += 1;
      calibrationCancelRef.current?.();
      calibrationCancelRef.current = null;
      if (calibrationAnimationRef.current !== null) {
        cancelAnimationFrame(calibrationAnimationRef.current);
        calibrationAnimationRef.current = null;
      }
      clearTimeout(startupTimer);
      cancelVoicePreview();
      gazeTrackerRef.current?.close();
      gazeTrackerRef.current = null;
      if (!transferredRef.current) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
      }
    };
  }, [cancelVoicePreview, configureDevices]);

  async function startCalibration() {
    const tracker = gazeTrackerRef.current;
    if (!tracker) {
      setCalibrationState("failed");
      setCalibrationMessage("시선 분석이 준비되지 않았습니다. 잠시 후 다시 시도해 주세요.");
      return;
    }

    const run = calibrationRunRef.current + 1;
    calibrationRunRef.current = run;
    setCalibration(null);
    setCalibrationMessage(null);
    setCalibrationState("running");
    setCalibrationPhase("countdown");
    setCalibrationStage(null);
    setCalibrationGuide(null);
    setCalibrationPath(null);
    setCalibrationPathSegmentIndex(null);
    setCalibrationTarget(null);
    setCalibrationGridPointIndex(null);
    setCalibrationGridPreview(false);
    setCalibrationProgress(0);
    calibrationSamplesRef.current = [];
    calibrationTargetHistoryRef.current = [];
    calibrationCollectingRef.current = false;
    calibrationSourceRef.current = null;
    calibrationPointIdRef.current = null;
    calibrationTargetRef.current = null;
    tracker.setCalibration(undefined);
    tracker.setCalibrationMode(true);

    try {
      for (let count = CALIBRATION_START_COUNTDOWN_SEC; count >= 1; count -= 1) {
        if (calibrationRunRef.current !== run) return;
        setCalibrationCountdown(count);
        await wait(1000);
      }
      setCalibrationCountdown(null);

      setCalibrationStage("moving");
      setCalibrationGuide("moving");
      setCalibrationPhase("settle");
      setCalibrationPath(CALIBRATION_PATHS[0]);
      setCalibrationPathSegmentIndex(0);
      setCalibrationGridPointIndex(null);
      setCalibrationTarget({ x: 0.5, y: 0.5 });
      calibrationTargetRef.current = { x: 0.5, y: 0.5 };
      await wait(CALIBRATION_PHASE_GUIDE_MS);
      if (calibrationRunRef.current !== run) return;
      setCalibrationGuide(null);
      setCalibrationPath(null);
      setCalibrationPathSegmentIndex(null);
      setCalibrationTarget(null);
      calibrationTargetRef.current = null;

      for (let pathIndex = 0; pathIndex < CALIBRATION_PATHS.length; pathIndex += 1) {
        if (calibrationRunRef.current !== run) return;
        const path = CALIBRATION_PATHS[pathIndex];
        const pathPoints = calibrationPathPoints(path);
        const segmentCount = pathPoints.length - 1;
        const segmentDurationMs = CALIBRATION_PATH_DURATION_MS / segmentCount;
        calibrationSourceRef.current = path;
        calibrationPointIdRef.current = null;
        setCalibrationPath(path);
        setCalibrationGridPointIndex(null);

        for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex += 1) {
          if (calibrationRunRef.current !== run) return;
          const start = pathPoints[segmentIndex];
          const end = pathPoints[segmentIndex + 1];
          calibrationTargetRef.current = start;
          calibrationCollectingRef.current = false;
          calibrationTargetHistoryRef.current = [{ at: performance.now(), target: start }];
          setCalibrationTarget(start);
          setCalibrationPathSegmentIndex(segmentIndex);
          setCalibrationProgress(
            ((pathIndex + segmentIndex / segmentCount) / CALIBRATION_STAGE_COUNT) * 100,
          );
          const isCenterDeparture = segmentIndex % 2 === 0;
          if (isCenterDeparture) {
            setCalibrationPhase("settle");
            await wait(CALIBRATION_DIRECTION_PREVIEW_MS);
            if (calibrationRunRef.current !== run) return;
          }

          calibrationCollectingRef.current = true;
          setCalibrationPhase("moving");
          const completed = await new Promise<boolean>((resolve) => {
            calibrationCancelRef.current = () => resolve(false);
            let activeElapsed = 0;
            let previousAt = performance.now();
            const animate = (now: number) => {
              if (calibrationRunRef.current !== run) { resolve(false); return; }
              const delta = Math.min(100, Math.max(0, now - previousAt));
              previousAt = now;
              if (latestGazeQualityRef.current === "ok") activeElapsed += delta;
              const progress = Math.min(1, activeElapsed / segmentDurationMs);
              const eased = progress * progress * (3 - 2 * progress);
              const target = {
                x: start.x + (end.x - start.x) * eased,
                y: start.y + (end.y - start.y) * eased,
              };
              calibrationTargetRef.current = target;
              setCalibrationTarget(target);
              calibrationTargetHistoryRef.current.push({ at: now, target });
              const cutoff = now - CALIBRATION_CONTINUOUS_TARGET_DELAY_MS - 1000;
              while (calibrationTargetHistoryRef.current.length > 1 && calibrationTargetHistoryRef.current[0].at < cutoff) {
                calibrationTargetHistoryRef.current.shift();
              }
              setCalibrationProgress(
                ((pathIndex + (segmentIndex + progress) / segmentCount) / CALIBRATION_STAGE_COUNT) * 100,
              );
              if (progress >= 1) { resolve(true); return; }
              calibrationAnimationRef.current = requestAnimationFrame(animate);
            };
            calibrationAnimationRef.current = requestAnimationFrame(animate);
          });
          calibrationCancelRef.current = null;
          calibrationAnimationRef.current = null;
          calibrationCollectingRef.current = false;
          if (!completed || calibrationRunRef.current !== run) return;
        }
      }

      calibrationTargetHistoryRef.current = [];
      setCalibrationPath(null);
      setCalibrationPathSegmentIndex(null);
      setCalibrationTarget(null);

      const firstGridPointId = CALIBRATION_GRID_ORDER[0];
      const firstGridTarget = CALIBRATION_GRID_POINTS[firstGridPointId];
      if (!firstGridTarget) return;
      setCalibrationStage("static");
      setCalibrationGuide("static");
      calibrationSourceRef.current = "grid";
      calibrationPointIdRef.current = firstGridPointId;
      calibrationTargetRef.current = firstGridTarget;
      setCalibrationTarget(firstGridTarget);
      setCalibrationGridPointIndex(0);
      setCalibrationProgress((2 / CALIBRATION_STAGE_COUNT) * 100);
      setCalibrationGridPreview(true);
      setCalibrationPhase("preview");
      await wait(CALIBRATION_PHASE_GUIDE_MS);
      if (calibrationRunRef.current !== run) return;
      setCalibrationGuide(null);
      setCalibrationGridPreview(false);

      for (let gridIndex = 0; gridIndex < CALIBRATION_GRID_ORDER.length; gridIndex += 1) {
        if (calibrationRunRef.current !== run) return;
        const pointId = CALIBRATION_GRID_ORDER[gridIndex];
        const target = CALIBRATION_GRID_POINTS[pointId];
        if (!target) continue;
        calibrationSourceRef.current = "grid";
        calibrationPointIdRef.current = pointId;
        calibrationTargetRef.current = target;
        calibrationTargetHistoryRef.current = [];
        setCalibrationPath(null);
        setCalibrationTarget(target);
        setCalibrationGridPointIndex(gridIndex);
        setCalibrationProgress(((2 + gridIndex / CALIBRATION_GRID_ORDER.length) / CALIBRATION_STAGE_COUNT) * 100);
        const usesStaticGuide = gridIndex === 0;
        setCalibrationGridPreview(!usesStaticGuide);
        setCalibrationPhase(usesStaticGuide ? "settle" : "preview");
        if (!usesStaticGuide) await wait(CALIBRATION_POINT_PREVIEW_MS);
        setCalibrationGridPreview(false);
        if (calibrationRunRef.current !== run) return;
        setCalibrationPhase("settle");
        await wait(CALIBRATION_POINT_SETTLE_MS);
        if (calibrationRunRef.current !== run) return;
        calibrationCollectingRef.current = true;
        setCalibrationPhase("collecting");
        setCalibrationProgress(((2 + (gridIndex + 0.5) / CALIBRATION_GRID_ORDER.length) / CALIBRATION_STAGE_COUNT) * 100);
        await wait(CALIBRATION_POINT_COLLECT_MS);
        calibrationCollectingRef.current = false;
        if (calibrationRunRef.current !== run) return;
      }

      calibrationCollectingRef.current = false;
      calibrationSourceRef.current = null;
      calibrationPointIdRef.current = null;
      calibrationTargetRef.current = null;
      calibrationTargetHistoryRef.current = [];
      setCalibrationGridPointIndex(null);
      setCalibrationTarget(null);
      setCalibrationStage(null);
      setCalibrationGuide(null);
      if (calibrationRunRef.current !== run) return;
      if (calibrationSamplesRef.current.length < CALIBRATION_MIN_SAMPLES) {
        setCalibrationPhase("idle");
        setCalibrationState("failed");
        setCalibrationMessage(
          "보정에 사용할 유효 시선 프레임이 " + CALIBRATION_MIN_SAMPLES + "개 미만입니다. 카메라 화면의 안내를 확인한 뒤 다시 시도해 주세요.",
        );
        return;
      }

      setCalibrationPhase("training");
      const stageRect = calibrationStageRef.current?.getBoundingClientRect();
      const nextCalibration = await createGazeCalibration(calibrationSamplesRef.current, {
        onProgress: setCalibrationProgress,
        shouldCancel: () => calibrationRunRef.current !== run,
        stageSize:
          stageRect && stageRect.width > 0 && stageRect.height > 0
            ? { width: stageRect.width, height: stageRect.height }
            : undefined,
      });
      if (calibrationRunRef.current !== run) return;
      if (!nextCalibration) {
        setCalibrationState("failed");
        setCalibrationMessage(
          "시선 범위를 충분히 구분하지 못했습니다. 조명과 얼굴 위치를 확인한 뒤 다시 측정해 주세요.",
        );
        setCalibrationPhase("idle");
        return;
      }
      tracker.setCalibration(nextCalibration);
      setCalibration(nextCalibration);
      setCalibrationPhase("idle");
      setCalibrationState("success");
      setCalibrationMessage(null);
    } finally {
      calibrationCollectingRef.current = false;
      setCalibrationGridPreview(false);
      setCalibrationStage(null);
      setCalibrationGuide(null);
      setCalibrationPathSegmentIndex(null);
      calibrationSourceRef.current = null;
      calibrationPointIdRef.current = null;
      calibrationTargetRef.current = null;
      calibrationTargetHistoryRef.current = [];
      tracker.setCalibrationMode(false);
    }
  }
  async function toggleSttTest() {
    cancelVoicePreview();
    const stream = streamRef.current;
    if (!stream) return;

    if (sttState !== "recording") {
      try {
        const recorder = createRecorder(stream);
        recorderRef.current = recorder;
        setSttMessage(null);
        setSttTranscript(null);
        setSttState("recording");
        recorder.start();
      } catch (error) {
        setSttState("failed");
        setSttMessage(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    setSttState("checking");
    try {
      const raw = await recorderRef.current?.stop();
      if (!raw) throw new Error("녹음 데이터가 없습니다.");
      const wav = await blobToWav16k(raw);
      const result = await transcribe(wav, "device-check.wav");
      if (result.status === "ok" && result.transcript.trim()) {
        setSttTranscript(result.transcript.trim());
        setSttState("review");
      } else {
        setSttTranscript(null);
        setSttState("failed");
        setSttMessage(
          result.status === "not_configured"
            ? "STT가 설정되지 않았습니다. 건너뛰고 면접을 진행할 수 있습니다."
            : result.error ?? "음성이 인식되지 않았습니다.",
        );
      }
    } catch (error) {
      setSttTranscript(null);
      setSttState("failed");
      setSttMessage(
        "STT 확인에 실패했습니다. 건너뛰고 면접을 진행할 수 있습니다. " +
          (error instanceof Error ? `(${error.message})` : ""),
      );
    }
  }

  function skipSttTest() {
    const recorder = recorderRef.current;
    if (sttState === "recording" && recorder?.isRecording()) {
      void recorder.stop().catch(() => undefined);
    }
    recorderRef.current = null;
    setSttMessage(null);
    setSttTranscript(null);
    setSttState("skipped");
  }

  function skipCalibration() {
    calibrationRunRef.current += 1;
    calibrationCancelRef.current?.();
    calibrationCancelRef.current = null;
    if (calibrationAnimationRef.current !== null) {
      cancelAnimationFrame(calibrationAnimationRef.current);
      calibrationAnimationRef.current = null;
    }
    setCalibration(null);
    setCalibrationCountdown(null);
    setCalibrationStage(null);
    setCalibrationGuide(null);
    setCalibrationPath(null);
    setCalibrationPathSegmentIndex(null);
    setCalibrationTarget(null);
    setCalibrationGridPointIndex(null);
    setCalibrationGridPreview(false);
    setCalibrationProgress(0);
    setCalibrationMessage(null);
    setCalibrationPhase("idle");
    calibrationTargetHistoryRef.current = [];
    calibrationCollectingRef.current = false;
    calibrationSourceRef.current = null;
    calibrationPointIdRef.current = null;
    calibrationTargetRef.current = null;
    latestGazeQualityRef.current = null;
    gazeTrackerRef.current?.setCalibrationMode(false);
    setCalibrationState("skipped");
  }
  function continueToInterview() {
    const stream = streamRef.current;
    if (!stream) return;
    transferredRef.current = true;
    gazeTrackerRef.current?.close();
    gazeTrackerRef.current = null;
    onReady({ stream, calibration, voiceId });
  }

  const cameras = devices.filter((device) => device.kind === "videoinput");
  const microphones = devices.filter((device) => device.kind === "audioinput");
  const calibrationDone = calibrationState === "success" || calibrationState === "skipped";
  const sttDone = sttState === "success" || sttState === "skipped";
  const deviceBusy =
    deviceState === "loading" ||
    sttState === "recording" ||
    sttState === "checking";
  const busy = deviceBusy || calibrationState === "running";


  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">카메라·마이크 설정</h2>
        <p className="mt-1 text-sm text-gray-500">
          실제 면접 전에 화면, 시선 기준점과 음성 인식을 확인합니다.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">카메라</span>
          <select
            value={cameraId}
            disabled={busy || deviceState !== "ready"}
            onChange={(event) => void configureDevices(event.target.value, microphoneId)}
            className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          >
            {cameras.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `카메라 ${index + 1}`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">마이크</span>
          <select
            value={microphoneId}
            disabled={busy || deviceState !== "ready"}
            onChange={(event) => void configureDevices(cameraId, event.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
          >
            {microphones.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `마이크 ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="flex max-w-sm flex-col gap-1 text-sm">
        <span className="font-medium">면접관 음성</span>
        <select
          value={voiceId}
          disabled={busy || deviceState !== "ready"}
          onChange={(event) => {
            cancelVoicePreview();
            const nextVoiceId = event.target.value as TtsVoiceId;
            setVoiceId(nextVoiceId);
            onVoiceChange?.(nextVoiceId);
          }}
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        >
          {TTS_VOICE_IDS.map((id) => (
            <option key={id} value={id}>
              {voiceLabel(id)}
            </option>
          ))}
        </select>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void previewVoice()}
            disabled={
              busy ||
              deviceState !== "ready" ||
              voicePreviewState === "loading" ||
              voicePreviewState === "playing"
            }
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm dark:border-gray-700"
          >
            {voicePreviewState === "loading"
              ? "음성 준비 중…"
              : voicePreviewState === "playing"
                ? "재생 중…"
                : "음성 미리 듣기"}
          </button>
          {voicePreviewState === "failed" && (
            <span className="text-xs text-amber-600">{voicePreviewMessage}</span>
          )}
        </div>
      </label>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="flex min-w-0 flex-col gap-2 lg:items-center">
          <div ref={calibrationStageRef} className="w-full max-w-full lg:max-w-[50vw]">
            <InterviewerStage
              className="w-full"
              showLabel={calibrationState !== "running"}
              imageSrc={interviewerImageSrc}
            >
              {calibrationState !== "running" && (
                <GazeDebugOverlay
                  active={gazeState === "ready"}
                  frame={gazeFrame}
                  verbose={CAN_DEBUG_GAZE}
                  idleLabel={gazeState === "loading" ? "시선 분석 준비 중" : "시선 분석 사용 불가"}
                />
              )}
              <CalibrationPathOverlay
                path={calibrationPath}
                pathSegmentIndex={calibrationPathSegmentIndex}
                target={calibrationTarget}
                gridPointIndex={calibrationGridPointIndex}
                preview={calibrationGridPreview}
                guide={calibrationGuide}
                phase={calibrationPhase}
                countdown={calibrationCountdown}
              />
            </InterviewerStage>
          </div>
          <div className="w-full max-w-full lg:max-w-[50vw]">
            <CalibrationStatus
              path={calibrationPath}
              pathSegmentIndex={calibrationPathSegmentIndex}
              phase={calibrationPhase}
              stage={calibrationStage}
              countdown={calibrationCountdown}
              progress={calibrationProgress}
              gridPointIndex={calibrationGridPointIndex}
              quality={gazeFrame?.quality ?? null}
            />
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-xs overflow-hidden rounded-lg bg-black lg:max-w-none">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full -scale-x-100 object-cover"
          />
          {calibrationState === "running" && (
            <div className="absolute inset-x-3 bottom-3 rounded-md bg-slate-950/75 px-3 py-2 text-center text-xs text-slate-100">
              {gazeQualityMessage(gazeFrame?.quality ?? null)}
              {gazeFrame?.quality === "ok" && calibrationStage === "moving" && " 1단계 이동 경로를 따라가 주세요."}
              {gazeFrame?.quality === "ok" && calibrationStage === "static" && " 2단계 고정점을 차례로 바라봐 주세요."}
            </div>
          )}
        </div>
      </div>
      {deviceError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40">
          {deviceError}
        </p>
      )}

      <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h3 className="font-medium">1. 시선 캘리브레이션</h3>
        <p className="mt-1 text-sm text-gray-500">
          시작 후 3초 동안 준비하고, +와 X 경로를 따라간 뒤 9개의 고정점을 차례로 바라봐 주세요. 측정이 끝나면 브라우저에서 작은 보정 모델을 학습합니다.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void startCalibration()}
            disabled={busy || gazeState !== "ready"}
            className="rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-gray-900"
          >
            {calibrationState === "running" ? "캘리브레이션 중…" : "캘리브레이션 시작"}
          </button>
          <button
            type="button"
            onClick={skipCalibration}
            disabled={deviceBusy}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
          >
            {calibrationState === "running" ? "중단" : "건너뛰기"}
          </button>
          {calibrationState === "success" && (
            <span className="text-sm text-emerald-600">
              완료
              {calibration?.validationErrorPx !== null && calibration?.validationErrorPx !== undefined
                ? " — 검증 평균 오차 " + Math.round(calibration.validationErrorPx) + "px"
                : ""}
              . 면접 중에는 왼쪽 가상 면접관의 눈을 바라보세요.
            </span>
          )}
          {calibrationState === "success" && calibration && (
            <div className="mt-2 flex w-full flex-col gap-1 text-xs text-gray-500">
              <span>
                수집 샘플: + {calibration.plusSamples} · X {calibration.xSamples} · 9-point {calibration.gridSamples}
                {" · 제외: + " + calibration.rejectedPlusSamples + " / X " + calibration.rejectedXSamples + " / 9-point " + calibration.rejectedGridSamples}
              </span>
              <span>
                검증 오차: + {formatCalibrationPx(calibration.plusValidationErrorPx)} · X {formatCalibrationPx(calibration.xValidationErrorPx)} · 9-point {formatCalibrationPx(calibration.gridValidationErrorPx)}
              </span>
              {calibration.gridPointErrors.length > 0 && (
                <span>
                  9-point 점별 검증: {calibration.gridPointErrors.map((point) => String(point.pointId + 1) + " " + formatCalibrationPx(point.meanErrorPx)).join(" · ")}
                </span>
              )}
            </div>
          )}
          {calibrationState === "failed" && (
            <span className="text-sm text-amber-600">{calibrationMessage ?? "시선 보정에 실패했습니다. 다시 시도하거나 건너뛰세요."}</span>
          )}
          {calibrationState === "skipped" && (
            <span className="text-sm text-gray-500">보정 없이 기본 시선값을 사용합니다.</span>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h3 className="font-medium">2. 마이크·STT 확인</h3>
        <p className="mt-1 text-sm text-gray-500">아래 문장을 읽어주세요.</p>
        <blockquote className="mt-2 rounded bg-gray-100 p-3 text-sm dark:bg-gray-800">
          “{TEST_SENTENCE}”
        </blockquote>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void toggleSttTest()}
            disabled={deviceState !== "ready" || busy && sttState !== "recording"}
            className={`rounded-md px-3 py-2 text-sm text-white disabled:opacity-40 ${
              sttState === "recording" ? "bg-red-600" : "bg-gray-900 dark:bg-white dark:text-gray-900"
            }`}
          >
            {sttState === "recording" ? "녹음 중지하고 확인" : "음성 테스트 시작"}
          </button>
          {sttState !== "success" && sttState !== "skipped" && (
            <button
              type="button"
              onClick={skipSttTest}
              disabled={
                deviceState !== "ready" ||
                sttState === "checking" ||
                calibrationState === "running"
              }
              className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
            >
              {sttState === "recording" ? "녹음 건너뛰기" : "STT 건너뛰기"}
            </button>
          )}
        </div>

        {sttState === "recording" && (
          <div
            className="mt-3 flex w-fit items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
            aria-live="polite"
          >
            <span className="flex items-center gap-2 font-medium">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
              녹음 중
            </span>
            <span className="flex h-6 items-end gap-1" aria-hidden="true">
              {[0.65, 0.85, 1, 0.8, 0.6].map((scale, index) => (
                <span
                  key={index}
                  className="w-1 rounded-full bg-current transition-[height] duration-75"
                  style={{ height: `${Math.max(4, Math.round(micLevel * scale * 24))}px` }}
                />
              ))}
            </span>
            <span className="text-xs opacity-75">마이크 입력</span>
          </div>
        )}

        {sttState === "checking" && <p className="mt-3 text-sm text-gray-500">음성을 확인하고 있습니다…</p>}
        {sttState === "review" && (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
            <p className="font-medium">음성 인식 결과</p>
            <output className="mt-2 block whitespace-pre-wrap rounded bg-white/70 p-2 dark:bg-gray-900/40">
              {sttTranscript}
            </output>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setSttState("success")}
                className="rounded bg-emerald-600 px-3 py-1.5 text-white"
              >
                잘 인식됐습니다
              </button>
              <button
                type="button"
                onClick={() => {
                  setSttTranscript(null);
                  setSttState("idle");
                }}
                className="rounded border border-gray-300 px-3 py-1.5 dark:border-gray-700"
              >
                다시 테스트
              </button>
            </div>
          </div>
        )}
        {sttState === "success" && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900/60 dark:bg-emerald-950/30">
            <p className="font-medium text-emerald-700 dark:text-emerald-300">STT 확인 완료</p>
            <output className="mt-2 block whitespace-pre-wrap rounded bg-white/70 p-2 text-gray-900 dark:bg-gray-900/40 dark:text-gray-100">
              {sttTranscript}
            </output>
          </div>
        )}
        {sttState === "skipped" && <p className="mt-3 text-sm text-gray-500">STT 확인을 건너뛰었습니다.</p>}
        {sttState === "failed" && <p className="mt-3 text-sm text-amber-600">{sttMessage}</p>}
      </section>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
        >
          이전
        </button>
        <button
          type="button"
          onClick={continueToInterview}
          disabled={deviceState !== "ready" || !calibrationDone || !sttDone || busy}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900"
        >
          설정 완료 · 면접 시작
        </button>
      </div>
    </div>
  );
}

function CalibrationPathOverlay({
  path,
  pathSegmentIndex,
  target,
  gridPointIndex,
  preview,
  guide,
  phase,
  countdown,
}: {
  path: CalibrationPath | null;
  pathSegmentIndex: number | null;
  target: GazePoint | null;
  gridPointIndex: number | null;
  preview: boolean;
  guide: CalibrationGuide;
  phase: CalibrationPhase;
  countdown: number | null;
}) {
  const isPhaseGuide = guide !== null;
  if (path === null && target === null && gridPointIndex === null && countdown === null && !preview && !isPhaseGuide) return null;
  const points = path ? calibrationPathPoints(path) : [];
  const dot = target ?? points[0] ?? { x: 0.5, y: 0.5 };
  const polyline = points.map((point) => String(point.x * 100) + "," + String(point.y * 100)).join(" ");
  const arrowStart = points[pathSegmentIndex ?? 0] ?? { x: 0.5, y: 0.5 };
  const arrowEnd = points[(pathSegmentIndex ?? 0) + 1] ?? arrowStart;
  const arrowDelta = { x: arrowEnd.x - arrowStart.x, y: arrowEnd.y - arrowStart.y };
  const arrowLength = Math.hypot(arrowDelta.x, arrowDelta.y) || 1;
  const arrowUnit = { x: arrowDelta.x / arrowLength, y: arrowDelta.y / arrowLength };
  const arrowOrigin = { x: arrowStart.x * 100, y: arrowStart.y * 100 };
  const arrowShaftStart = {
    x: arrowOrigin.x + arrowUnit.x * 4,
    y: arrowOrigin.y + arrowUnit.y * 4,
  };
  const arrowHeadBase = {
    x: arrowOrigin.x + arrowUnit.x * 6.2,
    y: arrowOrigin.y + arrowUnit.y * 6.2,
  };
  const arrowTip = {
    x: arrowOrigin.x + arrowUnit.x * 8,
    y: arrowOrigin.y + arrowUnit.y * 8,
  };
  const arrowHeadPoints = [
    arrowTip,
    { x: arrowHeadBase.x - arrowUnit.y * 1.9, y: arrowHeadBase.y + arrowUnit.x * 1.9 },
    { x: arrowHeadBase.x + arrowUnit.y * 1.9, y: arrowHeadBase.y - arrowUnit.x * 1.9 },
  ].map((point) => String(point.x) + "," + String(point.y)).join(" ");
  const showDirectionArrow = path !== null && pathSegmentIndex !== null && pathSegmentIndex % 2 === 0 && phase === "settle";
  const showGridInstruction =
    path === null &&
    gridPointIndex !== null &&
    (phase === "preview" || phase === "settle" || phase === "collecting");
  const instruction = guide === "moving"
    ? "1단계 · 움직이는 점을 끝까지 따라갔다가 중앙으로 되돌아옵니다"
    : guide === "static"
      ? "2단계 · 표시되는 고정점을 바라보고 잠시 시선을 유지하세요"
      : showDirectionArrow
        ? "이 방향으로 이동합니다"
        : showGridInstruction
          ? "표시된 점을 바라보세요"
          : null;
  const isBlinking = preview || isPhaseGuide;
  return (
    <div className="absolute inset-0 z-20" aria-label="+와 X 및 9-point 시선 캘리브레이션">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {points.length > 1 && (
          <polyline points={polyline} fill="none" stroke="rgb(148 163 184 / 0.22)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
        )}
        {showDirectionArrow && (
          <g aria-hidden="true">
            <line
              x1={String(arrowShaftStart.x)}
              y1={String(arrowShaftStart.y)}
              x2={String(arrowHeadBase.x)}
              y2={String(arrowHeadBase.y)}
              stroke="rgb(147 197 253 / 0.62)"
              strokeWidth="5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            <polygon points={arrowHeadPoints} fill="rgb(147 197 253 / 0.62)" />
          </g>
        )}
      </svg>
      <span
        className={
          "absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-blue-100 text-sm font-semibold text-white " +
          (isBlinking
            ? "bg-blue-400/35 blur-[2px] shadow-[0_0_18px_8px_rgba(96,165,250,0.55)] animate-pulse"
            : "bg-blue-500/85 shadow-lg shadow-blue-500/60")
        }
        style={{ left: String(dot.x * 100) + "%", top: String(dot.y * 100) + "%" }}
        aria-label={guide === "moving" ? "1단계 이동 경로 안내" : guide === "static" ? "2단계 고정점 안내" : preview ? "다음 9-point 미리보기" : countdown !== null ? "준비 " + countdown : gridPointIndex !== null ? "9-point " + String(gridPointIndex + 1) : "현재 시선 이동 위치"}
      >
        {isBlinking ? (
          <span className="h-3 w-3 animate-ping rounded-full bg-white/80" />
        ) : countdown !== null ? countdown : <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
      {instruction !== null && (
        <span
          className={
            "pointer-events-none absolute z-30 whitespace-nowrap rounded px-2 py-1 text-[11px] font-medium " +
            (isPhaseGuide ? "bg-slate-950/35 text-white/70" : "bg-slate-950/25 text-white/60")
          }
          style={{
            left: String(dot.x * 100) + "%",
            top: String(dot.y * 100) + "%",
            transform: "translate(-50%, calc(-100% - 10px))",
          }}
        >
          {instruction}
        </span>
      )}
    </div>
  );
}
function CalibrationStatus({
  path,
  pathSegmentIndex,
  phase,
  stage,
  countdown,
  progress,
  gridPointIndex,
  quality,
}: {
  path: CalibrationPath | null;
  pathSegmentIndex: number | null;
  phase: CalibrationPhase;
  stage: CalibrationStage;
  countdown: number | null;
  progress: number;
  gridPointIndex: number | null;
  quality: GazeQuality | null;
}) {
  const showInlineStatus = path === null && gridPointIndex === null;
  const showProgress = phase === "moving" || phase === "preview" || phase === "collecting" || phase === "training";
  const stageLabel = stage === "moving" ? "1 / 2 이동 경로" : stage === "static" ? "2 / 2 고정점" : null;
  if (path === null && countdown === null && gridPointIndex === null && phase === "idle") return null;
  if (!showInlineStatus && !showProgress) return null;
  const pathLabel = path === "plus" ? "+ 경로" : path === "x" ? "X 경로" : null;
  const pathStepLabel =
    path === null || pathSegmentIndex === null
      ? pathLabel
      : (pathLabel ?? "경로") + " " + String(pathSegmentIndex + 1) + "/" + String(calibrationPathPoints(path).length - 1);
  const gridLabel = gridPointIndex === null ? null : "9-point " + String(gridPointIndex + 1) + "/" + String(CALIBRATION_GRID_POINTS.length);
  let status: string;
  if (countdown !== null) status = "준비 " + countdown;
  else if (phase === "preview") status = "표시된 점을 바라볼 준비를 해주세요";
  else if (phase === "settle") {
    if (path !== null) {
      status = (pathStepLabel ?? "경로") + " · 화살표 방향으로 끝까지 갔다가 중앙으로 되돌아옵니다";
    } else {
      status = (gridLabel ?? "고정점") + " · 표시된 점을 바라보세요";
    }
  }
  else if (phase === "collecting") status = (gridLabel ?? "고정점") + " · 표시된 점에 시선을 고정해 주세요";
  else if (phase === "training") status = "보정 모델 학습 중";
  else if (phase === "retry") status = gazeQualityMessage(quality);
  else if (quality === "ok") {
    status = path !== null
      ? (pathStepLabel ?? "경로") + " · 표시된 방향으로 끝까지 이동해 주세요"
      : gazeQualityMessage(quality);
  }
  else status = gazeQualityMessage(quality);

  return (
    <div className="rounded-md bg-slate-950/35 px-3 py-2 text-center text-xs font-medium text-white/70" aria-live="polite">
      {showInlineStatus && <p>{status}</p>}
      {showProgress && (
        <div className="mt-2 flex items-center gap-2">
          {stageLabel !== null && <span className="shrink-0 text-[11px] text-slate-300">{stageLabel}</span>}
          <progress
            className="h-2 min-w-0 flex-1 accent-blue-500"
            max={100}
            value={Math.max(0, Math.min(100, progress))}
            aria-label={phase === "training" ? "MLP 학습 진행률" : gridPointIndex !== null ? "2단계 고정점 측정 진행률" : "1단계 이동 경로 측정 진행률"}
          />
          {showInlineStatus && <span className="font-normal text-slate-300">{Math.round(progress)}%</span>}
        </div>
      )}
    </div>
  );
}
