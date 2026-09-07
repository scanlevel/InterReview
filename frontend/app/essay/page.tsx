"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { analyzeEssay } from "@/lib/api";
import { ESSAY_MAX_LENGTH } from "@/lib/types";
import {
  activeItems,
  composeEssay,
  DEFAULT_DRAFT,
  loadDraft,
  saveAnalysis,
  saveDraft,
  subscribeToStore,
  type EssayDraft,
} from "@/lib/essayStore";
import EssayDraftEditor from "@/components/EssayDraftEditor";
import PageShell from "@/components/PageShell";

/** Track A — 자소서 입력. 분석하면 /essay/result로 이동한다. */
export default function EssayPage() {
  const router = useRouter();
  // sessionStorage draft as the base; local edits layered on top. The server
  // snapshot is the stable default so SSR markup stays consistent until
  // hydration completes.
  const storedDraft = useSyncExternalStore(
    subscribeToStore,
    loadDraft,
    () => DEFAULT_DRAFT,
  );
  const [edited, setEdited] = useState<EssayDraft | null>(null);
  const draft = edited ?? storedDraft;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const essayText = composeEssay(draft);
  // Mirrors the backend's own bounds so an unusable essay never round-trips.
  const canSubmit = essayText.length > 0 && essayText.length <= ESSAY_MAX_LENGTH;

  function handleChange(next: EssayDraft) {
    setEdited(next);
    saveDraft(next);
  }

  async function handleAnalyze() {
    setError(null);
    setBusy(true);
    try {
      const items = draft.mode === "qa" ? activeItems(draft) : undefined;
      const analysis = await analyzeEssay(essayText, {}, items);
      saveDraft(draft);
      saveAnalysis(analysis);
      router.push("/essay/result");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <PageShell>
      <div className="flex flex-col gap-6">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          자기소개서에서 면접관이 파고들 약점과 예상 질문을 찾아 드립니다.
          기업이 문항을 제시하는 자소서라면 문항별 입력으로 질문까지 함께
          넣어 주세요 — 답변이 질문 의도를 비껴가는지도 분석합니다.
        </p>

        <EssayDraftEditor draft={draft} onChange={handleChange} />

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!canSubmit || busy}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            {busy ? "분석하는 중… (1분 정도 걸립니다)" : "분석하기"}
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40">
            {error}
          </div>
        )}
      </div>
    </PageShell>
  );
}
