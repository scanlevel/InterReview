# InterReview 배포 패키지

이 폴더는 `question_banks`와 `InterReview` 앱만으로 실행할 수 있는 독립
배포본입니다. 다음 항목이 모두 포함되어 있습니다.

- Streamlit 기반 모의면접 앱
- ICT 질문은행: `question_banks/ict`
- MediaPipe 얼굴 랜드마크 모델: `face_landmarker.task`

상위 폴더의 분석 데이터나 원본 데이터는 앱 실행에 필요하지 않습니다.

## 로컬에서 실행하기

Python 3.12와 uv를 설치한 뒤 아래 명령을 실행합니다.

```powershell
cd InterReview
uv sync
uv run streamlit run app.py
```

브라우저에서 `http://localhost:8501`을 엽니다.

기본 설정에서는 질문은행 원문을 사용하며 Kanana 모델을 다운로드하지
않습니다. 따라서 일반 CPU 환경이나 Streamlit Community Cloud에서도 먼저
실행할 수 있습니다.

## Docker로 배포하기

Windows에서는 Docker Desktop을 설치하고 WSL 2 백엔드를 사용하면 됩니다.
현재 Docker Desktop은 WSL 2.1.5 이상, 64비트 Windows, 하드웨어 가상화가
필요하며, WSL 2.7 이상이 설치된 이 PC는 WSL 조건을 충족합니다.

Docker Desktop 설치 후 PowerShell에서 설치 여부를 확인합니다.

```powershell
docker --version
docker info
```

`docker info`가 정상적으로 출력되면 아래 명령으로 앱을 빌드하고 실행합니다.

```powershell
docker build -t interreview .
docker run --rm -p 8501:8501 interreview
```

컨테이너가 실행된 뒤 `http://localhost:8501`에 접속합니다.

외부 주소로 서비스할 때는 카메라 권한을 위해 HTTPS가 필요합니다. 사용자의
네트워크 환경에 따라 WebRTC 연결을 위해 TURN 서버 설정이 추가로 필요할 수
있습니다.

## Kanana 개인화 기능 사용하기

Kanana 2.1B 모델은 용량이 크고 최초 실행 시 모델을 내려받으므로 기본값은
비활성화되어 있습니다. 충분한 메모리와 GPU가 있는 서버에서만 아래처럼
선택적으로 활성화하는 것을 권장합니다.

```powershell
uv sync --extra kanana
$env:KANANA_ENABLED = "true"
$env:KANANA_DEVICE = "cuda"
uv run streamlit run app.py
```

CPU에서 실행할 경우에는 다음과 같이 설정할 수 있습니다.

```powershell
$env:KANANA_DEVICE = "cpu"
$env:KANANA_DTYPE = "float32"
```

Kanana를 사용할 수 없을 때도 질문은행 기반 질문 생성은 자동으로
fallback 방식으로 계속 동작합니다.

## 질문은행 교체하기

기본 질문은행은 `question_banks/ict`에 있습니다. 다른 질문은행을 마운트할
때는 `rules.json`이 직접 들어 있는 폴더를 `QUESTION_BANK_ROOT` 환경변수로
지정합니다.

```powershell
$env:QUESTION_BANK_ROOT = "D:\data\question_banks\ict"
uv run streamlit run app.py
```

## 배포 시 참고사항

- 면접 답변과 분석 결과는 사용자별 Streamlit 세션에 보관됩니다.
- 서버 파일에 공용 면접 결과를 저장하지 않으므로 여러 사용자가 동시에
  접속해도 서로의 답변이 섞이지 않습니다.
- 카메라와 마이크를 사용하는 기능은 브라우저 권한 허용이 필요합니다.
- 배포 플랫폼에서 사용할 Python 진입점은 `app.py`입니다.
