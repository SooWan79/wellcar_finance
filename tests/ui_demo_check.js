/* 데모(아티팩트) 화면 점검 (Playwright, 헤드리스 크로미움).

   실행 예:
     .venv/bin/python demo/build_demo.py
     python3 -m http.server 8010 -d demo/dist &
     LANG=C.UTF-8 NODE_PATH=$(npm root -g) node tests/ui_demo_check.js

   데모에만 있는 동작을 봅니다: 데모 계정 버튼, 브라우저 저장(새로고침 뒤 유지), 화면 안 확인 창(취소·확인),
   엑셀 저장(보통 내려받기 / 아티팩트 저장 창을 흉내 낸 경로), '처음 상태로'(두 번 눌러야 실행),
   조회 전용 화면, 휴대폰 폭 다크 모드.
   일반 화면 흐름은 같은 페이지에 tests/ui_smoke.js를 돌려 확인합니다:
     BASE_URL=http://localhost:8010/preview.html UI_PASS=demo1234 LANG=C.UTF-8 NODE_PATH=$(npm root -g) node tests/ui_smoke.js

   환경변수: BASE_URL(기본 http://localhost:8010/preview.html), SHOT_DIR(지정하면 화면 캡처 저장)
   JS 콘솔 오류가 하나라도 있으면 실패(종료 코드 1)합니다. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BASE = process.env.BASE_URL || "http://localhost:8010/preview.html";
const SHOT = process.env.SHOT_DIR || "";

const errors = [];
function step(msg) { console.log("✓ " + msg); }
function assert(cond, msg) { if (!cond) throw new Error("검증 실패: " + msg); }

async function shot(page, name) {
  if (SHOT) await page.screenshot({ path: path.join(SHOT, name + ".png") });
}

function watch(page) {
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
}

async function demoLogin(page, who) {
  await page.waitForSelector("#loginForm:not([hidden])");
  await page.click(`[data-demo-login="${who}"]`);
  await page.waitForSelector("#appShell:not([hidden])");
  await page.waitForTimeout(500);
}

async function tab(page, name) {
  await page.click(`#mainTabs [data-view="${name}"]`);
  await page.waitForTimeout(400);
}

async function incomeCount(page) {
  return parseInt((await page.textContent("#incCount")).replace(/[^0-9]/g, ""), 10);
}

/** 아티팩트 화면의 claude.use("downloads")를 흉내 낸다. 두 번째 저장은 보는 사람이 '취소'한 것으로 한다. */
function fakeArtifactHost() {
  window.__saved = [];
  const downloads = {
    async save({ filename, data }) {
      if (window.__saved.length >= 1) throw { code: "declined", message: "declined" };
      const head = new Uint8Array(await data.slice(0, 2).arrayBuffer());
      window.__saved.push({ filename, size: data.size, zip: head[0] === 0x50 && head[1] === 0x4b });
      return { status: "saved" };
    },
  };
  window.claude = { use: name => Promise.resolve(name === "downloads" ? downloads : null) };
}

