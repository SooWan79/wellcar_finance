# 웰카오디오 매출/지출관리 시스템

기존 엑셀(웰그룹·모두플래닛 경영관리 시스템, `2023 모두플래닛_수입지출관리.xlsm`) 기반 매출/지출
관리를 웹 시스템으로 옮긴 프로젝트입니다. PC나 휴대폰으로 로그인해 매출·지출을 건별로 등록하거나,
엑셀 입력 양식에 적어 올리면 자동으로 반영됩니다. 경영현황에서 일·주·월·분기·연 단위로
전기·전년 동기·목표와 비교한 경영지표를 보고, 브랜드·차종·서비스 구분별로 매출을 집계합니다.

## 주요 기능

- **로그인·권한** — 계정마다 관리자 / 직원 / 조회 전용 권한을 줍니다. 처음 접속하면 서버 창에 표시된
  설정 코드로 관리자 계정을 만들고, 사용자관리 탭에서 직원 계정을 추가합니다.
  로그인 유지(30일), 비밀번호 변경, 실패 반복 시 잠금, 사용 중지 시 즉시 로그아웃을 지원합니다.
  휴대폰에서는 브라우저의 '홈 화면에 추가'로 앱처럼 띄울 수 있습니다.
- **매출관리** — 영업일자·매출유형·매출구분(서비스 구분)·브랜드(차량제조사)·차종·제품모델·거래처·
  거래통화(KRW/CNY)·수량·단가·결제유형·세금계산서·계좌·**미수금**·**미지급금**·적요 입력.
  - 결제유형이 `카드`이거나 세금계산서 `Y`이면 부가세(매출액×10/110)와 순매출액이 자동 계산됩니다(엑셀과 같음).
  - CNY 거래는 `수량 × 단가 × 기준환율`로 원화 매출액이 자동 환산됩니다.
  - **미지급금**은 그 매출에서 거래처에 지급해야 할 금액(매출차감)입니다. **실매출 = 매출액 − 미지급금**이며,
    경영지표의 매출·영업이익은 실매출 기준입니다. 지급했는지는 '미지급 잔액'으로 따로 관리합니다.
  - 오른쪽 목록에서 **기간·유형·검색어·미수금 남은 건**으로 전체 내역을 찾고 페이지를 넘겨 볼 수 있으며,
    조회 결과를 그대로 엑셀로 받을 수 있습니다. 수정 화면에는 등록·수정한 사람과 시각이 표시됩니다.
- **지출관리** — 지출유형·거래품목(유형별 종속 드랍다운)·결제유형·거래처·**미지급금**·적요 입력.
  목록 기능은 매출관리와 같습니다.
- **미수·미지급** — 받을 돈(매출 미수금)과 줄 돈(지출 미지급금 + 매출에서 거래처에 줄 미지급금) 잔액,
  거래처별 합계, 오래된 순 내역과 경과일. 입금·지급이 끝나면 **완료**(여러 건 선택해 한 번에도 가능)로 정리합니다.
- **대시보드** — 선택한 날짜의 실매출·지출·영업이익(전일·작년 같은 날 대비), 이달 누계와 목표 대비 달성·진도,
  최근 14일 추이, 당일 매출·지출 내역.
- **경영현황** — 일별·주별·월별·분기별·연도별로 기간을 바꿔 가며 봅니다.
  - **전기(전일·전주·전월·전분기·전년)·전년 동기·목표 대비** 경영지표 비교표: 실매출·총매출·미지급금(매출차감)·
    지출·원가·영업이익·영업이익률·건수·객단가·영업일수·일평균 매출·카드/현금 매출·부가세·원가율·지출비중.
  - 진행 중인 기간(예: 이번 달 4일째)은 비교 기간도 같은 경과일만큼만 잘라 공정하게 비교합니다.
  - 목표 달성률 막대(오늘까지의 진도 표시), 매출 추이(이번 기간·전년 동기·목표), 누적 손익 차트,
    서비스구분별·브랜드별·지출유형별 구성, 재무·자금 흐름(입금액·거래처 지급액·지출 지급액·순현금흐름·부가세·미수·미지급 잔액).
- **매출·비용 분석** — 브랜드·차종·서비스 구분·매출유형·거래처·결제유형·제품모델·계좌(지출은 지출유형·거래품목·
  거래처·결제유형) 가운데 기준과 세부 기준(2단계, 예: 브랜드 › 차종)을 골라 실매출·총매출·건수·객단가(지출은 금액·건수)를
  합계·일·주·월·분기·연 단위 열로 집계하고, 전기·전년 동기 대비 증감을 함께 봅니다. 집계표는 엑셀로 받을 수 있습니다.
