/* 경영지표 계산 — 기간(일·주·월·분기·연), 전기·전년 동기 비교, 목표 대비, 분류별 집계.
   화면(app.js)과 데모가 함께 쓰고, 서버의 /api/agg 결과(날짜·분류별 합계)만으로 계산한다.
   DOM을 쓰지 않는 순수 함수라 Node에서도 시험할 수 있다(tests/metrics_test.js). */
(function (root) {
  "use strict";

  const DAY = 86400000;
  const pad2 = n => String(n).padStart(2, "0");
  const WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"];

  // ---------------------------------------------------------------- 날짜 ('YYYY-MM-DD' 문자열, UTC 기준 계산)
  const ymd = s => s.split("-").map(Number);
  const toTime = s => { const [y, m, d] = ymd(s); return Date.UTC(y, m - 1, d); };
  const fromTime = t => {
    const d = new Date(t);
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  };
  const addDays = (s, n) => fromTime(toTime(s) + n * DAY);
  const diffDays = (a, b) => Math.round((toTime(b) - toTime(a)) / DAY);  // b − a
  const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const weekdayIdx = s => (new Date(toTime(s)).getUTCDay() + 6) % 7;      // 0 = 월요일
  function addMonths(s, n) {
    const [y, m, d] = ymd(s);
    const t = y * 12 + (m - 1) + n, ny = Math.floor(t / 12), nm = t % 12 + 1;
    return `${ny}-${pad2(nm)}-${pad2(Math.min(d, daysInMonth(ny, nm)))}`;
  }
  const addYears = (s, n) => addMonths(s, 12 * n);
  const monthEnd = (y, m) => `${y}-${pad2(m)}-${pad2(daysInMonth(y, m))}`;
  const minDate = (a, b) => (a < b ? a : b);
  const maxDate = (a, b) => (a > b ? a : b);

  /** ISO 주차 (월요일 시작, 목요일이 속한 해) */
  function isoWeek(s) {
    const thursday = toTime(s) + (3 - weekdayIdx(s)) * DAY;
    const y = new Date(thursday).getUTCFullYear();
    return { year: y, week: 1 + Math.floor((thursday - Date.UTC(y, 0, 1)) / DAY / 7) };
  }
  const md = s => { const [, m, d] = ymd(s); return `${m}/${d}`; };

  // ---------------------------------------------------------------- 기간
  const UNITS = ["day", "week", "month", "quarter", "year"];
  const UNIT_LABEL = { day: "일별", week: "주별", month: "월별", quarter: "분기별", year: "연도별" };
  const PREV_LABEL = { day: "전일", week: "전주", month: "전월", quarter: "전분기", year: "전년" };

  /** iso 날짜가 속한 기간 {unit, start, end, days, label, range} */
  function periodOf(unit, iso) {
    const [y, m, d] = ymd(iso);
    let start, end, label;
    if (unit === "day") {
      start = end = iso;
      label = `${y}년 ${m}월 ${d}일 (${WEEKDAY_KO[weekdayIdx(iso)]})`;
    } else if (unit === "week") {
      start = addDays(iso, -weekdayIdx(iso));
      end = addDays(start, 6);
      const w = isoWeek(start);
      label = `${w.year}년 ${w.week}주차`;
    } else if (unit === "month") {
      start = `${y}-${pad2(m)}-01`;
      end = monthEnd(y, m);
      label = `${y}년 ${m}월`;
    } else if (unit === "quarter") {
      const q = Math.floor((m - 1) / 3) + 1;
      start = `${y}-${pad2((q - 1) * 3 + 1)}-01`;
      end = monthEnd(y, q * 3);
      label = `${y}년 ${q}분기`;
    } else if (unit === "year") {
      start = `${y}-01-01`;
      end = `${y}-12-31`;
      label = `${y}년`;
    } else {
      throw new Error("알 수 없는 기간 단위: " + unit);
    }
    const range = unit === "day" ? "" : `${md(start)} ~ ${md(end)}`;
    return { unit, start, end, days: diffDays(start, end) + 1, label, range };
  }

  /** n개 기간 뒤(음수면 앞) */
  function shift(p, n) {
    switch (p.unit) {
      case "day": return periodOf("day", addDays(p.start, n));
      case "week": return periodOf("week", addDays(p.start, 7 * n));
      case "month": return periodOf("month", addMonths(p.start, n));
      case "quarter": return periodOf("quarter", addMonths(p.start, 3 * n));
      default: return periodOf("year", addYears(p.start, n));
    }
  }

  /** 전년 동기: 주는 52주(364일) 전 같은 요일 주, 나머지는 1년 전 같은 날짜·달·분기·해 */
  function lastYear(p) {
    return p.unit === "week" ? periodOf("week", addDays(p.start, -364)) : periodOf(p.unit, addYears(p.start, -1));
  }

  /** 오늘 기준 진행 상태. 진행 중이면 오늘까지(경과 일수)로 집계·비교한다 */
  function progress(p, today) {
    if (today < p.start) return { state: "future", to: null, elapsed: 0 };
    if (today > p.end) return { state: "past", to: p.end, elapsed: p.days };
    return { state: "current", to: today, elapsed: diffDays(p.start, today) + 1 };
  }

  /** 기간의 처음 n일 */
  function firstDays(p, n) {
    if (n <= 0) return null;
    return { from: p.start, to: n >= p.days ? p.end : addDays(p.start, n - 1) };
  }

  /**
   * 비교 계획: 이번 기간·전기·전년 동기의 집계 범위.
   * 진행 중인 기간은 비교 기간도 같은 일수만 본다(예: 10월 1~4일 ↔ 9월 1~4일 ↔ 작년 10월 1~4일).
   */
  function comparePlan(p, today) {
    const prog = progress(p, today);
    const prev = shift(p, -1), ly = lastYear(p);
    const cut = q => (prog.state === "current" ? firstDays(q, prog.elapsed) : { from: q.start, to: q.end });
    return {
      period: p, progress: prog, prev, ly,
      cur: prog.state === "future" ? null : { from: p.start, to: prog.to },
      prevRange: prog.state === "future" ? null : cut(prev),
      lyRange: prog.state === "future" ? null : cut(ly),
    };
  }

  // ---------------------------------------------------------------- 집계
  const INC_KEYS = ["cnt", "amount", "vat", "payout", "payout_due", "receivable", "card"];
  const EXP_KEYS = ["cnt", "amount", "payable", "cost"];

  /** 날짜별 합계 행([{date, …}])을 [from, to] 범위로 더한다. 매출은 영업일수(days)도 센다 */
  function sumRange(rows, range, keys) {
    const out = {};
    for (const k of keys) out[k] = 0;
    out.days = 0;
    if (!range) return out;
    for (const r of rows) {
      if (r.date < range.from || r.date > range.to) continue;
      for (const k of keys) out[k] += Number(r[k]) || 0;
      if ((Number(r.cnt) || 0) > 0) out.days++;
    }
    return out;
  }

  const ratio = (a, b) => (b ? a / b * 100 : null);

  /** 매출·지출 합계 → 경영지표. 매출(실매출) = 매출액 − 미지급금(거래처에 줄 돈) */
  function derive(inc, exp) {
    const sales = inc.amount - inc.payout;
    const profit = sales - exp.amount;
    return {
      sales, gross: inc.amount, payout: inc.payout, vat: inc.vat, net: inc.amount - inc.vat,
      card: inc.card, cash: inc.amount - inc.card, cnt: inc.cnt, days: inc.days,
      avg_ticket: inc.cnt ? sales / inc.cnt : null,
      avg_daily: inc.days ? sales / inc.days : null,
      receivable: inc.receivable, payout_due: inc.payout_due,
      expense: exp.amount, cost: exp.cost, payable: exp.payable, exp_cnt: exp.cnt,
      profit,
      margin: ratio(profit, sales),
      cost_ratio: ratio(exp.cost, sales),
      expense_ratio: ratio(exp.amount, sales),
      // 거래일 기준 자금 흐름(추정): 미수·미지급으로 남은 돈은 아직 오가지 않은 것으로 본다
      cash_in: inc.amount - inc.receivable,
      payout_paid: inc.payout - inc.payout_due,
      cash_out: exp.amount - exp.payable,
      net_cash: (inc.amount - inc.receivable) - (inc.payout - inc.payout_due) - (exp.amount - exp.payable),
    };
  }

  /** 날짜별 매출·지출 행에서 범위의 경영지표 */
  function metricsFor(incRows, expRows, range) {
    return derive(sumRange(incRows, range, INC_KEYS), sumRange(expRows, range, EXP_KEYS));
  }

  /** 증감률(%). 기준이 0이거나 없으면 null */
  function pctChange(cur, base) {
    if (cur === null || cur === undefined || base === null || base === undefined || base === 0) return null;
    return (cur - base) / Math.abs(base) * 100;
  }

  // ---------------------------------------------------------------- 목표
  const TARGET_KEYS = ["sales", "profit", "expense"];

  /**
   * [from, to] 범위의 목표. 월 목표를 날짜 수로 나눠(일할) 더한다.
   * 반환 {sales, profit, expense, covered: {키: 목표가 있는 날 수}, days} — 목표가 하나도 없으면 값은 null
   */
  function targetFor(targets, from, to) {
    const out = { sales: null, profit: null, expense: null, covered: { sales: 0, profit: 0, expense: 0 }, days: 0 };
    if (!targets || !from || !to || from > to) return out;
    out.days = diffDays(from, to) + 1;
    let [y, m] = ymd(from);
    for (;;) {
      const key = `${y}-${pad2(m)}`;
      const ms = `${key}-01`;
      if (ms > to) break;
      const t = targets[key];
      if (t) {
        const dim = daysInMonth(y, m);
        const overlap = diffDays(maxDate(from, ms), minDate(to, monthEnd(y, m))) + 1;
        for (const k of TARGET_KEYS) {
          if (t[k] === undefined || t[k] === null) continue;
          out[k] = (out[k] || 0) + t[k] * overlap / dim;
          out.covered[k] += overlap;
        }
      }
      if (++m > 12) { m = 1; y++; }
    }
    return out;
  }

  /** 실적 ÷ 목표(%). 목표가 없거나 0 이하이면 null */
  function achievement(actual, target) {
    if (target === null || target === undefined || target <= 0 || actual === null || actual === undefined) return null;
    return actual / target * 100;
  }

  // ---------------------------------------------------------------- 차트 구간
  /**
   * 기간 안의 차트 구간: 일 → 그날까지 14일, 주·월 → 날짜별, 분기 → 7일씩, 연 → 월별.
   * 전년 동기 구간은 같은 위치(기간 시작으로부터 같은 일수·같은 달)로 맞춘다.
   */
  function buckets(p) {
    const ly = lastYear(p);
    if (p.unit === "year") {
      const [y] = ymd(p.start), [ly0] = ymd(ly.start);
      return Array.from({ length: 12 }, (_, i) => ({
        key: `${y}-${pad2(i + 1)}`, label: `${i + 1}월`,
        from: `${y}-${pad2(i + 1)}-01`, to: monthEnd(y, i + 1),
        ly: { from: `${ly0}-${pad2(i + 1)}-01`, to: monthEnd(ly0, i + 1) },
      }));
    }
    const spans = [];
    if (p.unit === "day") for (let o = -13; o <= 0; o++) spans.push([o, 1]);
    else if (p.unit === "quarter") {
      for (let o = 0; o < p.days; o += 7) spans.push([o, Math.min(7, p.days - o)]);
      // 끝에 남는 3일 이하는 앞 구간에 붙인다(하루짜리 막대가 실적이 적은 것처럼 보이지 않게)
      const tail = spans[spans.length - 1];
      if (spans.length > 1 && tail[1] < 4) { spans.pop(); spans[spans.length - 1][1] += tail[1]; }
    }
    else for (let o = 0; o < p.days; o++) spans.push([o, 1]);
    return spans.map(([o, len]) => {
      const from = addDays(p.start, o), to = addDays(p.start, o + len - 1);
      const lf = addDays(ly.start, o);
      const lyRange = p.unit === "day" || lf <= ly.end
        ? { from: lf, to: p.unit === "day" ? lf : minDate(addDays(lf, len - 1), ly.end) } : null;
      const label = p.unit === "quarter" ? `${md(from)}~` : md(from);
      return { key: from, label, from, to, ly: lyRange };
    });
  }

  // ---------------------------------------------------------------- 분류별 집계 (분석 화면)
  /** 열 묶음 키: 일 → 날짜, 주 → 그 주 월요일, 월 → YYYY-MM, 분기 → YYYY-Qn, 연 → YYYY */
  function colKey(unit, iso) {
    if (!unit || unit === "total") return "합계";
    if (unit === "day") return iso;
    if (unit === "week") return addDays(iso, -weekdayIdx(iso));
    const [y, m] = ymd(iso.length === 7 ? iso + "-01" : iso.length === 4 ? iso + "-01-01" : iso);
    if (unit === "month") return `${y}-${pad2(m)}`;
    if (unit === "quarter") return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
    return String(y);
  }
  function colLabel(unit, key) {
    if (unit === "day") return md(key);
    if (unit === "week") return `${md(key)}주`;
    if (unit === "month") { const [y, m] = key.split("-"); return `${y.slice(2)}.${m}`; }
    if (unit === "quarter") { const [y, q] = key.split("-Q"); return `${y.slice(2)}년 ${q}분기`; }
    if (unit === "year") return `${key}년`;
    return key;
  }

  /** 열 단위에 맞춰 서버에 요청할 시간 묶음 */
  const timeGroupFor = unit => (unit === "day" || unit === "week" ? "date"
    : unit === "month" || unit === "quarter" ? "month" : unit === "year" ? "year" : null);

  /** 범위 안의 모든 열 키 (빈 열도 보이도록) */
  function colKeys(unit, from, to) {
    if (!unit || unit === "total") return ["합계"];
    const keys = [];
    let cur = from;
    let guard = 0;
    while (cur <= to && guard++ < 5000) {
      const k = colKey(unit, cur);
      if (keys[keys.length - 1] !== k) keys.push(k);
      if (unit === "day" || unit === "week") cur = addDays(cur, unit === "day" ? 1 : 7 - weekdayIdx(cur));
      else if (unit === "month") cur = addMonths(cur.slice(0, 8) + "01", 1);
      else if (unit === "quarter") cur = addMonths(cur.slice(0, 8) + "01", 3 - (ymd(cur)[1] - 1) % 3);
      else cur = `${ymd(cur)[0] + 1}-01-01`;
    }
    return keys;
  }

  /**
   * 분류(1~2단계) × 열 피벗.
   * rows: /api/agg 결과 행, opts: {time: 'date'|'month'|'year'|null, unit, dims: [d1, d2?], keys: [합산할 측정값]}
   * 반환: {groups: [{name, sums, cells: {열: sums}, children: [...]}], total: sums, colTotals: {열: sums}}
   * sums는 keys의 합계 객체. 정렬·표시값 계산은 화면에서 한다.
   */
  function pivot(rows, opts) {
    const { time, unit, dims, keys } = opts;
    const zero = () => { const o = {}; for (const k of keys) o[k] = 0; return o; };
    const add = (acc, r) => { for (const k of keys) acc[k] += Number(r[k]) || 0; };
    const groups = new Map(), colTotals = {}, total = zero();
    for (const r of rows) {
      const ck = time ? colKey(unit, String(r[time])) : "합계";
      const name1 = String(r[dims[0]] ?? "");
      let g = groups.get(name1);
      if (!g) { g = { name: name1, sums: zero(), cells: {}, children: dims[1] ? new Map() : null }; groups.set(name1, g); }
      add(g.sums, r);
      add(g.cells[ck] || (g.cells[ck] = zero()), r);
      if (dims[1]) {
        const name2 = String(r[dims[1]] ?? "");
        let c = g.children.get(name2);
        if (!c) { c = { name: name2, sums: zero(), cells: {} }; g.children.set(name2, c); }
        add(c.sums, r);
        add(c.cells[ck] || (c.cells[ck] = zero()), r);
      }
      add(total, r);
      add(colTotals[ck] || (colTotals[ck] = zero()), r);
    }
    const list = [...groups.values()].map(g => Object.assign(g, { children: g.children ? [...g.children.values()] : [] }));
    return { groups: list, total, colTotals };
  }

  /** 분석 화면의 비교 범위: 'prev'(직전 같은 길이 또는 직전 달·분기·해), 'ly'(1년 전 같은 날짜) */
  function compareRange(from, to, mode, calendarUnit) {
    if (mode === "ly") return { from: addYears(from, -1), to: addYears(to, -1) };
    if (mode !== "prev") return null;
    if (calendarUnit === "month" || calendarUnit === "quarter" || calendarUnit === "year") {
      const n = calendarUnit === "month" ? 1 : calendarUnit === "quarter" ? 3 : 12;
      const start = addMonths(from, -n);
      const [y, m] = ymd(addMonths(to.slice(0, 8) + "01", -n));
      return { from: start, to: monthEnd(y, m) };
    }
    const len = diffDays(from, to) + 1;
    return { from: addDays(from, -len), to: addDays(from, -1) };
  }

  // ---------------------------------------------------------------- 추세·예측
  /*
   * 끝난 달들의 월별 값으로 앞으로의 달을 예상한다. 쌓인 기간에 따라 방법을 고른다.
   *   12개월 이상: 추세(직선) × 계절 지수 — 같은 달끼리의 (값 ÷ 추세) 평균, 관측이 적으면 1 쪽으로 줄여 잡음을 덜어 냄
   *   3~11개월   : 추세(직선)만 — 계절성은 1년치가 없어 알 수 없음
   *   1~2개월    : 평균
   * 추세는 멀리 갈수록 조금씩 누그러뜨린다(감쇠 0.95/월). 범위는 80% 예측 구간(회귀 잔차 기준, 최소 ±4%).
   */
  const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
  const Z80 = 1.2816;
  const SEASON_SHRINK = 0.5;   // 계절 지수: 관측 n개면 (지수 − 1) × n/(n + 0.5)
  const DAMP = 0.95;           // 추세 감쇠
  const TREND_WINDOW = 36;     // 추세는 최근 36개월로 맞춘다

  /** 'YYYY-MM' 더하기 */
  function addMonthKey(key, n) {
    const [y, m] = key.split("-").map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad2(t % 12 + 1)}`;
  }
  function monthKeys(fromKey, toKey) {
    const out = [];
    for (let k = fromKey; k <= toKey && out.length < 1200; k = addMonthKey(k, 1)) out.push(k);
    return out;
  }

  /** 최소제곱 직선 y = a + b·x */
  function ols(xs, ys) {
    const n = xs.length, mx = mean(xs), my = mean(ys);
    let sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
    const b = sxx ? sxy / sxx : 0, a = my - b * mx;
    let sse = 0;
    for (let i = 0; i < n; i++) sse += (ys[i] - a - b * xs[i]) ** 2;
    return { a, b, n, mx, sxx, sigma: n > 2 ? Math.sqrt(sse / (n - 2)) : null };
  }

  /** 모형 맞추기 (내부용). ys: 0이 아닌 달부터, fm: ys[0]의 달(1~12) */
  function fitModel(ys, fm) {
    const n = ys.length;
    const monthOf = i => ((fm - 1 + i) % 12) + 1;
    const nonneg = ys.every(v => v >= 0);
    const S = Array(13).fill(1);
    const w0 = Math.max(0, n - TREND_WINDOW);
    const xs = ys.map((_, i) => i).slice(w0);
    const trendOn = vals => ols(xs, vals.slice(w0));
    if (n < 3) {
      const avg = mean(ys);
      const sd = n > 1 ? Math.sqrt(ys.reduce((a, v) => a + (v - avg) ** 2, 0) / (n - 1)) : 0;
      return { method: "average", a: avg, b: 0, n, mx: 0, sxx: 0, sigma: Math.max(sd, Math.abs(avg) * 0.2), S: null, monthOf };
    }
    let fit = trendOn(ys);
    const seasonal = n >= 12 && nonneg && mean(ys) > 0;
    if (seasonal) {
      for (let iter = 0; iter < 5; iter++) {
        const sum = Array(13).fill(0), cnt = Array(13).fill(0);
        ys.forEach((v, i) => {
          const tr = fit.a + fit.b * i;
          if (tr > 0) { sum[monthOf(i)] += v / tr; cnt[monthOf(i)]++; }
        });
        for (let m = 1; m <= 12; m++) {
          const raw = cnt[m] ? sum[m] / cnt[m] : 1;
          S[m] = 1 + (raw - 1) * (cnt[m] / (cnt[m] + SEASON_SHRINK));
        }
        const avgS = mean(S.slice(1));
        for (let m = 1; m <= 12; m++) S[m] /= avgS;
        fit = trendOn(ys.map((v, i) => v / S[monthOf(i)]));
      }
    }
    return Object.assign(fit, { method: seasonal ? "seasonal" : "trend", S: seasonal ? S.slice() : null, monthOf });
  }

  /** 맞춘 모형으로 마지막 달 다음 h개월 (감쇠 추세) */
  function projectModel(model, ys, horizon, sigmaFloor) {
    const n = ys.length, last = n - 1;
    const level = model.a + model.b * last;
    const sigma = Math.max(model.sigma || 0, sigmaFloor || 0);
    const out = [];
    let damp = 0;
    for (let h = 1; h <= horizon; h++) {
      damp += DAMP ** h;
      const t = last + damp;  // 감쇠한 시점
      const s = model.S ? model.S[model.monthOf(last + h)] : 1;
      const mid = (model.method === "average" ? model.a : model.a + model.b * t) * s;
      const spread = model.sxx ? Math.sqrt(1 + 1 / model.n + (t - model.mx) ** 2 / model.sxx) : Math.sqrt(1 + h / 6);
      const hw = Z80 * sigma * spread * s;
      out.push({ h, mean: mid, hw });
    }
    return { level, sigma, points: out };
  }

  /**
   * 월별 예측. values: 끝난 달의 값(오래된 순), firstMonth: values[0]의 달(1~12).
   * opts: {horizon (기본 6), nonNegative (기본 true), backtest (기본 true)}
   * 반환: {method, methodLabel, n, forecast: [{h, mean, lo, hi, hw}], seasonal: [12개 지수]|null,
   *        slopePct(월 추세 %), level, backtest: {mape, n}|null}
   */
  function forecastSeries(values, firstMonth, opts) {
    opts = opts || {};
    const horizon = opts.horizon || 6;
    const nonNeg = opts.nonNegative !== false;
    let start = 0;
    while (start < values.length && !values[start]) start++;  // 기록을 시작하기 전(0인 달)은 뺀다
    const ys = values.slice(start).map(Number);
    const fm = ((firstMonth - 1 + start) % 12) + 1;
    const n = ys.length;
    const LABEL = { seasonal: "추세 + 계절성", trend: "추세", average: "평균", none: "자료 없음" };
    if (!n) return { method: "none", methodLabel: LABEL.none, n: 0, forecast: [], seasonal: null, slopePct: null, level: 0, backtest: null };
    const model = fitModel(ys, fm);
    // 지난 h개월을 빼고 맞춘 모형이 그 h개월을 얼마나 맞혔는지 (평균 절대 백분율 오차)
    let bt = null;
    const hb = Math.min(6, n - 6);
    if (opts.backtest !== false && hb >= 3) {
      const train = ys.slice(0, n - hb);
      const tm = fitModel(train, fm);
      const pr = projectModel(tm, train, hb, 0).points;
      const apes = [], errs = [];
      for (let i = 0; i < hb; i++) {
        const actual = ys[n - hb + i];
        const pred = nonNeg ? Math.max(0, pr[i].mean) : pr[i].mean;
        errs.push(pred - actual);
        if (actual > 0) apes.push(Math.abs(pred - actual) / actual);
      }
      if (apes.length) bt = { mape: mean(apes) * 100, n: apes.length, rmse: Math.sqrt(mean(errs.map(e => e * e))) };
    }
    const levelNow = Math.abs(model.a + model.b * (n - 1));
    const floor = Math.max(levelNow * 0.04, bt ? bt.rmse * 0.6 : 0);
    const proj = projectModel(model, ys, horizon, floor);
    const forecast = proj.points.map(p => {
      const mid = nonNeg ? Math.max(0, p.mean) : p.mean;
      return { h: p.h, mean: mid, hw: p.hw, lo: nonNeg ? Math.max(0, mid - p.hw) : mid - p.hw, hi: mid + p.hw };
    });
    return {
      method: model.method, methodLabel: LABEL[model.method], n, start,
      forecast,
      seasonal: model.S ? model.S.slice(1) : null,
      slopePct: model.method !== "average" && proj.level > 0 ? model.b / proj.level * 100 : null,
      level: proj.level, sigma: proj.sigma, backtest: bt,
    };
  }

  /** 두 예측의 차(영업이익 = 매출 − 지출). 범위는 서로 독립이라 보고 합친다 */
  function diffForecast(fa, fb) {
    return fa.map((p, i) => {
      const q = fb[i] || { mean: 0, hw: 0 };
      const mid = p.mean - q.mean, hw = Math.sqrt(p.hw ** 2 + q.hw ** 2);
      return { h: p.h, mean: mid, hw, lo: mid - hw, hi: mid + hw };
    });
  }

  /**
   * 진행 중인 달의 마감 예상 = 오늘까지 실적 + 남은 기간의 평소 몫.
   * 평소 몫: 지난 달들에서 같은 시점(달 길이 비율)까지 쌓인 비율(p)로 남은 비율(1 − p)을 정하고,
   *          그달 예측값(monthMean)에 곱한다. 예측값이 없으면 지금 속도(실적 ÷ p)로 본다.
   * opts: {mtd, today, history: [[일별 값...], ...] (지난 달들), monthMean, monthHw}
   */
  function monthLanding(opts) {
    const { mtd, today } = opts;
    const [y, m, d] = ymd(today);
    const D = daysInMonth(y, m);
    const shares = [];
    for (const days of opts.history || []) {
      const total = days.reduce((a, v) => a + (Number(v) || 0), 0);
      if (!(total > 0)) continue;
      const upto = Math.min(days.length, Math.max(1, Math.round(d * days.length / D)));
      let cum = 0;
      for (let i = 0; i < upto; i++) cum += Number(days[i]) || 0;
      shares.push(cum / total);
    }
    let p = shares.length >= 2 ? mean(shares) : d / D;
    p = d >= D ? 1 : Math.min(0.98, Math.max(0.02, p));
    const pace = mtd > 0 && p >= 0.1 ? mtd / p : null;
    const hasModel = opts.monthMean !== null && opts.monthMean !== undefined;
    let est;
    if (hasModel) est = mtd + (1 - p) * Math.max(0, opts.monthMean);
    else est = pace !== null ? pace : null;
    if (est === null) return { mean: null, lo: null, hi: null, share: p, pace, mtd, day: d, days: D };
    est = Math.max(est, mtd);
    const hw = hasModel && opts.monthHw ? opts.monthHw * (1 - p) : est * 0.15 * (1 - p);
    return { mean: est, hw, lo: Math.max(mtd, est - hw), hi: est + hw, share: p, pace, mtd, day: d, days: D };
  }

  // ---------------------------------------------------------------- 기간별·요일별 보기 (매출 분석·지출 분석·경영현황)
  /** 표·툴팁용 기간 이름. start는 그 달력 기간의 첫날 */
  function periodName(unit, start) {
    const [y, m, d] = ymd(start);
    if (unit === "day") return `${m}/${d} (${WEEKDAY_KO[weekdayIdx(start)]})`;
    if (unit === "week") return `${isoWeek(start).week}주 (${md(start)}~${md(addDays(start, 6))})`;
    if (unit === "month") return `${y}년 ${m}월`;
    if (unit === "quarter") return `${y}년 ${Math.floor((m - 1) / 3) + 1}분기`;
    return `${y}년`;
  }
  /** 차트 눈금용 짧은 이름 */
  function periodTick(unit, start) {
    const [y, m] = ymd(start);
    if (unit === "day") return md(start);
    if (unit === "week") return `${md(start)}~`;
    if (unit === "month") return `${String(y).slice(2)}.${pad2(m)}`;
    if (unit === "quarter") return `${String(y).slice(2)}.${Math.floor((m - 1) / 3) + 1}Q`;
    return String(y);
  }

  /**
   * [from, to]를 단위별 구간으로 나눈다. 구간은 범위 안으로 잘린다(첫·끝 구간은 일부일 수 있음).
   * 반환 [{key, name, tick, from, to, start, end, full}] — start·end는 그 달력 기간 전체, full은 잘리지 않았는지
   */
  function periodsIn(unit, from, to) {
    const out = [];
    let cur = from, guard = 0;
    while (cur <= to && guard++ < 5000) {
      const p = periodOf(unit, cur);
      const b = {
        key: colKey(unit, p.start), name: periodName(unit, p.start), tick: periodTick(unit, p.start),
        from: maxDate(p.start, from), to: minDate(p.end, to), start: p.start, end: p.end,
      };
      b.full = b.from === p.start && b.to === p.end;
      out.push(b);
      cur = addDays(p.end, 1);
    }
    return out;
  }

  /** 구간의 전년 동기 범위: 주는 52주(364일) 전 같은 요일, 온전한 구간은 1년 전 그 기간 전체, 잘린 구간은 1년 전 같은 날짜 */
  function lyRangeOf(unit, b) {
    if (unit === "week") return { from: addDays(b.from, -364), to: addDays(b.to, -364) };
    if (b.full) { const p = lastYear(periodOf(unit, b.start)); return { from: p.start, to: p.end }; }
    return { from: addYears(b.from, -1), to: addYears(b.to, -1) };
  }

  /** 구간의 전기 범위: 온전한 구간은 바로 앞 기간 전체, 잘린 구간(진행 중 등)은 앞 기간의 같은 위치(같은 일수) */
  function prevRangeOf(unit, b) {
    const p = periodOf(unit, b.start), q = shift(p, -1);
    if (b.full) return { from: q.start, to: q.end };
    const from = addDays(q.start, diffDays(p.start, b.from));
    if (from > q.end) return null;
    return { from, to: minDate(addDays(q.start, diffDays(p.start, b.to)), q.end) };
  }

  /**
   * 날짜별 합계 색인. rows: 날짜(date)가 있는 집계 행, keys: 더할 측정값, pred: 행을 고르는 조건(없으면 전부),
   * coverage: 자료를 받아 둔 범위 {from, to}.
   * sum(range) → {키: 합계, days: 건수(cnt)가 있는 날 수}. 받아 두지 않은 날짜(coverage.from 이전)가 걸리면 null.
   */
  function dateIndex(rows, keys, pred, coverage) {
    const dates = new Map();
    for (const r of rows) {
      if (pred && !pred(r)) continue;
      let acc = dates.get(r.date);
      if (!acc) { acc = {}; for (const k of keys) acc[k] = 0; dates.set(r.date, acc); }
      for (const k of keys) acc[k] += Number(r[k]) || 0;
    }
    const sorted = [...dates.keys()].sort();
    function sum(range) {
      if (!range || (coverage && range.from < coverage.from)) return null;
      const out = { days: 0 };
      for (const k of keys) out[k] = 0;
      for (const d of sorted) {
        if (d < range.from) continue;
        if (d > range.to) break;
        const acc = dates.get(d);
        for (const k of keys) out[k] += acc[k];
        if (acc.cnt === undefined ? true : acc.cnt > 0) out.days++;
      }
      return out;
    }
    return { dates, sorted, sum, coverage: coverage || null };
  }

  /**
   * 요일별 합계 (월~일). idx: dateIndex, range: {from, to}
   * 반환 [{i, name, dates(범위 안 그 요일의 날짜 수), days(값이 있는 날 수), ...합계}] — 색인 범위 밖이면 null
   */
  function byWeekday(idx, range, keys) {
    if (!range || (idx.coverage && range.from < idx.coverage.from)) return null;
    const n = diffDays(range.from, range.to) + 1, startW = weekdayIdx(range.from);
    const out = WEEKDAY_KO.map((name, i) => {
      const o = { i, name, dates: Math.floor(n / 7) + (((i - startW + 7) % 7) < n % 7 ? 1 : 0), days: 0 };
      for (const k of keys) o[k] = 0;
      return o;
    });
    for (const d of idx.sorted) {
      if (d < range.from) continue;
      if (d > range.to) break;
      const acc = idx.dates.get(d), o = out[weekdayIdx(d)];
      for (const k of keys) o[k] += acc[k];
      if (acc.cnt === undefined ? true : acc.cnt > 0) o.days++;
    }
    return out;
  }

  /**
   * 요일별 수준: 하루 평균(값 ÷ 그 요일 날짜 수)을 영업하는 요일들의 평균과 견준다.
   * level: closed(범위 안에 실적이 하루도 없음 — 휴무로 봄) / slow(평균의 80% 미만) / busy(120% 초과) / normal
   */
  function weekdayLevels(wd, valueFn) {
    const per = wd.map(w => (w.dates ? valueFn(w) / w.dates : 0));
    const open = wd.map((w, i) => (w.days > 0 ? per[i] : null)).filter(v => v !== null);
    const base = open.length ? mean(open) : 0;
    return wd.map((w, i) => {
      const ratio = base > 0 ? per[i] / base : null;
      const level = w.days === 0 ? "closed" : ratio === null ? "normal" : ratio < 0.8 ? "slow" : ratio > 1.2 ? "busy" : "normal";
      return { i, name: w.name, perDate: per[i], ratio, level };
    });
  }

  /** 이동 평균: 각 위치에서 자기까지 최근 n개의 평균 (n개가 안 되거나 빈 값이 끼면 null) */
  function movingAvg(values, n) {
    return values.map((_, i) => {
      if (i < n - 1) return null;
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) {
        if (values[j] === null || values[j] === undefined) return null;
        s += values[j];
      }
      return s / n;
    });
  }

  /**
   * 추세 요약. values: 온전한 구간의 값(오래된 순), k: 견줄 묶음 크기(최근 k개 평균 vs 그 앞 k개 평균).
   * 반환 {n, k, recent, prior, changePct, slopePct(구간마다 평균의 몇 %씩 — 직선 기울기), dir: up|down|flat|null(자료 부족)}
   */
  function trendSummary(values, k) {
    const vals = values.filter(v => v !== null && v !== undefined);
    const n = vals.length;
    k = Math.max(1, Math.min(k || 3, Math.floor(n / 2)));
    if (n < 4) return { n, k, recent: null, prior: null, changePct: null, slopePct: null, dir: null };
    const recent = mean(vals.slice(n - k)), prior = mean(vals.slice(n - 2 * k, n - k));
    const fit = ols(vals.map((_, i) => i), vals), avg = mean(vals);
    const changePct = pctChange(recent, prior);
    const slopePct = avg ? fit.b / Math.abs(avg) * 100 : null;
    const dir = changePct === null ? null : changePct >= 5 ? "up" : changePct <= -5 ? "down" : "flat";
    return { n, k, recent, prior, changePct, slopePct, dir };
  }

  // ---------------------------------------------------------------- 분류별 실적·마케팅 추천
  /**
   * 분류별 실적 비교. cur·cmp: Map(키 → {sales, cnt, sq?}) — sq는 건별 실매출의 제곱합(있으면 변화가 우연인지 가려낸다).
   * 반환 {total, cmpTotal: {sales, cnt, avg}, even(분류 수로 고르게 나눈 비중 %), segs: [...]} — 실매출 큰 순.
   * seg: {key, sales, cnt, avg, share, cntShare, cmpSales, cmpCnt, cmpShare, growth, cntGrowth, sq, cmpSq}
   */
  function segmentStats(cur, cmp) {
    cmp = cmp || new Map();
    const tot = m => { let sales = 0, cnt = 0; for (const v of m.values()) { sales += v.sales; cnt += v.cnt; } return { sales, cnt, avg: cnt ? sales / cnt : null }; };
    const total = tot(cur), cmpTotal = tot(cmp);
    const hasSq = [...cur.values(), ...cmp.values()].some(v => v.sq !== undefined);
    const keys = new Set([...cur.keys(), ...cmp.keys()]);
    const segs = [...keys].map(key => {
      const a = cur.get(key) || { sales: 0, cnt: 0 }, b = cmp.get(key) || { sales: 0, cnt: 0 };
      return {
        key, sales: a.sales, cnt: a.cnt, avg: a.cnt ? a.sales / a.cnt : null,
        share: total.sales ? a.sales / total.sales * 100 : 0, cntShare: total.cnt ? a.cnt / total.cnt * 100 : 0,
        cmpSales: b.sales, cmpCnt: b.cnt, cmpShare: cmpTotal.sales ? b.sales / cmpTotal.sales * 100 : 0,
        growth: pctChange(a.sales, b.sales), cntGrowth: pctChange(a.cnt, b.cnt),
        sq: hasSq ? a.sq || 0 : undefined, cmpSq: hasSq ? b.sq || 0 : undefined,
      };
    }).sort((x, y) => y.sales - x.sales || y.cmpSales - x.cmpSales);
    const active = segs.filter(s => s.cnt > 0).length;
    return { total, cmpTotal, even: active ? 100 / active : 0, segs };
  }

  /** 마케팅 추천 기준 (화면의 '추천 기준'에 그대로 보여 준다) */
  const REC = { minCnt: 5, up: 10, down: -10, rising: 30, ticket: 1.15, minGain: 3, z: 2, dormantDays: 60, dormantMinCnt: 2 };

  /**
   * 분류별 실적에 추천 꼬리표를 붙인다(한 분류에 하나).
   *   grow    키우기      — 비중이 평균 이상이고 비교 기간보다 10% 이상 늘어난 곳
   *   recover 되살리기    — 비중이 평균 이상(지금 또는 비교 기간)인데 10% 이상 줄어든 곳
   *   volume  건수 늘리기 — 객단가가 전체보다 15% 이상 높은데 건수 비중은 평균 미만인 곳
   *   rising  떠오르는 곳 — 비중은 아직 작지만 30% 이상 늘었거나 새로 생긴 곳(건수 3건 이상 증가)
   * 표본이 적으면(건수 5건 미만) 추천하지 않는다. impact는 같은 꼬리표 안의 정렬용(늘거나 준 금액 등).
   *
   * 건별 금액의 제곱합(sq)이 있으면 우연한 변동은 걸러 낸다. 한 건 금액이 들쭉날쭉한 장사에서는 큰 일 한두 건만 겹쳐도
   * 실매출이 크게 달라지므로, 두 기간의 차이를 그 흩어짐(√(두 기간 제곱합))으로 나눈 값 z가 기준(2) 이상일 때만 변화로 본다.
   * 건수 늘리기는 객단가 차이를 같은 방식(분류 안 건별 금액의 표준오차)으로 본다. z는 결과에 함께 넣는다(없으면 null).
   */
  function recommendSegments(stats, opts) {
    const o = Object.assign({}, REC, opts || {});
    const { total, even } = stats;
    return stats.segs.map(s => {
      const enough = s.cnt >= o.minCnt, hadEnough = s.cmpCnt >= o.minCnt;
      const big = s.share >= even, wasBig = s.cmpShare >= even;
      const known = s.sq !== undefined && s.cmpSq !== undefined;
      const z = !known ? null : s.sq + s.cmpSq > 0 ? (s.sales - s.cmpSales) / Math.sqrt(s.sq + s.cmpSq) : 0;
      const real = z === null || Math.abs(z) >= o.z;   // 변화가 우연이라 보기 어려운가
      let ticketZ = null;
      if (s.sq !== undefined && s.cnt > 1 && total.avg !== null) {
        const se = Math.sqrt(Math.max(0, s.sq / s.cnt - s.avg * s.avg) / s.cnt);
        ticketZ = se > 0 ? (s.avg - total.avg) / se : (s.avg > total.avg ? Infinity : 0);
      }
      let tag = null, impact = 0;
      if (enough && hadEnough && big && s.growth !== null && s.growth >= o.up && real) {
        tag = "grow"; impact = s.sales - s.cmpSales;
      } else if (hadEnough && (big || wasBig) && s.growth !== null && s.growth <= o.down && real) {
        tag = "recover"; impact = s.cmpSales - s.sales;
      } else if (enough && total.avg && s.avg >= total.avg * o.ticket && s.cntShare < even && (ticketZ === null || ticketZ >= o.z)) {
        tag = "volume"; impact = (s.avg - total.avg) * s.cnt;
      } else if (enough && !big && s.cnt - s.cmpCnt >= o.minGain && real &&
          (s.cmpSales === 0 || (s.growth !== null && s.growth >= o.rising))) {
        tag = "rising"; impact = s.sales - s.cmpSales;
      }
      return Object.assign({}, s, { tag, impact, big, z });
    });
  }

  /**
   * 휴면 거래처: 거래가 있었는데(minCnt건 이상) 마지막 거래 뒤 days일 넘게 소식이 없는 곳. 실매출 큰 순.
   * rows: [{key, sales, cnt, last}] (긴 기간의 거래처별 합계와 마지막 거래일)
   */
  function dormantClients(rows, today, opts) {
    const o = Object.assign({}, REC, opts || {});
    const skip = new Set(o.exclude || []);
    return rows.filter(r => r.last && !skip.has(r.key) && r.cnt >= o.dormantMinCnt && diffDays(r.last, today) >= o.dormantDays)
      .map(r => Object.assign({}, r, { idle: diffDays(r.last, today) }))
      .sort((a, b) => b.sales - a.sales);
  }

  const api = {
    UNITS, UNIT_LABEL, PREV_LABEL, WEEKDAY_KO,
    addDays, addMonths, addYears, diffDays, daysInMonth, weekdayIdx, isoWeek, md,
    periodOf, shift, lastYear, progress, firstDays, comparePlan,
    INC_KEYS, EXP_KEYS, sumRange, derive, metricsFor, pctChange,
    targetFor, achievement, buckets,
    colKey, colLabel, colKeys, timeGroupFor, pivot, compareRange,
    addMonthKey, monthKeys, ols, forecastSeries, diffForecast, monthLanding,
    periodName, periodTick, periodsIn, lyRangeOf, prevRangeOf, dateIndex, byWeekday, weekdayLevels,
    movingAvg, trendSummary, segmentStats, recommendSegments, dormantClients, REC,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WellcarMetrics = api;
})(typeof window !== "undefined" ? window : this);
