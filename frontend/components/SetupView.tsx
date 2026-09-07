"use client";

import type { Profile } from "@/lib/types";
import {
  composeEssay,
  type ApplicantInfo,
  type EssayDraft,
} from "@/lib/essayStore";
import EssayDraftEditor from "@/components/EssayDraftEditor";

export default function SetupView({
  draft,
  onDraftChange,
  applicant,
  onApplicantChange,
  onStart,
}: {
  /** 자소서 첨삭 탭과 공유하는 자소서 draft — 여기서 고쳐도 첨삭 탭에 반영. */
  draft: EssayDraft;
  onDraftChange: (next: EssayDraft) => void;
  /** 이름·지원 직무 — 마찬가지로 첨삭 탭과 공유. */
  applicant: ApplicantInfo;
  onApplicantChange: (next: ApplicantInfo) => void;
  onStart: (profile: Profile) => void;
}) {
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    onStart({
      name: applicant.name.trim() || undefined,
      job: applicant.job.trim() || undefined,
      resume_text: composeEssay(draft) || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <p className="text-sm text-gray-600 dark:text-gray-300">
        질문은행에서 항목별로 한 문항씩 무작위 선택합니다. 아래 정보를 넣으면 선택된 질문만 개인화됩니다.
      </p>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">이름 (선택)</span>
        <input
          value={applicant.name}
          onChange={(event) =>
            onApplicantChange({ ...applicant, name: event.target.value })
          }
          placeholder="홍길동"
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">지원 직무 (선택)</span>
        <input
          value={applicant.job}
          onChange={(event) =>
            onApplicantChange({ ...applicant, job: event.target.value })
          }
          placeholder="백엔드 개발자"
          className="rounded-md border border-gray-300 px-3 py-2 dark:border-gray-700 dark:bg-gray-900"
        />
      </label>

      <div className="flex flex-col gap-1 text-sm">
        <span className="font-medium">자기소개서 (선택)</span>
        <p className="mb-1 text-xs text-gray-500">
          자소서 첨삭 탭과 같은 자소서를 공유합니다 — 여기서 수정하면 첨삭
          탭에도 반영됩니다. 입력하면 이 내용으로 질문을 개인화합니다.
        </p>
        <EssayDraftEditor draft={draft} onChange={onDraftChange} />
      </div>

      <button
        type="submit"
        className="mt-2 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
      >
        다음: 카메라·마이크 설정
      </button>
    </form>
  );
}
