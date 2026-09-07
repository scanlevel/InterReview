// Session-scoped persistence for the Track A essay flow (Track A — A 담당).
//
// Three slots, all per-browser-tab (sessionStorage):
//  - draft:    the essay text being edited on /essay and /essay/result
//  - analysis: the last analysis result, so /essay/result survives a reload
//  - handoff:  the essay the user chose to carry into the interview tab
//
// sessionStorage can throw (private mode, storage disabled), so every access
// is guarded — the flow must still work, it just won't survive reloads.
//
// The load functions are written to be usable as useSyncExternalStore
// snapshots: they return referentially stable values for unchanged storage.

import type { EssayAnalysis, EssayQAItem } from "@/lib/types";

/** The essay being written: 문항형(qa) 또는 자유 형식(free). 두 형식의 내용을
 * 모두 들고 있어 토글로 오가도 입력이 사라지지 않는다. */
export interface EssayDraft {
  mode: "qa" | "free";
  free: string;
  items: EssayQAItem[];
}

/** sessionStorage fires no events for the writing tab, so there is nothing to
 * subscribe to — pages layer their own edit state on top of the snapshot. */
export function subscribeToStore(): () => void {
  return () => {};
}

const DRAFT_KEY = "interreview.essay.draft";
const ANALYSIS_KEY = "interreview.essay.analysis";
const HANDOFF_KEY = "interreview.interview.essay";

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // Storage unavailable — nothing to do.
  }
}

/** Referentially stable "nothing stored yet" draft (useSyncExternalStore). */
export const DEFAULT_DRAFT: EssayDraft = {
  mode: "qa",
  free: "",
  items: [{ question: "", answer: "" }],
};

function isDraftShape(value: unknown): value is EssayDraft {
  if (typeof value !== "object" || value === null) return false;
  const draft = value as Partial<EssayDraft>;
  return (
    (draft.mode === "qa" || draft.mode === "free") &&
    typeof draft.free === "string" &&
    Array.isArray(draft.items) &&
    draft.items.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof item.question === "string" &&
        typeof item.answer === "string",
    )
  );
}

let draftCache: { raw: string; value: EssayDraft } | null = null;

export function loadDraft(): EssayDraft {
  const raw = read(DRAFT_KEY);
  if (!raw) return DEFAULT_DRAFT;
  if (draftCache?.raw === raw) return draftCache.value;
  let value: EssayDraft;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isDraftShape(parsed)) throw new Error("not a draft");
    value = {
      ...parsed,
      items: parsed.items.length > 0 ? parsed.items : [{ question: "", answer: "" }],
    };
  } catch {
    // Legacy draft from before the QA format: a plain essay string.
    value = { mode: "free", free: raw, items: [{ question: "", answer: "" }] };
  }
  draftCache = { raw, value };
  return value;
}

export function saveDraft(draft: EssayDraft): void {
  write(DRAFT_KEY, JSON.stringify(draft));
}

/** 문항 목록에서 실제 분석에 쓰일 것만 — 답변이 빈 문항은 제외. */
export function activeItems(draft: EssayDraft): EssayQAItem[] {
  return draft.items
    .map((item) => ({ question: item.question.trim(), answer: item.answer.trim() }))
    .filter((item) => item.answer.length > 0);
}

/** 현재 형식 기준의 전체 자소서 텍스트 — 길이 검증·재분석·면접 연동에 쓴다. */
export function composeEssay(draft: EssayDraft): string {
  if (draft.mode === "free") return draft.free.trim();
  return activeItems(draft)
    .map((item, index) =>
      item.question
        ? `[문항 ${index + 1}] ${item.question}\n${item.answer}`
        : item.answer,
    )
    .join("\n\n");
}

// Snapshot cache: JSON.parse would otherwise return a fresh object on every
// call, which useSyncExternalStore would treat as a change and loop on.
let analysisCache: { raw: string; value: EssayAnalysis } | null = null;

export function loadAnalysis(): EssayAnalysis | null {
  const raw = read(ANALYSIS_KEY);
  if (!raw) return null;
  if (analysisCache?.raw === raw) return analysisCache.value;
  try {
    const value = JSON.parse(raw) as EssayAnalysis;
    analysisCache = { raw, value };
    return value;
  } catch {
    return null;
  }
}

export function saveAnalysis(analysis: EssayAnalysis | null): void {
  write(ANALYSIS_KEY, analysis === null ? null : JSON.stringify(analysis));
}

/** The essay handed off to the interview tab, or null if none/blank. */
export function loadInterviewEssay(): string | null {
  const value = read(HANDOFF_KEY);
  return value && value.trim() ? value : null;
}

export function saveInterviewEssay(essay: string | null): void {
  write(HANDOFF_KEY, essay);
}
