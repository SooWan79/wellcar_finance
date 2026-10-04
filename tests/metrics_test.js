/* static/js/metrics.js 단위 테스트 (브라우저 없이 Node로 실행)
     node tests/metrics_test.js */
const assert = require("assert");
const M = require("../static/js/metrics.js");

let n = 0;
function test(name, fn) {
  try { fn(); n++; } catch (e) { console.error("✗ " + name); throw e; }
}

test("기간: 일·주·월·분기·연", () => {
  assert.deepStrictEqual(
    (({ start, end, days, label }) => ({ start, end, days, label }))(M.periodOf("day", "2026-10-04")),
    { start: "2026-10-04", end: "2026-10-04", days: 1, label: "2026년 10월 4일 (일)" });
  const w = M.periodOf("week", "2026-10-04");  // 일요일 → 그 주 월요일부터
  assert.strictEqual(w.start, "2026-09-28");
  assert.strictEqual(w.end, "2026-10-04");
  assert.strictEqual(w.label, "2026년 40주차");
  assert.strictEqual(M.periodOf("week", "2027-01-01").label, "2026년 53주차");  // 해를 넘는 ISO 주
  const m = M.periodOf("month", "2024-02-10");
  assert.deepStrictEqual([m.start, m.end, m.days], ["2024-02-01", "2024-02-29", 29]);
  const q = M.periodOf("quarter", "2026-11-15");
  assert.deepStrictEqual([q.start, q.end, q.days, q.label], ["2026-10-01", "2026-12-31", 92, "2026년 4분기"]);
  const y = M.periodOf("year", "2026-06-01");
  assert.deepStrictEqual([y.start, y.end, y.days], ["2026-01-01", "2026-12-31", 365]);
});

test("이전·다음 기간과 전년 동기", () => {
  assert.strictEqual(M.shift(M.periodOf("month", "2026-01-15"), -1).start, "2025-12-01");
  assert.strictEqual(M.shift(M.periodOf("month", "2026-03-31"), -1).end, "2026-02-28");
  assert.strictEqual(M.shift(M.periodOf("quarter", "2026-02-01"), -1).start, "2025-10-01");
  assert.strictEqual(M.shift(M.periodOf("week", "2026-10-04"), -1).start, "2026-09-21");
  assert.strictEqual(M.shift(M.periodOf("day", "2026-03-01"), -1).start, "2026-02-28");
  assert.strictEqual(M.shift(M.periodOf("year", "2026-03-01"), 1).start, "2027-01-01");
  assert.strictEqual(M.lastYear(M.periodOf("day", "2024-02-29")).start, "2023-02-28");
  assert.strictEqual(M.lastYear(M.periodOf("month", "2024-02-29")).end, "2023-02-28");
  const lyw = M.lastYear(M.periodOf("week", "2026-10-04"));  // 52주 전 같은 요일
  assert.strictEqual(lyw.start, "2025-09-29");
  assert.strictEqual(M.weekdayIdx(lyw.start), 0);
});

test("진행 중인 기간은 같은 일수로 비교", () => {
  const p = M.periodOf("month", "2026-10-04");
  const c = M.comparePlan(p, "2026-10-04");
  assert.strictEqual(c.progress.state, "current");
  assert.strictEqual(c.progress.elapsed, 4);
  assert.deepStrictEqual(c.cur, { from: "2026-10-01", to: "2026-10-04" });
  assert.deepStrictEqual(c.prevRange, { from: "2026-09-01", to: "2026-09-04" });
  assert.deepStrictEqual(c.lyRange, { from: "2025-10-01", to: "2025-10-04" });
  // 3월 31일까지 진행 → 2월은 끝까지(28일)만
  const c2 = M.comparePlan(M.periodOf("month", "2026-03-31"), "2026-03-31");
  assert.deepStrictEqual(c2.prevRange, { from: "2026-02-01", to: "2026-02-28" });
  // 지난 기간은 전체, 미래 기간은 비교하지 않음
  const past = M.comparePlan(M.periodOf("quarter", "2026-05-01"), "2026-10-04");
  assert.deepStrictEqual(past.cur, { from: "2026-04-01", to: "2026-06-30" });
  assert.deepStrictEqual(past.prevRange, { from: "2026-01-01", to: "2026-03-31" });
  const fut = M.comparePlan(M.periodOf("month", "2026-12-01"), "2026-10-04");
  assert.strictEqual(fut.cur, null);
  assert.strictEqual(fut.progress.state, "future");
});

