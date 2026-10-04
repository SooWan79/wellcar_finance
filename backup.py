"""DB 백업·복원 (SQLite 온라인 백업 API 사용, Flask와 무관한 순수 함수 모음).

- 백업 파일 이름: wellcar-YYYYMMDD-HHMMSS-<종류>.db
- 종류: auto(자동, 하루 1회), manual(수동), pre-import(엑셀 가져오기 직전),
        pre-restore(복원 직전), upload(업로드한 백업 파일)
- 종류별로 최근 N개만 남기고 오래된 파일은 지운다(KEEP).
- 복원은 매출·지출·코드·목표 테이블만 되돌린다. 사용자 계정과 설정은 그대로 두어
  옛 백업을 복원해도 로그인이 막히지 않게 한다.
"""
import os
import re
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

KIND_LABELS = {
    "auto": "자동",
    "manual": "수동",
    "pre-import": "가져오기 직전",
    "pre-restore": "복원 직전",
    "upload": "업로드",
}
NAME_RE = re.compile(
    r"^wellcar-(\d{8})-(\d{6})(?:-(\d+))?-(auto|manual|pre-import|pre-restore|upload)\.db$")
KEEP = {"auto": 30, "manual": 30, "pre-import": 10, "pre-restore": 10, "upload": 10}
DATA_TABLES = ("incomes", "expenses", "codes", "targets")
SQLITE_MAGIC = b"SQLite format 3\x00"


def _parse_name(name):
    m = NAME_RE.match(name or "")
    if not m:
        return None
    ts = datetime.strptime(m.group(1) + m.group(2), "%Y%m%d%H%M%S")
    return ts, m.group(4), int(m.group(3) or 1)  # 같은 초에 여러 개면 -2-, -3- … 순번


def _item(backup_dir, name):
    parsed = _parse_name(name)
    if not parsed:
        return None
    ts, kind, seq = parsed
    try:
        size = os.path.getsize(os.path.join(backup_dir, name))
    except OSError:
        return None
    return {"name": name, "kind": kind, "kind_label": KIND_LABELS[kind],
            "created_at": ts.strftime("%Y-%m-%d %H:%M:%S"), "seq": seq, "size": size}


def list_backups(backup_dir):
    """최신순 백업 목록."""
    if not os.path.isdir(backup_dir):
        return []
    items = [it for it in (_item(backup_dir, n) for n in os.listdir(backup_dir)) if it]
    # 이름 문자열 순서로는 '-10-'이 '-2-'보다 앞서므로 시각과 순번으로 정렬한다
    items.sort(key=lambda it: (it["created_at"], it["seq"]), reverse=True)
    return items


def backup_path(backup_dir, name):
    """이름 검증(경로 조작 방지) 후 실제 파일 경로. 없으면 None."""
    if not NAME_RE.match(name or ""):
        return None
    path = os.path.join(backup_dir, name)
    return path if os.path.isfile(path) else None


def _new_name(backup_dir, kind):
    """같은 초에 여러 개를 만들면 순번을 붙인다. 정리로 지워진 번호를 다시 쓰지 않고
    그 초의 가장 큰 순번 + 1을 써서, 이름의 (시각, 순번)이 항상 만든 순서와 같게 한다."""
    now = datetime.now()
    stamp = now.strftime("%Y%m%d-%H%M%S")
    second = now.replace(microsecond=0)
    seqs = [p[2] for p in (_parse_name(n) for n in os.listdir(backup_dir)) if p and p[0] == second]
    n = max(seqs, default=0) + 1
    return f"wellcar-{stamp}-{kind}.db" if n == 1 else f"wellcar-{stamp}-{n}-{kind}.db"


def create_backup(db_path, backup_dir, kind="manual", protect=()):
    """현재 DB를 일관된 상태로 복사한다(쓰기 중이어도 안전한 온라인 백업).
    protect: 보관 개수 정리에서 지우면 안 되는 백업 이름(예: 지금 복원하려는 파일)."""
    os.makedirs(backup_dir, exist_ok=True)
    name = _new_name(backup_dir, kind)
    final = os.path.join(backup_dir, name)
    tmp = final + ".tmp"
    src = sqlite3.connect(db_path, timeout=30)
    try:
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
        finally:
            dst.close()
    finally:
        src.close()
    os.replace(tmp, final)
    prune(backup_dir, protect)
    return _item(backup_dir, name)


def prune(backup_dir, protect=()):
    """종류별 보관 개수를 넘는 오래된 백업과 하루 지난 임시 파일을 지운다."""
    seen = {}
    for it in list_backups(backup_dir):
        seen[it["kind"]] = seen.get(it["kind"], 0) + 1
        if seen[it["kind"]] > KEEP[it["kind"]] and it["name"] not in protect:
            try:
                os.remove(os.path.join(backup_dir, it["name"]))
            except OSError:
                pass
    cutoff = datetime.now().timestamp() - 86400
    for n in os.listdir(backup_dir):
        if n.endswith(".tmp"):
            p = os.path.join(backup_dir, n)
            try:
                if os.path.getmtime(p) < cutoff:
                    os.remove(p)
            except OSError:
                pass


