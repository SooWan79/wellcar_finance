# CLAUDE.md — 웰카오디오 매출/지출관리 시스템

Claude Code 세션이 시작될 때 자동으로 읽는 인수인계 문서입니다.
새 세션은 이 문서와 `README.md`만으로 작업을 이어갈 수 있어야 합니다.
기능·규칙·결정이 바뀌면 이 문서도 같은 커밋에서 갱신하세요.

## 한 줄 요약

웰카오디오의 엑셀 경영관리(`2023년 경영관리.xlsm`)를 대체하는 매출/지출 관리 웹앱.
Flask + SQLite + 바닐라 JS이며, 프런트엔드 외부 라이브러리를 쓰지 않습니다(오프라인 동작).

## 브랜치 규칙 (중요)

- **작업 브랜치 = GitHub 기본 브랜치 = `claude/welkaudio-income-expense-system-fw15tm`.**
  개발은 이 브랜치에 직접 커밋·푸시합니다(PR을 쓰지 않음).
- **`main` 브랜치는 없습니다.** 세션의 기준 브랜치로 `main`을 지정하지 마세요.
  최초 개발 세션이 빈 저장소 상태에서 `main` 기준으로 만들어졌는데, `main`이 한 번도
  생성되지 않아 2026-10-03 재시작 시 `ref_not_found`로 영구히 열리지 않게 된 일이 있습니다.
- 위 작업 브랜치의 이름 변경·삭제 금지: 여러 세션이 이 브랜치를 기준으로 고정되어 있어,
  바꾸면 같은 장애가 다시 납니다.
- `claude/book-writing-structure-review-benxdz`는 별개 작업(책 원고 진단)이라 건드리지 않습니다.

## 개발 환경

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
WELLCAR_DB=/tmp/dev.db .venv/bin/python seed_demo.py     # 최근 1년치 데모 데이터
WELLCAR_DB=/tmp/dev.db PORT=8000 .venv/bin/python app.py  # http://localhost:8000
```

- 시스템 `pip install`은 Debian이 설치한 `blinker`를 지우지 못해 실패합니다. 반드시 `.venv`를
  쓰세요(`.gitignore`에 포함됨).
- DB 경로는 `WELLCAR_DB` 환경변수로 바꿀 수 있습니다(기본값: 프로젝트 폴더의 `wellcar.db`,
  git 제외 대상). 테스트할 때는 임시 경로를 써서 실데이터와 섞이지 않게 하세요.
- 자동 테스트는 없습니다. 변경 후 최소한 다음을 확인합니다.
  - API 스모크: `/api/meta`, `/api/stats/daily|monthly|quarterly|yearly`, 매출/지출 등록·삭제
  - 화면: 헤드리스 브라우저로 8개 탭을 모두 눌러 보고 JS 콘솔 오류가 0건인지 확인.
    클라우드 세션에는 Playwright가 전역 node 모듈로 설치되어 있습니다
    (`require(\`${npm root -g}/playwright\`)`, `playwright install` 실행 금지).

## 구조와 코드 규칙

- 파일별 역할과 API 목록은 `README.md`의 '구조'·'API 요약'을 보세요.
- 백엔드는 `app.py` 하나입니다. 테이블은 `incomes`, `expenses`, `codes` 세 개입니다.
  스키마는 `CREATE TABLE IF NOT EXISTS`로만 만들며 마이그레이션 도구가 없습니다.
  컬럼을 추가하면 이미 쓰고 있는 `wellcar.db`를 위한 `ALTER TABLE` 처리를 `init_db()`에
  직접 넣어야 합니다(기존 데이터 보존 필수).
- 프런트엔드는 `static/index.html` 단일 페이지와 `static/js/app.js`(IIFE)로 되어 있습니다.
  CDN이나 외부 라이브러리를 추가하지 않습니다. 차트는 `charts.js`의 자체 SVG를 쓰고,
  엑셀 파싱은 `xlsx_import.js`가 브라우저의 `DecompressionStream`으로 처리합니다.
- 스타일은 `style.css`의 `:root` 디자인 토큰을 기반으로 합니다. 테마는 자동 → 라이트 →
  다크 순서로 토글되고 선택값은 localStorage에 저장됩니다. 새 색은 토큰으로 추가하고
  다크 모드 값도 함께 정의하세요.
- 용어: 화면과 문서는 **'매출/지출'**로 통일합니다('수입'이라 쓰지 않음). DB 테이블과 API
  경로는 `incomes`/`expenses` 이름을 그대로 유지합니다.
- UI 문구와 코드 주석은 한국어로 씁니다.

## 업무 규칙 (기존 엑셀과 동일하게 맞춘 것)

- **부가세**: 결제유형이 `카드`이거나 세금계산서가 `Y`이면 VAT = round(매출액 × 10/110),
  순매출액 = 매출액 − VAT입니다. 계산은 프런트 `calcIncome()`이 하고, 서버는 받은 값을
  그대로 저장합니다.
- **CNY 거래**: 원화 매출액(지출액) = 수량 × 단가 × 기준환율입니다.
- **엑셀 가져오기**: '영업일자' 열과 함께 '매출액'+'매출유형' 또는 '지출금액'+'지출유형' 열이
  있는 시트를 인식합니다. 같은 파일을 다시 올려도 결과가 같습니다(멱등). 중복 판정 키는
  매출이 일자·유형·구분·거래처·금액·VAT·적요, 지출이 일자·유형·품목·거래처·금액·적요입니다.
  같은 키의 행이 DB에 n건 있으면 파일에서 n건까지 건너뜁니다(멀티셋 방식이라 파일 안의
  정당한 중복 거래는 유지됨). 파일에 새로 나온 코드값은 코드관리에 자동으로 추가됩니다.
- **코드 그룹**: `income_type`, `income_category`(부모: income_type), `expense_type`,
  `expense_item`(부모: expense_type), `payment_type`, `account`, `currency`,
  `manufacturer`, `client`. 기본값은 엑셀 '코드관리' 시트에서 가져온 것입니다(`SEED_CODES`).

## 데모 아티팩트

- 「웰카오디오 매출/지출관리 시스템 (데모)」
  https://claude.ai/code/artifact/3efef368-9509-49fa-a48f-7436a9bedb29
- 기능을 바꾼 뒤 데모도 갱신하려면 이 URL을 Artifact `read`로 먼저 읽고, 같은 URL로
  publish하세요. 새 URL을 만들면 사용자가 가진 링크가 끊깁니다.

## 작업 이력

| 날짜 | 커밋 | 내용 |
|---|---|---|
| 2026-07-20 | d9cfe3e | 최초 구축 |
| 2026-07-21 | 8e07514 | 엑셀 마이그레이션, 다크모드 토글 |
| 2026-08-18 | af7dbdb | 용어를 매출/지출로 통일, UI/UX 전면 정리 |
| 2026-10-03 | — | 최초 세션이 `main` 고정 문제로 열리지 않아 새 세션으로 이관, 이 문서 추가 |
