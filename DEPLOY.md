# 운영 배포 안내 — 매장 밖에서도 접속하기

이 시스템은 로그인 기능이 있어서 인터넷에 열어 두어도 계정이 있는 사람만 쓸 수 있습니다.
아래 세 가지 중 하나를 고르면 됩니다. 가격과 무료 범위는 2026년 10월에 확인한 내용이며,
가입할 때 각 서비스 화면에서 다시 확인하세요.

| | A. 매장 PC + Tailscale (추천) | B. PythonAnywhere | C. 클라우드 서버 (Docker) |
|---|---|---|---|
| 비용 | 무료 (PC 전기료만) | 월 약 10달러 (Developer 플랜) | 월 5달러 안팎부터 |
| 데이터 위치 | 매장 PC | 해외 클라우드 | 고른 클라우드 |
| PC를 계속 켜 둬야 하나 | 예 | 아니요 | 아니요 |
| 접속 주소 예 | `https://wellcar.이름.ts.net` | `https://아이디.pythonanywhere.com` | 직접 정한 주소 |
| 난이도 | 쉬움 (설치 2개) | 보통 (웹 화면에서 설정) | 개발자용 |

- **A**는 비용이 없고 장부가 매장 밖으로 나가지 않습니다. 대신 PC가 꺼지면 접속할 수 없습니다.
- **B**는 PC와 상관없이 늘 켜져 있습니다. 무료(Beginner) 계정은 한 달마다 연장 버튼을 눌러야 해서 업무용으로는 맞지 않습니다.
- 어느 쪽이든 **처음 설정 → 계정 만들기 → 백업 확인** 순서는 같습니다(맨 아래 '공통').

---

## A. 매장 PC에서 상시 실행 (+ 밖에서는 Tailscale)

### 1) 프로그램 설치와 실행 (한 번만)

1. 파이썬을 설치합니다. <https://www.python.org/downloads/> 에서 받아 실행하고,
   첫 화면의 **"Add python.exe to PATH"를 꼭 체크**합니다.
2. GitHub 저장소에서 **Code → Download ZIP**으로 프로그램을 받아 `C:\wellcar` 같은 폴더에 압축을 풉니다.
3. 폴더 안의 **`start_windows.bat`을 더블클릭**합니다.
   - 처음에는 필요한 구성 요소를 자동으로 설치합니다(1~2분).
   - 끝나면 브라우저가 열리고 **처음 사용 설정** 화면이 나옵니다. 아래 '공통 1)'을 따라 하세요.
   - 검은 서버 창을 닫으면 프로그램이 멈춥니다. 최소화해 두세요.
4. 같은 와이파이의 휴대폰·태블릿은 서버 창에 표시된 `http://192.168.x.x:8000` 주소로 접속합니다.
   처음 실행할 때 윈도 방화벽 창이 뜨면 **개인 네트워크 허용**을 누르세요.

> **새 버전으로 바꿀 때:** 서버 창을 닫고, 새로 받은 ZIP을 **같은 폴더에 덮어쓰기**로 풀면 됩니다.
> 장부(`wellcar.db`)·백업(`backups`)·로그인 키(`.wellcar_secret_key`)는 ZIP에 없으므로 그대로 남습니다.
> 다음 실행 때 필요한 구성 요소는 자동으로 갱신됩니다.

### 2) PC를 켜면 자동으로 시작하기

1. `Win + R` → `shell:startup` 입력 → 열린 폴더에 `start_windows.bat`의 **바로 가기**를 넣습니다.
2. 설정 → 시스템 → 전원에서 **절전 모드를 '안 함'**으로 바꿉니다.

### 3) 밖에서 접속하기: Tailscale Funnel

Tailscale을 쓰면 공유기 설정 없이 매장 PC에 고정된 `https://…ts.net` 주소가 생깁니다.

1. <https://tailscale.com> 에 가입하고 매장 PC에 Tailscale 윈도 앱을 설치해 로그인합니다.
   2026년 기준 무료 개인 플랜으로 충분합니다(사용자 6명까지).
2. **명령 프롬프트**를 열고 다음을 입력합니다.
   ```
   tailscale funnel --bg 8000
   ```
   - 처음이면 Funnel을 켜는 링크가 나옵니다. 링크를 열어 허용한 뒤 같은 명령을 다시 입력합니다.
   - 화면에 나온 `https://PC이름.tailnet이름.ts.net` 이 **어디서나 쓰는 접속 주소**입니다.
   - 휴대폰에서 이 주소를 열고 '홈 화면에 추가'를 하면 앱처럼 쓸 수 있습니다.