- **목표·실적** — 연도별로 월 목표(실매출·영업이익·지출 예산)를 만원 단위로 입력합니다. '작년 실적 기준 +N%'로
  한 번에 채우거나 1월 값을 모든 달에 복사할 수 있고, 월별 실적·달성률을 함께 봅니다.
  주·일 목표는 월 목표를 그 달 날짜 수로 나눠 계산합니다.
- **데이터 관리**
  - **엑셀로 입력하기(올리면 자동 반영)** — '엑셀 입력 양식'(매출입력·지출입력 시트, 코드 목록 드롭다운)을 받아
    한 줄에 한 건씩 적어 올리거나, 쓰던 경영관리 엑셀(매출집계·지출집계 시트)을 그대로 올립니다.
    - 새 내역은 자동 반영되고, 이미 올린 줄은 건너뜁니다(같은 파일을 다시 올려도 중복되지 않음).
    - 이 시스템에서 받은 엑셀을 고쳐 올리면 **관리번호**로 찾아 그 내역을 고칩니다. 그사이 화면에서 먼저 고친 내역은
      '충돌'로 알려 주고 덮어쓰지 않습니다.
    - 반영 방식: **추가·수정**(기본, 지우지 않음) / **엑셀 장부와 맞추기**(관리자, 파일 기간 안의 예전에 엑셀로 올린
      내역을 파일과 똑같이 맞춤 — 파일에서 지운 줄은 삭제, 화면에서 직접 입력한 내역은 유지).
    - 읽지 못한 줄·오류·충돌·삭제가 있거나, 관리번호를 찾지 못했거나, 엑셀 '경영분석' 월별 합계와 맞지 않으면
      자동 반영하지 않고 미리보기를 보여 줍니다('반영하기'를 눌러야 반영).
    - 반영 직전에 자동 백업하며, 관리자는 결과 화면의 **되돌리기**로 바로 복원할 수 있습니다.
  - **엑셀 내보내기** — 기간과 내용(매출+지출/매출만/지출만)을 골라 요약·월별손익·브랜드별·차종별·서비스구분별·
    지출유형별 집계·매출내역·지출내역 시트로 된 .xlsx를 받습니다. 내역 시트는 그대로 다시 올릴 수 있습니다.
  - **백업·복원** — 사용하는 날 하루 한 번 자동 백업, 가져오기·복원 직전 자동 백업, 지금 백업,
    백업 파일 받기·올려서 복원. 복원은 매출·지출·코드·목표만 되돌리고 사용자 계정은 유지합니다.
- **코드관리** (관리자) — 매출유형/매출구분, 지출유형/거래품목, 결제유형, 계좌, 차량제조사(브랜드)/차종,
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
- 매장 밖에서 PC·휴대폰으로 접속하는 방법(클라우드 PythonAnywhere, 매장 PC + Tailscale, Docker)은
  **[DEPLOY.md](DEPLOY.md)** 를 보세요.

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
WELLCAR_ADMIN_PASSWORD=비밀번호8자이상 python seed_demo.py   # 작년 1월 1일~오늘 샘플 + 올해 월별 목표 + 관리자(admin)
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
| `app.py` | Flask 서버: 스키마·마이그레이션, 로그인·권한, REST API(내역 CRUD·집계·목표·코드·가져오기·내보내기·양식·백업·사용자) |
| `backup.py` | SQLite 온라인 백업·보관 개수 관리·검사·복원 (Flask와 무관한 함수) |
| `exporter.py` | 엑셀(.xlsx) 내보내기와 입력 양식 (openpyxl) |
| `manage.py` | 관리 명령 (사용자·비밀번호·백업) |
| `static/index.html` | 단일 페이지 UI (로그인 / 10개 탭 / 대화상자) |
| `static/js/app.js` | 화면 로직 (로그인, 권한별 화면, 폼 자동계산, 목록·페이지, 대시보드, 미수·미지급, 데이터 관리) |
| `static/js/metrics.js` | 기간 계산 엔진: 일·주·월·분기·연 기간, 전기·전년 동기, 경과일 비교, 목표 안분, 지표 계산, 피벗 (Node 테스트 가능) |
| `static/js/reports.js` | 경영현황·매출·비용 분석·목표·실적 화면 |
| `static/js/charts.js` | 경량 SVG 차트 (막대·선·가로 막대, 외부 라이브러리 없음, 오프라인 동작) |
| `static/js/xlsx_import.js` | 엑셀(.xlsx/.xlsm) 브라우저 파서 (ZIP+XML 직접 해석, 외부 라이브러리 없음) |
| `static/js/xlsx_writer.js` | 브라우저 안 xlsx 작성기 (분석 집계표 엑셀 받기, 데모의 내보내기) |
| `static/css/style.css` | 디자인 토큰 기반 스타일 (라이트/다크 모드) |
| `static/manifest.webmanifest`, `static/icons/` | 휴대폰 '홈 화면에 추가'용 앱 정보와 아이콘 |
| `seed_demo.py` | 데모 데이터 생성/삭제 스크립트 |
| `demo/` | 웹 데모 소스: 브라우저 안 목업 API(`mock_api.js`), 데모 장치(`demo_shell.js`), 빌드 스크립트 |
| `start_windows.bat` | 윈도 PC 실행기 (처음 실행 시 자동 설치) |
| `Dockerfile` | 컨테이너 이미지 (데이터는 `/data` 볼륨) |
| `DEPLOY.md` | 운영 배포 안내 |
| `tests/` | 자동 테스트 (아래 참고) |

