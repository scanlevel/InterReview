"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GazeDebugOverlay from "@/components/GazeDebugOverlay";
import InterviewerStage from "@/components/InterviewerStage";
import {
  createGazeCalibration,
  createBrowserGazeTracker,
  type BrowserGazeTracker,
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
const CALIBRATION_SETTLE_MS = 450;
const CALIBRATION_TARGET_TIMEOUT_MS = 2500;
const CALIBRATION_SAMPLE_GOAL = 12;
const CALIBRATION_MIN_SAMPLES = 8;
const CALIBRATION_MAX_RETRIES = 2;
const CALIBRATION_TARGETS = [
  { key: "center", label: "화면 중앙", x: 50, y: 50 },
  { key: "topLeft", label: "왼쪽 위", x: 10, y: 10 },
  { key: "topCenter", label: "위 중앙", x: 50, y: 10 },
  { key: "topRight", label: "오른쪽 위", x: 90, y: 10 },
  { key: "middleLeft", label: "왼쪽 중앙", x: 10, y: 50 },
  { key: "middleRight", label: "오른쪽 중앙", x: 90, y: 50 },
  { key: "bottomLeft", label: "왼쪽 아래", x: 10, y: 90 },
  { key: "bottomCenter", label: "아래 중앙", x: 50, y: 90 },
  { key: "bottomRight", label: "오른쪽 아래", x: 90, y: 90 },
] as const;

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
type CalibrationPhase = "idle" | "countdown" | "settle" | "collecting" | "retry";
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
  const [calibrationTargetIndex, setCalibrationTargetIndex] = useState<number | null>(null);
  const [calibrationSampleCount, setCalibrationSampleCount] = useState(0);
  const [calibrationMessage, setCalibrationMessage] = useState<string | null>(null);
  const [sttState, setSttState] = useState<SttState>("idle");
  const [sttTranscript, setSttTranscript] = useState("");
  const [sttMessage, setSttMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const gazeTrackerRef = useRef<BrowserGazeTracker | null>(null);
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const calibrationRunRef = useRef(0);
  const calibrationTargetRef = useRef<GazePoint | null>(null);
  const calibrationSamplesRef = useRef<GazeCalibrationSample[]>([]);
  const calibrationTargetSamplesRef = useRef<GazeCalibrationSample[]>([]);
  const calibrationSampleCountRef = useRef(0);
  const calibrationCollectingRef = useRef(false);
  const transferredRef = useRef(false);
  const disposedRef = useRef(false);

  const onGazeFrame = useCallback((frame: GazeDebugFrame) => {
    setGazeFrame(frame);
    const target = calibrationTargetRef.current;
    if (calibrationCollectingRef.current && target && frame.gaze) {
      calibrationTargetSamplesRef.current.push({
        gaze: frame.gaze,
        target,
        eyeWidthPx: frame.eyeWidthPx ?? undefined,
      });
      calibrationSampleCountRef.current = calibrationTargetSamplesRef.current.length;
      setCalibrationSampleCount(calibrationSampleCountRef.current);
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
    setCalibrationTargetIndex(null);
    setCalibrationSampleCount(0);
    setCalibrationMessage(null);
    calibrationTargetRef.current = null;
    calibrationSamplesRef.current = [];
    calibrationTargetSamplesRef.current = [];
    calibrationSampleCountRef.current = 0;
    calibrationCollectingRef.current = false;
    setSttState("idle");
    setSttTranscript("");
    setSttMessage(null);
    recorderRef.current = null;

    gazeTrackerRef.current?.close();
    gazeTrackerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());

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
    calibrationSamplesRef.current = [];
    calibrationTargetSamplesRef.current = [];
    calibrationSampleCountRef.current = 0;
    calibrationCollectingRef.current = false;
    setCalibrationSampleCount(0);
    setCalibrationTargetIndex(0);
    calibrationTargetRef.current = null;
    tracker.setCalibration(undefined);

    for (let count = 3; count >= 1; count -= 1) {
      if (calibrationRunRef.current !== run) return;
      setCalibrationCountdown(count);
      await wait(1000);
    }
    setCalibrationCountdown(null);

    for (let index = 0; index < CALIBRATION_TARGETS.length; index += 1) {
      if (calibrationRunRef.current !== run) return;
      const target = CALIBRATION_TARGETS[index];
      const targetPoint = { x: target.x / 100, y: target.y / 100 };
      let targetComplete = false;
      let targetAttempts = 0;

      while (!targetComplete && targetAttempts <= CALIBRATION_MAX_RETRIES) {
        targetAttempts += 1;
        if (calibrationRunRef.current !== run) return;
        setCalibrationTargetIndex(index);
        setCalibrationSampleCount(0);
        calibrationSampleCountRef.current = 0;
        calibrationTargetSamplesRef.current = [];
        calibrationTargetRef.current = targetPoint;
        calibrationCollectingRef.current = false;
        setCalibrationPhase("settle");
        await wait(CALIBRATION_SETTLE_MS);
        if (calibrationRunRef.current !== run) return;

        calibrationCollectingRef.current = true;
        setCalibrationPhase("collecting");
        const deadline = performance.now() + CALIBRATION_TARGET_TIMEOUT_MS;
        while (
          calibrationSampleCountRef.current < CALIBRATION_SAMPLE_GOAL &&
          performance.now() < deadline
        ) {
          if (calibrationRunRef.current !== run) return;
          await wait(50);
        }
        calibrationCollectingRef.current = false;
        if (calibrationRunRef.current !== run) return;

        if (calibrationSampleCountRef.current < CALIBRATION_MIN_SAMPLES) {
          if (targetAttempts > CALIBRATION_MAX_RETRIES) {
            calibrationTargetRef.current = null;
            calibrationTargetSamplesRef.current = [];
            setCalibrationPhase("idle");
            setCalibrationState("failed");
            setCalibrationMessage(
              `${target.label}에서 시선 프레임을 충분히 확보하지 못했습니다. 카메라 화면의 안내를 확인한 뒤 다시 시도해 주세요.`,
            );
            return;
          }
          setCalibrationPhase("retry");
          setCalibrationMessage(
            `${target.label}에서 보정에 사용할 프레임이 ${CALIBRATION_MIN_SAMPLES}개 미만입니다. 카메라 안내를 확인한 뒤 같은 칸을 다시 바라보세요.`,
          );
          await wait(900);
          continue;
        }

        calibrationSamplesRef.current.push(...calibrationTargetSamplesRef.current);
        targetComplete = true;
      }
    }

    calibrationTargetRef.current = null;
    calibrationTargetSamplesRef.current = [];
    if (calibrationRunRef.current !== run) return;
    const nextCalibration = createGazeCalibration(calibrationSamplesRef.current);
    setCalibrationTargetIndex(null);
    setCalibrationPhase("idle");
    if (!nextCalibration) {
      setCalibrationState("failed");
      setCalibrationMessage(
        "9개 칸의 시선 범위를 충분히 구분하지 못했습니다. 조명과 얼굴 위치를 확인한 뒤 다시 측정해 주세요.",
      );
      return;
    }
    tracker.setCalibration(nextCalibration);
    setCalibration(nextCalibration);
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
    setCalibration(null);
    setCalibrationCountdown(null);
    setCalibrationTargetIndex(null);
    setCalibrationSampleCount(0);
    setCalibrationMessage(null);
    setCalibrationPhase("idle");
    calibrationTargetRef.current = null;
    calibrationTargetSamplesRef.current = [];
    calibrationSampleCountRef.current = 0;
    calibrationCollectingRef.current = false;
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

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <InterviewerStage showLabel={calibrationState !== "running"}>
            <CalibrationGrid
              activeIndex={calibrationTargetIndex}
              countdown={calibrationCountdown}
            />
          </InterviewerStage>
          <CalibrationStatus
            activeIndex={calibrationTargetIndex}
            phase={calibrationPhase}
            countdown={calibrationCountdown}
            sampleCount={calibrationSampleCount}
            quality={gazeFrame?.quality ?? null}
          />
        </div>
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full -scale-x-100 object-cover"
          />
          {calibrationState !== "running" && (
            <GazeDebugOverlay
              active={gazeState === "ready"}
              frame={gazeFrame}
              verbose={CAN_DEBUG_GAZE}
              idleLabel={gazeState === "loading" ? "시선 분석 준비 중" : "시선 분석 사용 불가"}
            />
          )}
          {calibrationState === "running" && (
            <div className="absolute inset-x-3 bottom-3 rounded-md bg-slate-950/75 px-3 py-2 text-center text-xs text-slate-100">
              {gazeQualityMessage(gazeFrame?.quality ?? null)}
              {gazeFrame?.quality === "ok" && " 왼쪽의 강조된 칸을 바라보세요."}
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
          왼쪽 면접관 화면의 3×3 격자에서 강조된 칸을 바라봐 주세요. 점은 이동하지 않고, 각 칸에서 충분한 시선 샘플이 모일 때까지 유지됩니다.
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
        <p className="mt-1 text-sm text-gray-500">
          아래 문장을 읽어 확인할 수 있습니다. 테스트하지 않아도 면접을 시작할 수 있습니다.
        </p>
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
          disabled={deviceState !== "ready" || !calibrationDone || busy}
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900"
        >
          설정 완료 · 면접 시작
        </button>
      </div>
    </div>
  );
}

function CalibrationGrid({
  activeIndex,
  countdown,
}: {
  activeIndex: number | null;
  countdown: number | null;
}) {
  if (activeIndex === null && countdown === null) return null;

  return (
    <div className="absolute inset-0 z-20" aria-label="3×3 시선 캘리브레이션">
      <div className="absolute inset-[10%] border border-slate-300/25">
        <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-slate-300/20" />
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-slate-300/20" />
      </div>
      {CALIBRATION_TARGETS.map((target, index) => {
        const active = index === activeIndex;
        const complete = activeIndex !== null && index < activeIndex;
        return (
          <span
            key={target.key}
            className={`absolute flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border transition-colors ${
              active
                ? "h-8 w-8 border-blue-100 bg-blue-500/80 shadow-lg shadow-blue-500/60"
                : complete
                  ? "border-emerald-200/70 bg-emerald-400/70"
                  : "border-slate-200/70 bg-slate-500/60"
            }`}
            style={{ left: `${target.x}%`, top: `${target.y}%` }}
            aria-label={`${target.label}${active ? " 측정 중" : complete ? " 완료" : " 대기"}`}
          >
            {active && <span className="h-2 w-2 rounded-full bg-white" />}
          </span>
        );
      })}
    </div>
  );
}

function CalibrationStatus({
  activeIndex,
  phase,
  countdown,
  sampleCount,
  quality,
}: {
  activeIndex: number | null;
  phase: CalibrationPhase;
  countdown: number | null;
  sampleCount: number;
  quality: GazeQuality | null;
}) {
  if (activeIndex === null && countdown === null) return null;
  const activeTarget = activeIndex === null ? null : CALIBRATION_TARGETS[activeIndex];
  const status =
    countdown !== null
      ? `준비 ${countdown}`
      : phase === "settle"
        ? "시선을 고정해 주세요"
        : phase === "retry"
          ? `${gazeQualityMessage(quality)} 같은 칸을 다시 바라보세요`
          : quality === "ok"
            ? "시선을 고정해 주세요"
            : gazeQualityMessage(quality);

  return (
    <div
      className="rounded-md bg-slate-950/80 px-3 py-2 text-center text-xs font-medium text-white"
      aria-live="polite"
    >
      <p>{status}{activeTarget ? ` · ${activeTarget.label} (${activeIndex! + 1}/9)` : ""}</p>
      {activeTarget && phase !== "settle" && phase !== "retry" && (
        <p className="mt-1 font-normal text-slate-300">
          보정 사용 프레임 {sampleCount}/{CALIBRATION_SAMPLE_GOAL}
        </p>
      )}
    </div>
  );
}
