"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GazeDebugOverlay from "@/components/GazeDebugOverlay";
import InterviewerStage from "@/components/InterviewerStage";
import {
  CALIBRATION_PATH_DURATION_MS,
  CALIBRATION_TARGET_DELAY_MS,
  calibrationPathPoint,
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
import { transcribe } from "@/lib/api";
import { blobToWav16k, createRecorder, type AnswerRecorder } from "@/lib/recorder";
const CAN_DEBUG_GAZE = process.env.NODE_ENV !== "production";

const TEST_SENTENCE = "안녕하세요. 지금부터 모의 면접을 시작하겠습니다.";
const CALIBRATION_START_COUNTDOWN_SEC = 5;
const CALIBRATION_PATH_SETTLE_MS = 800;
const CALIBRATION_MIN_SAMPLES = 120;
const CALIBRATION_PATHS: readonly CalibrationPath[] = ["plus", "x"];

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

export interface DeviceSetupResult {
  stream: MediaStream;
  calibration: GazeCalibration | null;
}

type CalibrationState = "idle" | "running" | "success" | "failed" | "skipped";
type CalibrationPhase = "idle" | "countdown" | "settle" | "moving" | "training" | "retry";
type SttState = "idle" | "recording" | "checking" | "review" | "success" | "failed" | "skipped";

export default function DeviceSetupView({
  onReady,
  onCancel,
}: {
  onReady: (result: DeviceSetupResult) => void;
  onCancel: () => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [microphoneId, setMicrophoneId] = useState("");
  const [deviceState, setDeviceState] = useState<"loading" | "ready" | "failed">("loading");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [gazeState, setGazeState] = useState<"loading" | "ready" | "failed">("loading");
  const [gazeFrame, setGazeFrame] = useState<GazeDebugFrame | null>(null);
  const [calibrationState, setCalibrationState] = useState<CalibrationState>("idle");
  const [calibrationPhase, setCalibrationPhase] = useState<CalibrationPhase>("idle");
  const [calibration, setCalibration] = useState<GazeCalibration | null>(null);
  const [calibrationCountdown, setCalibrationCountdown] = useState<number | null>(null);
  const [calibrationPath, setCalibrationPath] = useState<CalibrationPath | null>(null);
  const [calibrationTarget, setCalibrationTarget] = useState<GazePoint | null>(null);
  const [calibrationProgress, setCalibrationProgress] = useState(0);
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(null);
  const [sttState, setSttState] = useState<SttState>("idle");
  const [sttTranscript, setSttTranscript] = useState("");
  const [sttMessage, setSttMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gazeTrackerRef = useRef<BrowserGazeTracker | null>(null);
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const calibrationRunRef = useRef(0);
  const calibrationSamplesRef = useRef<GazeCalibrationSample[]>([]);
  const calibrationTargetHistoryRef = useRef<CalibrationTargetHistoryEntry[]>([]);
  const calibrationCollectingRef = useRef(false);
  const calibrationAnimationRef = useRef<number | null>(null);
  const calibrationCancelRef = useRef<(() => void) | null>(null);
  const latestGazeQualityRef = useRef<GazeQuality | null>(null);
  const transferredRef = useRef(false);
  const disposedRef = useRef(false);

  const onGazeFrame = useCallback((frame: GazeDebugFrame) => {
    setGazeFrame(frame);
    latestGazeQualityRef.current = frame.quality;
    const target = calibrationTargetAt(
      calibrationTargetHistoryRef.current,
      performance.now() - CALIBRATION_TARGET_DELAY_MS,
    );
    if (calibrationCollectingRef.current && target && frame.gaze) {
      calibrationSamplesRef.current.push({
        gaze: frame.gaze,
        target,
        eyeWidthPx: frame.eyeWidthPx ?? undefined,
      });
    }
  }, []);

  const configureDevices = useCallback(async (nextCameraId = "", nextMicrophoneId = "") => {
    setDeviceState("loading");
    setDeviceError(null);
    setGazeState("loading");
    setGazeFrame(null);
    calibrationRunRef.current += 1;
    setCalibration(null);
    setCalibrationState("idle");
    setCalibrationPhase("idle");
    setCalibrationCountdown(null);
    setCalibrationPath(null);
    setCalibrationTarget(null);
    setCalibrationProgress(0);
    setCalibrationMessage(null);
    calibrationSamplesRef.current = [];
    calibrationTargetHistoryRef.current = [];
    calibrationCancelRef.current?.();
    calibrationCancelRef.current = null;
    calibrationCollectingRef.current = false;
    latestGazeQualityRef.current = null;
    if (calibrationAnimationRef.current !== null) {
      cancelAnimationFrame(calibrationAnimationRef.current);
      calibrationAnimationRef.current = null;
    }
    setSttState("idle");
    setSttTranscript("");
    setSttMessage(null);
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
        audio: nextMicrophoneId ? { deviceId: { exact: nextMicrophoneId } } : true,
      });
      if (disposedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      streamRef.current = stream;
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
  }, [onGazeFrame]);

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
      gazeTrackerRef.current?.close();
      gazeTrackerRef.current = null;
      if (!transferredRef.current) {
        streamRef.current?.getTracks().forEach((track) => track.stop());
      }
    };
  }, [configureDevices]);

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
    setCalibrationPath(null);
    setCalibrationTarget(null);
    setCalibrationProgress(0);
    calibrationSamplesRef.current = [];
    calibrationTargetHistoryRef.current = [];
    calibrationCollectingRef.current = false;
    tracker.setCalibration(undefined);

    for (let count = CALIBRATION_START_COUNTDOWN_SEC; count >= 1; count -= 1) {
      if (calibrationRunRef.current !== run) return;
      setCalibrationCountdown(count);
      await wait(1000);
    }
    setCalibrationCountdown(null);

    for (let pathIndex = 0; pathIndex < CALIBRATION_PATHS.length; pathIndex += 1) {
      if (calibrationRunRef.current !== run) return;
      const path = CALIBRATION_PATHS[pathIndex];
      const initialTarget = calibrationPathPoint(path, 0);
      setCalibrationPath(path);
      setCalibrationTarget(initialTarget);
      setCalibrationProgress((pathIndex / CALIBRATION_PATHS.length) * 100);
      setCalibrationPhase("settle");
      calibrationTargetHistoryRef.current = [
        { at: performance.now(), target: initialTarget },
      ];
      await wait(CALIBRATION_PATH_SETTLE_MS);
      if (calibrationRunRef.current !== run) return;

      calibrationCollectingRef.current = true;
      setCalibrationPhase("moving");
      const completed = await new Promise<boolean>((resolve) => {
        calibrationCancelRef.current = () => resolve(false);
        let activeElapsed = 0;
        let previousAt = performance.now();
        const animate = (now: number) => {
          if (calibrationRunRef.current !== run) {
            resolve(false);
            return;
          }
          const delta = Math.min(100, Math.max(0, now - previousAt));
          previousAt = now;
          if (latestGazeQualityRef.current === "ok") activeElapsed += delta;
          const progress = Math.min(1, activeElapsed / CALIBRATION_PATH_DURATION_MS);
          const target = calibrationPathPoint(path, progress);
          setCalibrationTarget(target);
          calibrationTargetHistoryRef.current.push({ at: now, target });
          const cutoff = now - CALIBRATION_TARGET_DELAY_MS - 1000;
          while (
            calibrationTargetHistoryRef.current.length > 1 &&
            calibrationTargetHistoryRef.current[0].at < cutoff
          ) {
            calibrationTargetHistoryRef.current.shift();
          }
          setCalibrationProgress(
            ((pathIndex + progress) / CALIBRATION_PATHS.length) * 100,
          );
          if (progress >= 1) {
            resolve(true);
            return;
          }
          calibrationAnimationRef.current = requestAnimationFrame(animate);
        };
        calibrationAnimationRef.current = requestAnimationFrame(animate);
      });
      calibrationCancelRef.current = null;
      calibrationAnimationRef.current = null;
      calibrationCollectingRef.current = false;
      if (!completed || calibrationRunRef.current !== run) return;
    }

    calibrationTargetHistoryRef.current = [];
    setCalibrationTarget(null);
    setCalibrationPath(null);
    if (calibrationRunRef.current !== run) return;
    if (calibrationSamplesRef.current.length < CALIBRATION_MIN_SAMPLES) {
      setCalibrationPhase("idle");
      setCalibrationState("failed");
      setCalibrationMessage(
        `보정에 사용할 유효 시선 프레임이 ${CALIBRATION_MIN_SAMPLES}개 미만입니다. 카메라 화면의 안내를 확인한 뒤 다시 시도해 주세요.`,
      );
      return;
    }

    setCalibrationPhase("training");
    const nextCalibration = await createGazeCalibration(
      calibrationSamplesRef.current,
      {
        onProgress: setCalibrationProgress,
        shouldCancel: () => calibrationRunRef.current !== run,
      },
    );
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
  }
  async function toggleSttTest() {
    const stream = streamRef.current;
    if (!stream) return;

    if (sttState !== "recording") {
      try {
        const recorder = createRecorder(stream);
        recorderRef.current = recorder;
        setSttTranscript("");
        setSttMessage(null);
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
        setSttState("failed");
        setSttMessage(
          result.status === "not_configured"
            ? "STT가 설정되지 않았습니다. 건너뛰고 면접을 진행할 수 있습니다."
            : result.error ?? "음성이 인식되지 않았습니다.",
        );
      }
    } catch (error) {
      setSttState("failed");
      setSttMessage(
        "STT 확인에 실패했습니다. 건너뛰고 면접을 진행할 수 있습니다. " +
          (error instanceof Error ? `(${error.message})` : ""),
      );
    }
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
    setCalibrationPath(null);
    setCalibrationTarget(null);
    setCalibrationProgress(0);
    setCalibrationMessage(null);
    setCalibrationPhase("idle");
    calibrationTargetHistoryRef.current = [];
    calibrationCollectingRef.current = false;
    latestGazeQualityRef.current = null;
    setCalibrationState("skipped");
  }
  function continueToInterview() {
    const stream = streamRef.current;
    if (!stream) return;
    transferredRef.current = true;
    gazeTrackerRef.current?.close();
    gazeTrackerRef.current = null;
    onReady({ stream, calibration });
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

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="flex min-w-0 flex-col gap-2 lg:items-center">
          <InterviewerStage
            className="w-full max-w-full lg:max-w-[50vw]"
            showLabel={calibrationState !== "running"}
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
              target={calibrationTarget}
              countdown={calibrationCountdown}
            />
          </InterviewerStage>
          <div className="w-full max-w-full lg:max-w-[50vw]">
            <CalibrationStatus
              path={calibrationPath}
              phase={calibrationPhase}
              countdown={calibrationCountdown}
              progress={calibrationProgress}
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
              {gazeFrame?.quality === "ok" && " 화면의 경로를 따라 시선을 천천히 이동해 주세요."}
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
          시작 후 5초 동안 준비하고, 화면에 표시되는 +와 X 경로를 시선을 따라 천천히 이동해 주세요. 측정이 끝나면 브라우저에서 작은 보정 모델을 학습합니다.
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
              완료 — 면접 중에는 왼쪽 가상 면접관의 눈을 바라보세요.
            </span>
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
          {(sttState === "failed" || sttState === "review") && (
            <button
              type="button"
              onClick={() => setSttState("skipped")}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700"
            >
              STT 건너뛰기
            </button>
          )}
        </div>

        {sttState === "checking" && <p className="mt-3 text-sm text-gray-500">음성을 확인하고 있습니다…</p>}
        {sttState === "review" && (
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950/30">
            <p className="text-gray-500">인식 결과</p>
            <p className="mt-1">{sttTranscript}</p>
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
                onClick={() => setSttState("idle")}
                className="rounded border border-gray-300 px-3 py-1.5 dark:border-gray-700"
              >
                다시 테스트
              </button>
            </div>
          </div>
        )}
        {sttState === "success" && <p className="mt-3 text-sm text-emerald-600">STT 확인 완료</p>}
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
  target,
  countdown,
}: {
  path: CalibrationPath | null;
  target: GazePoint | null;
  countdown: number | null;
}) {
  if (path === null && countdown === null) return null;
  const points = path ? calibrationPathPoints(path) : [{ x: 0.5, y: 0.5 }];
  const dot = target ?? points[0];
  const polyline = points.map((point) => `${point.x * 100},${point.y * 100}`).join(" ");

  return (
    <div className="absolute inset-0 z-20" aria-label="+와 X 시선 캘리브레이션">
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        <polyline points={polyline} fill="none" stroke="rgb(148 163 184 / 0.45)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      </svg>
      <span
        className="absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-blue-100 bg-blue-500/85 text-sm font-semibold text-white shadow-lg shadow-blue-500/60"
        style={{ left: `${dot.x * 100}%`, top: `${dot.y * 100}%` }}
        aria-label={countdown !== null ? `준비 ${countdown}` : "현재 시선 이동 위치"}
      >
        {countdown !== null ? countdown : <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
    </div>
  );
}

function CalibrationStatus({
  path,
  phase,
  countdown,
  progress,
  quality,
}: {
  path: CalibrationPath | null;
  phase: CalibrationPhase;
  countdown: number | null;
  progress: number;
  quality: GazeQuality | null;
}) {
  if (path === null && countdown === null && phase === "idle") return null;
  const pathLabel = path === "plus" ? "+ 경로" : path === "x" ? "X 경로" : null;
  const status =
    countdown !== null
      ? `준비 ${countdown}`
      : phase === "settle"
        ? `${pathLabel ?? "경로"} 시작 준비`
        : phase === "training"
          ? "보정 모델 학습 중"
          : phase === "retry"
            ? gazeQualityMessage(quality)
            : quality === "ok"
              ? `${pathLabel ?? "경로"}를 따라 천천히 이동해 주세요`
              : gazeQualityMessage(quality);

  return (
    <div
      className="rounded-md bg-slate-950/80 px-3 py-2 text-center text-xs font-medium text-white"
      aria-live="polite"
    >
      <p>{status}</p>
      {(phase === "moving" || phase === "training") && (
        <div className="mt-2 flex items-center gap-2">
          <progress
            className="h-2 min-w-0 flex-1 accent-blue-500"
            max={100}
            value={Math.max(0, Math.min(100, progress))}
            aria-label={phase === "training" ? "MLP 학습 진행률" : "경로 측정 진행률"}
          />
          <span className="font-normal text-slate-300">{Math.round(progress)}%</span>
        </div>
      )}
    </div>
  );
}
