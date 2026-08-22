import type { AudioTimeline } from "@/lib/types";

const BIN_COLORS = {
  speech: "bg-sky-500",
  silence: "bg-gray-300 dark:bg-gray-700",
  longPause: "bg-amber-500",
} as const;

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

  if (!timeline || binCount === 0) {
    return <p className="text-sm text-gray-500">오디오 시각화 데이터가 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      <div
        className="flex h-16 items-end gap-px rounded border border-gray-200 bg-gray-50 px-2 py-2 dark:border-gray-700 dark:bg-gray-900"
        role="img"
        aria-label="질문별 오디오 활동 타임라인"
      >
        {Array.from({ length: binCount }, (_, index) => {
          const energy = clampEnergy(timeline.energy[index]);
          const state = timeline.long_pause[index]
            ? "longPause"
            : timeline.speech[index]
              ? "speech"
              : "silence";
          const label = state === "longPause"
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
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-sky-500" />발화
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-gray-300 dark:bg-gray-700" />무음
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-500" />긴 무음
        </span>
      </div>
    </div>
  );
}