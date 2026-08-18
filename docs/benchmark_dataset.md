# Portable ICT Q-A dataset 연결

이번 단계의 benchmark 기능은 점수·rubric·annotation을 만들지 않습니다. 기존
`backend/question_banks/ict/rules.json`의 group과 portable Q-A/WAV pair를 연결해
웹에서 확인하는 read-only 경로입니다.

## 배치

기본 경로:

```text
backend/data/ict_qa_dataset/
  qa_pairs.jsonl
  manifest.json
  benchmark_candidates.jsonl       # 생성되는 derived file
  audio/train/question/*.wav
  audio/train/answer/*.wav
  audio/validation/question/*.wav
  audio/validation/answer/*.wav
```

외부 dataset을 사용할 때는 다음 환경변수가 기본 경로보다 우선합니다.

```text
INTERREVIEW_ICT_QA_DATASET_DIR=D:/data/ICT_QA_DATASET
```

저장소 내부에서 사용할 때는 dataset을 `backend/data/ict_qa_dataset`에 배치합니다.

## 후보 생성 및 report

```bash
cd backend
python -m benchmarking.scripts.build_qa_candidates
```

생성 파일:

- `<dataset-root>/benchmark_candidates.jsonl`
- `<dataset-root>/reports/benchmark_mapping_report.json`
- `<dataset-root>/reports/unmatched_questions.jsonl`
- `<dataset-root>/reports/ambiguous_questions.jsonl`

매칭은 source sample id → whitespace normalization exact question text 순서이며,
fuzzy/LLM 분류는 하지 않습니다. 미매칭·복수 group은 group을 `null`로 남기고
report에 기록합니다.

## 확인 화면/API

```text
GET /benchmark/samples?group=&source_split=&experience=&offset=&limit=
GET /benchmark/samples/{sample_id}
GET /benchmark/samples/{sample_id}/audio/question
GET /benchmark/samples/{sample_id}/audio/answer
```

Next.js를 실행한 뒤 `http://localhost:3000/benchmark`에서 질문, answer reference
transcript, 질문/답변 WAV를 확인할 수 있습니다. `answer.text`와 `answer_wav`는
같은 `sample_id` 아래에 남아 있어 향후 STT hypothesis와 비교할 수 있습니다.
