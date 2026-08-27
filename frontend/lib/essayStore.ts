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

import type { EssayAnalysis } from "@/lib/types";

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

export function loadEssayDraft(): string {
  return read(DRAFT_KEY) ?? "";
}

export function saveEssayDraft(essay: string): void {
  write(DRAFT_KEY, essay);
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
