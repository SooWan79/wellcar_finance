/* 데모용 가짜 서버 — 실제 Flask API(/api/*)를 브라우저 안에서 그대로 흉내 낸다.
   app.js는 실제 시스템과 똑같이 fetch("/api/...")를 부르고, 이 파일이 그 요청을 가로채 답한다.
   데이터는 이 브라우저의 localStorage에만 저장된다(못 쓰면 메모리로만 동작).
   규칙·문구·응답 모양은 app.py와 같게 유지한다. app.py를 바꾸면 여기도 맞춰 바꿀 것. */
(function () {
  "use strict";

  const KEY = "wellcar_demo_v2";
  const BACKUP_KEY = "wellcar_demo_v2_backups";
  const SESSION_KEY = "wellcar_demo_v2_session";
  const DEMO_PASSWORD = "demo1234";

  // ---------------------------------------------------------------- 저장소 (실패해도 동작)
  function storage(kind) {
    try {
      const s = window[kind];
      const t = "__wellcar_probe";
      s.setItem(t, "1");
      s.removeItem(t);
      return s;
    } catch (_e) {
      return null;
    }
  }
  const local = storage("localStorage");
  const sessionStore = storage("sessionStorage");
  const memory = {};
  function readJSON(store, key) {
    try {
      const raw = store ? store.getItem(key) : memory[key];
      return raw ? JSON.parse(raw) : null;
    } catch (_e) {
      return null;
    }
  }
  function writeJSON(store, key, value) {
    const raw = JSON.stringify(value);
    if (!store) { memory[key] = raw; return true; }
    try { store.setItem(key, raw); return true; } catch (_e) { memory[key] = raw; return false; }
  }

  // ---------------------------------------------------------------- 공통 도우미
  const pad2 = n => String(n).padStart(2, "0");
  const isoOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const nowStr = () => { const d = new Date(); return `${isoOf(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };
  const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];
  const weekdayOf = s => { const d = new Date(s + "T00:00:00"); return isNaN(d) ? "" : WEEKDAYS[(d.getDay() + 6) % 7]; };
  const roundHalfUp = v => Math.floor(Number(v) + 0.5);
  const MAX_NUMBER = 1e13;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  async function hashPassword(pw) {
    try {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("wellcar-demo:" + pw));
      return "sha256:" + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
    } catch (_e) {
      return "plain:" + pw;  // 아주 오래된 브라우저용(데모)
    }
  }

  // ---------------------------------------------------------------- 초기 데이터 (app.py SEED_CODES와 같음)
  const SEED_CODES = {
    income_type: ["서비스제공", "상품판매", "기타"],
    income_category: {
      "서비스제공": ["내비게이션수리", "데크수리", "메카니즘수리", "카오디오수리", "앰프수리", "탈부착"],
      "상품판매": ["카오디오", "앰프", "스피커", "내비게이션", "블랙박스", "휴대폰강화유리", "자동차액세서리"],
      "기타": ["기타"],
    },
    expense_type: ["제품원가", "구매계약", "비용", "인건비", "제세공과금", "생활", "기타"],
    expense_item: {
      "제품원가": ["제품매입", "서비스이용"],
      "구매계약": ["서비스계약", "렌탈계약", "리스계약", "자문계약", "원부자재구매", "제품구매", "물품구매", "비품구매", "자산구매"],
      "비용": ["복리후생비", "식대", "업무경비", "수수료", "광고비", "피복비", "회의비", "수도광열비", "통신비", "보험료", "의료비", "임차료", "도서인쇄비", "교육훈련비", "여비교통비", "출장비", "차량유지비", "이자비용"],
      "인건비": ["급여", "수당", "잡급"],
      "제세공과금": ["재산세", "법인세", "부가세"],
      "생활": ["마트", "식당", "간식비", "생활용품", "기타"],
      "기타": ["기타"],
    },
    payment_type: ["현금", "카드", "계좌입금"],
    account: ["국민(법인)", "기업(웰카오디오-개인)", "농협1(웰카오디오-개인)", "농협2(웰파츠-개인)", "카드"],
    currency: ["KRW", "CNY"],
    manufacturer: ["벤츠", "BMW", "아우디", "폭스바겐", "볼보", "닛산", "토요타", "현대", "르노", "레인지로버", "N/A"],
    client: ["개인", "방문", "해덕", "동서카오디오(대구)", "재즈카오디오(광주)", "재즈카오디오(대구)", "현대카오디오(서울)", "수원테크(수원)", "닥터카오디오(수원)", "써브카오디오(안산)", "오토사운드(논산)", "주문진카오디오(주문진)", "창원카오디오(창원)", "슈퍼그립", "미스터짱카", "11번가", "옥션", "G마켓"],
  };

  const INCOME_DEFAULTS = { category: "", manufacturer: "", product_model: "", client: "", currency: "KRW",
    exchange_rate: 1, quantity: 1, unit_price: 0, vat: 0, net_amount: 0, account: "", payment_type: "",
    tax_invoice: "N", memo: "", receivable: 0, created_by: "", updated_by: "", updated_at: "" };
  const EXPENSE_DEFAULTS = { item: "", payment_type: "", client: "", currency: "KRW", exchange_rate: 1,
    quantity: 1, unit_price: 0, memo: "", payable: 0, created_by: "", updated_by: "", updated_at: "" };

  function seedEntries(db) {
    const rng = mulberry32(42);
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const SERVICES = ["카오디오수리", "데크수리", "내비게이션수리", "앰프수리", "메카니즘수리", "탈부착"];
    const PRODUCTS = ["카오디오", "앰프", "스피커", "내비게이션", "블랙박스"];
    const MAKERS = ["벤츠", "BMW", "아우디", "폭스바겐", "볼보", "토요타", "현대", "레인지로버", "N/A"];
    const CLIENTS = ["개인", "방문", "동서카오디오(대구)", "재즈카오디오(광주)", "현대카오디오(서울)",
      "수원테크(수원)", "닥터카오디오(수원)", "써브카오디오(안산)", "옥션", "G마켓"];
    const EXP_ITEMS = [["제품원가", "제품매입"], ["제품원가", "서비스이용"], ["비용", "식대"], ["비용", "차량유지비"],
      ["비용", "통신비"], ["비용", "수도광열비"], ["비용", "임차료"], ["제세공과금", "부가세"], ["생활", "마트"], ["생활", "식당"]];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let off = 365; off >= 0; off--) {
      const d = new Date(today); d.setDate(today.getDate() - off);
      if (d.getDay() === 0 || rng() > 0.85) continue;  // 일요일은 대부분 휴무
      const day = isoOf(d);
      const created = day + " 18:00:00";
      for (let i = 1 + Math.floor(rng() * 4); i > 0; i--) {
        const isService = rng() < 0.7;
        const amount = (5 + Math.floor(rng() * 115)) * 10000;
        const r = rng();
        const pay = r < 0.3 ? "현금" : r < 0.7 ? "카드" : "계좌입금";
        const tax = pay === "카드" || rng() < 0.3 ? "Y" : "N";
        const vat = (pay === "카드" || tax === "Y") ? roundHalfUp(amount * 10 / 110) : 0;
        const client = pick(CLIENTS);
        // 업체 거래 일부는 외상(미수금): 최근일수록 아직 못 받은 경우가 많게
        let receivable = 0;
        if (pay === "계좌입금" && client !== "개인" && client !== "방문" && rng() < (off < 45 ? 0.6 : 0.04))
          receivable = rng() < 0.7 ? amount : Math.floor(amount / 2);
        db.incomes.push(Object.assign({}, INCOME_DEFAULTS, {
          id: ++db.seq.incomes, trx_date: day, income_type: isService ? "서비스제공" : "상품판매",
          category: pick(isService ? SERVICES : PRODUCTS), manufacturer: pick(MAKERS), client,
          unit_price: amount, amount, vat, net_amount: amount - vat, account: "국민(법인)",
          payment_type: pay, tax_invoice: tax, memo: "데모 데이터", receivable,
          created_by: "데모", created_at: created,
        }));
      }
      for (let i = 1 + Math.floor(rng() * 3); i > 0; i--) {
        const [etype, item] = pick(EXP_ITEMS);
        const amount = (1 + Math.floor(rng() * 39)) * 10000;
        const payable = etype === "제품원가" && off < 40 && rng() < 0.5 ? amount : 0;
        db.expenses.push(Object.assign({}, EXPENSE_DEFAULTS, {
          id: ++db.seq.expenses, trx_date: day, expense_type: etype, item,
          payment_type: pick(["현금", "카드", "계좌입금"]), client: pick(["해덕", "마트", "식당", "주유소", "기타"]),
          unit_price: amount, amount, memo: "데모 데이터", payable, created_by: "데모", created_at: created,
        }));
      }
      if (d.getDate() === 25) {  // 매달 25일 급여
        const amount = (150 + Math.floor(rng() * 150)) * 10000;
        db.expenses.push(Object.assign({}, EXPENSE_DEFAULTS, {
          id: ++db.seq.expenses, trx_date: day, expense_type: "인건비", item: "급여", payment_type: "계좌입금",
          client: "직원", unit_price: amount, amount, memo: "데모 데이터", created_by: "데모", created_at: created,
        }));
      }
    }
    // 위안화(CNY) 거래 예시
    const cnyDay = new Date(today); cnyDay.setDate(today.getDate() - 3);
    db.incomes.push(Object.assign({}, INCOME_DEFAULTS, {
      id: ++db.seq.incomes, trx_date: isoOf(cnyDay), income_type: "상품판매", category: "앰프",
      manufacturer: "N/A", client: "해외 거래처", currency: "CNY", exchange_rate: 190.5, quantity: 2,
      unit_price: 1200, amount: 457200, vat: 0, net_amount: 457200, account: "기업(웰카오디오-개인)",
      payment_type: "계좌입금", memo: "데모 데이터 · CNY 거래 예시", receivable: 457200,
      created_by: "데모", created_at: isoOf(cnyDay) + " 18:00:00",
    }));
  }

  async function freshDB() {
    const db = { v: 2, incomes: [], expenses: [], codes: [], users: [], settings: {},
      seq: { incomes: 0, expenses: 0, codes: 0, users: 0 } };
    for (const [group, values] of Object.entries(SEED_CODES)) {
      if (Array.isArray(values)) {
        values.forEach((v, i) => db.codes.push({ id: ++db.seq.codes, code_group: group, code_value: v, parent_value: "", sort_order: i }));
      } else {
        for (const [parent, children] of Object.entries(values))
          children.forEach((v, i) => db.codes.push({ id: ++db.seq.codes, code_group: group, code_value: v, parent_value: parent, sort_order: i }));
      }
    }
    const hash = await hashPassword(DEMO_PASSWORD);
    for (const [username, display_name, role] of [["admin", "사장", "admin"], ["staff", "김직원", "staff"], ["viewer", "세무사", "viewer"]]) {
      db.users.push({ id: ++db.seq.users, username, display_name, password_hash: hash, role, active: 1,
        session_version: 1, last_login_at: "", created_at: nowStr() });
    }
    seedEntries(db);
    return db;
  }

  let DB = null;
  let BACKUPS = [];  // [{name, kind, created_at, seq, size, data}]
  const ready = (async () => {
    const saved = readJSON(local, KEY);
    if (saved && saved.v === 2) {
      DB = saved;
    } else {
      DB = await freshDB();
      try { local && local.removeItem("wellcar_demo_v1"); } catch (_e) { /* 옛 데모 데이터 정리 */ }
      saveDB();
    }
    BACKUPS = readJSON(local, BACKUP_KEY) || [];
  })();

  function saveDB() {
    if (writeJSON(local, KEY, DB)) return;
    // 저장 공간이 모자라면 백업을 줄여서라도 본 데이터를 먼저 지킨다
    while (BACKUPS.length) {
      BACKUPS.pop();
      saveBackups();
      if (writeJSON(local, KEY, DB)) return;
    }
  }
  function saveBackups() {
    // 저장 공간이 모자라면 오래된 백업부터 지운다
    while (!writeJSON(local, BACKUP_KEY, BACKUPS) && BACKUPS.length > 1) BACKUPS.pop();
  }

  // ---------------------------------------------------------------- 계정·권한 (app.py와 같은 규칙)
  const ROLES = { viewer: 1, staff: 2, admin: 3 };
  const ROLE_LABELS = { admin: "관리자", staff: "직원", viewer: "조회 전용" };
  const USERNAME_RE = /^[A-Za-z0-9가-힣._-]{2,30}$/;

  function validatePassword(pw, username) {
    if (pw.length < 8) return "비밀번호는 8자 이상이어야 합니다.";
    if (pw.length > 128) return "비밀번호는 128자 이하여야 합니다.";
    if (username && pw.toLowerCase() === username.toLowerCase()) return "아이디와 같은 비밀번호는 쓸 수 없습니다.";
    return null;
  }
  const validateUsername = u => USERNAME_RE.test(u) ? null : "아이디는 2~30자의 한글·영문·숫자와 . _ - 만 쓸 수 있습니다.";
  const userLabel = u => u ? (u.display_name || u.username) : "";
  const userPublic = u => ({ id: u.id, username: u.username, display_name: u.display_name || "", name: userLabel(u),
    role: u.role, role_label: ROLE_LABELS[u.role] || "", active: !!u.active,
    last_login_at: u.last_login_at || "", created_at: u.created_at || "" });

  function readSession() { return readJSON(sessionStore, SESSION_KEY) || readJSON(local, SESSION_KEY); }
  function startSession(u, remember) {
    clearSession();
    writeJSON(remember ? local : sessionStore, SESSION_KEY, { uid: u.id, sv: u.session_version });
  }
  function clearSession() {
    for (const s of [local, sessionStore]) { try { s && s.removeItem(SESSION_KEY); } catch (_e) { /* 무시 */ } }
    delete memory[SESSION_KEY];
  }
  function currentUser() {
    const s = readSession();
    if (!s) return null;
    const u = DB.users.find(x => x.id === s.uid);
    return u && u.active && u.session_version === s.sv ? u : null;
  }

  // ---------------------------------------------------------------- 응답
  const json = (status, body) => ({ status, body });
  const err = (status, message, extra) => json(status, Object.assign({ error: message }, extra || {}));

  // ---------------------------------------------------------------- 매출·지출 내역
  const FIELDS = {
    incomes: ["trx_date", "income_type", "category", "manufacturer", "product_model", "client", "currency",
      "exchange_rate", "quantity", "unit_price", "amount", "vat", "net_amount", "account", "payment_type",
      "tax_invoice", "memo", "receivable"],
    expenses: ["trx_date", "expense_type", "item", "payment_type", "client", "currency", "exchange_rate",
      "quantity", "unit_price", "amount", "memo", "payable"],
  };
  const REQUIRED = { incomes: ["trx_date", "income_type", "amount"], expenses: ["trx_date", "expense_type", "amount"] };
  const NUMERIC = ["exchange_rate", "quantity", "unit_price", "amount", "vat", "net_amount", "receivable", "payable"];
  const INTEGER = ["amount", "vat", "net_amount", "receivable", "payable"];
  const FIELD_LABELS = { trx_date: "영업일자", income_type: "매출유형", expense_type: "지출유형", amount: "금액" };
  const TYPE_FIELD = { incomes: "income_type", expenses: "expense_type" };
  const BALANCE_FIELD = { incomes: "receivable", expenses: "payable" };
  const BALANCE_LABEL = { incomes: "미수금", expenses: "미지급금" };
  const SEARCH_FIELDS = {
    incomes: ["client", "memo", "product_model", "category", "manufacturer", "income_type", "account"],
    expenses: ["client", "memo", "item", "expense_type"],
  };

  function validDate(s) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || "").trim());
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  }

  /** app.py _clean_entry와 같은 검증. [data, 오류문구] */
  function cleanEntry(raw, table, clampBalance) {
    const data = {};
    for (const f of FIELDS[table]) if (f in raw) data[f] = raw[f];
    for (const f of REQUIRED[table]) if (!data[f]) return [null, `${FIELD_LABELS[f] || f} 값이 필요합니다.`];
    const d = validDate(data.trx_date);
    if (!d) return [null, "영업일자는 YYYY-MM-DD 형식이어야 합니다."];
    data.trx_date = d;
    for (const f of NUMERIC) {
      if (!(f in data)) continue;
      if (data[f] === null || data[f] === "") { delete data[f]; continue; }
      const v = Number(data[f]);
      if (typeof data[f] === "boolean" || !isFinite(v)) return [null, `'${f}' 값이 숫자가 아닙니다.`];
      if (Math.abs(v) > MAX_NUMBER) return [null, `'${f}' 값이 너무 큽니다.`];
      data[f] = INTEGER.includes(f) ? roundHalfUp(v) : v;
    }
    for (const f of REQUIRED[table]) if (NUMERIC.includes(f) && !data[f]) return [null, `${FIELD_LABELS[f] || f} 값이 필요합니다.`];
    for (const f of FIELDS[table]) {
      if (f in data && !NUMERIC.includes(f)) data[f] = String(data[f] ?? "").trim().slice(0, 500);
    }
    if ("tax_invoice" in data) data.tax_invoice = data.tax_invoice.toUpperCase() === "Y" ? "Y" : "N";
    if ("currency" in data) data.currency = data.currency.toUpperCase() || "KRW";
    const bal = BALANCE_FIELD[table];
    if (bal in data && clampBalance) data[bal] = Math.min(Math.max(data[bal], 0), Math.max(data.amount || 0, 0));
    if (bal in data) {
      if (data[bal] < 0) return [null, `${BALANCE_LABEL[table]}은 0 이상이어야 합니다.`];
      if (data[bal] > Math.max(data.amount || 0, 0)) return [null, `${BALANCE_LABEL[table]}은 금액보다 클 수 없습니다.`];
    }
    return [data, null];
  }

  /** app.py _entry_filters와 같은 조건. 행 → true/false */
  function entryFilter(table, q) {
    const tests = [];
    if (q.get("date")) tests.push(r => r.trx_date === q.get("date"));
    if (q.get("from")) tests.push(r => r.trx_date >= q.get("from"));
    if (q.get("to")) tests.push(r => r.trx_date <= q.get("to"));
    if (q.get("type")) tests.push(r => r[TYPE_FIELD[table]] === q.get("type"));
    if (q.get("payment")) tests.push(r => r.payment_type === q.get("payment"));
    if (["1", "true"].includes(q.get("outstanding"))) tests.push(r => (r[BALANCE_FIELD[table]] || 0) > 0);
    for (const word of (q.get("q") || "").split(/\s+/).filter(Boolean).slice(0, 5)) {
      const lw = word.toLowerCase();
      const digits = word.replace(/,/g, "");
      const asNum = /^-?\d+$/.test(digits) ? parseInt(digits, 10) : null;
      tests.push(r => SEARCH_FIELDS[table].some(f => String(r[f] || "").toLowerCase().includes(lw)) ||
        (asNum !== null && r.amount === asNum));
    }
    return r => tests.every(t => t(r));
  }

  const withWeekday = r => Object.assign({}, r, { weekday: weekdayOf(r.trx_date) });
  const byDateDesc = (a, b) => (a.trx_date === b.trx_date ? b.id - a.id : a.trx_date < b.trx_date ? 1 : -1);
  const byDateAsc = (a, b) => (a.trx_date === b.trx_date ? a.id - b.id : a.trx_date < b.trx_date ? -1 : 1);
  const sum = (rows, f) => rows.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  const intArg = (q, name, def, lo, hi) => {
    const v = parseInt(q.get(name) ?? def, 10);
    return isNaN(v) ? def : Math.min(Math.max(v, lo), hi);
  };

  function listEntries(table, q) {
    const rows = DB[table].filter(entryFilter(table, q)).sort(byDateDesc);
    const size = intArg(q, "size", 50, 1, 1000);
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const page = Math.min(intArg(q, "page", 1, 1, 1e6), pages);
    const s = { amount: sum(rows, r => r.amount), balance: sum(rows, r => r[BALANCE_FIELD[table]]) };
    if (table === "incomes") s.vat = sum(rows, r => r.vat);
    return json(200, { items: rows.slice((page - 1) * size, page * size).map(withWeekday), total: rows.length,
      page, size, pages, sum: s });
  }

  function saveEntry(table, body, id) {
    const [data, e] = cleanEntry(body, table, false);
    if (e) return err(400, e);
    const who = userLabel(currentUser());
    if (id === undefined) {
      const row = Object.assign({}, table === "incomes" ? INCOME_DEFAULTS : EXPENSE_DEFAULTS, data,
        { id: ++DB.seq[table], created_by: who, created_at: nowStr() });
      if (table === "incomes" && !("net_amount" in data)) row.net_amount = row.amount - row.vat;
      DB[table].push(row);
      saveDB();
      return json(201, withWeekday(row));
    }
    const row = DB[table].find(r => r.id === id);
    if (!row) return err(404, "해당 내역이 없습니다.");
    Object.assign(row, data, { updated_by: who, updated_at: nowStr() });
    saveDB();
    return json(200, withWeekday(row));
  }

  // ---------------------------------------------------------------- 통계 (app.py _range_stats와 같은 계산)
  const r1 = v => Math.round(v * 10) / 10;
  function rangeStats(from, to, keyFn, label) {
    const inc = DB.incomes.filter(r => r.trx_date >= from && r.trx_date <= to);
    const exp = DB.expenses.filter(r => r.trx_date >= from && r.trx_date <= to);
    const income = sum(inc, r => r.amount), expense = sum(exp, r => r.amount);
    const card = sum(inc.filter(r => r.payment_type === "카드"), r => r.amount);
    const cost = sum(exp.filter(r => r.expense_type === "제품원가"), r => r.amount);
    const days = new Set(inc.map(r => r.trx_date)).size;
    const series = {};
    for (const r of inc) (series[keyFn(r.trx_date)] = series[keyFn(r.trx_date)] || { income: 0, expense: 0 }).income += r.amount;
    for (const r of exp) (series[keyFn(r.trx_date)] = series[keyFn(r.trx_date)] || { income: 0, expense: 0 }).expense += r.amount;
    const breakdown = (rows, nameFn, limit) => {
      const m = {};
      for (const r of rows) {
        const n = nameFn(r);
        (m[n] = m[n] || { name: n, value: 0, cnt: 0 });
        m[n].value += r.amount; m[n].cnt += 1;
      }
      const list = Object.values(m).sort((a, b) => b.value - a.value);
      return limit ? list.slice(0, limit) : list;
    };
    return {
      from, to, group: label,
      totals: {
        income, expense, profit: income - expense, vat: sum(inc, r => r.vat), net_income: sum(inc, r => r.net_amount),
        cash_income: income - card,  // 카드 외 결제는 모두 현금매출(엑셀과 같음)
        card_income: card, cost_expense: cost, income_count: inc.length, expense_count: exp.length,
        business_days: days, avg_daily_income: days ? Math.round(income / days) : 0,
        expense_ratio: income ? r1(expense / income * 100) : 0, cost_ratio: income ? r1(cost / income * 100) : 0,
      },
      series: Object.keys(series).sort().map(k => ({ key: k, income: series[k].income, expense: series[k].expense,
        profit: series[k].income - series[k].expense })),
      income_by_category: breakdown(inc, r => r.category || "(미분류)"),
      expense_by_type: breakdown(exp, r => r.expense_type || "(미분류)"),
      top_clients: breakdown(inc, r => r.client || "(미지정)", 10),
    };
  }
  const byDay = s => s, byMonth = s => s.slice(0, 7);
  function monthRange(y, m) {
    const last = new Date(y, m, 0).getDate();
    return [`${y}-${pad2(m)}-01`, `${y}-${pad2(m)}-${pad2(last)}`];
  }
  const yearOk = y => Number.isInteger(y) && y >= 1900 && y <= 2999;

  function outstanding() {
    const inc = DB.incomes.filter(r => r.receivable > 0), exp = DB.expenses.filter(r => r.payable > 0);
    return { receivable: sum(inc, r => r.receivable), receivable_count: inc.length,
      payable: sum(exp, r => r.payable), payable_count: exp.length };
  }

  function monthlyRows(incRows, expRows) {
    const months = {};
    const slot = m => (months[m] = months[m] || { month: m, income_count: 0, income: 0, vat: 0, net_income: 0,
      receivable: 0, expense_count: 0, expense: 0, payable: 0 });
    for (const r of incRows || []) {
      const s = slot(r.trx_date.slice(0, 7));
      s.income_count++; s.income += r.amount; s.vat += r.vat; s.net_income += r.net_amount; s.receivable += r.receivable;
    }
    for (const r of expRows || []) {
      const s = slot(r.trx_date.slice(0, 7));
      s.expense_count++; s.expense += r.amount; s.payable += r.payable;
    }
    return Object.keys(months).sort().map(k => Object.assign(months[k], { profit: months[k].income - months[k].expense }));
  }

  // ---------------------------------------------------------------- 엑셀 내보내기 (exporter.py와 같은 시트 구성)
  const INCOME_COLUMNS = [["영업일자", "trx_date", "date", 12], ["요일", "weekday", "text", 6], ["매출유형", "income_type", "text", 11],
    ["매출구분", "category", "text", 14], ["차량제조사", "manufacturer", "text", 11], ["제품모델", "product_model", "text", 14],
    ["거래처명", "client", "text", 20], ["거래통화", "currency", "text", 9], ["기준환율", "exchange_rate", "rate", 10],
    ["수량", "quantity", "qty", 7], ["단가", "unit_price", "price", 12], ["매출액", "amount", "won", 13], ["부가세", "vat", "won", 11],
    ["순매출액", "net_amount", "won", 13], ["결제유형", "payment_type", "text", 10], ["세금계산서발행유무", "tax_invoice", "text", 11],
    ["계좌", "account", "text", 20], ["미수금", "receivable", "won", 12], ["적요", "memo", "text", 36]];
  const EXPENSE_COLUMNS = [["영업일자", "trx_date", "date", 12], ["요일", "weekday", "text", 6], ["지출유형", "expense_type", "text", 11],
    ["거래품목", "item", "text", 14], ["결제유형", "payment_type", "text", 10], ["거래처명", "client", "text", 20],
    ["거래통화", "currency", "text", 9], ["기준환율", "exchange_rate", "rate", 10], ["수량", "quantity", "qty", 7],
    ["단가", "unit_price", "price", 12], ["지출금액", "amount", "won", 13], ["미지급금", "payable", "won", 12], ["적요", "memo", "text", 36]];

  function exportWorkbook(q, who) {
    const W = window.WellcarXlsxWriter, S = W.S;
    const kind = q.get("kind") || "all";
    if (!["all", "incomes", "expenses"].includes(kind)) return err(400, "kind는 all, incomes, expenses 중 하나여야 합니다.");
    for (const k of ["from", "to"]) if (q.get(k) && !validDate(q.get(k))) return err(400, "기간은 YYYY-MM-DD 형식이어야 합니다.");
    const incOn = kind !== "expenses", expOn = kind !== "incomes";
    const inc = incOn ? DB.incomes.filter(entryFilter("incomes", q)).sort(byDateAsc) : null;
    const exp = expOn ? DB.expenses.filter(entryFilter("expenses", q)).sort(byDateAsc) : null;
    const monthly = monthlyRows(inc, exp);
    const tot = k => monthly.reduce((a, m) => a + m[k], 0);
    const from = q.get("from") || "", to = q.get("to") || "";
    const period = from || to ? `${from || "처음"} ~ ${to || "오늘까지"}` : "전체 기간";
    const conds = [];
    if (q.get("q")) conds.push(`검색어 '${q.get("q")}'`);
    if (q.get("type")) conds.push(`유형 '${q.get("type")}'`);
    if (q.get("payment")) conds.push(`결제유형 '${q.get("payment")}'`);
    if (["1", "true"].includes(q.get("outstanding"))) conds.push("미수·미지급 남은 건만");
    const title = { all: "매출/지출", incomes: "매출", expenses: "지출" }[kind];
    const label = { all: "매출지출", incomes: "매출", expenses: "지출" }[kind];

    // 요약
    const summary = [[{ v: `웰카오디오 ${title} 내역`, s: S.title }]];
    for (const [l, v] of [["조회 기간", period], ["조건", conds.join(", ")], ["내보낸 시각", nowStr().slice(0, 16)], ["내보낸 사람", who]])
      if (v) summary.push([{ v: l, s: S.muted }, v]);
    summary.push([]);
    summary.push(["항목", "금액(원)", "건수"].map(v => ({ v, s: S.head })));
    const line = (l, amount, count) => summary.push([{ v: l, s: S.bold }, { v: amount, s: S.won },
      count === null ? null : { v: count, s: S.won }]);
    if (incOn) {
      line("매출액 합계", tot("income"), tot("income_count"));
      line("부가세", tot("vat"), null);
      line("순매출액", tot("net_income"), null);
      line("미수금 잔액", tot("receivable"), inc.filter(r => r.receivable > 0).length);
    }
    if (expOn) {
      line("지출금액 합계", tot("expense"), tot("expense_count"));
      line("미지급금 잔액", tot("payable"), exp.filter(r => r.payable > 0).length);
    }
    if (incOn && expOn) line("영업이익 (매출 − 지출)", tot("income") - tot("expense"), null);
    summary.push([]);
    summary.push([{ v: "※ '매출내역'·'지출내역' 시트는 이 시스템의 [데이터 관리 → 엑셀 가져오기]로 다시 불러올 수 있습니다(이미 있는 내역은 자동으로 건너뜀).", s: S.muted }]);

    // 월별손익 ('영업월' 머리글: 다시 가져올 때 월 합계 대조에 쓰임)
    const mcols = [["영업월", "month", 10]];
    if (incOn) mcols.push(["매출 건수", "income_count", 9], ["매출액", "income", 14], ["부가세", "vat", 12], ["순매출액", "net_income", 14], ["미수금", "receivable", 12]);
    if (expOn) mcols.push(["지출 건수", "expense_count", 9], ["지출금액", "expense", 14], ["미지급금", "payable", 12]);
    if (incOn && expOn) mcols.push(["영업이익", "profit", 14]);
    const mrows = [mcols.map(c => ({ v: c[0], s: S.head }))];
    for (const m of monthly) mrows.push(mcols.map((c, i) => i ? { v: m[c[1]], s: S.won } : m.month));
    if (monthly.length) mrows.push(mcols.map((c, i) => i ? { v: tot(c[1]), s: S.totalNum } : { v: "합계", s: S.totalLabel }));

    const detail = (cols, rows) => {
      const out = [cols.map(c => ({ v: c[0], s: S.head }))];
      for (const r of rows) {
        out.push(cols.map(([, f, k]) => {
          const v = f === "weekday" ? weekdayOf(r.trx_date) : r[f];
          if (k === "date") return { v, t: "d", s: S.date };
          if (k === "won") return { v: Number(v) || 0, s: S.won };
          if (k === "rate") return { v: Number(v) || 1, s: S.dec };
          if (k === "qty") return { v: Number(v) || 0, s: Number.isInteger(Number(v)) ? S.won : S.dec };
          if (k === "price") return { v: Number(v) || 0, s: (r.currency || "KRW") === "KRW" && Number.isInteger(Number(v)) ? S.won : S.dec };
          return v === null || v === undefined ? "" : String(v);
        }));
      }
      return out;
    };
    const sheets = [
      { name: "요약", widths: [22, 20, 10], rows: summary },
      { name: "월별손익", widths: mcols.map(c => c[2]), freeze: "B2", rows: mrows },
    ];
    if (incOn) sheets.push({ name: "매출내역", widths: INCOME_COLUMNS.map(c => c[3]), freeze: "B2", autoFilter: true, rows: detail(INCOME_COLUMNS, inc) });
    if (expOn) sheets.push({ name: "지출내역", widths: EXPENSE_COLUMNS.map(c => c[3]), freeze: "B2", autoFilter: true, rows: detail(EXPENSE_COLUMNS, exp) });
    const span = from || to ? `${from || "처음"}_${to || "현재"}` : "전체";
    return { file: W.build(sheets), filename: `웰카오디오_${label}_${span}.xlsx`,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }

  // ---------------------------------------------------------------- 백업 (데모: 이 브라우저 안 스냅숏)
  const KIND_LABELS = { auto: "자동", manual: "수동", "pre-import": "가져오기 직전", "pre-restore": "복원 직전", upload: "업로드" };
  const KEEP = { auto: 3, manual: 3, "pre-import": 2, "pre-restore": 2, upload: 2 };  // 브라우저 저장 공간이 작아 실제(30·10개)보다 적게
  const backupItem = b => ({ name: b.name, kind: b.kind, kind_label: KIND_LABELS[b.kind], created_at: b.created_at, seq: b.seq, size: b.size });
  function snapshot() { return { incomes: DB.incomes, expenses: DB.expenses, codes: DB.codes }; }

  function createBackup(kind, protect) {
    const created = nowStr();
    const stamp = created.replace(/[-:]/g, "").replace(" ", "-");
    const sameSecond = BACKUPS.filter(b => b.created_at === created).map(b => b.seq);
    const seq = (sameSecond.length ? Math.max(...sameSecond) : 0) + 1;
    const name = `wellcar-${stamp}${seq > 1 ? "-" + seq : ""}-${kind}.json`;
    const data = JSON.parse(JSON.stringify(snapshot()));
    const size = JSON.stringify(data).length;
    BACKUPS.unshift({ name, kind, created_at: created, seq, size, data });
    // 종류별 보관 개수 정리 (복원하려는 파일은 지우지 않음)
    const seen = {};
    BACKUPS = BACKUPS.filter(b => {
      seen[b.kind] = (seen[b.kind] || 0) + 1;
      return seen[b.kind] <= KEEP[b.kind] || (protect && protect.has(b.name));
    });
    saveBackups();
    return backupItem(BACKUPS.find(b => b.name === name) || { name, kind, created_at: created, seq, size });
  }
  function hasData() { return DB.incomes.length > 0 || DB.expenses.length > 0; }
  function maybeAutoBackup() {
    const last = BACKUPS.find(b => b.kind === "auto");
    if (last && Date.now() - new Date(last.created_at.replace(" ", "T")).getTime() < 24 * 3600 * 1000) return;
    if (hasData()) createBackup("auto");
  }
  function restoreFrom(data) {
    if (!data || !Array.isArray(data.incomes) || !Array.isArray(data.expenses))
      throw new Error("매출/지출 내역이 없는 파일입니다. 이 데모에서 받은 백업 파일인지 확인하세요.");
    DB.incomes = data.incomes.map(r => Object.assign({}, INCOME_DEFAULTS, r));
    DB.expenses = data.expenses.map(r => Object.assign({}, EXPENSE_DEFAULTS, r));
    if (Array.isArray(data.codes) && data.codes.length) DB.codes = data.codes;
    for (const t of ["incomes", "expenses", "codes"])
      DB.seq[t] = Math.max(DB.seq[t], ...DB[t].map(r => Number(r.id) || 0), 0);
    saveDB();
    return { incomes: DB.incomes.length, expenses: DB.expenses.length, codes: DB.codes.length };
  }

  // ---------------------------------------------------------------- 엑셀 가져오기 (app.py _plan_import와 같은 중복 판정)
  const IMPORT_KEYS = { incomes: ["trx_date", "income_type", "category", "client", "amount", "vat", "memo"],
    expenses: ["trx_date", "expense_type", "item", "client", "amount", "memo"] };
  const PAYABLE_NOTE_RE = /\s*\[미지급금 [^\]]*\]$/;
  const dedupeKey = (r, fields) => fields.map(f => f === "amount" || f === "vat" ? roundHalfUp(r[f] || 0)
    : f === "memo" ? String(r[f] || "").replace(PAYABLE_NOTE_RE, "") : String(r[f] || "")).join("\u0001");

  function planImport(table, rows, res, invalid) {
    const valid = [];
    for (const r of rows) {
      if (!r || typeof r !== "object" || Array.isArray(r)) { res[table + "_invalid"]++; continue; }
      let [data, e] = cleanEntry(r, table, true);
      if (!e && !data.amount) e = "금액이 0입니다.";
      if (e) {
        res[table + "_invalid"]++;
        if (invalid.length < 200) invalid.push({ kind: table, src: String(r.src || "").slice(0, 80), reason: e });
        continue;
      }
      const full = Object.assign({}, table === "incomes" ? INCOME_DEFAULTS : EXPENSE_DEFAULTS, data);
      if (table === "incomes" && !("net_amount" in data)) full.net_amount = full.amount - full.vat;
      valid.push(full);
    }
    const counts = new Map();
    for (const r of DB[table]) { const k = dedupeKey(r, IMPORT_KEYS[table]); counts.set(k, (counts.get(k) || 0) + 1); }
    const plan = [];
    for (const d of valid) {
      const k = dedupeKey(d, IMPORT_KEYS[table]);
      if ((counts.get(k) || 0) > 0) { counts.set(k, counts.get(k) - 1); res[table + "_skipped"]++; }
      else plan.push(d);
    }
    return [plan, valid];
  }

  function autoAddCodes(incomes, expenses, res) {
    const wanted = new Map();
    const want = (g, v, p) => { if (v) wanted.set(`${g}\u0001${v}\u0001${p}`, [g, v, p]); };
    const text = (r, f) => String(r[f] ?? "").trim();
    for (const r of incomes) {
      const it = text(r, "income_type");
      if (it) { want("income_type", it, ""); want("income_category", text(r, "category"), it); }
      for (const g of ["payment_type", "account", "manufacturer", "client", "currency"]) want(g, text(r, g), "");
    }
    for (const r of expenses) {
      const et = text(r, "expense_type");
      if (et) { want("expense_type", et, ""); want("expense_item", text(r, "item"), et); }
      for (const g of ["payment_type", "client", "currency"]) want(g, text(r, g), "");
    }
    for (const [g, v, p] of [...wanted.values()].sort()) {
      if (DB.codes.some(c => c.code_group === g && c.code_value === v && c.parent_value === p)) continue;
      const order = DB.codes.filter(c => c.code_group === g && c.parent_value === p).length;
      DB.codes.push({ id: ++DB.seq.codes, code_group: g, code_value: v, parent_value: p, sort_order: order });
      res.codes_added++;
    }
  }

  // ---------------------------------------------------------------- 라우팅
  const PUBLIC = new Set(["/api/auth/state", "/api/auth/login", "/api/auth/setup"]);
  const SELF_SERVICE = new Set(["/api/auth/logout", "/api/auth/password"]);

  async function handle(method, path, q, body, rawBody) {
    if (!PUBLIC.has(path)) {
      const me = currentUser();
      if (!me) return err(401, "로그인이 필요합니다.", { auth: "login" });
      if (method !== "GET" && !SELF_SERVICE.has(path) && ROLES[me.role] < ROLES.staff)
        return err(403, "조회 전용 계정은 내용을 바꿀 수 없습니다.");
      maybeAutoBackup();
    }
    const me = currentUser();
    const needAdmin = () => (ROLES[me.role] < ROLES.admin ? err(403, "관리자 권한이 필요한 기능입니다.") : null);

    // 인증
    if (path === "/api/auth/state") return json(200, { setup_required: !DB.users.length, user: me ? userPublic(me) : null });
    if (path === "/api/auth/login" && method === "POST") {
      const username = String(body.username || "").trim(), password = String(body.password || "");
      const u = DB.users.find(x => x.username.toLowerCase() === username.toLowerCase());
      if (!u || u.password_hash !== await hashPassword(password)) return err(401, "아이디 또는 비밀번호가 맞지 않습니다.");
      if (!u.active) return err(403, "사용이 중지된 계정입니다. 관리자에게 문의하세요.");
      u.last_login_at = nowStr();
      saveDB();
      startSession(u, !!body.remember);
      return json(200, { user: userPublic(u) });
    }
    if (path === "/api/auth/setup") return err(409, "이미 관리자 계정이 있습니다. 로그인하세요.");
    if (path === "/api/auth/logout" && method === "POST") { clearSession(); return json(200, { ok: true }); }
    if (path === "/api/auth/password" && method === "POST") {
      if (me.password_hash !== await hashPassword(String(body.current_password || ""))) return err(403, "현재 비밀번호가 맞지 않습니다.");
      const pw = String(body.new_password || "");
      const e = validatePassword(pw, me.username);
      if (e) return err(400, e);
      me.password_hash = await hashPassword(pw);
      me.session_version += 1;
      saveDB();
      startSession(me, !!readJSON(local, SESSION_KEY));
      return json(200, { ok: true });
    }

    // 사용자관리
    if (path === "/api/users") {
      const deny = needAdmin(); if (deny) return deny;
      if (method === "GET") {
        const order = [...DB.users].sort((a, b) => (b.active - a.active) || ((b.role === "admin") - (a.role === "admin")) || a.id - b.id);
        return json(200, order.map(userPublic));
      }
      const username = String(body.username || "").trim(), password = String(body.password || "");
      const role = body.role || "staff";
      if (typeof role !== "string" || !ROLES[role]) return err(400, "권한 값이 올바르지 않습니다.");
      const e = validateUsername(username) || validatePassword(password, username);
      if (e) return err(400, e);
      if (DB.users.some(x => x.username.toLowerCase() === username.toLowerCase())) return err(409, "이미 있는 아이디입니다.");
      const u = { id: ++DB.seq.users, username, display_name: String(body.display_name || "").trim().slice(0, 30),
        password_hash: await hashPassword(password), role, active: 1, session_version: 1, last_login_at: "", created_at: nowStr() };
      DB.users.push(u);
      saveDB();
      return json(201, userPublic(u));
    }
    let m = /^\/api\/users\/(\d+)$/.exec(path);
    if (m) {
      const deny = needAdmin(); if (deny) return deny;
      const u = DB.users.find(x => x.id === +m[1]);
      if (!u) return err(404, "해당 사용자가 없습니다.");
      const otherAdmins = DB.users.filter(x => x.role === "admin" && x.active && x.id !== u.id).length;
      if (method === "DELETE") {
        if (u.id === me.id) return err(400, "본인 계정은 삭제할 수 없습니다.");
        if (u.role === "admin" && u.active && !otherAdmins) return err(400, "관리자가 최소 한 명은 있어야 합니다.");
        DB.users = DB.users.filter(x => x.id !== u.id);
        saveDB();
        return json(200, { ok: true });
      }
      const role = "role" in body ? body.role : u.role;
      const active = "active" in body ? body.active : !!u.active;
      if (typeof role !== "string" || !ROLES[role]) return err(400, "권한 값이 올바르지 않습니다.");
      if (typeof active !== "boolean") return err(400, "사용 여부 값이 올바르지 않습니다.");
      if (u.id === me.id && (role !== u.role || !active)) return err(400, "본인 계정의 권한과 사용 여부는 바꿀 수 없습니다.");
      if (u.role === "admin" && u.active && (role !== "admin" || !active) && !otherAdmins)
        return err(400, "관리자가 최소 한 명은 있어야 합니다.");
      if (body.password) {
        const e = validatePassword(String(body.password), u.username);
        if (e) return err(400, e);
        u.password_hash = await hashPassword(String(body.password));
      }
      if (body.password || (u.active && !active)) u.session_version += 1;
      if ("display_name" in body) u.display_name = String(body.display_name || "").trim().slice(0, 30);
      u.role = role;
      u.active = active ? 1 : 0;
      saveDB();
      return json(200, userPublic(u));
    }

    // 매출·지출 내역
    for (const table of ["incomes", "expenses"]) {
      if (path === `/api/${table}`) return method === "GET" ? listEntries(table, q) : saveEntry(table, body);
      m = new RegExp(`^/api/${table}/(\\d+)(/settle)?$`).exec(path);
      if (!m) continue;
      const id = +m[1];
      const row = DB[table].find(r => r.id === id);
      if (m[2]) {
        if (!row) return err(404, "해당 내역이 없습니다.");
        row[BALANCE_FIELD[table]] = 0;
        Object.assign(row, { updated_by: userLabel(me), updated_at: nowStr() });
        saveDB();
        return json(200, withWeekday(row));
      }
      if (method === "GET") return row ? json(200, withWeekday(row)) : err(404, "해당 내역이 없습니다.");
      if (method === "PUT") return saveEntry(table, body, id);
      if (method === "DELETE") {
        if (!row) return err(404, "해당 내역이 없습니다.");
        DB[table] = DB[table].filter(r => r.id !== id);
        saveDB();
        return json(200, { ok: true });
      }
    }

    if (path === "/api/receivables") {
      const out = {};
      for (const table of ["incomes", "expenses"]) {
        const bal = BALANCE_FIELD[table];
        const rows = DB[table].filter(r => r[bal] > 0);
        const by = {};
        for (const r of rows) {
          const n = r.client || "(미지정)";
          const s = (by[n] = by[n] || { name: n, value: 0, cnt: 0, oldest: r.trx_date });
          s.value += r[bal]; s.cnt += 1; if (r.trx_date < s.oldest) s.oldest = r.trx_date;
        }
        out[table] = { total: sum(rows, r => r[bal]), count: rows.length,
          by_client: Object.values(by).sort((a, b) => b.value - a.value),
          items: rows.sort(byDateAsc).slice(0, 500).map(withWeekday) };
      }
      return json(200, out);
    }

    // 코드관리
    if (path === "/api/codes") {
      if (method === "GET") {
        const grouped = {};
        const sorted = [...DB.codes].sort((a, b) => (a.code_group < b.code_group ? -1 : a.code_group > b.code_group ? 1 : 0) ||
          (a.parent_value < b.parent_value ? -1 : a.parent_value > b.parent_value ? 1 : 0) || a.sort_order - b.sort_order || a.id - b.id);
        for (const c of sorted) (grouped[c.code_group] = grouped[c.code_group] || []).push(c);
        return json(200, grouped);
      }
      const deny = needAdmin(); if (deny) return deny;
      const group = String(body.code_group || "").trim(), value = String(body.code_value || "").trim().slice(0, 100);
      const parent = String(body.parent_value || "").trim();
      if (!group || !value) return err(400, "코드그룹과 코드값이 필요합니다.");
      if (DB.codes.some(c => c.code_group === group && c.code_value === value && c.parent_value === parent))
        return err(409, "이미 등록된 코드입니다.");
      const order = DB.codes.filter(c => c.code_group === group && c.parent_value === parent).length;
      const row = { id: ++DB.seq.codes, code_group: group, code_value: value, parent_value: parent, sort_order: order };
      DB.codes.push(row);
      saveDB();
      return json(201, row);
    }
    m = /^\/api\/codes\/(\d+)$/.exec(path);
    if (m && method === "DELETE") {
      const deny = needAdmin(); if (deny) return deny;
      if (!DB.codes.some(c => c.id === +m[1])) return err(404, "해당 코드가 없습니다.");
      DB.codes = DB.codes.filter(c => c.id !== +m[1]);
      saveDB();
      return json(200, { ok: true });
    }

    // 통계
    if (path === "/api/stats/daily") {
      const d = validDate(q.get("date"));
      if (!d || d !== q.get("date")) return err(400, "date=YYYY-MM-DD 형식으로 요청하세요.");
      const day = new Date(d + "T00:00:00");
      const prev = new Date(day); prev.setDate(day.getDate() - 1);
      const recent = new Date(day); recent.setDate(day.getDate() - 13);
      const [mf, mt] = monthRange(day.getFullYear(), day.getMonth() + 1);
      return json(200, { date: d, weekday: weekdayOf(d), day: rangeStats(d, d, byDay, "day"),
        prev_day: rangeStats(isoOf(prev), isoOf(prev), byDay, "day"), month: rangeStats(mf, mt, byDay, "day"),
        recent_series: rangeStats(isoOf(recent), d, byDay, "day").series, recent_from: isoOf(recent),
        outstanding: outstanding() });
    }
    if (path === "/api/stats/monthly") {
      const y = Number(q.get("year")), mo = Number(q.get("month"));
      if (!yearOk(y) || !Number.isInteger(mo) || mo < 1 || mo > 12) return err(400, "year, month 파라미터가 필요합니다.");
      const [f, t] = monthRange(y, mo);
      const stats = rangeStats(f, t, byDay, "day");
      const [py, pm] = mo === 1 ? [y - 1, 12] : [y, mo - 1];
      const [pf, pt] = monthRange(py, pm);
      stats.prev_totals = rangeStats(pf, pt, byDay, "day").totals;
      return json(200, stats);
    }
    if (path === "/api/stats/quarterly") {
      const y = Number(q.get("year")), qt = Number(q.get("quarter"));
      if (!yearOk(y) || !Number.isInteger(qt) || qt < 1 || qt > 4) return err(400, "year, quarter 파라미터가 필요합니다.");
      const m1 = (qt - 1) * 3 + 1;
      const stats = rangeStats(monthRange(y, m1)[0], monthRange(y, m1 + 2)[1], byMonth, "month");
      const [py, pq] = qt === 1 ? [y - 1, 4] : [y, qt - 1];
      const pm1 = (pq - 1) * 3 + 1;
      stats.prev_totals = rangeStats(monthRange(py, pm1)[0], monthRange(py, pm1 + 2)[1], byMonth, "month").totals;
      return json(200, stats);
    }
    if (path === "/api/stats/yearly") {
      const y = Number(q.get("year"));
      if (!yearOk(y)) return err(400, "year 파라미터가 필요합니다.");
      const stats = rangeStats(`${y}-01-01`, `${y}-12-31`, byMonth, "month");
      stats.prev_totals = rangeStats(`${y - 1}-01-01`, `${y - 1}-12-31`, byMonth, "month").totals;
      return json(200, stats);
    }
    if (path === "/api/stats/months") {
      const range = new URLSearchParams();
      for (const k of ["from", "to"]) if (q.get(k)) range.set(k, q.get(k));
      return json(200, monthlyRows(DB.incomes.filter(entryFilter("incomes", range)), DB.expenses.filter(entryFilter("expenses", range))));
    }

    // 내보내기
    if (path === "/api/export.xlsx") return exportWorkbook(q, userLabel(me));

    // 백업·복원
    if (path.startsWith("/api/backups")) {
      const deny = needAdmin(); if (deny) return deny;
      if (path === "/api/backups" && method === "GET") {
        const last = BACKUPS.find(b => b.kind === "auto");
        return json(200, { dir: "이 브라우저 저장소 (데모)", interval_hours: 24, keep: KEEP,
          last_auto: last ? last.created_at : "", items: BACKUPS.map(backupItem) });
      }
      if (path === "/api/backups" && method === "POST") return json(201, createBackup("manual"));
      if (path === "/api/backups/upload" && method === "POST") {
        const file = rawBody instanceof FormData ? rawBody.get("file") : null;
        if (!file) return err(400, "백업 파일을 선택하세요.");
        let data;
        try { data = JSON.parse(await file.text()); } catch (_e) { return err(400, "이 데모에서 받은 백업 파일(.json)이 아닙니다."); }
        if (!data || !Array.isArray(data.incomes) || !Array.isArray(data.expenses))
          return err(400, "매출/지출 내역이 없는 파일입니다. 이 데모에서 받은 백업 파일인지 확인하세요.");
        const created = nowStr();
        const name = `wellcar-${created.replace(/[-:]/g, "").replace(" ", "-")}-upload.json`;
        BACKUPS.unshift({ name, kind: "upload", created_at: created, seq: 1, size: JSON.stringify(data).length,
          data: { incomes: data.incomes, expenses: data.expenses, codes: data.codes || [] } });
        saveBackups();
        return json(201, backupItem(BACKUPS[0]));
      }
      m = /^\/api\/backups\/([^/]+)(\/download|\/restore)?$/.exec(path);
      const name = m ? decodeURIComponent(m[1]) : "";
      const b = BACKUPS.find(x => x.name === name);
      if (!b) return err(404, "백업 파일이 없습니다.");
      if (m[2] === "/download") {
        return { file: new Blob([JSON.stringify(b.data)], { type: "application/json" }), filename: b.name, type: "application/json" };
      }
      if (m[2] === "/restore" && method === "POST") {
        const safety = createBackup("pre-restore", new Set([b.name]));
        try {
          const counts = restoreFrom(b.data);
          return json(200, { ok: true, restored: counts, safety_backup: safety.name });
        } catch (e) { return err(400, e.message); }
      }
      if (!m[2] && method === "DELETE") {
        BACKUPS = BACKUPS.filter(x => x.name !== name);
        saveBackups();
        return json(200, { ok: true });
      }
    }

    // 엑셀 가져오기
    if (path === "/api/import-json" && method === "POST") {
      const deny = needAdmin(); if (deny) return deny;
      const incomes = body.incomes || [], expenses = body.expenses || [];
      if (!Array.isArray(incomes) || !Array.isArray(expenses)) return err(400, "incomes, expenses 배열이 필요합니다.");
      if (incomes.length + expenses.length > 50000) return err(400, "한 번에 50,000건까지 가져올 수 있습니다.");
      const res = { incomes_added: 0, incomes_skipped: 0, incomes_invalid: 0, expenses_added: 0, expenses_skipped: 0,
        expenses_invalid: 0, codes_added: 0, backup: "" };
      const invalid = [];
      const [incPlan, incValid] = planImport("incomes", incomes, res, invalid);
      const [expPlan, expValid] = planImport("expenses", expenses, res, invalid);
      if ((incPlan.length || expPlan.length) && hasData()) res.backup = createBackup("pre-import").name;
      const who = `${userLabel(me)} (엑셀)`;
      for (const [table, plan] of [["incomes", incPlan], ["expenses", expPlan]]) {
        for (const d of plan) DB[table].push(Object.assign(d, { id: ++DB.seq[table], created_by: who, created_at: nowStr() }));
        res[table + "_added"] = plan.length;
      }
      autoAddCodes(incValid, expValid, res);
      saveDB();
      res.invalid_samples = invalid;
      return json(200, res);
    }

    if (path === "/api/meta") {
      const years = new Set([String(new Date().getFullYear())]);
      for (const t of ["incomes", "expenses"]) for (const r of DB[t]) years.add(r.trx_date.slice(0, 4));
      return json(200, { years: [...years].sort(), today: isoOf(new Date()) });
    }
    return err(404, "없는 기능입니다.");
  }

  // ---------------------------------------------------------------- fetch 가로채기: /api/* 만 이 안에서 처리
  const realFetch = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!url.startsWith("/api/")) return realFetch ? realFetch(input, init) : Promise.reject(new TypeError("네트워크 없음"));
    await ready;
    init = init || {};
    const u = new URL(url, "https://demo.invalid");
    const method = String(init.method || "GET").toUpperCase();
    let body = {};
    if (typeof init.body === "string") {
      try { const parsed = JSON.parse(init.body); body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
      catch (_e) { body = {}; }
    }
    let out;
    try {
      out = await handle(method, u.pathname, u.searchParams, body, init.body);
    } catch (e) {
      out = err(500, "데모 처리 중 오류가 났습니다: " + (e && e.message ? e.message : e));
    }
    if (out.file) {
      return new Response(out.file, { status: 200, headers: { "Content-Type": out.type,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out.filename)}` } });
    }
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { "Content-Type": "application/json" } });
  };

  // 데모 배너의 '처음 상태로' 버튼에서 쓴다
  window.WellcarDemo = {
    reset() {
      for (const s of [local, sessionStore]) {
        for (const k of [KEY, BACKUP_KEY, SESSION_KEY]) { try { s && s.removeItem(k); } catch (_e) { /* 무시 */ } }
      }
      for (const k of Object.keys(memory)) delete memory[k];
    },
    password: DEMO_PASSWORD,
  };
})();