(async () => {
  const browser = await chromium.launch();
  try {
    // 1) 처음 여는 브라우저(빈 저장소): 데모 계정 버튼으로 관리자 로그인
    const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    watch(page);
    await page.goto(BASE);
    await page.waitForSelector("#loginForm:not([hidden])");
    assert(await page.isVisible(".demo-accounts"), "데모 계정 버튼 표시");
    await shot(page, "d1_login");
    await demoLogin(page, "admin");
    assert(await page.isVisible(".demo-banner"), "데모 안내 띠 표시");
    await shot(page, "d2_dashboard");
    step("데모 계정 버튼으로 관리자 로그인");

    // 2) 삭제: 화면 안 확인 창에서 취소하면 그대로, 확인하면 1건 줄어듦
    await tab(page, "income");
    const n0 = await incomeCount(page);
    assert(n0 > 100, "데모 매출 내역 " + n0);
    await page.click("#incList [data-del]");
    await page.waitForSelector("#confirmDialog[open]");
    await page.click("#confirmDialog [data-close]");
    await page.waitForTimeout(300);
    assert(await incomeCount(page) === n0, "취소하면 삭제하지 않음");
    await page.click("#incList [data-del]");
    await page.waitForSelector("#confirmDialog[open]");
    await shot(page, "d3_confirm");
    await page.click("#confirmOk");
    await page.waitForTimeout(500);
    assert(await incomeCount(page) === n0 - 1, "확인하면 1건 삭제");
    step(`확인 창: 취소 → ${n0}건 그대로, 확인 → ${n0 - 1}건`);

    // 3) 새로고침해도 로그인과 데이터가 남아 있음(브라우저 저장)
    await page.reload();
    await page.waitForSelector("#appShell:not([hidden])");
    await tab(page, "income");
    assert(await incomeCount(page) === n0 - 1, "새로고침 뒤 데이터 유지");
    step("새로고침 뒤 로그인·데이터 유지");

    // 4) 엑셀 받기(아티팩트 밖에서 연 경우): 보통 내려받기
    const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#incExport")]);
    const file = path.join(os.tmpdir(), "demo_" + dl.suggestedFilename());
    await dl.saveAs(file);
    const head = fs.readFileSync(file).subarray(0, 2).toString("latin1");
    assert(dl.suggestedFilename().endsWith(".xlsx") && head === "PK", "xlsx 파일");
    step(`엑셀 내려받기: ${dl.suggestedFilename()} (${fs.statSync(file).size.toLocaleString()}바이트)`);

    // 5) '처음 상태로': 한 번 누르면 안내만, 두 번째에 초기화 → 조회 전용 계정으로 확인
    await page.click("[data-demo-reset]");
    assert((await page.textContent("[data-demo-reset]")).includes("한 번 더"), "첫 클릭은 안내만");
    await tab(page, "income");
    assert(await incomeCount(page) === n0 - 1, "첫 클릭으로는 초기화하지 않음");
    await Promise.all([page.waitForEvent("load"), page.click("[data-demo-reset]")]);
    await demoLogin(page, "viewer");
    await tab(page, "income");
    assert(await incomeCount(page) === n0, "초기화 뒤 처음 건수");
    assert(!(await page.isVisible("#incomeForm")), "조회 전용은 등록 폼 숨김");
    step(`처음 상태로(두 번 클릭) → ${n0}건 복구, 조회 전용 화면 확인`);

    // 6) 휴대폰 폭 + 다크 모드: 가로 넘침 없음
    await page.click("#themeToggle");
    await page.click("#themeToggle");  // 자동 → 라이트 → 다크
    assert(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "다크 모드");
    await page.setViewportSize({ width: 390, height: 844 });
    for (const t of ["dashboard", "income", "balances"]) {
      await tab(page, t);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `${t} 모바일 가로 넘침 ${overflow}px`);
    }
    await shot(page, "d4_mobile_dark");
    step("휴대폰 폭(390px) 다크 모드 가로 넘침 없음");
    await ctx.close();

    // 7) 아티팩트 화면: 저장 확인 창(downloads 기능)으로 엑셀 저장, 취소하면 안내
    const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page2 = await ctx2.newPage();
    watch(page2);
    await page2.addInitScript(fakeArtifactHost);
    await page2.goto(BASE);
    await demoLogin(page2, "admin");
    await tab(page2, "data");
    await page2.click("#xpDownload");
    await page2.waitForFunction(() => window.__saved.length === 1);
    const saved = await page2.evaluate(() => window.__saved[0]);
    assert(saved.filename.endsWith(".xlsx") && saved.zip && saved.size > 1000, "저장 창에 xlsx 전달");
    await page2.click("#xpDownload");
    await page2.waitForFunction(() => document.getElementById("toast").textContent.includes("취소"));
    step(`아티팩트 저장 창 경로: ${saved.filename} (${saved.size.toLocaleString()}바이트), 취소 안내 표시`);
    await ctx2.close();
  } catch (e) {
    errors.push("테스트 중단: " + e.message);
  }

  await browser.close();
  console.log(`\nJS 콘솔 오류: ${errors.length}건`);
  for (const e of errors) console.log("  ✗ " + e);
  process.exit(errors.length ? 1 : 0);
})();