## 테스트

```bash
.venv/bin/python -m unittest discover -s tests -v           # 백엔드 API 테스트 (임시 DB 사용, 37개)
node tests/metrics_test.js                                  # 기간 계산 엔진(metrics.js) 테스트

# 화면 테스트: 임시 DB로 서버를 띄운 뒤 (엑셀 편집은 tests/xlsx_edit_helper.py를 .venv 파이썬으로 실행)
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
- `GET/POST /api/incomes`, `GET/PUT/DELETE /api/incomes/<id>` — 매출 (지출은 `/api/expenses`)
  - 목록 필터: `date`, `from`, `to`, `type`, `payment`, `q`(여러 단어 AND, 숫자는 금액도 검색), `outstanding=1`
  - 페이지: `page`, `size`(최대 1000) → `{items, total, page, size, pages, sum: {amount, balance, vat, payout}}`
- `POST /api/<incomes|expenses>/<id>/settle` `{field}` — 잔액을 0으로(매출: `receivable` 미수금·`payout_due` 미지급 잔액,
  지출: `payable`). `POST /api/settle-bulk` `{table, field, ids}` — 여러 건 한 번에
- `GET /api/receivables[?summary=1]` — 매출 미수금(`incomes`)·지출 미지급금(`expenses`)·매출 미지급금(`payouts`)
  잔액, 거래처별 합계, 내역
- `GET /api/agg?kind=incomes|expenses&from=&to=&group=date|month|year,<분류>&f.<분류>=값` — 기간 집계
  (경영현황·분석 화면의 원자료, 전기·전년 동기·목표 비교는 화면의 `metrics.js`가 계산)
  - 분류: 매출 `income_type`·`category`·`manufacturer`·`car_model`·`product_model`·`client`·`payment_type`·`account`·
    `currency`·`tax_invoice`, 지출 `expense_type`·`item`·`client`·`payment_type`·`currency`
  - 값: 매출 `cnt, amount, vat, payout, payout_due, receivable, card`, 지출 `cnt, amount, payable, cost`
- `GET /api/targets`, `PUT /api/targets` `{year, months: {"1": {sales, profit, expense}, …}}` — 월별 목표 (변경은 관리자)
- `GET /api/export.xlsx?kind=all|incomes|expenses&from=&to=&q=&type=&payment=&outstanding=` — 엑셀 내보내기
- `GET /api/template.xlsx` — 엑셀 입력 양식 (드롭다운은 현재 코드 목록)
- `POST /api/import-json` `{incomes, expenses, mode: append|sync, dry_run}` — 엑셀에서 읽은 내역 반영
  (직원 이상, `sync`는 관리자, 중복 자동 스킵·관리번호로 수정, 변경 직전 자동 백업)
- `GET /api/meta` — 데이터가 있는 연도, 오늘 날짜, 시스템 식별자
- `GET/POST /api/codes`, `DELETE /api/codes/<id>` — 코드 (변경은 관리자)
- `GET/POST /api/backups`, `GET /api/backups/<name>/download`, `POST /api/backups/<name>/restore`,
  `POST /api/backups/upload`, `DELETE /api/backups/<name>` — 백업·복원 (관리자)
- `GET/POST /api/users`, `PUT/DELETE /api/users/<id>` — 사용자관리 (관리자)
