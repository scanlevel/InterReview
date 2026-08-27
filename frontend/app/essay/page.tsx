"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { analyzeEssay } from "@/lib/api";
import { ESSAY_MAX_LENGTH } from "@/lib/types";
import {
  loadEssayDraft,
  saveAnalysis,
  saveEssayDraft,
  subscribeToStore,
} from "@/lib/essayStore";
import PageShell from "@/components/PageShell";

/** Track A — 자소서 입력. 분석하면 /essay/result로 이동한다. */
export default function EssayPage() {
  const router = useRouter();
  // sessionStorage draft as the base; local edits layered on top. The server
  // snapshot is "" so SSR markup stays consistent until hydration completes.
  const storedDraft = useSyncExternalStore(
    subscribeToStore,
    loadEssayDraft,
    () => "",
  );
  const [edited, setEdited] = useState<string | null>(null);
  const essay = edited ?? storedDraft;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = essay.trim();
  // Mirrors the backend's own bounds so an unusable essay never round-trips.
  const canSubmit = trimmed.length > 0 && trimmed.length <= ESSAY_MAX_LENGTH;

  function handleChange(next: string) {
    setEdited(next);
    saveEssayDraft(next);
  }

  async function handleAnalyze() {
    setError(null);
    setBusy(true);
    try {
      const analysis = await analyzeEssay(trimmed);
      saveEssayDraft(essay);
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
        </p>

        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">자기소개서</span>
          <textarea
            value={essay}
            onChange={(e) => handleChange(e.target.value)}
            rows={16}
            placeholder="자기소개서 전문을 붙여넣어 주세요."
            className="rounded-md border border-gray-300 px-3 py-2 leading-relaxed dark:border-gray-700 dark:bg-gray-900"
          />
          <span
            className={`self-end text-xs ${
              trimmed.length > ESSAY_MAX_LENGTH ? "text-red-600" : "text-gray-500"
            }`}
          >
            {trimmed.length.toLocaleString()} / {ESSAY_MAX_LENGTH.toLocaleString()}자
          </span>
        </label>

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
