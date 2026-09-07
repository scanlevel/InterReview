"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_TTS_VOICE_ID,
  synthesizeSpeech,
  type TtsVoiceId,
  TtsRequestError,
  transcribe,
  TTS_ANSWER_ACCEPTED_PROMPT,
  TTS_LAST_ANSWER_ACCEPTED_PROMPT,
  TTS_FINISH_PROMPT,
  TTS_START_PROMPT,
} from "@/lib/api";
import {
  playAudioBlob,
  SpeechPlaybackError,
  type SpeechCancellationRef,
} from "@/lib/ttsPlayback";
import {
  createBrowserGazeTracker,
  type BrowserGazeTracker,
  type GazeCalibration,
  type GazeDebugFrame,
} from "@/lib/gaze";
import {
  addSpeechClassification,
  addTranscriptRate,
  blobToWav16kWithMetrics,
  canTranscribeRecording,
  createRealtimeVadMonitor,
  createRecorder,
  mergeSpeechMetrics,
  type AnswerRecorder,
  type RealtimeVadMonitor,
} from "@/lib/recorder";
import type {
  AnswerItem,
  EyeTrackingSummary,
  GazeHeatmap,
  Question,
  SpeechMetrics,
  SttStatus,
} from "@/lib/types";
import GazeDebugOverlay from "@/components/GazeDebugOverlay";
import InterviewerStage from "@/components/InterviewerStage";
import AudioActivityTimeline from "@/components/AudioActivityTimeline";
import {
  transitionInterviewStep,
  waitForAnswerAndGuide,
  type InterviewStep,
} from "@/lib/interviewFlow";
import {
  createQuestionSpeechCache,
  type CachedQuestionSpeech,
  type QuestionSpeechCache,
} from "@/lib/questionSpeechCache";

type AnswerSnapshot = {
  transcript: string;
  stt_status: SttStatus;
  stt_error: string | null;
  eye_tracking: EyeTrackingSummary | null;
  speech_metrics: SpeechMetrics | null;
};

type ProcessedAnswer = {
  transcript: string;
  status: SttStatus;
  error: string | null;
  eyeTracking: EyeTrackingSummary | null;
  speechMetrics: SpeechMetrics | null;
};

const NEXT_QUESTION_DELAY_MS = 1500;

function useMicLevel(stream: MediaStream, active: boolean): number {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    const audioTrack = stream.getAudioTracks().find(
      (track) => track.readyState === "live" && track.enabled,
    );
    if (!audioTrack) {
      return;
    }

    let cancelled = false;
    let animationFrame: number | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let analyser: AnalyserNode | null = null;
    let audioContext: AudioContext | null = null;
    let smoothedLevel = 0;

    const removeResumeListeners = () => {
      window.removeEventListener("pointerdown", resumeContext);
      window.removeEventListener("keydown", resumeContext);
      window.removeEventListener("touchstart", resumeContext);
    };

    const resumeContext = () => {
      if (!audioContext || audioContext.state !== "suspended") {
        removeResumeListeners();
        return;
      }
      void audioContext.resume().then(() => {
        if (audioContext?.state === "running") removeResumeListeners();
      }).catch(() => undefined);
    };

    try {
      const AudioContextCtor = window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) {
        return;
      }

      audioContext = new AudioContextCtor();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.65;
      source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // AudioContext created outside a direct click can start suspended.
      // Try immediately, then retry on the next user gesture if the browser blocks it.
      resumeContext();
      if (audioContext.state === "suspended") {
        window.addEventListener("pointerdown", resumeContext, { passive: true });
        window.addEventListener("keydown", resumeContext);
        window.addEventListener("touchstart", resumeContext, { passive: true });
      }

      const samples = new Float32Array(analyser.fftSize);
      const tick = () => {
        if (cancelled || !analyser || !audioContext) return;

        if (audioContext.state === "suspended") {
          resumeContext();
          setLevel(0);
          animationFrame = window.requestAnimationFrame(tick);
          return;
        }

        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        const rms = Math.sqrt(energy / Math.max(1, samples.length));

        // Map roughly -55 dBFS..-15 dBFS to 0..1 so normal speech is visible.
        const db = 20 * Math.log10(Math.max(rms, 1e-5));
        const normalized = Math.max(0, Math.min(1, (db + 55) / 40));

        // Faster attack, slower release keeps speech responsive without jitter.
        const smoothing = normalized > smoothedLevel ? 0.45 : 0.16;
        smoothedLevel += (normalized - smoothedLevel) * smoothing;
        setLevel(smoothedLevel);
        animationFrame = window.requestAnimationFrame(tick);
      };
      animationFrame = window.requestAnimationFrame(tick);
    } catch (error) {
      console.warn("마이크 레벨 시각화 초기화 실패", error);
    }

    return () => {
      cancelled = true;
      removeResumeListeners();
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      source?.disconnect();
      analyser?.disconnect();
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close().catch(() => undefined);
      }
      setLevel(0);
    };
  }, [active, stream]);

  return level;
}

