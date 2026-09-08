import assert from "node:assert/strict";
import test from "node:test";
import {
  synthesizeSpeech,
  TtsRequestError,
  TTS_START_PROMPT,
  transcribe,
} from "./api.ts";
import {
  playAudioBlob,
  SpeechPlaybackError,
} from "./ttsPlayback.ts";

test("local TTS sends questions without caching and caches fixed guides", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ text: string; voice_id?: string }> = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { text: string; voice_id?: string };
    calls.push(body);
    return new Response(new Blob(["RIFF"], { type: "audio/wav" }), {
      status: 200,
    });
  };

  try {
    await synthesizeSpeech("질문 1");
    await synthesizeSpeech("질문 1");
    await synthesizeSpeech(TTS_START_PROMPT);
    await synthesizeSpeech(TTS_START_PROMPT);
    await synthesizeSpeech(TTS_START_PROMPT, undefined, "F1");
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls, [
    { text: "질문 1", voice_id: "M1" },
    { text: "질문 1", voice_id: "M1" },
    { text: TTS_START_PROMPT, voice_id: "M1" },
    { text: TTS_START_PROMPT, voice_id: "F1" },
  ]);
});

test("local TTS cancellation aborts the request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });

  const controller = new AbortController();
  try {
    const pending = synthesizeSpeech("취소할 질문", controller.signal);
    controller.abort();
    await assert.rejects(pending, /취소/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("STT cancellation and timeout abort the request", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
    });

  try {
    const controller = new AbortController();
    const cancelled = transcribe(new Blob(["audio"]), "answer.wav", {
      signal: controller.signal,
      timeoutMs: 100,
    });
    controller.abort();
    await assert.rejects(cancelled, /취소/);
    await assert.rejects(
      transcribe(new Blob(["audio"]), "answer.wav", { timeoutMs: 5 }),
      /초과/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local TTS preserves diagnostic error codes without logging question text", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        detail: { code: "model_load", message: "로컬 TTS 모델을 불러오지 못했습니다." },
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );

  try {
    await assert.rejects(
      synthesizeSpeech("비공개 질문 원문"),
      (error: unknown) =>
        error instanceof TtsRequestError && error.code === "model_load" &&
        !error.message.includes("비공개 질문 원문"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

class FakeAudio {
  static mode: "ended" | "pending" | "autoplay" = "ended";
  static instances: FakeAudio[] = [];
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  src: string;
  pauseCount = 0;

  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }

  play(): Promise<void> {
    if (FakeAudio.mode === "autoplay") {
      return Promise.reject(Object.assign(new Error("blocked"), { name: "NotAllowedError" }));
    }
    if (FakeAudio.mode === "ended") queueMicrotask(() => this.onended?.());
    return FakeAudio.mode === "pending" ? new Promise(() => undefined) : Promise.resolve();
  }

  pause(): void {
    this.pauseCount += 1;
  }
}

function installAudioMocks() {
  const originalAudio = (globalThis as typeof globalThis & { Audio?: unknown }).Audio;
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked: string[] = [];
  let restored = false;
  FakeAudio.instances = [];
  Object.defineProperty(globalThis, "Audio", { configurable: true, value: FakeAudio });
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:tts-test",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: (url: string) => revoked.push(url),
  });
  return () => {
    if (restored) return revoked;
    restored = true;
    if (originalAudio === undefined) Reflect.deleteProperty(globalThis, "Audio");
    else Object.defineProperty(globalThis, "Audio", { configurable: true, value: originalAudio });
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: originalCreate });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: originalRevoke });
    return revoked;
  };
}

test("local TTS playback cleans up after normal end and missing end event timeout", async () => {
  const restore = installAudioMocks();
  try {
    const cancellation = { current: null as (() => void) | null };
    await playAudioBlob(new Blob(["RIFF"]), "질문", cancellation, 50);
    assert.equal(cancellation.current, null);
    assert.equal(FakeAudio.instances[0]?.src, "");
    assert.ok((FakeAudio.instances[0]?.pauseCount ?? 0) > 0);

    FakeAudio.mode = "pending";
    await assert.rejects(
      playAudioBlob(new Blob(["RIFF"]), "장문 질문", cancellation, 10),
      (error: unknown) =>
        error instanceof SpeechPlaybackError && error.code === "playback_timeout",
    );
    assert.equal(cancellation.current, null);
    assert.equal(FakeAudio.instances[1]?.src, "");
    assert.deepEqual(restore(), ["blob:tts-test", "blob:tts-test"]);
  } finally {
    restore();
  }
});

test("local TTS playback distinguishes autoplay blocking and cancellation", async () => {
  const restore = installAudioMocks();
  try {
    const cancellation = { current: null as (() => void) | null };
    FakeAudio.mode = "autoplay";
    await assert.rejects(
      playAudioBlob(new Blob(["RIFF"]), "질문", cancellation, 50),
      (error: unknown) =>
        error instanceof SpeechPlaybackError && error.code === "autoplay_blocked",
    );

    FakeAudio.mode = "pending";
    const pending = playAudioBlob(new Blob(["RIFF"]), "질문", cancellation, 500);
    cancellation.current?.();
    await assert.rejects(
      pending,
      (error: unknown) => error instanceof SpeechPlaybackError && error.code === "cancelled",
    );
    assert.equal(cancellation.current, null);
  } finally {
    restore();
  }
});
