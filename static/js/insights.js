/* 추세·예측 · 브랜드·차종·수리 유형 분석 화면.
   app.js가 WellcarInsights(ctx)로 연결한다. 예측과 집계 계산은 metrics.js가 한다. */
(function () {
  "use strict";

  window.WellcarInsights = function install(ctx) {
    const { $, api, esc, fmt, fmtWon, toast, getCss, refreshers, nextReq, isStale,
      metric, metricStrip, saveBlob, todayStr, loadTargets } = ctx;
    const M = window.WellcarMetrics;

    // ---------------------------------------------------------------- 공통 도우미
    const dash = '<span class="muted">–</span>';
    const fmtPct = (v, digits) => (v === null || v === undefined || !isFinite(v) ? "–"
      : `${(Math.round(v * 10 ** (digits ?? 1)) / 10 ** (digits ?? 1)).toLocaleString("ko-KR")}%`);
    const unset = s => (s === "" || s === null || s === undefined ? "(미지정)" : s);
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
    const FC = { kind: "sales", horizon: 6, scope: "" };
    const FC_KIND = {
      sales: { label: "매출", unit: "실매출", color: "--series-income", target: "sales", tk: "more", upGood: true },
      expense: { label: "지출", unit: "지출금액", color: "--series-expense", target: "expense", tk: "less", upGood: false },
      profit: { label: "영업이익", unit: "실매출 − 지출", color: "--series-profit", target: "profit", tk: "more", upGood: true },
    };

    let scopeCache = null;  // 범위 선택(브랜드·수리 유형) 목록: 최근 12개월 실매출 순
    function loadScopeOptions() {
      if (!scopeCache) {
        const t = todayStr(), from = M.addDays(M.addMonths(t, -12), 1);
        scopeCache = Promise.all([aggf("incomes", from, t, "manufacturer"), aggf("incomes", from, t, "category")])
          .catch(e => { scopeCache = null; throw e; });
      }
      return scopeCache;
    }
    function fillScope(byBrand, byCat) {
      const sel = $("fcScope"), prev = sel.value;
      const opts = (rows, dim, label) => {
        const list = rows.filter(r => salesOf(r) > 0 && r[dim]).sort((a, b) => salesOf(b) - salesOf(a)).slice(0, 15);
        return list.length ? `<optgroup label="${label}">` + list.map(r =>
          `<option value="${esc(JSON.stringify([dim, r[dim]]))}">${esc(r[dim])}</option>`).join("") + "</optgroup>" : "";
      };
      sel.innerHTML = '<option value="">전체 (매출·지출·영업이익)</option>' +
        opts(byBrand, "manufacturer", "브랜드 매출만") + opts(byCat, "category", "수리 유형(매출구분) 매출만");
      sel.value = [...sel.options].some(o => o.value === prev) ? prev : "";
      FC.scope = sel.value;
    }

    function syncKindButtons(scoped) {
      document.querySelectorAll("#fcKind [data-kind]").forEach(b => {
        const on = b.dataset.kind === FC.kind;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
        b.disabled = scoped && b.dataset.kind !== "sales";
        b.title = b.disabled ? "브랜드·수리 유형 범위는 매출만 예측합니다" : "";
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
        const [byBrand, byCat] = await loadScopeOptions();
        if (isStale("forecast", req)) return;
        fillScope(byBrand, byCat);
        const scope = FC.scope ? JSON.parse(FC.scope) : null;
        const filters = scope ? { [scope[0]]: scope[1] } : null;
        if (scope) FC.kind = "sales";
        syncKindButtons(!!scope);
        const none = Promise.resolve([]);
        const dayFrom = `${M.addMonthKey(curKey, -6)}-01`;
        const [incM, expM, incD, expD, T] = await Promise.all([
          aggf("incomes", `${firstKey}-01`, today, "month", filters),
          scope ? none : aggf("expenses", `${firstKey}-01`, today, "month"),
          aggf("incomes", dayFrom, today, "date", filters),
          scope ? none : aggf("expenses", dayFrom, today, "date"),
          loadTargets(),
        ]);
        if (isStale("forecast", req)) return;
        const ck = { keys, curKey, today };
        const sales = projectOne(incM, incD, salesOf, ck);
        const expense = scope ? null : projectOne(expM, expD, amountOf, ck);
        renderForecast({ keys, curKey, today, sales, expense, T: scope ? {} : T, scope });
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
      const { keys, curKey, today } = d;
      const kind = FC.kind, K = FC_KIND[kind], H = FC.horizon;
      const color = getCss(K.color);
      const S = seriesFor(kind, d);
      const valOf = new Map(keys.map((k, i) => [k, S.vals[i]]));
      const lyOf = k => (valOf.has(M.addMonthKey(k, -12)) ? valOf.get(M.addMonthKey(k, -12)) : null);
      const T = d.T || {};
      const tgt = k => { const t = T[k]; return t && t[K.target] !== undefined && t[K.target] !== null ? t[K.target] : null; };
      const scopeName = d.scope ? `${d.scope[0] === "manufacturer" ? "브랜드" : "수리 유형"} ‘${d.scope[1]}’ ` : "";
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
      const seasonSrc = kind === "expense" ? d.expense.f : d.sales.f;
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

    // ================================================================ 브랜드·차종·수리 유형
    const MX_PERIODS = [["this-month", "이번 달", "month", 0], ["last-month", "지난 달", "month", -1],
      ["this-quarter", "이번 분기", "quarter", 0], ["last-quarter", "지난 분기", "quarter", -1],
      ["this-year", "올해", "year", 0], ["last-year", "작년", "year", -1], ["last-12m", "최근 12개월", null, 0]];
    const MX = { period: "this-year", scope: "", measure: "sales", compare: "ly", f: {}, data: null };
    $("mxPeriod").innerHTML = MX_PERIODS.map(p => `<option value="${p[0]}">${p[1]}</option>`).join("");
    $("mxPeriod").value = MX.period;
    const MEASURE_LABEL = { sales: "실매출", cnt: "건수", avg: "객단가" };
    const SEP = "\u001f";

    /** 기간·비교 범위: 진행 중인 기간은 오늘까지, 비교도 같은 날짜 수만큼 */
    function mxRanges() {
      const t = todayStr();
      const def = MX_PERIODS.find(p => p[0] === MX.period) || MX_PERIODS[4];
      if (!def[2]) {
        const cur = { from: M.addDays(M.addMonths(t, -12), 1), to: t };
        const cmp = MX.compare === "ly" ? { from: M.addYears(cur.from, -1), to: M.addYears(cur.to, -1) }
          : { from: M.addDays(M.addMonths(cur.from, -12), 0), to: M.addDays(cur.from, -1) };
        return { cur, cmp, label: def[1], endKey: t.slice(0, 7) };
      }
      const p = M.shift(M.periodOf(def[2], t), def[3]);
      const plan = M.comparePlan(p, t);
      const cur = plan.cur || { from: p.start, to: p.end };
      const cmp = MX.compare === "ly" ? plan.lyRange : plan.prevRange;
      return { cur, cmp, label: `${def[1]} (${p.label})`, endKey: cur.to.slice(0, 7) };
    }

    refreshers.mix = async function () {
      const r = mxRanges();
      const trendFrom = `${M.addMonthKey(r.endKey, -11)}-01`;
      const trendTo = r.cur.to;
      const filters = MX.scope ? { income_type: MX.scope } : null;
      const req = nextReq("mix");
      try {
        const [P, C, T1, T2] = await Promise.all([
          aggf("incomes", r.cur.from, r.cur.to, "manufacturer,car_model,category", filters),
          r.cmp ? aggf("incomes", r.cmp.from, r.cmp.to, "manufacturer,car_model,category", filters) : Promise.resolve([]),
          aggf("incomes", trendFrom, trendTo, "month,manufacturer,category", filters),
          aggf("incomes", trendFrom, trendTo, "month,manufacturer,car_model", filters),
        ]);
        if (isStale("mix", req)) return;
        MX.data = { r, P, C, T1, T2, months: M.monthKeys(trendFrom.slice(0, 7), r.endKey) };
        renderMix();
      } catch (err) { toast(err.message, true); }
    };

    const norm = v => (v === null || v === undefined ? "" : String(v));
    /** 조건(MX.f)에 맞는 행. skip에 든 분류 조건은 보지 않는다(자기 목록은 자기 조건으로 좁히지 않음) */
    function match(r, skip) {
      for (const [k, v] of Object.entries(MX.f)) {
        if (skip.includes(k) || !(k in r)) continue;
        if (norm(r[k]) !== v) return false;
      }
      return true;
    }
    function groupRows(rows, keyFn) {
      const m = new Map();
      for (const r of rows) {
        const k = keyFn(r);
        const g = m.get(k) || { key: k, sales: 0, cnt: 0 };
        g.sales += salesOf(r);
        g.cnt += Number(r.cnt) || 0;
        m.set(k, g);
      }
      return m;
    }
    const valueOf = (g, measure) => (!g ? null : measure === "cnt" ? g.cnt : measure === "avg" ? (g.cnt ? g.sales / g.cnt : null) : g.sales);
    const fmtVal = (v, measure) => (v === null || v === undefined ? "–" : measure === "cnt" ? `${fmt(v)}건` : fmtWon(v));

    const LISTS = {
      brand: { el: "mxBrand", meta: "mxBrandMeta", dim: "manufacturer", skip: ["manufacturer", "car_model"],
        key: r => norm(r.manufacturer), name: k => unset(k), trend: "T1" },
      model: { el: "mxModel", meta: "mxModelMeta", dim: "car_model", skip: ["car_model"],
        key: r => norm(r.manufacturer) + SEP + norm(r.car_model),
        name: k => { const [b, c] = k.split(SEP); return c ? `${b && b !== "N/A" ? b + " " : ""}${c}` : `${unset(b)} · 차종 미지정`; }, trend: "T2" },
      category: { el: "mxCategory", meta: "mxCatMeta", dim: "category", skip: ["category"],
        key: r => norm(r.category), name: k => unset(k), trend: "T1" },
    };
    const selectedKey = id => (id === "brand" ? MX.f.manufacturer : id === "category" ? MX.f.category
      : MX.f.car_model !== undefined ? MX.f.manufacturer + SEP + MX.f.car_model : undefined);

    /** 한 목록의 항목들: 값·비중·비교 증감·12개월 추세 */
    function listItems(id) {
      const L = LISTS[id], d = MX.data, measure = MX.measure;
      const cur = groupRows(d.P.filter(r => match(r, L.skip)), L.key);
      const cmp = groupRows(d.C.filter(r => match(r, L.skip)), L.key);
      const trendRows = d[L.trend].filter(r => match(r, L.skip));
      const items = [...cur.values()].map(g => ({ key: g.key, g, v: valueOf(g, measure), c: valueOf(cmp.get(g.key), measure) }))
        .filter(it => it.g.cnt > 0).sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
      const totalSales = sum(items.map(it => it.g.sales)), totalCnt = sum(items.map(it => it.g.cnt));
      // 12개월 추세 (같은 값 기준)
      const byKeyMonth = new Map();
      for (const r of trendRows) {
        const k = L.key(r) + SEP + SEP + r.month;
        const g = byKeyMonth.get(k) || { sales: 0, cnt: 0 };
        g.sales += salesOf(r); g.cnt += Number(r.cnt) || 0;
        byKeyMonth.set(k, g);
      }
      // 차종을 골랐을 때 수리 유형 목록의 추세선은 차종별로 나눌 자료가 없어 그리지 않는다(브랜드 기준이 되어 헷갈림)
      const noSpark = id === "category" && MX.f.car_model !== undefined;
      for (const it of items) it.spark = noSpark ? null : d.months.map(mk => valueOf(byKeyMonth.get(it.key + SEP + SEP + mk) || { sales: 0, cnt: 0 }, measure) || 0);
      return { items, totalSales, totalCnt };
    }

    function rankHtml(id, data) {
      const L = LISTS[id], measure = MX.measure, sel = selectedKey(id);
      const color = getCss("--series-income");
      if (!data.items.length) return '<p class="empty-msg">이 기간·조건의 매출이 없습니다.</p>';
      const top = data.items.slice(0, 10);
      const max = Math.max(...top.map(it => Math.max(it.v || 0, 0)), 1);
      const rows = top.map(it => {
        const share = measure === "avg" ? null : measure === "cnt" ? (data.totalCnt ? it.g.cnt / data.totalCnt * 100 : null)
          : (data.totalSales ? it.g.sales / data.totalSales * 100 : null);
        const on = sel !== undefined && sel === it.key;
        const dim = sel !== undefined && !on;
        const metaParts = [share !== null ? fmtPct(share) : null, `${fmt(it.g.cnt)}건`,
          measure !== "avg" ? `객단가 ${fmtWon(it.g.cnt ? it.g.sales / it.g.cnt : 0)}` : `실매출 ${fmtWon(it.g.sales)}`].filter(Boolean);
        return `<button type="button" class="rank-row${on ? " on" : ""}${dim ? " dim" : ""}" data-list="${id}" data-key="${esc(it.key)}" aria-pressed="${on}">` +
          `<span class="rk-name" title="${esc(L.name(it.key))}">${esc(L.name(it.key))}</span>` +
          `<span class="rk-val">${fmtVal(it.v, measure)}</span>` +
          `<span class="rk-spark">${it.spark ? WCharts.spark(it.spark, color) : ""}</span>` +
          `<span class="rk-bar"><span style="width:${(Math.max(it.v || 0, 0) / max * 100).toFixed(1)}%;background:${color}"></span></span>` +
          `<span class="rk-chg">${it.c === null || it.c === undefined ? '<span class="muted">신규</span>' : changeChip(M.pctChange(it.v, it.c), true)}</span>` +
          `<span class="rk-meta">${metaParts.join(" · ")}</span></button>`;
      }).join("");
      const rest = data.items.length - top.length;
      return rows + (rest > 0 ? `<p class="rank-more">외 ${fmt(rest)}개 · 전체는 엑셀로 받기에서 볼 수 있습니다</p>` : "");
    }

    function renderMix() {
      const d = MX.data, measure = MX.measure, r = d.r;
      // 조건 표시
      const chips = [];
      if (MX.f.manufacturer !== undefined && MX.f.car_model === undefined) chips.push(["brand", `브랜드: ${unset(MX.f.manufacturer)}`]);
      if (MX.f.car_model !== undefined) chips.push(["model", `차종: ${LISTS.model.name(MX.f.manufacturer + SEP + MX.f.car_model)}`]);
      if (MX.f.category !== undefined) chips.push(["category", `수리 유형: ${unset(MX.f.category)}`]);
      $("mxChips").hidden = !chips.length;
      $("mxChips").innerHTML = chips.map(([id, t]) =>
        `<button type="button" class="chip" data-clear="${id}">${esc(t)} <span aria-hidden="true">✕</span><span class="sr-only">조건 지우기</span></button>`).join("") +
        (chips.length > 1 ? '<button type="button" class="chip ghost" data-clear="all">모두 지우기</button>' : "");

      // 요약
      const all = d.P.filter(x => match(x, [])), allC = d.C.filter(x => match(x, []));
      const tot = { sales: sum(all.map(salesOf)), cnt: sum(all.map(x => Number(x.cnt) || 0)) };
      const totC = { sales: sum(allC.map(salesOf)), cnt: sum(allC.map(x => Number(x.cnt) || 0)) };
      const cmpName = MX.compare === "ly" ? "전년 동기" : "전기";
      const lists = { brand: listItems("brand"), model: listItems("model"), category: listItems("category") };
      const leader = (id) => { const it = lists[id].items[0]; return it ? `${esc(LISTS[id].name(it.key))}` : "–"; };
      $("mxSummary").innerHTML = metricStrip(
        metric("기간", esc(r.label), r.cmp ? `${cmpName} ${r.cmp.from} ~ ${r.cmp.to}` : "") +
        metric("실매출", fmtWon(tot.sales), `${cmpName} ${changeChip(M.pctChange(tot.sales, totC.sales), true)}`) +
        metric("건수", `${fmt(tot.cnt)}건`, `${cmpName} ${changeChip(M.pctChange(tot.cnt, totC.cnt), true)}`) +
        metric("객단가", fmtWon(tot.cnt ? tot.sales / tot.cnt : 0),
          `${cmpName} ${changeChip(M.pctChange(tot.cnt ? tot.sales / tot.cnt : null, totC.cnt ? totC.sales / totC.cnt : null), true)}`) +
        metric(`${MEASURE_LABEL[measure]} 1위`, `${leader("brand")} · ${leader("category")}`, `차종 1위 ${leader("model")}`));

      for (const id of ["brand", "model", "category"]) {
        $(LISTS[id].el).innerHTML = rankHtml(id, lists[id]);
        $(LISTS[id].meta).textContent = `${fmt(lists[id].items.length)}개 · ${MEASURE_LABEL[measure]} 순`;
      }
      renderMatrix();
    }

    /** 브랜드 × 수리 유형: 칸 색이 진할수록 값이 큼(한 가지 색의 진하기) */
    function renderMatrix() {
      const d = MX.data, measure = MX.measure;
      const rows = d.P.filter(x => match(x, ["manufacturer", "category"]));
      const cell = groupRows(rows, x => norm(x.manufacturer) + SEP + norm(x.category));
      const byB = groupRows(rows, x => norm(x.manufacturer)), byC = groupRows(rows, x => norm(x.category));
      const order = m => [...m.values()].filter(g => g.cnt > 0).sort((a, b) => (valueOf(b, measure) ?? 0) - (valueOf(a, measure) ?? 0)).map(g => g.key);
      const brands = order(byB).slice(0, 10), cats = order(byC).slice(0, 10);
      if (!brands.length) { $("mxMatrix").innerHTML = '<p class="empty-msg">이 기간·조건의 매출이 없습니다.</p>'; return; }
      const vals = [];
      for (const b of brands) for (const c of cats) { const v = valueOf(cell.get(b + SEP + c), measure); if (v) vals.push(v); }
      const max = Math.max(...vals, 1);
      const selB = MX.f.manufacturer, selC = MX.f.category;
      const head = `<tr><th>브랜드 \\ 수리 유형</th>${cats.map(c => `<th class="num${selC === c ? " sel" : ""}">${esc(unset(c))}</th>`).join("")}<th class="num">합계</th></tr>`;
      const body = brands.map(b => {
        const tds = cats.map(c => {
          const g = cell.get(b + SEP + c), v = valueOf(g, measure);
          if (!v) return `<td class="num heat empty"><span class="muted">·</span></td>`;
          const a = Math.round(12 + 78 * (v / max));
          return `<td class="num heat${a > 55 ? " hot" : ""}${selB === b || selC === c ? " sel" : ""}" style="background:color-mix(in srgb, var(--series-income) ${a}%, var(--surface))" ` +
            `title="${esc(unset(b))} · ${esc(unset(c))}: ${esc(fmtVal(v, measure))} (${fmt(g.cnt)}건)">${measure === "cnt" ? fmt(v) : fmtShort(v)}</td>`;
        }).join("");
        return `<tr${selB === b ? ' class="sel"' : ""}><td class="strong">${esc(unset(b))}</td>${tds}<td class="num strong">${measure === "cnt" ? fmt(valueOf(byB.get(b), measure)) : fmtShort(valueOf(byB.get(b), measure))}</td></tr>`;
      }).join("");
      $("mxMatrix").innerHTML = `<table class="data compact matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
      $("mxMatrixMeta").textContent = `${MEASURE_LABEL[measure]}${measure === "cnt" ? "(건)" : "(만 원)"} · 칸이 진할수록 많음 · 상위 ${brands.length}×${cats.length}`;
    }
    /** 칸 안의 짧은 금액: 만 원 단위 */
    const fmtShort = v => (v === null || v === undefined ? "–" : Math.round(v / 10000).toLocaleString("ko-KR"));

    // 목록 항목을 누르면 그 항목으로 좁혀 본다(다시 누르면 풀림)
    document.querySelector("#view-mix .grid-3").addEventListener("click", e => {
      const b = e.target.closest(".rank-row");
      if (!b) return;
      const id = b.dataset.list, key = b.dataset.key;
      const already = selectedKey(id) === key;
      if (id === "brand") {
        delete MX.f.car_model;
        if (already) delete MX.f.manufacturer; else MX.f.manufacturer = key;
      } else if (id === "category") {
        if (already) delete MX.f.category; else MX.f.category = key;
      } else {
        const [brand, model] = key.split(SEP);
        if (already) { delete MX.f.car_model; delete MX.f.manufacturer; } else { MX.f.manufacturer = brand; MX.f.car_model = model; }
      }
      renderMix();
    });
    $("mxChips").addEventListener("click", e => {
      const b = e.target.closest("[data-clear]");
      if (!b) return;
      const id = b.dataset.clear;
      if (id === "all") MX.f = {};
      else if (id === "brand") { delete MX.f.manufacturer; delete MX.f.car_model; }
      else if (id === "model") { delete MX.f.car_model; delete MX.f.manufacturer; }
      else delete MX.f.category;
      renderMix();
    });
    const segPick = (elId, attr, onPick) => $(elId).addEventListener("click", e => {
      const b = e.target.closest(`[data-${attr}]`);
      if (!b) return;
      document.querySelectorAll(`#${elId} [data-${attr}]`).forEach(x => {
        const on = x === b;
        x.classList.toggle("on", on);
        x.setAttribute("aria-pressed", String(on));
      });
      onPick(b.dataset[attr]);
    });
    segPick("mxScope", "scope", v => { MX.scope = v; refreshers.mix(); });
    segPick("mxMeasure", "measure", v => { MX.measure = v; if (MX.data) renderMix(); });
    $("mxPeriod").addEventListener("change", () => { MX.period = $("mxPeriod").value; refreshers.mix(); });
    $("mxCompare").addEventListener("change", () => { MX.compare = $("mxCompare").value; refreshers.mix(); });

    // 엑셀로 받기: 목록 세 개 + 교차표
    $("mxExport").addEventListener("click", async () => {
      if (!MX.data) { toast("먼저 집계 결과가 있어야 합니다.", true); return; }
      const W = window.WellcarXlsxWriter, S = W.S, d = MX.data;
      const cmpName = MX.compare === "ly" ? "전년 동기" : "전기";
      const scopeName = MX.scope === "서비스제공" ? "수리·서비스" : MX.scope === "상품판매" ? "상품판매" : "전체 매출";
      const cond = [scopeName, ...(MX.f.manufacturer !== undefined ? [`브랜드 ${unset(MX.f.manufacturer)}`] : []),
        ...(MX.f.car_model !== undefined ? [`차종 ${unset(MX.f.car_model)}`] : []), ...(MX.f.category !== undefined ? [`수리 유형 ${unset(MX.f.category)}`] : [])].join(" · ");
      const sheet = (id, title) => {
        const data = listItems(id);
        const rows = [[{ v: `웰카오디오 ${title} 매출 — ${d.r.label}`, s: S.title }],
          [{ v: `${d.r.cur.from} ~ ${d.r.cur.to} · ${cond}${d.r.cmp ? ` · 비교 ${cmpName} ${d.r.cmp.from} ~ ${d.r.cmp.to}` : ""}`, s: S.muted }], [],
          ["항목", "실매출", "건수", "객단가", "실매출 비중", `${cmpName} 실매출`, "실매출 증감률"].map(v => ({ v, s: S.head }))];
        const cmpRows = groupRows(d.C.filter(r => match(r, LISTS[id].skip)), LISTS[id].key);
        for (const it of data.items) {
          const c = cmpRows.get(it.key), ch = c ? M.pctChange(it.g.sales, c.sales) : null;
          rows.push([LISTS[id].name(it.key), { v: Math.round(it.g.sales), s: S.won }, it.g.cnt,
            { v: Math.round(it.g.cnt ? it.g.sales / it.g.cnt : 0), s: S.won },
            data.totalSales ? { v: it.g.sales / data.totalSales, s: S.pct } : null,
            c ? { v: Math.round(c.sales), s: S.won } : null, ch === null ? null : { v: ch / 100, s: S.pct }]);
        }
        rows.push([{ v: "합계", s: S.totalLabel }, { v: Math.round(data.totalSales), s: S.totalNum }, { v: data.totalCnt, s: S.totalNum },
          { v: Math.round(data.totalCnt ? data.totalSales / data.totalCnt : 0), s: S.totalNum }, { v: data.totalSales ? 1 : 0, s: S.totalPct }]);
        return { name: title, widths: [28, 15, 8, 14, 10, 15, 11], freeze: "B5", rows };
      };
      // 교차표 (실매출)
      const mrows = d.P.filter(x => match(x, ["manufacturer", "category"]));
      const cell = groupRows(mrows, x => norm(x.manufacturer) + SEP + norm(x.category));
      const byB = [...groupRows(mrows, x => norm(x.manufacturer)).values()].sort((a, b) => b.sales - a.sales);
      const byC = [...groupRows(mrows, x => norm(x.category)).values()].sort((a, b) => b.sales - a.sales);
      const mx = [[{ v: `브랜드 × 수리 유형 실매출 — ${d.r.label}`, s: S.title }], [{ v: `단위: 원 · ${cond}`, s: S.muted }], [],
        [{ v: "브랜드 \\ 수리 유형", s: S.head }, ...byC.map(c => ({ v: unset(c.key), s: S.head })), { v: "합계", s: S.head }]];
      for (const b of byB) {
        mx.push([unset(b.key), ...byC.map(c => { const g = cell.get(b.key + SEP + c.key); return g ? { v: Math.round(g.sales), s: S.won } : null; }),
          { v: Math.round(b.sales), s: S.totalNum }]);
      }
      const blob = W.build([sheet("brand", "브랜드별"), sheet("model", "차종별"), sheet("category", "수리유형별"),
        { name: "브랜드×수리유형", widths: [18, ...byC.map(() => 13), 14], freeze: "B5", rows: mx }]);
      const name = `웰카오디오_브랜드차종수리_${d.r.cur.from}_${d.r.cur.to}.xlsx`;
      try { toast(`${await saveBlob(name, blob)} 파일을 받았습니다.`); }
      catch (err) { toast(err.message, true); }
    });

    return {};
  };
})();
