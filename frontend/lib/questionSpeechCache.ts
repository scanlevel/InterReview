import {
  LOCAL_TTS_MODEL_VERSION,
  synthesizeSpeech,
  type TtsVoiceId,
} from "./api.ts";

export type CachedQuestionSpeech = {
  key: string;
  promise: Promise<Blob>;
  cancel: () => void;
};

export interface QuestionSpeechCache {
  prepare: (
    questionId: string,
    text: string,
    voiceId: TtsVoiceId,
  ) => CachedQuestionSpeech;
  retain: (
    questions: readonly { questionId: string; text: string }[],
    voiceId: TtsVoiceId,
  ) => void;
  clear: () => void;
}

function speechText(text: string): string {
  return text.trim().replace(/\s+/gu, " ");
}

export function questionSpeechCacheKey(
  questionId: string,
  text: string,
  voiceId: TtsVoiceId,
): string {
  return JSON.stringify([
    LOCAL_TTS_MODEL_VERSION,
    questionId,
    speechText(text),
    voiceId,
  ]);
}

export function createQuestionSpeechCache(): QuestionSpeechCache {
  const entries = new Map<string, CachedQuestionSpeech>();

  function prepare(
    questionId: string,
    text: string,
    voiceId: TtsVoiceId,
  ): CachedQuestionSpeech {
    const key = questionSpeechCacheKey(questionId, text, voiceId);
    const existing = entries.get(key);
    if (existing) return existing;

    const controller = new AbortController();
    const promise = synthesizeSpeech(text, controller.signal, voiceId).catch((error) => {
      if (entries.get(key)?.promise === promise) entries.delete(key);
      throw error;
    });
    const entry: CachedQuestionSpeech = {
      key,
      promise,
      cancel() {
        if (entries.get(key)?.promise === promise) entries.delete(key);
        controller.abort();
      },
    };
    entries.set(key, entry);
    return entry;
  }

  function retain(
    questions: readonly { questionId: string; text: string }[],
    voiceId: TtsVoiceId,
  ): void {
    const keys = new Set(
      questions.map(({ questionId, text }) =>
        questionSpeechCacheKey(questionId, text, voiceId),
      ),
    );
    for (const [key, entry] of entries) {
      if (!keys.has(key)) entry.cancel();
    }
  }

  return {
    prepare,
    retain,
    clear() {
      for (const entry of entries.values()) entry.cancel();
      entries.clear();
    },
  };
}
