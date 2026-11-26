/* 데모 데이터 대조: 서버용 seed_demo.py와 데모 아티팩트용 demo/seed_data.js가 같은 날짜에 똑같은 내역을 만드는지 확인한다.

   node tests/seed_parity.js        (PYTHON 환경변수로 파이썬 경로 지정, 기본 .venv/bin/python)

   두 파일은 같은 난수와 같은 계산 순서를 손으로 맞춘 것이라, 한쪽만 고치면 여기서 바로 어긋난다. */
const { execFileSync } = require("child_process");
const path = require("path");
const assert = require("assert");
const seed = require("../demo/seed_data.js");

const fs = require("fs");
const root = path.join(__dirname, "..");
const python = process.env.PYTHON || path.join(root, ".venv/bin/python");
// 평소 날짜, 윤년 2월 29일, 연초(작년 자료가 대부분인 때), 분기 첫 달 25일(부가세 나가는 날)
const DATES = ["2026-11-26", "2028-02-29", "2027-01-05", "2026-07-25"];

// 데모(mock_api.js)에 손으로 옮겨 둔 브랜드별 차종 목록 — 서버(app.py SEED_CODES)와 같아야 같은 내역이 나온다
const mock = fs.readFileSync(path.join(root, "demo/mock_api.js"), "utf8");
const block = /car_model:\s*(\{[\s\S]*?\n\s*\}),/.exec(mock);
assert.ok(block, "demo/mock_api.js에서 car_model 목록을 찾지 못했습니다.");
const mockCarModels = new Function(`return ${block[1]};`)();

for (const today of DATES) {
  const out = execFileSync(python, ["seed_demo.py", "--dump", today], { cwd: root, maxBuffer: 256 * 1024 * 1024, encoding: "utf8" });
  const py = JSON.parse(out);
  assert.deepStrictEqual(mockCarModels, py.car_models, "브랜드별 차종 목록이 app.py와 demo/mock_api.js에서 다릅니다.");
  const js = seed.generate(today, mockCarModels);
  for (const key of ["incomes", "expenses"]) {
    assert.strictEqual(js[key].length, py[key].length, `${today} ${key} 건수`);
    for (let i = 0; i < py[key].length; i++) {
      assert.deepStrictEqual(js[key][i], py[key][i], `${today} ${key} ${i + 1}번째 내역`);
    }
  }
  assert.deepStrictEqual(js.targets, py.targets, `${today} 월별 목표`);
  const sum = rows => rows.reduce((a, r) => a + r.amount, 0);
  console.log(`  ✓ ${today}: 매출 ${js.incomes.length}건 ${sum(js.incomes).toLocaleString("ko-KR")}원 · 지출 ${js.expenses.length}건 ${sum(js.expenses).toLocaleString("ko-KR")}원`);
}
console.log(`seed_parity: ${DATES.length}개 날짜 모두 일치`);
