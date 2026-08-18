"use client";

import { useEffect, useRef, useState } from "react";
import { transcribe } from "@/lib/api";
import { blobToWav16k, createRecorder, type AnswerRecorder } from "@/lib/recorder";
import type { AnswerItem, Question } from "@/lib/types";

export default function InterviewView({
  questions,
  onFinish,
}: {
  questions: Question[];
  onFinish: (answers: AnswerItem[]) => void;
}) {
  const [index, setIndex] = useState(0);
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<AnswerRecorder | null>(null);

  const question = questions[index];
  const isLast = index === questions.length - 1;
  const current = transcripts[question.id] ?? "";

  // Acquire camera + mic once for the whole interview.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        recorderRef.current = createRecorder(stream);
        if (videoRef.current) videoRef.current.srcObject = stream;
        setMediaError(null);
      } catch (e) {
        setMediaError(
          "카메라·마이크를 사용할 수 없습니다. 권한을 허용하거나, 아래에 직접 답변을 입력하세요. " +
            (e instanceof Error ? `(${e.message})` : ""),
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  function setTranscript(value: string) {
    setTranscripts((prev) => ({ ...prev, [question.id]: value }));
  }

  async function toggleRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;

    if (!isRecording) {
      setNotice(null);
      recorder.start();
      setIsRecording(true);
      return;
    }

    // Stop -> convert -> transcribe.
    setIsRecording(false);
    setIsTranscribing(true);
    try {
      const raw = await recorder.stop();
      const wav = await blobToWav16k(raw);
      const result = await transcribe(wav, "answer.wav");
      if (result.status === "ok" && result.transcript) {
        setTranscript(result.transcript);
        setNotice(null);
      } else if (result.status === "no_speech") {
        setNotice("음성이 인식되지 않았습니다. 다시 녹음하거나 직접 입력하세요.");
      } else if (result.status === "not_configured") {
        setNotice("STT가 설정되지 않았습니다. 직접 입력하세요.");
      } else {
        setNotice(`전사 실패: ${result.error ?? result.status}. 직접 입력하세요.`);
      }
    } catch (e) {
      setNotice(
        "녹음 처리 중 오류가 발생했습니다. 직접 입력하세요. " +
          (e instanceof Error ? `(${e.message})` : ""),
      );
    } finally {
      setIsTranscribing(false);
    }
  }

  function submit() {
    const items: AnswerItem[] = questions.map((q) => ({
      question_id: q.id,
      question: q.text,
      category: q.category,
      transcript: (transcripts[q.id] ?? "").trim(),
      eye_tracking: null, // Milestone C fills this from the browser gaze tracker
    }));
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

      <div className="overflow-hidden rounded-lg bg-black">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="aspect-video w-full object-cover"
        />
      </div>

      {mediaError && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40">
          {mediaError}
        </p>
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggleRecording}
          disabled={isTranscribing || !!mediaError}
          className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${
            isRecording ? "bg-red-600 hover:bg-red-500" : "bg-gray-900 hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          }`}
        >
          {isRecording ? "■ 녹음 중지" : "● 녹음 시작"}
        </button>
        {isRecording && (
          <span className="flex items-center gap-2 text-sm text-red-600">
            <span className="h-2 w-2 animate-pulse rounded-full bg-red-600" />
            녹음 중…
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
          onChange={(e) => setTranscript(e.target.value)}
          rows={5}
          placeholder="녹음하면 음성 인식 결과가 여기에 채워집니다."
          className="rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm disabled:opacity-40 dark:border-gray-700"
        >
          이전
        </button>

        {isLast ? (
          <button
            type="button"
            onClick={submit}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            제출하고 평가받기
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(questions.length - 1, i + 1))}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            다음
          </button>
        )}
      </div>
    </div>
  );
}
