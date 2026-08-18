"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getAnnotators, getBenchmarkRubric, getUnresolved, saveAdjudication } from "@/lib/api";
import type { AnnotatorSummary, BenchmarkMode, BenchmarkScore, UnresolvedBenchmarkItem } from "@/lib/types";

type Field = "relevance" | "specificity" | "coherence" | "specialized";

export default function AdjudicatePage() {
  const [mode, setMode] = useState<BenchmarkMode>("pilot");
  const [version, setVersion] = useState("");
  const [annotators, setAnnotators] = useState<AnnotatorSummary[]>([]);
  const [adjudicatorId, setAdjudicatorId] = useState("");
  const [items, setItems] = useState<UnresolvedBenchmarkItem[]>([]);
  const [scores, setScores] = useState<Partial<Record<Field, BenchmarkScore>>>({});
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  async function load() { try { setItems(await getUnresolved(mode)); } catch (error) { setMessage(String(error)); } }
  useEffect(() => { Promise.all([getBenchmarkRubric(), getAnnotators()]).then(([rubric, profiles]) => { setVersion(rubric.version); setAnnotators(profiles); setAdjudicatorId(profiles[0]?.annotator_id ?? ""); }); }, []);
  useEffect(() => { let active = true; getUnresolved(mode).then((rows) => { if (active) setItems(rows); }).catch((error) => { if (active) setMessage(String(error)); }); return () => { active = false; }; }, [mode]);
  const item = items[0];
  async function save() {
    if (!item || !adjudicatorId || (["relevance", "specificity", "coherence", "specialized"] as Field[]).some((field) => scores[field] === undefined)) return;
    await saveAdjudication(item.sample.sample_id, { adjudicator_id: adjudicatorId, rubric_version: version, target_mode: mode, scores: scores as Record<Field, BenchmarkScore>, note });
    setScores({}); setNote(""); await load();
  }
  return <main className="mx-auto max-w-4xl px-6 py-10"><header className="mb-8 flex justify-between"><div><p className="text-sm text-gray-500">Gold Benchmark Admin</p><h1 className="text-2xl font-semibold">Unresolved 합의</h1></div><Link href="/benchmark/annotate" className="text-sm underline">독립 평가</Link></header>
    <div className="mb-5 flex gap-3"><select value={adjudicatorId} onChange={(event) => setAdjudicatorId(event.target.value)} className="rounded-md border bg-transparent p-2"><option value="">합의 담당자 선택</option>{annotators.map((item) => <option key={item.annotator_id} value={item.annotator_id}>{item.name}</option>)}</select><select value={mode} onChange={(event) => setMode(event.target.value as BenchmarkMode)} className="rounded-md border bg-transparent p-2"><option value="pilot">Pilot</option><option value="full">Full</option></select><span className="p-2 text-sm text-gray-500">남은 unresolved {items.length}</span></div>
    {message && <p className="mb-4 text-red-600">{message}</p>}{!item ? <p className="rounded-xl border p-8 text-center">합의가 필요한 sample이 없습니다.</p> : <div className="space-y-5"><section className="rounded-xl border p-5"><p className="mb-2 text-xs text-gray-500">{item.sample.question.group_name} · {item.sample.sample_id}</p><h2 className="font-semibold">질문</h2><p className="mb-4">{item.sample.question.text}</p><h2 className="font-semibold">답변</h2><p className="whitespace-pre-wrap">{item.sample.answer.text}</p></section>
      <section className="rounded-xl border p-5"><h2 className="mb-3 font-semibold">독립 평가 결과</h2><div className="space-y-3">{item.annotations.map((annotation, index) => <div key={index} className="rounded-md bg-gray-50 p-3 text-sm dark:bg-gray-900"><p>{Object.entries(annotation.scores).map(([key, value]) => `${key} ${value}`).join(" · ")} · confidence {annotation.confidence}</p>{annotation.note && <p className="mt-1 text-gray-500">{annotation.note}</p>}</div>)}</div></section>
      <section className="rounded-xl border p-5"><h2 className="mb-3 font-semibold">최종 합의 점수</h2>{(["relevance", "specificity", "coherence", "specialized"] as Field[]).map((field) => <div key={field} className="mb-3 flex items-center gap-3"><span className="w-28 text-sm">{field}</span>{([0, 1, 2] as BenchmarkScore[]).map((score) => <button key={score} onClick={() => setScores((current) => ({ ...current, [field]: score }))} className={`rounded-md border px-4 py-2 ${scores[field] === score ? "bg-indigo-600 text-white" : ""}`}>{score}</button>)}</div>)}<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="합의 note" className="mt-2 min-h-20 w-full rounded-md border bg-transparent p-3" /><button onClick={() => void save()} className="mt-4 w-full rounded-md bg-indigo-600 p-3 text-white">합의 저장</button></section>
    </div>}</main>;
}
