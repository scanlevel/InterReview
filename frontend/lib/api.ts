// Thin client for the InterReview FastAPI backend.
// The base URL is injected at build time via NEXT_PUBLIC_API_BASE.

import type {
  AnswerItem,
  AnswerReview,
  EssayAnalysis,
  EssayQAItem,
  GenerateQuestionsResponse,
  MeasurementReport,
  Profile,
  TranscriptResponse,
} from "@/lib/types";
import { answerText } from "./essayStore.ts";

export const TTS_START_PROMPT = "시작하세요.";
export const TTS_ANSWER_ACCEPTED_PROMPT = "네, 알겠습니다. 다음 질문으로 넘어가겠습니다.";
export const TTS_LAST_ANSWER_ACCEPTED_PROMPT = "네, 알겠습니다. 면접 답변이 모두 끝났습니다.";
export const TTS_VOICE_IDS = [
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "F1",
  "F2",
  "F3",
  "F4",
  "F5",
] as const;
export type TtsVoiceId = (typeof TTS_VOICE_IDS)[number];
export const DEFAULT_TTS_VOICE_ID: TtsVoiceId = "M1";
export const LOCAL_TTS_MODEL_VERSION = "supertonic-3@1.3.1";

export type TtsRequestErrorCode =
  | "cancelled"
  | "request_timeout"
  | "model_missing"
  | "model_load"
  | "guide_missing"
  | "synthesis"
  | "invalid_voice"
  | "request_failed";

export class TtsRequestError extends Error {
  readonly code: TtsRequestErrorCode;

  constructor(code: TtsRequestErrorCode, message: string) {
    super(message);
    this.name = "TtsRequestError";
    this.code = code;
  }
}

const FIXED_GUIDE_TEXTS = new Set([
  TTS_START_PROMPT,
  TTS_ANSWER_ACCEPTED_PROMPT,
  TTS_LAST_ANSWER_ACCEPTED_PROMPT,
]);
const guideAudioCache = new Map<string, Promise<Blob>>();
const TTS_TIMEOUT_MS = 30_000;

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE ?? "/api";

export interface HealthResponse {
  status: string;
  service: string;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${path} 실패: HTTP ${res.status} ${detail}`.trim());
  }
  return (await res.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE}/health`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Health check failed: HTTP ${res.status}`);
  return (await res.json()) as HealthResponse;
}

export async function getInterviewerImages(): Promise<string[]> {
  const res = await fetch("/interviewer-images", { cache: "no-store" });
  if (!res.ok) throw new Error(`면접관 이미지 목록 실패: HTTP ${res.status}`);

  const body = (await res.json()) as { images?: unknown };
  return Array.isArray(body.images)
    ? body.images.filter((image): image is string => typeof image === "string")
    : [];
}

export function generateQuestions(
  profile: Profile,
  items: EssayQAItem[],
  seed?: number,
): Promise<GenerateQuestionsResponse> {
  return postJson<GenerateQuestionsResponse>("/questions", { profile, items, seed });
}

async function requestSpeech(
  text: string,
  signal: AbortSignal | undefined,
  voiceId: TtsVoiceId,
): Promise<Blob> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TTS_TIMEOUT_MS);
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });

  try {
    const res = await fetch(`${API_BASE}/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice_id: voiceId }),
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as {
        detail?: unknown;
      } | null;
      const detail = body?.detail;
      const errorBody =
        detail && typeof detail === "object"
          ? (detail as { code?: unknown; message?: unknown })
          : null;
      const code = errorBody?.code;
      const knownCode: TtsRequestErrorCode =
        code === "model_missing" ||
        code === "model_load" ||
        code === "guide_missing" ||
        code === "synthesis" ||
        code === "invalid_voice"
          ? code
          : "request_failed";
      const message =
        typeof errorBody?.message === "string"
          ? errorBody.message
          : "로컬 TTS 요청에 실패했습니다.";
      throw new TtsRequestError(knownCode, message);
    }
    return await res.blob();
  } catch (error) {
    if (signal?.aborted) {
      throw new TtsRequestError("cancelled", "음성 안내 요청이 취소되었습니다.");
    }
    if (timedOut) {
      throw new TtsRequestError(
        "request_timeout",
        "음성 안내 요청 시간이 초과되었습니다.",
      );
    }
    if (error instanceof TtsRequestError) throw error;
    throw new TtsRequestError("request_failed", "음성 안내 요청에 실패했습니다.");
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}

