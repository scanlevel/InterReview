"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { analyzeEssay } from "@/lib/api";
import { ESSAY_MAX_LENGTH, type EssayAnalysis } from "@/lib/types";
import {
  loadAnalysis,
  loadEssayDraft,
  saveAnalysis,
  saveEssayDraft,
  saveInterviewEssay,
  subscribeToStore,
} from "@/lib/essayStore";
import EssayAnalysisResult from "@/components/EssayAnalysisResult";
import PageShell from "@/components/PageShell";

/** Track A — 분석 결과. 자소서를 바로 수정해 다시 첨삭받거나,
 * 수정한 자소서를 모의 인터뷰로 넘긴다. */
export default function EssayResultPage() {
  const router = useRouter();
  // Storage snapshots as the base; edits and re-analysis layered on top.
  // The server snapshots are undefined = "not known yet", so SSR renders an
  // empty shell instead of flashing the wrong branch before hydration.
  const storedDraft = useSyncExternalStore(
    subscribeToStore,
    loadEssayDraft,
    () => undefined,
  );
  const storedAnalysis = useSyncExternalStore(
    subscribeToStore,
    loadAnalysis,
    () => undefined,
  );
  const [edited, setEdited] = useState<string | null>(null);
  const [freshAnalysis, setFreshAnalysis] = useState<EssayAnalysis | null>(null);
  const essay = edited ?? storedDraft ?? "";
  const analysis = freshAnalysis ?? storedAnalysis;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = essay.trim();
  const canSubmit =
    trimmed.length > 0 && trimmed.length <= ESSAY_MAX_LENGTH && !busy;

  function handleChange(next: string) {
    setEdited(next);
    saveEssayDraft(next);
  }

  async function handleReanalyze() {
    setError(null);
    setBusy(true);
    try {
      const next = await analyzeEssay(trimmed);
      saveAnalysis(next);
      setFreshAnalysis(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function handleHandoff() {
    saveInterviewEssay(trimmed);
    router.push("/interview");
  }

  // undefined = still hydrating; null = client confirmed there is no result.
  if (analysis === undefined) {
    return <PageShell wide>{null}</PageShell>;
  }

  if (analysis === null) {
    return (
      <PageShell>
        <div className="flex flex-col items-start gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            아직 분석 결과가 없습니다. 자소서를 입력하고 분석부터 진행해
            주세요.
          </p>
          <Link
            href="/essay"
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
          >
            자소서 입력하러 가기
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell wide>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">자기소개서 수정</h2>
            <Link
              href="/essay"
              className="text-sm text-gray-500 underline underline-offset-4"
            >
              입력 화면으로
            </Link>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <textarea
              value={essay}
              onChange={(e) => handleChange(e.target.value)}
              rows={22}
              className="rounded-md border border-gray-300 px-3 py-2 leading-relaxed dark:border-gray-700 dark:bg-gray-900"
            />
            <span
              className={`self-end text-xs ${
                trimmed.length > ESSAY_MAX_LENGTH
                  ? "text-red-600"
                  : "text-gray-500"
              }`}
            >
              {trimmed.length.toLocaleString()} /{" "}
              {ESSAY_MAX_LENGTH.toLocaleString()}자
            </span>
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleReanalyze}
              disabled={!canSubmit}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
            >
              {busy ? "분석하는 중… (1분 정도 걸립니다)" : "다시 분석하기"}
            </button>
            <button
              type="button"
              onClick={handleHandoff}
              disabled={!canSubmit}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium hover:border-gray-500 disabled:opacity-40 dark:border-gray-700 dark:hover:border-gray-500"
            >
              이 자소서로 모의 인터뷰 보기
            </button>
          </div>

          {error && (
            <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40">
              {error}
            </div>
          )}
        </div>

        <div>{analysis && <EssayAnalysisResult analysis={analysis} />}</div>
      </div>
    </PageShell>
  );
}
