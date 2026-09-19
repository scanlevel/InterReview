import type { AudioTimeline } from "@/lib/types";

const STATES = {
  speech: { label: "발화 구간", color: "bg-accent" },
  untranscribed: { label: "미전사 발화", color: "bg-claim-text" },
  silence: { label: "무음", color: "bg-line" },
} as const;

export default function AudioActivityTimeline({
  timeline,
  duration,
}: {
  timeline: AudioTimeline | null | undefined;
  duration?: number;
}) {
  const binCount = Math.min(timeline?.energy.length ?? 0, timeline?.speech.length ?? 0);
  if (!timeline || binCount === 0) {
    return <p className="text-sm text-muted">오디오 시각화 데이터가 없습니다.</p>;
  }
  const hasClassification = Boolean(timeline.classification && timeline.classification.length >= binCount);

  return (
    <div className="space-y-3">
      <div className="flex h-48 items-end gap-px rounded-lg border border-line bg-surface px-3 py-3 sm:h-56"
        role="img" aria-label="답변 시간에 따른 음성 크기: 발화 구간, 미전사 발화, 무음">
        {Array.from({ length: binCount }, (_, index) => {
          const classification = hasClassification ? timeline.classification?.[index] : null;
          // Pending frames have aligned words; prefer transcription for display.
          const state = classification === "transcribed_speech" || classification === "pending"
            ? "speech"
            : classification === "untranscribed_speech"
              ? "untranscribed"
              : classification === "vad_silence" ? "silence" : timeline.speech[index] ? "speech" : "silence";
          const energy = Number.isFinite(timeline.energy[index]) ? Math.max(0, Math.min(1, timeline.energy[index])) : 0;
          const time = typeof duration === "number" && Number.isFinite(duration) && duration > 0 ? (index * duration / binCount).toFixed(1) + "초 · " : "";
          return <span key={index} title={time + STATES[state].label}
            className={"min-w-0 flex-1 rounded-t " + STATES[state].color}
            style={{ height: Math.max(4, Math.round(energy * 100)) + "%" }} />;
        })}
      </div>
      {typeof duration === "number" && Number.isFinite(duration) && duration > 0 && (
        <div className="flex justify-between text-xs tabular-nums text-muted">
          {[0, 0.25, 0.5, 0.75, 1].map((fraction) => <span key={fraction}>{(duration * fraction).toFixed(1)}초</span>)}
        </div>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-ink-2">
        {Object.entries(STATES).map(([key, { label, color }]) => (
          <span key={key} className="inline-flex items-center gap-2">
            <span className={"h-3 w-3 rounded-sm " + color} />{label}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted">막대 높이는 음성 크기, 색상은 구간 유형을 나타냅니다.</p>
    </div>
  );
}
