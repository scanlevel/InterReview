"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { analyzeEssay } from "@/lib/api";
import { ESSAY_MAX_LENGTH, type EssayAnalysis } from "@/lib/types";
import {
  activeItems,
  composeEssay,
  loadAnalysis,
  loadApplicant,
  loadDraft,
  saveAnalysis,
  saveDraft,
  subscribeToStore,
  type EssayDraft,
} from "@/lib/essayStore";
import EssayAnalysisResult from "@/components/EssayAnalysisResult";
import EssayDraftEditor from "@/components/EssayDraftEditor";
import EssayHighlightView, {
  HighlightLegend,
} from "@/components/EssayHighlightView";
import PageShell from "@/components/PageShell";

/** Track A — 분석 결과. 자소서를 바로 수정해 다시 첨삭받거나,
 * 수정한 자소서를 모의 인터뷰로 넘긴다. 문항형 자소서는 하이라이트도
 * 문항별 섹션으로 나뉜다. */
export default function EssayResultPage() {
  const router = useRouter();
  // Storage snapshots as the base; edits and re-analysis layered on top.
  // The server snapshots are undefined = "not known yet", so SSR renders an
  // empty shell instead of flashing the wrong branch before hydration.
  const storedDraft = useSyncExternalStore(
    subscribeToStore,
    loadDraft,
    () => undefined,
  );
  const storedAnalysis = useSyncExternalStore(
    subscribeToStore,
    loadAnalysis,
    () => undefined,
  );
  const [edited, setEdited] = useState<EssayDraft | null>(null);
  const [freshAnalysis, setFreshAnalysis] = useState<EssayAnalysis | null>(null);
  const draft = edited ?? storedDraft;
  const analysis = freshAnalysis ?? storedAnalysis;
  const [mode, setMode] = useState<"highlight" | "edit">("highlight");
  // Edited since the analysis currently on screen was produced?
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 결과 카드 hover → 해당 원문 인용 강조; 클릭 → nonce를 올려 스크롤 요청.
  const [focusQuotes, setFocusQuotes] = useState<string[] | null>(null);
  const [scrollNonce, setScrollNonce] = useState(0);

  function handleSelectQuotes(quotes: string[]) {
    setMode("highlight");
    setFocusQuotes(quotes);
    setScrollNonce((nonce) => nonce + 1);
  }

  const essayText = draft ? composeEssay(draft) : "";
  const canSubmit =
    essayText.length > 0 && essayText.length <= ESSAY_MAX_LENGTH && !busy;

  function handleChange(next: EssayDraft) {
    setEdited(next);
    setDirty(true);
    saveDraft(next);
  }

  async function handleReanalyze() {
    if (!draft) return;
    setError(null);
    setBusy(true);
    try {
      const items = draft.mode === "qa" ? activeItems(draft) : undefined;
      // 입력 페이지에서 저장해 둔 이름·직무를 재분석에도 동일하게 싣는다.
      const applicant = loadApplicant();
      const next = await analyzeEssay(
        essayText,
        {
          name: applicant.name.trim() || undefined,
          job: applicant.job.trim() || undefined,
        },
        items,
      );
      saveAnalysis(next);
      setFreshAnalysis(next);
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // 두 탭이 같은 draft를 공유하므로 이동만 하면 그대로 연동된다.
  function handleHandoff() {
    router.push("/interview");
  }

  // undefined = still hydrating; null = client confirmed there is no result.
  if (analysis === undefined || draft === undefined) {
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
            <div className="flex items-center gap-1 rounded-md border border-gray-300 p-0.5 text-sm dark:border-gray-700">
              <button
                type="button"
                onClick={() => setMode("highlight")}
                className={`rounded px-3 py-1 ${
                  mode === "highlight"
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500"
                }`}
              >
                하이라이트 보기
              </button>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className={`rounded px-3 py-1 ${
                  mode === "edit"
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500"
                }`}
              >
                편집
              </button>
            </div>
            <Link
              href="/essay"
              className="text-sm text-gray-500 underline underline-offset-4"
            >
              입력 화면으로
            </Link>
          </div>

          {mode === "highlight" && dirty && (
            <p className="rounded-md bg-gray-50 p-2 text-xs text-gray-500 dark:bg-gray-900">
              수정한 뒤 아직 재분석하지 않았습니다 — 하이라이트는 마지막 분석
              기준이라, 고친 문장의 표시는 사라져 있을 수 있습니다.
            </p>
          )}

          {mode === "highlight" && draft.mode === "free" && (
            <EssayHighlightView
              essay={draft.free}
              analysis={analysis}
              focusQuotes={focusQuotes}
              scrollNonce={scrollNonce}
            />
          )}

          {mode === "highlight" && draft.mode === "qa" && (
            <div className="flex flex-col gap-2">
              <HighlightLegend />
              <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
                {draft.items.map((item, index) =>
                  item.answer.trim() ? (
                    <section key={index} className="flex flex-col gap-1">
                      <p className="text-xs font-medium text-gray-500">
                        문항 {index + 1}
                        {item.question.trim() ? `. ${item.question.trim()}` : ""}
                      </p>
                      <EssayHighlightView
                        essay={item.answer}
                        analysis={analysis}
                        focusQuotes={focusQuotes}
                        scrollNonce={scrollNonce}
                        showLegend={false}
                        scrollable={false}
                        showUnmatchedHint={false}
                      />
                    </section>
                  ) : null,
                )}
              </div>
            </div>
          )}

          {mode === "edit" && (
            <EssayDraftEditor draft={draft} onChange={handleChange} />
          )}

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

        {/* 좁은 화면에서는 페이지 스크롤이 자연스러우므로 lg 이상에서만
            내부 스크롤로 잘라 두 패널이 한 화면에 들어오게 한다. */}
        <div className="lg:max-h-[80vh] lg:overflow-y-auto lg:pr-1">
          {analysis && (
            <EssayAnalysisResult
              analysis={analysis}
              onFocusQuotes={setFocusQuotes}
              onSelectQuotes={handleSelectQuotes}
            />
          )}
        </div>
      </div>
    </PageShell>
  );
}
