"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { benchmarkAudioUrl, getBenchmarkSamples } from "@/lib/api";
import type { BenchmarkCandidate } from "@/lib/types";

export default function BenchmarkPage() {
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [sample, setSample] = useState<BenchmarkCandidate | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    getBenchmarkSamples({ offset, limit: 1 }).then((page) => { if (active) { setSample(page.items[0] ?? null); setTotal(page.total); } }).catch((reason) => { if (active) setError(String(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [offset]);
  return <main className="mx-auto max-w-3xl px-6 py-10">
    <header className="mb-8 flex items-start justify-between gap-4"><div><p className="text-sm text-gray-500">InterReview Benchmark</p><h1 className="text-2xl font-semibold">Q-A-WAV 확인</h1></div><nav className="flex gap-4 text-sm"><Link className="underline" href="/benchmark/annotate">Gold 평가</Link><Link className="underline" href="/benchmark/adjudicate">합의</Link><Link className="underline" href="/">면접 서비스</Link></nav></header>
    {loading && <p>샘플을 불러오는 중입니다.</p>}{error && <p className="rounded-md bg-red-50 p-4 text-red-700">{error}</p>}
    {sample && <div className="space-y-5">
      <div className="flex flex-wrap gap-2 text-xs text-gray-500"><span>Sample {sample.sample_id}</span><span>{sample.question.group_name}</span><span>{sample.question.group}</span></div>
      <Card title="질문"><p className="leading-relaxed">{sample.question.text}</p></Card>
      <Card title={`답변 reference transcript · ${sample.answer.word_count} words`}><p className="whitespace-pre-wrap leading-relaxed">{sample.answer.text}</p></Card>
      <div className="grid gap-4 sm:grid-cols-2"><Audio label="Question Audio" url={benchmarkAudioUrl(sample.sample_id, "question")} /><Audio label="Answer Audio" url={benchmarkAudioUrl(sample.sample_id, "answer")} /></div>
      <p className="text-xs text-gray-500">source split {sample.source.source_split ?? "-"} · experience {sample.source.experience ?? "-"} · source sample {sample.source.source_sample_id ?? "-"}</p>
    </div>}
    <nav className="mt-8 flex items-center justify-between"><button disabled={offset === 0 || loading} onClick={() => { setLoading(true); setError(""); setOffset((value) => value - 1); }} className="rounded-md border px-4 py-2 disabled:opacity-40">이전</button><span className="text-xs text-gray-500">{total ? `${offset + 1} / ${total}` : "-"}</span><button disabled={loading || offset + 1 >= total} onClick={() => { setLoading(true); setError(""); setOffset((value) => value + 1); }} className="rounded-md border px-4 py-2 disabled:opacity-40">다음</button></nav>
  </main>;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) { return <section className="rounded-xl border p-5 dark:border-gray-800"><h2 className="mb-2 text-sm font-medium text-gray-500">{title}</h2>{children}</section>; }
function Audio({ label, url }: { label: string; url: string }) { const [missing, setMissing] = useState(false); return <section className="rounded-xl border p-4 dark:border-gray-800"><h2 className="mb-3 text-sm font-medium">{label}</h2>{missing ? <p className="text-xs text-gray-500">오디오 파일을 찾을 수 없습니다.</p> : <audio controls preload="metadata" src={url} className="w-full" onError={() => setMissing(true)} />}</section>; }
