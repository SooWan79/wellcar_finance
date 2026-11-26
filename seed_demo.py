"""데모 데이터 생성 스크립트 (선택 실행).

실행하면 작년 1월 1일부터 오늘까지의 매출/지출 샘플과 올해 월별 목표를 wellcar.db에 넣어
대시보드·경영현황·추세·예측·매출 분석·지출 분석 화면을 바로 확인해 볼 수 있습니다.

    python seed_demo.py                     # 데모 데이터 추가
    python seed_demo.py --clear             # 모든 매출/지출 내역 삭제
    python seed_demo.py --dump [YYYY-MM-DD] # 만들 내역을 JSON으로 출력 (DB는 건드리지 않음, 시험용)

분석 화면에서 볼 만한 흐름을 일부러 심어 둡니다(실제 장사처럼 보이게 하는 가짜 자료입니다).
  · 수리 유형·상품마다 가격대가 다르고, 해마다 값이 조금씩 오르내립니다(앰프수리 ↑, 블랙박스 ↓ 등).
  · 브랜드별로 건수가 늘거나 줄어듭니다(현대 ↑, 볼보 ↑↑, 아우디 ↓). 레인지로버는 건수는 적고 금액이 큽니다.
  · 토요일이 바쁘고 화·수요일이 한가합니다. 일요일은 쉽니다. 겨울은 비수기, 12월·여름은 성수기입니다.
  · 거래처: 재즈카오디오(광주) ↑, 수원테크 ↓, 써브카오디오·오토사운드는 거래가 끊겼고 창원카오디오는 새로 생겼습니다.
  · 지출: 상품을 팔면 매입 원가가, 수리하면 부품비가 따라 붙습니다. 급여·임차료·공과금은 달마다, 부가세는 분기마다 나갑니다.

데모 아티팩트(demo/seed_data.js)도 같은 순서로 같은 난수를 써서 **똑같은 내역**을 만듭니다.
이 파일을 고치면 demo/seed_data.js도 같이 고치고 `node tests/seed_parity.js`로 대조하세요.
덧셈·곱셈·나눗셈과 내림만 써서 파이썬과 자바스크립트의 계산 결과가 한 자리도 다르지 않게 합니다(거듭제곱·반올림 함수는 쓰지 않음).
"""
import json
import math
import sqlite3
import sys
from datetime import date, timedelta

SERVICE_SHARE = 0.68  # 수리·서비스 건수 비중
# 수리 유형·상품: (이름, 건수 비중, 가격대 아래·위(만 원), 한 해 가격 변화율, 한 해 건수 변화 배수)
SERVICES = [
    ("카오디오수리", 22, 18, 42, 0.03, 1.00),
    ("앰프수리", 16, 25, 55, 0.10, 1.10),
    ("내비게이션수리", 16, 30, 65, 0.05, 1.60),
    ("데크수리", 14, 14, 32, 0.00, 0.55),
    ("메카니즘수리", 12, 12, 28, 0.02, 1.00),
    ("탈부착", 20, 7, 16, 0.05, 1.05),
]
PRODUCTS = [
    ("카오디오", 26, 35, 100, -0.02, 0.95),
    ("앰프", 18, 30, 80, 0.00, 1.00),
    ("스피커", 22, 15, 50, 0.03, 1.10),
    ("내비게이션", 14, 45, 120, -0.06, 0.80),
    ("블랙박스", 20, 18, 38, -0.08, 2.00),
]
# 브랜드: (이름, 건수 비중, 가격 배수, 한 해 건수 변화 배수)
MAKERS = [
    ("벤츠", 24, 1.15, 1.00), ("BMW", 20, 1.10, 1.05), ("아우디", 16, 1.05, 0.55), ("폭스바겐", 8, 0.90, 0.95),
    ("볼보", 3, 1.00, 2.40), ("토요타", 5, 0.85, 1.00), ("현대", 14, 0.70, 1.70), ("레인지로버", 4, 1.60, 1.00),
]
# 거래처: (이름, 수리 건 비중, 상품 건 비중, 한 해 건수 변화 배수, 며칠 전부터 끊김(0 = 계속), 며칠 전에 시작(0 = 처음부터), 종류)
CLIENTS = [
    ("개인", 28, 30, 1.00, 0, 0, "retail"), ("방문", 20, 25, 1.00, 0, 0, "retail"),
    ("옥션", 0, 12, 1.00, 0, 0, "online"), ("G마켓", 0, 12, 1.10, 0, 0, "online"),
    ("동서카오디오(대구)", 9, 2, 1.00, 0, 0, "dealer"), ("재즈카오디오(광주)", 8, 2, 1.80, 0, 0, "dealer"),
    ("현대카오디오(서울)", 8, 2, 1.00, 0, 0, "dealer"), ("수원테크(수원)", 9, 2, 0.50, 0, 0, "dealer"),
    ("닥터카오디오(수원)", 6, 1, 1.00, 0, 0, "dealer"), ("써브카오디오(안산)", 7, 1, 1.00, 130, 0, "dealer"),
    ("오토사운드(논산)", 5, 1, 1.00, 75, 0, "dealer"), ("창원카오디오(창원)", 7, 2, 1.00, 0, 200, "dealer"),
]
UNITS = ["CIC", "NBT", "COMAND", "MMI", "IMC", "Harman", "Burmester"]
VENDORS = ["해덕", "슈퍼그립", "미스터짱카"]
VENDOR_WEIGHTS = [5, 3, 2]
# 요일(월~토)별 손님 수 배수와 월별 계절 배수
WEEKDAY = [1.05, 0.75, 0.80, 1.00, 1.15, 1.45]
SEASON = [0.85, 0.80, 0.95, 1.00, 1.05, 1.00, 1.10, 1.05, 0.95, 1.00, 1.05, 1.15]
UTILITY = [28, 27, 20, 15, 14, 18, 30, 32, 20, 15, 19, 26]  # 달별 수도광열비(만 원)


