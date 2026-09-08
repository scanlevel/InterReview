export type SpeechCancellationRef = { current: (() => void) | null };

export type SpeechPlaybackErrorCode =
  | "cancelled"
  | "autoplay_blocked"
  | "playback_error"
  | "playback_timeout";

export class SpeechPlaybackError extends Error {
  readonly code: SpeechPlaybackErrorCode;

  constructor(code: SpeechPlaybackErrorCode, message: string) {
    super(message);
    this.name = "SpeechPlaybackError";
    this.code = code;
  }
}

/** Keep long questions intact while bounding a missing media event. */
export function speechPlaybackTimeoutMs(text: string): number {
  const characters = Math.max(1, text.trim().length);
  return Math.min(300_000, Math.max(30_000, 20_000 + characters * 150));
}

export async function playAudioBlob(
  blob: Blob,
  text: string,
  cancellationRef: SpeechCancellationRef,
  timeoutMs = speechPlaybackTimeoutMs(text),
): Promise<void> {
  const url = URL.createObjectURL(blob);
  let audio: HTMLAudioElement | null = null;
  let cancelAudio: (() => void) | null = null;

  try {
    audio = new Audio(url);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let timerId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timerId !== null) clearTimeout(timerId);
        audio!.onended = null;
        audio!.onerror = null;
        audio!.onabort = null;
        if (cancellationRef.current === cancelAudio) cancellationRef.current = null;
      };

      const settle = (error?: SpeechPlaybackError) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else resolve();
      };

      cancelAudio = () => {
        audio!.pause();
        settle(new SpeechPlaybackError("cancelled", "음성 안내가 취소되었습니다."));
      };
      cancellationRef.current = cancelAudio;
      audio!.onended = () => settle();
      audio!.onerror = () =>
        settle(new SpeechPlaybackError("playback_error", "음성 안내 재생에 실패했습니다."));
      audio!.onabort = () =>
        settle(new SpeechPlaybackError("playback_error", "음성 안내 재생이 중단되었습니다."));
      timerId = setTimeout(() => {
        audio!.pause();
        settle(
          new SpeechPlaybackError(
            "playback_timeout",
            "음성 안내 재생 시간이 초과되었습니다.",
          ),
        );
      }, timeoutMs);

      try {
        void audio!.play().catch((error: unknown) => {
          const code =
            error && typeof error === "object" && "name" in error &&
            error.name === "NotAllowedError"
              ? "autoplay_blocked"
              : "playback_error";
          settle(
            new SpeechPlaybackError(
              code,
              code === "autoplay_blocked"
                ? "브라우저가 음성 자동 재생을 차단했습니다."
                : "음성 안내 재생에 실패했습니다.",
            ),
          );
        });
      } catch {
        settle(new SpeechPlaybackError("playback_error", "음성 안내 재생에 실패했습니다."));
      }
    });
  } finally {
    audio?.pause();
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.onabort = null;
      audio.src = "";
    }
    if (cancelAudio && cancellationRef.current === cancelAudio) {
      cancellationRef.current = null;
    }
    URL.revokeObjectURL(url);
  }
}
