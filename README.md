# 웰카오디오 매출/지출관리 시스템

기존 엑셀(웰그룹·모두플래닛 경영관리 시스템, `2023 모두플래닛_수입지출관리.xlsm`) 기반 매출/지출
관리를 웹 시스템으로 옮긴 프로젝트입니다. 매일 매출·지출을 건별로 등록하면
일별 대시보드와 월별·분기별·연도별 통계 현황을 바로 확인할 수 있습니다.

## 주요 기능

- **로그인·권한** — 계정마다 관리자 / 직원 / 조회 전용 권한을 줍니다. 처음 접속하면 서버 창에 표시된
  설정 코드로 관리자 계정을 만들고, 사용자관리 탭에서 직원 계정을 추가합니다.
  로그인 유지(30일), 비밀번호 변경, 실패 반복 시 잠금, 사용 중지 시 즉시 로그아웃을 지원합니다.
- **매출관리** — 영업일자·매출유형·매출구분·차량제조사·제품모델·거래처·거래통화(KRW/CNY)·
  수량·단가·결제유형·세금계산서·계좌·**미수금**·적요 입력. 엑셀과 동일하게
  결제유형이 `카드`이거나 세금계산서 `Y`이면 부가세(매출액×10/110)와 순매출액이 자동 계산되고,
  CNY 거래는 `수량 × 단가 × 기준환율`로 원화 매출액이 자동 환산됩니다.
  오른쪽 목록에서 **기간·유형·검색어·미수금 남은 건**으로 전체 내역을 찾고 페이지를 넘겨 볼 수 있으며,
  조회 결과를 그대로 엑셀로 받을 수 있습니다. 수정 화면에는 등록·수정한 사람과 시각이 표시됩니다.
- **지출관리** — 지출유형·거래품목(유형별 종속 드랍다운)·결제유형·거래처·**미지급금**·적요 입력.
  목록 기능은 매출관리와 같습니다.
- **미수·미지급** — 받을 돈(미수금)과 줄 돈(미지급금) 잔액, 거래처별 합계, 오래된 순 내역과 경과일.
  입금·지급이 끝나면 **완료** 버튼으로 정리합니다.
- **일별 대시보드** — 선택한 날짜의 매출/지출 내역 목록(수정·삭제 가능)과
  당일 매출·지출·순익 강조 카드(전일대비 증감), 당월 누계·부가세·현금(카드 외)/카드 매출·
  영업일수·일평균 매출·미수금 잔액 보조 지표, 최근 14일 추이 차트.
- **월별 / 분기별 / 연도별 현황** — 기간 손익, 전기 대비 증감, 매출구분별·지출유형별 구성,
  거래처별 매출 TOP 10, 월별 손익 테이블(엑셀 '경영분석' 시트와 같은 구성).
- **데이터 관리**
  - **엑셀 내보내기** — 기간과 내용(매출+지출/매출만/지출만)을 골라 요약·월별손익·매출내역·지출내역
    시트로 된 .xlsx를 받습니다. 내역 시트는 가져오기와 열 이름이 같아 다시 불러올 수 있습니다.
  - **엑셀 가져오기** — 기존 경영관리 엑셀(.xlsm/.xlsx, 여러 파일 가능)의 매출집계·지출집계 형식 시트를
    브라우저에서 직접 파싱해 이관합니다. 저장 전에 시트별 건수·금액을 보여 주고 시트를 고를 수 있으며,
    엑셀 '경영분석' 시트의 월별 합계와 읽어 낸 내역을 대조합니다. 저장 후에는 파일과 시스템의 월별
    건수·금액을 다시 대조합니다. 같은 파일을 다시 올려도 중복 등록되지 않습니다(멱등).
  - **백업·복원** — 사용하는 날 하루 한 번 자동 백업, 가져오기·복원 직전 자동 백업, 지금 백업,
    백업 파일 받기·올려서 복원. 복원은 매출·지출·코드만 되돌리고 사용자 계정은 유지합니다.