def _imul(x, y):
    return (x * y) & 0xFFFFFFFF


class Mulberry32:
    """자바스크립트 데모와 같은 난수 생성기(32비트 정수 연산). 호출하면 0 이상 1 미만의 수를 돌려준다."""

    def __init__(self, seed):
        self.a = seed & 0xFFFFFFFF

    def __call__(self):
        self.a = (self.a + 0x6D2B79F5) & 0xFFFFFFFF
        a = self.a
        t = _imul(a ^ (a >> 15), 1 | a)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & 0xFFFFFFFF) ^ t
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296


def _round10k(v):
    """만 원 단위로 반올림 (0.5는 올림)"""
    return math.floor(v / 10000 + 0.5) * 10000


def generate(today_iso, car_models):
    """오늘 날짜와 브랜드별 차종 목록으로 데모 내역을 만든다. 반환: {incomes, expenses, targets}"""
    rng = Mulberry32(42)

    def randint(n):
        return math.floor(rng() * n)

    def pick(arr):
        return arr[randint(len(arr))]

    def wpick(arr, weights):
        total = 0.0
        for w in weights:
            total += w
        x = rng() * total
        for i in range(len(arr)):
            x -= weights[i]
            if x < 0:
                return arr[i]
        return arr[len(arr) - 1]

    today = date.fromisoformat(today_iso)
    start = date(today.year - 1, 1, 1)
    total_days = (today - start).days
    incomes, expenses = [], []

    def add_expense(day, etype, item, client, amount, pay, payable):
        expenses.append({
            "trx_date": day, "expense_type": etype, "item": item, "payment_type": pay, "client": client,
            "amount": amount, "memo": "데모 데이터", "quantity": 1, "unit_price": amount, "payable": payable,
        })

    for i in range(total_days + 1):
        d = start + timedelta(days=i)
        day = d.isoformat()
        off = total_days - i          # 오늘로부터 며칠 전
        years = i / 365               # 시작일로부터 지난 해 수
        wd = d.weekday()              # 0 = 월요일
        first_year = d.year == start.year
        if wd != 6:                   # 일요일은 쉰다
            lam = 2.0 * WEEKDAY[wd] * SEASON[d.month - 1] * (1 + 0.04 * years)
            n = math.floor(lam + rng() * 2 - 0.5)
            for _ in range(n if n > 0 else 0):
                is_service = rng() < SERVICE_SHARE
                kinds = SERVICES if is_service else PRODUCTS
                cat = wpick(kinds, [k[1] * (1 + (k[5] - 1) * years) for k in kinds])
                maker = wpick(MAKERS, [m[1] * (1 + (m[3] - 1) * years) for m in MAKERS])
                car = pick(car_models[maker[0]])
                cw = []
                for c in CLIENTS:
                    active = (c[4] == 0 or off >= c[4]) and (c[5] == 0 or off <= c[5])
                    cw.append((c[1] if is_service else c[2]) * (1 + (c[3] - 1) * years) if active else 0)
                client = wpick(CLIENTS, cw)
                u = rng()
                u = u * (0.55 + 0.45 * u)   # 싼 쪽이 더 많게
                amount = _round10k((cat[2] + (cat[3] - cat[2]) * u) * 10000 * maker[2] * (1 + cat[4] * years))
                if client[6] == "retail":
                    pay = wpick(["카드", "현금", "계좌입금"], [55, 25, 20])
                elif client[6] == "dealer":
                    pay = wpick(["계좌입금", "카드"], [85, 15])
                else:
                    pay = "계좌입금"
                tax = "Y" if pay == "카드" or rng() < 0.3 else "N"
                vat = math.floor(amount * 10 / 110 + 0.5) if (pay == "카드" or tax == "Y") else 0
                unit = pick(UNITS) if is_service and rng() < 0.4 else ""
                # 업체 거래 일부는 외상(미수금): 최근일수록 아직 못 받은 경우가 많게
                receivable = 0
                if pay == "계좌입금" and client[6] == "dealer" and rng() < (0.6 if off < 45 else 0.04):
                    receivable = amount if rng() < 0.7 else amount // 2
                # 업체 소개·협업 작업은 일부를 거래처에 지급(미지급금, 매출에서 차감)
                payout = payout_due = 0
                if client[6] == "dealer" and rng() < 0.25:
                    payout = math.floor(amount * pick([0.2, 0.3, 0.4]) / 10000) * 10000
                    payout_due = payout if off < 30 and rng() < 0.6 else 0
                incomes.append({
                    "trx_date": day, "income_type": "서비스제공" if is_service else "상품판매", "category": cat[0],
                    "manufacturer": maker[0], "car_model": car, "product_model": unit, "client": client[0],
                    "amount": amount, "vat": vat, "net_amount": amount - vat,
                    "account": "카드" if pay == "카드" else "국민(법인)", "payment_type": pay, "tax_invoice": tax,
                    "memo": "데모 데이터", "quantity": 1, "unit_price": amount, "currency": "KRW", "exchange_rate": 1,
                    "receivable": receivable, "payout": payout, "payout_due": payout_due,
                })
                # 원가: 상품은 매입가(해마다 조금씩 오름), 수리는 일부에 부품·외주비
                if not is_service:
                    if rng() < 0.9:
                        cost = _round10k(amount * (0.56 + 0.06 * years + 0.08 * rng()))
                        vendor = wpick(VENDORS, VENDOR_WEIGHTS)
                        cpay = wpick(["계좌입금", "카드"], [7, 3])
                        add_expense(day, "제품원가", "제품매입", vendor, cost, cpay, cost if off < 40 and rng() < 0.5 else 0)
                elif rng() < 0.35:
                    cost = _round10k(amount * (0.10 + 0.20 * rng()))
                    vendor = wpick(VENDORS, VENDOR_WEIGHTS)
                    if cost >= 10000:
                        add_expense(day, "제품원가", "서비스이용", vendor, cost, "카드", 0)
            # 그날그날 나가는 작은 지출
            if rng() < 0.7:
                add_expense(day, "비용", "식대", "식당", (1 + randint(3)) * 10000, pick(["카드", "현금"]), 0)
            if wd == 0:
                add_expense(day, "비용", "차량유지비", "주유소", (5 + randint(8)) * 10000, "카드", 0)
            if wd == 5:
                add_expense(day, "생활", "마트", "마트", (3 + randint(8)) * 10000, "카드", 0)
            if rng() < 0.06:
                add_expense(day, "비용", "업무경비", pick(["철물점", "택배", "문구점"]), (2 + randint(15)) * 10000, "카드", 0)
        # 달마다 정해진 날 나가는 지출 (쉬는 날이어도 나간다)
        if d.day == 10:
            add_expense(day, "비용", "통신비", "통신사", 110000, "카드", 0)
            add_expense(day, "비용", "보험료", "보험사", 180000, "계좌입금", 0)
        if d.day == 15:
            add_expense(day, "비용", "수도광열비", "전기·가스", _round10k(UTILITY[d.month - 1] * 10000 * (1 + 0.05 * years)), "계좌입금", 0)
        if d.day == 20:
            add_expense(day, "비용", "광고비", "온라인 광고", 300000 if first_year else 500000, "카드", 0)
        if d.day == 25:
            add_expense(day, "인건비", "급여", "직원", 3200000 if first_year else 3400000, "계좌입금", 0)
            add_expense(day, "비용", "임차료", "건물 임대인", 1500000 if first_year else 1600000, "계좌입금", 0)
            if d.month in (1, 4, 7, 10):  # 부가세: 앞 분기 실매출의 3%쯤
                qm = d.month - 3
                qy = d.year
                if qm < 1:
                    qm += 12
                    qy -= 1
                keys = ["%04d-%02d" % (qy, qm + k) for k in range(3)]
                base = 0
                for r in incomes:
                    if r["trx_date"][:7] in keys:
                        base += r["amount"] - r["payout"]
                tax_due = math.floor(base * 0.03 / 100000 + 0.5) * 100000
                if tax_due > 0:
                    add_expense(day, "제세공과금", "부가세", "세무서", tax_due, "계좌입금", 0)

    # 위안화(CNY) 거래 예시
    cny_day = (today - timedelta(days=3)).isoformat()
    incomes.append({
        "trx_date": cny_day, "income_type": "상품판매", "category": "앰프", "manufacturer": "N/A", "car_model": "",
        "product_model": "", "client": "해외 거래처", "amount": 457200, "vat": 0, "net_amount": 457200,
        "account": "기업(웰카오디오-개인)", "payment_type": "계좌입금", "tax_invoice": "N",
        "memo": "데모 데이터 · CNY 거래 예시", "quantity": 2, "unit_price": 1200, "currency": "CNY", "exchange_rate": 190.5,
        "receivable": 457200, "payout": 0, "payout_due": 0,
    })

    # 올해 월별 목표: 작년 같은 달 실적 기준 (매출·영업이익 +10%, 지출 예산 +5%, 10만원 단위)
    targets = {}
    for m in range(1, 13):
        month = "%04d-%02d" % (today.year - 1, m)
        sales = 0
        for r in incomes:
            if r["trx_date"][:7] == month:
                sales += r["amount"] - r["payout"]
        spent = 0
        for r in expenses:
            if r["trx_date"][:7] == month:
                spent += r["amount"]
        r100k = lambda v: math.floor(v / 100000 + 0.5) * 100000
        targets["%04d-%02d" % (today.year, m)] = {
            "sales": r100k(sales * 1.1), "profit": r100k((sales - spent) * 1.1), "expense": r100k(spent * 1.05)}
    return {"incomes": incomes, "expenses": expenses, "targets": targets}


