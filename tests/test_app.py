"""백엔드 자동 테스트 (표준 라이브러리 unittest).

    .venv/bin/python -m unittest discover -s tests -v

임시 폴더의 DB를 쓰므로 실데이터(wellcar.db)를 건드리지 않습니다.
"""
import io
import os
import sqlite3
import sys
import tempfile
import unittest

TMP = tempfile.mkdtemp(prefix="wellcar-test-")
os.environ["WELLCAR_DB"] = os.path.join(TMP, "test.db")
os.environ.pop("WELLCAR_ADMIN_PASSWORD", None)
os.environ.pop("WELLCAR_SECRET_KEY", None)
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import app as wellcar  # noqa: E402  (환경변수를 먼저 정해야 함)
import backup  # noqa: E402

from openpyxl import load_workbook  # noqa: E402

HDR = {"X-Requested-With": "XMLHttpRequest"}
ADMIN_PW = "admin-pass-1234"


def setup_code():
    db = sqlite3.connect(wellcar.DB_PATH)
    try:
        row = db.execute("SELECT value FROM settings WHERE key='setup_code'").fetchone()
        return row[0] if row else None
    finally:
        db.close()


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        wellcar.app.config["TESTING"] = True
        db = sqlite3.connect(wellcar.DB_PATH)
        if not db.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
            db.close()
            c = wellcar.app.test_client()
            r = c.post("/api/auth/setup", headers=HDR, json={
                "setup_code": setup_code(), "username": "admin", "password": ADMIN_PW,
                "display_name": "사장"})
            assert r.status_code == 201, r.get_json()
        else:
            db.close()

    def setUp(self):
        db = sqlite3.connect(wellcar.DB_PATH)
        db.execute("DELETE FROM incomes")
        db.execute("DELETE FROM expenses")
        db.commit()
        db.close()
        wellcar._failures.clear()
        self.c = self.client("admin", ADMIN_PW)

    def client(self, username, password):
        c = wellcar.app.test_client()
        r = c.post("/api/auth/login", headers=HDR, json={"username": username, "password": password})
        self.assertEqual(r.status_code, 200, r.get_json())
        return c

    def post(self, c, path, data=None, **kw):
        return c.post(path, headers=HDR, json=data, **kw)

    def put(self, c, path, data):
        return c.put(path, headers=HDR, json=data)

    def delete(self, c, path):
        return c.delete(path, headers=HDR)

    def make_user(self, username, role):
        r = self.post(self.c, "/api/users", {"username": username, "password": "pass-word-99",
                                             "role": role, "display_name": username})
        if r.status_code == 409:
            return self.client(username, "pass-word-99")
        self.assertEqual(r.status_code, 201, r.get_json())
        return self.client(username, "pass-word-99")

    def income(self, c=None, **kw):
        data = {"trx_date": "2026-03-02", "income_type": "서비스제공", "category": "데크수리",
                "client": "개인", "amount": 110000, "vat": 10000, "net_amount": 100000,
                "payment_type": "카드", "memo": "테스트"}
        data.update(kw)
        r = self.post(c or self.c, "/api/incomes", data)
        self.assertEqual(r.status_code, 201, r.get_json())
        return r.get_json()