/** Fetch local speech; fixed interview guides are cached by model, voice, and text. */
export function synthesizeSpeech(
  text: string,
  signal?: AbortSignal,
  voiceId: TtsVoiceId = DEFAULT_TTS_VOICE_ID,
): Promise<Blob> {
  const cleaned = text.trim().replace(/\s+/gu, " ");
  if (!cleaned) return Promise.reject(new Error("음성 안내 문구가 비어 있습니다."));

  if (FIXED_GUIDE_TEXTS.has(cleaned)) {
    const cacheKey = LOCAL_TTS_MODEL_VERSION + ":" + voiceId + ":" + cleaned;
    const existing = guideAudioCache.get(cacheKey);
    if (existing) return existing;
    const request = requestSpeech(cleaned, signal, voiceId).catch((error) => {
      guideAudioCache.delete(cacheKey);
      throw error;
    });
    guideAudioCache.set(cacheKey, request);
    return request;
  }
  return requestSpeech(cleaned, signal, voiceId);
}

export function getMeasurementReport(
  answers: AnswerItem[],
): Promise<MeasurementReport> {
  return postJson<MeasurementReport>("/measurements", { answers });
}

/** Call the B-owned per-question transcript coaching contract. */
export function reviewAnswer(
  answer: AnswerItem,
  profile: Profile,
  items: EssayQAItem[],
): Promise<AnswerReview> {
  return postJson<AnswerReview>("/answers/review", {
    original_question: answer.original_question ?? answer.question,
    personalized_question: answer.question,
    transcript: answer.transcript,
    essay: answerText(items) || null,
    profile,
  });
}

/** Pull FastAPI's `detail` out of an error response, falling back to `fallback`.
 *
 * The 422 body carries an array of field errors rather than a string, so only a
 * string `detail` is surfaced; anything else uses the caller's message. */
async function errorDetail(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Non-JSON body (proxy error page, empty response) — use the fallback.
  }
  return fallback;
}

/** Track A: analyze one 자기소개서 for its interview weak points.
 *
 * `items`가 있으면 문항(기업 질문+답변) 구조도 함께 보내 질문-답변 정합성까지
 * 분석 대상이 된다. `essay`는 항상 합쳐진 전체 텍스트다.
 *
 * There is no degraded result to fall back to, so a failure surfaces as a
 * thrown Error carrying a message meant for the user. */
export async function analyzeEssay(
  essay: string,
  profile: Profile = {},
  items?: EssayQAItem[],
): Promise<EssayAnalysis> {
  const res = await fetch(`${API_BASE}/essay/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(
      items && items.length > 0 ? { essay, profile, items } : { essay, profile },
    ),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(
      await errorDetail(
        res,
        res.status === 422
          ? "자기소개서를 확인해 주세요."
          : "자소서 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.",
      ),
    );
  }
  return (await res.json()) as EssayAnalysis;
}

/** Upload one recorded answer blob and get its transcript (used from Milestone B). */
export async function transcribe(
  blob: Blob,
  filename = "answer.webm",
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<TranscriptResponse> {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? 180_000);
  const abort = () => controller.abort();
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  const form = new FormData();
  form.append("file", blob, filename);
  try {
    const res = await fetch(`${API_BASE}/stt`, {
      method: "POST",
      body: form,
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`/stt 실패: HTTP ${res.status}`);
    return (await res.json()) as TranscriptResponse;
  } catch (error) {
    if (options.signal?.aborted) {
      throw new Error("음성 인식 요청이 취소되었습니다.");
    }
    if (timedOut) {
      throw new Error("음성 인식 요청 시간이 초과되었습니다.");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener("abort", abort);
  }
}
