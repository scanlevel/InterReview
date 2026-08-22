"use client";

import { useEffect, useRef, useState } from "react";
import { transcribe } from "@/lib/api";
import {
  createBrowserGazeTracker,
  type BrowserGazeTracker,
  type GazeCalibration,
  type GazeDebugFrame,
} from "@/lib/gaze";
import {
  addTranscriptRate,
  blobToWav16kWithMetrics,
  createRecorder,
  type AnswerRecorder,
} from "@/lib/recorder";
import type {
  AnswerItem,
  EyeTrackingSummary,
  Question,
  SpeechMetrics,
  SttStatus,
} from "@/lib/types";
import GazeDebugOverlay from "@/components/GazeDebugOverlay";

function seconds(value: number): string {
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

export default function InterviewView({
  questions,
  stream,
  calibration,
  onFinish,
}: {
  questions: Question[];
  stream: MediaStream;
  calibration: GazeCalibration | null;
  onFinish: (answers: AnswerItem[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [sttStates, setSttStates] = useState<
    Record<string, { status: SttStatus; error: string | null }>
  >({});
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [gazeStatus, setGazeStatus] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [eyeTracking, setEyeTracking] = useState<
    Record<string, EyeTrackingSummary | null>
  >({});
  const [speechMetrics, setSpeechMetrics] = useState<
    Record<string, SpeechMetrics | null>
  >({});
  const [debugGaze, setDebugGaze] = useState(false);
  const canDebugGaze = process.env.NODE_ENV !== "production";
  const [gazeDebugFrame, setGazeDebugFrame] =
    useState<GazeDebugFrame | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const recorderRef = useRef<AnswerRecorder | null>(null);
  const gazeTrackerRef = useRef<BrowserGazeTracker | null>(null);
  const debugGazeRef = useRef(false);

  const question = questions[index];
  const isLast = index === questions.length - 1;
  const current = transcripts[question.question_id] ?? "";
  const currentMetrics = speechMetrics[question.question_id] ?? null;

  useEffect(() => {
    if (!isRecording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds((value) => value + 0.25);
    }, 250);
    return () => window.clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    let cancelled = false;
    let gazeTracker: BrowserGazeTracker | null = null;
    (async () => {
      try {
        recorderRef.current = createRecorder(stream);
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          try {
            gazeTracker = await createBrowserGazeTracker(
              videoRef.current,
              (frame) => {
                if (debugGazeRef.current) setGazeDebugFrame(frame);
              },
              calibration ?? undefined,
            );
            if (cancelled) {
              gazeTracker.close();
              return;
            }
            gazeTrackerRef.current = gazeTracker;
            setGazeStatus("ready");
          } catch {
            if (!cancelled) setGazeStatus("unavailable");
          }
        }
        setMediaError(null);
      } catch (error) {
        if (!cancelled) {
          setGazeStatus("unavailable");
          setMediaError(
            "카메라·마이크를 사용할 수 없습니다. 아래에 직접 답변을 입력할 수 있습니다. " +
              (error instanceof Error ? `(${error.message})` : ""),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      gazeTracker?.close();
      gazeTrackerRef.current = null;
    };
  }, [calibration, stream]);

  function setTranscript(value: string) {
    setTranscripts((previous) => ({ ...previous, [question.question_id]: value }));
    const metrics = speechMetrics[question.question_id];
    if (metrics) {
      setSpeechMetrics((previous) => ({
        ...previous,
        [question.question_id]: addTranscriptRate(metrics, value),
      }));
    }
  }

  async function toggleRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (!isRecording) {
      setSttStates((previous) => ({
        ...previous,
        [question.question_id]: { status: "not_attempted", error: null },
      }));
      setNotice(null);
      setGazeDebugFrame(null);
      setRecordingSeconds(0);
      gazeTrackerRef.current?.start();
      recorder.start();
      setIsRecording(true);
      return;
    }

    setIsRecording(false);
    const gazeSummary = gazeTrackerRef.current?.stop() ?? null;
    setEyeTracking((previous) => ({ ...previous, [question.question_id]: gazeSummary }));
    setIsTranscribing(true);
    try {
      const raw = await recorder.stop();
      const converted = await blobToWav16kWithMetrics(raw);
      setSpeechMetrics((previous) => ({
        ...previous,
        [question.question_id]: converted.metrics,
      }));
      const result = await transcribe(converted.wav, "answer.wav");
      setSttStates((previous) => ({
        ...previous,
        [question.question_id]: { status: result.status, error: result.error ?? null },
      }));
      const transcript = result.status === "ok" ? result.transcript.trim() : "";
      setSpeechMetrics((previous) => ({
        ...previous,
        [question.question_id]: addTranscriptRate(converted.metrics, transcript),
      }));
      if (transcript) {
        setTranscript(transcript);
        setNotice(null);
      } else if (result.status === "no_speech") {
        setNotice("음성이 인식되지 않았습니다. 다시 녹음하거나 직접 입력하세요.");
      } else if (result.status === "not_configured") {
        setNotice("STT가 설정되지 않았습니다. 직접 입력하세요.");
      } else {
        setNotice(`전사 실패: ${result.error ?? result.status}. 직접 입력하세요.`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      setSttStates((previous) => ({
        ...previous,
        [question.question_id]: { status: "error", error: errorMessage },
      }));
      setNotice(
        "녹음 처리 중 오류가 발생했습니다. 직접 입력하세요. " +
          (error instanceof Error ? `(${error.message})` : ""),
      );
    } finally {
      setIsTranscribing(false);
    }
  }

  function submit() {
    const items: AnswerItem[] = questions.map((item) => {
      const transcript = (transcripts[item.question_id] ?? "").trim();
      const metrics = speechMetrics[item.question_id];
      const stt = sttStates[item.question_id] ?? {
        status: "not_attempted" as SttStatus,
        error: null,
      };
      return {
        question_id: item.question_id,
        question: item.text,
        original_question: item.original_text ?? item.text,
        category: item.category,
        transcript,
        stt_status: stt.status,
        stt_error: stt.error,
        eye_tracking: eyeTracking[item.question_id] ?? null,
        speech_metrics: metrics ? addTranscriptRate(metrics, transcript) : null,
      };
    });
    onFinish(items);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>
          질문 {index + 1} / {questions.length}
        </span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 dark:bg-gray-800">
          {question.category}
        </span>
      </div>

      <p className="text-lg leading-relaxed">{question.text}</p>
      {question.original_text && question.original_text !== question.text && (
        <details className="text-xs text-gray-500">
          <summary className="cursor-pointer">질문은행 원문 보기</summary>
          <p className="mt-1 rounded bg-gray-50 p-2 dark:bg-gray-900">
            {question.original_text}
          </p>
        </details>
      )}

      <div
        className={`relative overflow-hidden rounded-lg border-2 bg-black ${
          debugGaze && isRecording && gazeDebugFrame?.isFront === true
            ? "border-emerald-500"
            : debugGaze && isRecording && gazeDebugFrame?.isFront === false
              ? "border-red-500"
              : "border-transparent"
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="aspect-video w-full -scale-x-100 object-cover"
        />
        {debugGaze && (
          <GazeDebugOverlay active={isRecording} frame={gazeDebugFrame} verbose={debugGaze} />
        )}
      </div>

      {canDebugGaze && (
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          <input
            type="checkbox"
            checked={debugGaze}
            onChange={(event) => {
              const enabled = event.target.checked;
              debugGazeRef.current = enabled;
              setDebugGaze(enabled);
              if (!enabled) setGazeDebugFrame(null);
            }}
          />
          시선 디버그 오버레이
        </label>
      )}

      <p className="text-xs text-gray-500">
        {gazeStatus === "loading" && "시선 분석을 준비하고 있습니다."}
        {gazeStatus === "ready" && "녹음 중 시선 데이터를 함께 기록합니다."}
        {gazeStatus === "unavailable" &&
          "시선 분석을 사용할 수 없어 음성·텍스트 답변만 기록합니다."}
      </p>

      {mediaError && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40">
          {mediaError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleRecording}
          disabled={isTranscribing || !!mediaError || gazeStatus === "loading"}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${
            isRecording
              ? "bg-red-600 hover:bg-red-500"
              : "bg-gray-900 hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          }`}
        >
          {isRecording ? "■ 녹음 중지" : "● 녹음 시작"}
        </button>
        {isRecording && (
          <span className="flex items-center gap-2 text-sm text-red-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            녹음 중 {seconds(recordingSeconds)}
          </span>
        )}
        {isTranscribing && (
          <span className="text-sm text-gray-500">음성 인식 중…</span>
        )}
      </div>

      {notice && <p className="text-xs text-amber-600">{notice}</p>}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">
          인식된 답변 (필요하면 직접 수정할 수 있습니다)
        </span>
        <textarea
          value={current}
          onChange={(event) => setTranscript(event.target.value)}
          rows={5}
          placeholder="녹음하면 음성 인식 결과가 여기에 채워집니다."
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      {currentMetrics && (
        <div className="rounded-md border border-gray-200 p-3 text-xs dark:border-gray-800">
          <p className="font-medium">현재 답변 측정값</p>
          <p className="mt-1 text-gray-600 dark:text-gray-300">
            총 {currentMetrics.total_duration_sec.toFixed(1)}초 · 발화 {currentMetrics.speech_duration_sec.toFixed(1)}초 ·
            발화 속도 {currentMetrics.speech_rate_eojeol_per_min?.toFixed(1) ?? "—"}어절/분 ·
            긴 무음 {currentMetrics.long_pause_count}회
          </p>
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0 || isRecording || isTranscribing}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
        >
          이전
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={submit}
            disabled={isRecording || isTranscribing}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            제출하고 결과 보기
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
            disabled={isRecording || isTranscribing}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            다음 질문
          </button>
        )}
      </div>
    </div>
  );
}