class AuthTest(Base):
    def test_requires_login(self):
        anon = wellcar.app.test_client()
        self.assertEqual(anon.get("/api/meta").status_code, 401)
        self.assertEqual(anon.get("/api/incomes").status_code, 401)
        st = anon.get("/api/auth/state").get_json()
        self.assertFalse(st["setup_required"])
        self.assertIsNone(st["user"])

    def test_setup_only_once(self):
        anon = wellcar.app.test_client()
        r = self.post(anon, "/api/auth/setup", {"setup_code": "XXXX-XXXX", "username": "evil",
                                                "password": "evil-pass-1"})
        self.assertEqual(r.status_code, 409)

    def test_csrf_header_required(self):
        r = self.c.post("/api/incomes", json={"trx_date": "2026-03-02", "income_type": "기타",
                                              "amount": 1000})
        self.assertEqual(r.status_code, 400)

    def test_wrong_password_and_throttle(self):
        anon = wellcar.app.test_client()
        for _ in range(5):
            r = self.post(anon, "/api/auth/login", {"username": "admin", "password": "nope-nope"})
            self.assertEqual(r.status_code, 401)
        r = self.post(anon, "/api/auth/login", {"username": "admin", "password": ADMIN_PW})
        self.assertEqual(r.status_code, 429)

    def test_logout(self):
        self.assertEqual(self.post(self.c, "/api/auth/logout").status_code, 200)
        self.assertEqual(self.c.get("/api/meta").status_code, 401)

    def test_roles(self):
        viewer = self.make_user("viewer1", "viewer")
        staff = self.make_user("staff1", "staff")
        # 조회 전용: 읽기만
        self.assertEqual(viewer.get("/api/incomes").status_code, 200)
        r = self.post(viewer, "/api/incomes", {"trx_date": "2026-03-02", "income_type": "기타",
                                               "amount": 1000})
        self.assertEqual(r.status_code, 403)
        self.assertEqual(viewer.get("/api/export.xlsx").status_code, 200)
        # 직원: 내역 등록 가능, 관리자 기능 불가
        row = self.income(staff)
        self.assertEqual(row["created_by"], "staff1")
        self.assertEqual(staff.get("/api/users").status_code, 403)
        self.assertEqual(staff.get("/api/backups").status_code, 403)
        self.assertEqual(self.post(staff, "/api/codes", {"code_group": "client",
                                                         "code_value": "x"}).status_code, 403)
        self.assertEqual(self.post(staff, "/api/import-json", {"incomes": []}).status_code, 403)

    def test_password_change_invalidates_other_sessions(self):
        self.make_user("pwuser", "staff")
        a = self.client("pwuser", "pass-word-99")
        b = self.client("pwuser", "pass-word-99")
        r = self.post(a, "/api/auth/password", {"current_password": "pass-word-99",
                                                "new_password": "new-pass-word-1"})
        self.assertEqual(r.status_code, 200, r.get_json())
        self.assertEqual(a.get("/api/meta").status_code, 200)   # 바꾼 기기는 유지
        self.assertEqual(b.get("/api/meta").status_code, 401)   # 다른 기기는 로그아웃
        r = self.post(a, "/api/auth/password", {"current_password": "new-pass-word-1",
                                                "new_password": "pass-word-99"})
        self.assertEqual(r.status_code, 200)

    def test_last_admin_protected(self):
        users = self.c.get("/api/users").get_json()
        me = next(u for u in users if u["username"] == "admin")
        r = self.put(self.c, f"/api/users/{me['id']}", {"role": "staff"})
        self.assertEqual(r.status_code, 400)
        self.assertEqual(self.delete(self.c, f"/api/users/{me['id']}").status_code, 400)

    def test_deactivated_user_logged_out(self):
        s = self.make_user("temp1", "staff")
        uid = next(u["id"] for u in self.c.get("/api/users").get_json() if u["username"] == "temp1")
        self.assertEqual(self.put(self.c, f"/api/users/{uid}", {"active": False}).status_code, 200)
        self.assertEqual(s.get("/api/meta").status_code, 401)
        anon = wellcar.app.test_client()
        r = self.post(anon, "/api/auth/login", {"username": "temp1", "password": "pass-word-99"})
        self.assertEqual(r.status_code, 403)
        self.put(self.c, f"/api/users/{uid}", {"active": True})


