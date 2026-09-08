"use client";

import { useEffect, useMemo, useRef } from "react";
import type { EssayAnalysis } from "@/lib/types";

/** Track A — 자소서 원문 하이라이트 보기.
 *
 * 분석 결과의 source_quotes / unsupported_claims를 원문에서 찾아 위험도색으로
 * 칠한다. 인용은 LLM이 "원문 그대로"라고 약속한 것일 뿐이므로 여기서 실제로
 * 매칭해 검증하고, 찾지 못한 인용은 조용히 건너뛴다 (환각이거나 사용자가 그
 * 문장을 수정한 경우 — 어느 쪽이든 표시하지 않는 것이 맞다).
 *
 * `focusQuotes`가 오면 그 인용 구간만 강조하고 나머지 하이라이트는 흐리게
 * 만든다 (결과 카드 hover 연동). `scrollNonce`가 바뀌면 강조된 첫 구간으로
 * 스크롤한다 (카드 클릭 연동). */

// Paint values: 1-5 = experience risk_level, CLAIM = unsupported claim.
const CLAIM = -1;

const HIGHLIGHT_STYLES: Record<number, string> = {
  5: "bg-red-200 dark:bg-red-900/70",
  4: "bg-red-200 dark:bg-red-900/70",
  3: "bg-amber-200 dark:bg-amber-900/70",
  2: "bg-gray-200 dark:bg-gray-700",
  1: "bg-gray-200 dark:bg-gray-700",
  [CLAIM]: "bg-sky-200 dark:bg-sky-900/70",
};

const LEGEND: { label: string; className: string }[] = [
  { label: "위험도 4–5", className: HIGHLIGHT_STYLES[5] },
  { label: "위험도 3", className: HIGHLIGHT_STYLES[3] },
  { label: "위험도 1–2", className: HIGHLIGHT_STYLES[1] },
  { label: "근거 없는 주장", className: HIGHLIGHT_STYLES[CLAIM] },
];

/** 색상 범례 — 문항별 보기처럼 뷰가 여러 개일 때 한 번만 그리도록 분리. */
export function HighlightLegend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-gray-500">
      {LEGEND.map((entry) => (
        <span key={entry.label} className="flex items-center gap-1">
          <span className={`h-3 w-3 rounded-sm ${entry.className}`} />
          {entry.label}
        </span>
      ))}
    </div>
  );
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Mark every occurrence of `quote` in `essay`, tolerating whitespace drift. */
function paint(
  essay: string,
  quote: string,
  marks: number[] | boolean[],
  value: number | boolean,
) {
  const pattern = quote.trim().split(/\s+/).map(escapeRegExp).join("\\s+");
  if (!pattern) return;
  const regex = new RegExp(pattern, "g");
  for (const match of essay.matchAll(regex)) {
    const start = match.index;
    for (let i = start; i < start + match[0].length; i += 1) marks[i] = value;
  }
}

interface Segment {
  text: string;
  value: number;
  focused: boolean;
  start: number;
}

function buildSegments(
  essay: string,
  analysis: EssayAnalysis,
  focusQuotes: string[] | null,
): Segment[] {
  const marks = new Array<number>(essay.length).fill(0);
  for (const claim of analysis.unsupported_claims) {
    paint(essay, claim, marks, CLAIM);
  }
  // Ascending risk so that when quotes overlap, the riskier color wins.
  // ?? []: sessionStorage may hold an analysis saved before source_quotes
  // existed in the schema.
  const byRiskAscending = [...analysis.experiences].sort(
    (a, b) => a.risk_level - b.risk_level,
  );
  for (const experience of byRiskAscending) {
    const quotes = [
      ...(experience.source_quotes ?? []),
      ...experience.weaknesses.flatMap((item) => item.source_quotes ?? []),
    ];
    for (const quote of quotes) {
      paint(essay, quote, marks, experience.risk_level);
    }
  }

  const focus = new Array<boolean>(essay.length).fill(false);
  for (const quote of focusQuotes ?? []) {
    paint(essay, quote, focus, true);
  }

  const segments: Segment[] = [];
  for (let i = 0; i < essay.length; i += 1) {
    const last = segments[segments.length - 1];
    if (last && last.value === marks[i] && last.focused === focus[i]) {
      last.text += essay[i];
    } else {
      segments.push({ text: essay[i], value: marks[i], focused: focus[i], start: i });
    }
  }
  return segments;
}

export default function EssayHighlightView({
  essay,
  analysis,
  focusQuotes = null,
  scrollNonce = 0,
  showLegend = true,
  scrollable = true,
  showUnmatchedHint = true,
}: {
  essay: string;
  analysis: EssayAnalysis;
  focusQuotes?: string[] | null;
  scrollNonce?: number;
  /** 문항별 보기에서는 바깥에서 HighlightLegend를 한 번만 그린다. */
  showLegend?: boolean;
  /** 문항별 보기에서는 바깥 컨테이너가 스크롤을 담당한다. */
  scrollable?: boolean;
  /** 인용이 다른 문항에 있을 수 있으면 뷰 단위 매칭 실패 안내는 끈다. */
  showUnmatchedHint?: boolean;
}) {
  const segments = useMemo(
    () => buildSegments(essay, analysis, focusQuotes),
    [essay, analysis, focusQuotes],
  );
  const hasFocus = segments.some((segment) => segment.focused);
  const hasHighlights = segments.some((segment) => segment.value !== 0);
  const hasQuotes =
    analysis.unsupported_claims.length > 0 ||
    analysis.experiences.some(
      (item) =>
        (item.source_quotes ?? []).length > 0 ||
        item.weaknesses.some((weakness) => (weakness.source_quotes ?? []).length > 0),
    );

  const firstFocusedRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (scrollNonce > 0) {
      firstFocusedRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [scrollNonce]);

  const firstFocusedStart = segments.find((segment) => segment.focused)?.start;

  return (
    <div className="flex flex-col gap-2">
      {showLegend && <HighlightLegend />}

      <div
        className={`whitespace-pre-wrap rounded-md border border-gray-300 px-3 py-2 text-sm leading-relaxed dark:border-gray-700 dark:bg-gray-900 ${
          scrollable ? "max-h-[70vh] overflow-y-auto" : ""
        }`}
      >
        {segments.map((segment) =>
          segment.value === 0 && !segment.focused ? (
            <span key={segment.start}>{segment.text}</span>
          ) : (
            <mark
              key={segment.start}
              ref={segment.start === firstFocusedStart ? firstFocusedRef : undefined}
              className={`rounded-[2px] text-inherit ${
                HIGHLIGHT_STYLES[segment.value] ?? "bg-gray-200 dark:bg-gray-700"
              } ${
                hasFocus && !segment.focused
                  ? "opacity-40"
                  : segment.focused
                    ? "ring-2 ring-gray-500 dark:ring-gray-300"
                    : ""
              }`}
            >
              {segment.text}
            </mark>
          ),
        )}
      </div>

      {showUnmatchedHint && !hasHighlights && hasQuotes && (
        <p className="text-xs text-gray-500">
          분석 결과와 일치하는 원문 문장을 찾지 못했습니다. 자소서를 수정했다면
          다시 분석해 주세요.
        </p>
      )}
    </div>
  );
}
