"use client";

import type {
  EssayAnalysis,
  EssayExperience,
  RiskLevel,
} from "@/lib/types";

/** Track A — 자소서 분석 결과 표시.
 *
 * The risk badge describes how exposed an experience is in an interview, not
 * how good the applicant is — plan.md §12 rules out scoring the person.
 *
 * `onFocusQuotes`/`onSelectQuotes`가 주어지면 카드·약점·주장에 hover/클릭
 * 연동이 붙는다: hover는 해당 원문 인용을 강조하고, 클릭은 그 위치로 이동을
 * 요청한다. 약점에 자체 인용이 없으면 경험의 인용으로 폴백한다. */

interface InteractionProps {
  onFocusQuotes?: (quotes: string[] | null) => void;
  onSelectQuotes?: (quotes: string[]) => void;
}

const RISK_STYLES: Record<RiskLevel, string> = {
  5: "border border-risk-high-line bg-risk-high-bg text-risk-high-text",
  4: "border border-risk-high-line bg-risk-high-bg text-risk-high-text",
  3: "border border-risk-mid-line bg-risk-mid-bg text-risk-mid-text",
  2: "border border-risk-low-line bg-risk-low-bg text-risk-low-text",
  1: "border border-risk-low-line bg-risk-low-bg text-risk-low-text",
};

/** 시안의 exp-card 왼쪽 컬러 스파인 — 카드만 훑어도 위험 서열이 보인다. */
const SPINE_STYLES: Record<RiskLevel, string> = {
  5: "border-l-risk-high-text",
  4: "border-l-risk-high-text",
  3: "border-l-risk-mid-text",
  2: "border-l-risk-low-text",
  1: "border-l-risk-low-text",
};

/** Every quote belonging to an experience, weakness quotes included. */
function experienceQuotes(item: EssayExperience): string[] {
  return [
    ...(item.source_quotes ?? []),
    ...item.weaknesses.flatMap((weakness) => weakness.source_quotes ?? []),
  ];
}

function ExperienceCard({
  item,
  onFocusQuotes,
  onSelectQuotes,
}: { item: EssayExperience } & InteractionProps) {
  const cardQuotes = experienceQuotes(item);
  const interactive = Boolean(onFocusQuotes || onSelectQuotes);

  return (
    <section
      className={`rounded-lg border border-line border-l-[3px] bg-surface p-5 shadow-card transition-shadow ${SPINE_STYLES[item.risk_level]} ${
        interactive ? "cursor-pointer hover:ring-1 hover:ring-accent" : ""
      }`}
      onMouseEnter={() => onFocusQuotes?.(cardQuotes)}
      onMouseLeave={() => onFocusQuotes?.(null)}
      onClick={() => onSelectQuotes?.(cardQuotes)}
    >
      <div className="mb-2 flex items-start gap-2.5">
        <span
          className={`mt-0.5 shrink-0 rounded px-2 py-0.5 text-[11px] font-bold ${RISK_STYLES[item.risk_level]}`}
        >
          위험도 {item.risk_level}
        </span>
        <p className="text-sm font-semibold leading-relaxed text-ink">
          {item.experience}
        </p>
      </div>
      <p className="text-xs text-faint">{item.risk_reason}</p>

      {item.claims.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          <span className="font-semibold">뒷받침하는 주장</span>{" "}
          {item.claims.join(" · ")}
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {item.weaknesses.map((weakness, index) => {
          const quotes =
            (weakness.source_quotes ?? []).length > 0
              ? (weakness.source_quotes ?? [])
              : cardQuotes;
          return (
            <div
              key={index}
              className="rounded-md border border-line-soft bg-surface-soft p-3"
              onMouseEnter={() => onFocusQuotes?.(quotes)}
              onMouseLeave={() => onFocusQuotes?.(cardQuotes)}
              onClick={(event) => {
                if (!onSelectQuotes) return;
                event.stopPropagation();
                onSelectQuotes(quotes);
              }}
            >
              <p className="text-sm font-medium text-ink-2">
                {weakness.description}
              </p>
              {weakness.expected_questions.length > 0 && (
                <ul className="mt-2 flex flex-col gap-1.5 border-t border-dashed border-line pt-2">
                  {weakness.expected_questions.map((question, qIndex) => (
                    <li
                      key={qIndex}
                      className="flex gap-1.5 text-xs font-semibold leading-relaxed text-brand-2"
                    >
                      <span className="shrink-0 font-extrabold text-accent">
                        Q.
                      </span>{" "}
                      {question}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default function EssayAnalysisResult({
  analysis,
  onFocusQuotes,
  onSelectQuotes,
}: { analysis: EssayAnalysis } & InteractionProps) {
  const interactive = Boolean(onFocusQuotes || onSelectQuotes);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-bold text-brand">
        경험 {analysis.experiences.length}건 · 위험도가 높은 순
      </h2>

      {analysis.experiences.length === 0 && (
        <p className="text-sm text-muted">
          분석할 경험을 찾지 못했습니다. 구체적인 경험을 담아 다시 작성해
          보세요.
        </p>
      )}

      {analysis.experiences.map((item, index) => (
        <ExperienceCard
          key={index}
          item={item}
          onFocusQuotes={onFocusQuotes}
          onSelectQuotes={onSelectQuotes}
        />
      ))}

      {analysis.unsupported_claims.length > 0 && (
        <section className="rounded-lg border border-claim-line bg-surface p-5 shadow-card">
          <h3 className="mb-1 text-sm font-bold text-claim-text">
            근거가 되는 경험이 없는 주장
          </h3>
          <p className="mb-3 text-xs text-faint">
            면접에서 &ldquo;그렇게 생각하는 근거가 무엇인가요?&rdquo;라는
            질문을 받기 쉬운 문장입니다.
          </p>
          <ul className="flex flex-col gap-2">
            {analysis.unsupported_claims.map((claim, index) => (
              <li
                key={index}
                className={`rounded-md border border-claim-line bg-claim-bg px-3 py-2 text-sm leading-relaxed text-ink-2 transition-colors ${
                  interactive ? "cursor-pointer hover:border-claim-text" : ""
                }`}
                onMouseEnter={() => onFocusQuotes?.([claim])}
                onMouseLeave={() => onFocusQuotes?.(null)}
                onClick={() => onSelectQuotes?.([claim])}
              >
                · {claim}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