3. 상태 확인은 `tailscale funnel status`, 외부 공개를 끄려면 `tailscale funnel reset` 을 입력합니다.

> **더 안전한 방법:** Funnel은 주소를 아는 누구나 로그인 화면까지는 볼 수 있습니다.
> 직원 휴대폰에도 Tailscale 앱을 설치할 수 있다면 `funnel` 대신 `tailscale serve --bg 8000` 을 쓰세요.
> 그러면 Tailscale에 로그인한 기기에서만 주소가 열립니다.

### 4) 백업을 PC 밖에도 두기

`start_windows.bat`을 메모장으로 열고 아래 줄의 `rem `을 지우면, 자동 백업이 OneDrive 폴더에 쌓여
PC가 고장 나도 남습니다(구글 드라이브 폴더도 됩니다).

```
set WELLCAR_BACKUP_DIR=%USERPROFILE%\OneDrive\웰카오디오백업
```

---

## B. PythonAnywhere (PC 없이 늘 켜진 주소)

1. <https://www.pythonanywhere.com> 에 가입하고 **Developer** 플랜을 고릅니다.
2. **Consoles → Bash**를 열고 다음을 차례로 입력합니다(`아이디`는 본인 PythonAnywhere 아이디).
   ```bash
   git clone -b claude/welkaudio-income-expense-system-fw15tm https://github.com/SooWan79/wellcar_finance.git
   python3.12 -m venv ~/wellcar-venv
   ~/wellcar-venv/bin/pip install -r ~/wellcar_finance/requirements.txt
   mkdir -p ~/wellcar-data
   ```
   - 저장소가 비공개면 `git clone`이 비밀번호를 묻습니다. GitHub의 개인 액세스 토큰을 넣거나,
     **Download ZIP**으로 받은 파일을 **Files** 탭에 올려 `unzip`으로 풀어도 됩니다.
3. **Web** 탭 → **Add a new web app** → **Manual configuration** → Python 3.12를 고릅니다.
   - **Virtualenv** 칸에 `/home/아이디/wellcar-venv` 를 적습니다.
4. 같은 화면의 **WSGI configuration file** 링크를 열어 내용을 모두 지우고 아래로 바꿉니다.
   ```python
   import os, sys
   path = "/home/아이디/wellcar_finance"
   if path not in sys.path:
       sys.path.insert(0, path)
   os.environ["WELLCAR_DB"] = "/home/아이디/wellcar-data/wellcar.db"
   os.environ["WELLCAR_HTTPS"] = "1"        # HTTPS에서만 로그인 쿠키 전송
   os.environ["WELLCAR_TRUST_PROXY"] = "1"  # 실제 접속 IP로 로그인 시도 제한
   from app import app as application
   ```
5. **Web** 탭에서 **Force HTTPS**를 켜고 맨 위 **Reload** 버튼을 누릅니다.
6. `https://아이디.pythonanywhere.com` 에 접속하면 **처음 사용 설정** 화면이 나옵니다.
   설정 코드는 **Web 탭 → Log files → error log** 맨 아래에 있습니다.
7. **업데이트할 때:** Bash 콘솔에서 `cd ~/wellcar_finance && git pull` → Web 탭 **Reload**.
8. **(선택) 매일 정해진 시각 백업:** Tasks 탭에 다음 명령을 등록합니다.
   ```
   cd /home/아이디/wellcar_finance && WELLCAR_DB=/home/아이디/wellcar-data/wellcar.db /home/아이디/wellcar-venv/bin/python manage.py backup
   ```
   이 등록을 하지 않아도 누군가 쓰는 날에는 하루 한 번 자동 백업됩니다.
   한 달에 한 번쯤 **데이터 관리 → 백업 → 받기**로 내 PC에도 보관하세요.

---

## C. 클라우드 서버 (Docker, 개발자용)

```bash
docker build -t wellcar .
docker run -d --name wellcar -p 8000:8000 -v wellcar-data:/data \
  -e WELLCAR_HTTPS=1 -e WELLCAR_TRUST_PROXY=1 wellcar
docker logs wellcar      # 처음 설정 코드 확인
```

- DB·백업·세션 키는 모두 `/data` 볼륨에 저장됩니다. 볼륨을 지우지 않는 한 컨테이너를 새로 만들어도 유지됩니다.
- HTTPS는 플랫폼 기능(Fly.io, Railway 등)이나 앞단 프록시(Caddy, Nginx)로 붙이세요.
  `WELLCAR_HTTPS`와 `WELLCAR_TRUST_PROXY`는 **HTTPS 프록시 뒤에서만** 켭니다.
