/* 데모용 가짜 서버 — 실제 Flask API(/api/*)를 브라우저 안에서 그대로 흉내 낸다.
   app.js는 실제 시스템과 똑같이 fetch("/api/...")를 부르고, 이 파일이 그 요청을 가로채 답한다.
   데이터는 이 브라우저의 localStorage에만 저장된다(못 쓰면 메모리로만 동작).
   규칙·문구·응답 모양은 app.py·exporter.py와 같게 유지한다. 그쪽을 바꾸면 여기도 맞춰 바꿀 것. */
(function () {
  "use strict";

  const KEY = "wellcar_demo_v3";
  const BACKUP_KEY = "wellcar_demo_v3_backups";
  const SESSION_KEY = "wellcar_demo_v3_session";
  const OLD_KEYS = ["wellcar_demo_v1", "wellcar_demo_v2", "wellcar_demo_v2_backups", "wellcar_demo_v2_session"];
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
  const yearOk = y => Number.isInteger(y) && y >= 1900 && y <= 2999;
  const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000;

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
    car_model: {
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
    client: ["개인", "방문", "해덕", "동서카오디오(대구)", "재즈카오디오(광주)", "재즈카오디오(대구)", "현대카오디오(서울)", "수원테크(수원)", "닥터카오디오(수원)", "써브카오디오(안산)", "오토사운드(논산)", "주문진카오디오(주문진)", "창원카오디오(창원)", "슈퍼그립", "미스터짱카", "11번가", "옥션", "G마켓"],
  };

  const INCOME_DEFAULTS = { category: "", manufacturer: "", car_model: "", product_model: "", client: "", currency: "KRW",
    exchange_rate: 1, quantity: 1, unit_price: 0, vat: 0, net_amount: 0, account: "", payment_type: "",
    tax_invoice: "N", memo: "", receivable: 0, payout: 0, payout_due: 0, source: "", import_key: "",
    created_by: "", updated_by: "", updated_at: "" };
  const EXPENSE_DEFAULTS = { item: "", payment_type: "", client: "", currency: "KRW", exchange_rate: 1,
    quantity: 1, unit_price: 0, memo: "", payable: 0, source: "", import_key: "",
    created_by: "", updated_by: "", updated_at: "" };
  const DEFAULTS = { incomes: INCOME_DEFAULTS, expenses: EXPENSE_DEFAULTS };

  /** seed_demo.py와 같은 모양의 샘플: 작년 1월 1일부터 오늘까지, 올해 월별 목표 */
  function seedEntries(db) {
    const rng = mulberry32(42);
    const pick = arr => arr[Math.floor(rng() * arr.length)];
    const wpick = (arr, w) => {
      let x = rng() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < arr.length; i++) { x -= w[i]; if (x < 0) return arr[i]; }
      return arr[arr.length - 1];
    };
    const SERVICES = ["카오디오수리", "데크수리", "내비게이션수리", "앰프수리", "메카니즘수리", "탈부착"];
    const PRODUCTS = ["카오디오", "앰프", "스피커", "내비게이션", "블랙박스"];
    const MAKERS = ["벤츠", "BMW", "아우디", "폭스바겐", "볼보", "토요타", "현대", "레인지로버"];
    const MAKER_W = [26, 22, 12, 8, 6, 5, 14, 7];
    const UNITS = ["CIC", "NBT", "COMAND", "MMI", "IMC", "Harman", "Burmester"];
    const DEALERS = ["동서카오디오(대구)", "재즈카오디오(광주)", "현대카오디오(서울)", "수원테크(수원)",
      "닥터카오디오(수원)", "써브카오디오(안산)"];
    const CLIENTS = ["개인", "방문", "개인", "방문", "개인", "방문", ...DEALERS, "옥션", "G마켓"];
    const EXP_ITEMS = [["제품원가", "제품매입"], ["제품원가", "서비스이용"], ["비용", "식대"], ["비용", "차량유지비"],
      ["비용", "통신비"], ["비용", "수도광열비"], ["비용", "광고비"], ["생활", "마트"], ["생활", "식당"]];
    const SEASON = [0.85, 0.8, 0.95, 1.0, 1.05, 1.0, 1.1, 1.05, 0.95, 1.0, 1.05, 1.15];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startYear = today.getFullYear() - 1;
    for (let d = new Date(startYear, 0, 1); d <= today; d.setDate(d.getDate() + 1)) {
      const off = Math.round((today - d) / 86400000);
      const growth = 1 + 0.08 * (d.getFullYear() - startYear);
      const day = isoOf(d);
      const created = day + " 18:00:00";
      if (d.getDay() !== 0 && rng() < 0.88) {
        for (let i = 1 + Math.floor(rng() * 3); i > 0; i--) {
          const isService = rng() < 0.7;
          const amount = Math.floor((5 + Math.floor(rng() * 105)) * 10000 * SEASON[d.getMonth()] * growth / 10000) * 10000;
          const pay = wpick(["현금", "카드", "계좌입금"], [3, 4, 3]);
          const tax = pay === "카드" || rng() < 0.3 ? "Y" : "N";
          const vat = (pay === "카드" || tax === "Y") ? roundHalfUp(amount * 10 / 110) : 0;
          const client = pick(CLIENTS);
          const maker = wpick(MAKERS, MAKER_W);
          // 업체 거래 일부는 외상(미수금): 최근일수록 아직 못 받은 경우가 많게
          let receivable = 0;
          if (pay === "계좌입금" && DEALERS.includes(client) && rng() < (off < 45 ? 0.6 : 0.04))
            receivable = rng() < 0.7 ? amount : Math.floor(amount / 2);
          // 업체 소개·협업 작업은 일부를 거래처에 지급(미지급금, 매출에서 차감)
          let payout = 0, payoutDue = 0;
          if (DEALERS.includes(client) && rng() < 0.25) {
            payout = Math.floor(amount * pick([0.2, 0.3, 0.4]) / 10000) * 10000;
            payoutDue = off < 30 && rng() < 0.6 ? payout : 0;
          }
          db.incomes.push(Object.assign({}, INCOME_DEFAULTS, {
            id: ++db.seq.incomes, trx_date: day, income_type: isService ? "서비스제공" : "상품판매",
            category: pick(isService ? SERVICES : PRODUCTS), manufacturer: maker, car_model: pick(SEED_CODES.car_model[maker]),
            product_model: isService && rng() < 0.4 ? pick(UNITS) : "", client,
            unit_price: amount, amount, vat, net_amount: amount - vat, account: "국민(법인)",
            payment_type: pay, tax_invoice: tax, memo: "데모 데이터", receivable, payout, payout_due: payoutDue,
            created_by: "데모", created_at: created,
          }));
        }
        for (let i = 1 + Math.floor(rng() * 2); i > 0; i--) {
          const [etype, item] = pick(EXP_ITEMS);
          const amount = (1 + Math.floor(rng() * 29)) * 10000;
          const payable = etype === "제품원가" && off < 40 && rng() < 0.5 ? amount : 0;
          db.expenses.push(Object.assign({}, EXPENSE_DEFAULTS, {
            id: ++db.seq.expenses, trx_date: day, expense_type: etype, item,
            payment_type: pick(["현금", "카드", "계좌입금"]), client: pick(["해덕", "마트", "식당", "주유소", "기타"]),
            unit_price: amount, amount, memo: "데모 데이터", payable, created_by: "데모", created_at: created,
          }));
        }
      }
      if (d.getDate() === 25) {  // 급여·임차료는 매달 한 번
        for (const [etype, item, amount] of [["인건비", "급여", 3200000], ["비용", "임차료", 1500000]]) {
          db.expenses.push(Object.assign({}, EXPENSE_DEFAULTS, {
            id: ++db.seq.expenses, trx_date: day, expense_type: etype, item, payment_type: "계좌입금",
            unit_price: amount, amount, memo: "데모 데이터", created_by: "데모", created_at: created,
          }));
        }
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
    // 올해 월별 목표: 작년 같은 달 실적 기준 (매출·영업이익 +10%, 지출 예산 +5%, 10만원 단위)
    const y = today.getFullYear();
    for (let m = 1; m <= 12; m++) {
      const month = `${y - 1}-${pad2(m)}`;
      const sales = db.incomes.filter(r => r.trx_date.startsWith(month)).reduce((a, r) => a + r.amount - r.payout, 0);
      const spent = db.expenses.filter(r => r.trx_date.startsWith(month)).reduce((a, r) => a + r.amount, 0);
      const r10 = v => Math.round(v / 100000) * 100000;
      db.targets[`${y}-${pad2(m)}`] = { sales: r10(sales * 1.1), profit: r10((sales - spent) * 1.1), expense: r10(spent * 1.05) };
    }
  }

  async function freshDB() {
    const db = { v: 3, incomes: [], expenses: [], codes: [], users: [], targets: {},
      settings: { instance_id: Math.random().toString(16).slice(2, 14).padEnd(12, "0") },
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
    if (saved && saved.v === 3) {
      DB = saved;
    } else {
      DB = await freshDB();
      for (const k of OLD_KEYS) { try { local && local.removeItem(k); } catch (_e) { /* 옛 데모 데이터 정리 */ } }
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
    incomes: ["trx_date", "income_type", "category", "manufacturer", "car_model", "product_model", "client", "currency",
      "exchange_rate", "quantity", "unit_price", "amount", "vat", "net_amount", "account", "payment_type",
      "tax_invoice", "memo", "receivable", "payout", "payout_due"],
    expenses: ["trx_date", "expense_type", "item", "payment_type", "client", "currency", "exchange_rate",
      "quantity", "unit_price", "amount", "memo", "payable"],
  };
  const REQUIRED = { incomes: ["trx_date", "income_type", "amount"], expenses: ["trx_date", "expense_type", "amount"] };
  const NUMERIC = ["exchange_rate", "quantity", "unit_price", "amount", "vat", "net_amount", "receivable", "payable", "payout", "payout_due"];
  const INTEGER = ["amount", "vat", "net_amount", "receivable", "payable", "payout", "payout_due"];
  const FIELD_LABELS = {
    trx_date: "영업일자", income_type: "매출유형", expense_type: "지출유형", amount: "금액",
    category: "매출구분", manufacturer: "브랜드", car_model: "차종", product_model: "제품모델",
    client: "거래처", currency: "거래통화", exchange_rate: "기준환율", quantity: "수량",
    unit_price: "단가", vat: "부가세", net_amount: "순매출액", account: "계좌",
    payment_type: "결제유형", tax_invoice: "세금계산서", memo: "적요", receivable: "미수금",
    payout: "미지급금", payout_due: "미지급 잔액", item: "거래품목", payable: "미지급금",
  };
  const TYPE_FIELD = { incomes: "income_type", expenses: "expense_type" };
  const BALANCE_FIELD = { incomes: "receivable", expenses: "payable" };
  const BALANCE_LABEL = { incomes: "미수금", expenses: "미지급금" };
  const SETTLE_FIELDS = { incomes: ["receivable", "payout_due"], expenses: ["payable"] };
  const SEARCH_FIELDS = {
    incomes: ["client", "memo", "product_model", "category", "manufacturer", "car_model", "income_type", "account"],
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
      if (typeof data[f] === "boolean" || !isFinite(v)) return [null, `${FIELD_LABELS[f] || f} 값이 숫자가 아닙니다.`];
      if (Math.abs(v) > MAX_NUMBER) return [null, `${FIELD_LABELS[f] || f} 값이 너무 큽니다.`];
      data[f] = INTEGER.includes(f) ? roundHalfUp(v) : v;
    }
    for (const f of REQUIRED[table]) if (NUMERIC.includes(f) && !data[f]) return [null, `${FIELD_LABELS[f] || f} 값이 필요합니다.`];
    for (const f of FIELDS[table]) {
      if (f in data && !NUMERIC.includes(f)) data[f] = String(data[f] ?? "").trim().slice(0, 500);
    }
    if ("tax_invoice" in data) data.tax_invoice = data.tax_invoice.toUpperCase() === "Y" ? "Y" : "N";
    if ("currency" in data) data.currency = data.currency.toUpperCase() || "KRW";
    const bal = BALANCE_FIELD[table];
    const cap = Math.max(data.amount || 0, 0);
    if (bal in data && clampBalance) data[bal] = Math.min(Math.max(data[bal], 0), cap);
    if (bal in data) {
      if (data[bal] < 0) return [null, `${BALANCE_LABEL[table]}은 0 이상이어야 합니다.`];
      if (data[bal] > cap) return [null, `${BALANCE_LABEL[table]}은 금액보다 클 수 없습니다.`];
    }
    if (table === "incomes") {
      // 미지급금(거래처에 줄 돈)만 오면 아직 지급하지 않은 것으로 본다
      if ("payout" in data && !("payout_due" in data)) data.payout_due = data.payout;
      if (clampBalance) {
        if ("payout" in data) data.payout = Math.min(Math.max(data.payout, 0), cap);
        if ("payout_due" in data) data.payout_due = Math.min(Math.max(data.payout_due, 0), "payout" in data ? data.payout : cap);
      }
      if ("payout" in data && !(data.payout >= 0 && data.payout <= cap)) return [null, "미지급금은 0원부터 매출액까지 입력할 수 있습니다."];
      if ("payout_due" in data && !(data.payout_due >= 0 && data.payout_due <= ("payout" in data ? data.payout : cap)))
        return [null, "미지급 잔액은 0원부터 미지급금까지만 될 수 있습니다."];
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
    if (table === "incomes") { s.vat = sum(rows, r => r.vat); s.payout = sum(rows, r => r.payout); }
    return json(200, { items: rows.slice((page - 1) * size, page * size).map(withWeekday), total: rows.length,
      page, size, pages, sum: s });
  }

  function saveEntry(table, body, id) {
    let raw = body;
    let row = null;
    if (id !== undefined) {
      // 일부 항목만 보낸 수정도 저장된 값과 합쳐서 검사한다
      row = DB[table].find(r => r.id === id);
      if (!row) return err(404, "해당 내역이 없습니다.");
      raw = {};
      for (const f of FIELDS[table]) raw[f] = row[f];
      for (const [k, v] of Object.entries(body)) if (FIELDS[table].includes(k)) raw[k] = v;
    }
    const [data, e] = cleanEntry(raw, table, false);
    if (e) return err(400, e);
    const who = userLabel(currentUser());
    if (id === undefined) {
      const fresh = Object.assign({}, DEFAULTS[table], data, { id: ++DB.seq[table], created_by: who, created_at: nowStr() });
      if (table === "incomes" && !("net_amount" in data)) fresh.net_amount = fresh.amount - fresh.vat;
      DB[table].push(fresh);
      saveDB();
      return json(201, withWeekday(fresh));
    }
    Object.assign(row, data, { updated_by: who, updated_at: nowStr() });
    saveDB();
    return json(200, withWeekday(row));
  }

  // ---------------------------------------------------------------- 집계 (app.py /api/agg와 같은 결과)
  const AGG_DIMS = {
    incomes: ["income_type", "category", "manufacturer", "car_model", "product_model", "client", "payment_type", "account", "currency", "tax_invoice"],
    expenses: ["expense_type", "item", "client", "payment_type", "currency"],
  };
  const AGG_TIME = { date: s => s, month: s => s.slice(0, 7), year: s => s.slice(0, 4) };
  const AGG_MEASURES = {
    incomes: (acc, r) => {
      acc.cnt++; acc.amount += r.amount; acc.vat += r.vat; acc.payout += r.payout || 0;
      acc.payout_due += r.payout_due || 0; acc.receivable += r.receivable || 0;
      if (r.payment_type === "카드") acc.card += r.amount;
    },
    expenses: (acc, r) => {
      acc.cnt++; acc.amount += r.amount; acc.payable += r.payable || 0;
      if (r.expense_type === "제품원가") acc.cost += r.amount;
    },
  };
  const AGG_ZERO = {
    incomes: () => ({ cnt: 0, amount: 0, vat: 0, payout: 0, payout_due: 0, receivable: 0, card: 0 }),
    expenses: () => ({ cnt: 0, amount: 0, payable: 0, cost: 0 }),
  };

  function aggregate(q) {
    const kind = q.get("kind");
    if (!AGG_DIMS[kind]) return err(400, "kind는 incomes 또는 expenses여야 합니다.");
    const from = validDate(q.get("from")), to = validDate(q.get("to"));
    if (!from || !to || from > to || !yearOk(+from.slice(0, 4)) || !yearOk(+to.slice(0, 4)))
      return err(400, "from, to는 YYYY-MM-DD 형식이고 from이 to보다 앞서야 합니다.");
    if (dayNum(to) - dayNum(from) > 366 * 30) return err(400, "조회 기간이 너무 깁니다.");
    const groups = (q.get("group") || "").split(",").filter(Boolean);
    if (groups.length > 3 || new Set(groups).size !== groups.length) return err(400, "group은 서로 다른 항목 3개까지입니다.");
    for (const g of groups) if (!AGG_TIME[g] && !AGG_DIMS[kind].includes(g)) return err(400, `알 수 없는 group 항목입니다: ${g}`);
    const filters = [];
    for (const [k, v] of q.entries()) {
      if (!k.startsWith("f.")) continue;
      const dim = k.slice(2);
      if (!AGG_DIMS[kind].includes(dim)) return err(400, `알 수 없는 조건 항목입니다: ${dim}`);
      filters.push(r => String(r[dim] ?? "") === v);
    }
    const keyOf = g => (AGG_TIME[g] ? r => AGG_TIME[g](r.trx_date) : r => String(r[g] ?? ""));
    const keyFns = groups.map(keyOf);
    const buckets = new Map();
    for (const r of DB[kind]) {
      if (r.trx_date < from || r.trx_date > to || !filters.every(f => f(r))) continue;
      const vals = keyFns.map(fn => fn(r));
      const k = vals.join("\u0001");
      let acc = buckets.get(k);
      if (!acc) {
        acc = AGG_ZERO[kind]();
        groups.forEach((g, i) => { acc[g] = vals[i]; });
        buckets.set(k, acc);
      }
      AGG_MEASURES[kind](acc, r);
    }
    const rows = [...buckets.values()];
    if (!groups.length && !rows.length) rows.push(AGG_ZERO[kind]());
    rows.sort((a, b) => {
      for (const g of groups) if (a[g] !== b[g]) return a[g] < b[g] ? -1 : 1;
      return 0;
    });
    return json(200, { kind, from, to, group: groups, rows, truncated: false });
  }

  // ---------------------------------------------------------------- 목표
  const TARGET_METRICS = ["sales", "profit", "expense"];
  function putTargets(body) {
    const year = body.year, months = body.months;
    if (!Number.isInteger(year) || !yearOk(year) || !months || typeof months !== "object" || Array.isArray(months))
      return err(400, "year(연도)와 months(월별 목표)가 필요합니다.");
    const next = {};
    for (let m = 1; m <= 12; m++) {
      const vals = months[String(m)] || {};
      if (typeof vals !== "object" || Array.isArray(vals)) return err(400, `${m}월 목표 형식이 올바르지 않습니다.`);
      const key = `${year}-${pad2(m)}`;
      for (const metric of TARGET_METRICS) {
        const v = vals[metric];
        if (v === null || v === undefined || v === "") continue;
        const n = Number(v);
        if (typeof v === "boolean" || !isFinite(n)) return err(400, `${m}월 목표 값이 숫자가 아닙니다.`);
        if (Math.abs(n) > MAX_NUMBER || (metric !== "profit" && n < 0)) return err(400, `${m}월 목표 값이 올바르지 않습니다.`);
        (next[key] = next[key] || {})[metric] = roundHalfUp(n);
      }
    }
    for (let m = 1; m <= 12; m++) delete DB.targets[`${year}-${pad2(m)}`];
    Object.assign(DB.targets, next);
    saveDB();
    return json(200, { targets: DB.targets });
  }

  // ---------------------------------------------------------------- 미수금·미지급금
  function receivables(q) {
    const summary = ["1", "true"].includes(q.get("summary"));
    const out = {};
    for (const [key, table, bal] of [["incomes", "incomes", "receivable"], ["expenses", "expenses", "payable"], ["payouts", "incomes", "payout_due"]]) {
      const rows = DB[table].filter(r => (r[bal] || 0) > 0);
      const total = sum(rows, r => r[bal]);
      if (summary) { out[key] = { total, count: rows.length }; continue; }
      const by = {};
      for (const r of rows) {
        const n = r.client || "(미지정)";
        const s = (by[n] = by[n] || { name: n, value: 0, cnt: 0, oldest: r.trx_date });
        s.value += r[bal]; s.cnt += 1; if (r.trx_date < s.oldest) s.oldest = r.trx_date;
      }
      out[key] = { total, count: rows.length, by_client: Object.values(by).sort((a, b) => b.value - a.value),
        items: rows.sort(byDateAsc).slice(0, 500).map(withWeekday) };
    }
    return json(200, out);
  }

  // ---------------------------------------------------------------- 엑셀 내보내기 (exporter.py와 같은 시트 구성)
  const INCOME_COLUMNS = [["영업일자", "trx_date", "date", 12], ["요일", "weekday", "text", 6], ["매출유형", "income_type", "text", 11],
    ["매출구분", "category", "text", 14], ["브랜드", "manufacturer", "text", 11], ["차종", "car_model", "text", 13],
    ["제품모델", "product_model", "text", 14], ["거래처명", "client", "text", 20], ["거래통화", "currency", "text", 9],
    ["기준환율", "exchange_rate", "rate", 10], ["수량", "quantity", "qty", 7], ["단가", "unit_price", "price", 12],
    ["매출액", "amount", "won", 13], ["부가세", "vat", "won", 11], ["순매출액", "net_amount", "won", 13],
    ["결제유형", "payment_type", "text", 10], ["세금계산서발행유무", "tax_invoice", "text", 11], ["계좌", "account", "text", 20],
    ["미수금", "receivable", "won", 12], ["미지급금", "payout", "won", 12], ["미지급 잔액", "payout_due", "won", 12],
    ["적요", "memo", "text", 36], ["관리번호", "id", "id", 9]];
  const EXPENSE_COLUMNS = [["영업일자", "trx_date", "date", 12], ["요일", "weekday", "text", 6], ["지출유형", "expense_type", "text", 11],
    ["거래품목", "item", "text", 14], ["결제유형", "payment_type", "text", 10], ["거래처명", "client", "text", 20],
    ["거래통화", "currency", "text", 9], ["기준환율", "exchange_rate", "rate", 10], ["수량", "quantity", "qty", 7],
    ["단가", "unit_price", "price", 12], ["지출금액", "amount", "won", 13], ["미지급금", "payable", "won", 12],
    ["적요", "memo", "text", 36], ["관리번호", "id", "id", 9]];

  function monthlyRows(incRows, expRows) {
    const months = {};
    const slot = m => (months[m] = months[m] || { month: m, income_count: 0, income: 0, vat: 0, net_income: 0,
      receivable: 0, payout: 0, payout_due: 0, expense_count: 0, expense: 0, payable: 0 });
    for (const r of incRows || []) {
      const s = slot(r.trx_date.slice(0, 7));
      s.income_count++; s.income += r.amount; s.vat += r.vat; s.net_income += r.net_amount; s.receivable += r.receivable;
      s.payout += r.payout || 0; s.payout_due += r.payout_due || 0;
    }
    for (const r of expRows || []) {
      const s = slot(r.trx_date.slice(0, 7));
      s.expense_count++; s.expense += r.amount; s.payable += r.payable;
    }
    return Object.keys(months).sort().map(k => {
      const s = months[k];
      s.sales = s.income - s.payout;  // 실매출 = 매출액 − 미지급금(매출차감)
      s.profit = s.sales - s.expense;
      return s;
    });
  }

  /** 분류별 집계표 (분류 × 월, 기간이 길면 × 연도) — app.py _dimension_spec과 같음 */
  function dimensionSheet(W, rows, title, label, nameFn, valueFn, note, byYear) {
    const S = W.S;
    const col = r => (byYear ? r.trx_date.slice(0, 4) : r.trx_date.slice(0, 7));
    const items = new Map();
    for (const r of rows) {
      const n = nameFn(r);
      const it = items.get(n) || { name: n, cnt: 0, total: 0, cells: {} };
      const v = valueFn(r);
      it.cnt++; it.total += v;
      it.cells[col(r)] = (it.cells[col(r)] || 0) + v;
      items.set(n, it);
    }
    const list = [...items.values()].sort((a, b) => (b.total - a.total) || (a.name < b.name ? -1 : 1));
    const cols = [...new Set(list.flatMap(it => Object.keys(it.cells)))].sort();
    const grand = list.reduce((a, it) => a + it.total, 0);
    const out = [[{ v: title, s: S.title }], [{ v: note, s: S.muted }],
      [label, "건수", "합계", "비중", ...cols.map(c => (byYear ? `${c}년` : c))].map(v => ({ v, s: S.head }))];
    for (const it of list) {
      out.push([it.name, { v: it.cnt, s: S.won }, { v: it.total, s: S.won }, { v: grand ? it.total / grand : 0, s: S.pct },
        ...cols.map(c => ({ v: it.cells[c] || 0, s: S.won }))]);
    }
    if (list.length) {
      out.push([{ v: "합계", s: S.totalLabel }, { v: list.reduce((a, it) => a + it.cnt, 0), s: S.totalNum },
        { v: grand, s: S.totalNum }, { v: grand ? 1 : 0, s: S.totalPct },
        ...cols.map(c => ({ v: list.reduce((a, it) => a + (it.cells[c] || 0), 0), s: S.totalNum }))]);
    }
    return { name: title, widths: [28, 8, 15, 8, ...cols.map(() => 13)], freeze: "E4", rows: out };
  }

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

    // 요약: '시스템 식별자'·'내보낸 시각'은 다시 올릴 때 관리번호로 고칠지 판단하는 데 쓴다
    const summary = [[{ v: `웰카오디오 ${title} 내역`, s: S.title }]];
    for (const [l, v] of [["조회 기간", period], ["조건", conds.join(", ")], ["내보낸 시각", nowStr()],
      ["내보낸 사람", who], ["시스템 식별자", DB.settings.instance_id]])
      if (v) summary.push([{ v: l, s: S.muted }, v]);
    summary.push([]);
    summary.push(["항목", "금액(원)", "건수"].map(v => ({ v, s: S.head })));
    const line = (l, amount, count) => summary.push([{ v: l, s: S.bold }, { v: amount, s: S.won },
      count === null ? null : { v: count, s: S.won }]);
    if (incOn) {
      line("매출액 합계 (총매출)", tot("income"), tot("income_count"));
      line("미지급금 (매출차감)", tot("payout"), null);
      line("실매출 (매출액 − 미지급금)", tot("income") - tot("payout"), null);
      line("부가세", tot("vat"), null);
      line("순매출액 (공급가액)", tot("net_income"), null);
      line("미수금 잔액 (받을 돈)", tot("receivable"), inc.filter(r => r.receivable > 0).length);
      line("거래처 미지급 잔액 (줄 돈)", tot("payout_due"), inc.filter(r => r.payout_due > 0).length);
    }
    if (expOn) {
      line("지출금액 합계", tot("expense"), tot("expense_count"));
      line("지출 미지급금 잔액 (줄 돈)", tot("payable"), exp.filter(r => r.payable > 0).length);
    }
    if (incOn && expOn) line("영업이익 (실매출 − 지출)", tot("income") - tot("payout") - tot("expense"), null);
    summary.push([]);
    for (const note of ["※ '매출내역'·'지출내역' 시트는 이 시스템의 [데이터 관리 → 엑셀로 입력하기]로 다시 올릴 수 있습니다.",
      "   이미 있는 내역은 건너뛰고, 엑셀에서 고친 줄은 '관리번호'로 찾아 그 내역을 고칩니다.",
      "   관리번호 칸은 고치거나 지우지 마세요. 새로 적는 줄은 관리번호를 비워 두면 새 내역으로 등록됩니다."])
      summary.push([{ v: note, s: S.muted }]);

    // 월별손익 ('영업월'·'매출액'·'지출금액' 머리글)
    const mcols = [["영업월", "month", 10]];
    if (incOn) mcols.push(["매출 건수", "income_count", 9], ["매출액", "income", 14], ["매출차감(미지급금)", "payout", 13],
      ["실매출", "sales", 14], ["부가세", "vat", 12], ["순매출액", "net_income", 14], ["미수금", "receivable", 12]);
    if (expOn) mcols.push(["지출 건수", "expense_count", 9], ["지출금액", "expense", 14], ["지출 미지급금", "payable", 12]);
    if (incOn && expOn) mcols.push(["영업이익", "profit", 14]);
    const mrows = [mcols.map(c => ({ v: c[0], s: S.head }))];
    for (const m of monthly) mrows.push(mcols.map((c, i) => (i ? { v: m[c[1]], s: S.won } : m.month)));
    if (monthly.length) mrows.push(mcols.map((c, i) => (i ? { v: tot(c[1]), s: S.totalNum } : { v: "합계", s: S.totalLabel })));

    const detail = (cols, rows) => {
      const out = [cols.map(c => ({ v: c[0], s: S.head }))];
      for (const r of rows) {
        out.push(cols.map(([, f, k]) => {
          const v = f === "weekday" ? weekdayOf(r.trx_date) : r[f];
          if (k === "date") return { v, t: "d", s: S.date };
          if (k === "won") return { v: Number(v) || 0, s: S.won };
          if (k === "id") return { v: Number(v) };
          if (k === "rate") return { v: Number(v) || 1, s: S.dec };
          if (k === "qty") return { v: Number(v) || 0, s: Number.isInteger(Number(v)) ? S.won : S.dec };
          if (k === "price") return { v: Number(v) || 0, s: (r.currency || "KRW") === "KRW" && Number.isInteger(Number(v)) ? S.won : S.dec };
          return v === null || v === undefined ? "" : String(v);
        }));
      }
      return out;
    };
    const sheets = [
      { name: "요약", widths: [28, 20, 10], rows: summary },
      { name: "월별손익", widths: mcols.map(c => c[2]), freeze: "B2", rows: mrows },
    ];
    const byYear = monthly.length > 24;
    const unit = byYear ? "연도별" : "월별";
    const unset = v => v || "(미지정)";
    if (incOn) {
      const note = `단위: 원 · 실매출(매출액 − 미지급금) 기준 · ${unit} · ${period}`;
      const sales = r => r.amount - (r.payout || 0);
      sheets.push(
        dimensionSheet(W, inc, "브랜드별", "브랜드", r => unset(r.manufacturer), sales, note, byYear),
        dimensionSheet(W, inc, "차종별", "브랜드 · 차종", r => `${unset(r.manufacturer)} · ${unset(r.car_model)}`, sales, note, byYear),
        dimensionSheet(W, inc, "서비스구분별", "매출유형 · 매출구분(서비스 구분)", r => `${unset(r.income_type)} · ${unset(r.category)}`, sales, note, byYear));
    }
    if (expOn) {
      sheets.push(dimensionSheet(W, exp, "지출유형별", "지출유형 · 거래품목", r => `${unset(r.expense_type)} · ${unset(r.item)}`,
        r => r.amount, `단위: 원 · 지출금액 · ${unit} · ${period}`, byYear));
    }
    if (incOn) sheets.push({ name: "매출내역", widths: INCOME_COLUMNS.map(c => c[3]), freeze: "B2", autoFilter: true, rows: detail(INCOME_COLUMNS, inc) });
    if (expOn) sheets.push({ name: "지출내역", widths: EXPENSE_COLUMNS.map(c => c[3]), freeze: "B2", autoFilter: true, rows: detail(EXPENSE_COLUMNS, exp) });
    const span = from || to ? `${from || "처음"}_${to || "현재"}` : "전체";
    return { file: W.build(sheets), filename: `웰카오디오_${label}_${span}.xlsx`,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }

  // ---------------------------------------------------------------- 엑셀 입력 양식 (exporter.py build_template과 같은 모양)
  const TEMPLATE_INCOME = [["영업일자", 12, null, "date"], ["매출유형", 11, "income_type"], ["매출구분", 14, "income_category"],
    ["브랜드", 11, "manufacturer"], ["차종", 14, "car_model"], ["제품모델", 12], ["거래처명", 20, "client"],
    ["매출액", 13, null, "won"], ["결제유형", 10, "payment_type"], ["세금계산서발행유무", 11, "yn"], ["계좌", 20, "account"],
    ["미수금", 11, null, "won"], ["미지급금", 11, null, "won"], ["미지급금 지급완료", 11, "yn"], ["적요", 32],
    ["부가세", 11, null, "won"], ["거래통화", 9, "currency"], ["CNY 기준환율", 11, null, "dec"], ["수량", 7], ["단가", 11]];
  const TEMPLATE_EXPENSE = [["영업일자", 12, null, "date"], ["지출유형", 11, "expense_type"], ["거래품목", 14, "expense_item"],
    ["결제유형", 10, "payment_type"], ["거래처명", 20, "client"], ["지출금액", 13, null, "won"], ["미지급금", 11, null, "won"],
    ["적요", 32], ["거래통화", 9, "currency"], ["CNY 기준환율", 11, null, "dec"], ["수량", 7], ["단가", 11]];
  const TEMPLATE_CODE_LISTS = [["income_type", "매출유형"], ["income_category", "매출구분"], ["manufacturer", "브랜드"],
    ["car_model", "차종"], ["client", "거래처명"], ["payment_type", "결제유형"], ["account", "계좌"], ["currency", "거래통화"],
    ["expense_type", "지출유형"], ["expense_item", "거래품목"], ["yn", "Y/N"]];
  const TEMPLATE_ROWS = 1000;
  const TEMPLATE_GUIDE = [
    ["웰카오디오 매출/지출 입력 양식", "title"], ["", null], ["쓰는 방법", "head"],
    ["1. '매출입력'·'지출입력' 시트에 한 줄에 한 건씩 적습니다. 첫 줄(머리글)은 지우거나 바꾸지 마세요.", null],
    ["2. 머리글 아래 칸을 누르면 목록(드롭다운)이 나오는 칸은 목록에서 고르면 됩니다. 목록에 없는 값도 적을 수 있고, 올리면 코드관리에 자동으로 추가됩니다.", null],
    ["3. 다 적었으면 시스템의 [데이터 관리 → 엑셀로 입력하기]에 이 파일을 올립니다. 새 내역은 바로 반영되고, 이미 올린 줄은 건너뜁니다.", null],
    ["4. 같은 파일에 계속 이어 적고 다시 올려도 됩니다. 이미 올린 줄을 엑셀에서 고치거나 지웠다면 '엑셀 장부와 맞추기'(관리자)로 올리면 시스템도 똑같이 바뀝니다.", null],
    ["", null], ["칸 설명", "head"],
    ["영업일자: 2026-10-04 처럼 적습니다.", null],
    ["매출액·지출금액: 원화 금액(부가세 포함)입니다.", null],
    ["브랜드·차종: 차량 브랜드(차량제조사)와 차종입니다. 매출 집계를 브랜드별·차종별로 볼 수 있습니다.", null],
    ["매출구분: 서비스 구분(앰프수리, 탈부착 등)입니다.", null],
    ["부가세: 비워 두면 결제유형이 '카드'이거나 세금계산서가 'Y'일 때 매출액 × 10/110으로 자동 계산합니다.", null],
    ["미수금: 매출 중 아직 받지 못한 금액입니다.", null],
    ["미지급금(매출): 이 매출에서 거래처에 줘야 할 금액입니다. 실매출(매출액 − 미지급금)에서 빠집니다. 이미 줬으면 '미지급금 지급완료'에 Y를 적습니다.", null],
    ["미지급금(지출): 외상으로 사서 아직 지급하지 않은 금액입니다.", null],
    ["거래통화가 CNY이면 수량·단가·CNY 기준환율을 적고, 매출액(지출금액)에는 원화로 바꾼 금액을 적습니다.", null],
  ];
  const colName = i => { let s = ""; for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };

  function templateWorkbook() {
    const W = window.WellcarXlsxWriter, S = W.S;
    const lists = {};
    const sorted = [...DB.codes].sort((a, b) => (a.code_group < b.code_group ? -1 : a.code_group > b.code_group ? 1 : 0) ||
      (a.parent_value < b.parent_value ? -1 : a.parent_value > b.parent_value ? 1 : 0) || a.sort_order - b.sort_order || a.id - b.id);
    for (const c of sorted) {
      const l = lists[c.code_group] = lists[c.code_group] || [];
      if (!l.includes(c.code_value)) l.push(c.code_value);
    }
    lists.yn = ["Y", "N"];
    const where = {};
    const longest = Math.max(...TEMPLATE_CODE_LISTS.map(([k]) => (lists[k] || []).length));
    const codeRows = [TEMPLATE_CODE_LISTS.map(([, label]) => ({ v: label, s: S.head }))];
    for (let r = 0; r < longest; r++) codeRows.push(TEMPLATE_CODE_LISTS.map(([k]) => ((lists[k] || [])[r] ?? null)));
    TEMPLATE_CODE_LISTS.forEach(([k], i) => { where[k] = [colName(i), (lists[k] || []).length]; });
    const entrySheet = (name, spec) => {
      const rows = [spec.map(([h]) => ({ v: h, s: S.head }))];
      const styled = spec.map(([, , , fmt]) => (fmt === "date" ? S.date : fmt === "won" ? S.won : fmt === "dec" ? S.dec : 0));
      if (styled.some(Boolean)) {
        // 빈 칸에도 날짜·금액 서식을 미리 입혀 둔다 (값은 없음)
        for (let r = 0; r < TEMPLATE_ROWS; r++) rows.push(styled.map(s => (s ? { v: "", s } : null)));
      }
      const validations = [];
      spec.forEach(([, , code], i) => {
        if (!code || !where[code] || !where[code][1]) return;
        const [src, n] = where[code];
        validations.push({ sqref: `${colName(i)}2:${colName(i)}${TEMPLATE_ROWS + 1}`, list: `'코드목록'!$${src}$2:$${src}$${n + 1}` });
      });
      return { name, widths: spec.map(([, w]) => w), freeze: "B2", rows, validations, selected: name === "매출입력" };
    };
    const sheets = [
      { name: "작성 안내", widths: [120], rows: TEMPLATE_GUIDE.map(([t, k]) => [{ v: t, s: k === "title" ? S.title : k === "head" ? S.bold : 0 }]) },
      entrySheet("매출입력", TEMPLATE_INCOME),
      entrySheet("지출입력", TEMPLATE_EXPENSE),
      { name: "코드목록", widths: TEMPLATE_CODE_LISTS.map(() => 16), freeze: "A2", rows: codeRows },
    ];
    return { file: W.build(sheets), filename: "웰카오디오_입력양식.xlsx",
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
  }

  // ---------------------------------------------------------------- 백업 (데모: 이 브라우저 안 스냅숏)
  const KIND_LABELS = { auto: "자동", manual: "수동", "pre-import": "가져오기 직전", "pre-restore": "복원 직전", upload: "업로드" };
  const KEEP = { auto: 2, manual: 3, "pre-import": 2, "pre-restore": 2, upload: 2 };  // 브라우저 저장 공간이 작아 실제(30·10개)보다 적게
  const backupItem = b => ({ name: b.name, kind: b.kind, kind_label: KIND_LABELS[b.kind], created_at: b.created_at, seq: b.seq, size: b.size });
  function snapshot() { return { incomes: DB.incomes, expenses: DB.expenses, codes: DB.codes, targets: DB.targets }; }

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
    // 백업의 목표가 비어 있거나 없으면 지금 목표를 유지한다 (app.py와 같음)
    if (data.targets && typeof data.targets === "object" && Object.keys(data.targets).length) DB.targets = data.targets;
    for (const t of ["incomes", "expenses", "codes"])
      DB.seq[t] = Math.max(DB.seq[t], ...DB[t].map(r => Number(r.id) || 0), 0);
    saveDB();
    const counts = { incomes: DB.incomes.length, expenses: DB.expenses.length, codes: DB.codes.length };
    if (data.targets) counts.targets = Object.keys(DB.targets).length;
    return counts;
  }

  // ---------------------------------------------------------------- 엑셀 올리기 (app.py _plan_import와 같은 판정)
  const IMPORT_KEYS = { incomes: ["trx_date", "income_type", "category", "client", "amount", "vat", "memo"],
    expenses: ["trx_date", "expense_type", "item", "client", "amount", "memo"] };
  const IMPORT_DEFAULTS = {
    incomes: { category: "", manufacturer: "", car_model: "", product_model: "", client: "", currency: "KRW",
      exchange_rate: 1, quantity: 1, unit_price: 0, vat: 0, account: "", payment_type: "", tax_invoice: "N",
      memo: "", receivable: 0, payout: 0, payout_due: 0 },
    expenses: { item: "", payment_type: "", client: "", currency: "KRW", exchange_rate: 1, quantity: 1,
      unit_price: 0, memo: "", payable: 0 },
  };
  const PAYABLE_NOTE_RE = /\s*\[미지급금 [^\]]*\]$/;
  const dedupeKey = (r, fields) => fields.map(f => (f === "amount" || f === "vat" ? roundHalfUp(r[f] || 0)
    : f === "memo" ? String(r[f] || "").replace(PAYABLE_NOTE_RE, "") : String(r[f] || ""))).join("\u001f");
  const NUM_TOLERANCE = { unit_price: 0.006, exchange_rate: 0.00006 };
  function sameValue(f, a, b) {
    if (INTEGER.includes(f)) return roundHalfUp(a || 0) === roundHalfUp(b || 0);
    if (f in NUM_TOLERANCE) return Math.abs((Number(a) || 0) - (Number(b) || 0)) < NUM_TOLERANCE[f];
    if (NUMERIC.includes(f)) {
      const x = Number(a) || 0, y = Number(b) || 0;
      return Math.abs(x - y) <= 1e-6 * Math.max(1, Math.abs(x), Math.abs(y));
    }
    return String(a ?? "").trim() === String(b ?? "").trim();
  }
  const sampleOf = (r, reason) => ({ src: String(r.src || "").slice(0, 80), trx_date: String(r.trx_date || "").slice(0, 10),
    amount: typeof r.amount === "number" ? r.amount : 0, client: String(r.client || "").slice(0, 40), reason });

  function planImport(table, rows, mode) {
    const fields = FIELDS[table], keyFields = IMPORT_KEYS[table];
    const counts = { added: 0, updated: 0, same: 0, conflict: 0, missing: 0, deleted: 0, invalid: 0 };
    const samples = { invalid: [], updated: [], conflict: [], missing: [], deleted: [] };
    const plan = { counts, samples, inserts: [], updates: [], deletes: [], valid: [], range: null };
    const note = (kind, r, reason) => { if (samples[kind].length < 50) samples[kind].push(sampleOf(r, reason)); };
    const valid = [];
    for (const r of rows) {
      if (!r || typeof r !== "object" || Array.isArray(r)) { counts.invalid++; continue; }
      let [data, e] = cleanEntry(r, table, true);
      if (!e && !data.amount) e = "금액이 0입니다.";
      if (e) { counts.invalid++; note("invalid", r, e); continue; }
      const full = Object.assign({}, IMPORT_DEFAULTS[table], data);
      if (table === "incomes" && !("net_amount" in data)) full.net_amount = full.amount - full.vat;
      const ref = Number.isInteger(r.id) && r.id > 0 ? r.id : null;
      const absent = new Set(ref && Array.isArray(r._absent) ? r._absent : []);
      valid.push({ data: full, src: r.src, ref, refTime: String(r.ref_time || "").slice(0, 19),
        present: fields.filter(f => f in data && !absent.has(f)) });
    }
    plan.valid = valid.map(v => v.data);
    if (!valid.length) return plan;
    const lo = valid.reduce((a, v) => (v.data.trx_date < a ? v.data.trx_date : a), valid[0].data.trx_date);
    const hi = valid.reduce((a, v) => (v.data.trx_date > a ? v.data.trx_date : a), valid[0].data.trx_date);
    plan.range = [lo, hi];
    const existing = new Map(DB[table].filter(r => r.trx_date >= lo && r.trx_date <= hi).map(r => [r.id, r]));
    for (const v of valid) {
      if (v.ref && !existing.has(v.ref)) {
        const r = DB[table].find(x => x.id === v.ref);
        if (r) existing.set(r.id, r);
      }
    }
    const consumed = new Set();
    // 1) 관리번호가 있는 행: 그 내역과 비교
    for (const v of valid) {
      if (!v.ref) continue;
      const row = existing.get(v.ref);
      const shown = Object.assign({}, v.data, { src: v.src });
      if (!row) { counts.missing++; note("missing", shown, `관리번호 ${v.ref} 내역이 시스템에 없습니다(삭제된 내역).`); continue; }
      if (consumed.has(row.id)) { counts.invalid++; note("invalid", shown, `관리번호 ${v.ref}이(가) 파일에 두 번 있습니다.`); continue; }
      consumed.add(row.id);
      const merged = {};
      for (const f of fields) merged[f] = row[f];
      for (const f of v.present) merged[f] = v.data[f];
      const [clean, e] = cleanEntry(merged, table, false);
      if (e) { counts.invalid++; note("invalid", shown, e); continue; }
      const changes = {};
      for (const f of fields) if (f in clean && !sameValue(f, clean[f], row[f])) changes[f] = clean[f];
      if (!Object.keys(changes).length) { counts.same++; continue; }
      const last = [row.created_at || "", row.updated_at || ""].sort().pop();
      if (v.refTime && last > v.refTime) {
        counts.conflict++;
        note("conflict", shown, `관리번호 ${v.ref}: 파일을 받은 뒤 시스템에서 고친 내역이라 덮어쓰지 않았습니다.`);
        continue;
      }
      plan.updates.push([row.id, changes]);
      counts.updated++;
      note("updated", shown, "바뀐 항목: " + Object.keys(changes).map(f => FIELD_LABELS[f] || f).join(", "));
    }
    // 2) 관리번호가 없는 행: 중복 판정 키로 맞춰 본다 (맞추기 모드는 엑셀 출처 내역부터 짝지음)
    const rank = r => (mode === "sync" && r.source === "excel" ? 0 : 1);
    const index = new Map();
    for (const r of [...existing.values()].sort((a, b) => (rank(a) - rank(b)) || a.id - b.id)) {
      if (consumed.has(r.id)) continue;
      const keys = new Set([dedupeKey(r, keyFields)]);
      if (r.import_key) keys.add(r.import_key);
      for (const k of keys) { if (!index.has(k)) index.set(k, []); index.get(k).push(r.id); }
    }
    for (const v of valid) {
      if (v.ref) continue;
      const k = dedupeKey(v.data, keyFields);
      const cands = index.get(k);
      let hit = null;
      while (cands && cands.length) { const id = cands.shift(); if (!consumed.has(id)) { hit = id; break; } }
      if (hit !== null) { consumed.add(hit); counts.same++; }
      else { plan.inserts.push(Object.assign({}, v.data, { import_key: k })); counts.added++; }
    }
    // 3) 엑셀 장부와 맞추기: 파일 기간 안의 엑셀 출처 내역 중 파일에 없는 것
    if (mode === "sync") {
      for (const r of existing.values()) {
        if (!consumed.has(r.id) && r.source === "excel" && r.trx_date >= lo && r.trx_date <= hi) {
          plan.deletes.push(r.id);
          note("deleted", r, "엑셀 파일에 없는 내역(예전에 엑셀로 올린 것)");
        }
      }
      counts.deleted = plan.deletes.length;
    }
    return plan;
  }

  function autoAddCodes(incomes, expenses, res) {
    const wanted = new Map();
    const want = (g, v, p) => { if (v) wanted.set(`${g}\u0001${v}\u0001${p}`, [g, v, p]); };
    const text = (r, f) => String(r[f] ?? "").trim();
    for (const r of incomes) {
      const it = text(r, "income_type");
      if (it) { want("income_type", it, ""); want("income_category", text(r, "category"), it); }
      if (text(r, "manufacturer") && text(r, "car_model")) want("car_model", text(r, "car_model"), text(r, "manufacturer"));
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

  function importExcel(me, body) {
    const incomes = body.incomes || [], expenses = body.expenses || [];
    const mode = body.mode || "append", dryRun = !!body.dry_run;
    if (!["append", "sync"].includes(mode)) return err(400, "mode는 append 또는 sync여야 합니다.");
    if (mode === "sync" && me.role !== "admin") return err(403, "엑셀 장부와 맞추기는 관리자만 할 수 있습니다.");
    if (!Array.isArray(incomes) || !Array.isArray(expenses)) return err(400, "incomes, expenses 배열이 필요합니다.");
    if (incomes.length + expenses.length > 50000) return err(400, "한 번에 50,000건까지 올릴 수 있습니다.");
    const plans = { incomes: planImport("incomes", incomes, mode), expenses: planImport("expenses", expenses, mode) };
    const res = { mode, dry_run: dryRun, backup: "", codes_added: 0, incomes: plans.incomes.counts,
      expenses: plans.expenses.counts,
      samples: { incomes: plans.incomes.samples, expenses: plans.expenses.samples },
      range: { incomes: plans.incomes.range, expenses: plans.expenses.range } };
    if (dryRun) return json(200, res);
    const changes = Object.values(plans).some(p => p.inserts.length || p.updates.length || p.deletes.length);
    if (changes && hasData()) res.backup = createBackup("pre-import").name;
    const who = `${userLabel(me)} (엑셀)`, now = nowStr();
    for (const [table, plan] of Object.entries(plans)) {
      for (const d of plan.inserts) {
        DB[table].push(Object.assign({}, DEFAULTS[table], d, { id: ++DB.seq[table], created_by: who, created_at: now, source: "excel" }));
      }
      for (const [id, ch] of plan.updates) {
        const row = DB[table].find(r => r.id === id);
        if (row) Object.assign(row, ch, { updated_by: who, updated_at: now });
      }
      if (plan.deletes.length) {
        const gone = new Set(plan.deletes);
        DB[table] = DB[table].filter(r => !gone.has(r.id));
      }
    }
    autoAddCodes(plans.incomes.valid, plans.expenses.valid, res);
    saveDB();
    return json(200, res);
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
        const field = body.field || BALANCE_FIELD[table];
        if (!SETTLE_FIELDS[table].includes(field)) return err(400, "정리할 항목이 올바르지 않습니다.");
        if (!row) return err(404, "해당 내역이 없습니다.");
        row[field] = 0;
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
    if (path === "/api/settle-bulk" && method === "POST") {
      const table = body.table;
      if (!SETTLE_FIELDS[table]) return err(400, "table은 incomes 또는 expenses여야 합니다.");
      const field = body.field || BALANCE_FIELD[table];
      if (!SETTLE_FIELDS[table].includes(field)) return err(400, "정리할 항목이 올바르지 않습니다.");
      const ids = body.ids;
      if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || !ids.every(i => Number.isInteger(i) && i > 0))
        return err(400, "ids는 1~1000개의 내역 번호 목록이어야 합니다.");
      const want = new Set(ids);
      let n = 0;
      for (const r of DB[table]) {
        if (want.has(r.id) && (r[field] || 0) > 0) {
          r[field] = 0;
          Object.assign(r, { updated_by: userLabel(me), updated_at: nowStr() });
          n++;
        }
      }
      saveDB();
      return json(200, { updated: n });
    }

    if (path === "/api/receivables") return receivables(q);
    if (path === "/api/agg") return aggregate(q);
    if (path === "/api/targets") {
      if (method === "GET") return json(200, { targets: DB.targets });
      if (method === "PUT") { const deny = needAdmin(); if (deny) return deny; return putTargets(body); }
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

    // 내보내기 · 입력 양식
    if (path === "/api/export.xlsx") return exportWorkbook(q, userLabel(me));
    if (path === "/api/template.xlsx") return templateWorkbook();

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
          data: { incomes: data.incomes, expenses: data.expenses, codes: data.codes || [], targets: data.targets || {} } });
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

    // 엑셀 올리기
    if (path === "/api/import-json" && method === "POST") return importExcel(me, body);

    if (path === "/api/meta") {
      const years = new Set([String(new Date().getFullYear())]);
      for (const t of ["incomes", "expenses"]) for (const r of DB[t]) years.add(r.trx_date.slice(0, 4));
      return json(200, { years: [...years].sort(), today: isoOf(new Date()), instance: DB.settings.instance_id });
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
