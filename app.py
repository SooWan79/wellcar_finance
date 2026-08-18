"""웰카오디오 매출/지출관리 시스템 - Flask 백엔드"""
import os
import sqlite3
from datetime import date, datetime, timedelta

from flask import Flask, g, jsonify, request

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("WELLCAR_DB", os.path.join(BASE_DIR, "wellcar.db"))

app = Flask(__name__, static_folder="static", static_url_path="")


# ---------------------------------------------------------------- DB helpers
def get_db():
    db = getattr(g, "_db", None)
    if db is None:
        db = g._db = sqlite3.connect(DB_PATH)
        db.row_factory = sqlite3.Row
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
CREATE INDEX IF NOT EXISTS idx_incomes_date ON incomes(trx_date);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(trx_date);
"""

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
    "client": ["개인", "방문", "해덕", "동서카오디오(대구)", "재즈카오디오(광주)",
               "재즈카오디오(대구)", "현대카오디오(서울)", "수원테크(수원)",
               "닥터카오디오(수원)", "써브카오디오(안산)", "오토사운드(논산)",
               "주문진카오디오(주문진)", "창원카오디오(창원)", "슈퍼그립",
               "미스터짱카", "11번가", "옥션", "G마켓"],
}


def init_db():
    db = sqlite3.connect(DB_PATH)
    db.executescript(SCHEMA)
    cur = db.execute("SELECT COUNT(*) FROM codes")
    if cur.fetchone()[0] == 0:
        for group, values in SEED_CODES.items():
            if isinstance(values, dict):
                for parent, children in values.items():
                    for i, v in enumerate(children):
                        db.execute(
                            "INSERT OR IGNORE INTO codes(code_group, code_value, parent_value, sort_order)"
                            " VALUES (?,?,?,?)", (group, v, parent, i))
            else:
                for i, v in enumerate(values):
                    db.execute(
                        "INSERT OR IGNORE INTO codes(code_group, code_value, parent_value, sort_order)"
                        " VALUES (?,?,'',?)", (group, v, i))
        db.commit()
    db.close()


# ---------------------------------------------------------------- utilities
WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]

INCOME_FIELDS = ["trx_date", "income_type", "category", "manufacturer", "product_model",
                 "client", "currency", "exchange_rate", "quantity", "unit_price",
                 "amount", "vat", "net_amount", "account", "payment_type",
                 "tax_invoice", "memo"]
EXPENSE_FIELDS = ["trx_date", "expense_type", "item", "payment_type", "client",
                  "currency", "exchange_rate", "quantity", "unit_price", "amount", "memo"]


def row_to_dict(row):
    d = dict(row)
    try:
        wd = datetime.strptime(d["trx_date"], "%Y-%m-%d").weekday()
        d["weekday"] = WEEKDAYS[wd]
    except (KeyError, ValueError):
        d["weekday"] = ""
    return d


def parse_body(fields, required):
    body = request.get_json(silent=True) or {}
    data = {}
    for f in fields:
        if f in body:
            data[f] = body[f]
    for f in required:
        if not data.get(f):
            return None, f"'{f}' 값이 필요합니다."
    try:
        datetime.strptime(data["trx_date"], "%Y-%m-%d")
    except (KeyError, ValueError):
        return None, "영업일자는 YYYY-MM-DD 형식이어야 합니다."
    for f in ("exchange_rate", "quantity", "unit_price", "amount", "vat", "net_amount"):
        if f in data and data[f] not in (None, ""):
            try:
                data[f] = float(data[f])
            except (TypeError, ValueError):
                return None, f"'{f}' 값이 숫자가 아닙니다."
    return data, None


# ---------------------------------------------------------------- CRUD: 매출
@app.route("/api/incomes", methods=["GET"])
def list_incomes():
    return jsonify(_list_entries("incomes"))


@app.route("/api/expenses", methods=["GET"])
def list_expenses():
    return jsonify(_list_entries("expenses"))


def _list_entries(table):
    db = get_db()
    q = f"SELECT * FROM {table} WHERE 1=1"
    args = []
    if request.args.get("date"):
        q += " AND trx_date = ?"
        args.append(request.args["date"])
    if request.args.get("from"):
        q += " AND trx_date >= ?"
        args.append(request.args["from"])
    if request.args.get("to"):
        q += " AND trx_date <= ?"
        args.append(request.args["to"])
    if request.args.get("q"):
        kw = f"%{request.args['q']}%"
        q += " AND (client LIKE ? OR memo LIKE ?)"
        args += [kw, kw]
    q += " ORDER BY trx_date DESC, id DESC LIMIT 1000"
    rows = db.execute(q, args).fetchall()
    return [row_to_dict(r) for r in rows]


@app.route("/api/incomes", methods=["POST"])
def create_income():
    data, err = parse_body(INCOME_FIELDS, ["trx_date", "income_type", "amount"])
    if err:
        return jsonify({"error": err}), 400
    db = get_db()
    cols = ", ".join(data)
    marks = ", ".join("?" * len(data))
    cur = db.execute(f"INSERT INTO incomes ({cols}) VALUES ({marks})", list(data.values()))
    db.commit()
    row = db.execute("SELECT * FROM incomes WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route("/api/incomes/<int:rid>", methods=["PUT"])
def update_income(rid):
    data, err = parse_body(INCOME_FIELDS, ["trx_date", "income_type", "amount"])
    if err:
        return jsonify({"error": err}), 400
    db = get_db()
    sets = ", ".join(f"{k}=?" for k in data)
    cur = db.execute(f"UPDATE incomes SET {sets} WHERE id=?", list(data.values()) + [rid])
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "해당 내역이 없습니다."}), 404
    row = db.execute("SELECT * FROM incomes WHERE id=?", (rid,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route("/api/incomes/<int:rid>", methods=["DELETE"])
def delete_income(rid):
    db = get_db()
    cur = db.execute("DELETE FROM incomes WHERE id=?", (rid,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "해당 내역이 없습니다."}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------- CRUD: 지출
@app.route("/api/expenses", methods=["POST"])
def create_expense():
    data, err = parse_body(EXPENSE_FIELDS, ["trx_date", "expense_type", "amount"])
    if err:
        return jsonify({"error": err}), 400
    db = get_db()
    cols = ", ".join(data)
    marks = ", ".join("?" * len(data))
    cur = db.execute(f"INSERT INTO expenses ({cols}) VALUES ({marks})", list(data.values()))
    db.commit()
    row = db.execute("SELECT * FROM expenses WHERE id=?", (cur.lastrowid,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route("/api/expenses/<int:rid>", methods=["PUT"])
def update_expense(rid):
    data, err = parse_body(EXPENSE_FIELDS, ["trx_date", "expense_type", "amount"])
    if err:
        return jsonify({"error": err}), 400
    db = get_db()
    sets = ", ".join(f"{k}=?" for k in data)
    cur = db.execute(f"UPDATE expenses SET {sets} WHERE id=?", list(data.values()) + [rid])
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "해당 내역이 없습니다."}), 404
    row = db.execute("SELECT * FROM expenses WHERE id=?", (rid,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route("/api/expenses/<int:rid>", methods=["DELETE"])
def delete_expense(rid):
    db = get_db()
    cur = db.execute("DELETE FROM expenses WHERE id=?", (rid,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "해당 내역이 없습니다."}), 404
    return jsonify({"ok": True})


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
def create_code():
    body = request.get_json(silent=True) or {}
    group = (body.get("code_group") or "").strip()
    value = (body.get("code_value") or "").strip()
    parent = (body.get("parent_value") or "").strip()
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


@app.route("/api/codes/<int:rid>", methods=["DELETE"])
def delete_code(rid):
    db = get_db()
    cur = db.execute("DELETE FROM codes WHERE id=?", (rid,))
    db.commit()
    if cur.rowcount == 0:
        return jsonify({"error": "해당 코드가 없습니다."}), 404
    return jsonify({"ok": True})


# ---------------------------------------------------------------- 통계
def _range_stats(db, d_from, d_to, group_expr, group_label):
    """[d_from, d_to] 구간 합계·시리즈·분류별 집계."""
    inc = db.execute(
        """SELECT COALESCE(SUM(amount),0) AS amount, COALESCE(SUM(vat),0) AS vat,
                  COALESCE(SUM(net_amount),0) AS net,
                  COALESCE(SUM(CASE WHEN payment_type='현금' THEN amount ELSE 0 END),0) AS cash,
                  COALESCE(SUM(CASE WHEN payment_type='카드' THEN amount ELSE 0 END),0) AS card,
                  COUNT(*) AS cnt, COUNT(DISTINCT trx_date) AS days
           FROM incomes WHERE trx_date BETWEEN ? AND ?""", (d_from, d_to)).fetchone()
    exp = db.execute(
        """SELECT COALESCE(SUM(amount),0) AS amount, COUNT(*) AS cnt,
                  COALESCE(SUM(CASE WHEN expense_type='제품원가' THEN amount ELSE 0 END),0) AS cost
           FROM expenses WHERE trx_date BETWEEN ? AND ?""", (d_from, d_to)).fetchone()

    series = {}
    for r in db.execute(
            f"""SELECT {group_expr} AS k, SUM(amount) AS v FROM incomes
                WHERE trx_date BETWEEN ? AND ? GROUP BY k""", (d_from, d_to)):
        series.setdefault(r["k"], {"income": 0, "expense": 0})["income"] = r["v"]
    for r in db.execute(
            f"""SELECT {group_expr} AS k, SUM(amount) AS v FROM expenses
                WHERE trx_date BETWEEN ? AND ? GROUP BY k""", (d_from, d_to)):
        series.setdefault(r["k"], {"income": 0, "expense": 0})["expense"] = r["v"]
    series_list = [{"key": k, "income": v["income"], "expense": v["expense"],
                    "profit": v["income"] - v["expense"]}
                   for k, v in sorted(series.items())]

    inc_by_cat = [dict(r) for r in db.execute(
        """SELECT COALESCE(NULLIF(category,''),'(미분류)') AS name, SUM(amount) AS value, COUNT(*) AS cnt
           FROM incomes WHERE trx_date BETWEEN ? AND ?
           GROUP BY name ORDER BY value DESC""", (d_from, d_to))]
    exp_by_type = [dict(r) for r in db.execute(
        """SELECT COALESCE(NULLIF(expense_type,''),'(미분류)') AS name, SUM(amount) AS value, COUNT(*) AS cnt
           FROM expenses WHERE trx_date BETWEEN ? AND ?
           GROUP BY name ORDER BY value DESC""", (d_from, d_to))]
    top_clients = [dict(r) for r in db.execute(
        """SELECT COALESCE(NULLIF(client,''),'(미지정)') AS name, SUM(amount) AS value, COUNT(*) AS cnt
           FROM incomes WHERE trx_date BETWEEN ? AND ?
           GROUP BY name ORDER BY value DESC LIMIT 10""", (d_from, d_to))]

    income_amt, expense_amt = inc["amount"], exp["amount"]
    return {
        "from": d_from, "to": d_to, "group": group_label,
        "totals": {
            "income": income_amt,
            "expense": expense_amt,
            "profit": income_amt - expense_amt,
            "vat": inc["vat"],
            "net_income": inc["net"],
            "cash_income": inc["cash"],
            "card_income": inc["card"],
            "cost_expense": exp["cost"],
            "income_count": inc["cnt"],
            "expense_count": exp["cnt"],
            "business_days": inc["days"],
            "avg_daily_income": round(income_amt / inc["days"]) if inc["days"] else 0,
            "expense_ratio": round(expense_amt / income_amt * 100, 1) if income_amt else 0,
            "cost_ratio": round(exp["cost"] / income_amt * 100, 1) if income_amt else 0,
        },
        "series": series_list,
        "income_by_category": inc_by_cat,
        "expense_by_type": exp_by_type,
        "top_clients": top_clients,
    }


def month_range(year, month):
    first = date(year, month, 1)
    last = (date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)) - timedelta(days=1)
    return first.isoformat(), last.isoformat()


@app.route("/api/stats/daily")
def stats_daily():
    try:
        d = datetime.strptime(request.args.get("date", ""), "%Y-%m-%d").date()
    except ValueError:
        return jsonify({"error": "date=YYYY-MM-DD 형식으로 요청하세요."}), 400
    db = get_db()
    day = _range_stats(db, d.isoformat(), d.isoformat(), "trx_date", "day")
    prev = d - timedelta(days=1)
    prev_stats = _range_stats(db, prev.isoformat(), prev.isoformat(), "trx_date", "day")
    m_from, m_to = month_range(d.year, d.month)
    month = _range_stats(db, m_from, m_to, "trx_date", "day")
    recent_from = (d - timedelta(days=13)).isoformat()
    recent = _range_stats(db, recent_from, d.isoformat(), "trx_date", "day")
    return jsonify({
        "date": d.isoformat(),
        "weekday": WEEKDAYS[d.weekday()],
        "day": day, "prev_day": prev_stats, "month": month,
        "recent_series": recent["series"],
        "recent_from": recent_from,
    })


@app.route("/api/stats/monthly")
def stats_monthly():
    try:
        year = int(request.args.get("year", ""))
        month = int(request.args.get("month", ""))
        assert 1 <= month <= 12
    except (ValueError, AssertionError):
        return jsonify({"error": "year, month 파라미터가 필요합니다."}), 400
    db = get_db()
    m_from, m_to = month_range(year, month)
    stats = _range_stats(db, m_from, m_to, "trx_date", "day")
    pm_year, pm_month = (year - 1, 12) if month == 1 else (year, month - 1)
    p_from, p_to = month_range(pm_year, pm_month)
    prev = _range_stats(db, p_from, p_to, "trx_date", "day")
    stats["prev_totals"] = prev["totals"]
    return jsonify(stats)


@app.route("/api/stats/quarterly")
def stats_quarterly():
    try:
        year = int(request.args.get("year", ""))
        quarter = int(request.args.get("quarter", ""))
        assert 1 <= quarter <= 4
    except (ValueError, AssertionError):
        return jsonify({"error": "year, quarter 파라미터가 필요합니다."}), 400
    db = get_db()
    m1 = (quarter - 1) * 3 + 1
    q_from, _ = month_range(year, m1)
    _, q_to = month_range(year, m1 + 2)
    stats = _range_stats(db, q_from, q_to, "substr(trx_date,1,7)", "month")
    if quarter == 1:
        p_from, _ = month_range(year - 1, 10)
        _, p_to = month_range(year - 1, 12)
    else:
        pm1 = (quarter - 2) * 3 + 1
        p_from, _ = month_range(year, pm1)
        _, p_to = month_range(year, pm1 + 2)
    prev = _range_stats(db, p_from, p_to, "substr(trx_date,1,7)", "month")
    stats["prev_totals"] = prev["totals"]
    return jsonify(stats)


@app.route("/api/stats/yearly")
def stats_yearly():
    try:
        year = int(request.args.get("year", ""))
    except ValueError:
        return jsonify({"error": "year 파라미터가 필요합니다."}), 400
    db = get_db()
    stats = _range_stats(db, f"{year}-01-01", f"{year}-12-31", "substr(trx_date,1,7)", "month")
    prev = _range_stats(db, f"{year-1}-01-01", f"{year-1}-12-31", "substr(trx_date,1,7)", "month")
    stats["prev_totals"] = prev["totals"]
    return jsonify(stats)


# ---------------------------------------------------------------- 엑셀 마이그레이션
IMPORT_LIMIT = 50000

def _import_rows(db, table, rows, fields, required, key_fields, result_prefix, results):
    """멀티셋 방식 중복 제거 후 일괄 등록: 동일 키 행이 DB에 이미 n건 있으면 n건까지는 건너뛴다."""
    def row_key(r):
        return tuple(int(float(r.get(f) or 0)) if f in ("amount", "vat") else str(r.get(f) or "")
                     for f in key_fields)

    valid = []
    for r in rows:
        if not isinstance(r, dict):
            results[f"{result_prefix}_invalid"] += 1
            continue
        data = {}
        for f in fields:
            if f in r:
                data[f] = r[f]
        try:
            datetime.strptime(str(data.get("trx_date", "")), "%Y-%m-%d")
            for f in ("exchange_rate", "quantity", "unit_price", "amount", "vat", "net_amount"):
                if f in data and data[f] not in (None, ""):
                    data[f] = float(data[f])
            ok = all(data.get(f) for f in required) and float(data.get("amount") or 0) != 0
        except (ValueError, TypeError):
            ok = False
        if not ok:
            results[f"{result_prefix}_invalid"] += 1
            continue
        valid.append(data)

    # 키별 기존 DB 건수만큼 스킵 (재업로드 시 중복 방지, 파일 내 정당한 중복은 유지)
    skip_budget = {}
    for data in valid:
        k = row_key(data)
        if k not in skip_budget:
            cond = " AND ".join(
                (f"CAST(COALESCE({f},0) AS INTEGER)=?" if f in ("amount", "vat") else f"COALESCE({f},'')=?")
                for f in key_fields)
            args = [int(float(data.get(f) or 0)) if f in ("amount", "vat") else str(data.get(f) or "")
                    for f in key_fields]
            cur = db.execute(f"SELECT COUNT(*) FROM {table} WHERE {cond}", args)
            skip_budget[k] = cur.fetchone()[0]
        if skip_budget[k] > 0:
            skip_budget[k] -= 1
            results[f"{result_prefix}_skipped"] += 1
            continue
        cols = ", ".join(data)
        marks = ", ".join("?" * len(data))
        db.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", list(data.values()))
        results[f"{result_prefix}_added"] += 1


def _auto_add_codes(db, incomes, expenses, results):
    """가져온 데이터에 등장하는 신규 코드값을 코드관리에 자동 추가."""
    wanted = set()
    for r in incomes:
        if not isinstance(r, dict):
            continue
        it = (r.get("income_type") or "").strip()
        if it:
            wanted.add(("income_type", it, ""))
            if (r.get("category") or "").strip():
                wanted.add(("income_category", r["category"].strip(), it))
        for group, field in (("payment_type", "payment_type"), ("account", "account"),
                             ("manufacturer", "manufacturer"), ("client", "client")):
            v = (r.get(field) or "").strip()
            if v:
                wanted.add((group, v, ""))
    for r in expenses:
        if not isinstance(r, dict):
            continue
        et = (r.get("expense_type") or "").strip()
        if et:
            wanted.add(("expense_type", et, ""))
            if (r.get("item") or "").strip():
                wanted.add(("expense_item", r["item"].strip(), et))
        for group, field in (("payment_type", "payment_type"), ("client", "client")):
            v = (r.get(field) or "").strip()
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
def import_json():
    body = request.get_json(silent=True) or {}
    incomes = body.get("incomes") or []
    expenses = body.get("expenses") or []
    if not isinstance(incomes, list) or not isinstance(expenses, list):
        return jsonify({"error": "incomes, expenses 배열이 필요합니다."}), 400
    if len(incomes) + len(expenses) > IMPORT_LIMIT:
        return jsonify({"error": f"한 번에 {IMPORT_LIMIT:,}건까지 가져올 수 있습니다."}), 400
    db = get_db()
    results = {"incomes_added": 0, "incomes_skipped": 0, "incomes_invalid": 0,
               "expenses_added": 0, "expenses_skipped": 0, "expenses_invalid": 0,
               "codes_added": 0}
    _import_rows(db, "incomes", incomes, INCOME_FIELDS,
                 ["trx_date", "income_type", "amount"],
                 ["trx_date", "income_type", "category", "client", "amount", "vat", "memo"],
                 "incomes", results)
    _import_rows(db, "expenses", expenses, EXPENSE_FIELDS,
                 ["trx_date", "expense_type", "amount"],
                 ["trx_date", "expense_type", "item", "client", "amount", "memo"],
                 "expenses", results)
    _auto_add_codes(db, incomes, expenses, results)
    db.commit()
    return jsonify(results)


@app.route("/api/meta")
def meta():
    db = get_db()
    years = set()
    for table in ("incomes", "expenses"):
        for r in db.execute(f"SELECT DISTINCT substr(trx_date,1,4) AS y FROM {table}"):
            years.add(r["y"])
    years.add(str(date.today().year))
    return jsonify({"years": sorted(years), "today": date.today().isoformat()})


@app.route("/")
def index():
    return app.send_static_file("index.html")


init_db()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print(f"* 웰카오디오 매출/지출관리 시스템: http://localhost:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
