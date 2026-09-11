import type { AudioTimeline, SpeechClassificationKind } from "@/lib/types";

const BIN_COLORS = {
  speech: "bg-accent",
  silence: "bg-line",
  longPause: "bg-risk-high-text",
  transcribed_speech: "bg-accent",
  untranscribed_speech: "bg-claim-text",
  vad_silence: "bg-line",
  pending: "bg-risk-mid-text",
} as const;

const CLASSIFICATION_LABELS: Record<SpeechClassificationKind, string> = {
  transcribed_speech: "전사 기반 발화",
  untranscribed_speech: "미전사 발화",
  vad_silence: "VAD 기준 무음",
  pending: "판정 보류",
};

function clampEnergy(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export default function AudioActivityTimeline({
  timeline,
}: {
  timeline: AudioTimeline | null | undefined;
}) {
  const binCount = Math.min(
    timeline?.energy.length ?? 0,
    timeline?.speech.length ?? 0,
    timeline?.long_pause.length ?? 0,
  );
  const hasClassification = Boolean(
    timeline?.classification && timeline.classification.length >= binCount,
  );

  if (!timeline || binCount === 0) {
    return <p className="text-sm text-muted">오디오 시각화 데이터가 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      <div
        className="flex h-16 items-end gap-px rounded border border-line-soft bg-surface-soft px-2 py-2"
        role="img"
        aria-label="질문별 오디오 활동 타임라인"
      >
        {Array.from({ length: binCount }, (_, index) => {
          const energy = clampEnergy(timeline.energy[index]);
          const classification = hasClassification ? timeline.classification?.[index] : null;
          const state = classification ?? (timeline.long_pause[index]
            ? "longPause"
            : timeline.speech[index]
              ? "speech"
              : "silence");
          const label = classification
            ? CLASSIFICATION_LABELS[classification]
            : state === "longPause"
              ? "긴 무음"
              : state === "speech"
                ? "발화"
                : "무음";
          return (
            <span
              key={index}
              title={`${label} 구간`}
              className={`min-w-0 flex-1 rounded-t ${BIN_COLORS[state]}`}
              style={{ height: `${Math.max(8, Math.round(energy * 100))}%` }}
            />
          );
        })}
      </div>
      {hasClassification ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
          {(Object.keys(CLASSIFICATION_LABELS) as SpeechClassificationKind[]).map((kind) => (
            <span key={kind} className="inline-flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-sm ${BIN_COLORS[kind]}`} />
              {CLASSIFICATION_LABELS[kind]}
            </span>
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-accent" />발화
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-line" />무음
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-risk-high-text" />긴 무음
          </span>
        </div>
      )}
    </div>
  );
}
