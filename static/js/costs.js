/* 지출 분석 화면: 기간별(비용 추세) · 유형별 · 원가 분석.
   app.js가 WellcarCosts(ctx)로 연결한다. 지출은 /api/agg를 날짜×지출유형×품목×거래처로, 매출은 날짜별로 한 번 받아 화면에서 나눈다.
   계산은 metrics.js, 함께 쓰는 도우미는 hubkit.js. 원가 = 지출유형 '제품원가'. */
(function () {
  "use strict";

  window.WellcarCosts = function install(ctx) {
    const { $, esc, fmt, fmtWon, toast, getCss, refreshers, nextReq, isStale, metric, metricStrip, saveBlob, todayStr,
      kit: K, openEntries, openForecast } = ctx;
    const M = K.M;

    const TABS = ["period", "type", "cogs"];
    const COST_TYPE = "제품원가";
    const EXP = ["cnt", "amount", "cost"], INC = ["cnt", "amount", "payout"];
    const SEP = "\u001f", SEP2 = "\u001e";
    const norm = v => (v === null || v === undefined ? "" : String(v));
    const amountOf = r => Number(r.amount) || 0;
    const itemName = k => { const [t, i] = k.split(SEP); return `${K.unset(i)}${t ? ` (${t})` : ""}`; };
    const DIMS = {
      expense_type: { label: "지출유형", key: r => norm(r.expense_type), name: K.unset, skip: ["expense_type", "item"] },
      item: { label: "품목", key: r => norm(r.expense_type) + SEP + norm(r.item), name: itemName, skip: ["item"] },
      client: { label: "거래처", key: r => norm(r.client), name: K.unset, skip: ["client"] },
    };
    const FILTER_DIMS = ["expense_type", "item", "client"];
    const LIST_EL = { expense_type: "coListType", item: "coListItem", client: "coListClient" };
    const FILTER_EL = { expense_type: "coFType", item: "coFItem", client: "coFClient" };

    const ST = {
      period: +todayStr().slice(5, 7) <= 3 ? "last-12m" : "this-year", from: "", to: "", compare: "ly",
      f: {}, tab: "period", unit: null, data: null,
    };
    const FOPT = {};

    // ---------------------------------------------------------------- 조건
    const selectedKey = id => (id === "expense_type" ? ST.f.expense_type : id === "client" ? ST.f.client
      : ST.f.item !== undefined ? norm(ST.f.expense_type) + SEP + ST.f.item : undefined);
    /** 조건 하나를 정한다. key가 undefined면 지운다. 품목은 지출유형과 함께 정해진다 */
    function setFilter(id, key) {
      if (id === "expense_type") {
        delete ST.f.item;
        if (key === undefined) delete ST.f.expense_type; else ST.f.expense_type = key;
      } else if (id === "client") {
        if (key === undefined) delete ST.f.client; else ST.f.client = key;
      } else if (key === undefined) {
        delete ST.f.item;
      } else {
        const [t, i] = key.split(SEP);
        ST.f.expense_type = t;
        ST.f.item = i;
      }
    }
    function match(r, skip) {
      for (const k of FILTER_DIMS) {
        if (ST.f[k] === undefined || (skip && skip.includes(k))) continue;
        if (norm(r[k]) !== ST.f[k]) return false;
      }
      return true;
    }
    function slice(range, skip) {
      const out = [];
      if (!range || !ST.data) return out;
      for (const r of ST.data.rows) if (r.date >= range.from && r.date <= range.to && match(r, skip)) out.push(r);
      return out;
    }
    function totals(rows) {
      let amount = 0, cnt = 0, cost = 0;
      for (const r of rows) { amount += amountOf(r); cnt += Number(r.cnt) || 0; cost += Number(r.cost) || 0; }
      return { amount, cnt, cost, avg: cnt ? amount / cnt : null };
    }
    /** 범위의 실매출(매출액 − 거래처 지급액) */
    const salesIn = range => { const s = M.sumRange(ST.data.inc, range, INC); return s.amount - s.payout; };
    const ratio = (a, b) => (b ? a / b * 100 : null);
    const diff = (a, b) => (a === null || b === null || a === undefined || b === undefined ? null : a - b);
    const condParts = () => [
      ...(ST.f.expense_type !== undefined ? [`지출유형 ${K.unset(ST.f.expense_type)}`] : []),
      ...(ST.f.item !== undefined ? [`품목 ${K.unset(ST.f.item)}`] : []),
      ...(ST.f.client !== undefined ? [`거래처 ${K.unset(ST.f.client)}`] : [])];
    const condText = () => condParts().join(" · ") || "전체 지출";
    const hasFilter = () => FILTER_DIMS.some(k => ST.f[k] !== undefined);

    // ---------------------------------------------------------------- 자료 받기
    async function load(force) {
      const R = K.resolveRange(ST);
      if (!R) { toast("기간을 확인하세요. 시작일이 종료일보다 늦거나 오늘 뒤입니다.", true); return; }
      const key = [R.win.from, R.win.to].join("|");
      if (!force && ST.data && ST.data.key === key) { ST.data.R = R; render(); return; }
      const req = nextReq("costs");
      try {
        const [rows, inc] = await Promise.all([
          K.aggf("expenses", R.win.from, R.win.to, "date,expense_type,item,client"),
          K.aggf("incomes", R.win.from, R.win.to, "date"),
        ]);
        if (isStale("costs", req)) return;
        ST.data = { key, rows, inc, cover: R.win, R };
        render();
      } catch (err) { toast(err.message, true); }
    }
    refreshers.costs = () => load(true);

    const RENDER = {};
    function render() {
      if (!ST.data) return;
      $("coTools").hidden = ST.tab === "type";
      renderFilters();
      renderSummary();
      RENDER[ST.tab]();
    }

    // ---------------------------------------------------------------- 조건 선택 상자 · 요약
    function renderFilters() {
      const rows = ST.data.rows;
      for (const id of FILTER_DIMS) {
        const L = DIMS[id], sel = selectedKey(id);
        const pool = id === "item" && ST.f.expense_type !== undefined
          ? rows.filter(r => norm(r.expense_type) === ST.f.expense_type) : rows;
        const keys = [...K.groupRows(pool, L.key, amountOf).values()].sort((a, b) => b.v - a.v).map(g => g.key);
        if (sel !== undefined && !keys.includes(sel)) keys.unshift(sel);
        FOPT[id] = keys;
        $(FILTER_EL[id]).innerHTML = '<option value="">전체</option>' +
          keys.map((k, i) => `<option value="${i}">${esc(L.name(k))}</option>`).join("");
        $(FILTER_EL[id]).value = sel === undefined ? "" : String(keys.indexOf(sel));
      }
      $("coClear").hidden = !hasFilter();
    }

    function renderSummary() {
      const D = ST.data, R = D.R;
      const cur = totals(slice(R.cur)), prev = totals(slice(R.prev)), ly = totals(slice(R.ly));
      const cmp = ST.compare === "prev" ? prev : ly;
      const sales = { cur: salesIn(R.cur), prev: salesIn(R.prev), ly: salesIn(R.ly) };
      sales.cmp = ST.compare === "prev" ? sales.prev : sales.ly;
      D.tot = { cur, prev, ly, cmp, sales };
      const chip = (a, b) => `${R.cmpName} ${K.changeChip(M.pctChange(a, b), false)}`;
      const share = ratio(cur.amount, sales.cur), shareCmp = ratio(cmp.amount, sales.cmp);
      // 가장 많이 늘어난 지출유형(고른 유형이 있으면 그 안의 품목)
      const splitId = ST.f.expense_type === undefined ? "expense_type" : "item", L = DIMS[splitId];
      const a = K.groupRows(slice(R.cur, L.skip), L.key, amountOf), b = K.groupRows(slice(R.cmp, L.skip), L.key, amountOf);
      const riser = [...a.values()].map(g => ({ key: g.key, v: g.v, c: b.get(g.key) ? b.get(g.key).v : 0 }))
        .map(x => Object.assign(x, { up: x.v - x.c })).sort((x, y) => y.up - x.up)[0];
      $("coSummary").innerHTML = metricStrip(
        metric("기간", esc(R.label), `${R.cur.from} ~ ${R.cur.to} · 비교 ${R.cmp.from} ~ ${R.cmp.to}`) +
        metric("지출", fmtWon(cur.amount), chip(cur.amount, cmp.amount)) +
        metric("실매출 대비 지출", share === null ? "–" : K.fmtPct(share),
          `실매출 ${fmtWon(sales.cur)} · ${R.cmpName} ${K.changeChip(diff(share, shareCmp), false, true)}`) +
        metric("건수", `${fmt(cur.cnt)}건`, `건당 ${cur.avg === null ? "–" : fmtWon(cur.avg)} · ${chip(cur.cnt, cmp.cnt)}`) +
        metric(`가장 많이 늘어난 ${L.label}`, riser && riser.up > 0 ? esc(L.name(riser.key)) : "없음",
          riser && riser.up > 0 ? `${fmtWon(riser.c)} → ${fmtWon(riser.v)} ${K.changeChip(M.pctChange(riser.v, riser.c), false)}` : `${R.cmpName}보다 늘어난 곳이 없습니다`));
    }

    // ================================================================ 기간별 (비용 추세)
    /** all = true면 조건을 보지 않는다(원가 분석) */
    function calcPeriod(all) {
      const D = ST.data, R = D.R;
      const unit = ST.unit || K.autoUnit(R.days);
      const S = K.series(M.dateIndex(D.rows, EXP, all ? null : (r => match(r)), D.cover), unit, R.cur);
      const SS = K.series(M.dateIndex(D.inc, INC, null, D.cover), unit, R.cur);
      return { unit, U: K.UNIT[unit], rows: S.rows, sales: SS.rows, cut: S.cut };
    }
    const amt = s => (s ? s.amount : null);
    const sal = s => (s ? s.amount - s.payout : null);

    RENDER.period = function () {
      const D = ST.data, R = D.R, P = calcPeriod(false), { unit, U, rows } = P;
      K.setSeg("coUnit", "unit", unit);
      const cmpOf = r => (ST.compare === "prev" ? r.prev : r.ly);
      const vals = rows.map(r => amt(r.cur)), cmpVals = rows.map(r => amt(cmpOf(r)));
      const color = getCss("--series-expense"), lyColor = getCss("--series-expense-ly");
      $("coPeriodTitle").textContent = `${U.label} 지출`;
      $("coPeriodMeta").textContent = `${fmt(rows.length)}개 구간` + (P.cut ? ` · 구간이 많아 최근 ${fmt(rows.length)}개만 표시` : "") + " · 단위: 원";
      if (!rows.some(r => r.cur.cnt > 0)) {
        $("coPeriodChart").innerHTML = '<p class="empty-msg">이 기간·조건의 지출이 없습니다.</p>';
        $("coPeriodNote").innerHTML = "";
      } else {
        const showCmp = rows.length <= 45 && cmpVals.some(v => v !== null);
        const series = [{ name: "지출", color, values: vals }];
        if (showCmp) series.push({ name: R.cmpName, color: lyColor, values: cmpVals });
        const lines = [];
        if (U.ma > 1 && rows.length > U.ma) {
          lines.push({ name: `${U.ma}${U.one} 이동평균`, color: getCss("--ink"),
            values: M.movingAvg(rows.map((r, i) => (r.going ? null : vals[i])), U.ma) });
        }
        WCharts.groupedBars($("coPeriodChart"), rows.map(r => r.b.tick), series, {
          lines, valueFmt: fmtWon, titleFn: (_l, i) => K.periodTitle(rows[i]),
          tipExtra: i => (showCmp || cmpVals[i] === null ? [] : [{ name: R.cmpName, color: lyColor, value: cmpVals[i], fmt: fmtWon }]),
          ariaLabel: `${U.label} 지출: 이번 기간과 ${R.cmpName}`,
        });
        $("coPeriodNote").innerHTML = K.trendNote(unit, rows.filter(r => !r.partial && !r.going).map(r => amt(r.cur)), "지출", false, fmtWon);
      }

      // 표: 최근 구간이 위. 휴대폰에서는 고른 비교(전기 또는 전년 동기)만 남긴다
      const chg = (a, b) => (b === null || b === undefined ? K.dash : K.changeChip(M.pctChange(a, b), false));
      const pOpt = ST.compare === "prev" ? "" : " opt", lOpt = ST.compare === "prev" ? " opt" : "";
      const body = rows.slice().reverse().map((r, j) => {
        const s = sal(P.sales[rows.length - 1 - j].cur), a = r.cur.amount;
        return `<tr${r.going ? ' class="cur-row"' : ""}><td class="date">${K.periodCell(r)}</td>` +
          `<td class="num strong">${fmtWon(a)}</td><td class="num opt">${fmt(r.cur.cnt)}</td>` +
          `<td class="num opt">${s ? K.fmtPct(a / s * 100) : K.dash}</td>` +
          `<td class="num${pOpt}">${chg(a, amt(r.prev))}</td><td class="num${lOpt}">${chg(a, amt(r.ly))}</td></tr>`;
      }).join("");
      const T = D.tot;
      $("coPeriodTable").innerHTML = `<table class="data compact period-table"><thead><tr><th>기간</th><th class="num">지출</th>` +
        `<th class="num opt">건수</th><th class="num opt">실매출 대비</th><th class="num${pOpt}">전기 대비</th><th class="num${lOpt}">전년 동기 대비</th></tr></thead>` +
        `<tbody>${body}<tr class="total-row"><td>합계</td><td class="num">${fmtWon(T.cur.amount)}</td><td class="num opt">${fmt(T.cur.cnt)}</td>` +
        `<td class="num opt">${T.sales.cur ? K.fmtPct(T.cur.amount / T.sales.cur * 100) : K.dash}</td>` +
        `<td class="num${pOpt}">${chg(T.cur.amount, T.prev.amount)}</td><td class="num${lOpt}">${chg(T.cur.amount, T.ly.amount)}</td></tr></tbody></table>`;

      // 나눠 본 추세: 조건이 걸리지 않은 첫 분류(지출유형 → 품목 → 거래처)
      const splitId = FILTER_DIMS.find(id => ST.f[id] === undefined) || "client", L = DIMS[splitId];
      const at = new Map(rows.map((r, i) => [r.b.key, i]));
      const from = rows.length ? rows[0].b.from : R.cur.from;
      const cur = K.groupRows(slice(R.cur), L.key, amountOf), cmp = K.groupRows(slice(R.cmp), L.key, amountOf);
      const top = [...cur.values()].filter(g => g.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
      const series = new Map(top.map(g => [g.key, rows.map(() => 0)]));
      for (const r of slice({ from, to: R.cur.to })) {
        const arr = series.get(L.key(r)), i = at.get(M.colKey(unit, r.date));
        if (arr && i !== undefined) arr[i] += amountOf(r);
      }
      $("coSplitTitle").textContent = `${L.label}별 추세 (${U.label})`;
      $("coSplitMeta").textContent = `금액 큰 순 ${top.length}개 · 칸마다 눈금이 다릅니다(모양을 견주는 용도)`;
      if (!top.length) { $("coSplit").innerHTML = '<p class="empty-msg">이 기간·조건의 지출이 없습니다.</p>'; return; }
      $("coSplit").innerHTML = top.map((g, i) => {
        const c = cmp.get(g.key);
        return `<div class="mini-card"><div class="mc-head"><b class="mc-name" title="${esc(L.name(g.key))}">${esc(L.name(g.key))}</b>` +
          `<span class="mc-chg">${c ? K.changeChip(M.pctChange(g.v, c.v), false) : '<span class="muted">신규</span>'}</span></div>` +
          `<div class="mc-value">${fmtWon(g.v)}<small>${K.fmtPct(ratio(g.v, D.tot.cur.amount))} · ${fmt(g.cnt)}건</small></div>` +
          `<div class="mc-chart" data-i="${i}"></div>` +
          `<div class="mc-foot">건당 ${fmtWon(g.cnt ? g.v / g.cnt : 0)}${c ? ` · ${esc(R.cmpName)} ${fmtWon(c.v)}` : ""}</div></div>`;
      }).join("");
      const labels = rows.map(r => K.periodTitle(r));
      $("coSplit").querySelectorAll(".mc-chart").forEach(box => {
        const g = top[+box.dataset.i];
        WCharts.mini(box, labels, series.get(g.key), color, { zero: true, name: "지출", valueFmt: fmtWon, ariaLabel: `${L.name(g.key)} 지출 추세` });
      });
    };

    // ================================================================ 유형별
    function calcList(id) {
      const R = ST.data.R, L = DIMS[id];
      const endKey = R.cur.to.slice(0, 7), months = M.monthKeys(M.addMonthKey(endKey, -11), endKey);
      const trendRange = { from: `${months[0]}-01`, to: R.cur.to };
      return K.rankData(slice(R.cur, L.skip), slice(R.cmp, L.skip), L.key, amountOf, "sales", { rows: slice(trendRange, L.skip), months });
    }
    /** 지출유형(고른 유형이 있으면 그 안의 품목) × 최근 12개월 */
    function calcMonthly() {
      const R = ST.data.R;
      const id = ST.f.expense_type === undefined ? "expense_type" : "item", L = DIMS[id];
      const endKey = R.cur.to.slice(0, 7), months = M.monthKeys(M.addMonthKey(endKey, -11), endKey);
      const rows = slice({ from: `${months[0]}-01`, to: R.cur.to }, L.skip);
      const cell = K.groupRows(rows, r => L.key(r) + SEP2 + r.date.slice(0, 7), amountOf);
      const byRow = K.groupRows(rows, L.key, amountOf);
      const keys = [...byRow.values()].filter(g => g.v > 0).sort((a, b) => b.v - a.v).map(g => g.key);
      return { id, L, months, cell, byRow, keys };
    }

    RENDER.type = function () {
      const color = getCss("--series-expense");
      for (const id of FILTER_DIMS) {
        const L = DIMS[id], data = calcList(id);
        $(LIST_EL[id]).innerHTML = K.rankHtml(data, { list: id, nameOf: L.name, measure: "sales", color, selected: selectedKey(id), upGood: false, valueName: "지출" });
        $(LIST_EL[id] + "Meta").textContent = `${fmt(data.items.length)}개 · 금액 순`;
      }
      const X = calcMonthly(), keys = X.keys.slice(0, 12);
      $("coMonthlyTitle").textContent = `${X.L.label} × 월`;
      $("coMonthly").innerHTML = K.matrixHtml({
        rows: keys, cols: X.months, corner: `${X.L.label} \\ 월`, rowName: X.L.name, colName: k => `${k.slice(2, 4)}.${k.slice(5)}`,
        cell: (k, m) => {
          const g = X.cell.get(k + SEP2 + m);
          return g && g.v ? { v: g.v, title: `${X.L.name(k)} · ${m}: ${fmtWon(g.v)} (${fmt(g.cnt)}건)` } : null;
        },
        rowTotal: k => X.byRow.get(k).v, fmtCell: K.fmtShort, tone: "expense", selRow: selectedKey(X.id),
      });
      $("coMonthlyMeta").textContent = `지출금액(만 원) · 최근 12개월 · 칸이 진할수록 많음${X.keys.length > keys.length ? ` · 상위 ${keys.length}개` : ""}`;
    };

    // ================================================================ 원가 분석 (조건과 상관없이 전체 지출 기준)
    const pnl = (sales, e) => ({
      sales, expense: e.amount, cost: e.cost, gross: sales - e.cost, other: e.amount - e.cost, profit: sales - e.amount,
      costRatio: ratio(e.cost, sales), grossMargin: ratio(sales - e.cost, sales), otherRatio: ratio(e.amount - e.cost, sales),
      margin: ratio(sales - e.amount, sales),
    });
    function calcCogs() {
      const D = ST.data, R = D.R;
      const at = range => pnl(salesIn(range), M.sumRange(D.rows, range, EXP));
      const inR = range => D.rows.filter(r => K.inRange(r, range));
      const cur = inR(R.cur), cmp = inR(R.cmp);
      const notCost = r => norm(r.expense_type) !== COST_TYPE, isCost = r => norm(r.expense_type) === COST_TYPE;
      const endKey = R.cur.to.slice(0, 7), months = M.monthKeys(M.addMonthKey(endKey, -11), endKey);
      const trend = { rows: D.rows.filter(r => isCost(r) && r.date >= `${months[0]}-01` && r.date <= R.cur.to), months };
      return {
        cur: at(R.cur), cmp: at(R.cmp),
        other: K.rankData(cur.filter(notCost), cmp.filter(notCost), DIMS.expense_type.key, amountOf, "sales"),
        items: K.rankData(cur.filter(isCost), cmp.filter(isCost), r => norm(r.item), amountOf, "sales", trend),
        vendors: K.rankData(cur.filter(isCost), cmp.filter(isCost), DIMS.client.key, amountOf, "sales", trend),
      };
    }

    RENDER.cogs = function () {
      const D = ST.data, R = D.R, C = calcCogs(), a = C.cur, b = C.cmp;
      D.cogs = C;
      const P = calcPeriod(true), { unit, U, rows } = P;
      K.setSeg("coUnit", "unit", unit);
      const pct = v => (v === null ? "–" : K.fmtPct(v));
      const pp = (x, y, upGood) => K.changeChip(diff(x, y), upGood, true);
      const ch = (x, y, upGood) => K.changeChip(M.pctChange(x, y), upGood);
      $("coCogsHint").hidden = !hasFilter();
      $("coCogsKpi").innerHTML = metricStrip(
        metric("실매출", fmtWon(a.sales), `${R.cmpName} ${ch(a.sales, b.sales, true)}`) +
        metric("원가 (제품원가)", fmtWon(a.cost), `원가율 ${pct(a.costRatio)} · ${R.cmpName} ${pp(a.costRatio, b.costRatio, false)}`) +
        metric("매출총이익", fmtWon(a.gross), `총이익률 ${pct(a.grossMargin)} · ${R.cmpName} ${pp(a.grossMargin, b.grossMargin, true)}`) +
        metric("그 밖의 지출", fmtWon(a.other), `실매출 대비 ${pct(a.otherRatio)} · ${R.cmpName} ${pp(a.otherRatio, b.otherRatio, false)}`) +
        metric("영업이익", fmtWon(a.profit), `이익률 ${pct(a.margin)} · ${R.cmpName} ${pp(a.margin, b.margin, true)}`));

      // 손익 구조 표
      const line = (name, x, y, rx, ry, upGood, cls) =>
        `<tr${cls ? ` class="${cls}"` : ""}><td class="metric-name">${name}</td><td class="num strong">${fmtWon(x)}</td><td class="num">${pct(rx)}</td>` +
        `<td class="num abs">${y === null ? K.dash : fmtWon(y)}</td><td class="num abs">${ry === null ? K.dash : pct(ry)}</td>` +
        `<td class="num">${y === null ? K.dash : ch(x, y, upGood)}</td>` +
        `<td class="num">${ry === null || cls === "base-row" ? K.dash : pp(rx, ry, upGood)}</td></tr>`;
      const others = C.other.items.slice(0, 8).map(it => line(esc(K.unset(it.key)), it.g.v, it.cg ? it.cg.v : null,
        ratio(it.g.v, a.sales), it.cg ? ratio(it.cg.v, b.sales) : null, false, "sub-row")).join("");
      $("coPnl").innerHTML = `<table class="data compact metrics-table"><thead><tr><th>항목</th><th class="num">이번 기간</th><th class="num">실매출 대비</th>` +
        `<th class="num abs">${esc(R.cmpName)}</th><th class="num abs">실매출 대비</th><th class="num">증감</th><th class="num">비중 증감</th></tr></thead><tbody>` +
        line("실매출", a.sales, b.sales, a.sales ? 100 : null, b.sales ? 100 : null, true, "base-row") +
        line("(−) 원가 <span class=\"hint muted\">제품원가</span>", a.cost, b.cost, a.costRatio, b.costRatio, false) +
        line("= 매출총이익", a.gross, b.gross, a.grossMargin, b.grossMargin, true, "strong-row") +
        line("(−) 그 밖의 지출", a.other, b.other, a.otherRatio, b.otherRatio, false) + others +
        line("= 영업이익", a.profit, b.profit, a.margin, b.margin, true, "strong-row") + "</tbody></table>";

      // 차트: 실매출·원가 막대 + 매출총이익 선, 원가율 선
      const sales = P.sales.map(r => sal(r.cur)), cost = rows.map(r => r.cur.cost);
      const cmpOf = r => (ST.compare === "prev" ? r.prev : r.ly);
      const rate = (c, s) => (s ? c / s * 100 : null);
      const rateCur = rows.map((r, i) => rate(r.cur.cost, sales[i]));
      const rateCmp = rows.map((r, i) => { const e = cmpOf(r), s = sal(cmpOf(P.sales[i])); return e && s ? rate(e.cost, s) : null; });
      const expense = getCss("--series-expense");
      $("coCogsChartTitle").textContent = `${U.label} 실매출·원가·매출총이익`;
      $("coRateTitle").textContent = `${U.label} 원가율`;
      if (!rows.some((r, i) => r.cur.cost || sales[i])) {
        $("coCogsChart").innerHTML = $("coRateChart").innerHTML = '<p class="empty-msg">이 기간의 매출·원가가 없습니다.</p>';
      } else {
        const labels = rows.map(r => r.b.tick), titleFn = (_l, i) => K.periodTitle(rows[i]);
        WCharts.groupedBars($("coCogsChart"), labels, [
          { name: "실매출", color: getCss("--series-income"), values: sales },
          { name: "원가", color: expense, values: cost },
        ], { lines: [{ name: "매출총이익", color: getCss("--series-profit"), values: sales.map((s, i) => s - cost[i]) }],
          valueFmt: fmtWon, titleFn, ariaLabel: `${U.label} 실매출과 원가, 매출총이익` });
        const pf = v => `${Math.round(v * 10) / 10}%`;
        WCharts.lines($("coRateChart"), labels, [
          { name: "원가율", color: expense, values: rateCur },
          { name: `${R.cmpName} 원가율`, color: getCss("--series-expense-ly"), values: rateCmp, dashed: true },
        ], { valueFmt: pf, tickFmt: v => `${v}%`, titleFn, ariaLabel: `${U.label} 원가율: 이번 기간과 ${R.cmpName}` });
      }

      const mk = (el, data, nameOf, list) => {
        $(el).innerHTML = K.rankHtml(data, { list, nameOf, measure: "sales", color: expense, upGood: false, valueName: "원가" });
      };
      mk("coCostItems", C.items, K.unset, "cost-item");
      mk("coCostVendors", C.vendors, K.unset, "cost-vendor");
    };

    // ---------------------------------------------------------------- 이벤트
    K.bindPeriod({ period: "coPeriod", from: "coFrom", to: "coTo", compare: "coCompare" }, ST, (() => {
      let last = "";
      return () => {
        const now = [ST.period, ST.from, ST.to].join("|");
        if (now !== last) { ST.unit = null; last = now; }
        load(false);
      };
    })());
    const showTab = K.bindTabs("coTabs", "coTab", TABS, ST, render);
    K.bindSeg("coUnit", "unit", v => { ST.unit = v; render(); });
    for (const id of FILTER_DIMS) {
      $(FILTER_EL[id]).addEventListener("change", () => {
        const v = $(FILTER_EL[id]).value;
        setFilter(id, v === "" ? undefined : FOPT[id][+v]);
        render();
      });
    }
    $("coClear").addEventListener("click", () => { ST.f = {}; render(); });
    $("coTypeLists").addEventListener("click", e => {
      const b = e.target.closest(".rank-row");
      if (!b) return;
      const id = b.dataset.list, key = b.dataset.key;
      setFilter(id, selectedKey(id) === key ? undefined : key);
      render();
    });
    // 원가 품목·매입처를 누르면 그 내역을 연다
    $("coCostLists").addEventListener("click", e => {
      const b = e.target.closest(".rank-row");
      if (!b || !ST.data) return;
      const R = ST.data.R;
      openEntries("expense", { from: R.cur.from, to: R.cur.to,
        f: Object.assign({ expense_type: COST_TYPE }, b.dataset.list === "cost-item" ? { item: b.dataset.key } : { client: b.dataset.key }) });
    });
    $("coOpenList").addEventListener("click", () => {
      if (ST.data) openEntries("expense", { from: ST.data.R.cur.from, to: ST.data.R.cur.to, f: Object.assign({}, ST.f) });
    });
    $("coOpenForecast").addEventListener("click", () => openForecast("expenses", Object.assign({}, ST.f), condText()));

    // ---------------------------------------------------------------- 엑셀로 받기
    $("coExport").addEventListener("click", async () => {
      const D = ST.data;
      if (!D) { toast("먼저 집계 결과가 있어야 합니다.", true); return; }
      const W = window.WellcarXlsxWriter, S = W.S, X = K.xl, R = D.R, T = D.tot;
      const sub = `${R.cur.from} ~ ${R.cur.to} · ${condText()} · 비교 ${R.cmpName} ${R.cmp.from} ~ ${R.cmp.to}`;
      const ch = (a, b) => X.pct(M.pctChange(a, b));
      const sheets = [];

      const C = calcCogs(), a = C.cur, b = C.cmp;
      const pl = (name, x, y, rx, ry) => [name, X.won(x), X.pct(rx), X.won(y), X.pct(ry), ch(x, y),
        diff(rx, ry) === null || name === "실매출" ? null : { v: Math.round(diff(rx, ry) * 100) / 100, s: S.dec }];
      sheets.push(X.sheet("손익 구조", `웰카오디오 손익 구조 — ${R.label}`,
        `${R.cur.from} ~ ${R.cur.to} · 전체 지출 기준 · 원가 = 지출유형 '${COST_TYPE}' · 비교 ${R.cmpName} ${R.cmp.from} ~ ${R.cmp.to}`,
        ["항목", "이번 기간", "실매출 대비", R.cmpName, "실매출 대비", "증감률", "비중 증감(%p)"], [
          pl("실매출", a.sales, b.sales, a.sales ? 100 : null, b.sales ? 100 : null),
          pl("(−) 원가", a.cost, b.cost, a.costRatio, b.costRatio),
          pl("= 매출총이익", a.gross, b.gross, a.grossMargin, b.grossMargin),
          pl("(−) 그 밖의 지출", a.other, b.other, a.otherRatio, b.otherRatio),
          ...C.other.items.map(it => pl(`   ${K.unset(it.key)}`, it.g.v, it.cg ? it.cg.v : null, ratio(it.g.v, a.sales), it.cg ? ratio(it.cg.v, b.sales) : null)),
          pl("= 영업이익", a.profit, b.profit, a.margin, b.margin),
        ], [26, 16, 12, 16, 12, 11, 14]));

      const P = calcPeriod(false), PA = calcPeriod(true);
      sheets.push(X.sheet(P.U.label, `${P.U.label} 지출`, sub,
        ["기간", "시작일", "종료일", "지출", "건수", "실매출", "실매출 대비", "전기 지출", "전기 대비", "전년 동기 지출", "전년 동기 대비", "비고"],
        P.rows.map((r, i) => {
          const s = sal(P.sales[i].cur), x = r.cur.amount;
          return [r.b.name, r.b.from, r.b.to, X.won(x), r.cur.cnt, X.won(s), X.pct(ratio(x, s)), X.won(amt(r.prev)), ch(x, amt(r.prev)),
            X.won(amt(r.ly)), ch(x, amt(r.ly)), r.going ? "진행 중" : r.partial ? "일부" : ""];
        }), [20, 12, 12, 15, 8, 15, 11, 15, 11, 15, 11, 9],
        ["합계", "", "", X.won(T.cur.amount), T.cur.cnt, X.won(T.sales.cur), X.pct(ratio(T.cur.amount, T.sales.cur)),
          X.won(T.prev.amount), ch(T.cur.amount, T.prev.amount), X.won(T.ly.amount), ch(T.cur.amount, T.ly.amount)]));
      sheets.push(X.sheet(`${PA.U.label} 원가`, `${PA.U.label} 원가·매출총이익`, `${R.cur.from} ~ ${R.cur.to} · 전체 지출 기준 · 원가 = 지출유형 '${COST_TYPE}'`,
        ["기간", "실매출", "원가", "원가율", "매출총이익", "총이익률", "지출 합계", "영업이익", "영업이익률"],
        PA.rows.map((r, i) => {
          const s = sal(PA.sales[i].cur), c = r.cur.cost, e = r.cur.amount;
          return [r.b.name, X.won(s), X.won(c), X.pct(ratio(c, s)), X.won(s - c), X.pct(ratio(s - c, s)), X.won(e), X.won(s - e), X.pct(ratio(s - e, s))];
        }), [20, 15, 15, 10, 15, 10, 15, 15, 11],
        ["합계", X.won(a.sales), X.won(a.cost), X.pct(a.costRatio), X.won(a.gross), X.pct(a.grossMargin), X.won(a.expense), X.won(a.profit), X.pct(a.margin)]));

      for (const [id, title] of [["expense_type", "지출유형별"], ["item", "품목별"], ["client", "거래처별"]]) {
        const L = DIMS[id], data = calcList(id);
        sheets.push(X.sheet(title, `${title} 지출`, sub, ["항목", "지출", "건수", "건당 평균", "비중", `${R.cmpName} 지출`, `${R.cmpName} 건수`, "증감률"],
          data.items.map(it => [L.name(it.key), X.won(it.g.v), it.g.cnt, X.won(it.g.cnt ? it.g.v / it.g.cnt : null),
            data.totalV ? X.pct(it.g.v / data.totalV * 100) : null, it.cg ? X.won(it.cg.v) : null, it.cg ? it.cg.cnt : null, it.cg ? ch(it.g.v, it.cg.v) : null]),
          [30, 15, 8, 14, 10, 15, 10, 11],
          ["합계", X.won(data.totalV), data.totalCnt, X.won(data.totalCnt ? data.totalV / data.totalCnt : null), X.pct(data.totalV ? 100 : 0)]));
      }

      const Mo = calcMonthly();
      sheets.push({ name: `${Mo.L.label}×월`, widths: [26, ...Mo.months.map(() => 13), 15], freeze: "B5", rows: [
        [{ v: `${Mo.L.label} × 월 지출 — 최근 12개월`, s: S.title }], [{ v: `단위: 원 · ${condText()}`, s: S.muted }], [],
        [X.head(`${Mo.L.label} \\ 월`), ...Mo.months.map(m => X.head(m)), X.head("합계")],
        ...Mo.keys.map(k => [Mo.L.name(k), ...Mo.months.map(m => { const g = Mo.cell.get(k + SEP2 + m); return g ? X.won(g.v) : null; }),
          { v: Math.round(Mo.byRow.get(k).v), s: S.totalNum }]),
      ] });

      for (const [data, title, head] of [[C.items, "원가 품목별", "품목"], [C.vendors, "원가 매입처별", "매입처"]]) {
        sheets.push(X.sheet(title, `${title} (지출유형 '${COST_TYPE}')`, `${R.cur.from} ~ ${R.cur.to} · 비교 ${R.cmpName} ${R.cmp.from} ~ ${R.cmp.to}`,
          [head, "원가", "건수", "비중", `${R.cmpName} 원가`, "증감률"],
          data.items.map(it => [K.unset(it.key), X.won(it.g.v), it.g.cnt, data.totalV ? X.pct(it.g.v / data.totalV * 100) : null,
            it.cg ? X.won(it.cg.v) : null, it.cg ? ch(it.g.v, it.cg.v) : null]), [28, 15, 8, 10, 15, 11],
          ["합계", X.won(data.totalV), data.totalCnt, X.pct(data.totalV ? 100 : 0)]));
      }
      try { toast(`${await saveBlob(`웰카오디오_지출분석_${R.cur.from}_${R.cur.to}.xlsx`, W.build(sheets))} 파일을 받았습니다.`); }
      catch (err) { toast(err.message, true); }
    });

    return {
      open(opts) {
        opts = opts || {};
        if (opts.tab && TABS.includes(opts.tab)) { ST.tab = opts.tab; showTab(); }
      },
    };
  };
})();