- **코드관리** (관리자) — 매출유형/매출구분, 지출유형/거래품목, 결제유형, 계좌, 차량제조사,
  거래처, 통화 드랍다운 코드를 화면에서 직접 추가·삭제. 엑셀 '코드관리' 시트의 코드가 기본값입니다.
- **화면 모드 전환** — 자동(OS 설정) → 라이트 → 다크. 휴대폰 화면 폭에서도 가로로 넘치지 않습니다.

## 실행 방법

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python app.py
```

- 브라우저에서 <http://localhost:8000> 에 접속합니다(포트 변경: `PORT=9000`).
- 처음 접속하면 **처음 사용 설정** 화면이 나옵니다. 서버 창에 표시된 설정 코드를 넣고 관리자 계정을 만드세요.
- 윈도 PC에서는 `start_windows.bat`을 더블클릭하면 설치부터 실행까지 자동으로 합니다.
- 운영 서버(waitress)로 실행되며, 같은 네트워크의 휴대폰은 서버 창에 표시된 주소로 접속합니다.
- 매장 밖에서 접속하는 방법(매장 PC + Tailscale, PythonAnywhere, Docker)은 **[DEPLOY.md](DEPLOY.md)** 를 보세요.

데이터는 SQLite 파일 `wellcar.db`에, 자동 백업은 그 옆 `backups/` 폴더에 저장됩니다.

### 관리 명령

```bash
python manage.py list-users                 # 사용자 목록
python manage.py reset-password 아이디        # 비밀번호를 잊었을 때
python manage.py create-user 아이디 --role admin --name 홍길동
python manage.py backup                     # 지금 백업
```

### 데모 데이터

```bash
WELLCAR_ADMIN_PASSWORD=비밀번호8자이상 python seed_demo.py   # 최근 1년치 샘플 + 관리자(admin) 생성
python seed_demo.py --clear                                 # 모든 매출/지출 내역 삭제
```

### 웹 데모 (서버 없이 열리는 체험판)

`demo/`는 실제 화면 파일을 그대로 묶고, 서버 대신 브라우저 안의 목업 API(`demo/mock_api.js`)가 요청을 처리하는
HTML 한 장을 만듭니다. 데이터는 그 브라우저에만 저장됩니다. 데모 계정은 admin·staff·viewer(비밀번호 `demo1234`)입니다.

```bash
python demo/build_demo.py                    # demo/dist/wellcar_demo.html(게시용), preview.html(로컬 점검용)
python3 -m http.server 8010 -d demo/dist     # http://localhost:8010/preview.html
```

API나 화면을 바꾸면 `demo/mock_api.js`도 함께 고쳐야 합니다(자동으로 따라가지 않음).

## 구조

| 파일 | 역할 |
|---|---|
| `app.py` | Flask 서버: 스키마·마이그레이션, 로그인·권한, REST API(내역 CRUD·통계·코드·가져오기·내보내기·백업·사용자) |
| `backup.py` | SQLite 온라인 백업·보관 개수 관리·검사·복원 (Flask와 무관한 함수) |
| `exporter.py` | 엑셀(.xlsx) 내보내기 (openpyxl 쓰기 전용 모드) |
| `manage.py` | 관리 명령 (사용자·비밀번호·백업) |
| `static/index.html` | 단일 페이지 UI (로그인 / 10개 탭 / 대화상자) |
| `static/js/app.js` | 화면 로직 (로그인, 권한별 화면, 폼 자동계산, 목록·페이지, 통계, 데이터 관리) |
| `static/js/charts.js` | 경량 SVG 차트 (외부 라이브러리 없음, 오프라인 동작) |
| `static/js/xlsx_import.js` | 엑셀(.xlsx/.xlsm) 브라우저 파서 (ZIP+XML 직접 해석, 외부 라이브러리 없음) |
| `static/css/style.css` | 디자인 토큰 기반 스타일 (라이트/다크 모드) |
| `seed_demo.py` | 데모 데이터 생성/삭제 스크립트 |
| `demo/` | 웹 데모 소스: 브라우저 안 목업 API(`mock_api.js`), xlsx 작성기, 데모 장치(`demo_shell.js`), 빌드 스크립트 |
| `start_windows.bat` | 윈도 PC 실행기 (처음 실행 시 자동 설치) |
| `Dockerfile` | 컨테이너 이미지 (데이터는 `/data` 볼륨) |
| `DEPLOY.md` | 운영 배포 안내 |
| `tests/` | 자동 테스트 (아래 참고) |

## 테스트

```bash
.venv/bin/python -m unittest discover -s tests -v           # 백엔드 API 테스트 (임시 DB 사용)

