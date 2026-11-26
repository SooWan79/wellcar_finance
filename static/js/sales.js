/* 매출 분석 화면: 기간별 · 요일별 · 브랜드·차종·수리 유형 · 서비스 가격 · 마케팅 추천.
   app.js가 WellcarSales(ctx)로 연결한다. 자료는 /api/agg를 날짜×브랜드×차종×수리 유형×거래처로 한 번 받아 화면에서 나눈다.
   계산은 metrics.js, 함께 쓰는 도우미는 hubkit.js. */
(function () {
  "use strict";

  window.WellcarSales = function install(ctx) {
    const { $, esc, fmt, fmtWon, toast, getCss, refreshers, nextReq, isStale, metric, metricStrip, saveBlob, todayStr,
      kit: K, openEntries, openForecast } = ctx;
    const M = K.M;

    const TABS = ["period", "weekday", "mix", "price", "marketing"];
    const MEASURE = { sales: "실매출", cnt: "건수", avg: "객단가" };
    const KEYS = ["cnt", "amount", "payout"];
    const SEP = "\u001f";
    // 누구인지 특정할 수 없는 거래처 이름: 거래처 추천·휴면 목록에서 뺀다
    const GENERIC_CLIENTS = new Set(["", "개인", "방문", "개인고객", "방문고객", "일반", "일반고객", "현금", "N/A"]);
    const norm = v => (v === null || v === undefined ? "" : String(v));
    const salesOf = r => (Number(r.amount) || 0) - (Number(r.payout) || 0);
    const grossOf = r => Number(r.amount) || 0;
    const modelName = k => {
      const [b, c] = k.split(SEP);
      return c ? `${b && b !== "N/A" ? b + " " : ""}${c}` : `${K.unset(b)} · 차종 미지정`;
    };
    // skip: 그 목록을 그릴 때 보지 않는 조건(자기 목록은 자기 조건으로 좁히지 않는다)
    const DIMS = {
      manufacturer: { label: "브랜드", key: r => norm(r.manufacturer), name: K.unset, skip: ["manufacturer", "car_model"] },
      car_model: { label: "차종", key: r => norm(r.manufacturer) + SEP + norm(r.car_model), name: modelName, skip: ["car_model"] },
      category: { label: "수리 유형", key: r => norm(r.category), name: K.unset, skip: ["category"] },
      client: { label: "거래처", key: r => norm(r.client), name: K.unset, skip: [] },
    };
    const FILTER_DIMS = ["manufacturer", "car_model", "category"];
    const LIST_EL = { manufacturer: "saListBrand", car_model: "saListModel", category: "saListCategory" };
    const FILTER_EL = { manufacturer: "saFBrand", car_model: "saFModel", category: "saFCategory" };
    const SCOPE_NAME = { "": "전체 매출", "서비스제공": "수리·서비스", "상품판매": "상품판매" };

    const ST = {
      // 연초에는 '올해'가 너무 짧아 최근 12개월로 시작한다
      period: +todayStr().slice(5, 7) <= 3 ? "last-12m" : "this-year", from: "", to: "", compare: "ly",
      scope: "", f: {}, measure: "sales", tab: "period",
      unit: null, priceUnit: null, priceDim: "category", mapDim: "manufacturer",
      data: null,
    };
    const FOPT = {};                    // 조건 선택 상자의 값 목록(선택 상자에는 순번만 넣는다)
    const MK = { key: null, p: null };  // 마케팅 탭이 따로 받는 자료(거래처 2년 실적·36개월 월별)

    // ---------------------------------------------------------------- 조건
    const selectedKey = id => (id === "manufacturer" ? ST.f.manufacturer : id === "category" ? ST.f.category
      : ST.f.car_model !== undefined ? norm(ST.f.manufacturer) + SEP + ST.f.car_model : undefined);
    /** 조건 하나를 정한다. key가 undefined면 지운다. 차종은 브랜드와 함께 정해진다 */
    function setFilter(id, key) {
      if (id === "manufacturer") {
        delete ST.f.car_model;
        if (key === undefined) delete ST.f.manufacturer; else ST.f.manufacturer = key;
      } else if (id === "category") {
        if (key === undefined) delete ST.f.category; else ST.f.category = key;
      } else if (key === undefined) {
        delete ST.f.car_model;
      } else {
        const [b, c] = key.split(SEP);
        ST.f.manufacturer = b;
        ST.f.car_model = c;
      }
    }
    function match(r, skip) {
      for (const k of FILTER_DIMS) {
        if (ST.f[k] === undefined || (skip && skip.includes(k))) continue;
        if (norm(r[k]) !== ST.f[k]) return false;
      }
      return true;
    }
    /** 범위·조건에 맞는 행 */
    function slice(range, skip) {
      const out = [];
      if (!range || !ST.data) return out;
      for (const r of ST.data.rows) if (r.date >= range.from && r.date <= range.to && match(r, skip)) out.push(r);
      return out;
    }
    function totals(rows) {
      let sales = 0, cnt = 0, gross = 0;
      const days = new Set();
      for (const r of rows) {
        const c = Number(r.cnt) || 0;
        sales += salesOf(r); gross += grossOf(r); cnt += c;
        if (c > 0) days.add(r.date);
      }
      return { sales, cnt, gross, days: days.size, avg: cnt ? sales / cnt : null, daily: days.size ? sales / days.size : null };
    }
    /** 날짜 색인 합계({cnt, amount, payout})에서 고른 값 */
    const pick = (s, measure) => (!s ? null : measure === "cnt" ? s.cnt
      : measure === "avg" ? (s.cnt ? (s.amount - s.payout) / s.cnt : null) : s.amount - s.payout);
    const condParts = () => [SCOPE_NAME[ST.scope],
      ...(ST.f.manufacturer !== undefined ? [`브랜드 ${K.unset(ST.f.manufacturer)}`] : []),
      ...(ST.f.car_model !== undefined ? [`차종 ${K.unset(ST.f.car_model)}`] : []),
      ...(ST.f.category !== undefined ? [`수리 유형 ${K.unset(ST.f.category)}`] : [])];
    /** 목록·예측 화면으로 넘길 조건 */
    const listFilters = extra => Object.assign({}, ST.scope ? { income_type: ST.scope } : {}, ST.f, extra || {});
    const dimFilters = (id, key) => {
      if (id === "car_model") { const [b, c] = key.split(SEP); return { manufacturer: b, car_model: c }; }
      return { [id]: key };
    };

    // ---------------------------------------------------------------- 자료 받기
    async function load(force) {
      const R = K.resolveRange(ST);
      if (!R) { toast("기간을 확인하세요. 시작일이 종료일보다 늦거나 오늘 뒤입니다.", true); return; }
      const key = [R.win.from, R.win.to, ST.scope].join("|");
      if (!force && ST.data && ST.data.key === key) { ST.data.R = R; render(); return; }
      const req = nextReq("sales");
      try {
        const rows = await K.aggf("incomes", R.win.from, R.win.to, "date,manufacturer,car_model,category,client",
          ST.scope ? { income_type: ST.scope } : null);
        if (isStale("sales", req)) return;
        ST.data = { key, rows, cover: R.win, R };
        MK.key = null;
        render();
      } catch (err) { toast(err.message, true); }
    }
    refreshers.sales = () => load(true);

    const RENDER = {};
    function render() {
      if (!ST.data) return;
      const t = ST.tab;
      $("saMeasure").hidden = t === "price" || t === "marketing";
      $("saUnit").hidden = t !== "period";
      $("saPriceTools").hidden = t !== "price";
      $("saTools").hidden = t === "marketing";
      renderFilters();
      renderSummary();
      RENDER[t]();
    }

    // ---------------------------------------------------------------- 조건 선택 상자 · 요약
    function renderFilters() {
      const rows = ST.data.rows;
      for (const id of FILTER_DIMS) {
        const L = DIMS[id], sel = selectedKey(id);
        // 차종 목록은 고른 브랜드 안에서만
        const pool = id === "car_model" && ST.f.manufacturer !== undefined
          ? rows.filter(r => norm(r.manufacturer) === ST.f.manufacturer) : rows;
        const keys = [...K.groupRows(pool, L.key, salesOf).values()].sort((a, b) => b.v - a.v).map(g => g.key);
        if (sel !== undefined && !keys.includes(sel)) keys.unshift(sel);
        FOPT[id] = keys;
        $(FILTER_EL[id]).innerHTML = '<option value="">전체</option>' +
          keys.map((k, i) => `<option value="${i}">${esc(L.name(k))}</option>`).join("");
        $(FILTER_EL[id]).value = sel === undefined ? "" : String(keys.indexOf(sel));
      }
      $("saClear").hidden = !FILTER_DIMS.some(k => ST.f[k] !== undefined);
    }

    function renderSummary() {
      const D = ST.data, R = D.R;
      const cur = totals(slice(R.cur)), prev = totals(slice(R.prev)), ly = totals(slice(R.ly));
      const cmp = ST.compare === "prev" ? prev : ly;
      D.tot = { cur, prev, ly, cmp };
      const chip = (a, b) => `${R.cmpName} ${K.changeChip(M.pctChange(a, b), true)}`;
      $("saSummary").innerHTML = metricStrip(
        metric("기간", esc(R.label), `${R.cur.from} ~ ${R.cur.to} · 비교 ${R.cmp.from} ~ ${R.cmp.to}`) +
        metric("실매출", fmtWon(cur.sales), chip(cur.sales, cmp.sales)) +
        metric("건수", `${fmt(cur.cnt)}건`, chip(cur.cnt, cmp.cnt)) +
        metric("객단가", cur.avg === null ? "–" : fmtWon(cur.avg), chip(cur.avg, cmp.avg)) +
        metric("영업일 하루 평균", cur.daily === null ? "–" : fmtWon(cur.daily), `영업 ${fmt(cur.days)}일 · ${chip(cur.daily, cmp.daily)}`));
    }

    // ================================================================ 기간별
    function calcPeriod() {
      const D = ST.data, R = D.R;
      const unit = ST.unit || K.autoUnit(R.days);
      const idx = M.dateIndex(D.rows, KEYS, r => match(r), D.cover);
      const S = K.series(idx, unit, R.cur);
      return { unit, U: K.UNIT[unit], rows: S.rows, cut: S.cut };
    }

    RENDER.period = function () {
      const D = ST.data, R = D.R, measure = ST.measure;
      const P = calcPeriod(), { unit, U, rows } = P;
      K.setSeg("saUnit", "unit", unit);
      const cmpOf = r => (ST.compare === "prev" ? r.prev : r.ly);
      const vals = rows.map(r => pick(r.cur, measure));
      const cmpVals = rows.map(r => pick(cmpOf(r), measure));
      const fmtV = v => K.fmtMeasure(v, measure);
      const income = getCss("--series-income"), lyColor = getCss("--series-income-ly");
      $("saPeriodTitle").textContent = `${U.label} ${MEASURE[measure]}`;
      $("saPeriodMeta").textContent = `${fmt(rows.length)}개 구간` + (P.cut ? ` · 구간이 많아 최근 ${fmt(rows.length)}개만 표시` : "") +
        (measure === "cnt" ? " · 단위: 건" : " · 단위: 원");

      if (!rows.some(r => r.cur.cnt > 0)) {
        $("saPeriodChart").innerHTML = '<p class="empty-msg">이 기간·조건의 매출이 없습니다.</p>';
        $("saPeriodNote").innerHTML = "";
      } else {
        // 구간이 많으면 비교 막대는 빼고(툴팁·표에서 확인) 이번 기간만 그린다
        const showCmp = rows.length <= 45 && cmpVals.some(v => v !== null);
        const series = [{ name: MEASURE[measure], color: income, values: vals }];
        if (showCmp) series.push({ name: R.cmpName, color: lyColor, values: cmpVals });
        const lines = [];
        if (U.ma > 1 && rows.length > U.ma) {
          // 진행 중인 구간은 아직 다 차지 않았으니 이동평균에서 뺀다
          lines.push({ name: `${U.ma}${U.one} 이동평균`, color: getCss("--ink"),
            values: M.movingAvg(rows.map((r, i) => (r.going ? null : vals[i])), U.ma) });
        }
        WCharts.groupedBars($("saPeriodChart"), rows.map(r => r.b.tick), series, {
          lines, valueFmt: fmtV, tickFmt: measure === "cnt" ? (v => fmt(v)) : undefined,
          titleFn: (_l, i) => K.periodTitle(rows[i]),
          tipExtra: i => (showCmp || cmpVals[i] === null ? [] : [{ name: R.cmpName, color: lyColor, value: cmpVals[i], fmt: fmtV }]),
          ariaLabel: `${U.label} ${MEASURE[measure]}: 이번 기간과 ${R.cmpName}`,
        });
        const full = rows.filter(r => !r.partial && !r.going).map(r => pick(r.cur, measure));
        $("saPeriodNote").innerHTML = K.trendNote(unit, full, MEASURE[measure], true, fmtV);
      }

      // 표: 최근 구간이 위. 휴대폰에서는 고른 비교(전기 또는 전년 동기)만 남긴다
      const chg = (a, b) => (b === null || b === undefined ? K.dash : K.changeChip(M.pctChange(a, b), true));
      const pOpt = ST.compare === "prev" ? "" : " opt", lOpt = ST.compare === "prev" ? " opt" : "";
      const body = rows.slice().reverse().map(r => {
        const c = r.cur, s = c.amount - c.payout, v = pick(c, measure);
        return `<tr${r.going ? ' class="cur-row"' : ""}><td class="date">${K.periodCell(r)}</td>` +
          `<td class="num strong">${fmtWon(s)}</td><td class="num opt">${fmt(c.cnt)}</td>` +
          `<td class="num opt">${c.cnt ? fmtWon(s / c.cnt) : K.dash}</td>` +
          `<td class="num${pOpt}">${chg(v, pick(r.prev, measure))}</td><td class="num${lOpt}">${chg(v, pick(r.ly, measure))}</td></tr>`;
      }).join("");
      const T = D.tot, tv = t => (measure === "cnt" ? t.cnt : measure === "avg" ? t.avg : t.sales);
      $("saPeriodTableMeta").textContent = `증감은 ${MEASURE[measure]} 기준 · 진행 중인 구간은 같은 날짜 수까지 비교`;
      $("saPeriodTable").innerHTML = `<table class="data compact period-table"><thead><tr><th>기간</th><th class="num">실매출</th>` +
        `<th class="num opt">건수</th><th class="num opt">객단가</th><th class="num${pOpt}">전기 대비</th><th class="num${lOpt}">전년 동기 대비</th></tr></thead>` +
        `<tbody>${body}<tr class="total-row"><td>합계</td><td class="num">${fmtWon(T.cur.sales)}</td><td class="num opt">${fmt(T.cur.cnt)}</td>` +
        `<td class="num opt">${T.cur.avg === null ? K.dash : fmtWon(T.cur.avg)}</td>` +
        `<td class="num${pOpt}">${chg(tv(T.cur), tv(T.prev))}</td><td class="num${lOpt}">${chg(tv(T.cur), tv(T.ly))}</td></tr></tbody></table>`;
    };

    // ================================================================ 요일별
    function calcWeekday() {
      const D = ST.data, R = D.R;
      const idx = M.dateIndex(D.rows, KEYS, r => match(r), D.cover);
      const wd = M.byWeekday(idx, R.cur, KEYS), wc = M.byWeekday(idx, R.cmp, KEYS);
      return { wd, wc, lv: M.weekdayLevels(wd, w => w.amount - w.payout) };
    }
    /** 요일의 하루 평균(실매출·건수) 또는 객단가 */
    const perDay = (w, measure) => (!w ? null : measure === "avg" ? (w.cnt ? (w.amount - w.payout) / w.cnt : null)
      : !w.dates ? null : (measure === "cnt" ? w.cnt : w.amount - w.payout) / w.dates);
    const fmtPerDay = (v, measure) => (v === null || v === undefined ? "–"
      : measure === "cnt" ? `${(Math.round(v * 10) / 10).toLocaleString("ko-KR")}건` : fmtWon(v));
    const signPct = ratio => `${ratio >= 1 ? "+" : "−"}${K.fmtPct(Math.abs(ratio - 1) * 100, 0)}`;

    RENDER.weekday = function () {
      const D = ST.data, R = D.R, measure = ST.measure;
      const { wd, wc, lv } = calcWeekday();
      const name = measure === "avg" ? "객단가" : `하루 평균 ${MEASURE[measure]}`;
      const vals = wd.map(w => perDay(w, measure)), cmpVals = wc ? wc.map(w => perDay(w, measure)) : wd.map(() => null);
      const fmtV = v => fmtPerDay(v, measure);
      $("saWdTitle").textContent = `요일별 ${name}`;
      if (!wd.some(w => w.cnt > 0)) {
        $("saWdChart").innerHTML = '<p class="empty-msg">이 기간·조건의 매출이 없습니다.</p>';
        $("saWdNote").textContent = "";
      } else {
        const series = [{ name, color: getCss("--series-income"), values: vals }];
        if (cmpVals.some(v => v !== null)) series.push({ name: R.cmpName, color: getCss("--series-income-ly"), values: cmpVals });
        WCharts.groupedBars($("saWdChart"), wd.map(w => w.name), series, {
          valueFmt: fmtV, tickFmt: measure === "cnt" ? (v => fmt(v)) : undefined,
          titleFn: (_l, i) => `${wd[i].name}요일 · 영업 ${fmt(wd[i].days)}일 / ${fmt(wd[i].dates)}일`,
          ariaLabel: `요일별 ${name}: 이번 기간과 ${R.cmpName}`,
        });
        const open = lv.filter(l => l.level !== "closed" && l.ratio !== null);
        const best = open.slice().sort((a, b) => b.ratio - a.ratio)[0], worst = open.slice().sort((a, b) => a.ratio - b.ratio)[0];
        const closed = lv.filter(l => l.level === "closed").map(l => l.name + "요일");
        $("saWdNote").textContent = (best && worst && best.i !== worst.i
          ? `실매출 기준 가장 바쁜 요일은 ${best.name}요일(하루 평균 ${fmtWon(best.perDate)}, 영업 요일 평균보다 ${signPct(best.ratio)}), ` +
            `가장 한가한 요일은 ${worst.name}요일(${fmtWon(worst.perDate)}, ${signPct(worst.ratio)})입니다.` : "") +
          (closed.length ? ` ${closed.join("·")}은 이 기간에 실적이 없어 쉬는 날로 봤습니다.` : "");
      }

      const LEVEL = { busy: '<span class="status info">바쁨</span>', slow: '<span class="status warn">한가함</span>',
        closed: '<span class="tag">쉬는 날</span>', normal: "" };
      const body = wd.map((w, i) => {
        const s = w.amount - w.payout, l = lv[i];
        return `<tr><td class="strong">${w.name}요일 ${LEVEL[l.level]}</td><td class="num opt">${fmt(w.days)} / ${fmt(w.dates)}</td>` +
          `<td class="num">${fmtWon(s)}</td><td class="num strong">${fmtPerDay(perDay(w, "sales"), "sales")}</td>` +
          `<td class="num opt">${fmtPerDay(perDay(w, "cnt"), "cnt")}</td><td class="num opt">${w.cnt ? fmtWon(s / w.cnt) : K.dash}</td>` +
          `<td class="num">${l.ratio === null || l.level === "closed" ? K.dash : K.changeChip((l.ratio - 1) * 100, true)}</td>` +
          `<td class="num">${cmpVals[i] === null ? K.dash : K.changeChip(M.pctChange(vals[i], cmpVals[i]), true)}</td></tr>`;
      }).join("");
      $("saWdTable").innerHTML = `<table class="data compact period-table"><thead><tr><th>요일</th><th class="num opt">영업일 / 날 수</th>` +
        `<th class="num">실매출 합계</th><th class="num">하루 평균 실매출</th><th class="num opt">하루 평균 건수</th><th class="num opt">객단가</th>` +
        `<th class="num">요일 평균 대비</th><th class="num">${esc(R.cmpName)} 대비</th></tr></thead><tbody>${body}</tbody></table>`;

      // 수리 유형 × 요일
      const rows = slice(R.cur, ["category"]);
      const cell = K.groupRows(rows, r => norm(r.category) + SEP + M.weekdayIdx(r.date), salesOf);
      const byCat = K.groupRows(rows, r => norm(r.category), salesOf);
      const cats = [...byCat.values()].filter(g => g.cnt > 0)
        .sort((a, b) => (K.measureOf(b, measure) ?? 0) - (K.measureOf(a, measure) ?? 0)).map(g => g.key).slice(0, 10);
      const fmtCell = v => (measure === "cnt" ? fmt(v) : K.fmtShort(v));
      $("saWdMatrix").innerHTML = K.matrixHtml({
        rows: cats, cols: [0, 1, 2, 3, 4, 5, 6], corner: "수리 유형 \\ 요일", rowName: K.unset, colName: i => M.WEEKDAY_KO[i],
        cell: (c, i) => {
          const g = cell.get(c + SEP + i), v = K.measureOf(g, measure);
          return v ? { v, title: `${K.unset(c)} · ${M.WEEKDAY_KO[i]}요일: ${K.fmtMeasure(v, measure)} (${fmt(g.cnt)}건)` } : null;
        },
        rowTotal: c => K.measureOf(byCat.get(c), measure), fmtCell, tone: "income", selRow: ST.f.category,
      });
      $("saWdMatrixMeta").textContent = `${MEASURE[measure]}${measure === "cnt" ? "(건)" : "(만 원)"} · 기간 합계 · 칸이 진할수록 많음`;
    };

    // ================================================================ 브랜드·차종·수리 유형
    function calcList(id, measure) {
      const R = ST.data.R, L = DIMS[id];
      const endKey = R.cur.to.slice(0, 7), months = M.monthKeys(M.addMonthKey(endKey, -11), endKey);
      const trendRange = { from: `${months[0]}-01`, to: R.cur.to };
      return K.rankData(slice(R.cur, L.skip), slice(R.cmp, L.skip), L.key, salesOf, measure, { rows: slice(trendRange, L.skip), months });
    }
    function calcMatrix(measure) {
      const rows = slice(ST.data.R.cur, ["manufacturer", "car_model", "category"]);
      const cell = K.groupRows(rows, r => norm(r.manufacturer) + SEP + norm(r.category), salesOf);
      const byB = K.groupRows(rows, r => norm(r.manufacturer), salesOf), byC = K.groupRows(rows, r => norm(r.category), salesOf);
      const order = m => [...m.values()].filter(g => g.cnt > 0)
        .sort((a, b) => (K.measureOf(b, measure) ?? 0) - (K.measureOf(a, measure) ?? 0)).map(g => g.key);
      return { cell, byB, byC, brands: order(byB), cats: order(byC) };
    }

    RENDER.mix = function () {
      const measure = ST.measure, color = getCss("--series-income");
      for (const id of FILTER_DIMS) {
        const L = DIMS[id], data = calcList(id, measure);
        $(LIST_EL[id]).innerHTML = K.rankHtml(data, { list: id, nameOf: L.name, measure, color, selected: selectedKey(id), upGood: true, valueName: "실매출" });
        $(LIST_EL[id] + "Meta").textContent = `${fmt(data.items.length)}개 · ${MEASURE[measure]} 순`;
      }
      const X = calcMatrix(measure), brands = X.brands.slice(0, 10), cats = X.cats.slice(0, 10);
      const fmtCell = v => (measure === "cnt" ? fmt(v) : K.fmtShort(v));
      $("saMatrix").innerHTML = K.matrixHtml({
        rows: brands, cols: cats, corner: "브랜드 \\ 수리 유형", rowName: K.unset, colName: K.unset,
        cell: (b, c) => {
          const g = X.cell.get(b + SEP + c), v = K.measureOf(g, measure);
          return v ? { v, title: `${K.unset(b)} · ${K.unset(c)}: ${K.fmtMeasure(v, measure)} (${fmt(g.cnt)}건)` } : null;
        },
        rowTotal: b => K.measureOf(X.byB.get(b), measure), fmtCell, tone: "income", selRow: ST.f.manufacturer, selCol: ST.f.category,
      });
      $("saMatrixMeta").textContent = `${MEASURE[measure]}${measure === "cnt" ? "(건)" : "(만 원)"} · 칸이 진할수록 많음 · 상위 ${brands.length}×${cats.length}`;
    };

    // ================================================================ 서비스 가격 (건당 매출액)
    // sq: 건별 금액의 제곱합(행은 거의 건별이라 행 단위로 어림) — 평균의 차이가 우연인지 가리는 데 쓴다
    const newStat = () => ({ cnt: 0, gross: 0, sq: 0, min: null, max: null });
    function addStat(s, r) {
      const c = Number(r.cnt) || 0, g = grossOf(r);
      s.cnt += c;
      s.gross += g;
      if (c > 0) s.sq += g * g / c;
      if (K.has(r.amount_min)) s.min = s.min === null ? r.amount_min : Math.min(s.min, r.amount_min);
      if (K.has(r.amount_max)) s.max = s.max === null ? r.amount_max : Math.max(s.max, r.amount_max);
    }
    const priceOf = s => (s && s.cnt ? s.gross / s.cnt : null);
    /** 두 기간 평균의 차이 ÷ 그 차이의 표준오차. 기준(M.REC.z) 이상이어야 우연이 아닌 변화로 본다. 건수가 모자라면 null */
    function priceZ(a, b) {
      if (a.cnt < 3 || b.cnt < 3) return null;
      const pa = a.gross / a.cnt, pb = b.gross / b.cnt;
      const se = Math.sqrt(Math.max(0, a.sq / a.cnt - pa * pa) / a.cnt + Math.max(0, b.sq / b.cnt - pb * pb) / b.cnt);
      return se > 0 ? (pa - pb) / se : null;
    }
    /**
     * 구성을 맞춘 증감: 두 기간 모두 2건 이상 있는 칸(예: 브랜드)만 골라, 이번 기간의 건수 구성 그대로 값만 견준다.
     * 비싼 차·싼 차의 비중이 달라져 평균이 움직인 몫을 뺀 값이다. 견줄 칸이 이번 기간 건수의 60%에 못 미치면 null
     */
    function likeForLike(g) {
      let now = 0, then = 0, n = 0;
      for (const c of g.ctl.values()) {
        if (c.cur.cnt < 2 || c.cmp.cnt < 2) continue;
        now += c.cur.gross;
        then += c.cur.cnt * (c.cmp.gross / c.cmp.cnt);
        n += c.cur.cnt;
      }
      return then > 0 && n >= M.REC.minCnt && n >= g.cur.cnt * 0.6 ? (now / then - 1) * 100 : null;
    }
    const fmtMan1 = v => (v === null || v === undefined ? "–" : (v / 10000).toLocaleString("ko-KR", { maximumFractionDigits: 1 }));

    function calcPrice() {
      const D = ST.data, R = D.R, dimId = ST.priceDim, L = DIMS[dimId];
      // 달마다 건수가 적으면 평균이 크게 흔들리므로 기본은 분기(짧은 기간만 월)
      const unit = ST.priceUnit || (R.days <= 100 ? "month" : R.days <= 1100 ? "quarter" : "year");
      const back = M.addYears(R.cur.from, -1);
      const buckets = M.periodsIn(unit, back < D.cover.from ? D.cover.from : back, R.cur.to).slice(-36);
      const at = new Map(buckets.map((b, i) => [b.key, i]));
      const first = buckets[0].from;
      // 구성을 맞출 때 쓰는 칸: 수리 유형별로 볼 때는 브랜드, 브랜드·차종별로 볼 때는 수리 유형
      const byBrand = dimId === "category";
      const ctlKey = byBrand ? (r => norm(r.manufacturer)) : (r => norm(r.category));
      const fresh = k => ({ key: k, cur: newStat(), cmp: newStat(), b: buckets.map(newStat), ctl: new Map() });
      const all = fresh(null);
      const segs = new Map();
      const cell = (g, k) => { let c = g.ctl.get(k); if (!c) { c = { cur: newStat(), cmp: newStat() }; g.ctl.set(k, c); } return c; };
      for (const r of D.rows) {
        if (!match(r)) continue;
        const k = L.key(r);
        let g = segs.get(k);
        if (!g) { g = fresh(k); segs.set(k, g); }
        const c = cell(g, ctlKey(r)), ca = cell(all, norm(r.category) + SEP + norm(r.manufacturer));
        if (K.inRange(r, R.cur)) { addStat(g.cur, r); addStat(all.cur, r); addStat(c.cur, r); addStat(ca.cur, r); }
        if (K.inRange(r, R.cmp)) { addStat(g.cmp, r); addStat(all.cmp, r); addStat(c.cmp, r); addStat(ca.cmp, r); }
        if (r.date >= first && r.date <= R.cur.to) {
          const i = at.get(M.colKey(unit, r.date));
          if (i !== undefined) { addStat(g.b[i], r); addStat(all.b[i], r); }
        }
      }
      const list = [...segs.values()].filter(g => g.cur.cnt > 0).sort((a, b) => b.cur.cnt - a.cur.cnt);
      for (const g of list.concat([all])) {
        g.change = M.pctChange(priceOf(g.cur), priceOf(g.cmp));
        g.z = priceZ(g.cur, g.cmp);
        g.clear = g.z !== null && Math.abs(g.z) >= M.REC.z;   // 우연이라 보기 어려운 변화인가
        g.adj = likeForLike(g);
      }
      return { unit, U: K.UNIT[unit], dimId, L, buckets, all, list, ctlLabel: byBrand ? "브랜드" : "수리 유형" };
    }

    RENDER.price = function () {
      const R = ST.data.R, P = calcPrice(), { L, buckets, all, list } = P;
      K.setSeg("saPriceUnit", "unit", P.unit);
      $("saPriceDim").value = P.dimId;
      const color = getCss("--series-income");
      // 증감 칩: 우연과 구분되지 않는 변화는 회색으로
      const chip = g => {
        if (!g.cmp.cnt) return '<span class="muted">신규</span>';
        if (g.change === null) return K.dash;
        if (g.clear) return K.changeChip(g.change, true);
        const r = Math.round(g.change * 10) / 10;
        return `<span class="delta flat" title="건수가 적거나 금액이 들쭉날쭉해 우연과 구분되지 않는 변화입니다">` +
          `${r > 0 ? "▲" : r < 0 ? "▼" : "―"} ${Math.abs(r).toLocaleString("ko-KR")}%</span>`;
      };
      const signed = v => `${v >= 0 ? "+" : "−"}${K.fmtPct(Math.abs(v))}`;
      // 요약: 전체 평균과 값이 뚜렷하게 오르내린 곳
      const movers = list.filter(g => g.clear);
      const up = movers.slice().sort((a, b) => b.change - a.change)[0], down = movers.slice().sort((a, b) => a.change - b.change)[0];
      const mover = (g, want) => (g && (want > 0 ? g.change > 0 : g.change < 0)
        ? [esc(L.name(g.key)), `${fmtWon(priceOf(g.cmp))} → ${fmtWon(priceOf(g.cur))} ${chip(g)}`] : ["없음", "뚜렷하게 달라진 곳이 없습니다"]);
      const [upName, upSub] = mover(up, 1), [downName, downSub] = mover(down, -1);
      $("saPriceSummary").innerHTML = metricStrip(
        metric("건당 평균 금액", all.cur.cnt ? fmtWon(priceOf(all.cur)) : "–",
          `${fmt(all.cur.cnt)}건 · ${R.cmpName} ${all.cmp.cnt ? chip(all) : "자료 없음"}`) +
        metric(`${R.cmpName} 건당 평균`, all.cmp.cnt ? fmtWon(priceOf(all.cmp)) : "–", `${fmt(all.cmp.cnt)}건`) +
        metric("구성을 맞춘 증감", all.adj === null ? "–" : signed(all.adj), "같은 수리 유형·브랜드끼리 값만 견준 변화") +
        metric("뚜렷하게 오른 곳", upName, upSub) + metric("뚜렷하게 내린 곳", downName, downSub));

      // 작은 추세 차트: 건수 많은 순 12개
      const top = list.slice(0, 12);
      $("saPriceGridTitle").textContent = `${L.label}별 건당 평균 금액 추이 (${P.U.label})`;
      $("saPriceGridMeta").textContent = buckets.length ? `${buckets[0].name} ~ ${buckets[buckets.length - 1].name} · 건수 많은 순 ${top.length}개` : "";
      if (!top.length) {
        $("saPriceGrid").innerHTML = '<p class="empty-msg">이 기간·조건의 매출이 없습니다.</p>';
      } else {
        $("saPriceGrid").innerHTML = top.map((g, i) =>
          `<div class="mini-card"><div class="mc-head"><b class="mc-name" title="${esc(L.name(g.key))}">${esc(L.name(g.key))}</b>` +
          `<span class="mc-chg">${chip(g)}</span></div>` +
          `<div class="mc-value">${fmtWon(priceOf(g.cur))}<small>건당 평균 · ${fmt(g.cur.cnt)}건</small></div>` +
          `<div class="mc-chart" data-i="${i}"></div>` +
          `<div class="mc-foot">${g.cmp.cnt ? `${esc(R.cmpName)} ${fmtWon(priceOf(g.cmp))}` : `${esc(R.cmpName)}에는 없음`}` +
          `${g.adj === null ? "" : ` · 같은 ${P.ctlLabel}끼리 ${signed(g.adj)}`}</div></div>`).join("");
        const labels = buckets.map(b => b.name);
        $("saPriceGrid").querySelectorAll(".mc-chart").forEach(box => {
          const g = top[+box.dataset.i];
          WCharts.mini(box, labels, g.b.map(priceOf), color, {
            name: "건당 평균", valueFmt: fmtWon, ariaLabel: `${L.name(g.key)} 건당 평균 금액 추이`,
            tipExtra: i => [{ name: "최저 ~ 최고", color: "transparent", value: g.b[i], fmt: s => `${K.man(s.min)} ~ ${K.man(s.max)}` },
              { name: "건수", color: "transparent", value: g.b[i].cnt, fmt: v => `${fmt(v)}건` }],
          });
        });
      }
      const single = (P.dimId === "category" && ST.f.category !== undefined) || (P.dimId === "manufacturer" && ST.f.manufacturer !== undefined) ||
        (P.dimId === "car_model" && ST.f.car_model !== undefined);
      $("saPriceNote").textContent = (single ? `${L.label} 조건이 걸려 있어 한 가지만 보입니다. '나누어 보기'를 다른 기준으로 바꿔 보세요. ` : "") +
        "가격은 건당 매출액(부가세 포함, 거래처 지급액을 빼기 전)입니다. 회색 증감은 건수가 적거나 금액이 들쭉날쭉해 우연과 구분되지 않는 변화입니다. " +
        `‘같은 ${P.ctlLabel}끼리’는 두 기간 모두 2건 이상 있는 ${P.ctlLabel}만 골라 이번 기간의 건수 구성 그대로 값만 견준 것으로, ` +
        "비싼 차·싼 차의 비중이 달라져 평균이 움직인 몫을 뺀 변화입니다.";

      // 표: 구분 × 최근 구간
      const cols = buckets.slice(-12), off = buckets.length - cols.length;
      const row = (g, name, cls) => `<tr${cls ? ` class="${cls}"` : ""}><td class="strong">${name}</td><td class="num">${fmt(g.cur.cnt)}</td>` +
        `<td class="num strong">${g.cur.cnt ? fmtWon(priceOf(g.cur)) : K.dash}</td><td class="num">${g.cur.cnt ? fmtWon(g.cur.min) : K.dash}</td>` +
        `<td class="num">${g.cur.cnt ? fmtWon(g.cur.max) : K.dash}</td><td class="num">${g.cmp.cnt ? fmtWon(priceOf(g.cmp)) : K.dash}</td>` +
        `<td class="num">${chip(g)}</td><td class="num">${g.adj === null ? K.dash : signed(g.adj)}</td>` +
        cols.map((_b, i) => `<td class="num sub">${fmtMan1(priceOf(g.b[off + i]))}</td>`).join("") + "</tr>";
      $("saPriceTableMeta").textContent = `기간 칸은 건당 평균(만 원) · ${fmt(list.length)}개`;
      $("saPriceTable").innerHTML = !list.length ? '<p class="empty-msg">이 기간·조건의 매출이 없습니다.</p>'
        : `<table class="data compact matrix price-table"><thead><tr><th>${esc(L.label)}</th><th>건수</th><th>건당 평균</th><th>최저</th><th>최고</th>` +
          `<th>${esc(R.cmpName)} 평균</th><th>증감</th><th>같은 ${P.ctlLabel}끼리</th>${cols.map(b => `<th>${esc(b.tick)}</th>`).join("")}</tr></thead><tbody>` +
          list.slice(0, 30).map(g => row(g, esc(L.name(g.key)))).join("") + row(all, "전체", "total-row") + "</tbody></table>";
    };

    // ================================================================ 마케팅 추천
    const REC_TAGS = [
      ["grow", "키우기", "ok", "잘 팔리고 계속 늘어나는 곳입니다. 광고·후기 모으기·소개 행사를 여기에 먼저 쓰세요."],
      ["recover", "되살리기", "warn", "비중이 큰데 줄었습니다. 단골이 빠졌는지, 가격·경쟁 업체가 달라졌는지 확인하고 다시 찾을 이유를 만드세요."],
      ["volume", "건수 늘리기", "info", "한 건 금액은 큰데 건수가 적습니다. 검색 노출·제휴 업체 소개로 문의를 늘리면 효과가 큽니다."],
      ["rising", "떠오르는 곳", "info", "아직 작지만 빠르게 늘고 있습니다. 적은 비용으로 먼저 시험해 보세요."],
    ];
    const TAG_NAME = Object.fromEntries(REC_TAGS.map(t => [t[0], t[1]]));
    // 마케팅 대상으로 삼을 수 없는 값(미지정·N/A·개인 등)은 추천에서 뺀다
    const named = v => !["", "N/A"].includes(norm(v));
    const TARGETABLE = {
      manufacturer: r => named(r.manufacturer), car_model: r => named(r.manufacturer) && named(r.car_model),
      category: r => named(r.category), client: r => !GENERIC_CLIENTS.has(norm(r.client)),
    };
    const singleDim = id => (id === "manufacturer" ? ST.f.manufacturer !== undefined
      : id === "car_model" ? ST.f.car_model !== undefined : id === "category" ? ST.f.category !== undefined : false);

    function calcRecs() {
      const R = ST.data.R, by = {}, items = [];
      const cur = slice(R.cur), cmp = slice(R.cmp);
      for (const id of Object.keys(DIMS)) {
        const L = DIMS[id];
        const ok = TARGETABLE[id];
        // sq: 건별 실매출의 제곱합 — 변화가 우연한 변동을 넘는지 가리는 데 쓴다(행은 거의 건별이라 행 단위로 어림)
        const toMap = rows => {
          const m = new Map();
          for (const r of rows) {
            if (ok && !ok(r)) continue;
            const k = L.key(r), c = Number(r.cnt) || 0, v = salesOf(r);
            let g = m.get(k);
            if (!g) { g = { sales: 0, cnt: 0, sq: 0 }; m.set(k, g); }
            g.sales += v; g.cnt += c;
            if (c > 0) g.sq += v * v / c;
          }
          return m;
        };
        const stats = M.segmentStats(toMap(cur), toMap(cmp));
        const recs = M.recommendSegments(stats);
        by[id] = { stats, recs };
        if (singleDim(id)) continue;  // 조건으로 하나만 남은 분류는 견줄 대상이 없다
        for (const s of recs) if (s.tag) items.push(Object.assign({ dimId: id, name: L.name(s.key) }, s));
      }
      return { by, items };
    }

    function recWhy(it, cmpName) {
      const cnt = `건수 ${fmt(it.cmpCnt)}→${fmt(it.cnt)}건`;
      if (it.tag === "volume") {
        const all = ST.data.tot.cur.avg;
        return `객단가 ${fmtWon(it.avg)}${all ? ` (전체 평균 ${fmtWon(all)})` : ""} · 건수 ${fmt(it.cnt)}건 (건수 비중 ${K.fmtPct(it.cntShare)})`;
      }
      if (it.tag === "recover") return `실매출 ${fmtWon(it.sales)} · ${cmpName} ${fmtWon(it.cmpSales)}에서 ${fmtWon(it.impact)} 줄어듦 · ${cnt}`;
      if (it.tag === "rising") return `실매출 ${fmtWon(it.sales)} (비중 ${K.fmtPct(it.share)}) · ${it.cmpSales ? `${cmpName} ${fmtWon(it.cmpSales)}` : `${cmpName}에는 없던 곳`} · ${cnt}`;
      return `실매출 ${fmtWon(it.sales)} (비중 ${K.fmtPct(it.share)}) · ${cmpName}보다 ${fmtWon(it.impact)} 늘어남 · ${cnt}`;
    }

    RENDER.marketing = function () {
      const D = ST.data, R = D.R, C = calcRecs();
      D.recs = C;
      const shown = [];
      $("saRecCards").innerHTML = REC_TAGS.map(([tag, title, tone, tip]) => {
        const list = C.items.filter(it => it.tag === tag).sort((a, b) => b.impact - a.impact).slice(0, 5);
        const body = list.length ? `<ul class="rec-list">${list.map(it => {
          shown.push(it);
          return `<li class="rec-item"><div class="rec-top"><span class="tag">${DIMS[it.dimId].label}</span>` +
            `<b class="rec-name">${esc(it.name)}</b><span class="rec-chg">${it.growth === null ? '<span class="muted">신규</span>' : K.changeChip(it.growth, true)}</span></div>` +
            `<div class="rec-why">${esc(recWhy(it, R.cmpName))}</div>` +
            `<button type="button" class="link-btn" data-rec="${shown.length - 1}">내역 보기</button></li>`;
        }).join("")}</ul>` : '<p class="rec-none">해당하는 곳이 없습니다.</p>';
        return `<div class="card rec-card"><div class="card-head"><h3><span class="status ${tone}">${title}</span></h3><span class="card-meta">${list.length}곳</span></div>` +
          `<p class="rec-tip">${tip}</p>${body}</div>`;
      }).join("");
      D.recShown = shown;
      $("saRecHint").textContent = `${R.label}을 ${R.cmpName}(${R.cmp.from} ~ ${R.cmp.to})와 견줘 고른 곳입니다 · ${condParts().join(" · ")}` +
        (R.days < 90 ? " · 기간이 짧으면 표본이 적어 추천이 줄어듭니다. 올해·최근 12개월로 넓혀 보세요." : "");

      // 요일: 한가한 날·바쁜 날
      const { lv } = calcWeekday();
      const slow = lv.filter(l => l.level === "slow"), busy = lv.filter(l => l.level === "busy");
      const names = a => a.map(l => `${l.name}요일(${signPct(l.ratio)})`).join(", ");
      D.timingDays = (slow.length ? `<li><b>한가한 요일</b> ${esc(names(slow))} — 평일 한정 할인·예약 행사로 채워 보세요.</li>` : "") +
        (busy.length ? `<li><b>바쁜 요일</b> ${esc(names(busy))} — 예약제로 나누면 기다림과 놓치는 손님을 줄일 수 있습니다.</li>` : "") +
        (slow.length || busy.length ? "" : lv.some(l => l.level !== "closed")
          ? "<li>요일별 차이가 크지 않습니다(영업하는 요일이 모두 평균의 80~120%).</li>"
          : '<li class="muted">이 기간·조건의 매출이 없어 요일을 견줄 수 없습니다.</li>');
      $("saTiming").innerHTML = `<ul class="tip-list">${D.timingDays}<li class="muted">다가오는 달의 계절성을 불러오는 중…</li></ul>`;
      $("saDormant").innerHTML = '<p class="empty-msg">불러오는 중…</p>';
      renderMap();
      const X = M.REC;
      $("saRecRule").innerHTML = `<li><b>키우기</b>: 실매출 비중이 분류 평균 이상이고 ${esc(R.cmpName)}보다 ${X.up}% 이상 늘어난 곳</li>` +
        `<li><b>되살리기</b>: 비중이 평균 이상(지금 또는 ${esc(R.cmpName)})인데 ${Math.abs(X.down)}% 이상 줄어든 곳</li>` +
        `<li><b>건수 늘리기</b>: 객단가가 전체보다 ${Math.round((X.ticket - 1) * 100)}% 이상 높은데 건수 비중은 평균에 못 미치는 곳</li>` +
        `<li><b>떠오르는 곳</b>: 비중은 아직 작지만 ${X.rising}% 이상 늘었거나 새로 생긴 곳(건수 ${X.minGain}건 이상 증가)</li>` +
        `<li><b>우연한 변동은 뺍니다</b>: 한 건 금액이 들쭉날쭉하면 큰 일 한두 건만 겹쳐도 실매출이 크게 달라집니다. ` +
        `그래서 두 기간의 차이가 평소 흩어짐의 ${X.z}배를 넘을 때만(통계로 보면 우연일 가능성 약 5% 아래) 변화로 보고, 표본이 적으면(건수 ${X.minCnt}건 미만) 추천하지 않습니다.</li>` +
        `<li>‘개인’·‘방문’·‘N/A’·미지정처럼 대상을 특정할 수 없는 값은 추천과 휴면 거래처에서 뺍니다.</li>` +
        `<li><b>휴면 거래처</b>: 최근 24개월에 ${X.dormantMinCnt}건 이상 거래했는데 마지막 거래 뒤 ${X.dormantDays}일 넘게 거래가 없는 곳</li>`;
      loadExtras();
    };

    /** 성장–비중 지도: 가로 = 실매출 비중, 세로 = 증감률 */
    function renderMap() {
      const D = ST.data, R = D.R, id = ST.mapDim, L = DIMS[id];
      K.setSeg("saMapDim", "dim", id);
      const { stats, recs } = D.recs.by[id];
      const pts = recs.filter(s => s.growth !== null && (s.cnt >= M.REC.minCnt || s.cmpCnt >= M.REC.minCnt))
        .map(s => ({ name: L.name(s.key), x: s.share, y: s.growth, rank: s.sales, s }));
      const pct = v => `${Math.round(v * 10) / 10}%`;
      if (!pts.length) {
        $("saMap").innerHTML = `<p class="empty-msg">${singleDim(id) ? `${L.label} 조건이 걸려 있어 견줄 대상이 없습니다.` : "견줄 만큼 실적이 쌓인 곳이 없습니다."}</p>`;
        $("saMapNote").textContent = "";
        return;
      }
      const color = getCss("--series-income");
      WCharts.scatter($("saMap"), pts, {
        color, xTitle: "실매출 비중", yTitle: `${R.cmpName} 대비 증감`, xFmt: pct, yFmt: v => `${v > 0 ? "+" : ""}${Math.round(v)}%`,
        xRef: { value: stats.even, label: `평균 비중 ${pct(stats.even)}` }, yClamp: [-100, 200],
        quadrants: { tr: "키우기", br: "되살리기", tl: "떠오름", bl: "지켜보기" },
        tipRows: p => [{ name: "실매출", color, value: p.s.sales, fmt: fmtWon }, { name: "비중", color: "transparent", value: p.s.share, fmt: pct },
          { name: `${R.cmpName} 대비`, color: "transparent", value: p.s.growth, fmt: v => `${v > 0 ? "+" : ""}${pct(v)}` },
          { name: "건수", color: "transparent", value: p.s, fmt: s => `${fmt(s.cmpCnt)}→${fmt(s.cnt)}건` }],
        ariaLabel: `${L.label}별 실매출 비중과 증감률`,
      });
      $("saMapNote").textContent = `점 하나가 ${L.label} 하나입니다. 오른쪽일수록 매출 비중이 크고, 위일수록 ${R.cmpName}보다 많이 늘었습니다. ` +
        `세로 점선은 평균 비중이고, 증감률이 +200%를 넘으면 맨 위에 붙여 그립니다.`;
    }

    /** 휴면 거래처(최근 24개월)와 다가오는 달의 계절성(최근 36개월)은 고른 기간과 상관없이 따로 받는다 */
    async function loadExtras() {
      const today = todayStr(), filters = listFilters();
      const key = JSON.stringify([today, filters]);
      if (MK.key !== key) {
        MK.key = key;
        const curKey = today.slice(0, 7), firstKey = M.addMonthKey(curKey, -36), lastKey = M.addMonthKey(curKey, -1);
        MK.months = M.monthKeys(firstKey, lastKey);
        MK.p = Promise.all([
          K.aggf("incomes", M.addDays(M.addMonths(today, -24), 1), today, "client", filters),
          K.aggf("incomes", `${firstKey}-01`, today, "month", filters),
        ]);
      }
      const req = nextReq("sales-mk");
      try {
        const [clients, months] = await MK.p;
        if (isStale("sales-mk", req) || ST.tab !== "marketing" || !ST.data) return;
        renderDormant(clients, today);
        renderSeason(months, today);
      } catch (err) { MK.key = null; toast(err.message, true); }
    }

    function renderDormant(clients, today) {
      const X = M.REC;
      const list = M.dormantClients(clients.map(r => ({ key: norm(r.client), sales: salesOf(r), cnt: Number(r.cnt) || 0, last: r.last_date })),
        today, { exclude: [...GENERIC_CLIENTS] });
      ST.data.dormant = list;
      $("saDormantMeta").textContent = `최근 24개월 ${X.dormantMinCnt}건 이상 · ${X.dormantDays}일 넘게 거래 없음 · ${fmt(list.length)}곳`;
      if (!list.length) {
        $("saDormant").innerHTML = '<p class="empty-msg">거래가 끊긴 거래처가 없습니다.</p>';
        return;
      }
      $("saDormant").innerHTML = `<table class="data compact"><thead><tr><th>거래처</th><th class="opt">마지막 거래</th><th class="num">지난 날</th>` +
        `<th class="num opt">2년간 건수</th><th class="num">2년간 실매출</th><th></th></tr></thead><tbody>` +
        list.slice(0, 12).map((c, i) => `<tr><td class="strong">${esc(c.key)}</td><td class="date opt">${esc(c.last)}</td>` +
          `<td class="num"><span class="age${c.idle >= 180 ? " old" : c.idle >= 90 ? " mid" : ""}" title="마지막 거래 ${esc(c.last)}">${fmt(c.idle)}일</span></td>` +
          `<td class="num opt">${fmt(c.cnt)}</td><td class="num">${fmtWon(c.sales)}</td>` +
          `<td><button type="button" class="link-btn" data-dormant="${i}" aria-label="${esc(c.key)} 내역 보기">내역</button></td></tr>`).join("") + "</tbody></table>" +
        (list.length > 12 ? `<p class="rank-more">외 ${fmt(list.length - 12)}곳 · 전체는 엑셀로 받기에서 볼 수 있습니다</p>` : "");
    }

    function renderSeason(monthRows, today) {
      const by = new Map(monthRows.map(r => [r.month, salesOf(r)]));
      const vals = MK.months.map(k => by.get(k) || 0);
      const f = M.forecastSeries(vals, +MK.months[0].slice(5), { horizon: 1, backtest: false });
      let html;
      if (!f.seasonal) {
        html = `<li class="muted">다가오는 비수기·성수기는 실적이 12개월 이상 쌓이면 보입니다 (지금 ${f.n}개월).</li>`;
      } else {
        const next = [1, 2, 3, 4, 5, 6].map(i => { const m = +M.addMonthKey(today.slice(0, 7), i).slice(5); return { m, s: f.seasonal[m - 1] }; });
        const low = next.filter(x => x.s <= 0.92), high = next.filter(x => x.s >= 1.08);
        const names = a => a.map(x => `${x.m}월(${signPct(x.s)})`).join(", ");
        html = (low.length ? `<li><b>다가오는 비수기</b> ${names(low)} — 한 달쯤 앞서 예약 할인·묶음 상품·단골 문자 안내를 준비하세요.</li>` : "") +
          (high.length ? `<li><b>다가오는 성수기</b> ${names(high)} — 부품 재고와 작업 일정을 미리 챙기고, 광고는 직전 달부터 시작하세요.</li>` : "") +
          (!low.length && !high.length ? "<li>앞으로 6개월은 평소와 비슷한 달입니다(월평균의 92~108%).</li>" : "") +
          (f.n < 24 ? `<li class="muted">계절성은 ${f.n}개월치 실적으로 본 것이라 잡음이 섞여 있습니다. 2년 이상 쌓이면 더 정확합니다.</li>` : "");
      }
      ST.data.timingSeason = html;
      $("saTiming").innerHTML = `<ul class="tip-list">${ST.data.timingDays}${html}</ul>`;
    }

    // ---------------------------------------------------------------- 이벤트
    K.bindPeriod({ period: "saPeriod", from: "saFrom", to: "saTo", compare: "saCompare" }, ST, (() => {
      let last = "";
      return () => {
        const now = [ST.period, ST.from, ST.to].join("|");
        if (now !== last) { ST.unit = null; ST.priceUnit = null; last = now; }  // 기간이 바뀌면 단위는 다시 알맞게
        load(false);
      };
    })());
    const showTab = K.bindTabs("saTabs", "saTab", TABS, ST, render);
    K.bindSeg("saScope", "scope", v => { ST.scope = v; delete ST.f.category; load(false); });
    K.bindSeg("saMeasure", "measure", v => { ST.measure = v; render(); });
    K.bindSeg("saUnit", "unit", v => { ST.unit = v; render(); });
    K.bindSeg("saPriceUnit", "unit", v => { ST.priceUnit = v; render(); });
    K.bindSeg("saMapDim", "dim", v => { ST.mapDim = v; if (ST.data && ST.data.recs) renderMap(); });
    $("saPriceDim").addEventListener("change", () => { ST.priceDim = $("saPriceDim").value; render(); });
    for (const id of FILTER_DIMS) {
      $(FILTER_EL[id]).addEventListener("change", () => {
        const v = $(FILTER_EL[id]).value;
        setFilter(id, v === "" ? undefined : FOPT[id][+v]);
        render();
      });
    }
    $("saClear").addEventListener("click", () => { ST.f = {}; render(); });
    // 목록 항목을 누르면 그 항목으로 좁혀 본다(다시 누르면 풀림)
    $("saMixLists").addEventListener("click", e => {
      const b = e.target.closest(".rank-row");
      if (!b) return;
      const id = b.dataset.list, key = b.dataset.key;
      setFilter(id, selectedKey(id) === key ? undefined : key);
      render();
    });
    $("view-sales").addEventListener("click", e => {
      const rec = e.target.closest("[data-rec]"), dor = e.target.closest("[data-dormant]");
      const D = ST.data;
      if (rec && D && D.recShown) {
        const it = D.recShown[+rec.dataset.rec];
        openEntries("income", { from: D.R.cur.from, to: D.R.cur.to, f: listFilters(dimFilters(it.dimId, it.key)) });
      } else if (dor && D && D.dormant) {
        const c = D.dormant[+dor.dataset.dormant];
        openEntries("income", { from: "", to: "", f: listFilters({ client: c.key }) });
      }
    });
    $("saOpenList").addEventListener("click", () => {
      if (ST.data) openEntries("income", { from: ST.data.R.cur.from, to: ST.data.R.cur.to, f: listFilters() });
    });
    $("saOpenForecast").addEventListener("click", () => openForecast("incomes", listFilters(), condParts().join(" · ")));

    // ---------------------------------------------------------------- 엑셀로 받기
    $("saExport").addEventListener("click", async () => {
      const D = ST.data;
      if (!D) { toast("먼저 집계 결과가 있어야 합니다.", true); return; }
      const W = window.WellcarXlsxWriter, S = W.S, X = K.xl, R = D.R, T = D.tot;
      const sub = `${R.cur.from} ~ ${R.cur.to} · ${condParts().join(" · ")} · 비교 ${R.cmpName} ${R.cmp.from} ~ ${R.cmp.to}`;
      const ch = (a, b) => X.pct(M.pctChange(a, b));
      const sheets = [];

      sheets.push(X.sheet("요약", `웰카오디오 매출 분석 — ${R.label}`, sub, ["지표", "이번 기간", R.cmpName, "증감률"], [
        ["실매출", X.won(T.cur.sales), X.won(T.cmp.sales), ch(T.cur.sales, T.cmp.sales)],
        ["건수", T.cur.cnt, T.cmp.cnt, ch(T.cur.cnt, T.cmp.cnt)],
        ["객단가", X.won(T.cur.avg), X.won(T.cmp.avg), ch(T.cur.avg, T.cmp.avg)],
        ["영업일", T.cur.days, T.cmp.days, ch(T.cur.days, T.cmp.days)],
        ["영업일 하루 평균", X.won(T.cur.daily), X.won(T.cmp.daily), ch(T.cur.daily, T.cmp.daily)],
        ["매출액(거래처 지급액 빼기 전)", X.won(T.cur.gross), X.won(T.cmp.gross), ch(T.cur.gross, T.cmp.gross)],
      ], [30, 16, 16, 11]));

      const P = calcPeriod();
      sheets.push(X.sheet(P.U.label, `${P.U.label} 매출`, sub,
        ["기간", "시작일", "종료일", "실매출", "건수", "객단가", "전기 실매출", "전기 대비", "전년 동기 실매출", "전년 동기 대비", "비고"],
        P.rows.map(r => {
          const s = pick(r.cur, "sales"), p = pick(r.prev, "sales"), l = pick(r.ly, "sales");
          return [r.b.name, r.b.from, r.b.to, X.won(s), r.cur.cnt, X.won(pick(r.cur, "avg")), X.won(p), ch(s, p), X.won(l), ch(s, l),
            r.going ? "진행 중" : r.partial ? "일부" : ""];
        }), [20, 12, 12, 15, 8, 14, 15, 11, 15, 11, 9],
        ["합계", "", "", X.won(T.cur.sales), T.cur.cnt, X.won(T.cur.avg), X.won(T.prev.sales), ch(T.cur.sales, T.prev.sales),
          X.won(T.ly.sales), ch(T.cur.sales, T.ly.sales)]));

      const Wd = calcWeekday();
      sheets.push(X.sheet("요일별", "요일별 매출", sub,
        ["요일", "날 수", "영업일", "실매출", "건수", "객단가", "하루 평균 실매출", "하루 평균 건수", "요일 평균 대비", `${R.cmpName} 하루 평균 실매출`],
        Wd.wd.map((w, i) => [w.name + "요일", w.dates, w.days, X.won(w.amount - w.payout), w.cnt, X.won(perDay(w, "avg")), X.won(perDay(w, "sales")),
          w.dates ? { v: Math.round(w.cnt / w.dates * 100) / 100, s: S.dec } : null,
          Wd.lv[i].ratio === null || Wd.lv[i].level === "closed" ? null : X.pct((Wd.lv[i].ratio - 1) * 100),
          Wd.wc ? X.won(perDay(Wd.wc[i], "sales")) : null]), [10, 8, 8, 15, 8, 14, 17, 14, 14, 20]));

      const Rc = D.recs || calcRecs();
      const tagOf = id => new Map(Rc.by[id].recs.map(s => [s.key, s.tag]));
      for (const [id, title] of [["manufacturer", "브랜드별"], ["car_model", "차종별"], ["category", "수리유형별"], ["client", "거래처별"]]) {
        const L = DIMS[id], data = id === "client"
          ? K.rankData(slice(R.cur), slice(R.cmp), L.key, salesOf, "sales") : calcList(id, "sales");
        const tags = tagOf(id);
        sheets.push(X.sheet(title, `${title} 매출`, sub, ["항목", "실매출", "건수", "객단가", "실매출 비중", `${R.cmpName} 실매출`, `${R.cmpName} 건수`, "실매출 증감률", "추천"],
          data.items.map(it => [L.name(it.key), X.won(it.g.v), it.g.cnt, X.won(it.g.cnt ? it.g.v / it.g.cnt : null),
            data.totalV ? X.pct(it.g.v / data.totalV * 100) : null, it.cg ? X.won(it.cg.v) : null, it.cg ? it.cg.cnt : null,
            it.cg ? ch(it.g.v, it.cg.v) : null, TAG_NAME[tags.get(it.key)] || ""]),
          [28, 15, 8, 14, 11, 15, 10, 12, 12],
          ["합계", X.won(data.totalV), data.totalCnt, X.won(data.totalCnt ? data.totalV / data.totalCnt : null), X.pct(data.totalV ? 100 : 0)]));
      }

      const Mx = calcMatrix("sales");
      sheets.push({ name: "브랜드×수리유형", widths: [18, ...Mx.cats.map(() => 13), 14], freeze: "B5", rows: [
        [{ v: `브랜드 × 수리 유형 실매출 — ${R.label}`, s: S.title }], [{ v: `단위: 원 · ${sub}`, s: S.muted }], [],
        [X.head("브랜드 \\ 수리 유형"), ...Mx.cats.map(c => X.head(K.unset(c))), X.head("합계")],
        ...Mx.brands.map(b => [K.unset(b), ...Mx.cats.map(c => { const g = Mx.cell.get(b + SEP + c); return g ? X.won(g.v) : null; }),
          { v: Math.round(Mx.byB.get(b).v), s: S.totalNum }]),
      ] });

      const Pr = calcPrice();
      const priceRow = (g, name) => [name, g.cur.cnt, X.won(priceOf(g.cur)), X.won(g.cur.min), X.won(g.cur.max),
        X.won(priceOf(g.cmp)), X.pct(g.change), g.change === null ? "" : g.clear ? "예" : "아니오", X.pct(g.adj), ...g.b.map(s => X.won(priceOf(s)))];
      sheets.push(X.sheet("가격 추이", `${Pr.L.label}별 건당 평균 금액 (${Pr.U.label})`,
        `${sub} · 가격 = 건당 매출액(부가세 포함, 거래처 지급액 빼기 전) · 뚜렷한 변화 = 우연한 변동을 넘는 차이`,
        [Pr.L.label, "건수", "건당 평균", "최저", "최고", `${R.cmpName} 평균`, "증감률", "뚜렷한 변화", `같은 ${Pr.ctlLabel}끼리 증감률`, ...Pr.buckets.map(b => b.name)],
        Pr.list.map(g => priceRow(g, Pr.L.name(g.key))), [26, 8, 14, 13, 13, 14, 10, 11, 16, ...Pr.buckets.map(() => 13)], priceRow(Pr.all, "전체")));

      sheets.push(X.sheet("마케팅 추천", "집중 마케팅 대상 추천", sub,
        ["추천", "분류", "항목", "실매출", "실매출 비중", `${R.cmpName} 실매출`, "증감률", "건수", `${R.cmpName} 건수`, "객단가"],
        REC_TAGS.flatMap(([tag, title]) => Rc.items.filter(it => it.tag === tag).sort((a, b) => b.impact - a.impact).map(it =>
          [title, DIMS[it.dimId].label, it.name, X.won(it.sales), X.pct(it.share), X.won(it.cmpSales), X.pct(it.growth), it.cnt, it.cmpCnt, X.won(it.avg)])),
        [12, 10, 28, 15, 11, 15, 10, 8, 10, 14]));
      if (D.dormant && D.dormant.length) {
        sheets.push(X.sheet("휴면 거래처", "거래가 끊긴 거래처", `최근 24개월 ${M.REC.dormantMinCnt}건 이상 · ${M.REC.dormantDays}일 넘게 거래 없음 · ${condParts().join(" · ")}`,
          ["거래처", "마지막 거래일", "지난 날 수", "2년간 건수", "2년간 실매출"],
          D.dormant.map(c => [c.key, c.last, c.idle, c.cnt, X.won(c.sales)]), [28, 13, 10, 10, 15]));
      }
      try { toast(`${await saveBlob(`웰카오디오_매출분석_${R.cur.from}_${R.cur.to}.xlsx`, W.build(sheets))} 파일을 받았습니다.`); }
      catch (err) { toast(err.message, true); }
    });

    return {
      /** 다른 화면에서 넘어올 때: 탭·조건을 정해 둔다 */
      open(opts) {
        opts = opts || {};
        if (opts.tab && TABS.includes(opts.tab)) { ST.tab = opts.tab; showTab(); }
      },
    };
  };
})();
