"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { analyzeEssay } from "@/lib/api";
import { ESSAY_MAX_LENGTH } from "@/lib/types";
import {
  activeItems,
  composeEssay,
  DEFAULT_APPLICANT,
  DEFAULT_DRAFT,
  loadApplicant,
  loadDraft,
  saveAnalysis,
  saveApplicant,
  saveDraft,
  subscribeToStore,
  type ApplicantInfo,
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
  // 이름·지원 직무 — 면접 설정 화면과 공유한다.
  const storedApplicant = useSyncExternalStore(
    subscribeToStore,
    loadApplicant,
    () => DEFAULT_APPLICANT,
  );
  const [editedApplicant, setEditedApplicant] = useState<ApplicantInfo | null>(
    null,
  );
  const applicant = editedApplicant ?? storedApplicant;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const essayText = composeEssay(draft);
  // Mirrors the backend's own bounds so an unusable essay never round-trips.
  const canSubmit = essayText.length > 0 && essayText.length <= ESSAY_MAX_LENGTH;

  function handleChange(next: EssayDraft) {
    setEdited(next);
    saveDraft(next);
  }

  function handleApplicantChange(next: ApplicantInfo) {
    setEditedApplicant(next);
    saveApplicant(next);
  }

  async function handleAnalyze() {
    setError(null);
    setBusy(true);
    try {
      const items = draft.mode === "qa" ? activeItems(draft) : undefined;
      const analysis = await analyzeEssay(
        essayText,
        {
          name: applicant.name.trim() || undefined,
          job: applicant.job.trim() || undefined,
        },
        items,
      );
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
        <p className="text-sm text-muted">
          자기소개서에서 면접관이 파고들 약점과 예상 질문을 찾아 드립니다.
          기업이 문항을 제시하는 자소서라면 문항별 입력으로 질문까지 함께
          넣어 주세요 — 답변이 질문 의도를 비껴가는지도 분석합니다.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-2">이름 (선택)</span>
            <input
              value={applicant.name}
              onChange={(e) =>
                handleApplicantChange({ ...applicant, name: e.target.value })
              }
              placeholder="홍길동"
              className="rounded-md border border-line bg-surface px-3 py-2 focus:border-accent focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink-2">지원 직무 (선택)</span>
            <input
              value={applicant.job}
              onChange={(e) =>
                handleApplicantChange({ ...applicant, job: e.target.value })
              }
              placeholder="백엔드 개발자"
              className="rounded-md border border-line bg-surface px-3 py-2 focus:border-accent focus:outline-none"
            />
          </label>
        </div>

        <EssayDraftEditor draft={draft} onChange={handleChange} />

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={handleAnalyze}
            disabled={!canSubmit || busy}
            className="rounded-md bg-brand-2 px-[18px] py-[9px] text-[13.5px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
          >
            {busy ? "분석하는 중… (1분 정도 걸립니다)" : "분석하기"}
          </button>
        </div>

        {error && (
          <div className="rounded-md border border-risk-high-line bg-risk-high-bg p-3 text-sm text-risk-high-text">
            {error}
          </div>
        )}
      </div>
    </PageShell>
  );
}
