/* 추세·예측 화면.
   app.js가 WellcarInsights(ctx)로 연결한다. 예측 계산은 metrics.js가 한다. */
(function () {
  "use strict";

  window.WellcarInsights = function install(ctx) {
    const { $, api, esc, fmtWon, toast, getCss, refreshers, nextReq, isStale, todayStr, loadTargets } = ctx;
    const M = window.WellcarMetrics;

    // ---------------------------------------------------------------- 공통 도우미
    const dash = '<span class="muted">–</span>';
    const fmtPct = (v, digits) => (v === null || v === undefined || !isFinite(v) ? "–"
      : `${(Math.round(v * 10 ** (digits ?? 1)) / 10 ** (digits ?? 1)).toLocaleString("ko-KR")}%`);
    const sum = a => a.reduce((x, y) => x + y, 0);
    const salesOf = r => (Number(r.amount) || 0) - (Number(r.payout) || 0);
    const amountOf = r => Number(r.amount) || 0;
    const monthLabel = key => `${+key.slice(5)}월`;
    // 예측값은 실제보다 정밀해 보이지 않게 만 원 단위로 반올림해 보여 준다
    const est = v => fmtWon(Math.round(v / 10000) * 10000);
    const man = v => `${v < 0 ? "−" : ""}${Math.abs(Math.round(v / 10000)).toLocaleString("ko-KR")}만`;
    const yearMonthLabel = key => `${key.slice(0, 4)}년 ${+key.slice(5)}월`;

    /** 증감 칩: 화살표는 방향, 색은 좋고 나쁨 */
    function changeChip(pct, upGood) {
      if (pct === null || pct === undefined || !isFinite(pct)) return dash;
      const r = Math.round(pct * 10) / 10;
      if (r === 0) return '<span class="delta flat">― 0%</span>';
      const good = (r > 0) === upGood;
      return `<span class="delta ${good ? "up" : "down"}">${r > 0 ? "▲" : "▼"} ${Math.abs(r).toLocaleString("ko-KR")}%</span>`;
    }
    /** 예상 달성률: more = 높을수록 좋음, less = 예산(낮을수록 좋음) */
    function achChip(pct, kind) {
      if (pct === null || pct === undefined || !isFinite(pct)) return dash;
      const t = fmtPct(pct, 0);
      if (kind === "less") return pct > 100 ? `<span class="status warn">! ${t}</span>` : `<span class="status ok">${t}</span>`;
      return pct >= 100 ? `<span class="status ok">✓ ${t}</span>` : `<span class="ach">${t}</span>`;
    }

    /** /api/agg + 조건(f.분류=값, 빈 문자열은 '미지정'을 뜻함) */
    function aggf(kind, from, to, group, filters) {
      const p = new URLSearchParams({ kind, from, to });
      if (group) p.set("group", group);
      for (const [k, v] of Object.entries(filters || {})) if (v !== null && v !== undefined) p.set("f." + k, v);
      return api(`/api/agg?${p}`).then(r => r.rows);
    }

    // ================================================================ 추세·예측
    // scope: "" = 전체, 아니면 scopeValue()가 만든 문자열({t: 표, f: {분류: 값}}). pending·custom은 다른 화면에서 넘어온 범위
    const FC = { kind: "sales", horizon: 6, scope: "", pending: null, custom: null };
    const FC_KIND = {
      sales: { label: "매출", unit: "실매출", color: "--series-income", target: "sales", tk: "more", upGood: true },
      expense: { label: "지출", unit: "지출금액", color: "--series-expense", target: "expense", tk: "less", upGood: false },
      profit: { label: "영업이익", unit: "실매출 − 지출", color: "--series-profit", target: "profit", tk: "more", upGood: true },
    };

    /** 범위 값: 표(incomes·expenses)와 조건을 분류 이름순으로 적은 문자열 — 같은 조건이면 늘 같은 값 */
    const scopeValue = (t, f) => JSON.stringify({ t, f: Object.fromEntries(Object.keys(f).sort().map(k => [k, f[k]])) });
    let scopeCache = null;  // 범위 선택 목록: 최근 12개월 금액 순
    function loadScopeOptions() {
      if (!scopeCache) {
        const t = todayStr(), from = M.addDays(M.addMonths(t, -12), 1);
        scopeCache = Promise.all([aggf("incomes", from, t, "manufacturer"), aggf("incomes", from, t, "category"),
          aggf("incomes", from, t, "manufacturer,car_model"), aggf("expenses", from, t, "expense_type")])
          .catch(e => { scopeCache = null; throw e; });
      }
      return scopeCache;
    }
    function fillScope(byBrand, byCat, byModel, byExpType) {
      const sel = $("fcScope");
      const group = (label, list) => (list.length ? `<optgroup label="${label}">` + list.map(([value, name]) =>
        `<option value="${esc(value)}">${esc(name)}</option>`).join("") + "</optgroup>" : "");
      const top = (rows, valueFn, ok) => rows.filter(r => valueFn(r) > 0 && ok(r)).sort((a, b) => valueFn(b) - valueFn(a)).slice(0, 15);
      const groups =
        group("매출 범위", [[scopeValue("incomes", { income_type: "서비스제공" }), "수리·서비스 매출"],
          [scopeValue("incomes", { income_type: "상품판매" }), "상품판매 매출"]]) +
        group("브랜드 매출만", top(byBrand, salesOf, r => r.manufacturer).map(r => [scopeValue("incomes", { manufacturer: r.manufacturer }), r.manufacturer])) +
        group("차종 매출만", top(byModel, salesOf, r => r.car_model).map(r => [scopeValue("incomes", { manufacturer: r.manufacturer, car_model: r.car_model }),
          `${r.manufacturer && r.manufacturer !== "N/A" ? r.manufacturer + " " : ""}${r.car_model}`])) +
        group("수리 유형(매출구분) 매출만", top(byCat, salesOf, r => r.category).map(r => [scopeValue("incomes", { category: r.category }), r.category])) +
        group("지출유형 지출만", top(byExpType, amountOf, r => r.expense_type).map(r => [scopeValue("expenses", { expense_type: r.expense_type }), r.expense_type]));
      // 다른 화면에서 넘어온 범위: 목록에 없는 조합이면 맨 위에 따로 둔다
      if (FC.pending) {
        FC.scope = FC.pending.value;
        FC.custom = FC.pending.value && !groups.includes(`value="${esc(FC.pending.value)}"`) ? FC.pending : null;
        FC.pending = null;
      }
      sel.innerHTML = '<option value="">전체 (매출·지출·영업이익)</option>' +
        (FC.custom ? group("분석 화면에서 고른 조건", [[FC.custom.value, FC.custom.label]]) : "") + groups;
      sel.value = [...sel.options].some(o => o.value === FC.scope) ? FC.scope : "";
      FC.scope = sel.value;
      const opt = sel.selectedOptions[0];
      FC.scopeLabel = FC.scope && opt ? opt.textContent : "";
    }

    /** 범위가 정해지면 그 표의 값만 예측한다(매출 범위 → 매출, 지출 범위 → 지출) */
    function syncKindButtons(only) {
      document.querySelectorAll("#fcKind [data-kind]").forEach(b => {
        const on = b.dataset.kind === FC.kind;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
        b.disabled = !!only && b.dataset.kind !== only;
        b.title = b.disabled ? "범위를 좁히면 그 범위의 매출(또는 지출)만 예측합니다" : "";
      });
    }

    /** 월별 값 배열 (없는 달은 0) */
    function monthly(rows, keys, fn) {
      const m = new Map();
      for (const r of rows) m.set(r.month, (m.get(r.month) || 0) + fn(r));
      return keys.map(k => m.get(k) || 0);
    }
    /** 그달의 일별 값 배열 */
    function dailyOf(rows, key, fn) {
      const [y, mo] = key.split("-").map(Number);
      const arr = Array(M.daysInMonth(y, mo)).fill(0);
      for (const r of rows) if (r.date.startsWith(key)) arr[+r.date.slice(8) - 1] += fn(r);
      return arr;
    }

    /** 한 계열(매출 또는 지출)의 예측: 끝난 달의 모형 예측 + 이번 달 마감 예상 */
    function projectOne(monthRows, dayRows, fn, ctxKeys) {
      const { keys, curKey, today } = ctxKeys;
      const vals = monthly(monthRows, keys, fn);
      const f = M.forecastSeries(vals, +keys[0].slice(5), { horizon: 13 });
      const mtd = sum(dailyOf(dayRows, curKey, fn));
      const history = [1, 2, 3, 4, 5, 6].map(i => dailyOf(dayRows, M.addMonthKey(curKey, -i), fn));
      const p0 = f.forecast[0];
      const landing = M.monthLanding({ mtd, today, history, monthMean: p0 ? p0.mean : null, monthHw: p0 ? p0.hw : null });
      return { vals, f, landing, mtd };
    }

    refreshers.forecast = async function () {
      const today = todayStr();
      const curKey = today.slice(0, 7);
      const lastKey = M.addMonthKey(curKey, -1);
      const firstKey = M.addMonthKey(curKey, -36);
      const keys = M.monthKeys(firstKey, lastKey);
      const req = nextReq("forecast");
      try {
        const opts = await loadScopeOptions();
        if (isStale("forecast", req)) return;
        fillScope(...opts);
        const scope = FC.scope ? JSON.parse(FC.scope) : null;
        const only = scope ? (scope.t === "expenses" ? "expense" : "sales") : null;
        if (only) FC.kind = only;
        syncKindButtons(only);
        const none = Promise.resolve([]);
        const dayFrom = `${M.addMonthKey(curKey, -6)}-01`;
        const wantInc = only !== "expense", wantExp = only !== "sales";
        const [incM, expM, incD, expD, T] = await Promise.all([
          wantInc ? aggf("incomes", `${firstKey}-01`, today, "month", only ? scope.f : null) : none,
          wantExp ? aggf("expenses", `${firstKey}-01`, today, "month", only ? scope.f : null) : none,
          wantInc ? aggf("incomes", dayFrom, today, "date", only ? scope.f : null) : none,
          wantExp ? aggf("expenses", dayFrom, today, "date", only ? scope.f : null) : none,
          loadTargets(),
        ]);
        if (isStale("forecast", req)) return;
        const ck = { keys, curKey, today };
        const sales = wantInc ? projectOne(incM, incD, salesOf, ck) : null;
        const expense = wantExp ? projectOne(expM, expD, amountOf, ck) : null;
        renderForecast({ keys, curKey, today, sales, expense, T: scope ? {} : T, scopeLabel: FC.scopeLabel });
      } catch (err) { toast(err.message, true); }
    };

    /** 화면에 그릴 한 계열: 지난 실적 + [이번 달 마감 예상, 다음 달들 예측] */
    function seriesFor(kind, d) {
      if (kind !== "profit") {
        const p = kind === "sales" ? d.sales : d.expense;
        const future = p.f.forecast.slice(1).map(q => ({ mean: q.mean, hw: q.hw, lo: q.lo, hi: q.hi }));
        return { vals: p.vals, landing: p.landing, future, f: p.f, nonNeg: true };
      }
      const s = d.sales, e = d.expense;
      const vals = s.vals.map((v, i) => v - e.vals[i]);
      const diff = M.diffForecast(s.f.forecast, e.f.forecast).slice(1);
      const ls = s.landing, le = e.landing;
      const landing = ls.mean === null || le.mean === null ? { mean: null } : {
        mean: ls.mean - le.mean, hw: Math.sqrt((ls.hw || 0) ** 2 + (le.hw || 0) ** 2), mtd: ls.mtd - le.mtd,
        pace: ls.pace !== null && le.pace !== null ? ls.pace - le.pace : null, share: ls.share,
      };
      if (landing.mean !== null) { landing.lo = landing.mean - landing.hw; landing.hi = landing.mean + landing.hw; }
      return { vals, landing, future: diff, f: s.f, fe: e.f, nonNeg: false };
    }

    function renderForecast(d) {
      const { keys, curKey } = d;
      const kind = FC.kind, K = FC_KIND[kind], H = FC.horizon;
      const color = getCss(K.color);
      const S = seriesFor(kind, d);
      const valOf = new Map(keys.map((k, i) => [k, S.vals[i]]));
      const lyOf = k => (valOf.has(M.addMonthKey(k, -12)) ? valOf.get(M.addMonthKey(k, -12)) : null);
      const T = d.T || {};
      const tgt = k => { const t = T[k]; return t && t[K.target] !== undefined && t[K.target] !== null ? t[K.target] : null; };
      const scopeName = d.scopeLabel ? `‘${d.scopeLabel}’ ` : "";
      const noData = S.f.method === "none" && S.landing.mean === null;

      // 앞으로의 달 (이번 달 = 마감 예상)
      const rows = [];
      if (S.landing.mean !== null) {
        rows.push({ key: curKey, cur: true, mean: S.landing.mean, lo: S.landing.lo, hi: S.landing.hi, hw: S.landing.hw || 0 });
      }
      S.future.slice(0, H).forEach((q, i) => rows.push({ key: M.addMonthKey(curKey, i + 1), mean: q.mean, lo: q.lo, hi: q.hi, hw: q.hw }));

      // 올해 마감 예상: 올해 끝난 달 + 이번 달 마감 예상 + 남은 달 예측
      const year = curKey.slice(0, 4);
      let yearMean = null, yearHw = 0;
      if (S.landing.mean !== null) {
        yearMean = sum(keys.filter(k => k.startsWith(year)).map(k => valOf.get(k))) + S.landing.mean;
        yearHw = (S.landing.hw || 0) ** 2;
        S.future.forEach((q, i) => {
          if (M.addMonthKey(curKey, i + 1).startsWith(year)) { yearMean += q.mean; yearHw += q.hw ** 2; }
        });
        yearHw = Math.sqrt(yearHw);
      }
      const yearT = keys.concat([curKey]).concat(S.future.map((_, i) => M.addMonthKey(curKey, i + 1)))
        .filter((k, i, a) => k.startsWith(year) && a.indexOf(k) === i).map(tgt);
      const yearTarget = yearT.some(v => v !== null) ? sum(yearT.map(v => v || 0)) : null;
      const lastYearTotal = (() => {
        const ks = keys.filter(k => k.startsWith(String(+year - 1)));
        return ks.length === 12 ? sum(ks.map(k => valOf.get(k))) : null;
      })();

      // 추세: 최근 3개월 전년 동기 대비, 월 추세
      const n = keys.length;
      const last3 = S.vals.slice(n - 3), ly3 = S.vals.slice(n - 15, n - 12);
      const yoy3 = S.f.n >= 15 && sum(ly3) ? (sum(last3) - sum(ly3)) / Math.abs(sum(ly3)) * 100 : null;

      // ---- 지표 4개
      const range = (lo, hi) => `범위 ${man(lo)} ~ ${man(hi)}`;
      const L = S.landing;
      const curT = tgt(curKey);
      const tiles = [];
      if (L.mean === null) {
        tiles.push(tileHtml(`이번 달(${monthLabel(curKey)}) 마감 예상`, dash, color, "아직 이번 달 실적이 없어 예상할 수 없습니다."));
      } else {
        const meterTxt = curT !== null
          ? `${K.tk === "less" ? "예산" : "목표"} ${fmtWon(curT)} · 예상 ${K.tk === "less" ? "집행" : "달성"} ${fmtPct(curT ? L.mean / curT * 100 : null, 0)}`
          : `${K.label} 목표 없음`;
        tiles.push(tileHtml(`이번 달(${monthLabel(curKey)}) 마감 예상`, est(L.mean), color,
          `<span>오늘까지 ${fmtWon(L.mtd)}</span>${L.pace !== null && L.pace !== undefined ? `<span>지금 속도면 ${man(L.pace)}</span>` : ""}`,
          forecastMeter(L.mtd, L.mean, curT, K.tk, meterTxt)));
      }
      const next = rows.find(r => !r.cur);
      if (next) {
        const ly = lyOf(next.key), nt = tgt(next.key);
        tiles.push(tileHtml(`다음 달(${monthLabel(next.key)}) 예상`, est(next.mean), color,
          `<span>${range(next.lo, next.hi)}</span>` +
          (ly !== null ? `<span>작년 같은 달 ${changeChip(M.pctChange(next.mean, ly), K.upGood)}</span>` : "") +
          (nt !== null ? `<span>${K.tk === "less" ? "예산" : "목표"} 대비 ${achChip(next.mean / nt * 100, K.tk)}</span>` : "")));
      } else {
        tiles.push(tileHtml("다음 달 예상", dash, color, "실적이 한 달 이상 쌓이면 보입니다."));
      }
      if (yearMean !== null) {
        tiles.push(tileHtml(`올해(${year}년) 마감 예상`, est(yearMean), color,
          `<span>${range(yearMean - yearHw, yearMean + yearHw)}</span>` +
          (yearTarget !== null ? `<span>연 ${K.tk === "less" ? "예산" : "목표"} 대비 ${achChip(yearMean / yearTarget * 100, K.tk)}</span>`
            : lastYearTotal !== null ? `<span>작년 대비 ${changeChip(M.pctChange(yearMean, lastYearTotal), K.upGood)}</span>` : "")));
      } else {
        tiles.push(tileHtml(`올해(${year}년) 마감 예상`, dash, color, ""));
      }
      const slope = kind === "profit" ? null : S.f.slopePct;
      const trendVal = slope === null || slope === undefined ? (yoy3 === null ? "–" : (yoy3 >= 0 ? "▲ " : "▼ ") + fmtPct(Math.abs(yoy3)))
        : `${slope >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(slope), 1)} / 월`;
      tiles.push(tileHtml(kind === "profit" || slope === null || slope === undefined ? "최근 3개월 전년 대비" : "추세 (계절성을 뺀 월 증가율)", trendVal,
        "var(--ink-3)",
        (slope !== null && slope !== undefined && yoy3 !== null ? `<span>최근 3개월 전년 동기 ${changeChip(yoy3, K.upGood)}</span>` : "") +
        `<span>${S.f.backtest ? `시험 오차 ±${fmtPct(S.f.backtest.mape, 0)}` : "시험 오차는 9개월 이상 쌓이면 계산"}</span>`));
      $("fcTiles").innerHTML = `<div class="kpi-row four">${tiles.join("")}</div>`;

      // ---- 차트: 최근 24개월 실적 + 예측
      $("fcChartTitle").textContent = `월별 ${scopeName}${K.label} — 실적과 예측`;
      $("fcChartMeta").textContent = `단위: 원 · ${K.unit}`;
      // 최근 24개월(기록을 시작하기 전 0인 달은 빼고)
      const firstData = S.vals.findIndex(v => v !== 0);
      const showFrom = Math.max(firstData < 0 ? keys.length : firstData, keys.length - 24);
      const histKeys = keys.slice(showFrom);
      const labels = histKeys.concat(rows.map(r => r.key));
      const nh = histKeys.length;
      const actual = labels.map((k, i) => (i < nh ? valOf.get(k) : null));
      const fcLine = labels.map((k, i) => (i === nh - 1 ? valOf.get(k) : i >= nh ? rows[i - nh].mean : null));
      const lo = labels.map((k, i) => (i === nh - 1 ? valOf.get(k) : i >= nh ? rows[i - nh].lo : null));
      const hi = labels.map((k, i) => (i === nh - 1 ? valOf.get(k) : i >= nh ? rows[i - nh].hi : null));
      const lyLine = labels.map((k, i) => (i >= nh ? lyOf(k) : null));
      if (noData) {
        $("fcChart").innerHTML = '<p class="empty-msg">예측할 실적이 아직 없습니다. 매출·지출이 쌓이면 보입니다.</p>';
      } else {
        const series = [{ name: "실적", color, values: actual },
          { name: "예측", color, values: fcLine, dashed: true }];
        if (lyLine.some(v => v !== null)) series.push({ name: "작년 같은 달", color: getCss(kind === "sales" ? "--series-income-ly" : "--ink-3"), values: lyLine });
        WCharts.lines($("fcChart"), labels, series, {
          band: { name: "예상 범위(80%)", color, lo, hi },
          divider: nh < labels.length ? { index: nh, label: "예측" } : null,
          xLabelFn: k => `${k.slice(2, 4)}.${k.slice(5)}`,
          titleFn: (k, i) => `${yearMonthLabel(k)}${i === nh && rows[0] && rows[0].cur ? " (진행 중 · 마감 예상)" : i >= nh ? " (예측)" : ""}`,
          valueFmt: v => fmtWon(v),
          tipExtra: i => (i >= nh ? [{ name: "80% 범위", color, shape: "band", value: rows[i - nh],
            fmt: r => `${man(r.lo)} ~ ${man(r.hi)}` }] : []),
          ariaLabel: `월별 ${K.label} 실적과 예측`,
        });
      }
      const methodText = kind === "profit"
        ? "영업이익 예측 = 매출 예측 − 지출 예측 (범위는 둘의 오차를 합쳐 계산)"
        : `예측 방법: ${S.f.methodLabel} (끝난 ${S.f.n}개월 실적${S.f.method === "seasonal" ? " · 같은 달끼리 평소보다 많고 적은 정도를 반영" : S.f.method === "trend" ? " · 12개월이 쌓이면 계절성도 반영" : ""})` +
          (S.f.backtest ? ` · 지난 ${S.f.backtest.n}개월을 빼고 예측해 보면 평균 오차 ±${fmtPct(S.f.backtest.mape, 0)}` : "");
      $("fcMethod").textContent = noData ? "" : methodText;

      // ---- 예측표
      if (!rows.length) {
        $("fcTable").innerHTML = '<p class="empty-msg">예측할 실적이 아직 없습니다.</p>';
      } else {
        const body = rows.map(r => {
          const ly = lyOf(r.key), t = tgt(r.key);
          return `<tr${r.cur ? ' class="cur-row"' : ""}><td class="date">${yearMonthLabel(r.key)}${r.cur ? ' <span class="tag cur">마감 예상</span>' : ""}</td>` +
            `<td class="num strong">${est(r.mean)}</td>` +
            `<td class="num range">${man(r.lo)} ~ ${man(r.hi)}</td>` +
            `<td class="num">${ly === null ? dash : fmtWon(ly)}</td>` +
            `<td class="num">${ly === null ? dash : changeChip(M.pctChange(r.mean, ly), K.upGood)}</td>` +
            `<td class="num">${t === null ? dash : fmtWon(t)}</td>` +
            `<td class="num">${t === null ? dash : achChip(t ? r.mean / t * 100 : null, K.tk)}</td></tr>`;
        }).join("");
        const tm = sum(rows.map(r => r.mean)), thw = Math.sqrt(sum(rows.map(r => (r.hw || 0) ** 2)));
        const tly = rows.every(r => lyOf(r.key) !== null) ? sum(rows.map(r => lyOf(r.key))) : null;
        const tt = rows.every(r => tgt(r.key) !== null) ? sum(rows.map(r => tgt(r.key))) : null;
        $("fcTable").innerHTML = `<table class="data compact forecast-table"><thead><tr><th>월</th><th class="num">예상</th>` +
          `<th class="num">범위 (80%)</th><th class="num">작년 같은 달</th><th class="num">증감</th>` +
          `<th class="num">${K.tk === "less" ? "예산" : "목표"}</th><th class="num">예상 ${K.tk === "less" ? "집행률" : "달성률"}</th></tr></thead>` +
          `<tbody>${body}<tr class="total-row"><td>합계 · ${rows.length}개월</td><td class="num">${est(tm)}</td>` +
          `<td class="num range">${man(S.nonNeg ? Math.max(0, tm - thw) : tm - thw)} ~ ${man(tm + thw)}</td>` +
          `<td class="num">${tly === null ? dash : fmtWon(tly)}</td><td class="num">${tly === null ? dash : changeChip(M.pctChange(tm, tly), K.upGood)}</td>` +
          `<td class="num">${tt === null ? dash : fmtWon(tt)}</td><td class="num">${tt === null ? dash : achChip(tt ? tm / tt * 100 : null, K.tk)}</td></tr></tbody></table>`;
      }

      // ---- 계절성
      const seasonSrc = kind === "expense" || !d.sales ? d.expense.f : d.sales.f;
      const seasonKind = kind === "expense" ? "지출" : "매출";
      $("fcSeasonTitle").textContent = `계절성 — ${scopeName}${seasonKind}`;
      if (!seasonSrc.seasonal) {
        $("fcSeason").innerHTML = `<p class="empty-msg">계절성은 실적이 12개월 이상 쌓이면 보입니다 (지금 ${seasonSrc.n}개월).</p>`;
        $("fcSeasonNote").textContent = "";
      } else {
        const pct = seasonSrc.seasonal.map(v => Math.round((v - 1) * 1000) / 10);
        const sfmt = v => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(Math.round(v * 10) / 10)}%`;
        WCharts.groupedBars($("fcSeason"), Array.from({ length: 12 }, (_, i) => `${i + 1}월`),
          [{ name: `평소 대비 ${seasonKind}`, color: getCss(kind === "expense" ? "--series-expense" : "--series-income"), values: pct }],
          { valueFmt: sfmt, tickFmt: sfmt, titleFn: l => `${l} — 월평균 대비`, ariaLabel: `${seasonKind} 계절성: 달마다 월평균보다 많고 적은 정도` });
        const order = pct.map((v, i) => [v, i + 1]).sort((a, b) => b[0] - a[0]);
        const top = order.slice(0, 2).map(([v, m]) => `${m}월(${sfmt(v)})`).join(", ");
        const low = order.slice(-2).reverse().map(([v, m]) => `${m}월(${sfmt(v)})`).join(", ");
        $("fcSeasonNote").textContent = `${seasonKind}이 많은 달: ${top} · 적은 달: ${low}` +
          (seasonSrc.n < 24 ? ` · 아직 ${seasonSrc.n}개월치라 잡음이 섞여 있습니다(2년 이상 쌓이면 더 정확).` : "");
      }
    }

    function tileHtml(label, value, color, compareHtml, extra) {
      return `<div class="kpi" style="--kpi-color:${color}"><span class="kpi-label">${label}</span>` +
        `<span class="kpi-value">${value}</span><span class="kpi-compare">${compareHtml || ""}</span>${extra || ""}</div>`;
    }
    /** 목표 막대: 진한 칸 = 오늘까지 실적, 옅은 칸 = 남은 날 예상 */
    function forecastMeter(mtd, est, target, kind, text) {
      if (target === null || target === undefined || target <= 0) return `<div class="meter none"><span class="meter-text">${text}</span></div>`;
      const a = Math.min(100, Math.max(0, mtd / target * 100)), b = Math.min(100, Math.max(0, est / target * 100));
      const over = kind === "less" ? est > target : false;
      return `<div class="meter${over ? " over" : ""}"><div class="meter-track">` +
        `<span class="meter-fill" style="width:${a.toFixed(1)}%"></span>` +
        `<span class="meter-fill est" style="left:${a.toFixed(1)}%;width:${Math.max(0, b - a).toFixed(1)}%"></span></div>` +
        `<span class="meter-text">${text}</span></div>`;
    }

    $("fcKind").addEventListener("click", e => {
      const b = e.target.closest("[data-kind]");
      if (!b || b.disabled || b.dataset.kind === FC.kind) return;
      FC.kind = b.dataset.kind;
      refreshers.forecast();
    });
    $("fcHorizon").addEventListener("change", () => { FC.horizon = +$("fcHorizon").value || 6; refreshers.forecast(); });
    $("fcScope").addEventListener("change", () => { FC.scope = $("fcScope").value; refreshers.forecast(); });

    return {
      /** 다른 화면에서 범위를 정해 넘어온다. table: incomes|expenses, filters: {분류: 값}, label: 선택 상자에 보일 이름 */
      setScope(table, filters, label) {
        const f = {};
        for (const [k, v] of Object.entries(filters || {})) if (v !== undefined && v !== null) f[k] = v;
        FC.pending = Object.keys(f).length ? { value: scopeValue(table, f), label: label || "고른 조건" } : { value: "", label: "" };
        FC.kind = table === "expenses" ? "expense" : "sales";
      },
    };
  };
})();
