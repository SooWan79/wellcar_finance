/* 화면 스모크 테스트 (Playwright, 헤드리스 크로미움).

   실행 예:
     WELLCAR_DB=/tmp/ui.db WELLCAR_ADMIN_PASSWORD=dev-pass-1234 .venv/bin/python seed_demo.py
     WELLCAR_DB=/tmp/ui.db PORT=8000 .venv/bin/python app.py &
     LANG=C.UTF-8 NODE_PATH=$(npm root -g) node tests/ui_smoke.js

   (LANG=C.UTF-8: 리눅스 기본 C 로케일에서는 크로미움이 한글 내려받기 파일명을 'download'로 바꿉니다.
    윈도·맥·휴대폰 브라우저에서는 생기지 않는 현상입니다.)

   환경변수: BASE_URL(기본 http://localhost:8000), UI_USER(admin), UI_PASS(dev-pass-1234),
            SHOT_DIR(지정하면 화면 캡처 저장)
   JS 콘솔 오류가 하나라도 있으면 실패(종료 코드 1)합니다. 테스트 중 사용자·내역을 실제로 만들므로
   반드시 임시 DB로 띄운 서버에서 실행하세요. */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BASE = process.env.BASE_URL || "http://localhost:8000";
const USER = process.env.UI_USER || "admin";
const PASS = process.env.UI_PASS || "dev-pass-1234";
const SHOT = process.env.SHOT_DIR || "";
const TABS = ["dashboard", "income", "expense", "balances", "monthly", "quarterly", "yearly", "data", "codes", "users"];

const errors = [];
const steps = [];
function step(msg) { steps.push(msg); console.log("✓ " + msg); }
function assert(cond, msg) { if (!cond) throw new Error("검증 실패: " + msg); }

async function shot(page, name) {
  if (SHOT) await page.screenshot({ path: path.join(SHOT, name + ".png"), fullPage: true });
}

async function login(page, user, pass) {
  await page.goto(BASE);
  await page.waitForSelector("#loginForm:not([hidden])");
  await page.fill("#loginUser", user);
  await page.fill("#loginPass", pass);
  await page.click("#loginSubmit");
  await page.waitForSelector("#appShell:not([hidden])");
  await page.waitForTimeout(400);
}

async function logout(page) {
  await page.click("#userBtn");
  await page.click("#menuLogout");
  await page.waitForSelector("#loginForm:not([hidden])");
}

/** 화면 안 확인 대화상자에서 '확인' 누르기 */
async function confirmOk(page) {
  await page.waitForSelector("#confirmDialog[open]");
  await page.click("#confirmOk");
  await page.waitForTimeout(150);
}