test("합계와 경영지표 (실매출 = 매출액 − 미지급금)", () => {
  const inc = [
    { date: "2026-10-01", cnt: 2, amount: 1100000, vat: 100000, payout: 100000, payout_due: 50000, receivable: 200000, card: 1100000 },
    { date: "2026-10-03", cnt: 1, amount: 400000, vat: 0, payout: 0, payout_due: 0, receivable: 0, card: 0 },
    { date: "2026-11-01", cnt: 9, amount: 9e6, vat: 0, payout: 0, payout_due: 0, receivable: 0, card: 0 },
  ];
  const exp = [{ date: "2026-10-02", cnt: 1, amount: 300000, payable: 100000, cost: 200000 }];
  const k = M.metricsFor(inc, exp, { from: "2026-10-01", to: "2026-10-31" });
  assert.strictEqual(k.gross, 1500000);
  assert.strictEqual(k.sales, 1400000);
  assert.strictEqual(k.profit, 1100000);
  assert.strictEqual(k.days, 2);
  assert.strictEqual(k.cnt, 3);
  assert.strictEqual(k.cash, 400000);
  assert.strictEqual(k.net, 1400000);
  assert.ok(Math.abs(k.margin - 1100000 / 1400000 * 100) < 1e-9);
  assert.strictEqual(k.cash_in, 1300000);
  assert.strictEqual(k.payout_paid, 50000);
  assert.strictEqual(k.cash_out, 200000);
  assert.strictEqual(k.net_cash, 1300000 - 50000 - 200000);
  assert.strictEqual(M.pctChange(110, 100), 10);
  assert.strictEqual(M.pctChange(-50, -100), 50);
  assert.strictEqual(M.pctChange(5, 0), null);
  const empty = M.metricsFor([], [], null);
  assert.strictEqual(empty.sales, 0);
  assert.strictEqual(empty.margin, null);
});

test("목표: 월 목표를 날짜 수로 나눠 더함", () => {
  const T = { "2026-09": { sales: 30e6, profit: 9e6 }, "2026-10": { sales: 31e6, expense: 20e6 } };
  const full = M.targetFor(T, "2026-10-01", "2026-10-31");
  assert.strictEqual(full.sales, 31e6);
  assert.strictEqual(full.profit, null);
  assert.strictEqual(full.expense, 20e6);
  const four = M.targetFor(T, "2026-10-01", "2026-10-04");
  assert.ok(Math.abs(four.sales - 4e6) < 1e-6);
  const span = M.targetFor(T, "2026-09-29", "2026-10-02");  // 9월 2일 + 10월 2일
  assert.ok(Math.abs(span.sales - (2e6 + 2e6)) < 1e-6);
  assert.strictEqual(span.covered.sales, 4);
  assert.strictEqual(span.covered.profit, 2);
  const q = M.targetFor(T, "2026-07-01", "2026-09-30");
  assert.strictEqual(q.sales, 30e6);
  assert.strictEqual(q.covered.sales, 30);  // 7·8월은 목표 없음
  assert.strictEqual(M.achievement(15e6, 30e6), 50);
  assert.strictEqual(M.achievement(15e6, null), null);
  assert.strictEqual(M.achievement(15e6, 0), null);
});

test("차트 구간", () => {
  assert.strictEqual(M.buckets(M.periodOf("day", "2026-10-04")).length, 14);
  const wk = M.buckets(M.periodOf("week", "2026-10-04"));
  assert.strictEqual(wk.length, 7);
  assert.strictEqual(wk[0].ly.from, "2025-09-29");
  const mon = M.buckets(M.periodOf("month", "2026-10-04"));
  assert.strictEqual(mon.length, 31);
  assert.deepStrictEqual(mon[30].ly, { from: "2025-10-31", to: "2025-10-31" });
  const feb = M.buckets(M.periodOf("month", "2024-02-01"));  // 윤년 2월 29일은 작년에 없음
  assert.strictEqual(feb.length, 29);
  assert.strictEqual(feb[28].ly, null);
  const q = M.buckets(M.periodOf("quarter", "2026-10-04"));  // 92일 = 7일×13 + 1일 → 마지막 1일은 앞 구간에
  assert.strictEqual(q.length, 13);
  assert.deepStrictEqual([q[12].from, q[12].to], ["2026-12-24", "2026-12-31"]);
  assert.deepStrictEqual(q[12].ly, { from: "2025-12-24", to: "2025-12-31" });
  const q1 = M.buckets(M.periodOf("quarter", "2026-02-10"));  // 90일 = 7일×12 + 6일 → 6일 구간은 그대로
  assert.strictEqual(q1.length, 13);
  assert.deepStrictEqual([q1[12].from, q1[12].to], ["2026-03-26", "2026-03-31"]);
  const y = M.buckets(M.periodOf("year", "2026-10-04"));
  assert.strictEqual(y.length, 12);
  assert.deepStrictEqual(y[1].ly, { from: "2025-02-01", to: "2025-02-28" });
  const day = M.buckets(M.periodOf("day", "2026-03-01"));
  assert.strictEqual(day[0].from, "2026-02-16");
  assert.strictEqual(day[13].ly.from, "2025-03-01");
});