class EntryTest(Base):
    def test_crud_and_get(self):
        row = self.income()
        r = self.c.get(f"/api/incomes/{row['id']}")
        self.assertEqual(r.get_json()["amount"], 110000)
        upd = dict(row, amount=220000, vat=20000, net_amount=200000)
        r = self.put(self.c, f"/api/incomes/{row['id']}", upd)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["updated_by"], "사장")
        self.assertEqual(self.delete(self.c, f"/api/incomes/{row['id']}").status_code, 200)
        self.assertEqual(self.c.get(f"/api/incomes/{row['id']}").status_code, 404)

    def test_pagination_and_filters(self):
        db = sqlite3.connect(wellcar.DB_PATH)
        db.executemany(
            "INSERT INTO incomes(trx_date, income_type, client, amount, vat, net_amount, memo) "
            "VALUES (?,?,?,?,0,?,?)",
            [(f"2025-{m:02d}-{d:02d}", "상품판매", f"거래처{i % 7}", 1000 + i, 1000 + i, f"메모{i}")
             for i, (m, d) in enumerate((m, d) for m in range(1, 13) for d in range(1, 29))])
        db.commit()
        db.close()
        total = 12 * 28
        r = self.c.get("/api/incomes?page=1&size=50").get_json()
        self.assertEqual(r["total"], total)
        self.assertEqual(r["pages"], 7)
        self.assertEqual(len(r["items"]), 50)
        self.assertEqual(r["items"][0]["trx_date"], "2025-12-28")
        self.assertEqual(r["sum"]["amount"], sum(1000 + i for i in range(total)))
        last = self.c.get("/api/incomes?page=7&size=50").get_json()
        self.assertEqual(len(last["items"]), total - 300)
        r = self.c.get("/api/incomes?from=2025-03-01&to=2025-03-31&size=500").get_json()
        self.assertEqual(r["total"], 28)
        r = self.c.get("/api/incomes?q=거래처3&size=500").get_json()
        self.assertEqual(r["total"], len([i for i in range(total) if i % 7 == 3]))
        r = self.c.get("/api/incomes?q=1005").get_json()  # 숫자 검색은 금액도 찾는다
        self.assertTrue(any(it["amount"] == 1005 for it in r["items"]))
        r = self.c.get("/api/incomes?q=100%25").get_json()  # LIKE 특수문자 안전
        self.assertEqual(r["total"], 0)

    def test_date_normalized_and_zero_amount_rejected(self):
        r = self.post(self.c, "/api/incomes", {"trx_date": "2026-3-5", "income_type": "기타", "amount": 1000})
        self.assertEqual(r.get_json()["trx_date"], "2026-03-05")
        r = self.post(self.c, "/api/incomes", {"trx_date": "2026-03-05", "income_type": "기타", "amount": "0"})
        self.assertEqual(r.status_code, 400)

    def test_receivable_and_settle(self):
        row = self.income(receivable=50000)
        r = self.post(self.c, "/api/incomes", {"trx_date": "2026-03-03", "income_type": "기타",
                                               "amount": 1000, "receivable": 5000})
        self.assertEqual(r.status_code, 400)  # 미수금 > 금액
        rec = self.c.get("/api/receivables").get_json()
        self.assertEqual(rec["incomes"]["total"], 50000)
        self.assertEqual(rec["incomes"]["by_client"][0]["name"], "개인")
        self.assertEqual(self.c.get("/api/incomes?outstanding=1").get_json()["total"], 1)
        r = self.post(self.c, f"/api/incomes/{row['id']}/settle")
        self.assertEqual(r.get_json()["receivable"], 0)
        self.assertEqual(self.c.get("/api/receivables").get_json()["incomes"]["total"], 0)
        daily = self.c.get("/api/stats/daily?date=2026-03-02").get_json()
        self.assertEqual(daily["outstanding"]["receivable"], 0)

    def test_cash_counts_non_card(self):
        self.income(payment_type="입금", amount=30000, vat=0, net_amount=30000)
        self.income(payment_type="카드")
        t = self.c.get("/api/stats/daily?date=2026-03-02").get_json()["day"]["totals"]
        self.assertEqual(t["card_income"], 110000)
        self.assertEqual(t["cash_income"], 30000)


