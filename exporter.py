"""매출/지출 엑셀(.xlsx) 내보내기 (openpyxl 쓰기 전용 모드, 대용량도 메모리를 적게 씀).

내역 시트의 열 이름은 엑셀 가져오기가 읽는 이름과 같습니다. 그래서 내보낸 파일을
이 시스템에 다시 가져와도 중복 없이 같은 결과가 됩니다(왕복 호환).
"""
from datetime import date, datetime
from io import BytesIO

from openpyxl import Workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"]

FMT_WON = "#,##0"
FMT_DEC = "#,##0.00"
FMT_DATE = "yyyy-mm-dd"

# (헤더, 필드, 형식, 열 너비)
INCOME_COLUMNS = [
    ("영업일자", "trx_date", "date", 12),
    ("요일", "weekday", "text", 6),
    ("매출유형", "income_type", "text", 11),
    ("매출구분", "category", "text", 14),
    ("차량제조사", "manufacturer", "text", 11),
    ("제품모델", "product_model", "text", 14),
    ("거래처명", "client", "text", 20),
    ("거래통화", "currency", "text", 9),
    ("기준환율", "exchange_rate", "rate", 10),
    ("수량", "quantity", "qty", 7),
    ("단가", "unit_price", "price", 12),
    ("매출액", "amount", "won", 13),
    ("부가세", "vat", "won", 11),
    ("순매출액", "net_amount", "won", 13),
    ("결제유형", "payment_type", "text", 10),
    ("세금계산서발행유무", "tax_invoice", "text", 11),
    ("계좌", "account", "text", 20),
    ("미수금", "receivable", "won", 12),
    ("적요", "memo", "text", 36),
]
EXPENSE_COLUMNS = [
    ("영업일자", "trx_date", "date", 12),
    ("요일", "weekday", "text", 6),
    ("지출유형", "expense_type", "text", 11),
    ("거래품목", "item", "text", 14),
    ("결제유형", "payment_type", "text", 10),
    ("거래처명", "client", "text", 20),
    ("거래통화", "currency", "text", 9),
    ("기준환율", "exchange_rate", "rate", 10),
    ("수량", "quantity", "qty", 7),
    ("단가", "unit_price", "price", 12),
    ("지출금액", "amount", "won", 13),
    ("미지급금", "payable", "won", 12),
    ("적요", "memo", "text", 36),
]

_HEAD_FONT = Font(bold=True, color="FFFFFF")
_HEAD_FILL = PatternFill("solid", fgColor="2A78D6")
_HEAD_ALIGN = Alignment(horizontal="center", vertical="center", wrap_text=True)
_BOLD = Font(bold=True)
_TITLE = Font(bold=True, size=14)
_MUTED = Font(color="5B6675")
_TOTAL_FILL = PatternFill("solid", fgColor="EEF1F6")
_TOP_LINE = Border(top=Side(style="thin", color="8B95A4"))


def _cell(ws, value, fmt=None, font=None, fill=None, align=None, border=None):
    c = WriteOnlyCell(ws, value=value)
    if isinstance(value, str) and value.startswith("="):
        c.data_type = "s"  # '='로 시작하는 적요 등이 수식으로 실행되지 않게 글자로 고정
    if fmt:
        c.number_format = fmt
    if font:
        c.font = font
    if fill:
        c.fill = fill
    if align:
        c.alignment = align
    if border:
        c.border = border
    return c


def _head_row(ws, titles):
    return [_cell(ws, t, font=_HEAD_FONT, fill=_HEAD_FILL, align=_HEAD_ALIGN) for t in titles]


