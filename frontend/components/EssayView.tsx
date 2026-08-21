"use client";

import { useState } from "react";
import { analyzeEssay } from "@/lib/api";
import {
  ESSAY_MAX_LENGTH,
  type EssayAnalysis,
  type EssayExperience,
  type RiskLevel,
} from "@/lib/types";

/** Track A — 자소서 첨삭.
 *
 * 자기소개서 입력 → 분석하기 → 약점 → 예상 질문 (plan.md §2).
 *
 * The risk badge describes how exposed an experience is in an interview, not
 * how good the applicant is — plan.md §12 rules out scoring the person. */

const RISK_STYLES: Record<RiskLevel, string> = {
  5: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  4: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  3: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  2: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  1: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
};

function ExperienceCard({ item }: { item: EssayExperience }) {
  return (
    <section className="rounded-lg border border-gray-200 p-5 dark:border-gray-800">
      <div className="mb-2 flex items-start justify-between gap-4">
        <p className="text-sm font-medium leading-relaxed">{item.experience}</p>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${RISK_STYLES[item.risk_level]}`}
        >
          위험도 {item.risk_level}
        </span>
      </div>
      <p className="text-xs text-gray-500">{item.risk_reason}</p>

      {item.claims.length > 0 && (
        <p className="mt-3 text-xs text-gray-500">
          <span className="font-medium">뒷받침하는 주장</span>{" "}
          {item.claims.join(" · ")}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {item.weaknesses.map((weakness, index) => (
          <div
            key={index}
            className="rounded-md bg-gray-50 p-3 dark:bg-gray-900"
          >
            <p className="text-sm font-medium">{weakness.description}</p>
            {weakness.expected_questions.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1">
                {weakness.expected_questions.map((question, qIndex) => (
                  <li
                    key={qIndex}
                    className="text-xs leading-relaxed text-gray-600 dark:text-gray-300"
                  >
                    Q. {question}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function EssayView({ onBack }: { onBack: () => void }) {
  const [essay, setEssay] = useState("");
  const [analysis, setAnalysis] = useState<EssayAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = essay.trim();
  // Mirrors the backend's own bounds so an unusable essay never round-trips.
  const canSubmit = trimmed.length > 0 && essay.length <= ESSAY_MAX_LENGTH;

  async function handleAnalyze() {
    setError(null);
    setBusy(true);
    try {
      setAnalysis(await analyzeEssay(trimmed));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600 dark:text-gray-300">
          자기소개서에서 면접관이 파고들 약점과 예상 질문을 찾아 드립니다.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="shrink-0 text-sm text-gray-500 underline underline-offset-4"
        >
          돌아가기
        </button>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">자기소개서</span>
        <textarea
          value={essay}
          onChange={(e) => setEssay(e.target.value)}
          rows={12}
          placeholder="자기소개서 전문을 붙여넣어 주세요."
          className="rounded-md border border-gray-300 px-3 py-2 leading-relaxed dark:border-gray-700 dark:bg-gray-900"
        />
        <span
          className={`self-end text-xs ${
            essay.length > ESSAY_MAX_LENGTH ? "text-red-600" : "text-gray-500"
          }`}
        >
          {essay.length.toLocaleString()} / {ESSAY_MAX_LENGTH.toLocaleString()}자
        </span>
      </label>

      <button
        type="button"
        onClick={handleAnalyze}
        disabled={!canSubmit || busy}
        className="self-start rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-40 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200"
      >
        {busy ? "분석하는 중…" : "분석하기"}
      </button>

      {error && (
        <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40">
          {error}
        </div>
      )}

      {analysis && (
        <div className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold">
            경험 {analysis.experiences.length}건 · 위험도가 높은 순
          </h2>

          {analysis.experiences.length === 0 && (
            <p className="text-sm text-gray-500">
              분석할 경험을 찾지 못했습니다. 구체적인 경험을 담아 다시
              작성해 보세요.
            </p>
          )}

          {analysis.experiences.map((item, index) => (
            <ExperienceCard key={index} item={item} />
          ))}

          {analysis.unsupported_claims.length > 0 && (
            <section className="rounded-lg border border-gray-200 p-5 dark:border-gray-800">
              <h3 className="mb-1 text-sm font-medium">
                근거가 되는 경험이 없는 주장
              </h3>
              <p className="mb-3 text-xs text-gray-500">
                면접에서 &ldquo;그렇게 생각하는 근거가 무엇인가요?&rdquo;라는
                질문을 받기 쉬운 문장입니다.
              </p>
              <ul className="flex flex-col gap-1">
                {analysis.unsupported_claims.map((claim, index) => (
                  <li
                    key={index}
                    className="text-sm text-gray-600 dark:text-gray-300"
                  >
                    · {claim}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
