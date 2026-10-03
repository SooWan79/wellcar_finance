/* 데모 화면 장치: 파일 저장(아티팩트 downloads 기능), '처음 상태로' 버튼, 데모 계정 바로 로그인 */
(function () {
  "use strict";

  // 1) 파일 저장 — 아티팩트 화면은 페이지가 직접 내려받기를 시작할 수 없어 보는 사람의 저장 확인 창을 쓴다.
  //    아티팩트 밖(저장한 HTML을 직접 연 경우)에는 app.js의 보통 내려받기가 그대로 동작한다.
  if (window.claude && typeof window.claude.use === "function") {
    let ns = null;
    const ready = window.claude.use("downloads").then(x => (ns = x), () => null);
    window.WellcarHost = {
      async saveFile(filename, blob) {
        const d = ns || await ready;
        if (!d) throw new Error("이 화면에서는 파일을 저장할 수 없습니다. 실제 시스템에서는 바로 내려받아집니다.");
        try {
          await d.save({ filename, data: blob });
        } catch (e) {
          const code = e && e.code;
          if (code === "declined") throw new Error("파일 저장을 취소했습니다.");
          if (code === "rate_limited") throw new Error("저장 확인 창이 이미 열려 있습니다. 잠시 뒤 다시 누르세요.");
          throw new Error("이 화면에서는 파일을 저장하지 못했습니다. 실제 시스템에서는 바로 내려받아집니다.");
        }
      },
    };
  }

  // 2) 처음 상태로 되돌리기 — 실수로 누르지 않게 두 번 눌러야 실행
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-demo-reset]");
    if (!b) return;
    if (b.dataset.armed !== "1") {
      b.dataset.armed = "1";
      b.textContent = "한 번 더 누르면 처음 상태로";
      setTimeout(() => { b.dataset.armed = ""; b.textContent = "처음 상태로 되돌리기"; }, 4000);
      return;
    }
    window.WellcarDemo.reset();
    location.reload();
  });

  // 3) 데모 계정 바로 로그인
  document.addEventListener("click", e => {
    const b = e.target.closest("[data-demo-login]");
    if (!b) return;
    document.getElementById("loginUser").value = b.dataset.demoLogin;
    document.getElementById("loginPass").value = window.WellcarDemo.password;
    document.getElementById("loginForm").requestSubmit();
  });
})();