test("분석: 열 키와 2단계 피벗", () => {
  assert.strictEqual(M.colKey("week", "2026-10-04"), "2026-09-28");
  assert.strictEqual(M.colKey("quarter", "2026-11"), "2026-Q4");
  assert.strictEqual(M.colKey("year", "2026"), "2026");
  assert.deepStrictEqual(M.colKeys("quarter", "2025-11-15", "2026-04-02"), ["2025-Q4", "2026-Q1", "2026-Q2"]);
  assert.deepStrictEqual(M.colKeys("month", "2026-01-31", "2026-03-01"), ["2026-01", "2026-02", "2026-03"]);
  assert.deepStrictEqual(M.colKeys("week", "2026-10-01", "2026-10-12"), ["2026-09-28", "2026-10-05", "2026-10-12"]);
  assert.deepStrictEqual(M.colKeys("total", "2026-01-01", "2026-12-31"), ["합계"]);
  assert.strictEqual(M.colLabel("month", "2026-03"), "26.03");
  const rows = [
    { month: "2026-01", manufacturer: "벤츠", car_model: "E클래스", amount: 100, payout: 10, cnt: 1 },
    { month: "2026-02", manufacturer: "벤츠", car_model: "E클래스", amount: 200, payout: 0, cnt: 2 },
    { month: "2026-02", manufacturer: "벤츠", car_model: "C클래스", amount: 50, payout: 0, cnt: 1 },
    { month: "2026-04", manufacturer: "BMW", car_model: "", amount: 70, payout: 0, cnt: 1 },
  ];
  const pv = M.pivot(rows, { time: "month", unit: "quarter", dims: ["manufacturer", "car_model"], keys: ["amount", "payout", "cnt"] });
  const benz = pv.groups.find(g => g.name === "벤츠");
  assert.strictEqual(benz.sums.amount, 350);
  assert.strictEqual(benz.cells["2026-Q1"].amount, 350);
  assert.strictEqual(benz.children.length, 2);
  assert.strictEqual(benz.children.find(c => c.name === "E클래스").sums.cnt, 3);
  assert.strictEqual(pv.total.amount, 420);
  assert.strictEqual(pv.colTotals["2026-Q2"].amount, 70);
  const flat = M.pivot(rows, { time: null, unit: "total", dims: ["manufacturer"], keys: ["amount"] });
  assert.strictEqual(flat.groups.length, 2);
  assert.strictEqual(flat.groups[0].cells["합계"].amount, 350);
});

test("분석 비교 범위", () => {
  assert.deepStrictEqual(M.compareRange("2026-10-01", "2026-10-31", "prev", "month"), { from: "2026-09-01", to: "2026-09-30" });
  assert.deepStrictEqual(M.compareRange("2026-03-01", "2026-03-31", "prev", "month"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepStrictEqual(M.compareRange("2026-01-01", "2026-12-31", "prev", "year"), { from: "2025-01-01", to: "2025-12-31" });
  assert.deepStrictEqual(M.compareRange("2026-10-05", "2026-10-11", "prev", null), { from: "2026-09-28", to: "2026-10-04" });
  assert.deepStrictEqual(M.compareRange("2024-02-01", "2024-02-29", "ly", null), { from: "2023-02-01", to: "2023-02-28" });
  assert.strictEqual(M.compareRange("2026-01-01", "2026-01-31", "none", null), null);
});

console.log(`metrics.js: ${n}개 묶음 모두 통과`);
