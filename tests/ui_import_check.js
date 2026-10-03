/* 엑셀 가져오기 검증 (Playwright). 실제 장부 파일이나 make_sample_workbook.py로 만든 파일을
   화면에서 그대로 올려 보고, 분석 결과·경영분석 대조·가져온 뒤 대조·재업로드 멱등성을 확인한다.

     LANG=C.UTF-8 NODE_PATH=$(npm root -g) FILE=/tmp/sample.xlsm [TRUTH=/tmp/sample.json] node tests/ui_import_check.js

   TRUTH(생성기의 정답 JSON)를 주면 DB 합계가 정답과 같은지도 검사한다.
   반드시 빈 임시 DB로 띄운 서버에서 실행하세요(가져온 내역이 실제로 저장됩니다). */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.BASE_URL || "http://localhost:8000";
const FILE = process.env.FILE;
const TRUTH = process.env.TRUTH ? JSON.parse(fs.readFileSync(process.env.TRUTH, "utf8")) : null;
const USER = process.env.UI_USER || "admin";
const PASS = process.env.UI_PASS || "dev-pass-1234";
const SHOT = process.env.SHOT_DIR || "";

const failures = [];
const check = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) failures.push(msg); };
const text = s => (s || "").replace(/\s+/g, " ").trim();

(async () => {
  if (!FILE) { console.error("FILE 환경변수로 엑셀 파일 경로를 주세요."); process.exit(2); }
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  const errors = [];
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));

  await page.goto(BASE);
  await page.waitForSelector("#loginForm:not([hidden])");
  await page.fill("#loginUser", USER);
  await page.fill("#loginPass", PASS);
  await page.click("#loginSubmit");
  await page.waitForSelector("#appShell:not([hidden])");
  await page.click('#mainTabs [data-view="data"]');

  async function upload(label) {
    const t0 = Date.now();
    await page.setInputFiles("#importFile", FILE);
    await page.waitForSelector("#importPreview:not([hidden])", { timeout: 120000 });
    const parseMs = Date.now() - t0;
    const stats = text(await page.textContent("#importSummary .import-stats"));
    const recon = await page.$$eval("#importSummary .recon-head", els => els.map(e => e.textContent.replace(/\s+/g, " ").trim()));
    const issues = await page.$$eval("#importSummary details.issues li", els => els.map(e => e.textContent.trim()));
    const sheets = await page.$$eval("#importSummary tbody tr", trs => trs.map(tr => tr.textContent.replace(/\s+/g, " ").trim()));
    console.log(`\n[${label}] 분석 ${(parseMs / 1000).toFixed(1)}초 — ${stats}`);
    if (SHOT) await page.screenshot({ path: `${SHOT}/import_${label}_preview.png`, fullPage: true });
    const t1 = Date.now();
    await page.click("#importCommit");
    await page.waitForSelector("#importResult:not([hidden])", { timeout: 180000 });
    const saveMs = Date.now() - t1;
    const result = text(await page.textContent("#importResult"));
    console.log(`[${label}] 저장 ${(saveMs / 1000).toFixed(1)}초 — ${result.slice(0, 160)}…`);
    if (SHOT) await page.screenshot({ path: `${SHOT}/import_${label}_result.png`, fullPage: true });
    return { parseMs, saveMs, stats, recon, issues, sheets, result };
  }

  const first = await upload("1차");
  console.log("시트:", first.sheets.length + "개 (" + first.sheets.slice(0, 4).join(" | ") + " …)");
  console.log("경영분석 대조:", first.recon.join(" / ") || "(없음)");
  console.log(`확인할 점 ${first.issues.length}건:`);
  for (const i of first.issues.slice(0, 8)) console.log("   - " + i);
  check(/파일의 내역이 모두 시스템에 들어 있습니다/.test(first.result), "가져온 뒤 파일 ↔ 시스템 월별 대조 일치");
  if (first.recon.length) check(first.recon.every(r => /모든 달 일치/.test(r)), "엑셀 월별 합계(경영분석)와 읽은 내역 일치");

  const second = await upload("2차(재업로드)");
  check(/매출 0건 등록/.test(second.result) && /지출 0건 등록/.test(second.result), "같은 파일 재업로드 시 새 등록 0건");

  if (TRUTH) {
    const r = await page.evaluate(async () => {
      const get = u => fetch(u, { headers: { "X-Requested-With": "XMLHttpRequest" } }).then(x => x.json());
      return { inc: await get("/api/incomes?size=1"), exp: await get("/api/expenses?size=1"),
        months: await get("/api/stats/months"), recv: await get("/api/receivables") };
    });
    check(r.inc.total === TRUTH.sales, `매출 건수 ${r.inc.total} = 정답 ${TRUTH.sales}`);
    check(r.inc.sum.amount === TRUTH.income_total, `매출 합계 ${r.inc.sum.amount} = 정답 ${TRUTH.income_total}`);
    check(r.exp.total === TRUTH.expenses, `지출 건수 ${r.exp.total} = 정답 ${TRUTH.expenses}`);
    check(r.exp.sum.amount === TRUTH.expense_total, `지출 합계 ${r.exp.sum.amount} = 정답 ${TRUTH.expense_total}`);
    check(r.recv.incomes.total === TRUTH.receivable_total, `미수금 합계 ${r.recv.incomes.total} = 정답 ${TRUTH.receivable_total}`);
    const bad = r.months.filter(m => {
      const t = TRUTH.months[m.month];
      return !t || t.income !== m.income || t.income_count !== m.income_count || t.expense !== m.expense;
    });
    check(!bad.length, `월별 건수·금액 12개월 정답 일치${bad.length ? " (불일치: " + bad.map(b => b.month).join(",") + ")" : ""}`);
  }
  check(!errors.length, `JS 콘솔 오류 ${errors.length}건${errors.length ? ": " + errors.join(" | ") : ""}`);
  await browser.close();
  console.log(failures.length ? `\n실패 ${failures.length}건` : "\n모든 검사 통과");
  process.exit(failures.length ? 1 : 0);
})();
