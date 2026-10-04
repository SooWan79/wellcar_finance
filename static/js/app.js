/* 웰카오디오 매출/지출관리 시스템 - 프론트엔드 */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const M = window.WellcarMetrics;
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
    return saveBlob(name, await res.blob());
  }

  /** 파일 저장. 페이지가 직접 내려받기를 시작할 수 없는 화면(데모 아티팩트)은 호스트의 저장 창을 쓴다 */
  async function saveBlob(name, blob) {
    if (window.WellcarHost && typeof window.WellcarHost.saveFile === "function") {
      await window.WellcarHost.saveFile(name, blob);
      return name;
    }
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    return name;
  }

  /**
   * 화면 안 확인 대화상자. 확인을 누르면 true.
   * 브라우저 기본 confirm()은 일부 화면(앱 안 미리보기 등)에서 곧바로 '취소'가 되어 쓰지 않는다.
   */
  function askConfirm(message, opts) {
    opts = opts || {};
    const dlg = $("confirmDialog");
    $("confirmTitle").textContent = opts.title || "확인";
    $("confirmMessage").textContent = message;
    $("confirmOk").textContent = opts.okText || "확인";
    $("confirmOk").classList.toggle("danger", !!opts.danger);
    dlg.returnValue = "";
    dlg.showModal();
    return new Promise(resolve =>
      dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
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
  // 차트는 그릴 때 상자 폭에 맞추므로, 창 폭이 크게 바뀌면(휴대폰 회전 등) 지금 화면을 다시 그린다
  let lastWidth = window.innerWidth;
  window.addEventListener("resize", debounce(() => {
    if (Math.abs(window.innerWidth - lastWidth) < 80) return;
    lastWidth = window.innerWidth;
    const active = currentView();
    if (appReady && active && refreshers[active]) refreshers[active]();
  }, 300));

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
  const views = ["dashboard", "income", "expense", "balances", "report", "analysis", "targets",
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
    refreshCarModels();
    const inc = codeValues("income_type"), exp = codeValues("expense_type");
    fillSelect($("incTypeFilter"), ["", ...inc], true, ["모든 매출유형", ...inc]);
    fillSelect($("expTypeFilter"), ["", ...exp], true, ["모든 지출유형", ...exp]);
  }

  /** 차종 제안 목록: 고른 브랜드의 차종 (브랜드가 없거나 N/A면 전체) */
  function refreshCarModels() {
    const brand = $("incManufacturer").value;
    const list = brand && brand !== "N/A" && codeValues("car_model", brand).length
      ? codeValues("car_model", brand) : [...new Set(codeValues("car_model"))];
    $("carModelList").innerHTML = list.map(v => `<option value="${esc(v)}">`).join("");
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
    showSalesLine();
  }
  /** 실매출 = 매출액 − 미지급금(거래처에 줄 돈) 안내 */
  function showSalesLine() {
    const amount = +$("incAmount").value || 0, payout = +$("incPayout").value || 0;
    $("incPayoutPaid").closest("label").hidden = payout <= 0;
    $("incSalesLine").innerHTML = payout > 0
      ? `실매출 <b>${fmtWon(amount - payout)}</b> = 매출액 ${fmtWon(amount)} − 미지급금 ${fmtWon(payout)}`
      : "";
  }
  ["incQty", "incUnitPrice", "incRate", "incCurrency", "incPayment", "incTaxInvoice"]
    .forEach(id => $(id).addEventListener("input", calcIncome));
  $("incAmount").addEventListener("input", () => {
    const amount = +$("incAmount").value || 0;
    $("incVat").value = vatFor(amount);
    $("incNet").value = amount - (+$("incVat").value || 0);
    showSalesLine();
  });
  $("incPayout").addEventListener("input", showSalesLine);
  $("incManufacturer").addEventListener("change", refreshCarModels);
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
    $("incPayout").value = 0; $("incPayoutPaid").checked = false;
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
      car_model: $("incCarModel").value.trim(),
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
      payout: +$("incPayout").value || 0,
    };
    data.payout_due = $("incPayoutPaid").checked ? 0 : data.payout;
    if (!data.amount) { toast("매출액을 입력하세요.", true); return; }
    if (data.receivable < 0 || data.receivable > Math.max(data.amount, 0)) {
      toast("미수금은 0원부터 매출액까지 입력할 수 있습니다.", true); return;
    }
    if (data.payout < 0 || data.payout > Math.max(data.amount, 0)) {
      toast("미지급금은 0원부터 매출액까지 입력할 수 있습니다.", true); return;
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
      ? "<th>일자</th><th class='num'>매출액</th><th>유형</th><th>구분</th><th>차량</th><th>거래처</th><th class='num'>부가세</th><th class='num'>미수금</th><th class='num' title='거래처에 줄 돈(매출차감)'>미지급금</th><th>결제</th><th>적요</th><th></th>"
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
        const car = [r.manufacturer && r.manufacturer !== "N/A" ? r.manufacturer : "", r.car_model].filter(Boolean).join(" ");
        const po = r.payout > 0
          ? `<span class="${r.payout_due > 0 ? "due" : "muted"}" title="${r.payout_due > 0 ? `미지급 ${fmt(r.payout_due)}원` : "지급 완료"}">${fmt(r.payout)}</span>` : "";
        return `<tr>${date}${amount}<td><span class="tag">${esc(r.income_type)}</span></td>` +
          `<td>${esc(r.category)}</td><td>${esc(car)}</td><td>${esc(r.client)}</td>` +
          `<td class="num">${fmt(r.vat)}</td>${balCell}<td class="num">${po}</td><td>${esc(r.payment_type)}</td>${memo}${actions}</tr>`;
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
      const po = summary ? summary.sum.payout : rows.reduce((a, r) => a + (r.payout || 0), 0);
      tail = `<td colspan="4"></td><td class="num">${fmt(vat)}</td><td class="num">${due ? fmt(due) : ""}</td>` +
        `<td class="num">${po ? fmt(po) : ""}</td><td colspan="3"></td>`;
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
      if (!(await askConfirm("이 내역을 삭제할까요? 삭제하면 되돌릴 수 없습니다.", { okText: "삭제", danger: true }))) return;
      try {
        await del(`/api/${tableOf(kind)}/${id}`);
        toast("삭제되었습니다.");
        refreshAfterChange();
      } catch (err) { toast(err.message, true); }
    } else if (settleBtn) {
      const [kind, id] = settleBtn.dataset.settle.split(":");
      const st = SETTLE[kind];
      if (!(await askConfirm(`${st.what}이 끝났습니까? 이 건의 ${st.bal}을 0원으로 정리합니다.` +
        (kind === "payout" ? "\n(매출에서 빠지는 미지급금 금액은 그대로입니다)" : ""),
        { title: `${st.what} 완료`, okText: `${st.what} 완료` }))) return;
      try {
        await post(`/api/${st.table}/${id}/settle`, { field: st.field });
        toast(`${st.what} 완료로 처리했습니다.`);
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
    refreshCarModels();
    $("incCarModel").value = r.car_model || "";
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
    $("incPayout").value = r.payout || 0;
    $("incPayoutPaid").checked = (r.payout || 0) > 0 && !(r.payout_due > 0);
    showSalesLine();
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

  /** 금액 증감 칩. upBad=true면 늘어난 게 나쁨(지출) — 색은 좋고 나쁨, 화살표는 방향 */
  function deltaChip(value, label, upBad) {
    if (value === undefined || value === null) return "";
    const good = upBad ? value < 0 : value > 0;
    const cls = value === 0 ? "flat" : good ? "up" : "down";
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

  // ---------------------------------------------------------------- 집계·목표 (경영현황·대시보드 공통)
  /** /api/agg 행 목록 */
  const agg = (kind, from, to, group) =>
    api(`/api/agg?kind=${kind}&from=${from}&to=${to}${group ? `&group=${group}` : ""}`).then(r => r.rows);
  let targetsCache = null;
  /** 월별 목표 {"YYYY-MM": {sales, profit, expense}} — 한 번 읽어 두고 저장하면 다시 읽는다 */
  async function loadTargets() {
    if (!targetsCache) targetsCache = api("/api/targets").then(r => r.targets).catch(e => { targetsCache = null; throw e; });
    return targetsCache;
  }
  const invalidateTargets = () => { targetsCache = null; };
  const pctText = v => (v === null || v === undefined || !isFinite(v) ? "–"
    : `${v > 0 ? "▲" : v < 0 ? "▼" : ""}${Math.abs(Math.round(v * 10) / 10).toLocaleString("ko-KR")}%`);
  const pctOf = (a, b) => (b ? `${Math.round(a / b * 100).toLocaleString("ko-KR")}%` : "–");

  // ---------------------------------------------------------------- 대시보드
  refreshers.dashboard = async function () {
    const d = $("dashDate").value || todayStr();
    $("dashDate").value = d;
    const req = nextReq("dashboard");
    const monthP = M.periodOf("month", d);
    const winFrom = M.addDays(d, -13);
    const from = M.addYears(winFrom < monthP.start ? winFrom : monthP.start, -1);
    try {
      const [inc, exp, T, bal, incRes, expRes] = await Promise.all([
        agg("incomes", from, d, "date"),
        agg("expenses", from, d, "date"),
        loadTargets(),
        api("/api/receivables?summary=1"),
        api(`/api/incomes?date=${d}&size=500`),
        api(`/api/expenses?date=${d}&size=500`),
      ]);
      if (isStale("dashboard", req)) return;
      const one = x => ({ from: x, to: x });
      const day = M.metricsFor(inc, exp, one(d));
      const prev = M.metricsFor(inc, exp, one(M.addDays(d, -1)));
      const lyDay = M.metricsFor(inc, exp, one(M.addYears(d, -1)));
      const mtd = M.metricsFor(inc, exp, { from: monthP.start, to: d });
      const lyMtd = M.metricsFor(inc, exp, { from: M.addYears(monthP.start, -1), to: M.addYears(d, -1) });
      const tMonth = M.targetFor(T, monthP.start, monthP.end), tPace = M.targetFor(T, monthP.start, d);
      const mm = +d.slice(5, 7);
      $("dashSubtitle").textContent = `${d} ${weekdayOf(d)} · 매출 ${day.cnt}건 · 지출 ${day.exp_cnt}건`;
      const ly = v => ` <span class="muted">· 작년 같은 날 ${fmtWon(v)}</span>`;
      $("dashTiles").innerHTML =
        kpiRow(
          kpi("당일 매출 (실매출)", fmtWon(day.sales), "income", deltaChip(day.sales - prev.sales, "전일대비") + ly(lyDay.sales)) +
          kpi("당일 지출", fmtWon(day.expense), "expense", deltaChip(day.expense - prev.expense, "전일대비", true) + ly(lyDay.expense)) +
          kpi("당일 영업이익", fmtWon(day.profit), "profit", deltaChip(day.profit - prev.profit, "전일대비") + ly(lyDay.profit))
        ) +
        metricStrip(
          metric(`${mm}월 누계 매출`, fmtWon(mtd.sales), tMonth.sales
            ? `목표 대비 ${pctOf(mtd.sales, tMonth.sales)} · 진도 대비 ${pctOf(mtd.sales, tPace.sales)}`
            : `전년 동기 대비 ${pctText(M.pctChange(mtd.sales, lyMtd.sales))}`,
            ' role="button" tabindex="0" data-goto="report" title="경영현황으로 이동"') +
          metric(`${mm}월 누계 영업이익`, fmtWon(mtd.profit),
            `이익률 ${mtd.margin === null ? "–" : mtd.margin.toFixed(1) + "%"} · 전년 동기 ${pctText(M.pctChange(mtd.profit, lyMtd.profit))}`) +
          metric(`${mm}월 누계 지출`, fmtWon(mtd.expense), tMonth.expense
            ? `예산 집행 ${pctOf(mtd.expense, tMonth.expense)}` : `원가율 ${mtd.cost_ratio === null ? "–" : mtd.cost_ratio.toFixed(1) + "%"}`) +
          metric("당일 현금매출 (카드 외)", fmtWon(day.cash), `카드 ${fmtWon(day.card)}`) +
          metric("당월 영업일수", `${mtd.days}일`, `일평균 ${fmtWon(mtd.avg_daily || 0)}`) +
          metric("미수금 잔액 (받을 돈)", fmtWon(bal.incomes.total),
            `${fmt(bal.incomes.count)}건 · 미지급 ${fmtWon(bal.expenses.total + bal.payouts.total)}`,
            ' role="button" tabindex="0" data-goto="balances" title="미수·미지급 화면으로 이동"')
        );

      // 최근 14일 차트
      const labels = Array.from({ length: 14 }, (_, i) => M.addDays(winFrom, i));
      const daily = labels.map(k => M.metricsFor(inc, exp, one(k)));
      drawIncomeExpenseChart($("dashChart"), labels, daily.map(k => k.sales), daily.map(k => k.expense),
        k => k.slice(5).replace("-", "/"), 2);

      $("dashIncCount").textContent = `${incRes.total}건`;
      $("dashExpCount").textContent = `${expRes.total}건`;
      $("dashIncomeList").innerHTML = entryTable(incRes.items, "income");
      $("dashExpenseList").innerHTML = entryTable(expRes.items, "expense");
    } catch (err) { toast(err.message, true); }
  };
  // 지표 칸을 누르면 관련 화면으로 (대시보드·경영현황)
  document.addEventListener("click", e => {
    const g = e.target.closest(".metric[data-goto]");
    if (g) showView(g.dataset.goto);
  });
  document.addEventListener("keydown", e => {
    const g = e.target.closest && e.target.closest(".metric[data-goto]");
    if (g && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); showView(g.dataset.goto); }
  });

  function drawIncomeExpenseChart(elm, labels, incVals, expVals, xLabelFn, xTickEvery) {
    WCharts.groupedBars(elm, labels, [
      { name: "매출 (실매출)", color: getCss("--series-income"), values: incVals },
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
  // 완료 처리 대상: 매출 미수금(받을 돈), 지출 미지급금(외상), 매출의 거래처 미지급금(매출차감)
  const SETTLE = {
    income: { table: "incomes", field: "receivable", what: "입금", bal: "미수금" },
    expense: { table: "expenses", field: "payable", what: "지급", bal: "미지급금" },
    payout: { table: "incomes", field: "payout_due", what: "지급", bal: "거래처 미지급금" },
  };

  /** items: [{kind, r}] — side: rec(받을 돈) / pay(줄 돈) */
  function balanceTable(items, side) {
    if (!items.length) return `<p class="empty-msg">${side === "rec" ? "미수금" : "미지급금"}이 남은 내역이 없습니다.</p>`;
    const rows = items.map(({ kind, r }) => {
      const amount = kind === "payout" ? r.payout : r.amount;
      const bal = kind === "income" ? r.receivable : kind === "payout" ? r.payout_due : r.payable;
      const age = daysSince(r.trx_date);
      const ageCls = age >= 60 ? "age old" : age >= 30 ? "age mid" : "age";
      const tag = kind === "income" ? esc(r.income_type)
        : kind === "payout" ? `매출차감 · ${esc(r.category || r.income_type)}` : `지출 · ${esc(r.expense_type)}`;
      const editKind = kind === "expense" ? "expense" : "income";
      return `<tr><td class="pick need-staff"><input type="checkbox" data-pick="${kind}:${r.id}" aria-label="선택"></td>` +
        `<td class="date">${esc(r.trx_date.slice(2))} <span class="wd">${esc(r.weekday)}</span></td>` +
        `<td>${esc(r.client) || '<span class="muted">(미지정)</span>'}</td>` +
        `<td><span class="tag${kind === "payout" ? " cur" : ""}">${tag}</span></td>` +
        `<td class="num">${fmt(amount)}</td><td class="num strong"><span class="due">${fmt(bal)}</span></td>` +
        `<td class="num"><span class="${ageCls}">${age}일</span></td>` +
        `<td class="memo" title="${esc(r.memo)}">${esc(r.memo)}</td>` +
        `<td><span class="row-actions need-staff">` +
        `<button class="icon-btn ok" data-settle="${kind}:${r.id}">${SETTLE[kind].what} 완료</button>` +
        `<button class="icon-btn" data-edit="${editKind}:${r.id}">수정</button></span></td></tr>`;
    }).join("");
    const total = items.reduce((a, { kind, r }) =>
      a + (kind === "income" ? r.receivable : kind === "payout" ? r.payout_due : r.payable), 0);
    return `<table class="data has-actions"><thead><tr>` +
      `<th class="pick need-staff"><input type="checkbox" data-pick-all="${side}" aria-label="모두 선택"></th>` +
      `<th>일자</th><th>거래처</th><th>구분</th><th class="num">금액</th><th class="num">${side === "rec" ? "미수금" : "남은 금액"}</th>` +
      `<th class="num">경과</th><th>적요</th><th></th></tr></thead><tbody>${rows}` +
      `<tr class="total-row"><td class="need-staff"></td><td>합계 · ${fmt(items.length)}건</td><td colspan="3"></td>` +
      `<td class="num">${fmt(total)}</td><td colspan="3"></td></tr></tbody></table>`;
  }

  /** 거래처별 합계 두 목록 합치기 (지출 미지급 + 매출차감 미지급) */
  function mergeByClient(...lists) {
    const m = new Map();
    for (const it of lists.flat()) {
      const cur = m.get(it.name) || { name: it.name, value: 0, cnt: 0 };
      cur.value += it.value;
      cur.cnt += it.cnt;
      m.set(it.name, cur);
    }
    return [...m.values()].sort((a, b) => b.value - a.value);
  }

  refreshers.balances = async function () {
    try {
      const r = await api("/api/receivables");
      const inc = r.incomes, exp = r.expenses, po = r.payouts;
      const payTotal = exp.total + po.total;
      $("balTiles").innerHTML = kpiRow(
        kpi("미수금 잔액 (받을 돈)", fmtWon(inc.total), "income", `${fmt(inc.count)}건 · 거래처 ${inc.by_client.length}곳`) +
        kpi("미지급금 잔액 (줄 돈)", fmtWon(payTotal), "expense",
          `지출 외상 ${fmtWon(exp.total)} · 매출차감 ${fmtWon(po.total)}`) +
        kpi("차액 (받을 돈 − 줄 돈)", fmtWon(inc.total - payTotal), "profit", "현금흐름 참고용")
      );
      WCharts.hBars($("balRecClients"), inc.by_client, getCss("--series-income"));
      WCharts.hBars($("balPayClients"), mergeByClient(exp.by_client, po.by_client), getCss("--series-expense"));
      $("balRecCount").textContent = `${fmt(inc.count)}건`;
      $("balPayCount").textContent = `${fmt(exp.count + po.count)}건`;
      $("balRecList").innerHTML = balanceTable(inc.items.map(x => ({ kind: "income", r: x })), "rec") +
        (inc.count > inc.items.length ? `<p class="form-hint">오래된 ${fmt(inc.items.length)}건만 표시합니다. 나머지는 매출관리에서 ‘미수금 남은 건만’으로 찾으세요.</p>` : "");
      const payItems = [...exp.items.map(x => ({ kind: "expense", r: x })), ...po.items.map(x => ({ kind: "payout", r: x }))]
        .sort((a, b) => (a.r.trx_date === b.r.trx_date ? a.r.id - b.r.id : a.r.trx_date < b.r.trx_date ? -1 : 1));
      $("balPayList").innerHTML = balanceTable(payItems, "pay") +
        (exp.count + po.count > payItems.length ? `<p class="form-hint">오래된 순으로 일부만 표시합니다.</p>` : "");
      updateBulkButtons();
    } catch (err) { toast(err.message, true); }
  };

  function picked(side) {
    return [...document.querySelectorAll(`#${side === "rec" ? "balRecList" : "balPayList"} [data-pick]:checked`)]
      .map(cb => cb.dataset.pick.split(":")).map(([kind, id]) => ({ kind, id: +id }));
  }
  function updateBulkButtons() {
    const rec = picked("rec").length, pay = picked("pay").length;
    $("balRecBulk").disabled = !rec;
    $("balRecBulk").textContent = rec ? `선택한 ${rec}건 입금 완료` : "선택한 건 입금 완료";
    $("balPayBulk").disabled = !pay;
    $("balPayBulk").textContent = pay ? `선택한 ${pay}건 지급 완료` : "선택한 건 지급 완료";
  }
  for (const id of ["balRecList", "balPayList"]) {
    $(id).addEventListener("change", e => {
      const all = e.target.closest("[data-pick-all]");
      if (all) $(id).querySelectorAll("[data-pick]").forEach(cb => { cb.checked = all.checked; });
      updateBulkButtons();
    });
  }
  async function bulkSettle(side) {
    const items = picked(side);
    if (!items.length) return;
    const what = side === "rec" ? "입금" : "지급";
    if (!(await askConfirm(`선택한 ${items.length}건을 ${what} 완료로 정리합니다.`, { title: `${what} 완료`, okText: `${items.length}건 ${what} 완료` }))) return;
    const groups = {};
    for (const it of items) (groups[it.kind] = groups[it.kind] || []).push(it.id);
    try {
      let n = 0;
      for (const [kind, ids] of Object.entries(groups)) {
        const st = SETTLE[kind];
        n += (await post("/api/settle-bulk", { table: st.table, field: st.field, ids })).updated;
      }
      toast(`${fmt(n)}건을 ${what} 완료로 처리했습니다.`);
      refreshers.balances();
    } catch (err) { toast(err.message, true); }
  }
  $("balRecBulk").addEventListener("click", () => bulkSettle("rec"));
  $("balPayBulk").addEventListener("click", () => bulkSettle("pay"));

  // ---------------------------------------------------------------- 코드관리
  const CODE_GROUPS = [
    { group: "income_type", name: "매출유형", childGroup: "income_category", childName: "매출구분",
      sub: "매출유형과 각 유형에 속한 매출구분(서비스 구분)을 관리합니다." },
    { group: "expense_type", name: "지출유형", childGroup: "expense_item", childName: "거래품목",
      sub: "지출유형과 각 유형에 속한 거래품목을 관리합니다." },
    { group: "payment_type", name: "결제유형" },
    { group: "account", name: "계좌" },
    { group: "manufacturer", name: "브랜드 (차량제조사)", childGroup: "car_model", childName: "차종",
      sub: "차량 브랜드와 브랜드별 차종을 관리합니다. 매출 화면에서는 목록에 없는 차종도 직접 적을 수 있습니다." },
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
        inner += `<div class="code-sub">${def.sub}</div>`;
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
      if (!(await askConfirm("이 코드를 삭제할까요? 이미 등록된 내역은 그대로 남습니다.", { okText: "삭제", danger: true }))) return;
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

  // ---------------------------------------------------------------- 데이터 관리: 엑셀 입력 양식
  $("tplDownload").addEventListener("click", async () => {
    try { toast(`${await download("/api/template.xlsx")} 파일을 받았습니다.`); }
    catch (err) { toast(err.message, true); }
  });

  // ---------------------------------------------------------------- 데이터 관리: 엑셀 올리기 (자동 반영)
  const AUTO_KEY = "wellcar_import_auto";
  try {
    const v = localStorage.getItem(AUTO_KEY);
    if (v !== null) $("importAuto").checked = v === "1";
  } catch (_e) { /* 저장소 사용 불가 */ }
  $("importAuto").addEventListener("change", () => {
    try { localStorage.setItem(AUTO_KEY, $("importAuto").checked ? "1" : "0"); } catch (_e) { /* 무시 */ }
  });
  const importMode = () => (document.querySelector('input[name="importMode"]:checked') || {}).value || "append";
  document.querySelectorAll('input[name="importMode"]').forEach(r =>
    r.addEventListener("change", () => { if (imp) analyzeImport(false); }));

  let imp = null;  // { files, sheets, selected, combined, plan, seq, reconOk }

  function importReset() {
    imp = null;
    $("importFile").value = "";
    $("importFileName").textContent = "";
    $("importPreview").hidden = true;
    $("importResult").hidden = true;
    $("importSummary").innerHTML = "";
  }

  async function handleImportFiles(fileList) {
    const files = [...(fileList || [])];
    if (!files.length) return;
    const bad = files.filter(f => !/\.(xlsx|xlsm)$/i.test(f.name));
    if (bad.length) { toast("xlsx 또는 xlsm 파일만 올릴 수 있습니다: " + bad.map(f => f.name).join(", "), true); return; }
    $("importResult").hidden = true;
    $("importPreview").hidden = true;
    $("importSummary").innerHTML = "";
    imp = null;
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
    // 이 시스템에서 받은 파일(시스템 식별자가 같음)만 관리번호로 기존 내역을 고친다.
    // 다른 시스템·옛 파일의 관리번호는 버리고 일반 내역처럼 중복 판정으로 맞춘다.
    for (const f of parsed) {
      const mine = !!(f.meta && f.meta.instance && f.meta.instance === META.instance);
      for (const sh of f.sheets) {
        for (const r of sh.records) {
          if (mine && r.id) r.ref_time = f.meta.exported_at || "";
          else { delete r.id; delete r._absent; }
        }
      }
    }
    $("importFileName").textContent = files.map(f => f.name).join(", ");
    const sheets = parsed.flatMap(p => p.sheets);
    sheets.forEach((s, i) => { s.id = "s" + i; });  // 화면의 체크박스와 짝을 맞추는 간단한 번호
    imp = { files: parsed, sheets, selected: new Set(sheets.filter(s => s.records.length).map(s => s.id)), seq: 0 };
    await analyzeImport(true);
  }

  /** 서버에 미리보기(바꾸지 않고 계획만)를 받아 보여 주고, 확인할 것이 없으면 바로 반영한다 */
  async function analyzeImport(allowAuto) {
    if (!imp) return;
    const c = WellcarXlsx.combine(imp.sheets, imp.selected);
    imp.combined = c;
    imp.plan = null;
    renderImportPreview();
    if (!c.incomes.length && !c.expenses.length) return;
    const my = ++imp.seq;
    try {
      const plan = await post("/api/import-json", { incomes: c.incomes, expenses: c.expenses, mode: importMode(), dry_run: true });
      if (!imp || my !== imp.seq) return;
      // 확인할 것이 없으면 계획을 보여 주지 않고 바로 반영 (결과 화면에 같은 표가 나온다)
      if (allowAuto && $("importAuto").checked && importIsClean(plan)) { await commitImport(true); return; }
      imp.plan = plan;
      renderImportPreview();
    } catch (err) { toast(err.message, true); }
  }

  const planTotal = (plan, k) => plan.incomes[k] + plan.expenses[k];
  /** 바로 반영해도 되는 경우: 바뀌는 것이 있고, 오류·충돌·삭제·건너뛴 행·합계 차이가 없을 때 */
  function importIsClean(plan) {
    const skipRows = imp.files.flatMap(f => f.issues).some(i => i.level === "skip");
    return planTotal(plan, "added") + planTotal(plan, "updated") > 0 &&
      !planTotal(plan, "conflict") && !planTotal(plan, "missing") && !planTotal(plan, "invalid") &&
      !planTotal(plan, "deleted") && !skipRows && imp.reconOk !== false;
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

  /** 엑셀 경영분석(월별 합계) 시트와 읽어 낸 내역의 월별 합계를 비교.
   *  이 시스템이 내보낸 파일의 월별손익은 내보낼 때 계산한 고정 값이라, 내역을 고쳐 올리면 당연히 달라지므로 대조하지 않는다. */
  function summaryCheck(combined) {
    imp.reconOk = null;
    const sums = imp.files.filter(f => !f.meta).flatMap(f => f.summaries.map(s => Object.assign({ file: f.file }, s)));
    if (!sums.length) {
      return imp.files.some(f => f.meta)
        ? `<p class="form-hint">이 시스템에서 받은 파일입니다. 고친 줄은 관리번호로 찾아 반영합니다.</p>`
        : `<p class="form-hint">파일에 월별 합계 시트(경영분석)가 없어 엑셀 자체 합계와의 대조는 건너뜁니다.</p>`;
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
      imp.reconOk = imp.reconOk !== false && allOk;
      html += `<div class="recon">
        <div class="recon-head"><b>엑셀 ‘${esc(s.sheet)}’ 월별 합계와 대조</b> ${statusChip(allOk, "모든 달 일치", "차이가 있는 달이 있습니다")}</div>
        <div class="table-wrap"><table class="data compact"><thead><tr><th>월</th><th class="num">매출(읽은 내역)</th><th class="num">매출(엑셀 합계)</th>
        <th class="num">지출(읽은 내역)</th><th class="num">지출(엑셀 합계)</th><th>결과</th></tr></thead><tbody>${rows.join("")}</tbody></table></div>
        ${allOk ? "" : '<p class="form-hint">차이가 나면 아래 ‘건너뛴 행과 확인할 점’을 보고, 엑셀에서 해당 달의 행을 확인하세요. 체크를 해제한 시트가 있으면 그만큼 차이가 납니다.</p>'}
      </div>`;
    }
    return html || `<p class="form-hint">월별 합계 시트가 있지만 금액이 모두 0이어서 대조할 내용이 없습니다.</p>`;
  }

  const PLAN_COLS = [["added", "새로 등록"], ["updated", "고친 내용 반영"], ["same", "이미 있음 (건너뜀)"],
    ["deleted", "삭제 (맞추기)"], ["conflict", "충돌 (건너뜀)"], ["missing", "없는 관리번호"], ["invalid", "오류"]];
  const SAMPLE_TITLES = { updated: "고칠 내역", deleted: "지울 내역", conflict: "충돌 — 시스템에서 먼저 고친 내역", missing: "시스템에 없는 관리번호", invalid: "오류로 반영하지 않는 행" };

  /** 서버 계획(dry_run 또는 반영 결과)을 표로 */
  function planTable(plan) {
    const shown = PLAN_COLS.filter(([k]) => k === "added" || k === "same" || planTotal(plan, k));
    const cell = (kind, k) => {
      const n = plan[kind][k];
      const cls = !n ? "muted" : k === "conflict" || k === "missing" || k === "invalid" ? "due" : k === "deleted" ? "neg" : "strong";
      return `<td class="num ${cls}">${n ? fmt(n) + "건" : "–"}</td>`;
    };
    const samples = [];
    for (const k of Object.keys(SAMPLE_TITLES)) {
      const list = [...(plan.samples.incomes[k] || []).map(x => ["매출", x]), ...(plan.samples.expenses[k] || []).map(x => ["지출", x])];
      if (!list.length) continue;
      samples.push(`<details class="issues"${k === "conflict" || k === "invalid" || k === "deleted" ? " open" : ""}><summary>${SAMPLE_TITLES[k]} ${fmt(planTotal(plan, k))}건${planTotal(plan, k) > list.length ? ` (${fmt(list.length)}건만 표시)` : ""}</summary><ul>` +
        list.map(([kind, x]) => `<li class="${k === "updated" ? "" : "skip"}"><b>${kind} ${esc(x.trx_date)} ${fmt(x.amount)}원${x.client ? " · " + esc(x.client) : ""}</b>` +
          `${x.src ? ` <span class="muted">(${esc(x.src)})</span>` : ""} — ${esc(x.reason)}</li>`).join("") + `</ul></details>`);
    }
    return `<div class="table-wrap"><table class="data compact plan-table"><thead><tr><th></th>` +
      shown.map(([, l]) => `<th class="num">${l}</th>`).join("") + `</tr></thead><tbody>` +
      ["incomes", "expenses"].map(kind => `<tr><td>${kind === "incomes" ? "매출" : "지출"}</td>` +
        shown.map(([k]) => cell(kind, k)).join("") + `</tr>`).join("") +
      `</tbody></table></div>${samples.join("")}`;
  }

  function renderImportPreview() {
    const multi = imp.files.length > 1;
    if (!imp.sheets.length) {
      $("importSummary").innerHTML =
        '<p class="empty-msg">매출·지출 내역 시트를 찾지 못했습니다.<br>' +
        "'영업일자'와 '매출액'(또는 '지출금액') 열이 있는 시트가 필요합니다. 입력 양식을 받아 쓰면 편합니다.</p>";
      $("importPreview").hidden = false;
      $("importCommit").disabled = true;
      return;
    }
    const c = imp.combined;
    const all = [...c.incomes, ...c.expenses];
    const dates = all.map(r => r.trx_date).sort();
    const incSum = c.incomes.reduce((a, r) => a + r.amount, 0);
    const expSum = c.expenses.reduce((a, r) => a + r.amount, 0);
    const recv = c.incomes.filter(r => r.receivable > 0);
    const payb = c.expenses.filter(r => r.payable > 0);
    const pout = c.incomes.filter(r => r.payout > 0);
    const foreign = all.filter(r => r.currency !== "KRW").length;
    const withId = all.filter(r => r.id).length;
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
    const recon = summaryCheck(c);
    const plan = imp.plan;
    const mode = importMode();
    let planHtml;
    if (!all.length) planHtml = "";
    else if (!plan) planHtml = '<p class="form-hint">시스템과 맞춰 보는 중…</p>';
    else {
      planHtml = `<div class="plan-box"><div class="plan-head"><b>${mode === "sync" ? "엑셀 장부와 맞추면" : "반영하면"}</b>` +
        `${planTotal(plan, "added") + planTotal(plan, "updated") + planTotal(plan, "deleted") ? "" : ' <span class="status ok">✓ 파일의 내역이 이미 모두 들어 있습니다</span>'}</div>${planTable(plan)}</div>`;
    }
    $("importSummary").innerHTML =
      `<div class="import-stats">
        <span class="import-stat">매출<b>${fmt(c.incomes.length)}건 · ${fmtWon(incSum)}</b></span>
        <span class="import-stat">지출<b>${fmt(c.expenses.length)}건 · ${fmtWon(expSum)}</b></span>
        <span class="import-stat">기간<b>${dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : "-"}</b></span>
        ${recv.length ? `<span class="import-stat">미수금<b>${fmt(recv.length)}건 · ${fmtWon(recv.reduce((a, r) => a + r.receivable, 0))}</b></span>` : ""}
        ${pout.length ? `<span class="import-stat">미지급금(매출차감)<b>${fmt(pout.length)}건 · ${fmtWon(pout.reduce((a, r) => a + r.payout, 0))}</b></span>` : ""}
        ${payb.length ? `<span class="import-stat">지출 미지급금<b>${fmt(payb.length)}건 · ${fmtWon(payb.reduce((a, r) => a + r.payable, 0))}</b></span>` : ""}
        ${foreign ? `<span class="import-stat">외화 거래<b>${fmt(foreign)}건</b></span>` : ""}
        ${withId ? `<span class="import-stat">관리번호 있는 줄<b>${fmt(withId)}건</b></span>` : ""}
        ${c.dupInFile ? `<span class="import-stat">시트 간 중복 제외<b>${fmt(c.dupInFile)}건</b></span>` : ""}
      </div>
      ${planHtml}
      <div class="table-wrap" style="max-height:300px;overflow-y:auto">
        <table class="data compact"><thead><tr><th>시트 (체크한 시트만 반영)</th>${multi ? "<th>파일</th>" : ""}<th>종류</th>
        <th class="num">읽은 건수</th><th class="num">금액 합계</th><th class="num">다른 시트와 중복</th><th class="num">건너뛴 행</th></tr></thead>
        <tbody>${sheetRows}</tbody></table>
      </div>
      ${recon}
      ${issueList}`;
    $("importPreview").hidden = false;
    const changes = plan ? planTotal(plan, "added") + planTotal(plan, "updated") + planTotal(plan, "deleted") : 0;
    $("importCommit").disabled = !plan || !changes;
    $("importCommit").textContent = !plan ? "반영하기" : !changes ? "반영할 내용 없음"
      : `반영하기 (${[["added", "새"], ["updated", "수정"], ["deleted", "삭제"]]
        .filter(([k]) => planTotal(plan, k)).map(([k, l]) => `${l} ${fmt(planTotal(plan, k))}건`).join(" · ")})`;
  }

  $("importSummary").addEventListener("change", e => {
    const cb = e.target.closest("[data-sheet]");
    if (!cb || !imp) return;
    if (cb.checked) imp.selected.add(cb.dataset.sheet); else imp.selected.delete(cb.dataset.sheet);
    analyzeImport(false);
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

  /** 반영 후: 파일에서 읽은 월별 건수·금액과 시스템(DB)의 월별 건수·금액 대조 */
  async function reconcileAfterImport(c) {
    const dates = [...c.incomes, ...c.expenses].map(r => r.trx_date).sort();
    if (!dates.length) return "";
    const from = dates[0], to = dates[dates.length - 1];
    const [mi, me] = await Promise.all([agg("incomes", from, to, "month"), agg("expenses", from, to, "month")]);
    const db = new Map();
    const slot = k => db.get(k) || (db.set(k, { income_count: 0, income: 0, expense_count: 0, expense: 0 }), db.get(k));
    for (const r of mi) Object.assign(slot(r.month), { income_count: r.cnt, income: r.amount });
    for (const r of me) Object.assign(slot(r.month), { expense_count: r.cnt, expense: r.amount });
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
    return `<div class="recon"><div class="recon-head"><b>반영 뒤 대조 (파일 ↔ 시스템)</b> ${head}</div>
      <div class="table-wrap"><table class="data compact"><thead><tr><th>월</th><th class="num">매출 · 파일</th><th class="num">매출 · 시스템</th>
      <th class="num">지출 · 파일</th><th class="num">지출 · 시스템</th><th>결과</th></tr></thead><tbody>${rows}</tbody></table></div></div>`;
  }

  async function commitImport(auto) {
    if (!imp || !imp.combined) return;
    const c = imp.combined;
    $("importCommit").disabled = true;
    $("importCommit").textContent = "반영 중…";
    try {
      const r = await post("/api/import-json", { incomes: c.incomes, expenses: c.expenses, mode: importMode() });
      let recon = "";
      try { recon = await reconcileAfterImport(c); } catch (_e) { /* 대조 실패는 결과 표시를 막지 않음 */ }
      const undo = r.backup
        ? (can("admin")
          ? `<span class="undo-line">잘못 올렸다면 <button type="button" class="btn small" data-undo="${esc(r.backup)}">되돌리기</button> (반영 직전 백업으로 복원)</span>`
          : `<span class="muted">잘못 올렸다면 관리자가 [백업·복원]에서 ‘가져오기 직전’ 백업으로 되돌릴 수 있습니다.</span>`)
        : "";
      $("importResult").innerHTML = `<div class="import-result-box">
        <span class="res-title">✓ ${auto ? "자동 반영 완료" : "반영 완료"}${r.mode === "sync" ? " — 엑셀 장부와 맞춤" : ""}</span>
        ${planTable(r)}
        <span>${r.codes_added ? `신규 코드 ${fmt(r.codes_added)}개가 코드관리에 자동 추가되었습니다.` : "신규 코드는 없습니다."}</span>
        ${r.backup ? `<span class="muted">반영 직전 상태를 백업했습니다: ${esc(r.backup)}</span>` : ""}
        ${undo}
      </div>${recon}`;
      $("importResult").hidden = false;
      $("importPreview").hidden = true;
      imp = null;
      invalidateTargets();
      await Promise.all([loadCodes(), loadMeta()]);
      loadBackups();
      toast(auto ? "엑셀 내용을 자동으로 반영했습니다." : "엑셀 내용을 반영했습니다.");
    } catch (err) {
      toast(err.message, true);
      $("importCommit").disabled = false;
      $("importCommit").textContent = "반영하기";
    }
  }
  $("importCommit").addEventListener("click", () => commitImport(false));
  $("importResult").addEventListener("click", async e => {
    const b = e.target.closest("[data-undo]");
    if (b) await restoreBackup(b.dataset.undo, "가져오기 직전");
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
    if (!(await askConfirm(`${when} 백업으로 되돌립니다.\n\n매출·지출 내역과 코드가 그 시점으로 바뀝니다(사용자 계정은 그대로).\n지금 데이터는 ‘복원 직전’ 백업으로 자동 보관됩니다.`,
      { title: "백업 복원", okText: "복원" }))) return;
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
        if (!(await askConfirm("이 백업 파일을 삭제할까요? 되돌릴 수 없습니다.", { okText: "삭제", danger: true }))) return;
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
      if (!(await askConfirm(`‘${u.name}’ 계정을 삭제할까요?\n기록을 남기려면 삭제 대신 [수정]에서 사용 중지를 하세요.`,
        { okText: "삭제", danger: true }))) return;
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
    reports.fillTargetYears(META.years || []);
  }

  // 경영현황 · 매출·비용 분석 · 목표·실적 화면 (reports.js)
  const reports = window.WellcarReports({
    $, api, put, esc, fmt, fmtWon, toast, getCss, can, refreshers, nextReq, isStale,
    metric, metricStrip, saveBlob, todayStr, loadTargets, invalidateTargets, agg, fillSelect,
  });

  async function init() {
    await loadMeta();
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