- **Fly.io 예:** `fly launch --no-deploy` → `fly volumes create wellcar_data --size 1` →
  `fly.toml`에 `[mounts] source="wellcar_data" destination="/data"` 추가 → `fly deploy`.
  머신은 1대만 두세요. 이 시스템은 SQLite 파일 DB라 여러 대로 늘리면 데이터가 갈라집니다.

---

## 공통

### 1) 처음 사용 설정 (관리자 계정 만들기)

- 사용자가 아무도 없을 때 접속하면 **처음 사용 설정** 화면이 나옵니다.
- **설정 코드**는 서버 창(A), error log(B), `docker logs`(C)에 다음처럼 표시됩니다.
  주소를 먼저 알아낸 다른 사람이 관리자를 가로채지 못하게 하려는 장치입니다.
  ```
   설정 코드:  ABCD-EFGH
  ```
- 설정 코드 대신 환경변수 `WELLCAR_ADMIN_PASSWORD`(아이디 기본값 `admin`, 바꾸려면 `WELLCAR_ADMIN_USER`)를
  지정하고 처음 실행해도 관리자 계정이 만들어집니다. 만든 뒤에는 이 환경변수를 지우세요.

### 2) 직원 계정과 권한

**사용자관리** 탭에서 계정을 만듭니다. 퇴사자는 삭제 대신 **사용 중지**하면 등록 기록이 남습니다.

| 권한 | 할 수 있는 일 |
|---|---|
| 관리자 | 모든 기능 (사용자관리, 코드관리, 엑셀 가져오기, 백업·복원) |
| 직원 | 매출·지출 등록·수정·삭제, 미수·미지급 처리, 조회, 엑셀 내보내기 |
| 조회 전용 | 조회와 엑셀 내보내기만 (세무사·동업자 등) |

### 3) 비밀번호를 잊었을 때

서버가 도는 PC(또는 PythonAnywhere의 Bash 콘솔)에서 프로그램 폴더로 가서 실행합니다.

```
python manage.py list-users
python manage.py reset-password 아이디
```

### 4) 백업

- 쓰는 날에는 **하루 한 번 자동 백업**됩니다. 종류별로 최근 30개를 보관합니다.
  엑셀 가져오기 직전과 복원 직전에도 자동으로 백업합니다.
- **데이터 관리 → 백업·복원**에서 지금 백업, 받기, 복원을 할 수 있습니다.
- 복원은 매출·지출·코드만 되돌리고 **사용자 계정은 그대로** 둡니다.
- 백업 파일에는 비밀번호 원문은 없지만(암호화된 값만 있음) 장부 전체가 들어 있습니다.
  USB나 클라우드에 둘 때도 남에게 공유하지 마세요.

### 5) 환경변수 정리

| 이름 | 뜻 | 기본값 |
|---|---|---|
| `WELLCAR_DB` | DB 파일 경로 | 프로그램 폴더의 `wellcar.db` |
| `WELLCAR_BACKUP_DIR` | 백업 폴더 | DB 옆 `backups` 폴더 |
| `PORT` / `HOST` | 접속 포트 / 받을 주소 | `8000` / `0.0.0.0`(같은 네트워크 허용) |
| `WELLCAR_SECRET_KEY` | 로그인 쿠키 서명 키 | DB 옆 `.wellcar_secret_key` 파일에 자동 생성 |
| `WELLCAR_HTTPS` | `1`이면 HTTPS에서만 로그인 쿠키 전송 | 꺼짐 |
| `WELLCAR_TRUST_PROXY` | `1`이면 프록시가 알려 준 실제 IP 사용 | 꺼짐 |
| `WELLCAR_ADMIN_USER` / `WELLCAR_ADMIN_PASSWORD` | 첫 관리자 자동 생성 | 없음 |

### 6) 보안 점검표

- 비밀번호는 8자 이상이며, 아이디와 같으면 거절됩니다. 서로 다른 비밀번호를 쓰세요.
- 같은 아이디·같은 IP로 5번 틀리면 10분간 로그인이 막힙니다.
- 외부에 알리는 주소는 **https** 주소만 쓰세요.
- 퇴사·역할 변경은 바로 **사용자관리**에 반영하세요. 사용 중지하면 그 사람의 로그인이 즉시 끊깁니다.