async function tab(page, name) {
  await page.click(`#mainTabs [data-view="${name}"]`);
  await page.waitForTimeout(350);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", e => errors.push(String(e)));
  page.on("dialog", d => d.accept());  // 브라우저 기본 창이 뜨면 '확인' (앱은 화면 안 대화상자를 씀)

  try {
    // 1) 로그인 화면 → 잘못된 비밀번호 → 정상 로그인
    await page.goto(BASE);
    await page.waitForSelector("#loginForm:not([hidden])");
    await shot(page, "01_login");
    await page.fill("#loginUser", USER);
    await page.fill("#loginPass", "wrong-password");
    await page.click("#loginSubmit");
    await page.waitForFunction(() => document.getElementById("loginError").textContent.length > 0);
    step("잘못된 비밀번호 안내: " + await page.textContent("#loginError"));
    errors.length = 0;  // 일부러 틀린 로그인의 401 응답 로그는 오류로 세지 않는다
    await login(page, USER, PASS);
    step("관리자 로그인");

    // 2) 모든 탭
    for (const t of TABS) {
      await tab(page, t);
      assert(await page.isVisible(`#view-${t}`), `${t} 화면 표시`);
      await shot(page, `tab_${t}`);
    }
    step(`탭 ${TABS.length}개 모두 열림`);

    // 3) 매출관리: 기간·검색·페이지
    await tab(page, "income");
    const total0 = await page.textContent("#incCount");
    await page.selectOption("#incPeriod", "this-month");
    await page.waitForTimeout(400);
    const monthCount = await page.textContent("#incCount");
    await page.selectOption("#incPeriod", "all");
    await page.waitForTimeout(400);
    const pages = await page.$$eval("#incPager .pg[data-page]", b => b.length);
    assert(pages > 2, "페이지 버튼 표시");
    await page.click('#incPager .pg[aria-label="다음 페이지"]');
    await page.waitForTimeout(400);
    const info = await page.textContent("#incPager .pager-info");
    assert(info.startsWith("51–100"), "2페이지 이동: " + info);
    step(`매출 목록: 전체 ${total0}, 이번 달 ${monthCount}, 2페이지 '${info}'`);
    await page.fill("#incSearch", "동서카오디오");
    await page.waitForTimeout(700);
    const searched = await page.textContent("#incCount");
    step("검색 '동서카오디오' → " + searched);
    await page.fill("#incSearch", "");
    await page.waitForTimeout(600);

    // 4) 매출 등록(미수금 포함) → 목록 반영
    await page.fill("#incAmount", "330000");
    await page.dispatchEvent("#incAmount", "input");
    await page.fill("#incClient", "UI테스트상사");
    await page.fill("#incMemo", "UI 스모크 테스트");
    await page.click("#incAllDue");
    assert(await page.inputValue("#incReceivable") === "330000", "미수금 전액 버튼");
    await page.click("#incSubmit");
    await page.waitForTimeout(600);
    await page.fill("#incSearch", "UI테스트상사");
    await page.waitForTimeout(700);
    assert((await page.textContent("#incCount")).startsWith("1"), "등록한 매출 검색");
    step("미수금 있는 매출 등록·검색");

    // 5) 수정 버튼 → 폼 채움(감사 정보 표시)
    await page.click("#incList [data-edit]");
    await page.waitForTimeout(400);
    assert((await page.textContent("#incomeFormTitle")).startsWith("매출 수정"), "수정 폼");
    step("수정 폼: " + await page.textContent("#incMeta"));
    await page.click("#incReset");

    // 6) 목록 엑셀 받기
    const [dl1] = await Promise.all([page.waitForEvent("download"), page.click("#incExport")]);
    const xlsx1 = path.join(os.tmpdir(), "ui_" + dl1.suggestedFilename());
    await dl1.saveAs(xlsx1);
    assert(fs.statSync(xlsx1).size > 1000, "엑셀 파일 크기");
    step("매출 목록 엑셀 받기: " + dl1.suggestedFilename());

    // 7) 미수·미지급: 완료 처리
    await tab(page, "balances");
    const before = await page.textContent("#balRecCount");
    const row = page.locator("#balRecList tr", { hasText: "UI테스트상사" });
    await row.locator("[data-settle]").click();
    await confirmOk(page);
    await page.waitForTimeout(600);
    const after = await page.textContent("#balRecCount");
    assert(before !== after, `완료 처리 후 건수 변경 (${before} → ${after})`);
    step(`미수금 입금 완료 처리: ${before} → ${after}`);

    // 8) 데이터 관리: 내보내기, 백업
    await tab(page, "data");
    const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#xpDownload")]);
    const xlsx2 = path.join(os.tmpdir(), "ui_all_" + dl2.suggestedFilename());
    await dl2.saveAs(xlsx2);
    step("전체 엑셀 내보내기: " + dl2.suggestedFilename());
    await page.click("#backupNow");
    await page.waitForTimeout(600);
    assert(await page.locator("#backupList tbody tr").count() >= 1, "백업 목록");
    step("지금 백업 → 목록 " + await page.locator("#backupList tbody tr").count() + "개");

    // 8-1) 복원: 백업 뒤에 1건 추가 → 방금 백업으로 복원 → 건수 원상복구 + '복원 직전' 백업 생김
    const count = () => page.evaluate(() => fetch("/api/incomes?size=1",
      { headers: { "X-Requested-With": "XMLHttpRequest" } }).then(r => r.json()).then(j => j.total));
    const n0 = await count();
    await page.evaluate(() => fetch("/api/incomes", { method: "POST",
      headers: { "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/json" },
      body: JSON.stringify({ trx_date: "2026-01-01", income_type: "기타", amount: 12345, memo: "복원 시험" }) }));
    assert(await count() === n0 + 1, "복원 시험용 1건 추가");
    await page.locator("#backupList tbody tr", { hasText: "manual" }).first().locator("[data-bk-restore]").click();
    await confirmOk(page);
    await page.waitForTimeout(1200);
    assert(await count() === n0, "복원 후 건수 원상복구");
    assert(await page.locator("#backupList tbody tr", { hasText: "pre-restore" }).count() >= 1, "복원 직전 백업");
    step(`백업 복원: ${n0 + 1}건 → ${n0}건, 복원 직전 백업 생성`);

    // 9) 엑셀 가져오기: 방금 내보낸 파일을 다시 올리면 전부 '이미 있음'
    await page.setInputFiles("#importFile", xlsx2);
    await page.waitForSelector("#importPreview:not([hidden])", { timeout: 20000 });
    await shot(page, "import_preview");
    const stats = await page.textContent("#importSummary .import-stats");
    await page.click("#importCommit");
    await page.waitForSelector("#importResult:not([hidden])", { timeout: 30000 });
    const res = await page.textContent("#importResult");
    assert(/매출 0건 등록/.test(res) && /지출 0건 등록/.test(res), "왕복 가져오기는 새 등록 0건: " + res);
    assert(/파일의 내역이 모두 시스템에 들어 있습니다/.test(res), "가져온 뒤 대조 일치");
    await shot(page, "import_result");
    step("내보낸 파일 다시 가져오기 → 중복 없이 0건 등록, 대조 일치 (" + stats.replace(/\s+/g, " ").trim() + ")");

    // 10) 사용자 추가 (직원·조회 전용)
    await tab(page, "users");
    for (const [u, role] of [["uistaff", "staff"], ["uiviewer", "viewer"]]) {
      if (await page.locator("#userList td", { hasText: u }).count()) continue;
      await page.click("#userAdd");
      await page.fill("#udName", u === "uistaff" ? "김직원" : "세무사");
      await page.fill("#udUser", u);
      await page.selectOption("#udRole", role);
      await page.fill("#udPass", "ui-pass-1234");
      await page.click('#userForm button[type="submit"]');
      await page.waitForTimeout(500);
    }
    step("사용자 추가: 김직원(직원), 세무사(조회 전용)");

    // 11) 비밀번호 변경 대화상자 열고 닫기
    await page.click("#userBtn");
    await page.click("#menuPassword");
    assert(await page.isVisible("#pwDialog"), "비밀번호 변경 창");
    await page.click("#pwDialog [data-close]");

    // 12) 직원 로그인: 관리자 메뉴 숨김, 등록 폼 보임
    await logout(page);
    await login(page, "uistaff", "ui-pass-1234");
    assert(!(await page.isVisible('#mainTabs [data-view="users"]')), "직원은 사용자관리 숨김");
    assert(!(await page.isVisible('#mainTabs [data-view="codes"]')), "직원은 코드관리 숨김");
    await tab(page, "income");
    assert(await page.isVisible("#incomeForm"), "직원은 등록 폼 보임");
    await tab(page, "data");
    assert(!(await page.isVisible("#importDrop")), "직원은 가져오기 숨김");
    await shot(page, "staff_data");
    step("직원 권한 화면 확인");

    // 13) 조회 전용: 폼·수정 버튼 숨김
    await logout(page);
    await login(page, "uiviewer", "ui-pass-1234");
    await tab(page, "income");
    assert(!(await page.isVisible("#incomeForm")), "조회 전용은 등록 폼 숨김");
    assert(!(await page.isVisible("#incList [data-edit]")), "조회 전용은 수정 버튼 숨김");
    await shot(page, "viewer_income");
    step("조회 전용 권한 화면 확인");

    // 14) 모바일 폭
    await page.setViewportSize({ width: 390, height: 844 });
    for (const t of ["dashboard", "income", "balances"]) {
      await tab(page, t);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert(overflow <= 1, `${t} 모바일 가로 넘침 ${overflow}px`);
      await shot(page, `mobile_${t}`);
    }
    step("모바일 폭(390px) 가로 넘침 없음");
  } catch (e) {
    errors.push("테스트 중단: " + e.message);
    await shot(page, "zz_failure").catch(() => {});
  }

  await browser.close();
  console.log(`\nJS 콘솔 오류: ${errors.length}건`);
  for (const e of errors) console.log("  ✗ " + e);
  process.exit(errors.length ? 1 : 0);
})();
