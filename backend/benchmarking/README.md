# Gold Benchmark annotation

Step 2의 portable Q-A-WAV loader와 `/benchmark` 조회 API를 그대로 사용하며, annotation 데이터만 `benchmarking/data` 아래에 분리해 저장한다. 저장 위치는 `INTERREVIEW_BENCHMARK_DATA_DIR`로 바꿀 수 있다.

## Target 생성

```powershell
cd backend
uv run python -m benchmarking.scripts.build_annotation_target --mode pilot --per-group 10
uv run python -m benchmarking.scripts.build_annotation_target --mode full
```

`selection.json`의 seed와 그룹별 quota를 사용한다. 현재 full은 1,000개, pilot은 그룹당 10개인 60개이며 같은 seed의 pilot은 full에 포함된다. 그룹 ID는 `question_banks/ict/rules.json`에서 검증한다.

## 실행

```powershell
cd backend
uv run uvicorn app.main:app --reload

cd ..\frontend
npm run dev
```

- Q-A-WAV 확인: `http://localhost:3000/benchmark`
- 독립 평가: `http://localhost:3000/benchmark/annotate`
- unresolved 합의: `http://localhost:3000/benchmark/adjudicate`

평가자 등록 시 UUID를 발급한다. 개인정보는 `annotators.jsonl`, 평가는 `annotations/{annotator_uuid}.jsonl`에 저장된다. annotation 및 모델 export에는 평가자 개인정보가 들어가지 않는다. `INTERREVIEW_MIN_ANNOTATIONS_PER_SAMPLE`의 기본값은 3이다.

## Gold, 통계, split

```powershell
uv run python -m benchmarking.scripts.report_dataset --mode pilot
uv run python -m benchmarking.scripts.build_gold --mode full
uv run python -m benchmarking.scripts.split_dataset --seed 42
```

Gold는 평균이나 반올림 없이 metric별 unique mode만 사용한다. 동률은 unresolved이며 합의 화면에서 확정한다. split은 정규화된 동일 질문 text 묶음을 유지하면서 그룹별 80/10/10에 가깝게 배정하고, 원천의 `source_split`과 별도인 `benchmark_split`에 기록한다.

`rubric.json`의 version이 annotation마다 기록된다. pilot 이후 rubric version이 바뀌면 이전 평가는 보존되지만 현재 배정에서는 재평가 대상으로 취급된다.

> `ponytail:` JSONL 쓰기는 한 FastAPI 프로세스 안에서만 lock된다. 여러 worker에서 동시에 평가를 받아야 할 시점에는 파일 저장소를 트랜잭션 DB로 교체한다.