def _as_date(s):
    try:
        return datetime.strptime(str(s), "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return s


def _num(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _whole(v):
    """정수로 떨어지는 값은 int로(엑셀에서 1.0이 아니라 1로 보이게)."""
    f = _num(v)
    return int(f) if f.is_integer() else f


def _value_cell(ws, kind, field, row):
    v = row[field] if field != "weekday" else None
    if kind == "date":
        return _cell(ws, _as_date(v), FMT_DATE)
    if field == "weekday":
        d = _as_date(row["trx_date"])
        return _cell(ws, WEEKDAYS[d.weekday()] if isinstance(d, date) else "")
    if kind == "won":
        return _cell(ws, _whole(v), FMT_WON)
    if kind == "rate":
        return _cell(ws, _whole(v) or 1, FMT_DEC)
    if kind == "qty":
        q = _whole(v)
        return _cell(ws, q, FMT_WON if isinstance(q, int) else "#,##0.###")
    if kind == "price":
        p = _whole(v)
        krw = (row["currency"] or "KRW") == "KRW"
        return _cell(ws, p, FMT_WON if krw and isinstance(p, int) else FMT_DEC)
    return _cell(ws, "" if v is None else str(v))


def _detail_sheet(wb, title, columns, rows):
    ws = wb.create_sheet(title)
    for i, (_h, _f, _k, width) in enumerate(columns, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "B2"
    ws.append(_head_row(ws, [c[0] for c in columns]))
    n = 0
    for row in rows:
        ws.append([_value_cell(ws, kind, field, row) for _h, field, kind, _w in columns])
        n += 1
    ws.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{n + 1}"
    return n


def _summary_sheet(wb, meta, totals, include_inc, include_exp):
    ws = wb.create_sheet("요약")
    ws.column_dimensions["A"].width = 22
    ws.column_dimensions["B"].width = 20
    ws.column_dimensions["C"].width = 10
    ws.append([_cell(ws, meta["title"], font=_TITLE)])
    for label, key in (("조회 기간", "period"), ("조건", "conditions"),
                       ("내보낸 시각", "exported_at"), ("내보낸 사람", "exported_by")):
        if meta.get(key):
            ws.append([_cell(ws, label, font=_MUTED), _cell(ws, meta[key])])
    ws.append([])
    ws.append(_head_row(ws, ["항목", "금액(원)", "건수"]))
    lines = []
    if include_inc:
        lines += [("매출액 합계", totals["income"], totals["income_count"]),
                  ("부가세", totals["vat"], None),
                  ("순매출액", totals["net_income"], None),
                  ("미수금 잔액", totals["receivable"], totals["receivable_count"])]
    if include_exp:
        lines += [("지출금액 합계", totals["expense"], totals["expense_count"]),
                  ("미지급금 잔액", totals["payable"], totals["payable_count"])]
    if include_inc and include_exp:
        lines.append(("영업이익 (매출 − 지출)", totals["income"] - totals["expense"], None))
    for label, amount, count in lines:
        ws.append([_cell(ws, label, font=_BOLD), _cell(ws, _whole(amount), FMT_WON),
                   _cell(ws, count, FMT_WON) if count is not None else _cell(ws, None)])
    ws.append([])
    ws.append([_cell(ws, "※ '매출내역'·'지출내역' 시트는 이 시스템의 [데이터 관리 → 엑셀 가져오기]로 "
                         "다시 불러올 수 있습니다(이미 있는 내역은 자동으로 건너뜀).", font=_MUTED)])


def _monthly_sheet(wb, monthly, include_inc, include_exp):
    ws = wb.create_sheet("월별손익")
    # '영업월' 머리글: 다시 가져올 때 이 표를 월별 합계로 인식해 내역과 자동 대조한다
    cols = [("영업월", "month", None, 10)]
    if include_inc:
        cols += [("매출 건수", "income_count", FMT_WON, 9), ("매출액", "income", FMT_WON, 14),
                 ("부가세", "vat", FMT_WON, 12), ("순매출액", "net_income", FMT_WON, 14),
                 ("미수금", "receivable", FMT_WON, 12)]
    if include_exp:
        cols += [("지출 건수", "expense_count", FMT_WON, 9), ("지출금액", "expense", FMT_WON, 14),
                 ("미지급금", "payable", FMT_WON, 12)]
    if include_inc and include_exp:
        cols += [("영업이익", "profit", FMT_WON, 14)]
    for i, c in enumerate(cols, start=1):
        ws.column_dimensions[get_column_letter(i)].width = c[3]
    ws.freeze_panes = "B2"
    ws.append(_head_row(ws, [c[0] for c in cols]))
    total = {}
    for m in monthly:
        ws.append([_cell(ws, m[key], fmt) if fmt else _cell(ws, m[key]) for _t, key, fmt, _w in cols])
        for _t, key, fmt, _w in cols[1:]:
            total[key] = total.get(key, 0) + (m[key] or 0)
    if monthly:
        row = [_cell(ws, "합계", font=_BOLD, fill=_TOTAL_FILL, border=_TOP_LINE)]
        row += [_cell(ws, total[key], fmt, font=_BOLD, fill=_TOTAL_FILL, border=_TOP_LINE)
                for _t, key, fmt, _w in cols[1:]]
        ws.append(row)


def build_workbook(meta, totals, monthly, incomes=None, expenses=None):
    """요약·월별손익·매출내역·지출내역 시트로 된 xlsx 바이트를 만든다.

    incomes/expenses는 행(dict 또는 sqlite3.Row)의 반복자이며, None이면 그 시트를 만들지 않는다.
    """
    include_inc, include_exp = incomes is not None, expenses is not None
    wb = Workbook(write_only=True)
    _summary_sheet(wb, meta, totals, include_inc, include_exp)
    _monthly_sheet(wb, monthly, include_inc, include_exp)
    if include_inc:
        _detail_sheet(wb, "매출내역", INCOME_COLUMNS, incomes)
    if include_exp:
        _detail_sheet(wb, "지출내역", EXPENSE_COLUMNS, expenses)
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()
