"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import GazeDebugOverlay from "@/components/GazeDebugOverlay";
import {
  createGazeCalibration,
  createBrowserGazeTracker,
  type BrowserGazeTracker,
  type GazeCalibrationSample,
  type GazeCalibration,
  type GazeDebugFrame,
  type GazePoint,
} from "@/lib/gaze";
import { transcribe } from "@/lib/api";
import { blobToWav16k, createRecorder, type AnswerRecorder } from "@/lib/recorder";

const TEST_SENTENCE = "안녕하세요. 지금부터 모의 면접을 시작하겠습니다.";
const CALIBRATION_MOVE_SPEED = 0.32;
const CALIBRATION_SETTLE_MS = 450;
const CALIBRATION_SAMPLE_MS = 900;
const CALIBRATION_TARGETS = [
  { key: "topLeft", label: "왼쪽 위", x: 10, y: 10 },
  { key: "topCenter", label: "위 중앙", x: 50, y: 10 },
  { key: "topRight", label: "오른쪽 위", x: 90, y: 10 },
  { key: "middleLeft", label: "왼쪽 중앙", x: 10, y: 50 },
  { key: "center", label: "화면 중앙", x: 50, y: 50 },
  { key: "middleRight", label: "오른쪽 중앙", x: 90, y: 50 },
  { key: "bottomLeft", label: "왼쪽 아래", x: 10, y: 90 },
  { key: "bottomCenter", label: "아래 중앙", x: 50, y: 90 },
  { key: "bottomRight", label: "오른쪽 아래", x: 90, y: 90 },
] as const;

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export interface DeviceSetupResult {
  stream: MediaStream;
  calibration: GazeCalibration | null;
}