class ImportExportTest(Base):
    def rows(self):
        inc = [{"trx_date": "2026-01-02", "income_type": "서비스제공", "category": "데크수리",
                "client": "A", "amount": 750000, "vat": 0, "net_amount": 750000,
                "payment_type": "입금", "memo": "x", "receivable": 250000, "src": "매출집계!6"},
               {"trx_date": "2026-01-02", "income_type": "서비스제공", "category": "데크수리",
                "client": "A", "amount": 750000, "vat": 0, "net_amount": 750000,
                "payment_type": "입금", "memo": "x", "src": "매출집계!7"},  # 파일 안의 정당한 중복
               {"trx_date": "2026-01-05", "income_type": "상품판매", "category": "앰프", "client": "B",
                "currency": "CNY", "exchange_rate": 190.5, "quantity": 2, "unit_price": 1000,
                "amount": 381000, "vat": 34636, "net_amount": 346364, "payment_type": "카드",
                "tax_invoice": "Y", "memo": "=HYPERLINK(\"http://x\")", "src": "매출집계!8"},
               {"trx_date": "날짜아님", "income_type": "기타", "amount": 1, "src": "매출집계!9"}]
        exp = [{"trx_date": "2026-01-03", "expense_type": "생활", "item": "마트", "client": "C",
                "payment_type": "법인체크", "amount": 30400, "payable": 10000, "src": "지출집계!6"}]
        return inc, exp

    def test_import_idempotent_and_fields(self):
        inc, exp = self.rows()
        r = self.post(self.c, "/api/import-json", {"incomes": inc, "expenses": exp}).get_json()
        self.assertEqual((r["incomes_added"], r["incomes_skipped"], r["incomes_invalid"]), (3, 0, 1))
        self.assertEqual(r["expenses_added"], 1)
        self.assertEqual(r["invalid_samples"][0]["src"], "매출집계!9")
        r2 = self.post(self.c, "/api/import-json", {"incomes": inc, "expenses": exp}).get_json()
        self.assertEqual((r2["incomes_added"], r2["incomes_skipped"]), (0, 3))
        self.assertEqual(r2["backup"], "")  # 새로 들어갈 게 없으면 백업도 만들지 않음
        items = self.c.get("/api/incomes?size=10").get_json()["items"]
        cny = next(i for i in items if i["currency"] == "CNY")
        self.assertEqual((cny["exchange_rate"], cny["quantity"], cny["unit_price"]), (190.5, 2, 1000))
        self.assertEqual(sum(i["receivable"] for i in items), 250000)
        e = self.c.get("/api/expenses").get_json()["items"][0]
        self.assertEqual(e["payable"], 10000)
        months = self.c.get("/api/stats/months?from=2026-01-01&to=2026-01-31").get_json()
        self.assertEqual(months[0]["income_count"], 3)
        self.assertEqual(months[0]["income"], 750000 * 2 + 381000)

    def test_import_makes_pre_import_backup(self):
        self.income()
        inc, exp = self.rows()
        r = self.post(self.c, "/api/import-json", {"incomes": inc, "expenses": exp}).get_json()
        self.assertTrue(r["backup"].endswith("-pre-import.db"))
        self.assertTrue(os.path.isfile(os.path.join(wellcar.BACKUP_DIR, r["backup"])))

    def test_export_round_trip(self):
        inc, exp = self.rows()
        self.post(self.c, "/api/import-json", {"incomes": inc, "expenses": exp})
        r = self.c.get("/api/export.xlsx?from=2026-01-01&to=2026-12-31")
        self.assertEqual(r.status_code, 200)
        self.assertIn("attachment", r.headers["Content-Disposition"])
        wb = load_workbook(io.BytesIO(r.data))
        self.assertEqual(wb.sheetnames, ["요약", "월별손익", "매출내역", "지출내역"])
        ws = wb["매출내역"]
        head = [c.value for c in ws[1]]
        self.assertIn("미수금", head)
        self.assertIn("거래통화", head)
        self.assertEqual(ws.max_row, 4)  # 헤더 + 3건
        memo_col = head.index("적요")
        memos = [ws.cell(row=i, column=memo_col + 1) for i in range(2, 5)]
        formula_cell = next(c for c in memos if str(c.value).startswith("="))
        self.assertEqual(formula_cell.data_type, "s")  # 수식으로 실행되지 않음
        monthly = wb["월별손익"]
        self.assertEqual(monthly.cell(row=2, column=1).value, "2026-01")
        # 조건 내보내기: 매출만, 검색어
        r = self.c.get("/api/export.xlsx?kind=incomes&q=B")
        wb = load_workbook(io.BytesIO(r.data))
        self.assertEqual(wb.sheetnames, ["요약", "월별손익", "매출내역"])
        self.assertEqual(wb["매출내역"].max_row, 2)


