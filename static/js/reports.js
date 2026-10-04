/* 경영현황 · 매출·비용 분석 · 목표·실적 화면.
   app.js가 WellcarReports(ctx)로 연결한다(ctx: 요청·표시 도우미). 계산은 metrics.js가 한다. */
(function () {
  "use strict";

  window.WellcarReports = function install(ctx) {
    const { $, api, put, esc, fmt, fmtWon, toast, getCss, can, refreshers, nextReq, isStale,
      metric, metricStrip, saveBlob, todayStr, loadTargets, invalidateTargets, agg, fillSelect } = ctx;
    const M = window.WellcarMetrics;

    // ---------------------------------------------------------------- 표시 도우미
    const dash = '<span class="muted">–</span>';
    const fmtPct = (v, digits) => (v === null || v === undefined || !isFinite(v) ? "–"
      : `${(Math.round(v * 10 ** (digits ?? 1)) / 10 ** (digits ?? 1)).toLocaleString("ko-KR")}%`);
    const wonOrDash = v => (v === null || v === undefined ? dash : fmtWon(v));
    const unset = s => (s === "" || s === null || s === undefined ? "(미지정)" : s);

    /** 증감 칩: 화살표는 방향, 색은 좋고 나쁨(지출은 줄어야 좋음). pp=true면 %p */
    function changeChip(pct, upGood, pp) {
      if (pct === null || pct === undefined || !isFinite(pct)) return dash;
      const r = Math.round(pct * 10) / 10;
      if (r === 0) return '<span class="delta flat">― 0' + (pp ? "%p" : "%") + "</span>";
      const good = (r > 0) === upGood;
      return `<span class="delta ${good ? "up" : "down"}">${r > 0 ? "▲" : "▼"} ${Math.abs(r).toLocaleString("ko-KR")}${pp ? "%p" : "%"}</span>`;
    }
    /** 달성률 칩: more = 높을수록 좋음(매출·이익), less = 낮을수록 좋음(지출 예산) */
    function achChip(pct, kind) {
      if (pct === null || pct === undefined || !isFinite(pct)) return dash;
      const t = fmtPct(pct, 0);
      if (kind === "less") return pct > 100 ? `<span class="status warn">! ${t}</span>` : `<span class="status ok">${t}</span>`;
      return pct >= 100 ? `<span class="status ok">✓ ${t}</span>` : `<span class="ach">${t}</span>`;
    }

    /**
     * 목표 막대: 채움 = 실적 ÷ 목표, 세로 눈금 = 오늘까지 지나야 할 진도(진행 중인 기간).
     * kind: more(매출·이익) / less(지출 예산)
     */
    function meter(actual, target, paceFrac, kind, label) {
      if (target === null || target === undefined || target <= 0) {
        return `<div class="meter none"><span class="meter-text">${label} 목표 없음${can("admin") ? " · 목표·실적에서 정할 수 있습니다" : ""}</span></div>`;
      }
      const pct = actual / target * 100;
      const over = kind === "less" ? (paceFrac !== null ? pct > paceFrac * 100 + 0.5 : pct > 100) : false;
      const pace = paceFrac !== null && paceFrac < 1
        ? `<span class="meter-pace" style="left:${(paceFrac * 100).toFixed(1)}%" title="오늘까지 진도 ${fmtPct(paceFrac * 100, 0)}"></span>` : "";
      const paceTxt = paceFrac !== null && paceFrac < 1 && paceFrac > 0
        ? ` · 진도 대비 ${fmtPct(pct / paceFrac, 0)}` : "";
      return `<div class="meter${over ? " over" : ""}">
        <div class="meter-track"><span class="meter-fill" style="width:${Math.min(100, Math.max(0, pct)).toFixed(1)}%"></span>${pace}</div>
        <span class="meter-text">${label} ${fmtWon(target)} · ${kind === "less" ? "집행" : "달성"} ${fmtPct(pct, 0)}${paceTxt}</span></div>`;
    }

    function tile(label, value, color, compareHtml, meterHtml) {
      return `<div class="kpi" style="--kpi-color:${color}">
        <span class="kpi-label">${label}</span>
        <span class="kpi-value">${value}</span>
        <span class="kpi-compare">${compareHtml}</span>
        ${meterHtml || ""}</div>`;
    }

    /** 상위 n개 + 나머지는 '기타'로 접어 가로 막대 */
    function topItems(rows, nameKey, valueFn, n) {
      const items = rows.map(r => ({ name: unset(r[nameKey]), value: valueFn(r), cnt: r.cnt }))
        .filter(it => it.value !== 0).sort((a, b) => b.value - a.value);
      if (items.length <= n) return items;
      const rest = items.slice(n - 1);
      return items.slice(0, n - 1).concat([{
        name: `기타 ${rest.length}개`, value: rest.reduce((a, b) => a + b.value, 0),
        cnt: rest.reduce((a, b) => a + (b.cnt || 0), 0),
      }]);
    }
    const incSales = r => (Number(r.amount) || 0) - (Number(r.payout) || 0);

    // ---------------------------------------------------------------- 경영현황
    const RP = { unit: "month", date: null };
    const SALES_TITLE = { day: "최근 14일 매출", week: "요일별 매출", month: "일별 매출", quarter: "주별 매출", year: "월별 매출" };
    const METRIC_ROWS = [
      { key: "sales", label: "매출 (실매출)", hint: "매출액 − 미지급금", fmt: "won", up: true, target: "sales", tk: "more", strong: true },
      { key: "gross", label: "매출액 (총매출)", fmt: "won", up: true, sub: true },
      { key: "payout", label: "미지급금 (매출차감)", fmt: "won", up: false, sub: true },
      { key: "expense", label: "지출", fmt: "won", up: false, target: "expense", tk: "less", strong: true },
      { key: "cost", label: "원가 (제품원가)", fmt: "won", up: false, sub: true },
      { key: "profit", label: "영업이익", hint: "실매출 − 지출", fmt: "won", up: true, target: "profit", tk: "more", strong: true },
      { key: "margin", label: "영업이익률", fmt: "pct", up: true },
      { key: "cnt", label: "매출 건수", fmt: "count", up: true },
      { key: "avg_ticket", label: "객단가 (건당 실매출)", fmt: "won", up: true },
      { key: "days", label: "영업일수", fmt: "days", up: true },
      { key: "avg_daily", label: "일평균 매출", fmt: "won", up: true },
      { key: "card", label: "카드 매출", fmt: "won", up: true },
      { key: "cash", label: "현금 매출 (카드 외)", fmt: "won", up: true },
      { key: "vat", label: "부가세 (매출세액)", fmt: "won", up: null },
      { key: "cost_ratio", label: "원가율", hint: "원가 ÷ 실매출", fmt: "pct", up: false },
      { key: "expense_ratio", label: "지출비중", hint: "지출 ÷ 실매출", fmt: "pct", up: false },
    ];
    function fmtMetric(v, f) {
      if (v === null || v === undefined || (typeof v === "number" && !isFinite(v))) return dash;
      if (f === "won") return fmtWon(v);
      if (f === "pct") return fmtPct(v);
      if (f === "count") return `${fmt(v)}건`;
      if (f === "days") return `${fmt(v)}일`;
      return fmt(v);
    }
    function changeOf(def, cur, base) {
      if (def.fmt === "pct") {
        return cur === null || base === null || cur === undefined || base === undefined ? null : cur - base;
      }
      return M.pctChange(cur, base);
    }

    function metricsTable(K, KP, KL, T, o) {
      const head = `<tr><th>지표</th><th class="num">이번 기간</th><th class="num">${o.prevLabel}</th><th class="num">증감</th>` +
        (o.showLy ? `<th class="num">전년 동기</th><th class="num">증감</th>` : "") +
        `<th class="num">${o.targetLabel}</th><th class="num">달성률</th></tr>`;
      const body = METRIC_ROWS.map(def => {
        const cur = K[def.key], p = KP ? KP[def.key] : null, l = KL ? KL[def.key] : null;
        const up = def.up === null ? true : def.up;
        const chip = (base) => (def.up === null ? dash : changeChip(changeOf(def, cur, base), up, def.fmt === "pct"));
        const tgt = def.target && T ? T[def.target] : null;
        const ach = def.target ? M.achievement(cur, tgt) : null;
        const cls = def.strong ? "strong-row" : def.sub ? "sub-row" : "";
        return `<tr class="${cls}"><td class="metric-name">${def.label}${def.hint ? ` <span class="muted hint">${def.hint}</span>` : ""}</td>` +
          `<td class="num strong">${fmtMetric(cur, def.fmt)}</td>` +
          `<td class="num">${KP ? fmtMetric(p, def.fmt) : dash}</td><td class="num">${KP ? chip(p) : dash}</td>` +
          (o.showLy ? `<td class="num">${KL ? fmtMetric(l, def.fmt) : dash}</td><td class="num">${KL ? chip(l) : dash}</td>` : "") +
          `<td class="num">${def.target ? wonOrDash(tgt === null ? null : Math.round(tgt)) : ""}</td>` +
          `<td class="num">${def.target ? achChip(ach, def.tk) : ""}</td></tr>`;
      }).join("");
      return `<table class="data metrics-table"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    }

    function rpPeriod() { return M.periodOf(RP.unit, RP.date || todayStr()); }
    function rangeText(r) {
      if (!r) return "";
      return r.from === r.to ? M.md(r.from) : `${r.from.slice(0, 4) !== todayStr().slice(0, 4) ? r.from.slice(0, 4) + ". " : ""}${M.md(r.from)} ~ ${M.md(r.to)}`;
    }

    refreshers.report = async function () {
      const p = rpPeriod();
      $("rpDate").value = RP.date || todayStr();
      document.querySelectorAll("#rpUnit [data-unit]").forEach(b => {
        const on = b.dataset.unit === RP.unit;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      const today = todayStr();
      const plan = M.comparePlan(p, today);
      const bks = M.buckets(p);
      const spans = [{ from: p.start, to: p.end }, plan.prevRange, plan.lyRange,
        ...bks.map(b => b), ...bks.map(b => b.ly)].filter(Boolean);
      const from = spans.reduce((a, s) => (s.from < a ? s.from : a), p.start);
      const to = spans.reduce((a, s) => (s.to > a ? s.to : a), p.end);
      const cur = plan.cur;
      const req = nextReq("report");
      try {
        const none = Promise.resolve([]);
        const [inc, exp, T, byCat, byBrand, byExp, byAcct, byPay, bal] = await Promise.all([
          agg("incomes", from, to, "date"), agg("expenses", from, to, "date"), loadTargets(),
          cur ? agg("incomes", cur.from, cur.to, "category") : none,
          cur ? agg("incomes", cur.from, cur.to, "manufacturer") : none,
          cur ? agg("expenses", cur.from, cur.to, "expense_type") : none,
          cur ? agg("incomes", cur.from, cur.to, "account") : none,
          cur ? agg("expenses", cur.from, cur.to, "payment_type") : none,
          api("/api/receivables?summary=1"),
        ]);
        if (isStale("report", req)) return;
        renderReport(p, plan, bks, inc, exp, T, { byCat, byBrand, byExp, byAcct, byPay, bal });
      } catch (err) { toast(err.message, true); }
    };

    function renderReport(p, plan, bks, inc, exp, T, extra) {
      const today = todayStr();
      const prog = plan.progress;
      const prevName = M.PREV_LABEL[p.unit];
      const showLy = p.unit !== "year";  // 연 단위는 전기가 곧 전년
      const K = M.metricsFor(inc, exp, plan.cur);
      const KP = plan.prevRange ? M.metricsFor(inc, exp, plan.prevRange) : null;
      const KL = plan.lyRange ? M.metricsFor(inc, exp, plan.lyRange) : null;
      const full = M.targetFor(T, p.start, p.end);
      const pace = prog.state === "current" ? M.targetFor(T, p.start, prog.to) : full;
      const paceFrac = prog.state === "current" ? prog.elapsed / p.days : prog.state === "future" ? 0 : null;

      // 기간 안내
      const status = prog.state === "current"
        ? `<span class="status info">진행 중</span> 오늘(${M.md(today)})까지 ${prog.elapsed}일 — 비교 기간도 같은 ${prog.elapsed}일만 봅니다`
        : prog.state === "future" ? '<span class="status warn">아직 시작 전</span>' : '<span class="status ok">마감</span>';
      $("rpBanner").innerHTML = `<b>${esc(p.label)}</b>${p.range ? ` <span class="muted">${p.range}</span>` : ""} · ${status}` +
        (plan.prevRange ? `<span class="banner-compare">비교 — ${prevName} ${rangeText(plan.prevRange)}` +
          (showLy && plan.lyRange ? ` · 전년 동기 ${plan.lyRange.from.slice(0, 4)}. ${M.md(plan.lyRange.from)}${plan.lyRange.from !== plan.lyRange.to ? " ~ " + M.md(plan.lyRange.to) : ""}` : "") +
          `</span>` : "");

      // 핵심 지표 4개
      const cmp = (key, up, pp) => {
        const parts = [];
        if (KP) parts.push(`<span>${prevName} ${changeChip(pp ? (K[key] === null || KP[key] === null ? null : K[key] - KP[key]) : M.pctChange(K[key], KP[key]), up, pp)}</span>`);
        if (showLy && KL) parts.push(`<span>전년 동기 ${changeChip(pp ? (K[key] === null || KL[key] === null ? null : K[key] - KL[key]) : M.pctChange(K[key], KL[key]), up, pp)}</span>`);
        return parts.join("");
      };
      const tgtMargin = full.sales && full.profit !== null ? full.profit / full.sales * 100 : null;
      $("rpTiles").innerHTML = `<div class="kpi-row four">` +
        tile("매출 (실매출)", fmtWon(K.sales), "var(--series-income)", cmp("sales", true),
          meter(K.sales, full.sales, paceFrac, "more", "목표")) +
        tile("지출", fmtWon(K.expense), "var(--series-expense)", cmp("expense", false),
          meter(K.expense, full.expense, paceFrac, "less", "예산")) +
        tile("영업이익", fmtWon(K.profit), "var(--series-profit)", cmp("profit", true),
          meter(K.profit, full.profit, paceFrac, "more", "목표")) +
        tile("영업이익률", fmtPct(K.margin), "var(--series-profit)", cmp("margin", true, true),
          `<div class="meter none"><span class="meter-text">${tgtMargin !== null ? `목표 이익률 ${fmtPct(tgtMargin)}` : "실매출 대비 영업이익"}</span></div>`) +
        `</div>`;

      // 경영지표 비교표 (진행 중이면 목표도 오늘까지 일수만큼)
      $("rpTableMeta").textContent = prog.state === "current"
        ? `목표는 오늘까지 ${prog.elapsed}일만큼(월 목표를 날짜 수로 나눔)` : "목표는 월 목표를 날짜 수로 나눠 계산";
      $("rpTable").innerHTML = metricsTable(K, KP, KL, pace, {
        prevLabel: prevName, showLy, targetLabel: prog.state === "current" ? "목표(경과일)" : "목표",
      });

      // 매출 추이: 이번 기간 · 전년 동기 · 목표
      const salesOf = r => (r ? M.sumRange(inc, r, M.INC_KEYS) : null);
      const curVals = bks.map(b => {
        if (b.from > today) return null;
        const s = salesOf({ from: b.from, to: b.to < today ? b.to : today });
        return s.amount - s.payout;
      });
      const lyVals = bks.map(b => { const s = salesOf(b.ly); return s ? s.amount - s.payout : null; });
      const tgtVals = bks.map(b => M.targetFor(T, b.from, b.to).sales);
      $("rpSalesTitle").textContent = SALES_TITLE[p.unit];
      WCharts.groupedBars($("rpSalesChart"), bks.map(b => b.label), [
        { name: p.unit === "year" ? `${p.start.slice(0, 4)}년` : "이번 기간", color: getCss("--series-income"), values: curVals },
        { name: "전년 동기", color: getCss("--series-income-ly"), values: lyVals },
      ], {
        markers: { name: "목표", color: getCss("--ink"), values: tgtVals.map(v => (v === null ? null : Math.round(v))) },
        xTickEvery: bks.length > 16 ? Math.ceil(bks.length / 12) : 1,
        titleFn: (lab, i) => bks[i].from === bks[i].to ? `${bks[i].from} (${M.WEEKDAY_KO[M.weekdayIdx(bks[i].from)]})` : `${bks[i].from} ~ ${bks[i].to}`,
        ariaLabel: `${SALES_TITLE[p.unit]}: 이번 기간과 전년 동기, 목표`,
      });

      // 손익: 일 단위는 최근 14일 그날그날, 나머지는 기간 시작부터 누적
      const cumulative = p.unit !== "day";
      $("rpPnlTitle").textContent = cumulative ? "누적 손익 (기간 시작부터)" : "최근 14일 손익";
      let cs = 0, ce = 0, ct = 0;
      const pnl = { s: [], e: [], p: [], t: [] };
      bks.forEach(b => {
        // 진행 중인 기간은 오늘까지만 그린다: 실적과 같은 눈금에서 목표 진도와 비교하도록
        if (b.from > today) { pnl.s.push(null); pnl.e.push(null); pnl.p.push(null); pnl.t.push(null); return; }
        const t = M.targetFor(T, b.from, b.to < today ? b.to : today).sales;
        ct += t || 0;
        pnl.t.push(t === null && !ct ? null : Math.round(ct));
        const k = M.metricsFor(inc, exp, { from: b.from, to: b.to < today ? b.to : today });
        if (cumulative) { cs += k.sales; ce += k.expense; } else { cs = k.sales; ce = k.expense; }
        pnl.s.push(cs); pnl.e.push(ce); pnl.p.push(cs - ce);
      });
      const pnlSeries = [
        { name: cumulative ? "누적 매출" : "매출", color: getCss("--series-income"), values: pnl.s },
        { name: cumulative ? "누적 지출" : "지출", color: getCss("--series-expense"), values: pnl.e },
        { name: cumulative ? "누적 영업이익" : "영업이익", color: getCss("--series-profit"), values: pnl.p },
      ];
      if (cumulative && pnl.t.some(v => v)) pnlSeries.push({ name: "누적 매출 목표", color: getCss("--ink-2"), values: pnl.t, dashed: true });
      WCharts.lines($("rpPnlChart"), bks.map(b => b.label), pnlSeries, {
        xTickEvery: bks.length > 16 ? Math.ceil(bks.length / 10) : 1,
        titleFn: (lab, i) => cumulative ? `${p.start} ~ ${bks[i].to}` : bks[i].from,
        ariaLabel: cumulative ? "누적 매출·지출·영업이익" : "최근 14일 매출·지출·영업이익",
      });

      // 구성
      const inc$ = getCss("--series-income"), exp$ = getCss("--series-expense");
      WCharts.hBars($("rpByCategory"), topItems(extra.byCat, "category", incSales, 8), inc$);
      WCharts.hBars($("rpByBrand"), topItems(extra.byBrand, "manufacturer", incSales, 8), inc$);
      WCharts.hBars($("rpByExpense"), topItems(extra.byExp, "expense_type", r => r.amount, 8), exp$);

      // 재무·자금 흐름
      const b = extra.bal;
      $("rpCash").innerHTML = metricStrip(
        metric("매출 입금액", fmtWon(K.cash_in), "매출액 − 이 기간 매출의 미수금") +
        metric("거래처 지급액", fmtWon(K.payout_paid), `미지급금 중 지급 완료 · 남은 돈 ${fmtWon(K.payout_due)}`) +
        metric("지출 지급액", fmtWon(K.cash_out), `지출 − 미지급금 ${fmtWon(K.payable)}`) +
        metric("순현금흐름", fmtWon(K.net_cash), "입금 − 거래처 지급 − 지출 지급") +
        metric("부가세 (매출세액)", fmtWon(K.vat), "부가세 신고 참고 (1기 1~6월 · 2기 7~12월)") +
        metric("지금 미수금 잔액", fmtWon(b.incomes.total), `${fmt(b.incomes.count)}건 · 전체 기간`,
          ' role="button" tabindex="0" data-goto="balances" title="미수·미지급 화면으로 이동"') +
        metric("지금 미지급금 잔액", fmtWon(b.expenses.total + b.payouts.total),
          `지출 ${fmtWon(b.expenses.total)} · 매출차감 ${fmtWon(b.payouts.total)}`,
          ' role="button" tabindex="0" data-goto="balances" title="미수·미지급 화면으로 이동"'));
      WCharts.hBars($("rpByAccount"), topItems(extra.byAcct, "account", r => r.amount, 6), inc$);
      WCharts.hBars($("rpByPayment"), topItems(extra.byPay, "payment_type", r => r.amount, 6), exp$);
    }

    $("rpUnit").addEventListener("click", e => {
      const b = e.target.closest("[data-unit]");
      if (!b) return;
      RP.unit = b.dataset.unit;
      refreshers.report();
    });
    $("rpDate").addEventListener("change", () => { RP.date = $("rpDate").value || null; refreshers.report(); });
    $("rpToday").addEventListener("click", () => { RP.date = null; refreshers.report(); });
    const stepReport = n => { RP.date = M.shift(rpPeriod(), n).start; refreshers.report(); };
    $("rpPrev").addEventListener("click", () => stepReport(-1));
    $("rpNext").addEventListener("click", () => stepReport(1));

    // ---------------------------------------------------------------- 매출·비용 분석
    const AN_DIMS = {
      incomes: [["manufacturer", "브랜드"], ["car_model", "차종"], ["category", "서비스 구분 (매출구분)"],
        ["income_type", "매출유형"], ["client", "거래처"], ["payment_type", "결제유형"],
        ["product_model", "제품모델"], ["account", "계좌"]],
      expenses: [["expense_type", "지출유형"], ["item", "거래품목"], ["client", "거래처"], ["payment_type", "결제유형"]],
    };
    const AN_MEASURES = {
      incomes: [["sales", "실매출"], ["gross", "매출액 (총매출)"], ["cnt", "건수"], ["avg", "객단가"]],
      expenses: [["amount", "지출금액"], ["cnt", "건수"]],
    };
    const AN_DEFAULT = { incomes: ["manufacturer", "car_model", "sales"], expenses: ["expense_type", "item", "amount"] };
    const AN_PERIODS = [["this-month", "이번 달", "month"], ["last-month", "지난 달", "month"],
      ["this-quarter", "이번 분기", "quarter"], ["last-quarter", "지난 분기", "quarter"],
      ["this-year", "올해", "year"], ["last-year", "작년", "year"], ["last-12m", "최근 12개월", null],
      ["custom", "직접 지정", null]];
    const AN = { kind: "incomes" };
    const dimLabel = (kind, key) => (AN_DIMS[kind].find(d => d[0] === key) || [key, key])[1];

    function anPreset(key) {
      const t = todayStr();
      const pm = M.periodOf("month", t), pq = M.periodOf("quarter", t), py = M.periodOf("year", t);
      switch (key) {
        case "this-month": return [pm.start, pm.end];
        case "last-month": { const q = M.shift(pm, -1); return [q.start, q.end]; }
        case "this-quarter": return [pq.start, pq.end];
        case "last-quarter": { const q = M.shift(pq, -1); return [q.start, q.end]; }
        case "this-year": return [py.start, py.end];
        case "last-year": { const q = M.shift(py, -1); return [q.start, q.end]; }
        case "last-12m": return [M.addDays(M.addMonths(t, -12), 1), t];
        default: return null;
      }
    }
    function anSetKind(kind) {
      AN.kind = kind;
      document.querySelectorAll("#anKind [data-kind]").forEach(b => {
        const on = b.dataset.kind === kind;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
      const dims = AN_DIMS[kind];
      fillSelect($("anDim1"), dims.map(d => d[0]), false, dims.map(d => d[1]));
      fillSelect($("anDim2"), ["", ...dims.map(d => d[0])], false, ["없음", ...dims.map(d => d[1])]);
      fillSelect($("anMeasure"), AN_MEASURES[kind].map(m => m[0]), false, AN_MEASURES[kind].map(m => m[1]));
      const [d1, d2, ms] = AN_DEFAULT[kind];
      $("anDim1").value = d1;
      $("anDim2").value = d2;
      $("anMeasure").value = ms;
    }
    fillSelect($("anPeriod"), AN_PERIODS.map(p => p[0]), false, AN_PERIODS.map(p => p[1]));
    $("anPeriod").value = "this-year";
    (function () { const r = anPreset("this-year"); $("anFrom").value = r[0]; $("anTo").value = r[1]; })();
    anSetKind("incomes");

    /** sums → 화면 값 */
    function measureValue(sums, measure) {
      if (!sums) return null;
      const sales = (sums.amount || 0) - (sums.payout || 0);
      switch (measure) {
        case "sales": return sales;
        case "gross": case "amount": return sums.amount || 0;
        case "cnt": return sums.cnt || 0;
        case "avg": return sums.cnt ? sales / sums.cnt : null;
        default: return null;
      }
    }
    const fmtMeasure = (v, measure) => (v === null || v === undefined ? "–" : measure === "cnt" ? `${fmt(v)}건` : fmtWon(v));

    let anLast = null;  // 엑셀로 받기용 마지막 결과
    refreshers.analysis = async function () {
      const kind = AN.kind, dim1 = $("anDim1").value, dim2 = $("anDim2").value === $("anDim1").value ? "" : $("anDim2").value;
      const measure = $("anMeasure").value, unit = $("anCols").value, compare = $("anCompare").value;
      const from = $("anFrom").value, to = $("anTo").value;
      if (!from || !to || from > to) { toast("기간을 확인하세요.", true); return; }
      const preset = AN_PERIODS.find(p => p[0] === $("anPeriod").value);
      const crange = compare === "none" ? null : M.compareRange(from, to, compare, preset ? preset[2] : null);
      let cols = M.colKeys(unit, from, to);
      let colUnit = unit;
      let note = "";
      if (cols.length > 62) {
        note = `열이 ${cols.length}개라 합계만 보입니다. 열 단위를 더 크게 고르세요.`;
        colUnit = "total";
        cols = ["합계"];
      }
      const time = M.timeGroupFor(colUnit);
      const dims = [dim1, dim2].filter(Boolean);
      const keys = kind === "incomes" ? ["amount", "payout", "cnt"] : ["amount", "cnt"];
      const req = nextReq("analysis");
      try {
        const [rows, crows] = await Promise.all([
          agg(kind, from, to, [time, ...dims].filter(Boolean).join(",")),
          crange ? agg(kind, crange.from, crange.to, dims.join(",")) : Promise.resolve(null),
        ]);
        if (isStale("analysis", req)) return;
        const pv = M.pivot(rows, { time, unit: colUnit, dims, keys });
        const cpv = crows ? M.pivot(crows, { time: null, unit: "total", dims, keys }) : null;
        const cmpOf = (name1, name2) => {
          if (!cpv) return null;
          const g = cpv.groups.find(x => x.name === name1);
          if (!g) return null;
          if (name2 === undefined) return g.sums;
          const c = g.children.find(x => x.name === name2);
          return c ? c.sums : null;
        };
        const sortVal = g => measureValue(g.sums, measure) ?? -Infinity;
        pv.groups.sort((a, b) => sortVal(b) - sortVal(a));
        pv.groups.forEach(g => g.children.sort((a, b) => sortVal(b) - sortVal(a)));
        anLast = { kind, dims, measure, colUnit, cols, pv, cpv, cmpOf, crange, from, to, compare };
        renderAnalysis(anLast, note);
      } catch (err) { toast(err.message, true); }
    };

    function renderAnalysis(a, note) {
      const { kind, dims, measure, colUnit, cols, pv, crange } = a;
      const mLabel = AN_MEASURES[kind].find(m => m[0] === measure)[1];
      const total = measureValue(pv.total, measure);
      const shareOn = measure !== "avg";
      const color = getCss(kind === "incomes" ? "--series-income" : "--series-expense");
      const top = pv.groups[0];
      const cmpTotal = a.cpv ? measureValue(a.cpv.total, measure) : null;
      $("anSummary").innerHTML = metricStrip(
        metric("기간", `${a.from} ~ ${a.to}`, crange ? `비교 ${crange.from} ~ ${crange.to}` : "비교 안 함") +
        metric(`합계 · ${mLabel.replace(/ \(.*\)$/, "")}${measure === "sales" ? " (매출액 − 미지급금)" : measure === "avg" ? " (건당 실매출)" : ""}`, fmtMeasure(total, measure),
          a.cpv ? `비교 기간 ${fmtMeasure(cmpTotal, measure)} · ${changeChip(M.pctChange(total, cmpTotal), kind === "incomes")}` : `${fmt(pv.total.cnt || 0)}건`) +
        metric(`${dimLabel(kind, dims[0])} 수`, `${fmt(pv.groups.length)}개`, dims[1] ? `세부 ${dimLabel(kind, dims[1])}별로 나눔` : "") +
        metric("1위", top ? esc(unset(top.name)) : "–",
          top ? `${fmtMeasure(measureValue(top.sums, measure), measure)}${shareOn && total ? ` · ${fmtPct(measureValue(top.sums, measure) / total * 100)}` : ""}` : ""));

      $("anChartTitle").textContent = `${dimLabel(kind, dims[0])}별 ${mLabel.replace(/ \(.*\)$/, "")} 상위`;
      $("anChartMeta").textContent = pv.groups.length > 15 ? `상위 15개 · 전체 ${fmt(pv.groups.length)}개` : "";
      WCharts.hBars($("anChart"), pv.groups.slice(0, 15).map(g => ({
        name: unset(g.name), value: measureValue(g.sums, measure) || 0, cnt: g.sums.cnt,
      })), color, { fmt: v => fmtMeasure(v, measure) });

      $("anTableMeta").textContent = note || (measure === "avg" ? "객단가는 칸마다 실매출 ÷ 건수" : "");
      if (!pv.groups.length) { $("anTable").innerHTML = '<p class="empty-msg">조건에 맞는 내역이 없습니다.</p>'; return; }
      const showCols = colUnit !== "total";
      const head = `<tr><th>${esc(dims.map(d => dimLabel(kind, d)).join(" › "))}</th>` +
        (showCols ? cols.map(c => `<th class="num">${esc(M.colLabel(colUnit, c))}</th>`).join("") : "") +
        `<th class="num">합계</th>${shareOn ? '<th class="num">비중</th>' : ""}` +
        (a.cpv ? `<th class="num">비교 기간</th><th class="num">증감</th>` : "") + `</tr>`;
      const row = (name, sums, cells, cmp, cls) => {
        const v = measureValue(sums, measure);
        const cv = cmp ? measureValue(cmp, measure) : null;
        return `<tr class="${cls}"><td>${cls === "child" ? '<span class="tree">└</span> ' : ""}${esc(unset(name))}</td>` +
          (showCols ? cols.map(c => `<td class="num">${cells[c] ? fmtMeasure(measureValue(cells[c], measure), measure) : '<span class="muted">·</span>'}</td>`).join("") : "") +
          `<td class="num strong">${fmtMeasure(v, measure)}</td>` +
          (shareOn ? `<td class="num">${total ? fmtPct(v / total * 100) : "–"}</td>` : "") +
          (a.cpv ? `<td class="num">${fmtMeasure(cv, measure)}</td><td class="num">${changeChip(M.pctChange(v, cv), kind === "incomes" || measure === "cnt")}</td>` : "") +
          `</tr>`;
      };
      let body = "";
      for (const g of pv.groups) {
        body += row(g.name, g.sums, g.cells, a.cmpOf(g.name), dims[1] ? "group" : "");
        if (dims[1]) for (const c of g.children) body += row(c.name, c.sums, c.cells, a.cmpOf(g.name, c.name), "child");
      }
      body += `<tr class="total-row"><td>합계</td>` +
        (showCols ? cols.map(c => `<td class="num">${fmtMeasure(measureValue(pv.colTotals[c], measure) ?? 0, measure)}</td>`).join("") : "") +
        `<td class="num">${fmtMeasure(total, measure)}</td>${shareOn ? `<td class="num">${total ? "100%" : "–"}</td>` : ""}` +
        (a.cpv ? `<td class="num">${fmtMeasure(cmpTotal, measure)}</td><td class="num">${changeChip(M.pctChange(total, cmpTotal), kind === "incomes" || measure === "cnt")}</td>` : "") + `</tr>`;
      $("anTable").innerHTML = `<table class="data pivot compact"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    }

    $("anKind").addEventListener("click", e => {
      const b = e.target.closest("[data-kind]");
      if (!b || b.dataset.kind === AN.kind) return;
      anSetKind(b.dataset.kind);
      refreshers.analysis();
    });
    for (const id of ["anDim1", "anDim2", "anMeasure", "anCols", "anCompare"]) {
      $(id).addEventListener("change", () => refreshers.analysis());
    }
    $("anPeriod").addEventListener("change", () => {
      const r = anPreset($("anPeriod").value);
      if (r) { $("anFrom").value = r[0]; $("anTo").value = r[1]; }
      refreshers.analysis();
    });
    for (const id of ["anFrom", "anTo"]) {
      $(id).addEventListener("change", () => { $("anPeriod").value = "custom"; refreshers.analysis(); });
    }

    $("anExport").addEventListener("click", async () => {
      const a = anLast;
      if (!a || !a.pv.groups.length) { toast("먼저 집계 결과가 있어야 합니다.", true); return; }
      const W = window.WellcarXlsxWriter, S = W.S;
      const mLabel = AN_MEASURES[a.kind].find(m => m[0] === a.measure)[1];
      const showCols = a.colUnit !== "total", shareOn = a.measure !== "avg";
      const isWon = a.measure !== "cnt";
      const num = v => (v === null || v === undefined ? null : { v: Math.round(v), s: S.won });
      const total = measureValue(a.pv.total, a.measure);
      const head = [a.dims.map(d => dimLabel(a.kind, d)).join(" › "),
        ...(showCols ? a.cols.map(c => M.colLabel(a.colUnit, c)) : []), "합계", ...(shareOn ? ["비중"] : []),
        ...(a.cpv ? ["비교 기간", "증감률"] : [])].map(t => ({ v: t, s: S.head }));
      const line = (name, sums, cells, cmp, indent) => {
        const v = measureValue(sums, a.measure);
        const cv = cmp ? measureValue(cmp, a.measure) : null;
        const ch = M.pctChange(v, cv);
        return [(indent ? "  └ " : "") + unset(name),
          ...(showCols ? a.cols.map(c => (cells[c] ? num(measureValue(cells[c], a.measure)) : null)) : []),
          num(v), ...(shareOn ? [total ? { v: v / total, s: S.pct } : null] : []),
          ...(a.cpv ? [num(cv), ch === null ? null : { v: ch / 100, s: S.pct }] : [])];
      };
      const rows = [
        [{ v: `웰카오디오 ${a.kind === "incomes" ? "매출" : "비용"} 분석 — ${a.dims.map(d => dimLabel(a.kind, d)).join(" › ")}별 ${mLabel}`, s: S.title }],
        [{ v: `기간 ${a.from} ~ ${a.to}${a.crange ? ` · 비교 ${a.crange.from} ~ ${a.crange.to}` : ""} · 단위: ${isWon ? "원" : "건"}`, s: S.muted }],
        [], head,
      ];
      for (const g of a.pv.groups) {
        rows.push(line(g.name, g.sums, g.cells, a.cmpOf(g.name), false));
        if (a.dims[1]) for (const c of g.children) rows.push(line(c.name, c.sums, c.cells, a.cmpOf(g.name, c.name), true));
      }
      const tot = [{ v: "합계", s: S.totalLabel },
        ...(showCols ? a.cols.map(c => ({ v: Math.round(measureValue(a.pv.colTotals[c], a.measure) ?? 0), s: S.totalNum })) : []),
        { v: Math.round(total ?? 0), s: S.totalNum }, ...(shareOn ? [{ v: total ? 1 : 0, s: S.totalPct }] : [])];
      if (a.cpv) {
        const ct = measureValue(a.cpv.total, a.measure), ch = M.pctChange(total, ct);
        tot.push({ v: Math.round(ct ?? 0), s: S.totalNum }, ch === null ? null : { v: ch / 100, s: S.totalPct });
      }
      rows.push(tot);
      const widths = [30, ...(showCols ? a.cols.map(() => 12) : []), 15, ...(shareOn ? [8] : []), ...(a.cpv ? [15, 9] : [])];
      const blob = W.build([{ name: "집계", widths, freeze: "B5", rows }]);
      const name = `웰카오디오_${a.kind === "incomes" ? "매출" : "비용"}분석_${a.dims.map(d => dimLabel(a.kind, d).replace(/ \(.*\)$/, "").replace(/\s+/g, "")).join("-")}_${a.from}_${a.to}.xlsx`;
      try { toast(`${await saveBlob(name, blob)} 파일을 받았습니다.`); }
      catch (err) { toast(err.message, true); }
    });

    // ---------------------------------------------------------------- 목표·실적
    const TG = { editing: false, data: null };
    const TG_KEYS = [["sales", "매출 목표", "more"], ["profit", "영업이익 목표", "more"], ["expense", "지출 예산", "less"]];

    function fillTargetYears(years) {
      const now = +todayStr().slice(0, 4);
      const set = new Set(years.map(Number));
      set.add(now); set.add(now + 1);
      const list = [...set].sort((a, b) => a - b).map(String);
      const prev = $("tgYear").value;
      fillSelect($("tgYear"), list, false, list.map(y => y + "년"));
      $("tgYear").value = prev && list.includes(prev) ? prev : String(now);
    }

    refreshers.targets = async function () {
      const y = +$("tgYear").value;
      const req = nextReq("targets");
      try {
        const [inc, exp, T] = await Promise.all([
          agg("incomes", `${y - 1}-01-01`, `${y}-12-31`, "month"),
          agg("expenses", `${y - 1}-01-01`, `${y}-12-31`, "month"), loadTargets()]);
        if (isStale("targets", req)) return;
        const act = {};
        for (const r of inc) act[r.month] = Object.assign(act[r.month] || {}, { sales: incSales(r) });
        for (const r of exp) act[r.month] = Object.assign(act[r.month] || {}, { expense: r.amount });
        for (const k in act) act[k].profit = (act[k].sales || 0) - (act[k].expense || 0);
        TG.data = { y, act, T };
        renderTargets();
      } catch (err) { toast(err.message, true); }
    };

    function renderTargets() {
      const { y, act, T } = TG.data;
      const today = todayStr();
      const mk = m => `${y}-${String(m).padStart(2, "0")}`;
      const yearP = M.periodOf("year", `${y}-01-01`);
      const prog = M.progress(yearP, today);
      const ytdTo = prog.state === "current" ? today : yearP.end;
      const sumAct = (k, upto) => {
        let s = 0;
        for (let m = 1; m <= 12; m++) if (`${mk(m)}-01` <= upto) s += (act[mk(m)] || {})[k] || 0;
        return s;
      };
      const yearT = M.targetFor(T, yearP.start, yearP.end);
      const paceFrac = prog.state === "current" ? prog.elapsed / yearP.days : prog.state === "future" ? 0 : null;
      const ytd = { sales: sumAct("sales", ytdTo), profit: sumAct("profit", ytdTo), expense: sumAct("expense", ytdTo) };
      const lbl = prog.state === "current" ? "누계 (오늘까지)" : "연간 실적";
      $("tgTiles").innerHTML = `<div class="kpi-row">` +
        tile(`매출 ${lbl}`, fmtWon(ytd.sales), "var(--series-income)", "", meter(ytd.sales, yearT.sales, paceFrac, "more", "연 목표")) +
        tile(`영업이익 ${lbl}`, fmtWon(ytd.profit), "var(--series-profit)", "", meter(ytd.profit, yearT.profit, paceFrac, "more", "연 목표")) +
        tile(`지출 ${lbl}`, fmtWon(ytd.expense), "var(--series-expense)", "", meter(ytd.expense, yearT.expense, paceFrac, "less", "연 예산")) +
        `</div>`;

      // 차트: 올해 실적 · 작년 실적 · 목표
      const months = Array.from({ length: 12 }, (_, i) => i + 1);
      const lyk = m => `${y - 1}-${String(m).padStart(2, "0")}`;
      WCharts.groupedBars($("tgChart"), months.map(m => `${m}월`), [
        { name: `${y}년 실적`, color: getCss("--series-income"), values: months.map(m => (`${mk(m)}-01` > today ? null : (act[mk(m)] || {}).sales || 0)) },
        { name: `${y - 1}년 실적`, color: getCss("--series-income-ly"), values: months.map(m => (act[lyk(m)] || {}).sales || 0) },
      ], {
        markers: { name: "목표", color: getCss("--ink"), values: months.map(m => ((T[mk(m)] || {}).sales ?? null)) },
        xTickEvery: 1, titleFn: lab => `${y}년 ${lab}`, ariaLabel: `${y}년 월별 매출 실적과 목표`,
      });

      // 표
      const editing = TG.editing && can("admin");
      $("tgEditBar").hidden = !editing;
      $("tgEdit").hidden = editing;
      $("tgMeta").textContent = editing ? "목표 칸을 고친 뒤 저장하세요 (만원 단위)" : "진행 중인 달은 오늘까지의 실적";
      const curMonth = today.slice(0, 7);
      const cell = (m, k) => {
        const v = (T[mk(m)] || {})[k];
        if (editing) {
          const man = v === undefined || v === null ? "" : Math.round(v / 10000);
          return `<td class="num"><input type="number" class="input tg-input" step="1" ${k === "profit" ? "" : 'min="0"'} data-m="${m}" data-k="${k}" value="${man}" aria-label="${m}월 ${k}"></td>`;
        }
        return `<td class="num">${v === undefined || v === null ? dash : fmtWon(v)}</td>`;
      };
      const rowFor = (label, months, cls) => {
        let html = `<tr class="${cls || ""}"><td class="date">${label}</td>`;
        for (const [k, , tk] of TG_KEYS) {
          let tgt = null, has = false, actual = 0, started = false;
          for (const m of months) {
            const v = (T[mk(m)] || {})[k];
            if (v !== undefined && v !== null) { tgt = (tgt || 0) + v; has = true; }
            if (`${mk(m)}-01` <= today) { actual += (act[mk(m)] || {})[k] || 0; started = true; }
          }
          if (months.length === 1 && !cls) html += cell(months[0], k);
          else html += `<td class="num">${has ? fmtWon(tgt) : dash}</td>`;
          html += `<td class="num">${started ? fmtWon(actual) : dash}</td>`;
          let chip = started && has ? achChip(M.achievement(actual, tgt), tk) : dash;
          if (months.length === 1 && mk(months[0]) === curMonth && has && started) {
            const p = M.targetFor(T, `${curMonth}-01`, today)[k];
            chip += p ? `<span class="pace">진도 ${fmtPct(actual / p * 100, 0)}</span>` : "";
          }
          html += `<td class="num">${chip}</td>`;
        }
        return html + "</tr>";
      };
      let body = "";
      for (let q = 1; q <= 4; q++) {
        const ms = [q * 3 - 2, q * 3 - 1, q * 3];
        for (const m of ms) body += rowFor(`${m}월${mk(m) === curMonth ? ' <span class="tag cur">진행 중</span>' : ""}`, [m]);
        body += rowFor(`${q}분기`, ms, "sub-total");
      }
      body += rowFor("연간", months, "total-row");
      $("tgTable").innerHTML = `<table class="data targets-table${editing ? " editing" : ""}"><thead><tr><th>월</th>` +
        TG_KEYS.map(([, l, tk]) => `<th class="num">${l}</th><th class="num">실적</th><th class="num">${tk === "less" ? "집행률" : "달성률"}</th>`).join("") +
        `</tr></thead><tbody>${body}</tbody></table>`;
    }

    $("tgYear").addEventListener("change", () => { TG.editing = false; refreshers.targets(); });
    $("tgEdit").addEventListener("click", () => { TG.editing = true; renderTargets(); });
    $("tgCancel").addEventListener("click", () => { TG.editing = false; renderTargets(); });
    $("tgCopyJan").addEventListener("click", () => {
      for (const [k] of TG_KEYS) {
        const jan = document.querySelector(`.tg-input[data-m="1"][data-k="${k}"]`);
        document.querySelectorAll(`.tg-input[data-k="${k}"]`).forEach(i => { i.value = jan ? jan.value : ""; });
      }
    });
    $("tgFillLy").addEventListener("click", () => {
      const { y, act } = TG.data;
      const g = 1 + (Number($("tgGrowth").value) || 0) / 100;
      let filled = 0;
      for (let m = 1; m <= 12; m++) {
        const ly = act[`${y - 1}-${String(m).padStart(2, "0")}`];
        if (!ly) continue;
        filled++;
        for (const [k] of TG_KEYS) {
          const input = document.querySelector(`.tg-input[data-m="${m}"][data-k="${k}"]`);
          if (input) input.value = Math.round((ly[k] || 0) * g / 10000);
        }
      }
      toast(filled ? `${y - 1}년 실적 기준으로 ${filled}개월을 채웠습니다. 확인 후 저장하세요.` : `${y - 1}년 실적이 없습니다.`, !filled);
    });
    $("tgSave").addEventListener("click", async () => {
      const y = TG.data.y;
      const months = {};
      for (const input of document.querySelectorAll(".tg-input")) {
        const m = input.dataset.m, k = input.dataset.k;
        const v = input.value.trim();
        months[m] = months[m] || {};
        months[m][k] = v === "" ? null : Math.round(Number(v) * 10000);
      }
      try {
        await put("/api/targets", { year: y, months });
        invalidateTargets();
        TG.editing = false;
        toast(`${y}년 목표를 저장했습니다.`);
        refreshers.targets();
      } catch (err) { toast(err.message, true); }
    });

    return { fillTargetYears };
  };
})();
