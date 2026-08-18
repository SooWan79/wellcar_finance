"""데모 데이터 생성 스크립트 (선택 실행).

실행하면 최근 1년치 매출/지출 샘플 데이터를 wellcar.db에 넣어
대시보드와 통계 화면을 바로 확인해 볼 수 있습니다.

    python seed_demo.py          # 데모 데이터 추가
    python seed_demo.py --clear  # 모든 매출/지출 내역 삭제
"""
import random
import sqlite3
import sys
from datetime import date, timedelta

from app import DB_PATH, init_db

SERVICES = ["카오디오수리", "데크수리", "내비게이션수리", "앰프수리", "메카니즘수리", "탈부착"]
PRODUCTS = ["카오디오", "앰프", "스피커", "내비게이션", "블랙박스"]
MAKERS = ["벤츠", "BMW", "아우디", "폭스바겐", "볼보", "토요타", "현대", "레인지로버", "N/A"]
CLIENTS = ["개인", "방문", "동서카오디오(대구)", "재즈카오디오(광주)", "현대카오디오(서울)",
           "수원테크(수원)", "닥터카오디오(수원)", "써브카오디오(안산)", "옥션", "G마켓"]
EXPENSE_ITEMS = [("제품원가", "제품매입"), ("제품원가", "서비스이용"), ("비용", "식대"),
                 ("비용", "차량유지비"), ("비용", "통신비"), ("비용", "수도광열비"),
                 ("비용", "임차료"), ("인건비", "급여"), ("제세공과금", "부가세"),
                 ("생활", "마트"), ("생활", "식당")]


def seed():
    init_db()
    db = sqlite3.connect(DB_PATH)
    rng = random.Random(42)
    today = date.today()
    start = today - timedelta(days=365)
    d = start
    n_inc = n_exp = 0
    while d <= today:
        if d.weekday() != 6 and rng.random() < 0.85:  # 일요일 대부분 휴무
            for _ in range(rng.randint(1, 4)):
                is_service = rng.random() < 0.7
                cat = rng.choice(SERVICES if is_service else PRODUCTS)
                amount = rng.randrange(5, 120) * 10000
                pay = rng.choices(["현금", "카드", "계좌입금"], weights=[3, 4, 3])[0]
                tax = "Y" if pay == "카드" or rng.random() < 0.3 else "N"
                vat = round(amount * 10 / 110) if (pay == "카드" or tax == "Y") else 0
                db.execute(
                    """INSERT INTO incomes(trx_date, income_type, category, manufacturer,
                       product_model, client, amount, vat, net_amount, account, payment_type,
                       tax_invoice, memo, quantity, unit_price)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)""",
                    (d.isoformat(), "서비스제공" if is_service else "상품판매", cat,
                     rng.choice(MAKERS), "", rng.choice(CLIENTS), amount, vat,
                     amount - vat, "국민(법인)", pay, tax, "데모 데이터", amount))
                n_inc += 1
            for _ in range(rng.randint(1, 3)):
                etype, item = rng.choice(EXPENSE_ITEMS)
                amount = rng.randrange(1, 40) * 10000
                if etype == "인건비":
                    amount = rng.randrange(150, 300) * 10000 if d.day == 25 else 0
                if amount == 0:
                    continue
                db.execute(
                    """INSERT INTO expenses(trx_date, expense_type, item, payment_type,
                       client, amount, memo, quantity, unit_price)
                       VALUES (?,?,?,?,?,?,?,1,?)""",
                    (d.isoformat(), etype, item, rng.choice(["현금", "카드", "계좌입금"]),
                     rng.choice(["해덕", "마트", "식당", "주유소", "기타"]), amount,
                     "데모 데이터", amount))
                n_exp += 1
        d += timedelta(days=1)
    db.commit()
    db.close()
    print(f"데모 데이터 생성 완료: 매출 {n_inc}건, 지출 {n_exp}건")


def clear():
    db = sqlite3.connect(DB_PATH)
    db.execute("DELETE FROM incomes")
    db.execute("DELETE FROM expenses")
    db.commit()
    db.close()
    print("모든 매출/지출 내역을 삭제했습니다.")


if __name__ == "__main__":
    if "--clear" in sys.argv:
        clear()
    else:
        seed()