class BackupTest(Base):
    def test_backup_restore_cycle(self):
        self.income(amount=110000)
        made = self.post(self.c, "/api/backups").get_json()
        self.assertEqual(made["kind"], "manual")
        self.income(amount=220000, vat=20000, net_amount=200000)
        self.assertEqual(self.c.get("/api/incomes").get_json()["total"], 2)
        r = self.post(self.c, f"/api/backups/{made['name']}/restore").get_json()
        self.assertEqual(r["restored"]["incomes"], 1)
        self.assertTrue(r["safety_backup"].endswith("-pre-restore.db"))
        self.assertEqual(self.c.get("/api/incomes").get_json()["total"], 1)
        # 복원해도 로그인 계정은 그대로
        self.assertEqual(self.c.get("/api/meta").status_code, 200)
        dl = self.c.get(f"/api/backups/{made['name']}/download")
        self.assertEqual(dl.status_code, 200)
        self.assertTrue(dl.data.startswith(b"SQLite format 3"))
        dl.close()
        # 업로드 → 목록에 'upload'로 보관
        up = self.c.post("/api/backups/upload", headers=HDR,
                         data={"file": (io.BytesIO(dl.data), "my.db")},
                         content_type="multipart/form-data")
        self.assertEqual(up.status_code, 201, up.get_json())
        self.assertEqual(up.get_json()["kind"], "upload")
        bad = self.c.post("/api/backups/upload", headers=HDR,
                          data={"file": (io.BytesIO(b"not a db"), "x.db")},
                          content_type="multipart/form-data")
        self.assertEqual(bad.status_code, 400)

    def test_path_traversal_rejected(self):
        self.assertEqual(self.c.get("/api/backups/..%2Fapp.py/download").status_code, 404)
        self.assertEqual(self.c.get("/api/backups/wellcar.db/download").status_code, 404)

    def test_restore_old_schema_backup(self):
        """열이 추가되기 전의 옛 DB 백업도 복원된다."""
        old = os.path.join(TMP, "old.db")
        db = sqlite3.connect(old)
        db.executescript("""
            CREATE TABLE incomes (id INTEGER PRIMARY KEY AUTOINCREMENT, trx_date TEXT NOT NULL,
                income_type TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0);
            CREATE TABLE expenses (id INTEGER PRIMARY KEY AUTOINCREMENT, trx_date TEXT NOT NULL,
                expense_type TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0);
            INSERT INTO incomes(trx_date, income_type, amount) VALUES ('2024-01-01','기타',5000);
        """)
        db.commit()
        db.close()
        counts = backup.restore_data(wellcar.DB_PATH, old)
        self.assertEqual(counts["incomes"], 1)
        it = self.c.get("/api/incomes").get_json()["items"][0]
        self.assertEqual((it["amount"], it["receivable"]), (5000, 0))

    def test_auto_backup_once_a_day(self):
        self.income()
        for it in backup.list_backups(wellcar.BACKUP_DIR):
            if it["kind"] == "auto":
                os.remove(os.path.join(wellcar.BACKUP_DIR, it["name"]))
        self.assertIsNotNone(backup.auto_backup_if_due(wellcar.DB_PATH, wellcar.BACKUP_DIR, 24))
        self.assertIsNone(backup.auto_backup_if_due(wellcar.DB_PATH, wellcar.BACKUP_DIR, 24))


if __name__ == "__main__":
    unittest.main()