def has_data(db_path):
    con = sqlite3.connect(db_path, timeout=30)
    try:
        return bool(con.execute(
            "SELECT EXISTS(SELECT 1 FROM incomes) OR EXISTS(SELECT 1 FROM expenses)").fetchone()[0])
    except sqlite3.Error:
        return False
    finally:
        con.close()


def last_backup(backup_dir, kind="auto"):
    return next((it for it in list_backups(backup_dir) if it["kind"] == kind), None)


def auto_backup_if_due(db_path, backup_dir, interval_hours=24):
    """마지막 자동 백업 후 interval_hours가 지났고 데이터가 있으면 자동 백업."""
    latest = last_backup(backup_dir, "auto")
    if latest:
        made = datetime.strptime(latest["created_at"], "%Y-%m-%d %H:%M:%S")
        if datetime.now() - made < timedelta(hours=interval_hours):
            return None
    if not has_data(db_path):
        return None
    return create_backup(db_path, backup_dir, "auto")


def inspect_backup(path):
    """백업 파일이 이 시스템의 DB인지 검사하고 테이블별 건수를 돌려준다. 아니면 ValueError."""
    with open(path, "rb") as f:
        if f.read(16) != SQLITE_MAGIC:
            raise ValueError("SQLite 데이터베이스 파일이 아닙니다.")
    # 읽기 전용으로 연다(경로의 공백·특수문자는 as_uri가 인코딩)
    con = sqlite3.connect(Path(path).absolute().as_uri() + "?mode=ro", uri=True)
    try:
        if con.execute("PRAGMA quick_check").fetchone()[0] != "ok":
            raise ValueError("손상된 백업 파일입니다.")
        tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        if not {"incomes", "expenses"} <= tables:
            raise ValueError("매출/지출 테이블이 없는 파일입니다. 이 시스템의 백업 파일인지 확인하세요.")
        return {t: con.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                for t in DATA_TABLES if t in tables}
    except sqlite3.DatabaseError as e:
        raise ValueError(f"백업 파일을 읽을 수 없습니다: {e}") from e
    finally:
        con.close()


def store_upload(stream, backup_dir):
    """업로드한 백업 파일을 검사한 뒤 'upload' 종류 백업으로 보관한다."""
    os.makedirs(backup_dir, exist_ok=True)
    name = _new_name(backup_dir, "upload")
    final = os.path.join(backup_dir, name)
    tmp = final + ".tmp"
    with open(tmp, "wb") as f:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
    try:
        inspect_backup(tmp)
    except ValueError:
        os.remove(tmp)
        raise
    os.replace(tmp, final)
    prune(backup_dir)
    return _item(backup_dir, name)


def restore_data(db_path, src_path):
    """백업 파일의 매출·지출·코드·목표 테이블로 현재 DB를 덮어쓴다(한 트랜잭션).

    두 DB에 모두 있는 열만 옮기므로 열이 추가되기 전의 옛 백업도 복원할 수 있다.
    백업의 코드·목표 테이블이 비어 있거나 없으면 현재 것을 유지한다(드랍다운·목표가 사라지지 않도록).
    """
    inspect_backup(src_path)
    con = sqlite3.connect(db_path, timeout=30, isolation_level=None)
    try:
        con.execute("ATTACH DATABASE ? AS bk", (src_path,))
        try:
            bk_tables = {r[0] for r in con.execute(
                "SELECT name FROM bk.sqlite_master WHERE type='table'")}
            con.execute("BEGIN IMMEDIATE")
            try:
                counts = {}
                for t in DATA_TABLES:
                    if t not in bk_tables:
                        continue
                    if t in ("codes", "targets") and not con.execute(
                            f"SELECT COUNT(*) FROM bk.{t}").fetchone()[0]:
                        continue
                    main_cols = [r[1] for r in con.execute(f"PRAGMA main.table_info({t})")]
                    bk_cols = {r[1] for r in con.execute(f"PRAGMA bk.table_info({t})")}
                    cols = ", ".join(c for c in main_cols if c in bk_cols)
                    con.execute(f"DELETE FROM main.{t}")
                    con.execute(f"INSERT INTO main.{t} ({cols}) SELECT {cols} FROM bk.{t}")
                    counts[t] = con.execute(f"SELECT COUNT(*) FROM main.{t}").fetchone()[0]
                con.execute("COMMIT")
            except Exception:
                con.execute("ROLLBACK")
                raise
        finally:
            con.execute("DETACH DATABASE bk")
        return counts
    finally:
        con.close()
