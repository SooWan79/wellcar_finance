"""데모 데이터 생성 스크립트 (선택 실행).

실행하면 작년 1월 1일부터 오늘까지의 매출/지출 샘플과 올해 월별 목표를 wellcar.db에 넣어
대시보드·경영현황(전년 동기·목표 대비)·분석 화면을 바로 확인해 볼 수 있습니다.

    python seed_demo.py          # 데모 데이터 추가
    python seed_demo.py --clear  # 모든 매출/지출 내역 삭제
"""
import random
import sqlite3
import sys
from datetime import date, timedelta

from app import DB_PATH, SEED_CODES, init_db

SERVICES = ["카오디오수리", "데크수리", "내비게이션수리", "앰프수리", "메카니즘수리", "탈부착"]
PRODUCTS = ["카오디오", "앰프", "스피커", "내비게이션", "블랙박스"]
MAKERS = ["벤츠", "BMW", "아우디", "폭스바겐", "볼보", "토요타", "현대", "레인지로버"]
MAKER_WEIGHTS = [26, 22, 12, 8, 6, 5, 14, 7]
UNITS = ["CIC", "NBT", "COMAND", "MMI", "IMC", "Harman", "Burmester"]
DEALERS = ["동서카오디오(대구)", "재즈카오디오(광주)", "현대카오디오(서울)", "수원테크(수원)",
           "닥터카오디오(수원)", "써브카오디오(안산)"]
CLIENTS = ["개인", "방문"] * 3 + DEALERS + ["옥션", "G마켓"]
EXPENSE_ITEMS = [("제품원가", "제품매입"), ("제품원가", "서비스이용"), ("비용", "식대"),
                 ("비용", "차량유지비"), ("비용", "통신비"), ("비용", "수도광열비"),
                 ("비용", "광고비"), ("생활", "마트"), ("생활", "식당")]
SEASON = {1: .85, 2: .8, 3: .95, 4: 1.0, 5: 1.05, 6: 1.0, 7: 1.1, 8: 1.05, 9: .95, 10: 1.0, 11: 1.05, 12: 1.15}


def seed():
    init_db()
    db = sqlite3.connect(DB_PATH)
    rng = random.Random(42)
    today = date.today()
    start = date(today.year - 1, 1, 1)
    d = start
    n_inc = n_exp = 0
    while d <= today:
        growth = 1.0 + 0.08 * (d.year - start.year)  # 올해가 작년보다 조금 큼
        if d.weekday() != 6 and rng.random() < 0.88:  # 일요일 휴무
            for _ in range(rng.randint(1, 3)):
                is_service = rng.random() < 0.7
                cat = rng.choice(SERVICES if is_service else PRODUCTS)
                amount = int(rng.randrange(5, 110) * 10000 * SEASON[d.month] * growth) // 10000 * 10000
                pay = rng.choices(["현금", "카드", "계좌입금"], weights=[3, 4, 3])[0]
                tax = "Y" if pay == "카드" or rng.random() < 0.3 else "N"
                vat = round(amount * 10 / 110) if (pay == "카드" or tax == "Y") else 0
                client = rng.choice(CLIENTS)
                maker = rng.choices(MAKERS, weights=MAKER_WEIGHTS)[0]
                car = rng.choice(SEED_CODES["car_model"][maker])
                unit = rng.choice(UNITS) if is_service and rng.random() < 0.4 else ""
                # 업체 거래 일부는 외상(미수금): 최근일수록 아직 못 받은 경우가 많게
                receivable = 0
                if pay == "계좌입금" and client in DEALERS and rng.random() < (
                        0.6 if (today - d).days < 45 else 0.04):
                    receivable = amount if rng.random() < 0.7 else amount // 2
                # 업체 소개·협업 작업은 일부를 거래처에 지급(미지급금, 매출에서 차감)
                payout = payout_due = 0
                if client in DEALERS and rng.random() < 0.25:
                    payout = int(amount * rng.choice([0.2, 0.3, 0.4])) // 10000 * 10000
                    payout_due = payout if (today - d).days < 30 and rng.random() < 0.6 else 0
                db.execute(
                    """INSERT INTO incomes(trx_date, income_type, category, manufacturer, car_model,
                       product_model, client, amount, vat, net_amount, account, payment_type,
                       tax_invoice, memo, quantity, unit_price, receivable, payout, payout_due, created_by)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,'데모')""",
                    (d.isoformat(), "서비스제공" if is_service else "상품판매", cat, maker, car, unit,
                     client, amount, vat, amount - vat, "국민(법인)", pay, tax, "데모 데이터", amount,
                     receivable, payout, payout_due))
                n_inc += 1
            for _ in range(rng.randint(1, 2)):
                etype, item = rng.choice(EXPENSE_ITEMS)
                amount = rng.randrange(1, 30) * 10000
                # 제품 매입 일부는 외상(미지급금)
                payable = amount if (etype == "제품원가" and (today - d).days < 40
                                     and rng.random() < 0.5) else 0
                db.execute(
                    """INSERT INTO expenses(trx_date, expense_type, item, payment_type,
                       client, amount, memo, quantity, unit_price, payable, created_by)
                       VALUES (?,?,?,?,?,?,?,1,?,?,'데모')""",
                    (d.isoformat(), etype, item, rng.choice(["현금", "카드", "계좌입금"]),
                     rng.choice(["해덕", "마트", "식당", "주유소", "기타"]), amount,
                     "데모 데이터", amount, payable))
                n_exp += 1
        if d.day == 25:  # 급여·임차료는 매달 한 번
            for etype, item, amount in (("인건비", "급여", 3_200_000), ("비용", "임차료", 1_500_000)):
                db.execute(
                    """INSERT INTO expenses(trx_date, expense_type, item, payment_type, client, amount,
                       memo, quantity, unit_price, created_by) VALUES (?,?,?,'계좌입금','',?,?,1,?,'데모')""",
                    (d.isoformat(), etype, item, amount, "데모 데이터", amount))
                n_exp += 1
        d += timedelta(days=1)
    # 올해 월별 목표: 작년 같은 달 실적 기준 (매출·영업이익 +10%, 지출 예산 +5%, 10만원 단위)
    for m in range(1, 13):
        month = f"{today.year - 1}-{m:02d}"
        sales = db.execute("SELECT COALESCE(SUM(amount - payout),0) FROM incomes WHERE substr(trx_date,1,7)=?",
                           (month,)).fetchone()[0]
        spent = db.execute("SELECT COALESCE(SUM(amount),0) FROM expenses WHERE substr(trx_date,1,7)=?",
                           (month,)).fetchone()[0]
        for metric, value in (("sales", sales * 1.1), ("profit", (sales - spent) * 1.1), ("expense", spent * 1.05)):
            db.execute("INSERT OR REPLACE INTO targets(month, metric, value) VALUES (?,?,?)",
                       (f"{today.year}-{m:02d}", metric, round(value / 100000) * 100000))
    db.commit()
    db.close()
    print(f"데모 데이터 생성 완료: 매출 {n_inc}건, 지출 {n_exp}건, {today.year}년 월별 목표")


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
