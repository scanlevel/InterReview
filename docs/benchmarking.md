# Gold Benchmark annotation

기존 FastAPI/Next.js 서비스 안에서 Step 2의 `/benchmark` Q-A-WAV 조회 기능과 annotation 기능을 함께 제공한다. 기존 면접 생성·녹화·평가 흐름은 변경하지 않는다.

## 화면

- `/benchmark`: 질문, reference 답변, question/answer WAV 확인
- `/benchmark/annotate`: UUID 평가자 등록/선택, 자동 배정, rubric 0/1/2 독립 평가
- `/benchmark/adjudicate`: unique mode 동률 sample의 수동 합의

평가자는 일반 평가 화면에서 타인의 점수와 note를 볼 수 없다. 합의 화면/API만 unresolved sample의 익명 독립 평가를 노출한다.

## 설정

```text
INTERREVIEW_BENCHMARK_DATA_DIR=...       # registry/annotation/gold 저장 위치
INTERREVIEW_MIN_ANNOTATIONS_PER_SAMPLE=3
```

평가자 개인정보는 registry에만 저장하며 annotation 및 모델용 export에는 UUID만 포함한다. 상세 CLI와 파일 구조는 `backend/benchmarking/README.md`를 참고한다.
