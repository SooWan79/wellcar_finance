"""웰카오디오 매출/지출관리 시스템 - Flask 백엔드"""
import hmac
import math
import mimetypes
import os
import re
import secrets
import socket
import sqlite3
import sys
import threading
import time
from collections import Counter
from datetime import date, datetime, timedelta
from functools import wraps
from io import BytesIO

from flask import Flask, g, jsonify, request, send_file, session
from werkzeug.security import check_password_hash, generate_password_hash

import backup
import exporter

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("WELLCAR_DB", os.path.join(BASE_DIR, "wellcar.db"))
DATA_DIR = os.path.dirname(os.path.abspath(DB_PATH))
BACKUP_DIR = os.environ.get("WELLCAR_BACKUP_DIR") or os.path.join(DATA_DIR, "backups")
BACKUP_INTERVAL_HOURS = 24


def _env_flag(name):
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


mimetypes.add_type("application/manifest+json", ".webmanifest")  # 휴대폰 '홈 화면에 추가'
app = Flask(__name__, static_folder="static", static_url_path="")
app.config.update(
    SESSION_COOKIE_NAME="wellcar_session",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=_env_flag("WELLCAR_HTTPS"),
    PERMANENT_SESSION_LIFETIME=timedelta(days=30),
    MAX_CONTENT_LENGTH=64 * 1024 * 1024,  # 엑셀 가져오기 JSON·백업 파일 업로드 상한
)
if _env_flag("WELLCAR_TRUST_PROXY"):
    # 클라우드 HTTPS 프록시 뒤에서 실제 접속 IP·프로토콜을 쓰기 위함 (프록시가 없을 때 켜면 IP 위조 가능)
    from werkzeug.middleware.proxy_fix import ProxyFix
    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)


# ---------------------------------------------------------------- DB helpers
def connect():
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    return db


def get_db():
    db = getattr(g, "_db", None)
    if db is None:
        db = g._db = connect()
    return db