async function playSpeech(
  text: string,
  cancellationRef: SpeechCancellationRef,
  voiceId: TtsVoiceId,
  cachedSpeech?: CachedQuestionSpeech,
): Promise<void> {
  const controller = new AbortController();
  let cancelled = false;
  let rejectCancelled: ((reason: Error) => void) | null = null;
  const cancellation = new Promise<never>((_, reject) => {
    rejectCancelled = reject;
  });
  const speech = cachedSpeech ?? {
    promise: synthesizeSpeech(text, controller.signal, voiceId),
    cancel: () => controller.abort(),
  };
  const cancelRequest = () => {
    cancelled = true;
    controller.abort();
    speech.cancel();
    rejectCancelled?.(
      new TtsRequestError("cancelled", "음성 안내 요청이 취소되었습니다."),
    );
  };
  cancellationRef.current = cancelRequest;

  let blob: Blob;
  try {
    blob = await Promise.race([
      speech.promise,
      cancellation,
    ]);
    if (cancelled) {
      throw new TtsRequestError("cancelled", "음성 안내 요청이 취소되었습니다.");
    }
  } catch (error) {
    if (cancellationRef.current === cancelRequest) cancellationRef.current = null;
    throw error;
  }

  try {
    await playAudioBlob(blob, text, cancellationRef);
  } finally {
    if (cancellationRef.current === cancelRequest) cancellationRef.current = null;
  }
}

function speechErrorCode(error: unknown): string | null {
  if (error instanceof TtsRequestError || error instanceof SpeechPlaybackError) {
    return error.code;
  }
  return null;
}

function isSpeechCancellation(error: unknown): boolean {
  return speechErrorCode(error) === "cancelled";
}

function speechRecoveryNotice(error: unknown): string {
  const action = "질문을 화면에서 확인한 뒤 ‘● 녹음 시작’으로 수동 진행해 주세요.";
  switch (speechErrorCode(error)) {
    case "autoplay_blocked":
      return `브라우저가 음성 자동 재생을 차단했습니다. ${action}`;
    case "request_timeout":
      return `로컬 TTS 요청 시간이 초과되었습니다. ${action}`;
    case "playback_timeout":
      return `음성 안내 재생이 끝나지 않았습니다. ${action}`;
    case "model_missing":
      return `로컬 TTS 모델이 준비되지 않았습니다. ${action}`;
    case "model_load":
      return `로컬 TTS 모델을 불러오지 못했습니다. ${action}`;
    case "guide_missing":
      return `고정 안내 음성이 준비되지 않았습니다. ${action}`;
    case "synthesis":
      return `로컬 TTS 합성에 실패했습니다. ${action}`;
    case "playback_error":
    case "request_failed":
      return `음성 안내를 재생하지 못했습니다. ${action}`;
    default:
      return `자동 음성 안내를 사용할 수 없습니다. ${action}`;
  }
}

function logSpeechFailure(error: unknown): void {
  const code = speechErrorCode(error);
  if (code && code !== "cancelled") console.warn(`local_tts_failure code=${code}`);
}