# 화면 테스트: 임시 DB로 서버를 띄운 뒤
WELLCAR_DB=/tmp/ui.db WELLCAR_ADMIN_PASSWORD=dev-pass-1234 .venv/bin/python seed_demo.py
WELLCAR_DB=/tmp/ui.db .venv/bin/python app.py &
LANG=C.UTF-8 NODE_PATH=$(npm root -g) node tests/ui_smoke.js

# 엑셀 가져오기 대용량 검증: 원본과 같은 구조의 시험 파일을 만들어 빈 DB 서버에 올려 본다
.venv/bin/python tests/make_sample_workbook.py --out /tmp/sample.xlsm --sales 6000 --expenses 4000
LANG=C.UTF-8 NODE_PATH=$(npm root -g) FILE=/tmp/sample.xlsm TRUTH=/tmp/sample.json node tests/ui_import_check.js

# 웹 데모: 빌드해서 띄운 뒤 데모 전용 점검 + 같은 화면 테스트
python demo/build_demo.py
python3 -m http.server 8010 -d demo/dist &
LANG=C.UTF-8 NODE_PATH=$(npm root -g) node tests/ui_demo_check.js
BASE_URL=http://localhost:8010/preview.html UI_PASS=demo1234 LANG=C.UTF-8 NODE_PATH=$(npm root -g) node tests/ui_smoke.js
```

## API 요약

모든 `/api/*`는 로그인이 필요하며(아래 인증 3개 제외), GET이 아닌 요청에는
`X-Requested-With: XMLHttpRequest` 헤더가 있어야 합니다(다른 사이트의 위조 요청 차단).

- 인증: `GET /api/auth/state`, `POST /api/auth/login`, `POST /api/auth/setup`(첫 관리자),
  `POST /api/auth/logout`, `POST /api/auth/password`
- `GET/POST /api/incomes`, `GET/PUT/DELETE /api/incomes/<id>`, `POST /api/incomes/<id>/settle` — 매출 (지출은 `/api/expenses`)
  - 목록 필터: `date`, `from`, `to`, `type`, `payment`, `q`(여러 단어 AND, 숫자는 금액도 검색), `outstanding=1`
  - 페이지: `page`, `size`(최대 1000) → `{items, total, page, size, pages, sum: {amount, balance, vat}}`
- `GET /api/receivables` — 미수금·미지급금 잔액, 거래처별 합계, 내역
- `GET /api/stats/daily?date=` · `monthly?year=&month=` · `quarterly?year=&quarter=` · `yearly?year=` · `months?from=&to=`
- `GET /api/export.xlsx?kind=all|incomes|expenses&from=&to=&q=&type=&outstanding=` — 엑셀 내보내기
- `GET/POST /api/codes`, `DELETE /api/codes/<id>` — 코드 (변경은 관리자)
- `POST /api/import-json` — 엑셀에서 추출한 내역 일괄 등록 (관리자, 중복 자동 스킵, 직전 자동 백업)
- `GET/POST /api/backups`, `GET /api/backups/<name>/download`, `POST /api/backups/<name>/restore`,
  `POST /api/backups/upload`, `DELETE /api/backups/<name>` — 백업·복원 (관리자)
- `GET/POST /api/users`, `PUT/DELETE /api/users/<id>` — 사용자관리 (관리자)
