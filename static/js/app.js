/* 웰카오디오 매출/지출관리 시스템 - 프론트엔드 */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const fmt = v => Math.round(v || 0).toLocaleString("ko-KR");
  const fmtWon = v => "₩" + fmt(v);
  const pad2 = n => String(n).padStart(2, "0");
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const isoOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const todayStr = () => isoOf(new Date());
  const weekdayOf = s => {
    const d = new Date(s + "T00:00:00");
    return isNaN(d) ? "" : WEEKDAYS[d.getDay()] + "요일";
  };
  const daysSince = s => Math.max(0, Math.round((new Date(todayStr() + "T00:00:00") - new Date(s + "T00:00:00")) / 86400000));

  let CODES = {};
  let META = { years: [], today: todayStr() };
  let USER = null;
  let appReady = false;

  // ---------------------------------------------------------------- fetch
  /** 모든 API 요청: CSRF 방지 헤더를 붙이고, 로그인이 풀리면 로그인 화면으로 보낸다. */
  async function request(path, opts) {
    opts = opts || {};
    const headers = Object.assign({ "X-Requested-With": "XMLHttpRequest" }, opts.headers || {});
    const res = await fetch(path, Object.assign({ credentials: "same-origin" }, opts, { headers }));
    if (res.status === 401) {
      const body = await res.clone().json().catch(() => ({}));
      if (body.auth === "login") {
        showAuth("login", "로그인이 필요합니다. 다시 로그인하세요.");
        throw new Error(body.error || "로그인이 필요합니다.");
      }
    }
    return res;
  }
  async function api(path, opts) {
    const res = await request(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `요청 실패 (${res.status})`);
    return body;
  }
  const jsonOpts = (method, data) => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(data || {}) });
  const post = (p, data) => api(p, jsonOpts("POST", data));
  const put = (p, data) => api(p, jsonOpts("PUT", data));
  const del = p => api(p, { method: "DELETE" });

  /** 파일 내려받기 (오류가 나면 화면 이동 대신 알림) */
  async function download(url) {
    const res = await request(url);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `내려받기 실패 (${res.status})`);
    }
    const cd = res.headers.get("Content-Disposition") || "";
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="?([^";]+)"?/i.exec(cd);
    const name = star ? decodeURIComponent(star[1]) : (plain ? plain[1] : "download");
    const blobUrl = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    return name;
  }

  let toastTimer;
  function toast(msg, isError) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 4200 : 2600);
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // ---------------------------------------------------------------- theme
  const THEME_KEY = "wellcar_theme";
  const THEMES = [
    { id: "auto", label: "🌓 자동" },
    { id: "light", label: "☀️ 라이트" },
    { id: "dark", label: "🌙 다크" },
  ];
  function applyTheme(id) {
    if (id === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = id;
    const t = THEMES.find(t => t.id === id) || THEMES[0];
    $("themeToggle").textContent = t.label;
  }
  function currentTheme() {
    let saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (_e) { /* 저장소 사용 불가 */ }
    return THEMES.some(t => t.id === saved) ? saved : "auto";
  }
  $("themeToggle").addEventListener("click", () => {
    const idx = THEMES.findIndex(t => t.id === currentTheme());
    const next = THEMES[(idx + 1) % THEMES.length].id;
    try { localStorage.setItem(THEME_KEY, next); } catch (_e) { /* 무시 */ }
    applyTheme(next);
    // 차트는 렌더 시점에 색을 고정하므로 현재 화면을 다시 그린다
    const active = currentView();
    if (active && refreshers[active]) refreshers[active]();
  });
  applyTheme(currentTheme());

  // ---------------------------------------------------------------- 로그인 · 처음 설정
  const ROLE_RANK = { viewer: 1, staff: 2, admin: 3 };
  const can = role => USER && ROLE_RANK[USER.role] >= ROLE_RANK[role];

  function showAuth(mode, notice) {
    $("appShell").hidden = true;
    $("authScreen").hidden = false;
    $("loginForm").hidden = mode !== "login";
    $("setupForm").hidden = mode !== "setup";
    if (mode === "login") {
      if (notice) $("loginNotice").textContent = notice;
      $("loginError").textContent = "";
      $("loginPass").value = "";
      setTimeout(() => ($("loginUser").value ? $("loginPass") : $("loginUser")).focus(), 0);
    } else {
      setTimeout(() => $("setupCode").focus(), 0);
    }
  }

  async function startApp(user) {
    USER = user;
    document.body.classList.remove("role-admin", "role-staff", "role-viewer");
    document.body.classList.add("role-" + user.role);
    $("userName").textContent = user.name;
    $("userRole").textContent = user.role_label;
    $("userAvatar").textContent = (user.name || "?").trim().slice(0, 1).toUpperCase();
    $("authScreen").hidden = true;
    $("appShell").hidden = false;
    if (!appReady) {
      appReady = true;
      await init();
    } else {
      const v = currentView();
      showView(viewAllowed(v) ? v : "dashboard");
    }
  }

  $("loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("loginError").textContent = "";
    $("loginSubmit").disabled = true;
    try {
      const r = await post("/api/auth/login", {
        username: $("loginUser").value.trim(), password: $("loginPass").value,
        remember: $("loginRemember").checked,
      });
      $("loginPass").value = "";
      await startApp(r.user);
    } catch (err) {
      $("loginError").textContent = err.message;
    } finally {
      $("loginSubmit").disabled = false;
    }
  });

  $("setupForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("setupError").textContent = "";
    if ($("setupPass").value !== $("setupPass2").value) {
      $("setupError").textContent = "비밀번호 확인이 일치하지 않습니다.";
      return;
    }
    try {
      const r = await post("/api/auth/setup", {
        setup_code: $("setupCode").value, display_name: $("setupName").value.trim(),
        username: $("setupUser").value.trim(), password: $("setupPass").value,
      });
      toast("관리자 계정을 만들었습니다. 사용자관리에서 직원 계정을 추가할 수 있습니다.");
      await startApp(r.user);
    } catch (err) {
      $("setupError").textContent = err.message;
    }
  });

  // 사용자 메뉴
  function closeUserMenu() {
    $("userMenu").hidden = true;
    $("userBtn").setAttribute("aria-expanded", "false");
  }
  $("userBtn").addEventListener("click", e => {
    e.stopPropagation();
    const open = $("userMenu").hidden;
    $("userMenu").hidden = !open;
    $("userBtn").setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", e => { if (!e.target.closest(".user-menu")) closeUserMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeUserMenu(); });
  $("menuLogout").addEventListener("click", async () => {
    closeUserMenu();
    try { await post("/api/auth/logout"); } catch (_e) { /* 이미 만료 */ }
    location.reload();
  });
  $("menuPassword").addEventListener("click", () => {
    closeUserMenu();
    $("pwForm").reset();
    $("pwError").textContent = "";
    $("pwDialog").showModal();
  });
  $("pwForm").addEventListener("submit", async e => {
    e.preventDefault();
    if ($("pwNew").value !== $("pwNew2").value) {
      $("pwError").textContent = "새 비밀번호 확인이 일치하지 않습니다.";
      return;
    }
    try {
      await post("/api/auth/password", { current_password: $("pwCurrent").value, new_password: $("pwNew").value });
      $("pwDialog").close();
      toast("비밀번호를 바꿨습니다.");
    } catch (err) { $("pwError").textContent = err.message; }
  });
  document.querySelectorAll("dialog [data-close]").forEach(b =>
    b.addEventListener("click", () => b.closest("dialog").close()));

  // ---------------------------------------------------------------- tabs
  const views = ["dashboard", "income", "expense", "balances", "monthly", "quarterly", "yearly",
    "data", "codes", "users"];
  const ADMIN_VIEWS = new Set(["codes", "users"]);
  const refreshers = {};
  const viewAllowed = name => views.includes(name) && (!ADMIN_VIEWS.has(name) || can("admin"));
  const currentView = () => views.find(v => !$("view-" + v).hidden);
  function showView(name) {
    if (!viewAllowed(name)) name = "dashboard";
    views.forEach(v => { $("view-" + v).hidden = v !== name; });
    document.querySelectorAll("#mainTabs .tab").forEach(b =>
      b.classList.toggle("active", b.dataset.view === name));
    if (refreshers[name]) refreshers[name]();
  }
  $("mainTabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (btn) showView(btn.dataset.view);
  });

  // ---------------------------------------------------------------- 기간 선택 (목록·내보내기 공통)
  const PERIODS = [
    ["all", "전체 기간"], ["today", "오늘"], ["this-month", "이번 달"], ["last-month", "지난 달"],
    ["this-year", "올해"], ["last-year", "작년"], ["custom", "직접 지정"],
  ];
  function presetRange(key) {
    const t = new Date(), y = t.getFullYear(), m = t.getMonth();
    switch (key) {
      case "today": return [todayStr(), todayStr()];
      case "this-month": return [isoOf(new Date(y, m, 1)), isoOf(new Date(y, m + 1, 0))];
      case "last-month": return [isoOf(new Date(y, m - 1, 1)), isoOf(new Date(y, m, 0))];
      case "this-year": return [`${y}-01-01`, `${y}-12-31`];
      case "last-year": return [`${y - 1}-01-01`, `${y - 1}-12-31`];
      case "all": return ["", ""];
      default: return null;
    }
  }
  function bindPeriod(sel, fromEl, toEl, initial, onChange) {
    sel.innerHTML = PERIODS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("");
    sel.value = initial;
    const apply = () => {
      const r = presetRange(sel.value);
      if (r) { fromEl.value = r[0]; toEl.value = r[1]; }
    };
    apply();
    sel.addEventListener("change", () => { apply(); onChange(); });
    for (const el of [fromEl, toEl]) {
      el.addEventListener("change", () => { sel.value = "custom"; onChange(); });
    }
  }

  // ---------------------------------------------------------------- codes → selects
  function codeValues(group, parent) {
    let list = CODES[group] || [];
    if (parent !== undefined) list = list.filter(c => c.parent_value === parent);
    return list.map(c => c.code_value);
  }
  function fillSelect(sel, values, keep, labels) {
    const prev = keep ? sel.value : "";
    sel.innerHTML = values.map((v, i) =>
      `<option value="${esc(v)}">${esc(labels ? labels[i] : v)}</option>`).join("");
    if (prev && values.includes(prev)) sel.value = prev;
  }
  /** 저장된 값이 코드 목록에 없어도(엑셀에서 온 값 등) 선택 상자에 보이게 한다 */
  function setSelectValue(sel, value) {
    if (value && ![...sel.options].some(o => o.value === value)) {
      const o = document.createElement("option");
      o.value = value; o.textContent = value;
      sel.appendChild(o);
    }
    sel.value = value;
  }
  function refreshFormSelects() {
    fillSelect($("incType"), codeValues("income_type"), true);
    fillSelect($("incCategory"), codeValues("income_category", $("incType").value), true);
    fillSelect($("incManufacturer"), codeValues("manufacturer"), true);
    fillSelect($("incCurrency"), codeValues("currency"), true);
    fillSelect($("incPayment"), codeValues("payment_type"), true);
    fillSelect($("incAccount"), ["", ...codeValues("account")], true);
    fillSelect($("expType"), codeValues("expense_type"), true);
    fillSelect($("expItem"), codeValues("expense_item", $("expType").value), true);
    fillSelect($("expCurrency"), codeValues("currency"), true);
    fillSelect($("expPayment"), codeValues("payment_type"), true);
    $("clientList").innerHTML = codeValues("client").map(v => `<option value="${esc(v)}">`).join("");
    const inc = codeValues("income_type"), exp = codeValues("expense_type");
    fillSelect($("incTypeFilter"), ["", ...inc], true, ["모든 매출유형", ...inc]);
    fillSelect($("expTypeFilter"), ["", ...exp], true, ["모든 지출유형", ...exp]);
  }

  // ---------------------------------------------------------------- 매출 폼
  function vatFor(amount) {
    const vatApplies = $("incPayment").value === "카드" || $("incTaxInvoice").value === "Y";
    return vatApplies ? Math.round(amount * 10 / 110) : 0;
  }
  function calcIncome() {
    const qty = +$("incQty").value || 0;
    const unit = +$("incUnitPrice").value || 0;
    const rate = $("incCurrency").value === "CNY" ? (+$("incRate").value || 0) : 1;
    if (qty && unit) $("incAmount").value = Math.round(qty * unit * rate);
    const amount = +$("incAmount").value || 0;
    $("incVat").value = vatFor(amount);
    $("incNet").value = amount - (+$("incVat").value || 0);
  }
  ["incQty", "incUnitPrice", "incRate", "incCurrency", "incPayment", "incTaxInvoice"]
    .forEach(id => $(id).addEventListener("input", calcIncome));
  $("incAmount").addEventListener("input", () => {
    const amount = +$("incAmount").value || 0;
    $("incVat").value = vatFor(amount);
    $("incNet").value = amount - (+$("incVat").value || 0);
  });
  $("incVat").addEventListener("input", () => {
    $("incNet").value = (+$("incAmount").value || 0) - (+$("incVat").value || 0);
  });
  $("incDate").addEventListener("input", () => { $("incWeekday").value = weekdayOf($("incDate").value); });
  $("incType").addEventListener("change", () =>
    fillSelect($("incCategory"), codeValues("income_category", $("incType").value)));
  $("incCurrency").addEventListener("change", () => {
    if ($("incCurrency").value !== "CNY") $("incRate").value = 1;
  });
  $("incAllDue").addEventListener("click", () => { $("incReceivable").value = Math.max(+$("incAmount").value || 0, 0); });

  function auditText(r) {
    const parts = [];
    if (r.created_by) parts.push(`등록 ${r.created_by}${r.created_at ? " · " + r.created_at.slice(0, 16) : ""}`);
    if (r.updated_by) parts.push(`수정 ${r.updated_by}${r.updated_at ? " · " + r.updated_at.slice(0, 16) : ""}`);
    return parts.join("  ·  ");
  }

  function resetIncomeForm(dateVal) {
    $("incomeForm").reset();
    $("incId").value = "";
    $("incDate").value = dateVal || todayStr();
    $("incWeekday").value = weekdayOf($("incDate").value);
    $("incRate").value = 1; $("incQty").value = 1; $("incUnitPrice").value = 0; $("incReceivable").value = 0;
    refreshFormSelects();
    fillSelect($("incCategory"), codeValues("income_category", $("incType").value));
    $("incomeFormTitle").textContent = "매출 등록";
    $("incMeta").textContent = "";
    $("incSubmit").textContent = "등록";
    calcIncome();
  }
  $("incReset").addEventListener("click", () => resetIncomeForm());

  $("incomeForm").addEventListener("submit", async e => {
    e.preventDefault();
    const data = {
      trx_date: $("incDate").value,
      income_type: $("incType").value,
      category: $("incCategory").value,
      manufacturer: $("incManufacturer").value,
      product_model: $("incModel").value.trim(),
      client: $("incClient").value.trim(),
      currency: $("incCurrency").value,
      exchange_rate: +$("incRate").value || 1,
      quantity: +$("incQty").value || 1,
      unit_price: +$("incUnitPrice").value || 0,
      amount: +$("incAmount").value || 0,
      vat: +$("incVat").value || 0,
      net_amount: +$("incNet").value || 0,
      account: $("incAccount").value,
      payment_type: $("incPayment").value,
      tax_invoice: $("incTaxInvoice").value,
      memo: $("incMemo").value.trim(),
      receivable: +$("incReceivable").value || 0,
    };
    if (!data.amount) { toast("매출액을 입력하세요.", true); return; }
    if (data.receivable < 0 || data.receivable > Math.max(data.amount, 0)) {
      toast("미수금은 0원부터 매출액까지 입력할 수 있습니다.", true); return;
    }
    try {
      const id = $("incId").value;
      if (id) { await put(`/api/incomes/${id}`, data); toast("매출 내역이 수정되었습니다."); }
      else { await post("/api/incomes", data); toast("매출 내역이 등록되었습니다."); }
      resetIncomeForm(data.trx_date);
      lists.income.load();
    } catch (err) { toast(err.message, true); }
  });

  // ---------------------------------------------------------------- 지출 폼
  function calcExpense() {
    const qty = +$("expQty").value || 0;
    const unit = +$("expUnitPrice").value || 0;
    const rate = $("expCurrency").value === "CNY" ? (+$("expRate").value || 0) : 1;
    if (qty && unit) $("expAmount").value = Math.round(qty * unit * rate);
  }
  ["expQty", "expUnitPrice", "expRate", "expCurrency"]
    .forEach(id => $(id).addEventListener("input", calcExpense));
  $("expDate").addEventListener("input", () => { $("expWeekday").value = weekdayOf($("expDate").value); });
  $("expType").addEventListener("change", () =>
    fillSelect($("expItem"), codeValues("expense_item", $("expType").value)));
  $("expCurrency").addEventListener("change", () => {
    if ($("expCurrency").value !== "CNY") $("expRate").value = 1;
  });
  $("expAllDue").addEventListener("click", () => { $("expPayable").value = Math.max(+$("expAmount").value || 0, 0); });

  function resetExpenseForm(dateVal) {
    $("expenseForm").reset();
    $("expId").value = "";
    $("expDate").value = dateVal || todayStr();
    $("expWeekday").value = weekdayOf($("expDate").value);
    $("expRate").value = 1; $("expQty").value = 1; $("expUnitPrice").value = 0; $("expPayable").value = 0;
    refreshFormSelects();
    fillSelect($("expItem"), codeValues("expense_item", $("expType").value));
    $("expenseFormTitle").textContent = "지출 등록";
    $("expMeta").textContent = "";
    $("expSubmit").textContent = "등록";
  }
  $("expReset").addEventListener("click", () => resetExpenseForm());

  $("expenseForm").addEventListener("submit", async e => {
    e.preventDefault();
    const data = {
      trx_date: $("expDate").value,
      expense_type: $("expType").value,
      item: $("expItem").value,
      payment_type: $("expPayment").value,
      client: $("expClient").value.trim(),
      currency: $("expCurrency").value,
      exchange_rate: +$("expRate").value || 1,
      quantity: +$("expQty").value || 1,
      unit_price: +$("expUnitPrice").value || 0,
      amount: +$("expAmount").value || 0,
      memo: $("expMemo").value.trim(),
      payable: +$("expPayable").value || 0,
    };
    if (!data.amount) { toast("지출금액을 입력하세요.", true); return; }
    if (data.payable < 0 || data.payable > Math.max(data.amount, 0)) {
      toast("미지급금은 0원부터 지출금액까지 입력할 수 있습니다.", true); return;
    }
    try {
      const id = $("expId").value;
      if (id) { await put(`/api/expenses/${id}`, data); toast("지출 내역이 수정되었습니다."); }
      else { await post("/api/expenses", data); toast("지출 내역이 등록되었습니다."); }
      resetExpenseForm(data.trx_date);
      lists.expense.load();
    } catch (err) { toast(err.message, true); }
  });

  // ---------------------------------------------------------------- 내역 테이블
  /**
   * rows: 표시할 행, kind: income|expense,
   * summary: 서버가 준 검색 결과 전체 합계({total, sum}) — 없으면 표시 행으로 계산
   */
  function entryTable(rows, kind, summary) {
    if (!rows.length) return '<p class="empty-msg">조건에 맞는 내역이 없습니다.</p>';
    const isInc = kind === "income";
    // 좁은 카드에서도 금액이 먼저 보이도록 일자 다음에 금액을 배치한다
    const head = isInc
      ? "<th>일자</th><th class='num'>매출액</th><th>유형</th><th>구분</th><th>거래처</th><th class='num'>부가세</th><th class='num'>미수금</th><th>결제</th><th>적요</th><th></th>"
      : "<th>일자</th><th class='num'>지출금액</th><th>유형</th><th>품목</th><th>거래처</th><th class='num'>미지급</th><th>결제</th><th>적요</th><th></th>";
    const body = rows.map(r => {
      const date = `<td class="date">${esc(r.trx_date.slice(2))} <span class="wd">${esc(r.weekday)}</span></td>`;
      const cur = r.currency && r.currency !== "KRW" ? ` <span class="tag cur">${esc(r.currency)}</span>` : "";
      const amount = `<td class="num strong">${fmt(r.amount)}${cur}</td>`;
      const memo = `<td class="memo" title="${esc(r.memo)}">${esc(r.memo)}</td>`;
      const bal = isInc ? r.receivable : r.payable;
      const balCell = `<td class="num">${bal > 0 ? `<span class="due">${fmt(bal)}</span>` : ""}</td>`;
      const actions = `<td><span class="row-actions need-staff">
          <button class="icon-btn" data-edit="${kind}:${r.id}">수정</button>
          <button class="icon-btn del" data-del="${kind}:${r.id}">삭제</button></span></td>`;
      if (isInc) {
        return `<tr>${date}${amount}<td><span class="tag">${esc(r.income_type)}</span></td>` +
          `<td>${esc(r.category)}</td><td>${esc(r.client)}</td>` +
          `<td class="num">${fmt(r.vat)}</td>${balCell}<td>${esc(r.payment_type)}</td>${memo}${actions}</tr>`;
      }
      return `<tr>${date}${amount}<td><span class="tag">${esc(r.expense_type)}</span></td>` +
        `<td>${esc(r.item)}</td><td>${esc(r.client)}</td>${balCell}` +
        `<td>${esc(r.payment_type)}</td>${memo}${actions}</tr>`;
    }).join("");
    const count = summary ? summary.total : rows.length;
    const total = summary ? summary.sum.amount : rows.reduce((a, r) => a + r.amount, 0);
    const label = summary && summary.total > rows.length ? `전체 ${fmt(count)}건 합계` : `합계 · ${fmt(count)}건`;
    let tail;
    if (isInc) {
      const vat = summary ? summary.sum.vat : rows.reduce((a, r) => a + r.vat, 0);
      const due = summary ? summary.sum.balance : rows.reduce((a, r) => a + (r.receivable || 0), 0);
      tail = `<td colspan="3"></td><td class="num">${fmt(vat)}</td><td class="num">${due ? fmt(due) : ""}</td><td colspan="3"></td>`;
    } else {
      const due = summary ? summary.sum.balance : rows.reduce((a, r) => a + (r.payable || 0), 0);
      tail = `<td colspan="3"></td><td class="num">${due ? fmt(due) : ""}</td><td colspan="3"></td>`;
    }
    const totalRow = `<tr class="total-row"><td>${label}</td><td class="num">${fmt(total)}</td>${tail}</tr>`;
    return `<table class="data has-actions"><thead><tr>${head}</tr></thead>` +
      `<tbody>${body}${totalRow}</tbody></table>`;
  }

  /** 페이지 이동 버튼: ‹ 1 … 4 5 [6] 7 8 … 20 › */
  function renderPager(el, res, go) {
    if (res.pages <= 1) {
      el.innerHTML = res.total ? `<span class="pager-info">${fmt(res.total)}건</span>` : "";
      return;
    }
    const p = res.page, n = res.pages;
    const nums = new Set([1, n, p - 2, p - 1, p, p + 1, p + 2].filter(x => x >= 1 && x <= n));
    const sorted = [...nums].sort((a, b) => a - b);
    let html = `<button class="pg" data-page="${p - 1}" ${p === 1 ? "disabled" : ""} aria-label="이전 페이지">‹</button>`;
    let last = 0;
    for (const x of sorted) {
      if (x - last > 1) html += '<span class="pg-gap">…</span>';
      html += `<button class="pg${x === p ? " on" : ""}" data-page="${x}" ${x === p ? 'aria-current="page"' : ""}>${x}</button>`;
      last = x;
    }
    html += `<button class="pg" data-page="${p + 1}" ${p === n ? "disabled" : ""} aria-label="다음 페이지">›</button>`;
    const from = (p - 1) * res.size + 1, to = Math.min(p * res.size, res.total);
    html += `<span class="pager-info">${fmt(from)}–${fmt(to)} / ${fmt(res.total)}건</span>`;
    el.innerHTML = html;
    el.onclick = e => {
      const b = e.target.closest("[data-page]");
      if (b && !b.disabled) go(+b.dataset.page);
    };
  }

  /** 매출·지출 목록 (기간·유형·검색·미수 필터 + 페이지) */
  function makeEntryList(kind, prefix, table) {
    const el = id => $(prefix + id);
    const state = { page: 1, size: 50 };
    function params() {
      const p = new URLSearchParams();
      const set = (k, v) => { if (v) p.set(k, v); };
      set("from", el("From").value);
      set("to", el("To").value);
      set("type", el("TypeFilter").value);
      set("q", el("Search").value.trim());
      if (el("Outstanding").checked) p.set("outstanding", "1");
      return p;
    }
    let seq = 0;
    async function load(resetPage) {
      if (resetPage) state.page = 1;
      const p = params();
      p.set("page", state.page);
      p.set("size", state.size);
      const my = ++seq;
      try {
        const res = await api(`/api/${table}?${p}`);
        if (my !== seq) return;  // 늦게 도착한 이전 검색 결과는 버린다
        state.page = res.page;
        el("List").innerHTML = entryTable(res.items, kind, res);
        el("Count").textContent = `${fmt(res.total)}건`;
        renderPager(el("Pager"), res, page => { state.page = page; load(); el("List").scrollTop = 0; });
      } catch (err) { toast(err.message, true); }
    }
    bindPeriod(el("Period"), el("From"), el("To"), "all", () => load(true));
    el("TypeFilter").addEventListener("change", () => load(true));
    el("Outstanding").addEventListener("change", () => load(true));
    el("Search").addEventListener("input", debounce(() => load(true), 300));
    el("Export").addEventListener("click", async () => {
      const p = params();
      p.set("kind", table);
      try { toast(`${await download(`/api/export.xlsx?${p}`)} 파일을 받았습니다.`); }
      catch (err) { toast(err.message, true); }
    });
    return { load };
  }
  const lists = {
    income: makeEntryList("income", "inc", "incomes"),
    expense: makeEntryList("expense", "exp", "expenses"),
  };
  refreshers.income = () => lists.income.load();
  refreshers.expense = () => lists.expense.load();

  // 수정/삭제/완료 처리 위임
  const tableOf = kind => (kind === "income" ? "incomes" : "expenses");
  function refreshAfterChange() {
    const v = currentView();
    if (v === "dashboard") refreshers.dashboard();
    if (v === "income") lists.income.load();
    if (v === "expense") lists.expense.load();
    if (v === "balances") refreshers.balances();
  }
  document.body.addEventListener("click", async e => {
    const editBtn = e.target.closest("[data-edit]");
    const delBtn = e.target.closest("[data-del]");
    const settleBtn = e.target.closest("[data-settle]");
    if (editBtn) {
      const [kind, id] = editBtn.dataset.edit.split(":");
      try {
        const row = await api(`/api/${tableOf(kind)}/${id}`);
        if (kind === "income") fillIncomeForm(row); else fillExpenseForm(row);
      } catch (err) { toast(err.message, true); }
    } else if (delBtn) {
      const [kind, id] = delBtn.dataset.del.split(":");
      if (!confirm("이 내역을 삭제하시겠습니까?")) return;
      try {
        await del(`/api/${tableOf(kind)}/${id}`);
        toast("삭제되었습니다.");
        refreshAfterChange();
      } catch (err) { toast(err.message, true); }
    } else if (settleBtn) {
      const [kind, id] = settleBtn.dataset.settle.split(":");
      const what = kind === "income" ? "입금" : "지급";
      if (!confirm(`${what}이 끝났습니까? 이 건의 ${kind === "income" ? "미수금" : "미지급금"}을 0원으로 정리합니다.`)) return;
      try {
        await post(`/api/${tableOf(kind)}/${id}/settle`);
        toast(`${what} 완료로 처리했습니다.`);
        refreshAfterChange();
      } catch (err) { toast(err.message, true); }
    }
  });

  function fillIncomeForm(r) {
    showView("income");
    refreshFormSelects();
    $("incId").value = r.id;
    $("incDate").value = r.trx_date;
    $("incWeekday").value = weekdayOf(r.trx_date);
    setSelectValue($("incType"), r.income_type);
    fillSelect($("incCategory"), codeValues("income_category", r.income_type));
    setSelectValue($("incCategory"), r.category || "");
    setSelectValue($("incManufacturer"), r.manufacturer || "N/A");
    $("incModel").value = r.product_model || "";
    $("incClient").value = r.client || "";
    setSelectValue($("incCurrency"), r.currency || "KRW");
    $("incRate").value = r.exchange_rate || 1;
    $("incQty").value = r.quantity || 1;
    $("incUnitPrice").value = r.unit_price || 0;
    $("incAmount").value = r.amount;
    $("incVat").value = r.vat;
    $("incNet").value = r.net_amount;
    setSelectValue($("incAccount"), r.account || "");
    setSelectValue($("incPayment"), r.payment_type || "");
    $("incTaxInvoice").value = r.tax_invoice === "Y" ? "Y" : "N";
    $("incMemo").value = r.memo || "";
    $("incReceivable").value = r.receivable || 0;
    $("incomeFormTitle").textContent = `매출 수정 (#${r.id})`;
    $("incMeta").textContent = auditText(r);
    $("incSubmit").textContent = "수정 저장";
    $("incomeForm").scrollIntoView({ block: "nearest" });
  }

  function fillExpenseForm(r) {
    showView("expense");
    refreshFormSelects();
    $("expId").value = r.id;
    $("expDate").value = r.trx_date;
    $("expWeekday").value = weekdayOf(r.trx_date);
    setSelectValue($("expType"), r.expense_type);
    fillSelect($("expItem"), codeValues("expense_item", r.expense_type));
    setSelectValue($("expItem"), r.item || "");
    setSelectValue($("expPayment"), r.payment_type || "");
    $("expClient").value = r.client || "";
    setSelectValue($("expCurrency"), r.currency || "KRW");
    $("expRate").value = r.exchange_rate || 1;
    $("expQty").value = r.quantity || 1;
    $("expUnitPrice").value = r.unit_price || 0;
    $("expAmount").value = r.amount;
    $("expMemo").value = r.memo || "";
    $("expPayable").value = r.payable || 0;
    $("expenseFormTitle").textContent = `지출 수정 (#${r.id})`;
    $("expMeta").textContent = auditText(r);
    $("expSubmit").textContent = "수정 저장";
    $("expenseForm").scrollIntoView({ block: "nearest" });
  }

  // ---------------------------------------------------------------- 통계 카드
  const SERIES_COLOR = { income: "var(--series-income)", expense: "var(--series-expense)", profit: "var(--series-profit)" };

  function deltaChip(value, label) {
    if (value === undefined || value === null) return "";
    const cls = value > 0 ? "up" : value < 0 ? "down" : "flat";
    const mark = value > 0 ? "▲" : value < 0 ? "▼" : "―";
    const text = value === 0 ? "변동 없음" : `${mark} ${fmtWon(Math.abs(value))}`;
    return `<span class="delta ${cls}">${text}</span> <span>${label}</span>`;
  }

  /** 상단 강조 카드 (매출/지출/순익) */
  function kpi(label, value, accent, foot) {
    return `<div class="kpi" style="--kpi-color:${SERIES_COLOR[accent] || accent || "var(--accent)"}">
      <span class="kpi-label">${label}</span>
      <span class="kpi-value">${value}</span>
      <span class="kpi-foot">${foot || ""}</span>
    </div>`;
  }

  /** 보조 지표 (한 줄 스트립) */
  function metric(label, value, sub, attrs) {
    return `<div class="metric"${attrs || ""}><span class="m-label">${label}</span>` +
      `<span class="m-value">${value}</span>` +
      `<span class="m-sub">${sub || ""}</span></div>`;
  }

  const kpiRow = html => `<div class="kpi-row">${html}</div>`;

  // 날짜를 빠르게 넘길 때 늦게 도착한 이전 응답이 화면을 덮지 않도록 화면별 요청 번호를 둔다
  const latestReq = {};
  const nextReq = key => (latestReq[key] = (latestReq[key] || 0) + 1);
  const isStale = (key, n) => latestReq[key] !== n;
  const metricStrip = html => `<div class="metric-strip">${html}</div>`;

  // ---------------------------------------------------------------- 대시보드
  refreshers.dashboard = async function () {
    const d = $("dashDate").value || todayStr();
    $("dashDate").value = d;
    const req = nextReq("dashboard");
    try {
      const [stats, incRes, expRes] = await Promise.all([
        api(`/api/stats/daily?date=${d}`),
        api(`/api/incomes?date=${d}&size=500`),
        api(`/api/expenses?date=${d}&size=500`),
      ]);
      if (isStale("dashboard", req)) return;
      const day = stats.day.totals, prev = stats.prev_day.totals, mon = stats.month.totals;
      const out = stats.outstanding;
      const monthLabel = `${+d.slice(5, 7)}월 누계`;
      $("dashSubtitle").textContent =
        `${d} ${stats.weekday}요일 · 매출 ${day.income_count}건 · 지출 ${day.expense_count}건`;
      $("dashTiles").innerHTML =
        kpiRow(
          kpi("당일 매출", fmtWon(day.income), "income", deltaChip(day.income - prev.income, "전일대비")) +
          kpi("당일 지출", fmtWon(day.expense), "expense", deltaChip(day.expense - prev.expense, "전일대비")) +
          kpi("당일 순익", fmtWon(day.profit), "profit", deltaChip(day.profit - prev.profit, "전일대비"))
        ) +
        metricStrip(
          metric("당일 현금매출 (카드 외)", fmtWon(day.cash_income), `카드 ${fmtWon(day.card_income)}`) +
          metric(`${monthLabel} 매출`, fmtWon(mon.income), `부가세 ${fmtWon(mon.vat)}`) +
          metric(`${monthLabel} 지출`, fmtWon(mon.expense), `원가 ${fmtWon(mon.cost_expense)} · ${mon.cost_ratio}%`) +
          metric(`${monthLabel} 순익`, fmtWon(mon.profit), `지출비중 ${mon.expense_ratio}%`) +
          metric("당월 영업일수", `${mon.business_days}일`, `일평균 ${fmtWon(mon.avg_daily_income)}`) +
          metric("미수금 잔액", fmtWon(out.receivable),
            `${out.receivable_count}건 · 미지급 ${fmtWon(out.payable)}`,
            ' role="button" tabindex="0" data-goto="balances" title="미수·미지급 화면으로 이동"')
        );

      // 최근 14일 차트
      const seriesMap = new Map(stats.recent_series.map(s => [s.key, s]));
      const labels = [];
      const start = new Date(stats.recent_from + "T00:00:00");
      for (let i = 0; i < 14; i++) {
        const dt = new Date(start); dt.setDate(start.getDate() + i);
        labels.push(isoOf(dt));
      }
      drawIncomeExpenseChart($("dashChart"), labels,
        labels.map(k => (seriesMap.get(k) || {}).income || 0),
        labels.map(k => (seriesMap.get(k) || {}).expense || 0),
        k => k.slice(5).replace("-", "/"), 2);

      $("dashIncCount").textContent = `${incRes.total}건`;
      $("dashExpCount").textContent = `${expRes.total}건`;
      $("dashIncomeList").innerHTML = entryTable(incRes.items, "income");
      $("dashExpenseList").innerHTML = entryTable(expRes.items, "expense");
    } catch (err) { toast(err.message, true); }
  };
  $("dashTiles").addEventListener("click", e => {
    const g = e.target.closest("[data-goto]");
    if (g) showView(g.dataset.goto);
  });
  $("dashTiles").addEventListener("keydown", e => {
    const g = e.target.closest("[data-goto]");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showView(g.dataset.goto); }
  });

  function drawIncomeExpenseChart(elm, labels, incVals, expVals, xLabelFn, xTickEvery) {
    WCharts.groupedBars(elm, labels, [
      { name: "매출", color: getCss("--series-income"), values: incVals },
      { name: "지출", color: getCss("--series-expense"), values: expVals },
    ], { xLabelFn, xTickEvery, titleFn: l => l });
  }
  function getCss(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#2a78d6";
  }

  $("dashDate").addEventListener("change", refreshers.dashboard);
  $("dashToday").addEventListener("click", () => { $("dashDate").value = todayStr(); refreshers.dashboard(); });
  $("dashPrev").addEventListener("click", () => shiftDashDate(-1));
  $("dashNext").addEventListener("click", () => shiftDashDate(1));
  function shiftDashDate(delta) {
    const d = new Date($("dashDate").value + "T00:00:00");
    d.setDate(d.getDate() + delta);
    $("dashDate").value = isoOf(d);
    refreshers.dashboard();
  }
  $("dashAddIncome").addEventListener("click", () => { showView("income"); resetIncomeForm($("dashDate").value); });
  $("dashAddExpense").addEventListener("click", () => { showView("expense"); resetExpenseForm($("dashDate").value); });

  // ---------------------------------------------------------------- 미수금·미지급금
  function balanceTable(items, kind) {
    if (!items.length) return `<p class="empty-msg">${kind === "income" ? "미수금" : "미지급금"}이 남은 내역이 없습니다.</p>`;
    const isInc = kind === "income";
    const rows = items.map(r => {
      const bal = isInc ? r.receivable : r.payable;
      const age = daysSince(r.trx_date);
      const ageCls = age >= 60 ? "age old" : age >= 30 ? "age mid" : "age";
      return `<tr><td class="date">${esc(r.trx_date.slice(2))} <span class="wd">${esc(r.weekday)}</span></td>` +
        `<td>${esc(r.client) || '<span class="muted">(미지정)</span>'}</td>` +
        `<td><span class="tag">${esc(isInc ? r.income_type : r.expense_type)}</span></td>` +
        `<td class="num">${fmt(r.amount)}</td><td class="num strong"><span class="due">${fmt(bal)}</span></td>` +
        `<td class="num"><span class="${ageCls}">${age}일</span></td>` +
        `<td class="memo" title="${esc(r.memo)}">${esc(r.memo)}</td>` +
        `<td><span class="row-actions need-staff">` +
        `<button class="icon-btn ok" data-settle="${kind}:${r.id}">${isInc ? "입금 완료" : "지급 완료"}</button>` +
        `<button class="icon-btn" data-edit="${kind}:${r.id}">수정</button></span></td></tr>`;
    }).join("");
    const total = items.reduce((a, r) => a + (isInc ? r.receivable : r.payable), 0);
    return `<table class="data has-actions"><thead><tr><th>일자</th><th>거래처</th><th>유형</th>` +
      `<th class="num">${isInc ? "매출액" : "지출금액"}</th><th class="num">${isInc ? "미수금" : "미지급금"}</th>` +
      `<th class="num">경과</th><th>적요</th><th></th></tr></thead><tbody>${rows}` +
      `<tr class="total-row"><td>합계 · ${fmt(items.length)}건</td><td colspan="3"></td>` +
      `<td class="num">${fmt(total)}</td><td colspan="3"></td></tr></tbody></table>`;
  }

  refreshers.balances = async function () {
    try {
      const r = await api("/api/receivables");
      const inc = r.incomes, exp = r.expenses;
      $("balTiles").innerHTML = kpiRow(
        kpi("미수금 잔액 (받을 돈)", fmtWon(inc.total), "income", `${fmt(inc.count)}건 · 거래처 ${inc.by_client.length}곳`) +
        kpi("미지급금 잔액 (줄 돈)", fmtWon(exp.total), "expense", `${fmt(exp.count)}건 · 거래처 ${exp.by_client.length}곳`) +
        kpi("차액 (받을 돈 − 줄 돈)", fmtWon(inc.total - exp.total), "profit", "현금흐름 참고용")
      );
      WCharts.hBars($("balRecClients"), inc.by_client, getCss("--series-income"));
      WCharts.hBars($("balPayClients"), exp.by_client, getCss("--series-expense"));
      $("balRecCount").textContent = `${fmt(inc.count)}건`;
      $("balPayCount").textContent = `${fmt(exp.count)}건`;
      $("balRecList").innerHTML = balanceTable(inc.items, "income") +
        (inc.count > inc.items.length ? `<p class="form-hint">오래된 ${fmt(inc.items.length)}건만 표시합니다. 나머지는 매출관리에서 ‘미수금 남은 건만’으로 찾으세요.</p>` : "");
      $("balPayList").innerHTML = balanceTable(exp.items, "expense") +
        (exp.count > exp.items.length ? `<p class="form-hint">오래된 ${fmt(exp.items.length)}건만 표시합니다.</p>` : "");
    } catch (err) { toast(err.message, true); }
  };

  // ---------------------------------------------------------------- 공통 기간 뷰 렌더
  function periodTiles(t, prevT, prevLabel) {
    const foot = key => prevT ? deltaChip(t[key] - prevT[key], prevLabel) : "";
    return kpiRow(
      kpi("총 매출", fmtWon(t.income), "income", foot("income")) +
      kpi("총 지출", fmtWon(t.expense), "expense", foot("expense")) +
      kpi("영업이익", fmtWon(t.profit), "profit", foot("profit"))
    ) + metricStrip(
      metric("순매출액", fmtWon(t.net_income), `부가세 ${fmtWon(t.vat)}`) +
      metric("현금매출 (카드 외)", fmtWon(t.cash_income), `카드 ${fmtWon(t.card_income)}`) +
      metric("영업일수", `${t.business_days}일`, `일평균 ${fmtWon(t.avg_daily_income)}`) +
      metric("지출비중", `${t.expense_ratio}%`, `원가비중 ${t.cost_ratio}%`) +
      metric("등록 건수", `${fmt(t.income_count + t.expense_count)}건`,
        `매출 ${t.income_count} · 지출 ${t.expense_count}`)
    );
  }

  function seriesTable(series, keyLabel, keyFn) {
    if (!series.length) return '<p class="empty-msg">데이터가 없습니다.</p>';
    let tInc = 0, tExp = 0;
    const rows = series.map(s => {
      tInc += s.income; tExp += s.expense;
      const profitCls = s.profit > 0 ? "pos" : s.profit < 0 ? "neg" : "";
      return `<tr><td class="date">${keyFn ? keyFn(s.key) : s.key}</td>` +
        `<td class="num">${fmt(s.income)}</td><td class="num">${fmt(s.expense)}</td>` +
        `<td class="num strong ${profitCls}">${fmt(s.profit)}</td></tr>`;
    }).join("");
    const tp = tInc - tExp;
    return `<table class="data"><thead><tr><th>${keyLabel}</th>` +
      `<th class="num">매출</th><th class="num">지출</th><th class="num">손익</th></tr></thead>` +
      `<tbody>${rows}<tr class="total-row"><td>합계</td><td class="num">${fmt(tInc)}</td>` +
      `<td class="num">${fmt(tExp)}</td><td class="num ${tp >= 0 ? "pos" : "neg"}">${fmt(tp)}</td></tr></tbody></table>`;
  }

  // ---------------------------------------------------------------- 월별
  refreshers.monthly = async function () {
    const y = +$("monYear").value, m = +$("monMonth").value;
    const req = nextReq("monthly");
    try {
      const stats = await api(`/api/stats/monthly?year=${y}&month=${m}`);
      if (isStale("monthly", req)) return;
      $("monTiles").innerHTML = periodTiles(stats.totals, stats.prev_totals, "전월대비");
      // 해당 월 전체 일자 축
      const daysInMonth = new Date(y, m, 0).getDate();
      const map = new Map(stats.series.map(s => [s.key, s]));
      const labels = [];
      for (let d = 1; d <= daysInMonth; d++) labels.push(`${y}-${pad2(m)}-${pad2(d)}`);
      drawIncomeExpenseChart($("monChart"), labels,
        labels.map(k => (map.get(k) || {}).income || 0),
        labels.map(k => (map.get(k) || {}).expense || 0),
        k => +k.slice(8) + "일", 2);
      WCharts.hBars($("monIncBreak"), stats.income_by_category, getCss("--series-income"));
      WCharts.hBars($("monExpBreak"), stats.expense_by_type, getCss("--series-expense"));
      $("monTable").innerHTML = seriesTable(stats.series, "영업일자",
        k => `${k} (${weekdayOf(k).slice(0, 1)})`);
    } catch (err) { toast(err.message, true); }
  };
  $("monYear").addEventListener("change", refreshers.monthly);
  $("monMonth").addEventListener("change", refreshers.monthly);

  // ---------------------------------------------------------------- 분기별
  refreshers.quarterly = async function () {
    const y = +$("qtrYear").value, q = +$("qtrQuarter").value;
    const req = nextReq("quarterly");
    try {
      const stats = await api(`/api/stats/quarterly?year=${y}&quarter=${q}`);
      if (isStale("quarterly", req)) return;
      $("qtrTiles").innerHTML = periodTiles(stats.totals, stats.prev_totals, "전분기대비");
      const map = new Map(stats.series.map(s => [s.key, s]));
      const labels = [];
      for (let i = 0; i < 3; i++) labels.push(`${y}-${pad2((q - 1) * 3 + 1 + i)}`);
      drawIncomeExpenseChart($("qtrChart"), labels,
        labels.map(k => (map.get(k) || {}).income || 0),
        labels.map(k => (map.get(k) || {}).expense || 0),
        k => +k.slice(5) + "월", 1);
      WCharts.hBars($("qtrIncBreak"), stats.income_by_category, getCss("--series-income"));
      WCharts.hBars($("qtrExpBreak"), stats.expense_by_type, getCss("--series-expense"));
      $("qtrTable").innerHTML = seriesTable(
        labels.map(k => map.get(k) || { key: k, income: 0, expense: 0, profit: 0 }),
        "영업월", k => `${+k.slice(5)}월`);
    } catch (err) { toast(err.message, true); }
  };
  $("qtrYear").addEventListener("change", refreshers.quarterly);
  $("qtrQuarter").addEventListener("change", refreshers.quarterly);

  // ---------------------------------------------------------------- 연도별
  refreshers.yearly = async function () {
    const y = +$("yrYear").value;
    const req = nextReq("yearly");
    try {
      const stats = await api(`/api/stats/yearly?year=${y}`);
      if (isStale("yearly", req)) return;
      $("yrTiles").innerHTML = periodTiles(stats.totals, stats.prev_totals, "전년대비");
      const map = new Map(stats.series.map(s => [s.key, s]));
      const labels = [];
      for (let mm = 1; mm <= 12; mm++) labels.push(`${y}-${pad2(mm)}`);
      drawIncomeExpenseChart($("yrChart"), labels,
        labels.map(k => (map.get(k) || {}).income || 0),
        labels.map(k => (map.get(k) || {}).expense || 0),
        k => +k.slice(5) + "월", 1);
      WCharts.hBars($("yrIncBreak"), stats.income_by_category, getCss("--series-income"));
      WCharts.hBars($("yrClientBreak"), stats.top_clients, getCss("--series-income"));
      $("yrTable").innerHTML = seriesTable(
        labels.map(k => map.get(k) || { key: k, income: 0, expense: 0, profit: 0 }),
        "영업월", k => `${+k.slice(5)}월`);
    } catch (err) { toast(err.message, true); }
  };
  $("yrYear").addEventListener("change", refreshers.yearly);

  // ---------------------------------------------------------------- 코드관리
  const CODE_GROUPS = [
    { group: "income_type", name: "매출유형", childGroup: "income_category", childName: "매출구분" },
    { group: "expense_type", name: "지출유형", childGroup: "expense_item", childName: "거래품목" },
    { group: "payment_type", name: "결제유형" },
    { group: "account", name: "계좌" },
    { group: "manufacturer", name: "차량제조사" },
    { group: "client", name: "거래처" },
    { group: "currency", name: "거래통화" },
  ];

  refreshers.codes = function () {
    const area = $("codesArea");
    area.innerHTML = "";
    for (const def of CODE_GROUPS) {
      const card = document.createElement("div");
      card.className = "card code-card";
      let inner = `<h3>${def.name}</h3>`;
      if (!def.childGroup) {
        inner += `<div class="code-list">` + chipList(def.group, "") + `</div>` +
          addRow(def.group, "", `${def.name} 추가`);
      } else {
        inner += `<div class="code-sub">${def.name}과 각 유형에 속한 ${def.childName}을 관리합니다.</div>`;
        inner += `<div class="code-list">` + chipList(def.group, "") + `</div>` +
          addRow(def.group, "", `${def.name} 추가`);
        for (const parent of codeValues(def.group)) {
          inner += `<div class="code-parent-block">
            <div class="code-parent-label">${esc(parent)} — ${def.childName}</div>
            <div class="code-list">` + chipList(def.childGroup, parent) + `</div>` +
            addRow(def.childGroup, parent, `${def.childName} 추가`) + `</div>`;
        }
      }
      card.innerHTML = inner;
      area.appendChild(card);
    }
  };

  function chipList(group, parent) {
    const list = (CODES[group] || []).filter(c => c.parent_value === parent);
    if (!list.length) return '<span class="code-empty">등록된 항목 없음</span>';
    return list.map(c =>
      `<span class="code-chip">${esc(c.code_value)}<button data-code-del="${c.id}" title="삭제" aria-label="${esc(c.code_value)} 삭제">✕</button></span>`).join("");
  }
  function addRow(group, parent, placeholder) {
    const key = esc(`${group}|${parent}`);
    return `<div class="code-add">
      <input class="input" placeholder="${esc(placeholder)}" data-code-input="${key}">
      <button class="btn small" data-code-add="${key}">추가</button></div>`;
  }

  $("codesArea").addEventListener("click", async e => {
    const addBtn = e.target.closest("[data-code-add]");
    const delBtn = e.target.closest("[data-code-del]");
    if (addBtn) {
      const key = addBtn.dataset.codeAdd;
      const input = [...document.querySelectorAll("[data-code-input]")].find(i => i.dataset.codeInput === key);
      const value = input.value.trim();
      if (!value) return;
      const [group, parent] = key.split("|");
      try {
        await post("/api/codes", { code_group: group, code_value: value, parent_value: parent });
        await loadCodes();
        refreshers.codes();
        toast("코드가 추가되었습니다.");
      } catch (err) { toast(err.message, true); }
    } else if (delBtn) {
      if (!confirm("이 코드를 삭제하시겠습니까? (기존 등록 내역은 유지됩니다)")) return;
      try {
        await del(`/api/codes/${delBtn.dataset.codeDel}`);
        await loadCodes();
        refreshers.codes();
        toast("코드가 삭제되었습니다.");
      } catch (err) { toast(err.message, true); }
    }
  });
  $("codesArea").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.matches("[data-code-input]")) {
      e.preventDefault();
      const key = e.target.dataset.codeInput;
      const btn = [...document.querySelectorAll("[data-code-add]")].find(b => b.dataset.codeAdd === key);
      if (btn) btn.click();
    }
  });

  // ---------------------------------------------------------------- 데이터 관리: 엑셀 내보내기
  bindPeriod($("xpPeriod"), $("xpFrom"), $("xpTo"), "this-year", () => {});
  $("xpDownload").addEventListener("click", async () => {
    const p = new URLSearchParams({ kind: $("xpKind").value });
    if ($("xpFrom").value) p.set("from", $("xpFrom").value);
    if ($("xpTo").value) p.set("to", $("xpTo").value);
    $("xpDownload").disabled = true;
    try { toast(`${await download(`/api/export.xlsx?${p}`)} 파일을 받았습니다.`); }
    catch (err) { toast(err.message, true); }
    finally { $("xpDownload").disabled = false; }
  });

  // ---------------------------------------------------------------- 데이터 관리: 엑셀 가져오기
  let imp = null;  // { files: [parse 결과], selected: Set(sheet id) }

  function importReset() {
    imp = null;
    $("importFile").value = "";
    $("importFileName").textContent = "";
    $("importPreview").hidden = true;
    $("importResult").hidden = true;
  }

  async function handleImportFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const bad = files.filter(f => !/\.(xlsx|xlsm)$/i.test(f.name));
    if (bad.length) { toast("xlsx 또는 xlsm 파일만 올릴 수 있습니다: " + bad.map(f => f.name).join(", "), true); return; }
    $("importResult").hidden = true;
    $("importPreview").hidden = true;
    $("importFile").value = ""; // 같은 파일을 다시 선택해도 change 이벤트가 발생하도록
    const parsed = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      $("importFileName").textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(2)}MB) 분석 중… ${files.length > 1 ? `(${i + 1}/${files.length})` : ""}`;
      try {
        parsed.push(await WellcarXlsx.parse(f));
      } catch (err) {
        toast(`${f.name} 분석 실패: ${err.message}`, true);
        $("importFileName").textContent = "";
        return;
      }
    }
    $("importFileName").textContent = files.map(f => f.name).join(", ");
    const sheets = parsed.flatMap(p => p.sheets);
    sheets.forEach((s, i) => { s.id = "s" + i; });  // 화면의 체크박스와 짝을 맞추는 간단한 번호
    imp = { files: parsed, sheets, selected: new Set(sheets.filter(s => s.records.length).map(s => s.id)) };
    renderImportPreview();
  }

  const monthKey = d => d.slice(0, 7);
  function monthAgg(records) {
    const m = new Map();
    for (const r of records) {
      const k = monthKey(r.trx_date);
      const s = m.get(k) || { count: 0, sum: 0 };
      s.count++; s.sum += r.amount;
      m.set(k, s);
    }
    return m;
  }
  const statusChip = (ok, okText, badText) =>
    `<span class="status ${ok ? "ok" : "warn"}">${ok ? "✓ " + okText : "⚠ " + badText}</span>`;

  /** 엑셀 경영분석(월별 합계) 시트와 읽어 낸 내역의 월별 합계를 비교 */
  function summaryCheck(combined) {
    const sums = imp.files.flatMap(f => f.summaries.map(s => Object.assign({ file: f.file }, s)));
    if (!sums.length) {
      return `<p class="form-hint">파일에 월별 합계 시트(경영분석)가 없어 엑셀 자체 합계와의 대조는 건너뜁니다.</p>`;
    }
    const inc = monthAgg(combined.incomes), exp = monthAgg(combined.expenses);
    // 경영분석 표에는 월만 있으므로, 같은 파일에서 고른 시트의 내역에 가장 많이 나온 연도로 본다
    const yearOfFile = file => {
      const years = new Map();
      for (const sh of imp.sheets) {
        if (sh.file !== file || !imp.selected.has(sh.id)) continue;
        for (const r of sh.records) {
          const y = +r.trx_date.slice(0, 4);
          years.set(y, (years.get(y) || 0) + 1);
        }
      }
      const top = [...years.entries()].sort((a, b) => b[1] - a[1])[0];
      return top ? top[0] : new Date().getFullYear();
    };
    let html = "";
    for (const s of sums) {
      const rows = [];
      let allOk = true;
      const fileYear = yearOfFile(s.file);
      for (const mo of s.months) {
        const y = mo.year || fileYear;
        const k = `${y}-${pad2(mo.month)}`;
        const fi = (inc.get(k) || {}).sum || 0, fe = (exp.get(k) || {}).sum || 0;
        if (!fi && !fe && !mo.income && !mo.expense) continue;
        const ok = fi === mo.income && fe === mo.expense;
        allOk = allOk && ok;
        rows.push(`<tr><td>${k}</td><td class="num">${fmt(fi)}</td><td class="num">${fmt(mo.income)}</td>` +
          `<td class="num">${fmt(fe)}</td><td class="num">${fmt(mo.expense)}</td>` +
          `<td>${statusChip(ok, "일치", `차이 매출 ${fmt(fi - mo.income)} · 지출 ${fmt(fe - mo.expense)}`)}</td></tr>`);
      }
      if (!rows.length) continue;
      html += `<div class="recon">
        <div class="recon-head"><b>엑셀 ‘${esc(s.sheet)}’ 월별 합계와 대조</b> ${statusChip(allOk, "모든 달 일치", "차이가 있는 달이 있습니다")}</div>
        <div class="table-wrap"><table class="data compact"><thead><tr><th>월</th><th class="num">매출(읽은 내역)</th><th class="num">매출(엑셀 합계)</th>
        <th class="num">지출(읽은 내역)</th><th class="num">지출(엑셀 합계)</th><th>결과</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
        ${allOk ? "" : '<p class="form-hint">차이가 나면 아래 ‘건너뛴 행과 확인할 점’을 보고, 엑셀에서 해당 달의 행을 확인하세요. 체크를 해제한 시트가 있으면 그만큼 차이가 납니다.</p>'}
      </div>`;
    }
    return html || `<p class="form-hint">월별 합계 시트가 있지만 금액이 모두 0이어서 대조할 내용이 없습니다.</p>`;
  }

  function renderImportPreview() {
    const multi = imp.files.length > 1;
    if (!imp.sheets.length) {
      $("importSummary").innerHTML =
        '<p class="empty-msg">매출집계/지출집계 형식의 시트를 찾지 못했습니다.<br>' +
        "'영업일자'와 '매출액'(또는 '지출금액') 열이 있는 시트가 필요합니다.</p>";
      $("importPreview").hidden = false;
      $("importCommit").disabled = true;
      return;
    }
    const c = WellcarXlsx.combine(imp.sheets, imp.selected);
    imp.combined = c;
    const all = [...c.incomes, ...c.expenses];
    const dates = all.map(r => r.trx_date).sort();
    const incSum = c.incomes.reduce((a, r) => a + r.amount, 0);
    const expSum = c.expenses.reduce((a, r) => a + r.amount, 0);
    const recv = c.incomes.filter(r => r.receivable > 0);
    const payb = c.expenses.filter(r => r.payable > 0);
    const foreign = all.filter(r => r.currency !== "KRW").length;
    const sheetRows = imp.sheets.map(s => {
      const ps = c.perSheet[s.id] || { used: 0, dup: 0 };
      const on = imp.selected.has(s.id);
      const sum = s.records.reduce((a, r) => a + r.amount, 0);
      return `<tr class="${on ? "" : "off"}"><td><label class="check"><input type="checkbox" data-sheet="${esc(s.id)}" ${on ? "checked" : ""}> ${esc(s.name)}</label></td>` +
        (multi ? `<td class="muted">${esc(s.file)}</td>` : "") +
        `<td>${s.kind === "income" ? "매출" : "지출"}</td><td class="num">${fmt(s.records.length)}건</td>` +
        `<td class="num">${fmt(sum)}</td><td class="num">${on && ps.dup ? fmt(ps.dup) + "건" : ""}</td>` +
        `<td class="num">${s.skipped ? fmt(s.skipped) + "행" : ""}</td></tr>`;
    }).join("");
    // 건너뛴 행을 먼저, 등록은 되는 참고 사항은 뒤에
    const issues = imp.files.flatMap(f => f.issues)
      .sort((a, b) => (a.level === "skip" ? 0 : 1) - (b.level === "skip" ? 0 : 1));
    const skipN = issues.filter(i => i.level === "skip").length;
    const issueList = issues.length
      ? `<details class="issues"${skipN ? " open" : ""}><summary>건너뛴 행 ${fmt(skipN)}건 · 참고 ${fmt(issues.length - skipN)}건${issues.length >= 300 ? " (일부만 표시)" : ""}</summary>
          <ul>${issues.map(i => `<li class="${i.level === "skip" ? "skip" : ""}"><b>${multi ? esc(i.file) + " › " : ""}${esc(i.sheet)} ${i.row}행</b> — ${esc(i.reason)}</li>`).join("")}</ul></details>`
      : "";
    $("importSummary").innerHTML =
      `<div class="import-stats">
        <span class="import-stat">매출<b>${fmt(c.incomes.length)}건 · ${fmtWon(incSum)}</b></span>
        <span class="import-stat">지출<b>${fmt(c.expenses.length)}건 · ${fmtWon(expSum)}</b></span>
        <span class="import-stat">기간<b>${dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : "-"}</b></span>
        ${recv.length ? `<span class="import-stat">미수금<b>${fmt(recv.length)}건 · ${fmtWon(recv.reduce((a, r) => a + r.receivable, 0))}</b></span>` : ""}
        ${payb.length ? `<span class="import-stat">미지급금<b>${fmt(payb.length)}건 · ${fmtWon(payb.reduce((a, r) => a + r.payable, 0))}</b></span>` : ""}
        ${foreign ? `<span class="import-stat">외화 거래<b>${fmt(foreign)}건</b></span>` : ""}
        ${c.dupInFile ? `<span class="import-stat">시트 간 중복 제외<b>${fmt(c.dupInFile)}건</b></span>` : ""}
      </div>
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="data compact"><thead><tr><th>시트 (체크한 시트만 저장)</th>${multi ? "<th>파일</th>" : ""}<th>종류</th>
        <th class="num">읽은 건수</th><th class="num">금액 합계</th><th class="num">다른 시트와 중복</th><th class="num">건너뛴 행</th></tr></thead>
        <tbody>${sheetRows}</tbody></table>
      </div>
      ${summaryCheck(c)}
      ${issueList}`;
    $("importPreview").hidden = false;
    $("importCommit").disabled = !all.length;
  }

  $("importSummary").addEventListener("change", e => {
    const cb = e.target.closest("[data-sheet]");
    if (!cb || !imp) return;
    if (cb.checked) imp.selected.add(cb.dataset.sheet); else imp.selected.delete(cb.dataset.sheet);
    renderImportPreview();
  });

  $("importBrowse").addEventListener("click", () => $("importFile").click());
  $("importFile").addEventListener("change", () => handleImportFiles($("importFile").files));
  $("importCancel").addEventListener("click", importReset);
  const drop = $("importDrop");
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("dragover"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
  drop.addEventListener("drop", e => {
    e.preventDefault();
    drop.classList.remove("dragover");
    handleImportFiles(e.dataTransfer.files);
  });

  /** 저장 후: 파일에서 읽은 월별 건수·금액과 시스템(DB)의 월별 건수·금액 대조 */
  async function reconcileAfterImport(c) {
    const dates = [...c.incomes, ...c.expenses].map(r => r.trx_date).sort();
    if (!dates.length) return "";
    const months = await api(`/api/stats/months?from=${dates[0]}&to=${dates[dates.length - 1]}`);
    const db = new Map(months.map(m => [m.month, m]));
    const inc = monthAgg(c.incomes), exp = monthAgg(c.expenses);
    const keys = [...new Set([...inc.keys(), ...exp.keys()])].sort();
    let missing = 0, extra = 0;
    const rows = keys.map(k => {
      const fi = inc.get(k) || { count: 0, sum: 0 }, fe = exp.get(k) || { count: 0, sum: 0 };
      const d = db.get(k) || { income_count: 0, income: 0, expense_count: 0, expense: 0 };
      const same = fi.count === d.income_count && fi.sum === d.income && fe.count === d.expense_count && fe.sum === d.expense;
      const more = !same && d.income_count >= fi.count && d.expense_count >= fe.count;
      if (!same && !more) missing++;
      if (more) extra++;
      const st = same ? '<span class="status ok">✓ 일치</span>'
        : more ? '<span class="status info">＋ 시스템에 다른 내역도 있음</span>'
          : '<span class="status warn">⚠ 시스템이 더 적음</span>';
      return `<tr><td>${k}</td><td class="num">${fmt(fi.count)}건 · ${fmt(fi.sum)}</td><td class="num">${fmt(d.income_count)}건 · ${fmt(d.income)}</td>` +
        `<td class="num">${fmt(fe.count)}건 · ${fmt(fe.sum)}</td><td class="num">${fmt(d.expense_count)}건 · ${fmt(d.expense)}</td><td>${st}</td></tr>`;
    }).join("");
    const head = missing
      ? `<span class="status warn">⚠ ${missing}개 달은 시스템 건수가 파일보다 적습니다. 형식 오류로 빠진 행이 있는지 확인하세요.</span>`
      : `<span class="status ok">✓ 파일의 내역이 모두 시스템에 들어 있습니다.</span>` +
        (extra ? ` <span class="muted">(${extra}개 달은 직접 입력한 내역 등이 더 있어 시스템 쪽이 큽니다)</span>` : "");
    return `<div class="recon"><div class="recon-head"><b>가져온 뒤 대조 (파일 ↔ 시스템)</b> ${head}</div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>월</th><th class="num">매출 · 파일</th><th class="num">매출 · 시스템</th>
      <th class="num">지출 · 파일</th><th class="num">지출 · 시스템</th><th>결과</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  $("importCommit").addEventListener("click", async () => {
    if (!imp || !imp.combined) return;
    const c = imp.combined;
    $("importCommit").disabled = true;
    $("importCommit").textContent = "저장 중…";
    try {
      const r = await post("/api/import-json", { incomes: c.incomes, expenses: c.expenses });
      const detail = (added, skipped, invalid) =>
        `<b>${fmt(added)}건 등록</b>` +
        (skipped ? ` · 이미 있어 건너뜀 ${fmt(skipped)}건` : "") +
        (invalid ? ` · 형식 오류 ${fmt(invalid)}건` : "");
      const invalid = (r.invalid_samples || []).map(s =>
        `<li><b>${esc(s.src) || "(위치 모름)"}</b> — ${esc(s.reason)}</li>`).join("");
      let recon = "";
      try { recon = await reconcileAfterImport(c); } catch (_e) { /* 대조 실패는 결과 표시를 막지 않음 */ }
      $("importResult").innerHTML = `<div class="import-result-box">
        <span class="res-title">✓ 가져오기 완료</span>
        <span>매출 ${detail(r.incomes_added, r.incomes_skipped, r.incomes_invalid)}</span>
        <span>지출 ${detail(r.expenses_added, r.expenses_skipped, r.expenses_invalid)}</span>
        <span>${r.codes_added ? `신규 코드 ${fmt(r.codes_added)}개가 코드관리에 자동 추가되었습니다.` : "신규 코드는 없습니다."}</span>
        ${r.backup ? `<span class="muted">가져오기 직전 상태를 백업했습니다: ${esc(r.backup)}</span>` : ""}
        ${invalid ? `<details class="issues"><summary>등록하지 못한 행 보기</summary><ul>${invalid}</ul></details>` : ""}
      </div>${recon}`;
      $("importResult").hidden = false;
      $("importPreview").hidden = true;
      imp = null;
      await Promise.all([loadCodes(), loadMeta()]);
      loadBackups();
      toast("엑셀 데이터 가져오기가 완료되었습니다.");
    } catch (err) {
      toast(err.message, true);
    } finally {
      $("importCommit").disabled = false;
      $("importCommit").textContent = "DB에 저장";
    }
  });

  // ---------------------------------------------------------------- 데이터 관리: 백업·복원
  const fmtSize = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`;
  async function loadBackups() {
    if (!can("admin")) return;
    try {
      const b = await api("/api/backups");
      $("backupStatus").innerHTML =
        `자동 백업: <b>하루 1번</b>(사용 중일 때) · 자동·수동 백업은 최근 <b>${b.keep.auto}개</b>, ` +
        `가져오기·복원 직전 백업은 <b>${b.keep["pre-import"]}개</b>씩 보관 · ` +
        `마지막 자동 백업 <b>${b.last_auto ? esc(b.last_auto.slice(0, 16)) : "아직 없음"}</b><br>` +
        `<span class="muted">백업 폴더: ${esc(b.dir)} — 컴퓨터 고장에 대비해 가끔 [받기]로 다른 곳(USB·클라우드)에도 보관하세요.</span>`;
      if (!b.items.length) { $("backupList").innerHTML = '<p class="empty-msg">아직 백업이 없습니다.</p>'; return; }
      $("backupList").innerHTML = `<table class="data has-actions compact"><thead><tr><th>만든 시각</th><th>종류</th>` +
        `<th class="num">크기</th><th>파일</th><th></th></tr></thead><tbody>` +
        b.items.map(it => `<tr><td class="date">${esc(it.created_at.slice(0, 16))}</td>` +
          `<td><span class="tag kind-${esc(it.kind)}">${esc(it.kind_label)}</span></td>` +
          `<td class="num">${fmtSize(it.size)}</td><td class="memo muted">${esc(it.name)}</td>` +
          `<td><span class="row-actions">` +
          `<button class="icon-btn" data-bk-dl="${esc(it.name)}">받기</button>` +
          `<button class="icon-btn" data-bk-restore="${esc(it.name)}">복원</button>` +
          `<button class="icon-btn del" data-bk-del="${esc(it.name)}">삭제</button></span></td></tr>`).join("") +
        `</tbody></table>`;
    } catch (err) { toast(err.message, true); }
  }

  async function restoreBackup(name, when) {
    if (!confirm(`${when} 백업으로 되돌립니다.\n\n매출·지출 내역과 코드가 그 시점으로 바뀝니다(사용자 계정은 그대로).\n지금 데이터는 ‘복원 직전’ 백업으로 자동 보관됩니다.\n\n계속할까요?`)) return;
    try {
      const r = await post(`/api/backups/${encodeURIComponent(name)}/restore`);
      toast(`복원했습니다: 매출 ${fmt(r.restored.incomes || 0)}건, 지출 ${fmt(r.restored.expenses || 0)}건`);
      await Promise.all([loadCodes(), loadMeta()]);
      loadBackups();
    } catch (err) { toast(err.message, true); }
  }

  $("backupList").addEventListener("click", async e => {
    const dl = e.target.closest("[data-bk-dl]");
    const rs = e.target.closest("[data-bk-restore]");
    const rm = e.target.closest("[data-bk-del]");
    try {
      if (dl) {
        await download(`/api/backups/${encodeURIComponent(dl.dataset.bkDl)}/download`);
      } else if (rs) {
        const row = rs.closest("tr");
        await restoreBackup(rs.dataset.bkRestore, `‘${row.cells[0].textContent}’`);
      } else if (rm) {
        if (!confirm("이 백업 파일을 삭제할까요? 되돌릴 수 없습니다.")) return;
        await del(`/api/backups/${encodeURIComponent(rm.dataset.bkDel)}`);
        toast("백업 파일을 삭제했습니다.");
        loadBackups();
      }
    } catch (err) { toast(err.message, true); }
  });
  $("backupNow").addEventListener("click", async () => {
    try {
      const it = await post("/api/backups");
      toast(`백업했습니다: ${it.name}`);
      loadBackups();
    } catch (err) { toast(err.message, true); }
  });
  $("backupUploadBtn").addEventListener("click", () => $("backupUpload").click());
  $("backupUpload").addEventListener("change", async () => {
    const f = $("backupUpload").files[0];
    $("backupUpload").value = "";
    if (!f) return;
    const fd = new FormData();
    fd.append("file", f);
    try {
      const it = await api("/api/backups/upload", { method: "POST", body: fd });
      loadBackups();
      await restoreBackup(it.name, `올린 파일 ‘${f.name}’의`);
    } catch (err) { toast(err.message, true); }
  });

  refreshers.data = () => loadBackups();

  // ---------------------------------------------------------------- 사용자관리
  let usersCache = [];
  refreshers.users = async function () {
    try {
      usersCache = await api("/api/users");
      $("userList").innerHTML = `<table class="data has-actions"><thead><tr><th>이름</th><th>아이디</th><th>권한</th>` +
        `<th>상태</th><th>마지막 로그인</th><th></th></tr></thead><tbody>` +
        usersCache.map(u => `<tr class="${u.active ? "" : "off"}"><td class="strong">${esc(u.name)}${u.id === USER.id ? ' <span class="tag">나</span>' : ""}</td>` +
          `<td>${esc(u.username)}</td><td><span class="tag role-${esc(u.role)}">${esc(u.role_label)}</span></td>` +
          `<td>${u.active ? '<span class="status ok">사용 중</span>' : '<span class="status warn">사용 중지</span>'}</td>` +
          `<td class="date">${esc((u.last_login_at || "-").slice(0, 16))}</td>` +
          `<td><span class="row-actions"><button class="icon-btn" data-user-edit="${u.id}">수정</button>` +
          (u.id === USER.id ? "" : `<button class="icon-btn del" data-user-del="${u.id}">삭제</button>`) +
          `</span></td></tr>`).join("") + `</tbody></table>`;
    } catch (err) { toast(err.message, true); }
  };

  function openUserDialog(u) {
    $("userForm").reset();
    $("udError").textContent = "";
    $("udId").value = u ? u.id : "";
    $("userDialogTitle").textContent = u ? `사용자 수정 — ${u.name}` : "사용자 추가";
    $("udName").value = u ? u.display_name : "";
    $("udUser").value = u ? u.username : "";
    $("udUser").readOnly = !!u;
    $("udRole").value = u ? u.role : "staff";
    $("udActive").checked = u ? u.active : true;
    $("udActiveWrap").hidden = !u;
    const self = u && u.id === USER.id;
    $("udRole").disabled = !!self;
    $("udActive").disabled = !!self;
    $("udPass").required = !u;
    $("udPassLabel").textContent = u ? "새 비밀번호 (바꿀 때만, 8자 이상)" : "비밀번호 (8자 이상)";
    $("userDialog").showModal();
  }
  $("userAdd").addEventListener("click", () => openUserDialog(null));
  $("userList").addEventListener("click", async e => {
    const ed = e.target.closest("[data-user-edit]");
    const rm = e.target.closest("[data-user-del]");
    if (ed) openUserDialog(usersCache.find(u => u.id === +ed.dataset.userEdit));
    if (rm) {
      const u = usersCache.find(x => x.id === +rm.dataset.userDel);
      if (!confirm(`‘${u.name}’ 계정을 삭제할까요?\n기록을 남기려면 삭제 대신 [수정]에서 사용 중지를 하세요.`)) return;
      try { await del(`/api/users/${u.id}`); toast("삭제했습니다."); refreshers.users(); }
      catch (err) { toast(err.message, true); }
    }
  });
  $("userForm").addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("udId").value;
    const data = { display_name: $("udName").value.trim(), role: $("udRole").value };
    if ($("udPass").value) data.password = $("udPass").value;
    try {
      if (id) {
        if (!$("udActive").disabled) data.active = $("udActive").checked;
        if ($("udRole").disabled) delete data.role;
        await put(`/api/users/${id}`, data);
      } else {
        data.username = $("udUser").value.trim();
        await post("/api/users", data);
      }
      $("userDialog").close();
      toast(id ? "사용자 정보를 저장했습니다." : "사용자를 추가했습니다.");
      refreshers.users();
    } catch (err) { $("udError").textContent = err.message; }
  });

  // ---------------------------------------------------------------- init
  async function loadCodes() { CODES = await api("/api/codes"); refreshFormSelects(); }

  async function loadMeta() {
    try { META = await api("/api/meta"); } catch (_e) { /* 기본값 유지 */ }
    const now = new Date();
    const years = META.years.length ? META.years : [String(now.getFullYear())];
    for (const sel of [$("monYear"), $("qtrYear"), $("yrYear")]) {
      const prev = sel.value;
      fillSelect(sel, years.map(String), false, years.map(y => y + "년"));
      sel.value = prev && years.includes(prev) ? prev : String(now.getFullYear());
      if (!sel.value) sel.value = years[years.length - 1];
    }
  }

  async function init() {
    await loadMeta();
    const now = new Date();
    fillSelect($("monMonth"), Array.from({ length: 12 }, (_, i) => String(i + 1)), false,
      Array.from({ length: 12 }, (_, i) => `${i + 1}월`));
    $("monMonth").value = String(now.getMonth() + 1);
    $("qtrQuarter").value = String(Math.floor(now.getMonth() / 3) + 1);

    $("dashDate").value = todayStr();
    await loadCodes();
    resetIncomeForm();
    resetExpenseForm();
    showView("dashboard");
  }

  async function boot() {
    try {
      const st = await api("/api/auth/state");
      if (st.setup_required) showAuth("setup");
      else if (!st.user) showAuth("login");
      else await startApp(st.user);
    } catch (err) {
      showAuth("login", "서버에 연결할 수 없습니다. 잠시 뒤 새로고침하세요.");
    }
  }

  boot();
})();
