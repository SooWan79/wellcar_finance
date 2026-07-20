/* 웰카오디오 수입지출관리시스템 - 프론트엔드 */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const fmt = v => Math.round(v || 0).toLocaleString("ko-KR");
  const fmtWon = v => "₩" + fmt(v);
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const weekdayOf = s => {
    const d = new Date(s + "T00:00:00");
    return isNaN(d) ? "" : WEEKDAYS[d.getDay()] + "요일";
  };

  let CODES = {};
  let META = { years: [], today: todayStr() };

  // ---------------------------------------------------------------- fetch
  async function api(path, opts) {
    const res = await fetch(path, opts);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `요청 실패 (${res.status})`);
    return body;
  }
  const post = (p, data) => api(p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const put = (p, data) => api(p, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const del = p => api(p, { method: "DELETE" });

  let toastTimer;
  function toast(msg, isError) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }

  // ---------------------------------------------------------------- tabs
  const views = ["dashboard", "income", "expense", "monthly", "quarterly", "yearly", "codes"];
  const refreshers = {};
  function showView(name) {
    views.forEach(v => { $("view-" + v).hidden = v !== name; });
    document.querySelectorAll("#mainTabs .tab").forEach(b =>
      b.classList.toggle("active", b.dataset.view === name));
    if (refreshers[name]) refreshers[name]();
  }
  $("mainTabs").addEventListener("click", e => {
    const btn = e.target.closest(".tab");
    if (btn) showView(btn.dataset.view);
  });

  // ---------------------------------------------------------------- codes → selects
  function codeValues(group, parent) {
    let list = CODES[group] || [];
    if (parent !== undefined) list = list.filter(c => c.parent_value === parent);
    return list.map(c => c.code_value);
  }
  function fillSelect(sel, values, keep) {
    const prev = keep ? sel.value : "";
    sel.innerHTML = values.map(v => `<option value="${v}">${v}</option>`).join("");
    if (prev && values.includes(prev)) sel.value = prev;
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
    $("clientList").innerHTML = codeValues("client").map(v => `<option value="${v}">`).join("");
  }

  // ---------------------------------------------------------------- 수입 폼
  function calcIncome() {
    const qty = +$("incQty").value || 0;
    const unit = +$("incUnitPrice").value || 0;
    const rate = $("incCurrency").value === "CNY" ? (+$("incRate").value || 0) : 1;
    if (qty && unit) $("incAmount").value = Math.round(qty * unit * rate);
    const amount = +$("incAmount").value || 0;
    const vatApplies = $("incPayment").value === "카드" || $("incTaxInvoice").value === "Y";
    $("incVat").value = vatApplies ? Math.round(amount * 10 / 110) : 0;
    $("incNet").value = amount - (+$("incVat").value || 0);
  }
  ["incQty", "incUnitPrice", "incRate", "incCurrency", "incPayment", "incTaxInvoice"]
    .forEach(id => $(id).addEventListener("input", calcIncome));
  $("incAmount").addEventListener("input", () => {
    const amount = +$("incAmount").value || 0;
    const vatApplies = $("incPayment").value === "카드" || $("incTaxInvoice").value === "Y";
    $("incVat").value = vatApplies ? Math.round(amount * 10 / 110) : 0;
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

  function resetIncomeForm(dateVal) {
    $("incomeForm").reset();
    $("incId").value = "";
    $("incDate").value = dateVal || todayStr();
    $("incWeekday").value = weekdayOf($("incDate").value);
    $("incRate").value = 1; $("incQty").value = 1; $("incUnitPrice").value = 0;
    refreshFormSelects();
    fillSelect($("incCategory"), codeValues("income_category", $("incType").value));
    $("incomeFormTitle").textContent = "수입 등록";
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
    };
    if (!data.amount) { toast("매출액을 입력하세요.", true); return; }
    try {
      const id = $("incId").value;
      if (id) { await put(`/api/incomes/${id}`, data); toast("수입 내역이 수정되었습니다."); }
      else { await post("/api/incomes", data); toast("수입 내역이 등록되었습니다."); }
      resetIncomeForm(data.trx_date);
      loadIncomeList();
    } catch (err) { toast(err.message, true); }
  });

  async function loadIncomeList() {
    const q = $("incSearch").value.trim();
    const rows = await api("/api/incomes" + (q ? `?q=${encodeURIComponent(q)}` : ""));
    $("incomeList").innerHTML = entryTable(rows.slice(0, 100), "income");
  }
  $("incSearch").addEventListener("input", debounce(loadIncomeList, 300));

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

  function resetExpenseForm(dateVal) {
    $("expenseForm").reset();
    $("expId").value = "";
    $("expDate").value = dateVal || todayStr();
    $("expWeekday").value = weekdayOf($("expDate").value);
    $("expRate").value = 1; $("expQty").value = 1; $("expUnitPrice").value = 0;
    refreshFormSelects();
    fillSelect($("expItem"), codeValues("expense_item", $("expType").value));
    $("expenseFormTitle").textContent = "지출 등록";
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
    };
    if (!data.amount) { toast("지출금액을 입력하세요.", true); return; }
    try {
      const id = $("expId").value;
      if (id) { await put(`/api/expenses/${id}`, data); toast("지출 내역이 수정되었습니다."); }
      else { await post("/api/expenses", data); toast("지출 내역이 등록되었습니다."); }
      resetExpenseForm(data.trx_date);
      loadExpenseList();
    } catch (err) { toast(err.message, true); }
  });

  async function loadExpenseList() {
    const q = $("expSearch").value.trim();
    const rows = await api("/api/expenses" + (q ? `?q=${encodeURIComponent(q)}` : ""));
    $("expenseList").innerHTML = entryTable(rows.slice(0, 100), "expense");
  }
  $("expSearch").addEventListener("input", debounce(loadExpenseList, 300));

  // ---------------------------------------------------------------- 내역 테이블
  function entryTable(rows, kind) {
    if (!rows.length) return '<p class="empty-msg">등록된 내역이 없습니다.</p>';
    const isInc = kind === "income";
    const head = isInc
      ? "<th>일자</th><th>유형</th><th>구분</th><th>거래처</th><th class='num'>매출액</th><th class='num'>부가세</th><th>결제</th><th>적요</th><th></th>"
      : "<th>일자</th><th>유형</th><th>품목</th><th>거래처</th><th class='num'>지출금액</th><th>결제</th><th>적요</th><th></th>";
    const body = rows.map(r => {
      const common = `<td>${r.trx_date}(${r.weekday})</td>`;
      const actions = `<td><span class="row-actions">
          <button class="icon-btn" data-edit="${kind}:${r.id}">수정</button>
          <button class="icon-btn del" data-del="${kind}:${r.id}">삭제</button></span></td>`;
      if (isInc) {
        return `<tr>${common}<td>${r.income_type}</td><td>${r.category || ""}</td>` +
          `<td>${esc(r.client)}</td><td class="num">${fmt(r.amount)}</td>` +
          `<td class="num">${fmt(r.vat)}</td><td>${r.payment_type || ""}</td>` +
          `<td title="${esc(r.memo)}">${esc(truncate(r.memo, 18))}</td>${actions}</tr>`;
      }
      return `<tr>${common}<td>${r.expense_type}</td><td>${r.item || ""}</td>` +
        `<td>${esc(r.client)}</td><td class="num">${fmt(r.amount)}</td>` +
        `<td>${r.payment_type || ""}</td>` +
        `<td title="${esc(r.memo)}">${esc(truncate(r.memo, 18))}</td>${actions}</tr>`;
    }).join("");
    const total = rows.reduce((a, r) => a + r.amount, 0);
    const totalRow = isInc
      ? `<tr class="total-row"><td colspan="4">합계 (${rows.length}건)</td><td class="num">${fmt(total)}</td><td colspan="4"></td></tr>`
      : `<tr class="total-row"><td colspan="4">합계 (${rows.length}건)</td><td class="num">${fmt(total)}</td><td colspan="3"></td></tr>`;
    return `<table class="data"><thead><tr>${head}</tr></thead><tbody>${body}${totalRow}</tbody></table>`;
  }

  function esc(s) {
    return String(s || "").replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function truncate(s, n) { s = s || ""; return s.length > n ? s.slice(0, n) + "…" : s; }
  function debounce(fn, ms) {
    let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  // 수정/삭제 위임
  document.body.addEventListener("click", async e => {
    const editBtn = e.target.closest("[data-edit]");
    const delBtn = e.target.closest("[data-del]");
    if (editBtn) {
      const [kind, id] = editBtn.dataset.edit.split(":");
      const rows = await api(`/api/${kind === "income" ? "incomes" : "expenses"}?` +
        new URLSearchParams({}).toString());
      const row = rows.find(r => r.id === +id);
      if (!row) { toast("내역을 찾지 못했습니다.", true); return; }
      if (kind === "income") fillIncomeForm(row); else fillExpenseForm(row);
    } else if (delBtn) {
      const [kind, id] = delBtn.dataset.del.split(":");
      if (!confirm("이 내역을 삭제하시겠습니까?")) return;
      try {
        await del(`/api/${kind === "income" ? "incomes" : "expenses"}/${id}`);
        toast("삭제되었습니다.");
        if (!$("view-dashboard").hidden) refreshers.dashboard();
        if (!$("view-income").hidden) loadIncomeList();
        if (!$("view-expense").hidden) loadExpenseList();
      } catch (err) { toast(err.message, true); }
    }
  });

  function fillIncomeForm(r) {
    showView("income");
    refreshFormSelects();
    $("incId").value = r.id;
    $("incDate").value = r.trx_date;
    $("incWeekday").value = weekdayOf(r.trx_date);
    $("incType").value = r.income_type;
    fillSelect($("incCategory"), codeValues("income_category", r.income_type));
    $("incCategory").value = r.category || "";
    $("incManufacturer").value = r.manufacturer || "N/A";
    $("incModel").value = r.product_model || "";
    $("incClient").value = r.client || "";
    $("incCurrency").value = r.currency || "KRW";
    $("incRate").value = r.exchange_rate || 1;
    $("incQty").value = r.quantity || 1;
    $("incUnitPrice").value = r.unit_price || 0;
    $("incAmount").value = r.amount;
    $("incVat").value = r.vat;
    $("incNet").value = r.net_amount;
    $("incAccount").value = r.account || "";
    $("incPayment").value = r.payment_type || "";
    $("incTaxInvoice").value = r.tax_invoice || "N";
    $("incMemo").value = r.memo || "";
    $("incomeFormTitle").textContent = `수입 수정 (#${r.id})`;
    $("incSubmit").textContent = "수정 저장";
  }

  function fillExpenseForm(r) {
    showView("expense");
    refreshFormSelects();
    $("expId").value = r.id;
    $("expDate").value = r.trx_date;
    $("expWeekday").value = weekdayOf(r.trx_date);
    $("expType").value = r.expense_type;
    fillSelect($("expItem"), codeValues("expense_item", r.expense_type));
    $("expItem").value = r.item || "";
    $("expPayment").value = r.payment_type || "";
    $("expClient").value = r.client || "";
    $("expCurrency").value = r.currency || "KRW";
    $("expRate").value = r.exchange_rate || 1;
    $("expQty").value = r.quantity || 1;
    $("expUnitPrice").value = r.unit_price || 0;
    $("expAmount").value = r.amount;
    $("expMemo").value = r.memo || "";
    $("expenseFormTitle").textContent = `지출 수정 (#${r.id})`;
    $("expSubmit").textContent = "수정 저장";
  }

  // ---------------------------------------------------------------- 타일
  function tile(label, value, opts) {
    opts = opts || {};
    const cls = opts.accent ? ` acc-${opts.accent}` : "";
    let sub = "";
    if (opts.delta !== undefined && opts.delta !== null) {
      const d = opts.delta;
      const arrow = d > 0 ? `<span class="up">▲ ${fmtWon(Math.abs(d))}</span>`
        : d < 0 ? `<span class="down">▼ ${fmtWon(Math.abs(d))}</span>` : "변동 없음";
      sub = `<div class="t-sub">${opts.deltaLabel || "전일대비"} ${arrow}</div>`;
    } else if (opts.sub) {
      sub = `<div class="t-sub">${opts.sub}</div>`;
    }
    return `<div class="tile${cls}"><div class="t-label">${label}</div>` +
      `<div class="t-value">${value}</div>${sub}</div>`;
  }

  // ---------------------------------------------------------------- 대시보드
  refreshers.dashboard = async function () {
    const d = $("dashDate").value || todayStr();
    $("dashDate").value = d;
    try {
      const [stats, incRows, expRows] = await Promise.all([
        api(`/api/stats/daily?date=${d}`),
        api(`/api/incomes?date=${d}`),
        api(`/api/expenses?date=${d}`),
      ]);
      const day = stats.day.totals, prev = stats.prev_day.totals, mon = stats.month.totals;
      $("dashTiles").innerHTML =
        tile("당일 수입", fmtWon(day.income), { accent: "income", delta: day.income - prev.income }) +
        tile("당일 지출", fmtWon(day.expense), { accent: "expense", delta: day.expense - prev.expense }) +
        tile("당일 순익", fmtWon(day.profit), { accent: "profit", delta: day.profit - prev.profit }) +
        tile("당일 현금수입", fmtWon(day.cash_income), { sub: `카드 ${fmtWon(day.card_income)}` }) +
        tile("당월 누계 수입", fmtWon(mon.income), { accent: "income", sub: `부가세 ${fmtWon(mon.vat)} · 순매출 ${fmtWon(mon.net_income)}` }) +
        tile("당월 누계 지출", fmtWon(mon.expense), { accent: "expense", sub: `원가 ${fmtWon(mon.cost_expense)} (${mon.cost_ratio}%)` }) +
        tile("당월 순익", fmtWon(mon.profit), { accent: "profit", sub: `지출비중 ${mon.expense_ratio}%` }) +
        tile("당월 영업일수", `${mon.business_days}일`, { sub: `일평균 매출 ${fmtWon(mon.avg_daily_income)}` });

      // 최근 14일 차트
      const seriesMap = new Map(stats.recent_series.map(s => [s.key, s]));
      const labels = [];
      const start = new Date(stats.recent_from + "T00:00:00");
      for (let i = 0; i < 14; i++) {
        const dt = new Date(start); dt.setDate(start.getDate() + i);
        labels.push(`${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`);
      }
      drawIncomeExpenseChart($("dashChart"), labels,
        labels.map(k => (seriesMap.get(k) || {}).income || 0),
        labels.map(k => (seriesMap.get(k) || {}).expense || 0),
        k => k.slice(5).replace("-", "/"), 2);

      $("dashIncCount").textContent = `${incRows.length}건`;
      $("dashExpCount").textContent = `${expRows.length}건`;
      $("dashIncomeList").innerHTML = entryTable(incRows, "income");
      $("dashExpenseList").innerHTML = entryTable(expRows, "expense");
    } catch (err) { toast(err.message, true); }
  };

  function drawIncomeExpenseChart(elm, labels, incVals, expVals, xLabelFn, xTickEvery) {
    WCharts.groupedBars(elm, labels, [
      { name: "수입", color: getCss("--series-income"), values: incVals },
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
    $("dashDate").value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    refreshers.dashboard();
  }
  $("dashAddIncome").addEventListener("click", () => { showView("income"); resetIncomeForm($("dashDate").value); });
  $("dashAddExpense").addEventListener("click", () => { showView("expense"); resetExpenseForm($("dashDate").value); });

  // ---------------------------------------------------------------- 공통 기간 뷰 렌더
  function periodTiles(t, prevT, prevLabel) {
    const deltaOpts = key => prevT ? { delta: t[key] - prevT[key], deltaLabel: prevLabel } : {};
    return tile("총 수입", fmtWon(t.income), { accent: "income", ...deltaOpts("income") }) +
      tile("총 지출", fmtWon(t.expense), { accent: "expense", ...deltaOpts("expense") }) +
      tile("영업이익", fmtWon(t.profit), { accent: "profit", ...deltaOpts("profit") }) +
      tile("순매출액", fmtWon(t.net_income), { sub: `부가세 ${fmtWon(t.vat)}` }) +
      tile("현금수입", fmtWon(t.cash_income), { sub: `카드 ${fmtWon(t.card_income)}` }) +
      tile("영업일수", `${t.business_days}일`, { sub: `일평균 매출 ${fmtWon(t.avg_daily_income)}` }) +
      tile("지출비중", `${t.expense_ratio}%`, { sub: `원가비중 ${t.cost_ratio}%` }) +
      tile("등록 건수", `수입 ${t.income_count} · 지출 ${t.expense_count}`, {});
  }

  function seriesTable(series, keyLabel, keyFn) {
    if (!series.length) return '<p class="empty-msg">데이터가 없습니다.</p>';
    let tInc = 0, tExp = 0;
    const rows = series.map(s => {
      tInc += s.income; tExp += s.expense;
      const profitCls = s.profit > 0 ? "pos" : s.profit < 0 ? "neg" : "";
      return `<tr><td>${keyFn ? keyFn(s.key) : s.key}</td>` +
        `<td class="num">${fmt(s.income)}</td><td class="num">${fmt(s.expense)}</td>` +
        `<td class="num ${profitCls}">${fmt(s.profit)}</td></tr>`;
    }).join("");
    const tp = tInc - tExp;
    return `<table class="data"><thead><tr><th>${keyLabel}</th>` +
      `<th class="num">수입</th><th class="num">지출</th><th class="num">손익</th></tr></thead>` +
      `<tbody>${rows}<tr class="total-row"><td>합계</td><td class="num">${fmt(tInc)}</td>` +
      `<td class="num">${fmt(tExp)}</td><td class="num ${tp >= 0 ? "pos" : "neg"}">${fmt(tp)}</td></tr></tbody></table>`;
  }

  // ---------------------------------------------------------------- 월별
  refreshers.monthly = async function () {
    const y = +$("monYear").value, m = +$("monMonth").value;
    try {
      const stats = await api(`/api/stats/monthly?year=${y}&month=${m}`);
      $("monTiles").innerHTML = periodTiles(stats.totals, stats.prev_totals, "전월대비");
      // 해당 월 전체 일자 축
      const daysInMonth = new Date(y, m, 0).getDate();
      const map = new Map(stats.series.map(s => [s.key, s]));
      const labels = [];
      for (let d = 1; d <= daysInMonth; d++)
        labels.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
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
    try {
      const stats = await api(`/api/stats/quarterly?year=${y}&quarter=${q}`);
      $("qtrTiles").innerHTML = periodTiles(stats.totals, stats.prev_totals, "전분기대비");
      const map = new Map(stats.series.map(s => [s.key, s]));
      const labels = [];
      for (let i = 0; i < 3; i++) {
        const mm = (q - 1) * 3 + 1 + i;
        labels.push(`${y}-${String(mm).padStart(2, "0")}`);
      }
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
    try {
      const stats = await api(`/api/stats/yearly?year=${y}`);
      $("yrTiles").innerHTML = periodTiles(stats.totals, stats.prev_totals, "전년대비");
      const map = new Map(stats.series.map(s => [s.key, s]));
      const labels = [];
      for (let mm = 1; mm <= 12; mm++) labels.push(`${y}-${String(mm).padStart(2, "0")}`);
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
        inner += `<div class="code-sub">${def.name} 항목과, 각 항목에 속한 ${def.childName}을 관리합니다.</div>`;
        inner += `<div class="code-list">` + chipList(def.group, "") + `</div>` +
          addRow(def.group, "", `${def.name} 추가`);
        for (const parent of codeValues(def.group)) {
          inner += `<div class="code-parent-block">
            <div class="code-parent-label">${parent} — ${def.childName}</div>
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
    if (!list.length) return '<span class="empty-msg" style="padding:0">항목 없음</span>';
    return list.map(c =>
      `<span class="code-chip">${esc(c.code_value)}<button data-code-del="${c.id}" title="삭제">✕</button></span>`).join("");
  }
  function addRow(group, parent, placeholder) {
    return `<div class="code-add">
      <input class="input" placeholder="${placeholder}" data-code-input="${group}|${parent}">
      <button class="btn small" data-code-add="${group}|${parent}">추가</button></div>`;
  }

  $("codesArea").addEventListener("click", async e => {
    const addBtn = e.target.closest("[data-code-add]");
    const delBtn = e.target.closest("[data-code-del]");
    if (addBtn) {
      const key = addBtn.dataset.codeAdd;
      const input = document.querySelector(`[data-code-input="${key}"]`);
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
      document.querySelector(`[data-code-add="${e.target.dataset.codeInput}"]`).click();
    }
  });

  refreshers.income = loadIncomeList;
  refreshers.expense = loadExpenseList;

  // ---------------------------------------------------------------- init
  async function loadCodes() { CODES = await api("/api/codes"); refreshFormSelects(); }

  async function init() {
    try {
      META = await api("/api/meta");
    } catch (_e) { /* 기본값 유지 */ }
    const now = new Date();
    const years = META.years.length ? META.years : [String(now.getFullYear())];
    for (const sel of [$("monYear"), $("qtrYear"), $("yrYear")]) {
      fillSelect(sel, years.map(y => String(y)));
      sel.value = String(now.getFullYear());
      if (!sel.value) sel.value = years[years.length - 1];
    }
    fillSelect($("monMonth"), Array.from({ length: 12 }, (_, i) => String(i + 1)));
    $("monMonth").value = String(now.getMonth() + 1);
    Array.from($("monMonth").options).forEach(o => { o.textContent = o.value + "월"; });
    Array.from($("monYear").options).forEach(o => { o.textContent = o.value + "년"; });
    Array.from($("qtrYear").options).forEach(o => { o.textContent = o.value + "년"; });
    Array.from($("yrYear").options).forEach(o => { o.textContent = o.value + "년"; });
    $("qtrQuarter").value = String(Math.floor(now.getMonth() / 3) + 1);

    $("dashDate").value = todayStr();
    await loadCodes();
    resetIncomeForm();
    resetExpenseForm();
    refreshers.dashboard();
  }

  init();
})();