INCOME_COLS = ("trx_date", "income_type", "category", "manufacturer", "car_model", "product_model", "client",
               "amount", "vat", "net_amount", "account", "payment_type", "tax_invoice", "memo", "quantity",
               "unit_price", "currency", "exchange_rate", "receivable", "payout", "payout_due")
EXPENSE_COLS = ("trx_date", "expense_type", "item", "payment_type", "client", "amount", "memo", "quantity",
                "unit_price", "payable")


def seed():
    from app import DB_PATH, SEED_CODES, init_db
    init_db()
    data = generate(date.today().isoformat(), SEED_CODES["car_model"])
    db = sqlite3.connect(DB_PATH)
    for table, cols, rows in (("incomes", INCOME_COLS, data["incomes"]), ("expenses", EXPENSE_COLS, data["expenses"])):
        db.executemany(
            f"INSERT INTO {table}({', '.join(cols)}, created_by) VALUES ({', '.join('?' * len(cols))}, '데모')",
            [tuple(r[c] for c in cols) for r in rows])
    for month, values in data["targets"].items():
        for metric, value in values.items():
            db.execute("INSERT OR REPLACE INTO targets(month, metric, value) VALUES (?,?,?)", (month, metric, value))
    db.commit()
    db.close()
    print(f"데모 데이터 생성 완료: 매출 {len(data['incomes'])}건, 지출 {len(data['expenses'])}건, {date.today().year}년 월별 목표")


def _seed_codes_from_source():
    """app.py를 불러오지 않고 SEED_CODES만 읽는다(app을 불러오면 DB 파일이 만들어지므로 --dump에서는 피한다)."""
    import ast
    import os
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "app.py")
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read())
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", "") == "SEED_CODES" for t in node.targets):
            return ast.literal_eval(node.value)
    raise RuntimeError("app.py에서 SEED_CODES를 찾지 못했습니다.")


def dump(today_iso):
    car_models = _seed_codes_from_source()["car_model"]
    data = generate(today_iso, car_models)
    data["car_models"] = car_models
    data["today"] = today_iso
    json.dump(data, sys.stdout, ensure_ascii=False)


def clear():
    from app import DB_PATH
    db = sqlite3.connect(DB_PATH)
    db.execute("DELETE FROM incomes")
    db.execute("DELETE FROM expenses")
    db.commit()
    db.close()
    print("모든 매출/지출 내역을 삭제했습니다.")


if __name__ == "__main__":
    if "--clear" in sys.argv:
        clear()
    elif "--dump" in sys.argv:
        i = sys.argv.index("--dump")
        dump(sys.argv[i + 1] if len(sys.argv) > i + 1 else date.today().isoformat())
    else:
        seed()
