"use client";

import { composeEssay, type EssayDraft } from "@/lib/essayStore";
import { ESSAY_MAX_LENGTH } from "@/lib/types";

/** Track A — 자소서 draft 편집기 (/essay 입력, /essay/result 편집 모드 공용).
 *
 * 형식 토글(문항별 / 자유 형식)과 그 아래 입력 UI를 함께 그린다. 두 형식의
 * 입력값은 draft에 모두 남아 있어 토글을 오가도 지워지지 않고, 글자수는
 * 실제로 분석에 보낼 합쳐진 텍스트(composeEssay) 기준으로 센다. */

const FIELD_CLASS =
  "rounded-md border border-gray-300 px-3 py-2 leading-relaxed dark:border-gray-700 dark:bg-gray-900";

export default function EssayDraftEditor({
  draft,
  onChange,
}: {
  draft: EssayDraft;
  onChange: (next: EssayDraft) => void;
}) {
  const composedLength = composeEssay(draft).length;

  function updateItem(index: number, patch: Partial<EssayDraft["items"][number]>) {
    const items = draft.items.map((item, i) =>
      i === index ? { ...item, ...patch } : item,
    );
    onChange({ ...draft, items });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-1 self-start rounded-md border border-gray-300 p-0.5 text-sm dark:border-gray-700">
        {(
          [
            ["qa", "문항별 입력"],
            ["free", "자유 형식"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...draft, mode })}
            className={`rounded px-3 py-1 ${
              draft.mode === mode
                ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                : "text-gray-500"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {draft.mode === "qa" && (
        <div className="flex flex-col gap-4">
          {draft.items.map((item, index) => (
            <fieldset
              key={index}
              className="flex flex-col gap-2 rounded-lg border border-gray-200 p-4 dark:border-gray-800"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">문항 {index + 1}</span>
                {draft.items.length > 1 && (
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...draft,
                        items: draft.items.filter((_, i) => i !== index),
                      })
                    }
                    className="text-xs text-gray-500 hover:text-red-600"
                  >
                    삭제
                  </button>
                )}
              </div>
              <input
                value={item.question}
                onChange={(e) => updateItem(index, { question: e.target.value })}
                placeholder="기업 질문 (예: 지원 동기를 말해 주세요) — 없으면 비워 두세요"
                className={`text-sm ${FIELD_CLASS}`}
              />
              <textarea
                value={item.answer}
                onChange={(e) => updateItem(index, { answer: e.target.value })}
                rows={8}
                placeholder="이 문항에 대한 답변을 입력해 주세요."
                className={`text-sm ${FIELD_CLASS}`}
              />
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...draft,
                items: [...draft.items, { question: "", answer: "" }],
              })
            }
            className="self-start rounded-md border border-dashed border-gray-300 px-4 py-2 text-sm text-gray-500 hover:border-gray-500 hover:text-gray-700 dark:border-gray-700 dark:hover:text-gray-300"
          >
            + 문항 추가
          </button>
        </div>
      )}

      {draft.mode === "free" && (
        <textarea
          value={draft.free}
          onChange={(e) => onChange({ ...draft, free: e.target.value })}
          rows={16}
          placeholder="자기소개서 전문을 붙여넣어 주세요."
          className={`text-sm ${FIELD_CLASS}`}
        />
      )}

      <span
        className={`self-end text-xs ${
          composedLength > ESSAY_MAX_LENGTH ? "text-red-600" : "text-gray-500"
        }`}
      >
        {composedLength.toLocaleString()} / {ESSAY_MAX_LENGTH.toLocaleString()}자
      </span>
    </div>
  );
}