@app.teardown_appcontext
def close_db(_exc):
    db = getattr(g, "_db", None)
    if db is not None:
        db.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS incomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trx_date TEXT NOT NULL,
    income_type TEXT NOT NULL,
    category TEXT DEFAULT '',
    manufacturer TEXT DEFAULT '',
    product_model TEXT DEFAULT '',
    client TEXT DEFAULT '',
    currency TEXT DEFAULT 'KRW',
    exchange_rate REAL DEFAULT 1,
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    vat INTEGER NOT NULL DEFAULT 0,
    net_amount INTEGER NOT NULL DEFAULT 0,
    account TEXT DEFAULT '',
    payment_type TEXT DEFAULT '',
    tax_invoice TEXT DEFAULT 'N',
    memo TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trx_date TEXT NOT NULL,
    expense_type TEXT NOT NULL,
    item TEXT DEFAULT '',
    payment_type TEXT DEFAULT '',
    client TEXT DEFAULT '',
    currency TEXT DEFAULT 'KRW',
    exchange_rate REAL DEFAULT 1,
    quantity REAL DEFAULT 1,
    unit_price REAL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    memo TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code_group TEXT NOT NULL,
    code_value TEXT NOT NULL,
    parent_value TEXT DEFAULT '',
    sort_order INTEGER DEFAULT 0,
    UNIQUE(code_group, code_value, parent_value)
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT DEFAULT '',
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'staff',
    active INTEGER NOT NULL DEFAULT 1,
    session_version INTEGER NOT NULL DEFAULT 1,
    last_login_at TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS targets (
    month TEXT NOT NULL,          -- 'YYYY-MM'
    metric TEXT NOT NULL,         -- sales(매출 목표) / profit(영업이익 목표) / expense(지출 예산)
    value INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (month, metric)
);
CREATE INDEX IF NOT EXISTS idx_incomes_date ON incomes(trx_date);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(trx_date);
"""

# 이미 쓰고 있는 wellcar.db를 위해 기존 테이블에 나중에 추가한 열 (기존 데이터 보존).
# 새 DB도 같은 순서로 추가되어 열 구성이 항상 같다.
COLUMN_MIGRATIONS = {
    "incomes": [
        ("receivable", "INTEGER NOT NULL DEFAULT 0"),  # 미수금 (아직 받지 못한 금액)
        ("created_by", "TEXT DEFAULT ''"),
        ("updated_by", "TEXT DEFAULT ''"),
        ("updated_at", "TEXT DEFAULT ''"),
        ("car_model", "TEXT DEFAULT ''"),              # 차종
        ("payout", "INTEGER NOT NULL DEFAULT 0"),      # 미지급금: 이 매출에서 거래처에 줄 돈(매출에서 차감)
        ("payout_due", "INTEGER NOT NULL DEFAULT 0"),  # 그중 아직 거래처에 지급하지 않은 금액
        ("source", "TEXT DEFAULT ''"),                 # 'excel' = 엑셀 업로드로 들어온 내역
        ("import_key", "TEXT DEFAULT ''"),             # 엑셀에서 들어올 때의 중복 판정 키
    ],
    "expenses": [
        ("payable", "INTEGER NOT NULL DEFAULT 0"),  # 미지급금 (아직 지급하지 않은 금액)
        ("created_by", "TEXT DEFAULT ''"),
        ("updated_by", "TEXT DEFAULT ''"),
        ("updated_at", "TEXT DEFAULT ''"),
        ("source", "TEXT DEFAULT ''"),
        ("import_key", "TEXT DEFAULT ''"),
    ],
}

# 엑셀 '코드관리' / '제품모델_마스터' / '거래처마스터' 시트 기준 초기 코드
SEED_CODES = {
    "income_type": ["서비스제공", "상품판매", "기타"],
    "income_category": {
        "서비스제공": ["내비게이션수리", "데크수리", "메카니즘수리", "카오디오수리",
                   "앰프수리", "탈부착"],
        "상품판매": ["카오디오", "앰프", "스피커", "내비게이션", "블랙박스",
                  "휴대폰강화유리", "자동차액세서리"],
        "기타": ["기타"],
    },
    "expense_type": ["제품원가", "구매계약", "비용", "인건비", "제세공과금", "생활", "기타"],
    "expense_item": {
        "제품원가": ["제품매입", "서비스이용"],
        "구매계약": ["서비스계약", "렌탈계약", "리스계약", "자문계약", "원부자재구매",
                  "제품구매", "물품구매", "비품구매", "자산구매"],
        "비용": ["복리후생비", "식대", "업무경비", "수수료", "광고비", "피복비", "회의비",
               "수도광열비", "통신비", "보험료", "의료비", "임차료", "도서인쇄비",
               "교육훈련비", "여비교통비", "출장비", "차량유지비", "이자비용"],
        "인건비": ["급여", "수당", "잡급"],
        "제세공과금": ["재산세", "법인세", "부가세"],
        "생활": ["마트", "식당", "간식비", "생활용품", "기타"],
        "기타": ["기타"],
    },
    "payment_type": ["현금", "카드", "계좌입금"],
    "account": ["국민(법인)", "기업(웰카오디오-개인)", "농협1(웰카오디오-개인)",
                "농협2(웰파츠-개인)", "카드"],
    "currency": ["KRW", "CNY"],
    "manufacturer": ["벤츠", "BMW", "아우디", "폭스바겐", "볼보", "닛산", "토요타",
                     "현대", "르노", "레인지로버", "N/A"],
    # 차종: 브랜드(차량제조사)별 기본 목록. 매출 화면에서는 고르거나 직접 입력한다.
    "car_model": {
        "벤츠": ["A클래스", "C클래스", "E클래스", "S클래스", "CLS", "GLA", "GLC", "GLE", "GLS"],
        "BMW": ["1시리즈", "3시리즈", "5시리즈", "7시리즈", "X1", "X3", "X5", "X6", "X7"],
        "아우디": ["A3", "A4", "A6", "A7", "A8", "Q3", "Q5", "Q7"],
        "폭스바겐": ["골프", "제타", "파사트", "티구안", "투아렉"],
        "볼보": ["S60", "S90", "XC40", "XC60", "XC90"],
        "닛산": ["알티마", "맥시마", "무라노", "패스파인더"],
        "토요타": ["캠리", "프리우스", "라브4", "시에나"],
        "현대": ["아반떼", "쏘나타", "그랜저", "제네시스", "투싼", "싼타페", "팰리세이드"],
        "르노": ["SM6", "QM6", "XM3"],
        "레인지로버": ["레인지로버", "레인지로버 스포츠", "벨라", "이보크", "디스커버리"],
    },
    "client": ["개인", "방문", "해덕", "동서카오디오(대구)", "재즈카오디오(광주)",
               "재즈카오디오(대구)", "현대카오디오(서울)", "수원테크(수원)",
               "닥터카오디오(수원)", "써브카오디오(안산)", "오토사운드(논산)",
               "주문진카오디오(주문진)", "창원카오디오(창원)", "슈퍼그립",
               "미스터짱카", "11번가", "옥션", "G마켓"],
}


def _seed_code_groups(db):
    """기본 코드를 넣는다. 그룹마다 한 번만 넣고(settings에 표시), 이미 코드가 있는 그룹은 건드리지 않는다.
    나중에 생긴 그룹(예: 차종)도 기존 DB에 한 번 채워지고, 사용자가 모두 지운 그룹이 되살아나지 않는다."""
    for group, values in SEED_CODES.items():
        flag = f"seeded:{group}"
        if get_setting(db, flag):
            continue
        if not db.execute("SELECT 1 FROM codes WHERE code_group=? LIMIT 1", (group,)).fetchone():
            pairs = ([(v, parent) for parent, children in values.items() for v in children]
                     if isinstance(values, dict) else [(v, "") for v in values])
            order = {}
            for v, parent in pairs:
                i = order.get(parent, 0)
                order[parent] = i + 1
                db.execute("INSERT OR IGNORE INTO codes(code_group, code_value, parent_value, sort_order)"
                           " VALUES (?,?,?,?)", (group, v, parent, i))
        db.execute("INSERT OR REPLACE INTO settings(key, value) VALUES (?, '1')", (flag,))


_PAYOUT_NOTE_RE = re.compile(r"\s*\[미지급금 ([0-9,]+)원\]$")


def _data_migrations(db):
    """예전 데이터를 새 열로 옮긴다(여러 번 실행해도 결과가 같음). DB를 열 때와 백업 복원 뒤에 실행."""
    # 1) 예전 엑셀 가져오기가 적요 끝에 남긴 '[미지급금 N원]' → 미지급금(매출차감) 열
    for r in db.execute("SELECT id, memo, amount FROM incomes "
                        "WHERE payout = 0 AND memo LIKE '%[미지급금 %원]'").fetchall():
        m = _PAYOUT_NOTE_RE.search(r["memo"] or "")
        if not m:
            continue
        n = min(int(m.group(1).replace(",", "")), max(r["amount"], 0))
        db.execute("UPDATE incomes SET payout=?, payout_due=?, memo=? WHERE id=?",
                   (n, n, r["memo"][:m.start()].rstrip(), r["id"]))
    # 2) 엑셀로 들어온 내역 표시: 엑셀 장부와 맞추기·중복 판정에 쓴다
    for table in ("incomes", "expenses"):
        for r in db.execute(f"SELECT * FROM {table} WHERE source = '' AND created_by LIKE '%(엑셀)'").fetchall():
            db.execute(f"UPDATE {table} SET source='excel', import_key=? WHERE id=?",
                       (_key_str(_dedupe_key(r, IMPORT_KEYS[table])), r["id"]))


def _migrate_columns(db):
    for table, columns in COLUMN_MIGRATIONS.items():
        have = {r[1] for r in db.execute(f"PRAGMA table_info({table})")}
        for name, ddl in columns:
            if name not in have:
                try:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}")
                except sqlite3.OperationalError as e:  # 동시에 뜬 다른 프로세스가 먼저 추가한 경우
                    if "duplicate column" not in str(e):
                        raise


def get_setting(db, key, default=None):
    row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row[0] if row else default


def init_db():
    os.makedirs(DATA_DIR, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    db.executescript(SCHEMA)
    _migrate_columns(db)
    _seed_code_groups(db)
    _data_migrations(db)
    # 이 DB의 식별자: 내보낸 엑셀을 다시 올릴 때 '관리번호'가 이 DB의 번호인지 확인하는 데 쓴다
    db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('instance_id', ?)", (secrets.token_hex(6),))
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0:
        if not _bootstrap_admin_from_env(db):
            _announce_setup_code(db)
    db.commit()
    db.close()


# ---------------------------------------------------------------- 계정·권한
ROLES = {"viewer": 1, "staff": 2, "admin": 3}
ROLE_LABELS = {"admin": "관리자", "staff": "직원", "viewer": "조회 전용"}
USERNAME_RE = re.compile(r"^[A-Za-z0-9가-힣._-]{2,30}$")
MIN_PASSWORD = 8
MAX_PASSWORD = 128  # 아주 긴 입력으로 해시 계산을 오래 붙잡지 못하게
SETUP_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # 헷갈리는 0/O, 1/I 제외


def _validate_password(password, username=""):
    if len(password) < MIN_PASSWORD:
        return f"비밀번호는 {MIN_PASSWORD}자 이상이어야 합니다."
    if len(password) > MAX_PASSWORD:
        return f"비밀번호는 {MAX_PASSWORD}자 이하여야 합니다."
    if username and password.lower() == username.lower():
        return "아이디와 같은 비밀번호는 쓸 수 없습니다."
    return None


def _validate_username(username):
    if not USERNAME_RE.match(username):
        return "아이디는 2~30자의 한글·영문·숫자와 . _ - 만 쓸 수 있습니다."
    return None


def _create_user(db, username, password, role, display_name=""):
    cur = db.execute(
        "INSERT INTO users(username, display_name, password_hash, role) VALUES (?,?,?,?)",
        (username, display_name, generate_password_hash(password), role))
    return cur.lastrowid


def _bootstrap_admin_from_env(db):
    """WELLCAR_ADMIN_PASSWORD가 있으면 첫 관리자 계정을 자동으로 만든다(클라우드 배포용)."""
    password = os.environ.get("WELLCAR_ADMIN_PASSWORD", "")
    if not password:
        return False
    username = os.environ.get("WELLCAR_ADMIN_USER", "admin").strip() or "admin"
    err = _validate_username(username) or _validate_password(password, username)
    if err:
        print(f"[웰카오디오] WELLCAR_ADMIN_PASSWORD로 관리자를 만들지 못했습니다: {err}", file=sys.stderr)
        return False
    try:
        _create_user(db, username, password, "admin", "관리자")
    except sqlite3.IntegrityError:  # 동시에 뜬 다른 프로세스가 이미 만듦
        return True
    print(f"[웰카오디오] 관리자 계정 '{username}'을 만들었습니다.", file=sys.stderr)
    return True


def _announce_setup_code(db):
    """첫 관리자 계정을 만들 때 입력할 설정 코드를 만들고 서버 창(로그)에 표시한다."""
    raw = "".join(secrets.choice(SETUP_ALPHABET) for _ in range(8))
    # 이미 있으면 그대로 두고 저장된 값을 보여 준다(여러 프로세스가 동시에 떠도 코드가 하나로 맞음)
    db.execute("INSERT OR IGNORE INTO settings(key, value) VALUES ('setup_code', ?)",
               (f"{raw[:4]}-{raw[4:]}",))
    code = get_setting(db, "setup_code")
    print("\n" + "=" * 64 +
          "\n 웰카오디오 매출/지출관리 시스템 - 처음 사용 설정"
          "\n 브라우저로 접속해 관리자 계정을 만들 때 아래 설정 코드를 입력하세요."
          f"\n\n     설정 코드:  {code}\n" + "=" * 64 + "\n", file=sys.stderr, flush=True)


def _load_secret_key():
    """세션 서명 키. 환경변수가 없으면 DB 옆 파일에 만들어 재시작해도 로그인이 유지되게 한다.
    (DB 안에 두지 않는 이유: 백업 파일을 내려받은 사람이 세션을 위조하지 못하게)"""
    env = os.environ.get("WELLCAR_SECRET_KEY")
    if env:
        return env
    path = os.path.join(DATA_DIR, ".wellcar_secret_key")
    for _ in range(2):
        try:
            with open(path, encoding="utf-8") as f:
                key = f.read().strip()
            if key:
                return key
        except FileNotFoundError:
            pass
        try:
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            continue  # 다른 프로세스가 방금 만들었으면 다시 읽는다
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            key = secrets.token_hex(32)
            f.write(key)
        return key
    raise RuntimeError(f"세션 키 파일을 만들 수 없습니다: {path}")


def json_body():
    """요청 JSON 본문 (객체가 아니면 빈 dict)."""
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def user_label(user):
    return (user["display_name"] or user["username"]) if user else ""


def user_public(row):
    return {"id": row["id"], "username": row["username"], "display_name": row["display_name"] or "",
            "name": user_label(row), "role": row["role"], "role_label": ROLE_LABELS.get(row["role"], ""),
            "active": bool(row["active"]), "last_login_at": row["last_login_at"] or "",
            "created_at": row["created_at"] or ""}


def current_user():
    if "user" not in g:
        g.user = None
        uid = session.get("uid")
        if uid:
            row = get_db().execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
            if row and row["active"] and row["session_version"] == session.get("sv"):
                g.user = row
    return g.user


def _start_session(row, remember):
    session.clear()
    session["uid"] = row["id"]
    session["sv"] = row["session_version"]
    session.permanent = bool(remember)


def role_required(role):
    def deco(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            user = current_user()
            if user is None:
                return jsonify({"error": "로그인이 필요합니다.", "auth": "login"}), 401
            if ROLES.get(user["role"], 0) < ROLES[role]:
                return jsonify({"error": f"{ROLE_LABELS[role]} 권한이 필요한 기능입니다."}), 403
            return fn(*args, **kwargs)
        return wrapper
    return deco


# 로그인·설정 코드 무차별 대입 방지 (프로세스 메모리, 10분 창)
_fail_lock = threading.Lock()
_failures = {}
FAIL_WINDOW = 600


def _recent_failures(key):
    now = time.time()
    with _fail_lock:
        recent = [t for t in _failures.get(key, []) if now - t < FAIL_WINDOW]
        if recent:
            _failures[key] = recent
        else:
            _failures.pop(key, None)
        return len(recent)


def _record_failure(*keys):
    now = time.time()
    with _fail_lock:
        if len(_failures) > 5000:  # 오래된 키 정리
            for k in [k for k, v in _failures.items() if now - v[-1] >= FAIL_WINDOW]:
                del _failures[k]
        for key in keys:
            _failures.setdefault(key, []).append(now)


def _clear_failures(*keys):
    with _fail_lock:
        for key in keys:
            _failures.pop(key, None)


PUBLIC_API = {"/api/auth/state", "/api/auth/login", "/api/auth/setup"}
SELF_SERVICE_API = {"/api/auth/logout", "/api/auth/password"}
SAFE_METHODS = ("GET", "HEAD", "OPTIONS")


@app.before_request
def guard_api():
    path = request.path
    if not path.startswith("/api/"):
        return None
    # 다른 사이트가 몰래 보내는 요청(CSRF) 차단: 이 앱의 화면만 이 헤더를 붙인다
    if request.method not in SAFE_METHODS and request.headers.get("X-Requested-With") != "XMLHttpRequest":
        return jsonify({"error": "허용되지 않은 요청입니다."}), 400
    if path in PUBLIC_API:
        return None
    user = current_user()
    if user is None:
        return jsonify({"error": "로그인이 필요합니다.", "auth": "login"}), 401
    if (request.method not in SAFE_METHODS and path not in SELF_SERVICE_API
            and ROLES.get(user["role"], 0) < ROLES["staff"]):
        return jsonify({"error": "조회 전용 계정은 내용을 바꿀 수 없습니다."}), 403
    maybe_auto_backup()
    return None


@app.after_request
def security_headers(resp):
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "same-origin")
    if request.path.startswith("/api/"):
        resp.headers["Cache-Control"] = "no-store"
    elif resp.mimetype == "text/html":
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
            "script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
    return resp


@app.route("/api/auth/state")
def auth_state():
    db = get_db()
    setup_required = db.execute("SELECT COUNT(*) FROM users").fetchone()[0] == 0
    user = current_user()
    return jsonify({"setup_required": setup_required,
                    "user": user_public(user) if user else None})


_DUMMY_HASH = generate_password_hash(secrets.token_hex(8))


@app.route("/api/auth/login", methods=["POST"])
def login():
    body = json_body()
    username = str(body.get("username") or "").strip()[:60]
    password = str(body.get("password") or "")[:MAX_PASSWORD + 1]
    key_ip = f"login:{request.remote_addr}:{username.lower()}"
    key_user = f"login-user:{username.lower()}"
    if _recent_failures(key_ip) >= 5 or _recent_failures(key_user) >= 20:
        return jsonify({"error": "로그인 실패가 여러 번 반복되었습니다. 10분 뒤에 다시 시도하세요."}), 429
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
    # 없는 아이디도 같은 시간이 걸리도록 비교는 항상 한다
    ok = check_password_hash(row["password_hash"] if row else _DUMMY_HASH, password)
    if not row or not ok:
        _record_failure(key_ip, key_user)
        return jsonify({"error": "아이디 또는 비밀번호가 맞지 않습니다."}), 401
    if not row["active"]:
        return jsonify({"error": "사용이 중지된 계정입니다. 관리자에게 문의하세요."}), 403
    _clear_failures(key_ip, key_user)
    _start_session(row, body.get("remember"))
    db.execute("UPDATE users SET last_login_at=datetime('now','localtime') WHERE id=?", (row["id"],))
    db.commit()
    return jsonify({"user": user_public(row)})


@app.route("/api/auth/setup", methods=["POST"])
def setup_first_admin():
    body = json_body()
    key = f"setup:{request.remote_addr}"
    if _recent_failures(key) >= 5 or _recent_failures("setup") >= 30:
        return jsonify({"error": "설정 코드 입력 실패가 반복되었습니다. 10분 뒤에 다시 시도하세요."}), 429
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        if db.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
            return jsonify({"error": "이미 관리자 계정이 있습니다. 로그인하세요."}), 409
        expected = (get_setting(db, "setup_code") or "").replace("-", "")
        given = re.sub(r"[\s-]", "", str(body.get("setup_code") or "")).upper()
        if not expected or not hmac.compare_digest(given.encode("utf-8"), expected.encode("utf-8")):
            _record_failure(key, "setup")
            return jsonify({"error": "설정 코드가 맞지 않습니다. 서버 창(로그)에 표시된 코드를 확인하세요."}), 403
        username = str(body.get("username") or "").strip()
        password = str(body.get("password") or "")
        display_name = str(body.get("display_name") or "").strip()[:30]
        err = _validate_username(username) or _validate_password(password, username)
        if err:
            return jsonify({"error": err}), 400
        uid = _create_user(db, username, password, "admin", display_name)
        db.execute("DELETE FROM settings WHERE key='setup_code'")
        db.commit()
    finally:
        if db.in_transaction:
            db.rollback()
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    _clear_failures(key)
    _start_session(row, True)
    return jsonify({"user": user_public(row)}), 201


@app.route("/api/auth/logout", methods=["POST"])
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/auth/password", methods=["POST"])
def change_password():
    user = current_user()
    body = json_body()
    current = str(body.get("current_password") or "")[:MAX_PASSWORD + 1]
    new = str(body.get("new_password") or "")
    key = f"password:{user['id']}"
    if _recent_failures(key) >= 5:
        return jsonify({"error": "현재 비밀번호를 여러 번 틀렸습니다. 10분 뒤에 다시 시도하세요."}), 429
    if not check_password_hash(user["password_hash"], current):
        _record_failure(key)
        return jsonify({"error": "현재 비밀번호가 맞지 않습니다."}), 403
    err = _validate_password(new, user["username"])
    if err:
        return jsonify({"error": err}), 400
    db = get_db()
    # 세션 버전을 올려 다른 기기의 로그인을 끊고, 지금 기기는 새 버전으로 유지
    db.execute("UPDATE users SET password_hash=?, session_version=session_version+1 WHERE id=?",
               (generate_password_hash(new), user["id"]))
    db.commit()
    row = db.execute("SELECT * FROM users WHERE id=?", (user["id"],)).fetchone()
    _start_session(row, session.permanent)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- 사용자관리 (관리자)
@app.route("/api/users")
@role_required("admin")
def list_users():
    rows = get_db().execute("SELECT * FROM users ORDER BY active DESC, role='admin' DESC, id").fetchall()
    return jsonify([user_public(r) for r in rows])


@app.route("/api/users", methods=["POST"])
@role_required("admin")
def create_user():
    body = json_body()
    username = str(body.get("username") or "").strip()
    password = str(body.get("password") or "")
    role = body.get("role") or "staff"
    display_name = str(body.get("display_name") or "").strip()[:30]
    if not isinstance(role, str) or role not in ROLES:
        return jsonify({"error": "권한 값이 올바르지 않습니다."}), 400
    err = _validate_username(username) or _validate_password(password, username)
    if err:
        return jsonify({"error": err}), 400
    db = get_db()
    try:
        uid = _create_user(db, username, password, role, display_name)
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "이미 있는 아이디입니다."}), 409
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    return jsonify(user_public(row)), 201


def _other_active_admins(db, uid):
    return db.execute("SELECT COUNT(*) FROM users WHERE role='admin' AND active=1 AND id<>?",
                      (uid,)).fetchone()[0]


@app.route("/api/users/<int(max=9223372036854775807):uid>", methods=["PUT"])
@role_required("admin")
def update_user(uid):
    body = json_body()
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        return jsonify({"error": "해당 사용자가 없습니다."}), 404
    me = current_user()
    sets, args = [], []
    if "display_name" in body:
        sets.append("display_name=?")
        args.append(str(body.get("display_name") or "").strip()[:30])
    role = body.get("role", row["role"])
    active = body.get("active", bool(row["active"]))
    if not isinstance(role, str) or role not in ROLES:
        return jsonify({"error": "권한 값이 올바르지 않습니다."}), 400
    if not isinstance(active, bool):
        return jsonify({"error": "사용 여부 값이 올바르지 않습니다."}), 400
    if uid == me["id"] and (role != row["role"] or not active):
        return jsonify({"error": "본인 계정의 권한과 사용 여부는 바꿀 수 없습니다."}), 400
    if row["role"] == "admin" and row["active"] and (role != "admin" or not active) \
            and not _other_active_admins(db, uid):
        return jsonify({"error": "관리자가 최소 한 명은 있어야 합니다."}), 400
    sets += ["role=?", "active=?"]
    args += [role, int(active)]
    if body.get("password"):
        err = _validate_password(str(body["password"]), row["username"])
        if err:
            return jsonify({"error": err}), 400
        sets.append("password_hash=?")
        args.append(generate_password_hash(str(body["password"])))
    if body.get("password") or (row["active"] and not active):
        sets.append("session_version=session_version+1")  # 비밀번호 재설정·사용 중지 시 기존 로그인 해제
    db.execute(f"UPDATE users SET {', '.join(sets)} WHERE id=?", args + [uid])
    db.commit()
    return jsonify(user_public(db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()))


@app.route("/api/users/<int(max=9223372036854775807):uid>", methods=["DELETE"])
@role_required("admin")
def delete_user(uid):
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        return jsonify({"error": "해당 사용자가 없습니다."}), 404
    if uid == current_user()["id"]:
        return jsonify({"error": "본인 계정은 삭제할 수 없습니다."}), 400
    if row["role"] == "admin" and row["active"] and not _other_active_admins(db, uid):
        return jsonify({"error": "관리자가 최소 한 명은 있어야 합니다."}), 400
    db.execute("DELETE FROM users WHERE id=?", (uid,))
    db.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------- 자동 백업
_backup_lock = threading.Lock()
_next_backup_check = 0.0


def maybe_auto_backup():
    """요청을 처리하는 김에 하루 한 번 자동 백업 (별도 스케줄러가 없는 호스팅에서도 동작).
    데이터가 바뀌는 건 누군가 쓰고 있을 때뿐이므로 이 방식으로 충분하다."""
    global _next_backup_check
    now = time.time()
    if now < _next_backup_check or not _backup_lock.acquire(blocking=False):
        return
    try:
        _next_backup_check = now + 600
        backup.auto_backup_if_due(DB_PATH, BACKUP_DIR, BACKUP_INTERVAL_HOURS)
    except Exception as e:  # 백업 실패가 업무를 막지 않게 기록만 한다
        app.logger.warning("자동 백업 실패: %s", e)
    finally:
        _backup_lock.release()


# ---------------------------------------------------------------- utilities
WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]

INCOME_FIELDS = ["trx_date", "income_type", "category", "manufacturer", "car_model", "product_model",
                 "client", "currency", "exchange_rate", "quantity", "unit_price",
                 "amount", "vat", "net_amount", "account", "payment_type",
                 "tax_invoice", "memo", "receivable", "payout", "payout_due"]
EXPENSE_FIELDS = ["trx_date", "expense_type", "item", "payment_type", "client",
                  "currency", "exchange_rate", "quantity", "unit_price", "amount", "memo",
                  "payable"]
NUMERIC_FIELDS = ("exchange_rate", "quantity", "unit_price", "amount", "vat", "net_amount",
                  "receivable", "payable", "payout", "payout_due")
INTEGER_FIELDS = ("amount", "vat", "net_amount", "receivable", "payable", "payout", "payout_due")
TYPE_FIELD = {"incomes": "income_type", "expenses": "expense_type"}
BALANCE_FIELD = {"incomes": "receivable", "expenses": "payable"}
BALANCE_LABEL = {"incomes": "미수금", "expenses": "미지급금"}
# '완료' 처리로 0이 되는 잔액 열. 매출의 payout_due는 거래처에 줄 미지급금 중 아직 안 준 금액
SETTLE_FIELDS = {"incomes": ("receivable", "payout_due"), "expenses": ("payable",)}
SEARCH_FIELDS = {
    "incomes": ("client", "memo", "product_model", "category", "manufacturer", "car_model",
                "income_type", "account"),
    "expenses": ("client", "memo", "item", "expense_type"),
}
MAX_NUMBER = 10 ** 13  # 10조 원: SQLite 정수 범위 안에서 넉넉한 상한


def round_half_up(v):
    """화면(JS Math.round)과 같은 반올림. 파이썬 round()는 .5를 짝수로 보내 결과가 달라질 수 있다."""
    return int(math.floor(float(v) + 0.5))


FIELD_LABELS = {
    "trx_date": "영업일자", "income_type": "매출유형", "expense_type": "지출유형", "amount": "금액",
    "category": "매출구분", "manufacturer": "브랜드", "car_model": "차종", "product_model": "제품모델",
    "client": "거래처", "currency": "거래통화", "exchange_rate": "기준환율", "quantity": "수량",
    "unit_price": "단가", "vat": "부가세", "net_amount": "순매출액", "account": "계좌",
    "payment_type": "결제유형", "tax_invoice": "세금계산서", "memo": "적요", "receivable": "미수금",
    "payout": "미지급금", "payout_due": "미지급 잔액", "item": "거래품목", "payable": "미지급금",
}
TABLE_SPEC = {
    "incomes": (INCOME_FIELDS, ["trx_date", "income_type", "amount"]),
    "expenses": (EXPENSE_FIELDS, ["trx_date", "expense_type", "amount"]),
}


def row_to_dict(row):
    d = dict(row)
    try:
        wd = datetime.strptime(d["trx_date"], "%Y-%m-%d").weekday()
        d["weekday"] = WEEKDAYS[wd]
    except (KeyError, ValueError):
        d["weekday"] = ""
    return d


def _clean_entry(raw, fields, required, table, clamp_balance=False):
    """입력값 검증·정리. (data, 오류문구) 반환.
    clamp_balance: 엑셀 가져오기처럼 원본을 고칠 수 없을 때 미수금·미지급금을 0~금액 범위로 맞춘다."""
    data = {f: raw[f] for f in fields if f in raw}
    for f in required:
        if not data.get(f):
            return None, f"{FIELD_LABELS.get(f, f)} 값이 필요합니다."
    try:  # '2026-1-5'처럼 들어와도 정렬·월별 집계가 맞도록 항상 0을 채운 형식으로 저장
        data["trx_date"] = datetime.strptime(str(data["trx_date"]).strip(), "%Y-%m-%d").strftime("%Y-%m-%d")
    except (KeyError, ValueError):
        return None, "영업일자는 YYYY-MM-DD 형식이어야 합니다."
    for f in NUMERIC_FIELDS:
        if f in data:
            if data[f] in (None, ""):
                del data[f]
                continue
            try:
                v = float(data[f])
            except (TypeError, ValueError):
                return None, f"{FIELD_LABELS.get(f, f)} 값이 숫자가 아닙니다."
            if not math.isfinite(v):
                return None, f"{FIELD_LABELS.get(f, f)} 값이 숫자가 아닙니다."
            if abs(v) > MAX_NUMBER:
                return None, f"{FIELD_LABELS.get(f, f)} 값이 너무 큽니다."
            data[f] = round_half_up(v) if f in INTEGER_FIELDS else v
    for f in required:
        if f in NUMERIC_FIELDS and not data.get(f):
            return None, f"{FIELD_LABELS.get(f, f)} 값이 필요합니다."
    for f in fields:
        if f in data and f not in NUMERIC_FIELDS:
            data[f] = str(data[f] if data[f] is not None else "").strip()[:500]
    if "tax_invoice" in data:
        data["tax_invoice"] = "Y" if data["tax_invoice"].upper() == "Y" else "N"
    if "currency" in data:
        data["currency"] = data["currency"].upper() or "KRW"
    bal = BALANCE_FIELD[table]
    cap = max(data.get("amount", 0), 0)
    if bal in data and clamp_balance:
        data[bal] = min(max(data[bal], 0), cap)
    if bal in data:
        if data[bal] < 0:
            return None, f"{BALANCE_LABEL[table]}은 0 이상이어야 합니다."
        if data[bal] > cap:
            return None, f"{BALANCE_LABEL[table]}은 금액보다 클 수 없습니다."
    if table == "incomes":
        # 미지급금(거래처에 줄 돈)만 오면 아직 지급하지 않은 것으로 본다
        if "payout" in data and "payout_due" not in data:
            data["payout_due"] = data["payout"]
        if clamp_balance:
            if "payout" in data:
                data["payout"] = min(max(data["payout"], 0), cap)
            if "payout_due" in data:
                data["payout_due"] = min(max(data["payout_due"], 0), data.get("payout", cap))
        if "payout" in data and not 0 <= data["payout"] <= cap:
            return None, "미지급금은 0원부터 매출액까지 입력할 수 있습니다."
        if "payout_due" in data and not 0 <= data["payout_due"] <= data.get("payout", cap):
            return None, "미지급 잔액은 0원부터 미지급금까지만 될 수 있습니다."
    return data, None


def _escape_like(s):
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _entry_filters(table, args):
    """목록·내보내기 공통 조건절. (' WHERE ...', params)"""
    where, params = [], []
    for key, cond in (("date", "trx_date = ?"), ("from", "trx_date >= ?"), ("to", "trx_date <= ?")):
        if args.get(key):
            where.append(cond)
            params.append(args[key])
    if args.get("type"):
        where.append(f"{TYPE_FIELD[table]} = ?")
        params.append(args["type"])
    if args.get("payment"):
        where.append("payment_type = ?")
        params.append(args["payment"])
    if args.get("outstanding") in ("1", "true"):
        where.append(f"{BALANCE_FIELD[table]} > 0")
    for word in (args.get("q") or "").split()[:5]:  # 여러 단어는 모두 포함(AND)
        ors = [f"{f} LIKE ? ESCAPE '\\'" for f in SEARCH_FIELDS[table]]
        params += [f"%{_escape_like(word)}%"] * len(ors)
        digits = word.replace(",", "")
        if re.fullmatch(r"-?\d+", digits):  # 숫자를 입력하면 금액이 같은 내역도 찾는다
            ors.append("amount = ?")
            params.append(int(digits))
        where.append("(" + " OR ".join(ors) + ")")
    return (" WHERE " + " AND ".join(where)) if where else "", params


def _int_arg(name, default, lo, hi):
    try:
        return min(max(int(request.args.get(name, default)), lo), hi)
    except (TypeError, ValueError):
        return default


# ---------------------------------------------------------------- 매출·지출 내역
def _list_entries(table):
    where, params = _entry_filters(table, request.args)
    size = _int_arg("size", 50, 1, 1000)
    page = _int_arg("page", 1, 1, 10 ** 6)
    db = get_db()
    vat = ", COALESCE(SUM(vat),0) AS vat, COALESCE(SUM(payout),0) AS payout" if table == "incomes" else ""
    agg = db.execute(
        f"SELECT COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS amount, "
        f"COALESCE(SUM({BALANCE_FIELD[table]}),0) AS balance{vat} FROM {table}{where}", params).fetchone()
    total = agg["cnt"]
    pages = max(1, math.ceil(total / size))
    page = min(page, pages)
    rows = db.execute(
        f"SELECT * FROM {table}{where} ORDER BY trx_date DESC, id DESC LIMIT ? OFFSET ?",
        params + [size, (page - 1) * size]).fetchall()
    sums = {"amount": agg["amount"], "balance": agg["balance"]}
    if table == "incomes":
        sums["vat"] = agg["vat"]
        sums["payout"] = agg["payout"]
    return jsonify({"items": [row_to_dict(r) for r in rows], "total": total, "page": page,
                    "size": size, "pages": pages, "sum": sums})


def _get_entry(table, rid):
    row = get_db().execute(f"SELECT * FROM {table} WHERE id=?", (rid,)).fetchone()
    if not row:
        return jsonify({"error": "해당 내역이 없습니다."}), 404
    return jsonify(row_to_dict(row))


def _save_entry(table, rid=None):
    fields, required = TABLE_SPEC[table]
    db = get_db()
    raw = json_body()
    if rid is not None:
        # 일부 항목만 보낸 수정도 저장된 값과 합쳐서 검사한다(예: 미수금이 금액을 넘지 않는지)
        row = db.execute(f"SELECT * FROM {table} WHERE id=?", (rid,)).fetchone()
        if not row:
            return jsonify({"error": "해당 내역이 없습니다."}), 404
        merged = {f: row[f] for f in fields}
        merged.update({k: v for k, v in raw.items() if k in fields})
        raw = merged
    data, err = _clean_entry(raw, fields, required, table)
    if err:
        return jsonify({"error": err}), 400
    who = user_label(current_user())
    if rid is None:
        data["created_by"] = who
        cols = ", ".join(data)
        marks = ", ".join("?" * len(data))
        cur = db.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(data.values()))
        rid = cur.lastrowid
        status = 201
    else:
        data["updated_by"] = who
        data["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        sets = ", ".join(f"{k}=?" for k in data)
        cur = db.execute(f"UPDATE {table} SET {sets} WHERE id=?", list(data.values()) + [rid])
        if cur.rowcount == 0:
            return jsonify({"error": "해당 내역이 없습니다."}), 404
        status = 200
    db.commit()
    row = db.execute(f"SELECT * FROM {table} WHERE id=?", (rid,)).fetchone()
    return jsonify(row_to_dict(row)), status


def _delete_entry(table, rid):
    db = get_db()
    cur = db.execute(f"DELETE FROM {table} WHERE id=?", (rid,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "해당 내역이 없습니다."}), 404
    return jsonify({"ok": True})


def _settle_field(table, body):
    field = body.get("field") or BALANCE_FIELD[table]
    return field if field in SETTLE_FIELDS[table] else None


def _settle_entry(table, rid):
    """미수금·미지급금을 0으로 정리 (입금·지급 완료 처리).
    본문 {"field": "payout_due"}이면 매출의 거래처 미지급금을 지급 완료로 바꾼다(매출차감 금액은 그대로)."""
    field = _settle_field(table, json_body())
    if not field:
        return jsonify({"error": "정리할 항목이 올바르지 않습니다."}), 400
    db = get_db()
    cur = db.execute(
        f"UPDATE {table} SET {field}=0, updated_by=?, updated_at=? WHERE id=?",
        (user_label(current_user()), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), rid))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "해당 내역이 없습니다."}), 404
    return jsonify(row_to_dict(db.execute(f"SELECT * FROM {table} WHERE id=?", (rid,)).fetchone()))


@app.route("/api/settle-bulk", methods=["POST"])
def settle_bulk():
    """여러 건을 한 번에 입금·지급 완료로 정리. 본문 {table, field, ids: [...]}"""
    body = json_body()
    table = body.get("table")
    if table not in SETTLE_FIELDS:
        return jsonify({"error": "table은 incomes 또는 expenses여야 합니다."}), 400
    field = _settle_field(table, body)
    ids = body.get("ids")
    if not field:
        return jsonify({"error": "정리할 항목이 올바르지 않습니다."}), 400
    if (not isinstance(ids, list) or not 1 <= len(ids) <= 1000
            or not all(isinstance(i, int) and not isinstance(i, bool) and 0 < i < 2 ** 63 for i in ids)):
        return jsonify({"error": "ids는 1~1000개의 내역 번호 목록이어야 합니다."}), 400
    db = get_db()
    marks = ",".join("?" * len(ids))
    cur = db.execute(
        f"UPDATE {table} SET {field}=0, updated_by=?, updated_at=? WHERE {field} > 0 AND id IN ({marks})",
        [user_label(current_user()), datetime.now().strftime("%Y-%m-%d %H:%M:%S")] + ids)
    db.commit()
    return jsonify({"updated": cur.rowcount})


def _register_entry_routes(table):
    base = f"/api/{table}"
    app.add_url_rule(base, f"list_{table}", lambda: _list_entries(table), methods=["GET"])
    app.add_url_rule(base, f"create_{table}", lambda: _save_entry(table), methods=["POST"])
    app.add_url_rule(f"{base}/<int(max=9223372036854775807):rid>", f"get_{table}", lambda rid: _get_entry(table, rid),
                     methods=["GET"])
    app.add_url_rule(f"{base}/<int(max=9223372036854775807):rid>", f"update_{table}", lambda rid: _save_entry(table, rid),
                     methods=["PUT"])
    app.add_url_rule(f"{base}/<int(max=9223372036854775807):rid>", f"delete_{table}", lambda rid: _delete_entry(table, rid),
                     methods=["DELETE"])
    app.add_url_rule(f"{base}/<int(max=9223372036854775807):rid>/settle", f"settle_{table}",
                     lambda rid: _settle_entry(table, rid), methods=["POST"])


_register_entry_routes("incomes")
_register_entry_routes("expenses")


# ---------------------------------------------------------------- 미수금·미지급금 현황
@app.route("/api/receivables")
def receivables():
    """받을 돈(매출 미수금)과 줄 돈(지출 미지급금 + 매출에서 거래처에 줄 미지급금) 잔액."""
    db = get_db()
    summary = request.args.get("summary") in ("1", "true")  # 합계만 (대시보드·경영현황용)
    out = {}
    for key, table, bal in (("incomes", "incomes", "receivable"), ("expenses", "expenses", "payable"),
                            ("payouts", "incomes", "payout_due")):
        tot = db.execute(f"SELECT COUNT(*) AS cnt, COALESCE(SUM({bal}),0) AS total "
                         f"FROM {table} WHERE {bal} > 0").fetchone()
        if summary:
            out[key] = {"total": tot["total"], "count": tot["cnt"]}
            continue
        by_client = [dict(r) for r in db.execute(
            f"""SELECT COALESCE(NULLIF(client,''),'(미지정)') AS name, SUM({bal}) AS value,
                       COUNT(*) AS cnt, MIN(trx_date) AS oldest
                FROM {table} WHERE {bal} > 0 GROUP BY name ORDER BY value DESC""")]
        items = [row_to_dict(r) for r in db.execute(
            f"SELECT * FROM {table} WHERE {bal} > 0 ORDER BY trx_date, id LIMIT 500")]
        out[key] = {"total": tot["total"], "count": tot["cnt"], "by_client": by_client,
                    "items": items}
    return jsonify(out)


# ---------------------------------------------------------------- 코드관리
@app.route("/api/codes", methods=["GET"])
def list_codes():
    db = get_db()
    rows = db.execute(
        "SELECT * FROM codes ORDER BY code_group, parent_value, sort_order, id").fetchall()
    grouped = {}
    for r in rows:
        grouped.setdefault(r["code_group"], []).append(dict(r))
    return jsonify(grouped)


@app.route("/api/codes", methods=["POST"])
@role_required("admin")
def create_code():
    body = json_body()
    group = str(body.get("code_group") or "").strip()
    value = str(body.get("code_value") or "").strip()[:100]
    parent = str(body.get("parent_value") or "").strip()
    if not group or not value:
        return jsonify({"error": "코드그룹과 코드값이 필요합니다."}), 400
    db = get_db()
    row = db.execute(
        "SELECT COALESCE(MAX(sort_order),-1)+1 FROM codes WHERE code_group=? AND parent_value=?",
        (group, parent)).fetchone()
    try:
        cur = db.execute(
            "INSERT INTO codes(code_group, code_value, parent_value, sort_order) VALUES (?,?,?,?)",
            (group, value, parent, row[0]))
        db.commit()
    except sqlite3.IntegrityError:
        return jsonify({"error": "이미 등록된 코드입니다."}), 409
    return jsonify({"id": cur.lastrowid, "code_group": group, "code_value": value,
                    "parent_value": parent}), 201


@app.route("/api/codes/<int(max=9223372036854775807):rid>", methods=["DELETE"])
@role_required("admin")
def delete_code(rid):
    db = get_db()
    cur = db.execute("DELETE FROM codes WHERE id=?", (rid,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "해당 코드가 없습니다."}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------- 집계 (경영현황·분석 화면이 쓰는 원자료)
AGG_DIMS = {
    "incomes": ("income_type", "category", "manufacturer", "car_model", "product_model", "client",
                "payment_type", "account", "currency", "tax_invoice"),
    "expenses": ("expense_type", "item", "client", "payment_type", "currency"),
}
AGG_TIME = {"date": "trx_date", "month": "substr(trx_date,1,7)", "year": "substr(trx_date,1,4)"}
AGG_MEASURES = {
    # 현금매출(카드 외 전부)은 화면에서 amount − card로 구한다 (엑셀과 같은 기준)
    "incomes": ("COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(vat),0) AS vat, "
                "COALESCE(SUM(payout),0) AS payout, COALESCE(SUM(payout_due),0) AS payout_due, "
                "COALESCE(SUM(receivable),0) AS receivable, "
                "COALESCE(SUM(CASE WHEN payment_type='카드' THEN amount ELSE 0 END),0) AS card"),
    "expenses": ("COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(payable),0) AS payable, "
                 "COALESCE(SUM(CASE WHEN expense_type='제품원가' THEN amount ELSE 0 END),0) AS cost"),
}
AGG_MAX_ROWS = 200000
AGG_MAX_DAYS = 366 * 30


def _year_ok(year):
    return 1900 <= year <= 2999


def _parse_day(s):
    try:
        d = datetime.strptime(str(s or ""), "%Y-%m-%d").date()
    except ValueError:
        return None
    return d if _year_ok(d.year) else None


@app.route("/api/agg")
def aggregate():
    """기간 내 매출·지출을 날짜·월·연도와 분류(브랜드·차종·서비스구분 등)별로 합산한다.

    ?kind=incomes|expenses&from=YYYY-MM-DD&to=YYYY-MM-DD&group=date,manufacturer (서로 다른 항목 3개까지)
    &f.<분류>=값 (그 값인 내역만). 손익·전기·전년 동기·목표 비교는 화면(metrics.js)이 이 결과로 계산한다."""
    kind = request.args.get("kind", "")
    if kind not in AGG_MEASURES:
        return jsonify({"error": "kind는 incomes 또는 expenses여야 합니다."}), 400
    d_from, d_to = _parse_day(request.args.get("from")), _parse_day(request.args.get("to"))
    if not d_from or not d_to or d_from > d_to:
        return jsonify({"error": "from, to는 YYYY-MM-DD 형식이고 from이 to보다 앞서야 합니다."}), 400
    if (d_to - d_from).days > AGG_MAX_DAYS:
        return jsonify({"error": "조회 기간이 너무 깁니다."}), 400
    groups = [g for g in (request.args.get("group") or "").split(",") if g]
    if len(groups) > 3 or len(set(groups)) != len(groups):
        return jsonify({"error": "group은 서로 다른 항목 3개까지입니다."}), 400
    exprs = []
    for g in groups:
        if g in AGG_TIME:
            exprs.append(AGG_TIME[g])
        elif g in AGG_DIMS[kind]:
            exprs.append(f"COALESCE({g},'')")
        else:
            return jsonify({"error": f"알 수 없는 group 항목입니다: {g}"}), 400
    where, params = ["trx_date BETWEEN ? AND ?"], [d_from.isoformat(), d_to.isoformat()]
    for key, value in request.args.items():
        if key.startswith("f."):
            dim = key[2:]
            if dim not in AGG_DIMS[kind]:
                return jsonify({"error": f"알 수 없는 조건 항목입니다: {dim}"}), 400
            where.append(f"COALESCE({dim},'') = ?")
            params.append(value)
    select = ", ".join([f'{e} AS "{g}"' for e, g in zip(exprs, groups)] + [AGG_MEASURES[kind]])
    sql = f"SELECT {select} FROM {kind} WHERE {' AND '.join(where)}"
    if exprs:
        sql += f" GROUP BY {', '.join(exprs)} ORDER BY {', '.join(exprs)}"
    rows = get_db().execute(f"{sql} LIMIT {AGG_MAX_ROWS + 1}", params).fetchall()
    return jsonify({"kind": kind, "from": d_from.isoformat(), "to": d_to.isoformat(), "group": groups,
                    "rows": [dict(r) for r in rows[:AGG_MAX_ROWS]], "truncated": len(rows) > AGG_MAX_ROWS})


# ---------------------------------------------------------------- 목표 (월별 매출·영업이익 목표, 지출 예산)
TARGET_METRICS = ("sales", "profit", "expense")


def _targets_payload(db):
    out = {}
    for r in db.execute("SELECT month, metric, value FROM targets ORDER BY month, metric"):
        out.setdefault(r["month"], {})[r["metric"]] = r["value"]
    return {"targets": out}


@app.route("/api/targets")
def get_targets():
    return jsonify(_targets_payload(get_db()))


@app.route("/api/targets", methods=["PUT"])
@role_required("admin")
def put_targets():
    """한 해의 월별 목표를 통째로 바꾼다. 본문 {year, months: {"1": {sales, profit, expense}, ...}}
    값이 비어 있으면 그 목표를 지운다. 매출 목표는 실매출(매출액 − 미지급금) 기준이다."""
    body = json_body()
    year, months = body.get("year"), body.get("months")
    if (not isinstance(year, int) or isinstance(year, bool) or not _year_ok(year)
            or not isinstance(months, dict)):
        return jsonify({"error": "year(연도)와 months(월별 목표)가 필요합니다."}), 400
    rows = []
    for m in range(1, 13):
        vals = months.get(str(m)) or {}
        if not isinstance(vals, dict):
            return jsonify({"error": f"{m}월 목표 형식이 올바르지 않습니다."}), 400
        for metric in TARGET_METRICS:
            v = vals.get(metric)
            if v is None or v == "":
                rows.append((f"{year}-{m:02d}", metric, None))
                continue
            try:
                n = float(v)
            except (TypeError, ValueError):
                return jsonify({"error": f"{m}월 목표 값이 숫자가 아닙니다."}), 400
            if not math.isfinite(n) or abs(n) > MAX_NUMBER or (metric != "profit" and n < 0):
                return jsonify({"error": f"{m}월 목표 값이 올바르지 않습니다."}), 400
            rows.append((f"{year}-{m:02d}", metric, round_half_up(n)))
    db = get_db()
    for month, metric, value in rows:
        if value is None:
            db.execute("DELETE FROM targets WHERE month=? AND metric=?", (month, metric))
        else:
            db.execute("INSERT OR REPLACE INTO targets(month, metric, value) VALUES (?,?,?)",
                       (month, metric, value))
    db.commit()
    return jsonify(_targets_payload(db))


def _monthly_rows(db, inc_filter=None, exp_filter=None):
    """월별 건수·합계(엑셀 내보내기의 월별손익). *_filter는 _entry_filters 결과이며 None이면 그 테이블은 0."""
    months = {}

    def slot(m):
        return months.setdefault(m, {"month": m, "income_count": 0, "income": 0, "vat": 0,
                                     "net_income": 0, "receivable": 0, "payout": 0, "payout_due": 0,
                                     "expense_count": 0, "expense": 0, "payable": 0})
    if inc_filter is not None:
        where, params = inc_filter
        for r in db.execute(
                f"""SELECT substr(trx_date,1,7) AS m, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS amount,
                           COALESCE(SUM(vat),0) AS vat, COALESCE(SUM(net_amount),0) AS net,
                           COALESCE(SUM(receivable),0) AS bal, COALESCE(SUM(payout),0) AS payout,
                           COALESCE(SUM(payout_due),0) AS payout_due
                    FROM incomes{where} GROUP BY m""", params):
            s = slot(r["m"])
            s.update(income_count=r["cnt"], income=r["amount"], vat=r["vat"], net_income=r["net"],
                     receivable=r["bal"], payout=r["payout"], payout_due=r["payout_due"])
    if exp_filter is not None:
        where, params = exp_filter
        for r in db.execute(
                f"""SELECT substr(trx_date,1,7) AS m, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS amount,
                           COALESCE(SUM(payable),0) AS bal
                    FROM expenses{where} GROUP BY m""", params):
            s = slot(r["m"])
            s.update(expense_count=r["cnt"], expense=r["amount"], payable=r["bal"])
    rows = [months[k] for k in sorted(months)]
    for s in rows:
        s["sales"] = s["income"] - s["payout"]  # 실매출 = 매출액 − 미지급금(매출차감)
        s["profit"] = s["sales"] - s["expense"]
    return rows


# ---------------------------------------------------------------- 엑셀 내보내기
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_UNSET = "'(미지정)'"


def _count_where(db, table, filt, cond):
    where, params = filt
    return db.execute(f"SELECT COUNT(*) FROM {table}{where}{' AND' if where else ' WHERE'} {cond}",
                      params).fetchone()[0]


def _dimension_spec(db, table, filt, title, label, name_sql, value_sql, note, by_year):
    """엑셀 내보내기의 분류별 집계표 (분류 × 월, 기간이 길면 × 연도)."""
    where, params = filt
    col = "substr(trx_date,1,4)" if by_year else "substr(trx_date,1,7)"
    rows = {}
    for r in db.execute(f"SELECT {name_sql} AS name, {col} AS c, COUNT(*) AS cnt, "
                        f"COALESCE(SUM({value_sql}),0) AS v FROM {table}{where} GROUP BY name, c", params):
        it = rows.setdefault(r["name"], {"name": r["name"], "cnt": 0, "total": 0, "cells": {}})
        it["cnt"] += r["cnt"]
        it["total"] += r["v"]
        it["cells"][r["c"]] = r["v"]
    cols = sorted({c for it in rows.values() for c in it["cells"]})
    return {"title": title, "label": label, "note": note, "cols": cols,
            "col_labels": [f"{c}년" if by_year else c for c in cols],
            "rows": sorted(rows.values(), key=lambda it: (-it["total"], it["name"]))}


@app.route("/api/export.xlsx")
def export_xlsx():
    kind = request.args.get("kind", "all")
    if kind not in ("all", "incomes", "expenses"):
        return jsonify({"error": "kind는 all, incomes, expenses 중 하나여야 합니다."}), 400
    for key in ("from", "to"):
        v = request.args.get(key)
        if v:
            try:
                datetime.strptime(v, "%Y-%m-%d")
            except ValueError:
                return jsonify({"error": "기간은 YYYY-MM-DD 형식이어야 합니다."}), 400
    inc_on, exp_on = kind in ("all", "incomes"), kind in ("all", "expenses")
    db = get_db()
    inc_f = _entry_filters("incomes", request.args) if inc_on else None
    exp_f = _entry_filters("expenses", request.args) if exp_on else None
    monthly = _monthly_rows(db, inc_f, exp_f)
    totals = {k: sum(m[k] for m in monthly) for k in
              ("income", "income_count", "vat", "net_income", "receivable", "payout", "payout_due",
               "expense", "expense_count", "payable")}
    totals["receivable_count"] = _count_where(db, "incomes", inc_f, "receivable > 0") if inc_on else 0
    totals["payout_due_count"] = _count_where(db, "incomes", inc_f, "payout_due > 0") if inc_on else 0
    totals["payable_count"] = _count_where(db, "expenses", exp_f, "payable > 0") if exp_on else 0

    d_from, d_to = request.args.get("from") or "", request.args.get("to") or ""
    period = f"{d_from or '처음'} ~ {d_to or '오늘까지'}" if (d_from or d_to) else "전체 기간"
    conds = []
    if request.args.get("q"):
        conds.append(f"검색어 '{request.args['q']}'")
    if request.args.get("type"):
        conds.append(f"유형 '{request.args['type']}'")
    if request.args.get("payment"):
        conds.append(f"결제유형 '{request.args['payment']}'")
    if request.args.get("outstanding") in ("1", "true"):
        conds.append("미수·미지급 남은 건만")
    label = {"all": "매출지출", "incomes": "매출", "expenses": "지출"}[kind]
    title = {"all": "매출/지출", "incomes": "매출", "expenses": "지출"}[kind]
    meta = {"title": f"웰카오디오 {title} 내역", "period": period, "conditions": ", ".join(conds),
            "exported_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "exported_by": user_label(current_user()),
            "instance": get_setting(db, "instance_id", "")}
    # 분류별 집계표: 기간이 2년을 넘으면 월 대신 연도별 열
    by_year = len(monthly) > 24
    unit = "연도별" if by_year else "월별"
    dims = []
    if inc_on:
        brand = f"COALESCE(NULLIF(manufacturer,''),{_UNSET})"
        note = f"단위: 원 · 실매출(매출액 − 미지급금) 기준 · {unit} · {period}"
        dims += [
            _dimension_spec(db, "incomes", inc_f, "브랜드별", "브랜드", brand, "amount - payout", note, by_year),
            _dimension_spec(db, "incomes", inc_f, "차종별", "브랜드 · 차종",
                            f"{brand} || ' · ' || COALESCE(NULLIF(car_model,''),{_UNSET})",
                            "amount - payout", note, by_year),
            _dimension_spec(db, "incomes", inc_f, "서비스구분별", "매출유형 · 매출구분(서비스 구분)",
                            f"COALESCE(NULLIF(income_type,''),{_UNSET}) || ' · ' || "
                            f"COALESCE(NULLIF(category,''),{_UNSET})", "amount - payout", note, by_year),
        ]
    if exp_on:
        dims.append(_dimension_spec(
            db, "expenses", exp_f, "지출유형별", "지출유형 · 거래품목",
            f"COALESCE(NULLIF(expense_type,''),{_UNSET}) || ' · ' || COALESCE(NULLIF(item,''),{_UNSET})",
            "amount", f"단위: 원 · 지출금액 · {unit} · {period}", by_year))
    order = " ORDER BY trx_date, id"
    incomes = db.execute(f"SELECT * FROM incomes{inc_f[0]}{order}", inc_f[1]) if inc_on else None
    expenses = db.execute(f"SELECT * FROM expenses{exp_f[0]}{order}", exp_f[1]) if exp_on else None
    data = exporter.build_workbook(meta, totals, monthly, incomes, expenses, dims)
    span = f"{d_from or '처음'}_{d_to or '현재'}" if (d_from or d_to) else "전체"
    return send_file(BytesIO(data), as_attachment=True, download_name=f"웰카오디오_{label}_{span}.xlsx",
                     mimetype=XLSX_MIME)


@app.route("/api/template.xlsx")
def template_xlsx():
    """엑셀 입력 양식: 매출입력·지출입력 시트(드롭다운은 지금 코드관리 목록)."""
    lists = {}
    for r in get_db().execute(
            "SELECT code_group, code_value FROM codes ORDER BY code_group, parent_value, sort_order, id"):
        values = lists.setdefault(r["code_group"], [])
        if r["code_value"] not in values:
            values.append(r["code_value"])
    lists["yn"] = ["Y", "N"]
    return send_file(BytesIO(exporter.build_template(lists)), as_attachment=True,
                     download_name="웰카오디오_입력양식.xlsx", mimetype=XLSX_MIME)


# ---------------------------------------------------------------- 백업·복원 (관리자)
def _backup_info():
    last = backup.last_backup(BACKUP_DIR, "auto")
    return {"dir": BACKUP_DIR, "interval_hours": BACKUP_INTERVAL_HOURS,
            "keep": backup.KEEP, "last_auto": last["created_at"] if last else "",
            "items": backup.list_backups(BACKUP_DIR)}


@app.route("/api/backups")
@role_required("admin")
def list_backups():
    return jsonify(_backup_info())


@app.route("/api/backups", methods=["POST"])
@role_required("admin")
def create_backup():
    try:
        item = backup.create_backup(DB_PATH, BACKUP_DIR, "manual")
    except (OSError, sqlite3.Error) as e:
        return jsonify({"error": f"백업에 실패했습니다: {e}"}), 500
    return jsonify(item), 201


@app.route("/api/backups/<name>/download")
@role_required("admin")
def download_backup(name):
    path = backup.backup_path(BACKUP_DIR, name)
    if not path:
        return jsonify({"error": "백업 파일이 없습니다."}), 404
    return send_file(path, as_attachment=True, download_name=name,
                     mimetype="application/vnd.sqlite3")


@app.route("/api/backups/<name>/restore", methods=["POST"])
@role_required("admin")
def restore_backup(name):
    path = backup.backup_path(BACKUP_DIR, name)
    if not path:
        return jsonify({"error": "백업 파일이 없습니다."}), 404
    try:
        backup.inspect_backup(path)
        safety = backup.create_backup(DB_PATH, BACKUP_DIR, "pre-restore", protect={name})
        counts = backup.restore_data(DB_PATH, path)
        db = get_db()
        _data_migrations(db)  # 옛 백업의 내역도 새 열(미지급금·엑셀 표시)로 옮긴다
        db.commit()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except (OSError, sqlite3.Error) as e:
        return jsonify({"error": f"복원에 실패했습니다: {e}"}), 500
    return jsonify({"ok": True, "restored": counts, "safety_backup": safety["name"]})


@app.route("/api/backups/upload", methods=["POST"])
@role_required("admin")
def upload_backup():
    f = request.files.get("file")
    if not f:
        return jsonify({"error": "백업 파일을 선택하세요."}), 400
    try:
        item = backup.store_upload(f.stream, BACKUP_DIR)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    return jsonify(item), 201


@app.route("/api/backups/<name>", methods=["DELETE"])
@role_required("admin")
def delete_backup(name):
    path = backup.backup_path(BACKUP_DIR, name)
    if not path:
        return jsonify({"error": "백업 파일이 없습니다."}), 404
    os.remove(path)
    return jsonify({"ok": True})


# ---------------------------------------------------------------- 엑셀 업로드 (자동 반영)
IMPORT_LIMIT = 50000
IMPORT_SAMPLE_LIMIT = 50
IMPORT_KEYS = {
    "incomes": ["trx_date", "income_type", "category", "client", "amount", "vat", "memo"],
    "expenses": ["trx_date", "expense_type", "item", "client", "amount", "memo"],
}
IMPORT_DEFAULTS = {
    "incomes": {"category": "", "manufacturer": "", "car_model": "", "product_model": "", "client": "",
                "currency": "KRW", "exchange_rate": 1, "quantity": 1, "unit_price": 0,
                "vat": 0, "account": "", "payment_type": "", "tax_invoice": "N", "memo": "",
                "receivable": 0, "payout": 0, "payout_due": 0},
    "expenses": {"item": "", "payment_type": "", "client": "", "currency": "KRW",
                 "exchange_rate": 1, "quantity": 1, "unit_price": 0, "memo": "", "payable": 0},
}


_PAYABLE_NOTE_RE = re.compile(r"\s*\[미지급금 [^\]]*\]$")


def _dedupe_key(row, key_fields):
    """같은 거래인지 판정하는 키. 금액은 화면과 같은 반올림으로, 적요는 예전 가져오기가 덧붙이던
    '[미지급금 …]' 표기를 빼고 비교해 이전 버전으로 가져온 내역과도 중복으로 잡히게 한다."""
    def part(f):
        v = row[f]
        if f in ("amount", "vat"):
            return round_half_up(v or 0)
        v = str(v or "")
        return _PAYABLE_NOTE_RE.sub("", v) if f == "memo" else v
    return tuple(part(f) for f in key_fields)


def _key_str(key):
    return "\x1f".join(str(p) for p in key)


# 엑셀 파서가 반올림하는 자릿수만큼은 같은 값으로 본다 (단가 소수 2자리, 환율 4자리)
_NUMERIC_TOLERANCE = {"unit_price": 0.006, "exchange_rate": 0.00006}


def _same_value(field, a, b):
    if field in INTEGER_FIELDS:
        return round_half_up(a or 0) == round_half_up(b or 0)
    if field in _NUMERIC_TOLERANCE:
        return abs(float(a or 0) - float(b or 0)) < _NUMERIC_TOLERANCE[field]
    if field in NUMERIC_FIELDS:
        a, b = float(a or 0), float(b or 0)
        return abs(a - b) <= 1e-6 * max(1.0, abs(a), abs(b))
    return str(a if a is not None else "").strip() == str(b if b is not None else "").strip()


def _sample(row, reason):
    return {"src": str(row.get("src") or "")[:80], "trx_date": str(row.get("trx_date") or "")[:10],
            "amount": row.get("amount") if isinstance(row.get("amount"), (int, float)) else 0,
            "client": str(row.get("client") or "")[:40], "reason": reason}


def _plan_import(db, table, rows, mode):
    """엑셀에서 읽은 행을 DB와 맞춰 볼 계획을 세운다(DB는 바꾸지 않는다).

    - 관리번호(id)가 있는 행(이 시스템에서 내보낸 파일): 그 내역과 비교해 달라진 항목만 고친다.
      파일을 내보낸 뒤 시스템에서 먼저 고친 내역은 덮어쓰지 않고 '충돌'로 건너뛴다.
    - 관리번호가 없는 행: 같은 거래(중복 판정 키)가 이미 있으면 건너뛰고, 없으면 새로 등록한다.
      같은 키가 DB에 n건 있으면 파일에서 n건까지 건너뛴다(멀티셋). 엑셀로 들어온 뒤 화면에서
      고친 내역은 처음 들어올 때의 키(import_key)로도 알아봐서 다시 들어오지 않게 한다.
    - mode='sync'(엑셀 장부와 맞추기): 파일 기간 안에서 예전에 엑셀로 들어온 내역 중 파일에 없는 것은 지운다.
      화면에서 직접 입력한 내역은 지우지 않는다.
    """
    fields, required = TABLE_SPEC[table]
    key_fields = IMPORT_KEYS[table]
    counts = dict.fromkeys(("added", "updated", "same", "conflict", "missing", "deleted", "invalid"), 0)
    samples = {k: [] for k in ("invalid", "updated", "conflict", "missing", "deleted")}
    plan = {"counts": counts, "samples": samples, "inserts": [], "updates": [], "deletes": [],
            "valid": [], "range": None}

    def note(kind, row, reason):
        if len(samples[kind]) < IMPORT_SAMPLE_LIMIT:
            samples[kind].append(_sample(row, reason))

    valid = []
    for r in rows:
        if not isinstance(r, dict):
            counts["invalid"] += 1
            continue
        data, err = _clean_entry(r, fields, required, table, clamp_balance=True)
        if not err and not data.get("amount"):
            err = "금액이 0입니다."
        if err:
            counts["invalid"] += 1
            note("invalid", r, err)
            continue
        full = dict(IMPORT_DEFAULTS[table])
        full.update(data)
        if table == "incomes" and "net_amount" not in data:
            full["net_amount"] = full["amount"] - full["vat"]
        ref = r.get("id")
        ref = ref if isinstance(ref, int) and not isinstance(ref, bool) and 0 < ref < 2 ** 63 else None
        absent = set(r.get("_absent") or []) if ref else set()
        valid.append({"data": full, "src": r.get("src"), "ref": ref,
                      "ref_time": str(r.get("ref_time") or "")[:19],
                      "present": [f for f in fields if f in data and f not in absent]})
    plan["valid"] = [v["data"] for v in valid]
    if not valid:
        return plan
    lo = min(v["data"]["trx_date"] for v in valid)
    hi = max(v["data"]["trx_date"] for v in valid)
    plan["range"] = [lo, hi]
    existing = {r["id"]: r for r in db.execute(
        f"SELECT * FROM {table} WHERE trx_date BETWEEN ? AND ?", (lo, hi))}
    want = sorted({v["ref"] for v in valid if v["ref"]} - existing.keys())
    for i in range(0, len(want), 500):
        chunk = want[i:i + 500]
        for r in db.execute(f"SELECT * FROM {table} WHERE id IN ({','.join('?' * len(chunk))})", chunk):
            existing[r["id"]] = r
    consumed = set()

    # 1) 관리번호가 있는 행: 그 내역과 비교
    for v in valid:
        if not v["ref"]:
            continue
        row = existing.get(v["ref"])
        shown = dict(v["data"], src=v["src"])
        if row is None:
            counts["missing"] += 1
            note("missing", shown, f"관리번호 {v['ref']} 내역이 시스템에 없습니다(삭제된 내역).")
            continue
        if row["id"] in consumed:
            counts["invalid"] += 1
            note("invalid", shown, f"관리번호 {v['ref']}이(가) 파일에 두 번 있습니다.")
            continue
        consumed.add(row["id"])
        merged = {f: row[f] for f in fields}
        merged.update({f: v["data"][f] for f in v["present"]})
        clean, err = _clean_entry(merged, fields, required, table)
        if err:
            counts["invalid"] += 1
            note("invalid", shown, err)
            continue
        changes = {f: clean[f] for f in fields if f in clean and not _same_value(f, clean[f], row[f])}
        if not changes:
            counts["same"] += 1
            continue
        last = max(row["created_at"] or "", row["updated_at"] or "")
        if v["ref_time"] and last > v["ref_time"]:
            counts["conflict"] += 1
            note("conflict", shown, f"관리번호 {v['ref']}: 파일을 받은 뒤 시스템에서 고친 내역이라 덮어쓰지 않았습니다.")
            continue
        plan["updates"].append((row["id"], changes))
        counts["updated"] += 1
        note("updated", shown, "바뀐 항목: " + ", ".join(FIELD_LABELS.get(f, f) for f in changes))

    # 2) 관리번호가 없는 행: 중복 판정 키로 맞춰 본다 (맞추기 모드는 엑셀 출처 내역부터 짝지음)
    index = {}
    ordered = sorted(existing.values(),
                     key=lambda r: (0 if mode == "sync" and r["source"] == "excel" else 1, r["id"]))
    for r in ordered:
        if r["id"] in consumed:
            continue
        for k in {_key_str(_dedupe_key(r, key_fields)), r["import_key"] or None} - {None}:
            index.setdefault(k, []).append(r["id"])
    for v in valid:
        if v["ref"]:
            continue
        k = _key_str(_dedupe_key(v["data"], key_fields))
        hit, cands = None, index.get(k)
        while cands:
            rid = cands.pop(0)
            if rid not in consumed:
                hit = rid
                break
        if hit:
            consumed.add(hit)
            counts["same"] += 1
        else:
            plan["inserts"].append(dict(v["data"], import_key=k))
            counts["added"] += 1

    # 3) 엑셀 장부와 맞추기: 파일 기간 안의 엑셀 출처 내역 중 파일에 없는 것
    if mode == "sync":
        for r in existing.values():
            if r["id"] not in consumed and r["source"] == "excel" and lo <= r["trx_date"] <= hi:
                plan["deletes"].append(r["id"])
                note("deleted", dict(r), "엑셀 파일에 없는 내역(예전에 엑셀로 올린 것)")
        counts["deleted"] = len(plan["deletes"])
    return plan


def _auto_add_codes(db, incomes, expenses, results):
    """가져온 데이터에 등장하는 신규 코드값을 코드관리에 자동 추가."""
    wanted = set()
    def text(r, f):
        return str(r.get(f) or "").strip()
    for r in incomes:
        it = text(r, "income_type")
        if it:
            wanted.add(("income_type", it, ""))
            if text(r, "category"):
                wanted.add(("income_category", text(r, "category"), it))
        if text(r, "manufacturer") and text(r, "car_model"):
            wanted.add(("car_model", text(r, "car_model"), text(r, "manufacturer")))
        for group, field in (("payment_type", "payment_type"), ("account", "account"),
                             ("manufacturer", "manufacturer"), ("client", "client"),
                             ("currency", "currency")):
            v = text(r, field)
            if v:
                wanted.add((group, v, ""))
    for r in expenses:
        et = text(r, "expense_type")
        if et:
            wanted.add(("expense_type", et, ""))
            if text(r, "item"):
                wanted.add(("expense_item", text(r, "item"), et))
        for group, field in (("payment_type", "payment_type"), ("client", "client"),
                             ("currency", "currency")):
            v = text(r, field)
            if v:
                wanted.add((group, v, ""))
    for group, value, parent in sorted(wanted):
        exists = db.execute(
            "SELECT 1 FROM codes WHERE code_group=? AND code_value=? AND parent_value=?",
            (group, value, parent)).fetchone()
        if exists:
            continue
        order = db.execute(
            "SELECT COALESCE(MAX(sort_order),-1)+1 FROM codes WHERE code_group=? AND parent_value=?",
            (group, parent)).fetchone()[0]
        db.execute("INSERT INTO codes(code_group, code_value, parent_value, sort_order) VALUES (?,?,?,?)",
                   (group, value, parent, order))
        results["codes_added"] += 1


@app.route("/api/import-json", methods=["POST"])
@role_required("staff")
def import_json():
    """엑셀에서 읽은 내역을 반영한다. 본문 {incomes, expenses, mode: append|sync, dry_run}

    dry_run이면 무엇이 바뀔지 건수만 돌려준다(화면의 미리보기). 실제로 바뀌는 내역이 있으면
    반영 직전 상태를 '가져오기 직전' 백업으로 남긴다. 맞추기(sync)는 삭제가 있어 관리자만 할 수 있다."""
    body = json_body()
    incomes = body.get("incomes") or []
    expenses = body.get("expenses") or []
    mode = body.get("mode") or "append"
    dry_run = bool(body.get("dry_run"))
    if mode not in ("append", "sync"):
        return jsonify({"error": "mode는 append 또는 sync여야 합니다."}), 400
    if mode == "sync" and current_user()["role"] != "admin":
        return jsonify({"error": "엑셀 장부와 맞추기는 관리자만 할 수 있습니다."}), 403
    if not isinstance(incomes, list) or not isinstance(expenses, list):
        return jsonify({"error": "incomes, expenses 배열이 필요합니다."}), 400
    if len(incomes) + len(expenses) > IMPORT_LIMIT:
        return jsonify({"error": f"한 번에 {IMPORT_LIMIT:,}건까지 올릴 수 있습니다."}), 400
    db = get_db()
    if not dry_run:
        db.execute("BEGIN IMMEDIATE")  # 계획을 세우는 동안 다른 저장이 끼어들어 중복이 생기지 않게
    try:
        plans = {"incomes": _plan_import(db, "incomes", incomes, mode),
                 "expenses": _plan_import(db, "expenses", expenses, mode)}
        result = {"mode": mode, "dry_run": dry_run, "backup": "", "codes_added": 0}
        for t, p in plans.items():
            result[t] = p["counts"]
        result["samples"] = {t: p["samples"] for t, p in plans.items()}
        result["range"] = {t: p["range"] for t, p in plans.items()}
        if dry_run:
            return jsonify(result)
        if any(p["inserts"] or p["updates"] or p["deletes"] for p in plans.values()):
            try:  # 바뀌는 내역이 있으면 반영 직전 상태를 백업 (다른 연결로 읽으므로 아직 쓰기 전 상태)
                if backup.has_data(DB_PATH):
                    result["backup"] = backup.create_backup(DB_PATH, BACKUP_DIR, "pre-import")["name"]
            except (OSError, sqlite3.Error) as e:
                return jsonify({"error": f"반영 직전 백업에 실패해 멈췄습니다: {e}"}), 500
        who = f"{user_label(current_user())} (엑셀)"
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for table, plan in plans.items():
            fields = TABLE_SPEC[table][0]
            if plan["inserts"]:
                cols = fields + ["created_by", "source", "import_key"]
                db.executemany(
                    f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
                    [[d[c] for c in fields] + [who, "excel", d["import_key"]] for d in plan["inserts"]])
            for rid, changes in plan["updates"]:
                sets = ", ".join(f"{k}=?" for k in changes)
                db.execute(f"UPDATE {table} SET {sets}, updated_by=?, updated_at=? WHERE id=?",
                           list(changes.values()) + [who, now, rid])
            for i in range(0, len(plan["deletes"]), 500):
                chunk = plan["deletes"][i:i + 500]
                db.execute(f"DELETE FROM {table} WHERE id IN ({','.join('?' * len(chunk))})", chunk)
        _auto_add_codes(db, plans["incomes"]["valid"], plans["expenses"]["valid"], result)
        db.commit()
        return jsonify(result)
    finally:
        if db.in_transaction:
            db.rollback()


@app.route("/api/meta")
def meta():
    db = get_db()
    years = set()
    for table in ("incomes", "expenses"):
        for r in db.execute(f"SELECT DISTINCT substr(trx_date,1,4) AS y FROM {table}"):
            years.add(r["y"])
    years.add(str(date.today().year))
    return jsonify({"years": sorted(years), "today": date.today().isoformat(),
                    "instance": get_setting(db, "instance_id", "")})


@app.route("/")
def index():
    return app.send_static_file("index.html")


init_db()
app.secret_key = _load_secret_key()


def _lan_ip():
    """같은 와이파이의 휴대폰에서 접속할 주소 안내용 (실제로 패킷을 보내지는 않음)."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
        finally:
            s.close()
    except OSError:
        return None


def main():
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"* 웰카오디오 매출/지출관리 시스템: http://localhost:{port}")
    ip = _lan_ip()
    if ip and host == "0.0.0.0":
        print(f"* 같은 네트워크의 다른 기기에서: http://{ip}:{port}")
    print(f"* 데이터: {DB_PATH}\n* 백업 폴더: {BACKUP_DIR}")
    try:
        from waitress import serve
    except ImportError:  # waitress가 없으면 Flask 개발 서버로 대신 실행
        app.run(host=host, port=port, debug=False)
    else:
        serve(app, host=host, port=port, threads=8)


if __name__ == "__main__":
    main()
