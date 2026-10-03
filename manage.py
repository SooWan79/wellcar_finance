"""관리 명령 (서버와 별도로, 서버가 켜져 있어도 실행할 수 있음).

    python manage.py list-users                      # 사용자 목록
    python manage.py create-user 아이디 --role admin --name 홍길동
    python manage.py reset-password 아이디             # 비밀번호를 잊었을 때 (다시 사용 중으로도 바꿈)
    python manage.py backup                          # 지금 바로 백업
    python manage.py setup-code                      # 처음 설정 코드 다시 보기

DB 위치는 서버와 같은 WELLCAR_DB 환경변수를 따릅니다.
"""
import argparse
import getpass
import sqlite3
import sys

from werkzeug.security import generate_password_hash

import app as wellcar
import backup


def _ask_password(username):
    while True:
        pw = getpass.getpass("새 비밀번호: ")
        err = wellcar._validate_password(pw, username)
        if err:
            print(err)
            continue
        if getpass.getpass("한 번 더 입력: ") != pw:
            print("두 비밀번호가 다릅니다. 다시 입력하세요.")
            continue
        return pw


def cmd_list_users(_args, db):
    rows = db.execute("SELECT * FROM users ORDER BY id").fetchall()
    if not rows:
        print("사용자가 없습니다. 브라우저로 접속해 처음 설정을 하거나 create-user로 만드세요.")
    for r in rows:
        state = "사용 중" if r["active"] else "사용 중지"
        print(f"{r['id']:>3}  {r['username']:<16} {wellcar.ROLE_LABELS.get(r['role'], r['role']):<6} "
              f"{state:<6} {r['display_name'] or ''}  (마지막 로그인 {r['last_login_at'] or '-'})")


def cmd_create_user(args, db):
    err = wellcar._validate_username(args.username)
    if err:
        sys.exit(err)
    if db.execute("SELECT 1 FROM users WHERE username=?", (args.username,)).fetchone():
        sys.exit("이미 있는 아이디입니다. 비밀번호를 바꾸려면 reset-password를 쓰세요.")
    pw = _ask_password(args.username)
    wellcar._create_user(db, args.username, pw, args.role, args.name or "")
    db.execute("DELETE FROM settings WHERE key='setup_code'")
    db.commit()
    print(f"'{args.username}' ({wellcar.ROLE_LABELS[args.role]}) 계정을 만들었습니다.")


def cmd_reset_password(args, db):
    row = db.execute("SELECT * FROM users WHERE username=?", (args.username,)).fetchone()
    if not row:
        sys.exit("그런 아이디가 없습니다. list-users로 확인하세요.")
    pw = _ask_password(row["username"])
    db.execute("UPDATE users SET password_hash=?, active=1, session_version=session_version+1 WHERE id=?",
               (generate_password_hash(pw), row["id"]))
    db.commit()
    print(f"'{row['username']}'의 비밀번호를 바꿨습니다. 다른 기기의 로그인은 해제됩니다.")


def cmd_backup(_args, _db):
    item = backup.create_backup(wellcar.DB_PATH, wellcar.BACKUP_DIR, "manual")
    print(f"백업했습니다: {wellcar.BACKUP_DIR}/{item['name']}")


def cmd_setup_code(_args, db):
    if db.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        print("이미 사용자가 있어 설정 코드가 필요 없습니다. 비밀번호를 잊었다면 reset-password를 쓰세요.")
        return
    print("설정 코드:", wellcar.get_setting(db, "setup_code"))


def main():
    ap = argparse.ArgumentParser(description="웰카오디오 매출/지출관리 시스템 관리 명령")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list-users", help="사용자 목록")
    p = sub.add_parser("create-user", help="사용자 만들기")
    p.add_argument("username")
    p.add_argument("--role", choices=list(wellcar.ROLES), default="staff")
    p.add_argument("--name", default="")
    p = sub.add_parser("reset-password", help="비밀번호 다시 정하기")
    p.add_argument("username")
    sub.add_parser("backup", help="지금 백업")
    sub.add_parser("setup-code", help="처음 설정 코드 보기")
    args = ap.parse_args()
    db = sqlite3.connect(wellcar.DB_PATH, timeout=15)
    db.row_factory = sqlite3.Row
    try:
        {"list-users": cmd_list_users, "create-user": cmd_create_user,
         "reset-password": cmd_reset_password, "backup": cmd_backup,
         "setup-code": cmd_setup_code}[args.cmd](args, db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
