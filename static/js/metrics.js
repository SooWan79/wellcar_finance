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

  const api = {
    UNITS, UNIT_LABEL, PREV_LABEL, WEEKDAY_KO,
    addDays, addMonths, addYears, diffDays, daysInMonth, weekdayIdx, isoWeek, md,
    periodOf, shift, lastYear, progress, firstDays, comparePlan,
    INC_KEYS, EXP_KEYS, sumRange, derive, metricsFor, pctChange,
    targetFor, achievement, buckets,
    colKey, colLabel, colKeys, timeGroupFor, pivot, compareRange,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WellcarMetrics = api;
})(typeof window !== "undefined" ? window : this);
