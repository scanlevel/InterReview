import assert from "node:assert/strict";
import test from "node:test";
import {
  createQuestionSpeechCache,
  questionSpeechCacheKey,
} from "./questionSpeechCache.ts";

test("shares one pending question synthesis and keys voice/text/model inputs", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  const resolvers: Array<(response: Response) => void> = [];
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      calls += 1;
      if (init?.signal?.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
      resolvers.push(resolve);
    });

  const cache = createQuestionSpeechCache();
  try {
    const first = cache.prepare("q1", "질문 하나", "M1");
    const same = cache.prepare("q1", "질문 하나", "M1");
    assert.strictEqual(first, same);
    assert.equal(calls, 1);
    resolvers.shift()?.(new Response(new Blob(["RIFF"]), { status: 200 }));
    await first.promise;

    assert.notEqual(
      questionSpeechCacheKey("q1", "질문 하나", "M1"),
      questionSpeechCacheKey("q1", "질문 하나", "F1"),
    );
    assert.notEqual(
      questionSpeechCacheKey("q1", "질문 하나", "M1"),
      questionSpeechCacheKey("q2", "질문 하나", "M1"),
    );
    assert.notEqual(
      questionSpeechCacheKey("q1", "질문 하나", "M1"),
      questionSpeechCacheKey("q1", "질문 둘", "M1"),
    );
  } finally {
    cache.clear();
    globalThis.fetch = originalFetch;
  }
});

test("removing a question cancels its pending synthesis and permits one retry", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((resolve, reject) => {
      calls += 1;
      init?.signal?.addEventListener(
        "abort",
        () => reject(new DOMException("aborted", "AbortError")),
        { once: true },
      );
      void resolve;
    });

  const cache = createQuestionSpeechCache();
  try {
    const first = cache.prepare("q1", "질문 하나", "M1");
    cache.retain([{ questionId: "q2", text: "질문 둘" }], "M1");
    await assert.rejects(first.promise, /취소/);
    const retry = cache.prepare("q1", "질문 하나", "M1");
    assert.notStrictEqual(retry, first);
    assert.equal(calls, 2);
    cache.clear();
    await assert.rejects(retry.promise, /취소/);
  } finally {
    cache.clear();
    globalThis.fetch = originalFetch;
  }
});

test("a failed pre-generation entry is removed for the question-entry retry", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response("failed", { status: 503 });
  };

  const cache = createQuestionSpeechCache();
  try {
    const first = cache.prepare("q1", "질문 하나", "M1");
    await assert.rejects(first.promise);
    const retry = cache.prepare("q1", "질문 하나", "M1");
    assert.notStrictEqual(retry, first);
    assert.equal(calls, 2);
    await assert.rejects(retry.promise);
  } finally {
    cache.clear();
    globalThis.fetch = originalFetch;
  }
});
