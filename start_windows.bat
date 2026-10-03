@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 웰카오디오 매출/지출관리 시스템

rem ===== 설정 (필요하면 줄 앞의 rem 을 지우고 값을 바꾸세요) =====
rem 백업 폴더를 OneDrive·구글드라이브 같은 동기화 폴더로 정하면 PC가 고장 나도 백업이 남습니다.
rem set WELLCAR_BACKUP_DIR=%USERPROFILE%\OneDrive\웰카오디오백업
rem set PORT=8000
if "%PORT%"=="" set PORT=8000

where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")

if not exist ".venv\Scripts\python.exe" (
  echo [처음 실행] 프로그램 환경을 준비합니다. 1~2분 걸립니다...
  %PY% -m venv .venv || goto nopython
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt || goto fail
)
".venv\Scripts\python.exe" -m pip install -q -r requirements.txt >nul 2>nul

echo.
echo  이 창을 닫으면 프로그램이 멈춥니다. 쓰는 동안 창을 열어 두세요(최소화는 괜찮습니다).
echo  잠시 뒤 브라우저가 열립니다. 열리지 않으면 http://localhost:%PORT% 으로 접속하세요.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:%PORT%"
".venv\Scripts\python.exe" app.py
pause
exit /b

:nopython
echo.
echo 파이썬이 설치되어 있지 않습니다. https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행하세요.
echo 설치 첫 화면에서 "Add python.exe to PATH"를 꼭 체크하세요.
pause
exit /b 1

:fail
echo.
echo 필요한 구성 요소를 설치하지 못했습니다. 인터넷 연결을 확인하고 다시 실행하세요.
pause
exit /b 1