type CalibrationState = "idle" | "running" | "success" | "failed" | "skipped";
type CalibrationPhase = "idle" | "to-target" | "target" | "to-center";
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
  const [calibrationPosition, setCalibrationPosition] = useState({ x: 50, y: 50 });
  const [calibrationCountdown, setCalibrationCountdown] = useState<number | null>(null);
  const [calibrationTargetIndex, setCalibrationTargetIndex] = useState<number | null>(null);
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
  const calibrationCollectingRef = useRef(false);
  const transferredRef = useRef(false);
  const disposedRef = useRef(false);

  const onGazeFrame = useCallback((frame: GazeDebugFrame) => {
    setGazeFrame(frame);
    const target = calibrationTargetRef.current;
    if (calibrationCollectingRef.current && target && frame.gaze) {
      calibrationSamplesRef.current.push({ gaze: frame.gaze, target });
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
    setCalibrationPosition({ x: 50, y: 50 });
    setCalibrationCountdown(null);
    setCalibrationTargetIndex(null);
    calibrationTargetRef.current = null;
    calibrationSamplesRef.current = [];
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
        video: nextCameraId ? { deviceId: { exact: nextCameraId } } : true,
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
      return;
    }
    const run = calibrationRunRef.current + 1;
    calibrationRunRef.current = run;
    setCalibration(null);
    setCalibrationState("running");
    setCalibrationPhase("to-target");
    calibrationSamplesRef.current = [];
    calibrationCollectingRef.current = false;
    setCalibrationTargetIndex(0);
    const centerPoint = { x: 0.5, y: 0.5 };
    calibrationTargetRef.current = null;
    setCalibrationPosition({ x: 50, y: 50 });

    for (let count = 3; count >= 1; count -= 1) {
      if (calibrationRunRef.current !== run) return;
      setCalibrationCountdown(count);
      await wait(1000);
    }
    setCalibrationCountdown(null);
    tracker.start();

    const moveTo = async (from: GazePoint, to: GazePoint): Promise<boolean> => {
      const distance = Math.hypot(to.x - from.x, to.y - from.y);
      const duration = (distance / CALIBRATION_MOVE_SPEED) * 1000;
      const moveStarted = performance.now();
      while (true) {
        if (calibrationRunRef.current !== run) return false;
        const progress = duration
          ? Math.min(1, (performance.now() - moveStarted) / duration)
          : 1;
        const point = {
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
        };
        setCalibrationPosition({ x: point.x * 100, y: point.y * 100 });
        if (progress >= 1) return true;
        await wait(16);
      }
    };

    for (let index = 0; index < CALIBRATION_TARGETS.length; index += 1) {
      if (calibrationRunRef.current !== run) return;
      const target = CALIBRATION_TARGETS[index];
      const targetPoint = { x: target.x / 100, y: target.y / 100 };
      setCalibrationTargetIndex(index);
      setCalibrationPhase("to-target");
      calibrationTargetRef.current = null;
      if (!(await moveTo(centerPoint, targetPoint))) return;

      calibrationTargetRef.current = targetPoint;
      setCalibrationPhase("target");
      setCalibrationPosition({ x: target.x, y: target.y });
      await wait(CALIBRATION_SETTLE_MS);
      if (calibrationRunRef.current !== run) return;
      calibrationCollectingRef.current = true;
      await wait(CALIBRATION_SAMPLE_MS);
      calibrationCollectingRef.current = false;
      if (calibrationRunRef.current !== run) return;

      setCalibrationPhase("to-center");
      calibrationTargetRef.current = null;
      if (!(await moveTo(targetPoint, centerPoint))) return;
      setCalibrationPosition({ x: 50, y: 50 });
      await wait(CALIBRATION_SETTLE_MS);
    }

    calibrationTargetRef.current = null;
    if (calibrationRunRef.current !== run) return;
    const nextCalibration = createGazeCalibration(calibrationSamplesRef.current);
    setCalibrationTargetIndex(null);
    setCalibrationPhase("idle");
    if (!nextCalibration) {
      setCalibrationState("failed");
      return;
    }
    tracker.setCalibration(nextCalibration);
    tracker.start();
    setCalibration(nextCalibration);
    setCalibrationState("success");
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
  const busy =
    deviceState === "loading" ||
    calibrationState === "running" ||
    sttState === "recording" ||
    sttState === "checking";
  const calibrationTarget =
    calibrationTargetIndex === null
      ? null
      : CALIBRATION_TARGETS[calibrationTargetIndex];

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
            idleLabel={gazeState === "loading" ? "시선 분석 준비 중" : "시선 분석 사용 불가"}
          />
        )}
        {calibrationState === "running" && calibrationCountdown !== null && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-7xl font-bold text-white">
            {calibrationCountdown}
          </div>
        )}
        {calibrationState === "running" && calibrationTarget && (
          <div className="pointer-events-none absolute inset-0">
            <span
              className="absolute h-7 w-7 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-4 border-white bg-blue-500 shadow-lg shadow-blue-500/60"
              style={{
                left: `${calibrationPosition.x}%`,
                top: `${calibrationPosition.y}%`,
              }}
            />
            <p className="absolute inset-x-0 bottom-3 mx-auto w-fit rounded bg-black/70 px-3 py-2 text-sm font-medium text-white">
              {calibrationPhase === "to-center" ? "중앙으로 돌아가세요" : "파란 점을 천천히 따라가세요"} · {calibrationTarget.label} ({calibrationTargetIndex! + 1}/9)
            </p>
          </div>
        )}
      </div>

      {deviceError && (
        <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40">
          {deviceError}
        </p>
      )}

      <section className="rounded-lg border border-gray-200 p-4 dark:border-gray-800">
        <h3 className="font-medium">1. 시선 캘리브레이션</h3>
        <p className="mt-1 text-sm text-gray-500">
          3·2·1 카운트다운 후 3×3 아홉 점을 하나씩 중앙에서 출발해 갔다가 다시 중앙으로 돌아옵니다. 점을 천천히 따라 바라보세요.
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
            onClick={() => {
              calibrationRunRef.current += 1;
              setCalibration(null);
              setCalibrationCountdown(null);
              setCalibrationTargetIndex(null);
              setCalibrationPhase("idle");
              calibrationTargetRef.current = null;
              calibrationCollectingRef.current = false;
              setCalibrationState("skipped");
            }}
            disabled={busy}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
          >
            건너뛰기
          </button>
          {calibrationState === "success" && (
            <span className="text-sm text-emerald-600">완료 — 9점 중앙 왕복 샘플 기반 화면 좌표 보정을 적용합니다.</span>
          )}
          {calibrationState === "failed" && (
            <span className="text-sm text-amber-600">시선 샘플이 부족하거나 불안정합니다. 다시 시도하거나 건너뛰세요.</span>
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