function mergeEyeTracking(summaries: readonly EyeTrackingSummary[]): EyeTrackingSummary | null {
  const heatmaps = summaries
    .map((summary) => summary.gaze_heatmap)
    .filter((heatmap): heatmap is GazeHeatmap => Boolean(heatmap?.counts.length));
  if (!heatmaps.length) return null;
  const first = heatmaps[0];
  const countLength = Math.max(...heatmaps.map((heatmap) => heatmap.counts.length));
  const counts = Array.from({ length: countLength }, (_, index) =>
    heatmaps.reduce((sum, heatmap) => sum + (heatmap.counts[index] ?? 0), 0),
  );
  return {
    gaze_heatmap: {
      columns: first.columns,
      rows: first.rows,
      counts,
      total: counts.reduce((sum, count) => sum + count, 0),
    },
  };
}

export default function InterviewView({
  questions,
  stream,
  calibration,
  interviewerImageSrc,
  voiceId,
  questionSpeechCache,
  onAnswerFinalized,
  onFinish,
}: {
  questions: Question[];
  stream: MediaStream;
  calibration: GazeCalibration | null;
  interviewerImageSrc?: string | null;
  voiceId?: TtsVoiceId;
  questionSpeechCache?: QuestionSpeechCache;
  onAnswerFinalized: (answer: AnswerItem) => void;
  onFinish: (answers: AnswerItem[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState<InterviewStep>("question_ready");
  const [autoMode, setAutoMode] = useState(true);
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
  const vadMonitorRef = useRef<RealtimeVadMonitor | null>(null);
  const speechCancellationRef = useRef<SpeechCancellationRef["current"]>(null);
  const autoRunRef = useRef(0);
  const processingAnswerIdsRef = useRef(new Set<string>());
  const answerSegmentsRef = useRef<Record<string, Blob[]>>({});
  const answerGazeSegmentsRef = useRef<Record<string, EyeTrackingSummary[]>>({});
  const activeQuestionSpeechRef = useRef<CachedQuestionSpeech | null>(null);
  const endGuideFailureRef = useRef(false);
  const localQuestionSpeechCacheRef = useRef<QuestionSpeechCache | null>(null);
  if (!localQuestionSpeechCacheRef.current) {
    localQuestionSpeechCacheRef.current = createQuestionSpeechCache();
  }

  const question = questions[index];
  const isLast = index === questions.length - 1;
  const selectedVoiceId = voiceId ?? DEFAULT_TTS_VOICE_ID;
  const speechCache =
    questionSpeechCache ?? localQuestionSpeechCacheRef.current;
  const isRecording = step === "recording";
  const isTranscribing = step === "processing";
  const micLevel = useMicLevel(stream, isRecording);
  const currentMetrics = speechMetrics[question.question_id] ?? null;

  function stopSpeech() {
    speechCancellationRef.current?.();
    speechCancellationRef.current = null;
  }

  function stopRealtimeVad() {
    vadMonitorRef.current?.stop();
    vadMonitorRef.current = null;
  }

  function cancelAutomaticRun(clearQuestionSpeech = false) {
    autoRunRef.current += 1;
    stopSpeech();
    activeQuestionSpeechRef.current?.cancel();
    activeQuestionSpeechRef.current = null;
    stopRealtimeVad();
    if (clearQuestionSpeech) speechCache.clear();
  }

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
            "카메라·마이크를 사용할 수 없습니다. 면접을 진행할 수 없습니다. " +
              (error instanceof Error ? `(${error.message})` : ""),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      autoRunRef.current += 1;
      speechCancellationRef.current?.();
      activeQuestionSpeechRef.current?.cancel();
      speechCache.clear();
      vadMonitorRef.current?.stop();
      vadMonitorRef.current = null;
      if (recorderRef.current?.isRecording()) {
        void recorderRef.current.stop().catch(() => undefined);
      }
      gazeTracker?.close();
      gazeTrackerRef.current = null;
    };
  }, [calibration, speechCache, stream]);

  useEffect(() => {
    const current = questions[index];
    const next = questions[index + 1];
    speechCache.retain(
      [current, next]
        .filter((item): item is Question => Boolean(item))
        .map((item) => ({ questionId: item.question_id, text: item.text })),
      selectedVoiceId,
    );
  }, [index, questions, selectedVoiceId, speechCache]);

  useEffect(() => () => speechCache.clear(), [speechCache]);

  function startRealtimeVad(questionId: string) {
    stopRealtimeVad();
    const monitor = createRealtimeVadMonitor(
      stream,
      () => void handleLongSilence(questionId),
      () => {
        setAutoMode(false);
        setNotice(
          "실시간 무음 감지를 사용할 수 없어 수동 종료로 전환했습니다.",
        );
      },
    );
    vadMonitorRef.current = monitor;
    void monitor.ready.catch(() => undefined);
  }

  function startAnswerImmediately() {
    if (step !== "reading_question" && step !== "playing_start") return;
    cancelAutomaticRun(true);
    if (!startAnswerRecording(question.question_id, false)) {
      setAutoMode(false);
      setNotice(
        "녹음을 시작할 수 없습니다. 화면의 녹음 버튼으로 다시 시도해 주세요.",
      );
    }
  }

  function startAnswerRecording(questionId: string, preserve: boolean): boolean {
    const recorder = recorderRef.current;
    if (!recorder || sttRequestInFlightRef.current || recorder.isRecording()) return false;
    if (!preserve) {
      answerSegmentsRef.current[questionId] = [];
      answerGazeSegmentsRef.current[questionId] = [];
      setTranscripts((previous) => ({ ...previous, [questionId]: "" }));
      setEyeTracking((previous) => ({ ...previous, [questionId]: null }));
      setSpeechMetrics((previous) => ({ ...previous, [questionId]: null }));
    } else {
      answerSegmentsRef.current[questionId] ??= [];
      answerGazeSegmentsRef.current[questionId] ??= [];
    }
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
      return false;
    }
    recordingQuestionIdRef.current = questionId;
    setStep("recording");
    if (autoMode) startRealtimeVad(questionId);
    const next = questions[index + 1];
    if (next) {
      void speechCache
        .prepare(next.question_id, next.text, selectedVoiceId)
        .promise.catch(() => undefined);
    }
    return true;
  }

  async function stopRecordingSegment(questionId: string): Promise<Blob | null> {
    stopRealtimeVad();
    if (recordingQuestionIdRef.current === questionId) recordingQuestionIdRef.current = null;
    let gazeSummary: EyeTrackingSummary | null = null;
    try {
      gazeSummary = gazeTrackerRef.current?.stop() ?? null;
    } catch (error) {
      console.warn("gaze tracking stop failed", error);
    }
    if (gazeSummary) (answerGazeSegmentsRef.current[questionId] ??= []).push(gazeSummary);
    const recorder = recorderRef.current;
    if (!recorder?.isRecording()) return null;
    const raw = await recorder.stop();
    (answerSegmentsRef.current[questionId] ??= []).push(raw);
    return raw;
  }

  async function processAnswer(item: Question): Promise<ProcessedAnswer> {
    const segments = answerSegmentsRef.current[item.question_id] ?? [];
    const transcriptParts: string[] = [];
    const metricsList: SpeechMetrics[] = [];
    const statuses: Array<{
      status: SttStatus;
      error: string | null;
      hasWords: boolean;
    }> = [];

    for (const raw of segments) {
      try {
        const converted = await blobToWav16kWithMetrics(raw);
        try {
          const result = await transcribe(converted.wav, "answer.wav");
          const transcript = result.status === "ok" ? result.transcript.trim() : "";
          metricsList.push(
            addSpeechClassification(
              converted.metrics,
              converted.vad,
              result.status === "ok" ? result.words : null,
            ),
          );
          statuses.push({
            status: result.status,
            error: result.error ?? null,
            hasWords: Boolean(result.status === "ok" && result.words?.length),
          });
          if (transcript) transcriptParts.push(transcript);
        } catch (error) {
          metricsList.push({ ...converted.metrics, speech_classification: null });
          statuses.push({
            status: "error",
            error: error instanceof Error ? error.message : String(error),
            hasWords: false,
          });
        }
      } catch (error) {
        statuses.push({
          status: "error",
          error: error instanceof Error ? error.message : String(error),
          hasWords: false,
        });
      }
    }

    const transcript = transcriptParts.join(" ").trim();
    const failed = statuses.find((status) => status.status === "error");
    const firstUnavailable = statuses.find((status) => status.status !== "ok");
    const status: SttStatus = failed
      ? "error"
      : transcript
        ? "ok"
        : firstUnavailable?.status ?? "empty";
    const error = failed?.error ?? firstUnavailable?.error ?? (
      status === "error" ? "음성 처리에 실패했습니다." : null
    );
    const completeAlignment = Boolean(
      statuses.length > 0 &&
        statuses.every((entry) => entry.status === "ok" && entry.hasWords) &&
        metricsList.length === statuses.length &&
        metricsList.every((metrics) => Boolean(metrics.speech_classification)),
    );
    const mergedMetrics = mergeSpeechMetrics(metricsList);
    const speechMetrics = mergedMetrics
      ? addTranscriptRate(
          {
            ...mergedMetrics,
            speech_classification: completeAlignment
              ? mergedMetrics.speech_classification
              : null,
          },
          transcript,
        )
      : null;
    return {
      transcript,
      status,
      error,
      eyeTracking: mergeEyeTracking(answerGazeSegmentsRef.current[item.question_id] ?? []),
      speechMetrics,
    };
  }

  async function finalizeAnswer(
    item: Question = question,
    currentSegmentOpen = true,
    invalidateAutomation = true,
    guide?: () => Promise<void>,
  ) {
    const questionId = item.question_id;
    if (sttRequestInFlightRef.current || processingAnswerIdsRef.current.has(questionId)) return;
    processingAnswerIdsRef.current.add(questionId);
    sttRequestInFlightRef.current = true;
    if (guide) endGuideFailureRef.current = false;
    if (invalidateAutomation) cancelAutomaticRun();
    setStep("processing");
    try {
      if (currentSegmentOpen && recorderRef.current?.isRecording()) {
        await stopRecordingSegment(questionId);
      } else {
        stopRealtimeVad();
      }
      const answerTask = processAnswer(item);
      const guideTask = guide
        ? Promise.resolve().then(guide)
        : Promise.resolve();
      const processed = await waitForAnswerAndGuide(answerTask, guideTask);
      setTranscripts((previous) => ({ ...previous, [questionId]: processed.transcript }));
      setSttStates((previous) => ({
        ...previous,
        [questionId]: { status: processed.status, error: processed.error },
      }));
      setEyeTracking((previous) => ({ ...previous, [questionId]: processed.eyeTracking }));
      setSpeechMetrics((previous) => ({ ...previous, [questionId]: processed.speechMetrics }));
      if (endGuideFailureRef.current) {
        setNotice("답변 종료 안내 음성을 재생하지 못했지만 답변 처리는 계속합니다.");
      } else if (processed.status === "ok" && processed.transcript) {
        setNotice(null);
      } else if (processed.status === "no_speech") {
        setNotice("음성이 인식되지 않았습니다. 내용 판단 없이 세션을 유지합니다.");
      } else if (processed.status === "not_configured") {
        setNotice("STT가 설정되지 않았습니다. 내용 판단 없이 세션을 유지합니다.");
      } else {
        setNotice(`음성 인식 실패: ${processed.error ?? processed.status}. 세션을 유지합니다.`);
      }
      onAnswerFinalized(
        buildAnswer(item, {
          transcript: processed.transcript,
          stt_status: processed.status,
          stt_error: processed.error,
          eye_tracking: processed.eyeTracking,
          speech_metrics: processed.speechMetrics,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const snapshot: AnswerSnapshot = {
        transcript: "",
        stt_status: "error",
        stt_error: message,
        eye_tracking: mergeEyeTracking(answerGazeSegmentsRef.current[questionId] ?? []),
        speech_metrics: null,
      };
      setSttStates((previous) => ({
        ...previous,
        [questionId]: { status: "error", error: message },
      }));
      setNotice("음성 처리 중 오류가 발생했습니다. 내용 판단 없이 세션을 유지합니다.");
      onAnswerFinalized(buildAnswer(item, snapshot));
    } finally {
      answerSegmentsRef.current[questionId] = [];
      answerGazeSegmentsRef.current[questionId] = [];
      sttRequestInFlightRef.current = false;
      processingAnswerIdsRef.current.delete(questionId);
      setStep("waiting_next");
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

  async function handleLongSilence(questionId: string) {
    if (
      !autoMode ||
      recordingQuestionIdRef.current !== questionId ||
      !recorderRef.current?.isRecording() ||
      sttRequestInFlightRef.current
    ) return;

    const run = ++autoRunRef.current;
    setStep((currentStep) =>
      transitionInterviewStep(currentStep, "long_silence", isLast),
    );
    await finalizeAnswer(question, true, false, async () => {
      const acceptedPrompt = isLast
        ? TTS_LAST_ANSWER_ACCEPTED_PROMPT
        : TTS_ANSWER_ACCEPTED_PROMPT;
      try {
        await playSpeech(acceptedPrompt, speechCancellationRef, selectedVoiceId);
      } catch (error) {
        if (isSpeechCancellation(error)) return;
        if (autoRunRef.current !== run) return;
        logSpeechFailure(error);
        endGuideFailureRef.current = true;
      }
    });
  }

  async function runAutomaticQuestion(item: Question, run: number) {
    const cachedSpeech = speechCache.prepare(
      item.question_id,
      item.text,
      selectedVoiceId,
    );
    activeQuestionSpeechRef.current = cachedSpeech;
    try {
      setStep((currentStep) =>
        transitionInterviewStep(currentStep, "start_automatic", isLast),
      );
      await playSpeech(
        item.text,
        speechCancellationRef,
        selectedVoiceId,
        cachedSpeech,
      );
      if (autoRunRef.current !== run) return;
      setStep((currentStep) =>
        transitionInterviewStep(currentStep, "question_audio_ready", isLast),
      );
      await playSpeech(TTS_START_PROMPT, speechCancellationRef, selectedVoiceId);
      if (autoRunRef.current !== run) return;
      if (!startAnswerRecording(item.question_id, false)) {
        throw new Error("녹음 장치를 사용할 수 없습니다.");
      }
    } catch (error) {
      if (autoRunRef.current !== run || isSpeechCancellation(error)) return;
      logSpeechFailure(error);
      setAutoMode(false);
      setStep("question_ready");
      setNotice(speechRecoveryNotice(error));
    } finally {
      if (activeQuestionSpeechRef.current === cachedSpeech) {
        activeQuestionSpeechRef.current = null;
      }
    }
  }

  useEffect(() => {
    if (!autoMode || step !== "question_ready" || gazeStatus === "loading" || !recorderRef.current) return;
    const run = autoRunRef.current + 1;
    autoRunRef.current = run;
    void runAutomaticQuestion(question, run);
  // The state transition immediately leaves question_ready; do not restart the
  // speech sequence on unrelated renders.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMode, gazeStatus, index, question.question_id, step]);

  useEffect(() => {
    if (!autoMode || step !== "waiting_next") return;
    const run = autoRunRef.current + 1;
    autoRunRef.current = run;
    const timer = window.setTimeout(() => {
      if (autoRunRef.current !== run) return;
      if (isLast) {
        void submit();
        return;
      }
      setIndex((value) => Math.min(questions.length - 1, value + 1));
      setNotice(null);
      setStep("question_ready");
    }, NEXT_QUESTION_DELAY_MS);
    return () => window.clearTimeout(timer);
  // The timer is intentionally tied to the state transition, not each render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMode, index, isLast, questions.length, step]);

  function handleAutoModeChange(enabled: boolean) {
    if (enabled) {
      setAutoMode(true);
      return;
    }
    cancelAutomaticRun(true);
    if (step === "reading_question" || step === "playing_start") {
      setStep("question_ready");
    }
    setAutoMode(false);
  }

  async function submit() {
    if (step !== "waiting_next" || finishRequestedRef.current) return;
    finishRequestedRef.current = true;
    cancelAutomaticRun(true);
    const run = autoRunRef.current;
    setStep((currentStep) =>
      transitionInterviewStep(currentStep, "finish", true),
    );
    try {
      await playSpeech(TTS_FINISH_PROMPT, speechCancellationRef, selectedVoiceId);
    } catch (error) {
      // A guide failure must not prevent the result screen.
      if (!isSpeechCancellation(error)) logSpeechFailure(error);
    }
    if (autoRunRef.current !== run) return;
    onFinish(questions.map((item) => buildAnswer(item)));
  }

  function toggleRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (step === "question_ready") {
      startAnswerRecording(question.question_id, false);
      return;
    }
    if (
      step !== "recording" ||
      !canTranscribeRecording(
        recordingQuestionIdRef.current,
        recorder.isRecording(),
        sttRequestInFlightRef.current,
      )
    ) return;
    void finalizeAnswer(question, true, true);
  }

  function goToNextQuestion() {
    cancelAutomaticRun();
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

      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={autoMode}
            onChange={(event) => handleAutoModeChange(event.target.checked)}
            disabled={isRecording || isTranscribing}
          />
          자동 면접 진행
        </label>
        <span className="text-xs text-gray-500">
          질문 읽기 · 시작 안내 후 즉시 녹음 · 유효 발화 뒤 4초 무음이면 자동 종료
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
                {isRecording
                  ? "답변을 듣고 있습니다"
                  : step === "reading_question"
                    ? "질문을 읽고 있습니다"
                    : "질문을 확인해 주세요"}
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
          "시선 분석을 사용할 수 없어 음성 측정만 기록합니다."}
      </p>

      {mediaError && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40">
          {mediaError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        {(step === "question_ready" || step === "recording") && (
          <button
            type="button"
            onClick={toggleRecording}
            disabled={!!mediaError || gazeStatus === "loading" || autoMode && step === "question_ready"}
            className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${
              isRecording
                ? "bg-red-600 hover:bg-red-500"
                : "bg-gray-900 hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            }`}
          >
            {isRecording ? "■ 답변 종료" : "● 녹음 시작"}
          </button>
        )}
        {autoMode && (step === "reading_question" || step === "playing_start") && (
          <>
            <button
              type="button"
              onClick={startAnswerImmediately}
              disabled={!!mediaError || gazeStatus === "loading"}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-gray-900"
            >
              바로 답변 시작
            </button>
            <button
              type="button"
              onClick={() => handleAutoModeChange(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm dark:border-gray-700"
            >
              자동 진행 중단
            </button>
          </>
        )}
        {isRecording && (
          <div
            className="flex items-center gap-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
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
        {isTranscribing && (
          <span className="text-sm text-gray-500" aria-live="polite">
            답변을 처리하고 있습니다…
          </span>
        )}
        {step === "waiting_next" && (
          <span className="text-sm text-gray-600 dark:text-gray-300" aria-live="polite">
            {isLast
              ? "마지막 답변 처리가 끝났습니다. 결과 보기 버튼을 눌러 주세요."
              : "답변 처리가 끝났습니다. 다음 질문을 눌러 진행하세요."}
          </span>
        )}
      </div>

      {notice && <p className="text-xs text-amber-600">{notice}</p>}

      <p className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-500 dark:border-gray-800 dark:bg-gray-900">
        음성 인식 결과는 답변 판단에만 사용하며 화면에 표시하거나 편집하지 않습니다.
      </p>

      {currentMetrics && (
        <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
          <p className="mb-2 text-xs font-medium">현재 답변 오디오 활동</p>
          <AudioActivityTimeline timeline={currentMetrics.audio_timeline} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            cancelAutomaticRun();
            setIndex((value) => Math.max(0, value - 1));
            setNotice(null);
            setStep("question_ready");
          }}
          disabled={index === 0 || step !== "question_ready"}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
        >
          이전
        </button>

        {step === "waiting_next" && isLast ? (
          <button
            type="button"
            onClick={() => void submit()}
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
            disabled={step !== "question_ready" || autoMode}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
          >
            답변 없이 건너뛰기
          </button>
        )}
      </div>
    </div>
  );
}
