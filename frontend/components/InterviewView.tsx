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
  canTranscribeRecording,
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
import InterviewerStage from "@/components/InterviewerStage";
import AudioActivityTimeline from "@/components/AudioActivityTimeline";
import {
  transitionInterviewStep,
  type InterviewStep,
} from "@/lib/interviewFlow";

type AnswerSnapshot = {
  transcript: string;
  stt_status: SttStatus;
  stt_error: string | null;
  eye_tracking: EyeTrackingSummary | null;
  speech_metrics: SpeechMetrics | null;
};

export default function InterviewView({
  questions,
  stream,
  calibration,
  interviewerImageSrc,
  onAnswerFinalized,
  onFinish,
}: {
  questions: Question[];
  stream: MediaStream;
  calibration: GazeCalibration | null;
  interviewerImageSrc?: string | null;
  onAnswerFinalized: (answer: AnswerItem) => void;
  onFinish: (answers: AnswerItem[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<InterviewStep>("question_ready");
  const [sttStates, setSttStates] = useState<
    Record<string, { status: SttStatus; error: string | null }>
  >({});
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
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
  const recordingQuestionIdRef = useRef<string | null>(null);
  const sttRequestInFlightRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const gazeTrackerRef = useRef<BrowserGazeTracker | null>(null);
  const debugGazeRef = useRef(false);

  const question = questions[index];
  const isLast = index === questions.length - 1;
  const isRecording = step === "recording";
  const isTranscribing = step === "processing";
  const current = transcripts[question.question_id] ?? "";
  const currentMetrics = speechMetrics[question.question_id] ?? null;


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

  function setTranscript(questionId: string, value: string) {
    setTranscripts((previous) => ({ ...previous, [questionId]: value }));
    const metrics = speechMetrics[questionId];
    if (metrics) {
      setSpeechMetrics((previous) => ({
        ...previous,
        [questionId]: addTranscriptRate(metrics, value),
      }));
    }
  }

  async function toggleRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (step === "question_ready") {
      if (sttRequestInFlightRef.current || recorder.isRecording()) return;
      const questionId = question.question_id;
      setSttStates((previous) => ({
        ...previous,
        [questionId]: { status: "not_attempted", error: null },
      }));
      setNotice(null);
      setGazeDebugFrame(null);
      try {
        gazeTrackerRef.current?.start();
        recorder.start();
      } catch (error) {
        try {
          gazeTrackerRef.current?.stop();
        } catch {
          // Keep the recorder start failure local to this question.
        }
        setNotice(
          "녹음을 시작할 수 없습니다. " +
            (error instanceof Error ? `(${error.message})` : ""),
        );
        return;
      }
      recordingQuestionIdRef.current = questionId;
      setStep((currentStep) =>
        transitionInterviewStep(currentStep, "start_recording", isLast),
      );
      return;
    }

    if (step !== "recording") return;
    const questionId = recordingQuestionIdRef.current;
    if (!canTranscribeRecording(
      questionId,
      recorder.isRecording(),
      sttRequestInFlightRef.current,
    )) {
      if (!sttRequestInFlightRef.current && !recorder.isRecording()) {
        setStep("question_ready");
      }
      return;
    }
    recordingQuestionIdRef.current = null;
    sttRequestInFlightRef.current = true;
    let gazeSummary: EyeTrackingSummary | null = null;
    try {
      gazeSummary = gazeTrackerRef.current?.stop() ?? null;
    } catch (error) {
      console.warn("gaze tracking stop failed", error);
    }
    setEyeTracking((previous) => ({ ...previous, [questionId]: gazeSummary }));
    setStep((currentStep) =>
      transitionInterviewStep(currentStep, "stop_recording", isLast),
    );

    let finalTranscript = "";
    let finalStatus: SttStatus = "error";
    let finalError: string | null = "녹음 처리에 실패했습니다.";
    let finalMetrics = speechMetrics[questionId] ?? null;
    try {
      const raw = await recorder.stop();
      const converted = await blobToWav16kWithMetrics(raw);
      finalMetrics = converted.metrics;
      setSpeechMetrics((previous) => ({
        ...previous,
        [questionId]: converted.metrics,
      }));
      const result = await transcribe(converted.wav, "answer.wav");
      setSttStates((previous) => ({
        ...previous,
        [questionId]: { status: result.status, error: result.error ?? null },
      }));
      finalStatus = result.status;
      finalError = result.error ?? null;
      finalTranscript = result.status === "ok" ? result.transcript.trim() : "";
      setSpeechMetrics((previous) => ({
        ...previous,
        [questionId]: addTranscriptRate(converted.metrics, finalTranscript),
      }));
      setTranscripts((previous) => ({
        ...previous,
        [questionId]: finalTranscript,
      }));
      if (finalTranscript) {
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
        [questionId]: { status: "error", error: errorMessage },
      }));
      setTranscripts((previous) => ({ ...previous, [questionId]: "" }));
      finalStatus = "error";
      finalError = errorMessage;
      setNotice(
        "녹음 처리 중 오류가 발생했습니다. 직접 입력하세요. " +
          (error instanceof Error ? `(${error.message})` : ""),
      );
    } finally {
      sttRequestInFlightRef.current = false;
      setStep((currentStep) =>
        transitionInterviewStep(
          currentStep,
          finalStatus === "ok"
            ? "processing_succeeded"
            : "processing_failed",
          isLast,
        ),
      );
      onAnswerFinalized(
        buildAnswer(question, {
          transcript: finalTranscript,
          stt_status: finalStatus,
          stt_error: finalError,
          eye_tracking: gazeSummary,
          speech_metrics: finalMetrics,
        }),
      );
    }
  }

  function buildAnswer(item: Question, snapshot?: AnswerSnapshot): AnswerItem {
    const transcript = snapshot
      ? snapshot.transcript.trim()
      : (transcripts[item.question_id] ?? "").trim();
    const metrics = snapshot
      ? snapshot.speech_metrics
      : speechMetrics[item.question_id];
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
      stt_status: snapshot ? snapshot.stt_status : stt.status,
      stt_error: snapshot ? snapshot.stt_error : stt.error,
      eye_tracking: snapshot
        ? snapshot.eye_tracking
        : eyeTracking[item.question_id] ?? null,
      speech_metrics: metrics ? addTranscriptRate(metrics, transcript) : null,
    };
  }

  function submit() {
    if (step !== "waiting_next" || finishRequestedRef.current) return;
    finishRequestedRef.current = true;
    setStep((currentStep) =>
      transitionInterviewStep(currentStep, "finish", true),
    );
    onFinish(questions.map((item) => buildAnswer(item)));
  }

  function goToNextQuestion() {
    if (step === "question_ready") {
      onAnswerFinalized(buildAnswer(question));
      setStep((currentStep) =>
        transitionInterviewStep(currentStep, "skip_answer", isLast),
      );
      return;
    }
    if (step !== "waiting_next") return;
    if (isLast) {
      submit();
      return;
    }
    setIndex((value) => Math.min(questions.length - 1, value + 1));
    setNotice(null);
    setStep((currentStep) =>
      transitionInterviewStep(currentStep, "next_question", false),
    );
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

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_12rem]">
        <div className="flex min-w-0 justify-center">
          <InterviewerStage
            className="w-full max-w-full lg:w-[48rem]"
            imageSrc={interviewerImageSrc}
          >
            {debugGaze && (
              <GazeDebugOverlay active={isRecording} frame={gazeDebugFrame} verbose={debugGaze} />
            )}
            <div className="absolute inset-x-4 bottom-4 rounded-md bg-slate-950/75 px-3 py-2 text-center text-sm text-slate-100">
              <p className="text-xs text-slate-300">
                {isRecording ? "답변을 듣고 있습니다" : "질문을 확인해 주세요"}
              </p>
              <p className="mt-1">답변할 때는 면접관의 눈을 바라보세요.</p>
            </div>
          </InterviewerStage>
        </div>
        <div
          className="relative mx-auto w-full max-w-xs overflow-hidden rounded-lg border border-transparent bg-black lg:max-w-none"
        >
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="aspect-video w-full -scale-x-100 object-cover"
          />
          {isRecording && (
            <div className="pointer-events-none absolute inset-0 bg-black/15" />
          )}
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white">
            내 화면 · 자세 확인용
          </div>
        </div>
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
        {(step === "question_ready" || step === "recording") && (
          <button
            type="button"
            onClick={toggleRecording}
            disabled={!!mediaError || gazeStatus === "loading"}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${
              isRecording
                ? "bg-red-600 hover:bg-red-500"
                : "bg-gray-900 hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            }`}
          >
            {isRecording ? "■ 답변 종료" : "● 녹음 시작"}
          </button>
        )}
        {isRecording && (
          <span className="flex items-center gap-2 text-sm text-red-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            녹음 중
          </span>
        )}
        {isTranscribing && (
          <span className="text-sm text-gray-500" aria-live="polite">
            답변을 처리하고 있습니다…
          </span>
        )}
        {step === "waiting_next" && (
          <span className="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">
            답변 처리가 끝났습니다. 다음 질문을 눌러 진행하세요.
          </span>
        )}
      </div>

      {notice && <p className="text-xs text-amber-600">{notice}</p>}

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-gray-500">
          인식된 답변 (필요하면 직접 수정할 수 있습니다)
        </span>
        <textarea
          value={current}
          onChange={(event) => setTranscript(question.question_id, event.target.value)}
          disabled={isRecording || isTranscribing}
          rows={5}
          placeholder="녹음하면 음성 인식 결과가 여기에 채워집니다."
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      {currentMetrics && (
        <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
          <p className="mb-2 text-xs font-medium">현재 답변 오디오 활동</p>
          <AudioActivityTimeline timeline={currentMetrics.audio_timeline} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0 || step !== "question_ready"}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
        >
          이전
        </button>

        {step === "waiting_next" && isLast ? (
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            제출하고 결과 보기
          </button>
        ) : step === "waiting_next" ? (
          <button
            type="button"
            onClick={goToNextQuestion}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            다음 질문
          </button>
        ) : (
          <button
            type="button"
            onClick={goToNextQuestion}
            disabled={step !== "question_ready"}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
          >
            답변 없이 건너뛰기
          </button>
        )}
      </div>
    </div>
  );
}
