import type { GazeDebugFrame, GazeQuality } from "@/lib/gaze";

function qualityLabel(quality: GazeQuality): string {
  switch (quality) {
    case "ok":
      return "● 시선 분석 준비됨";
    case "face_missing":
      return "● 얼굴 미검출";
    case "eye_too_small":
      return "● 눈이 작게 보임";
    case "blink":
      return "● 깜빡임·눈 뜸 대기";
    case "eyes_disagree":
      return "● 양쪽 눈 불일치";
    case "invalid":
      return "● 시선 좌표 판정 불가";
    case "frame_error":
      return "● 카메라 프레임 오류";
    case "processing_error":
      return "● 시선 처리 오류";
  }
}

export default function GazeDebugOverlay({
  active,
  frame,
  idleLabel = "녹음을 시작하면 시선을 분석합니다",
  verbose = false,
}: {
  active: boolean;
  frame: GazeDebugFrame | null;
  idleLabel?: string;
  verbose?: boolean;
}) {
  const dot = frame?.stagePoint
    ? {
        left: String(frame.stagePoint.x * 100) + "%",
        top: String(frame.stagePoint.y * 100) + "%",
      }
    : frame?.gaze
    ? {
        left: `${50 - Math.max(-45, Math.min(45, frame.gaze.x * 150))}%`,
        top: `${50 + Math.max(-45, Math.min(45, frame.gaze.y * 150))}%`,
      }
    : null;

  return (
    <div className="pointer-events-none absolute inset-0 text-xs text-white">
      {verbose && <div className="absolute inset-x-0 top-1/2 border-t border-white/30" />}
      {verbose && <div className="absolute inset-y-0 left-1/2 border-l border-white/30" />}

      {verbose && dot && active && (
        <span
          className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${
            frame?.isFront ? "bg-emerald-500" : "bg-red-500"
          }`}
          style={dot}
        />
      )}

      <div className="absolute left-2 top-2 space-y-1 rounded bg-black/70 p-2 font-mono">
        <p>
          {active
            ? frame
              ? frame.quality === "ok"
                ? verbose && frame.gaze
                  ? frame.isFront
                    ? "● 정면 응시"
                    : "● 시선 이탈"
                  : "● 시선 분석 준비됨"
                : qualityLabel(frame.quality)
              : "● 시선 분석 프레임 대기"
            : idleLabel}
        </p>
        {verbose && active && frame?.gaze && (
          <p>
            gaze x={frame.gaze.x.toFixed(3)} y={frame.gaze.y.toFixed(3)}
          </p>
        )}
      </div>
    </div>
  );
}
