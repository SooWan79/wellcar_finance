"""데모 아티팩트 HTML 만들기.

    python demo/build_demo.py            # → demo/dist/wellcar_demo.html, demo/dist/preview.html

실제 화면(static/index.html·css·js)을 그대로 쓰고, 서버 대신 demo/mock_api.js가
/api/* 요청을 브라우저 안에서 처리하게 한 파일 하나로 묶는다.
아티팩트 게시 규칙에 맞춰 <!doctype>·<html>·<head>·<body> 없이 <title>과 <style>로 시작한다.
게시는 Claude Code의 Artifact 도구로 기존 데모 주소에 덮어쓴다(CLAUDE.md '데모 아티팩트' 참고).

preview.html은 게시할 때 아티팩트가 씌우는 문서 뼈대를 똑같이 씌운 사본이다(로컬 점검용, 게시하지 않음).
    python3 -m http.server 8010 -d demo/dist    # → http://localhost:8010/preview.html
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(ROOT, "demo")
OUT = os.path.join(DEMO, "dist", "wellcar_demo.html")
PREVIEW = os.path.join(DEMO, "dist", "preview.html")
TITLE = "웰카오디오 매출/지출관리 시스템 (데모)"

# 아티팩트가 게시할 때 씌우는 뼈대(문자 집합·뷰포트·기본 리셋)와 같게 맞춘 것
SKELETON_HEAD = (
    '<!doctype html><html><head><meta charset=utf8>'
    '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">'
    '<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px)}'
    'body{margin:0;font:14px system-ui,sans-serif;background:#faf9f5;color:#141413}'
    'img{max-width:100%}[hidden]{display:none!important}</style></head><body>'
)
SKELETON_TAIL = "</body></html>\n"


def read(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return f.read()


def replace_once(text, old, new):
    if text.count(old) != 1:
        sys.exit(f"빌드 실패: 바꿀 부분을 정확히 한 번 찾지 못했습니다 → {old[:60]!r}")
    return text.replace(old, new)


BANNER = """<div class="demo-banner" role="note">
  <span><b>데모</b> 실제 서버 없이 이 브라우저 안에서만 동작합니다. 입력한 내용은 이 브라우저에만 저장되고 다른 사람에게는 보이지 않습니다.</span>
  <button type="button" class="btn small" data-demo-reset>처음 상태로 되돌리기</button>
</div>
"""

ACCOUNTS = """
    <div class="demo-accounts">
      <p class="demo-accounts-title">데모 계정으로 바로 들어가기 <span>비밀번호는 모두 demo1234</span></p>
      <div class="demo-accounts-row">
        <button type="button" class="btn small" data-demo-login="admin">관리자 · 사장</button>
        <button type="button" class="btn small" data-demo-login="staff">직원 · 김직원</button>
        <button type="button" class="btn small" data-demo-login="viewer">조회 전용 · 세무사</button>
      </div>
    </div>
"""

DEMO_CSS = """
/* ---------------- 데모 전용 ---------------- */
.demo-banner {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: center;
  gap: 6px 14px; padding: 8px 16px; font-size: var(--fs-sm); color: var(--ink-2);
  background: var(--accent-soft); border-bottom: 1px solid var(--hairline);
}
.demo-banner b { color: var(--accent-ink); margin-right: 4px; }
.demo-banner .btn { padding: 3px 10px; font-size: var(--fs-micro); }
.demo-accounts {
  margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--hairline);
  display: flex; flex-direction: column; gap: 8px;
}
.demo-accounts-title { margin: 0; font-size: var(--fs-sm); font-weight: 700; color: var(--ink-2); }
.demo-accounts-title span { font-weight: 500; color: var(--ink-3); margin-left: 6px; }
.demo-accounts-row { display: flex; flex-wrap: wrap; gap: 6px; }
"""

SCRIPTS = [
    ("demo", "xlsx_writer.js"),
    ("demo", "mock_api.js"),
    ("demo", "demo_shell.js"),
    ("static", "js", "xlsx_import.js"),
    ("static", "js", "charts.js"),
    ("static", "js", "app.js"),
]


def build():
    html = read("static", "index.html")
    body = re.search(r"<body>(.*)</body>", html, re.S).group(1)
    body = re.sub(r"\s*<script src=\"[^\"]+\"></script>", "", body)

    body = replace_once(body, '<div id="appShell" hidden>\n', '<div id="appShell" hidden>\n' + BANNER)
    body = replace_once(body, '      <p class="auth-error" id="loginError" role="alert"></p>\n    </form>\n',
                        '      <p class="auth-error" id="loginError" role="alert"></p>\n    </form>\n' + ACCOUNTS)
    body = replace_once(body, "계정이 없으면 관리자에게 만들어 달라고 요청하세요.",
                        "데모입니다. 아래 버튼을 누르거나 admin / demo1234로 로그인하세요.")
    # 데모 백업은 이 브라우저 안의 JSON 스냅숏이다
    body = replace_once(body, 'accept=".db,.sqlite,.sqlite3"', 'accept=".json,application/json"')

    scripts = []
    for parts in SCRIPTS:
        js = read(*parts)
        if "</script" in js.lower():
            sys.exit(f"빌드 실패: {'/'.join(parts)}에 </script 문자열이 있어 인라인할 수 없습니다.")
        scripts.append(f"<script>\n{js}\n</script>")

    css = read("static", "css", "style.css") + DEMO_CSS
    page = (f"<title>{TITLE}</title>\n<style>\n{css}\n</style>\n{body.strip()}\n" + "\n".join(scripts) + "\n")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(page)
    with open(PREVIEW, "w", encoding="utf-8") as f:
        f.write(SKELETON_HEAD + page + SKELETON_TAIL)
    print(f"{os.path.relpath(OUT, ROOT)} ({len(page.encode('utf-8')) / 1024:.0f}KB), "
          f"로컬 점검용 {os.path.relpath(PREVIEW, ROOT)}")


if __name__ == "__main__":
    build()
