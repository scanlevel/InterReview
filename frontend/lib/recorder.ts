// Browser-side audio capture for interview answers.
//
// MediaRecorder yields webm/opus (or mp4 on Safari), which CLOVA Speech does not
// reliably accept. So we record, then decode + resample to 16 kHz mono and
// encode a WAV — the format we verified CLOVA accepts. This replaces the
// server-side AudioBuffer/resampler the Streamlit app used.

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

export interface AnswerRecorder {
  start: () => void;
  stop: () => Promise<Blob>;
  isRecording: () => boolean;
}

/** Create a recorder over the audio tracks of a media stream. */
export function createRecorder(stream: MediaStream): AnswerRecorder {
  const audioStream = new MediaStream(stream.getAudioTracks());
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(
    audioStream,
    mimeType ? { mimeType } : undefined,
  );
  let chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  return {
    start() {
      chunks = [];
      recorder.start();
    },
    stop() {
      return new Promise<Blob>((resolve) => {
        recorder.onstop = () =>
          resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
        recorder.stop();
      });
    },
    isRecording() {
      return recorder.state === "recording";
    },
  };
}

const TARGET_SAMPLE_RATE = 16000;

/** Decode a recorded blob and re-encode it as a 16 kHz mono 16-bit WAV. */
export async function blobToWav16k(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  } finally {
    await decodeCtx.close();
  }

  const frameCount = Math.ceil(decoded.duration * TARGET_SAMPLE_RATE);
  if (frameCount <= 0) return encodeWav(new Float32Array(0));

  // OfflineAudioContext with a mono destination downmixes and resamples for us.
  const offline = new OfflineAudioContext(1, frameCount, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();

  return encodeWav(rendered.getChannelData(0));
}

function encodeWav(samples: Float32Array): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}
