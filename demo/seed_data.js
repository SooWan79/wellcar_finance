/* 데모 데이터 생성기 — seed_demo.py의 generate()를 그대로 옮긴 것.
   같은 순서로 같은 난수(mulberry32)를 쓰고 덧셈·곱셈·나눗셈·내림만 써서, 같은 날짜면 서버 데모와 한 건도 다르지 않은 내역을 만든다.
   한쪽을 고치면 다른 쪽도 같이 고치고 `node tests/seed_parity.js`로 대조한다. 심어 둔 흐름의 설명은 seed_demo.py 머리말에 있다.
   브라우저에서는 window.WellcarDemoSeed, Node에서는 module.exports. */
(function (root) {
  "use strict";

  const SERVICE_SHARE = 0.68;
  // 수리 유형·상품: [이름, 건수 비중, 가격대 아래·위(만 원), 한 해 가격 변화율, 한 해 건수 변화 배수]
  const SERVICES = [
    ["카오디오수리", 22, 18, 42, 0.03, 1.00],
    ["앰프수리", 16, 25, 55, 0.10, 1.10],
    ["내비게이션수리", 16, 30, 65, 0.05, 1.60],
    ["데크수리", 14, 14, 32, 0.00, 0.55],
    ["메카니즘수리", 12, 12, 28, 0.02, 1.00],
    ["탈부착", 20, 7, 16, 0.05, 1.05],
  ];
  const PRODUCTS = [
    ["카오디오", 26, 35, 100, -0.02, 0.95],
    ["앰프", 18, 30, 80, 0.00, 1.00],
    ["스피커", 22, 15, 50, 0.03, 1.10],
    ["내비게이션", 14, 45, 120, -0.06, 0.80],
    ["블랙박스", 20, 18, 38, -0.08, 2.00],
  ];
  // 브랜드: [이름, 건수 비중, 가격 배수, 한 해 건수 변화 배수]
  const MAKERS = [
    ["벤츠", 24, 1.15, 1.00], ["BMW", 20, 1.10, 1.05], ["아우디", 16, 1.05, 0.55], ["폭스바겐", 8, 0.90, 0.95],
    ["볼보", 3, 1.00, 2.40], ["토요타", 5, 0.85, 1.00], ["현대", 14, 0.70, 1.70], ["레인지로버", 4, 1.60, 1.00],
  ];
  // 거래처: [이름, 수리 건 비중, 상품 건 비중, 한 해 건수 변화 배수, 며칠 전부터 끊김(0 = 계속), 며칠 전에 시작(0 = 처음부터), 종류]
  const CLIENTS = [
    ["개인", 28, 30, 1.00, 0, 0, "retail"], ["방문", 20, 25, 1.00, 0, 0, "retail"],
    ["옥션", 0, 12, 1.00, 0, 0, "online"], ["G마켓", 0, 12, 1.10, 0, 0, "online"],
    ["동서카오디오(대구)", 9, 2, 1.00, 0, 0, "dealer"], ["재즈카오디오(광주)", 8, 2, 1.80, 0, 0, "dealer"],
    ["현대카오디오(서울)", 8, 2, 1.00, 0, 0, "dealer"], ["수원테크(수원)", 9, 2, 0.50, 0, 0, "dealer"],
    ["닥터카오디오(수원)", 6, 1, 1.00, 0, 0, "dealer"], ["써브카오디오(안산)", 7, 1, 1.00, 130, 0, "dealer"],
    ["오토사운드(논산)", 5, 1, 1.00, 75, 0, "dealer"], ["창원카오디오(창원)", 7, 2, 1.00, 0, 200, "dealer"],
  ];
  const UNITS = ["CIC", "NBT", "COMAND", "MMI", "IMC", "Harman", "Burmester"];
  const VENDORS = ["해덕", "슈퍼그립", "미스터짱카"];
  const VENDOR_WEIGHTS = [5, 3, 2];
  // 요일(월~토)별 손님 수 배수와 월별 계절 배수
  const WEEKDAY = [1.05, 0.75, 0.80, 1.00, 1.15, 1.45];
  const SEASON = [0.85, 0.80, 0.95, 1.00, 1.05, 1.00, 1.10, 1.05, 0.95, 1.00, 1.05, 1.15];
  const UTILITY = [28, 27, 20, 15, 14, 18, 30, 32, 20, 15, 19, 26];  // 달별 수도광열비(만 원)

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const DAY = 86400000;
  const pad2 = n => String(n).padStart(2, "0");
  const ym = (y, m) => `${String(y).padStart(4, "0")}-${pad2(m)}`;
  /** 만 원 단위로 반올림 (0.5는 올림) */
  const round10k = v => Math.floor(v / 10000 + 0.5) * 10000;

  /** 오늘 날짜(YYYY-MM-DD)와 브랜드별 차종 목록으로 데모 내역을 만든다. 반환: {incomes, expenses, targets} */
  function generate(todayIso, carModels) {
    const rng = mulberry32(42);
    const randint = n => Math.floor(rng() * n);
    const pick = arr => arr[randint(arr.length)];
    const wpick = (arr, weights) => {
      let total = 0;
      for (const w of weights) total += w;
      let x = rng() * total;
      for (let i = 0; i < arr.length; i++) { x -= weights[i]; if (x < 0) return arr[i]; }
      return arr[arr.length - 1];
    };

    const [ty, tm, td] = todayIso.split("-").map(Number);
    const todayT = Date.UTC(ty, tm - 1, td), startT = Date.UTC(ty - 1, 0, 1);
    const startYear = ty - 1;
    const totalDays = Math.round((todayT - startT) / DAY);
    const isoAt = t => { const d = new Date(t); return `${ym(d.getUTCFullYear(), d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`; };
    const incomes = [], expenses = [];
    const addExpense = (day, etype, item, client, amount, pay, payable) => expenses.push({
      trx_date: day, expense_type: etype, item, payment_type: pay, client,
      amount, memo: "데모 데이터", quantity: 1, unit_price: amount, payable,
    });

    for (let i = 0; i <= totalDays; i++) {
      const d = new Date(startT + i * DAY);
      const day = isoAt(startT + i * DAY);
      const off = totalDays - i;         // 오늘로부터 며칠 전
      const years = i / 365;             // 시작일로부터 지난 해 수
      const wd = (d.getUTCDay() + 6) % 7;  // 0 = 월요일
      const year = d.getUTCFullYear(), month = d.getUTCMonth() + 1, dom = d.getUTCDate();
      const firstYear = year === startYear;
      if (wd !== 6) {                    // 일요일은 쉰다
        const lam = 2.0 * WEEKDAY[wd] * SEASON[month - 1] * (1 + 0.04 * years);
        const n = Math.floor(lam + rng() * 2 - 0.5);
        for (let j = 0; j < n; j++) {
          const isService = rng() < SERVICE_SHARE;
          const kinds = isService ? SERVICES : PRODUCTS;
          const cat = wpick(kinds, kinds.map(k => k[1] * (1 + (k[5] - 1) * years)));
          const maker = wpick(MAKERS, MAKERS.map(m => m[1] * (1 + (m[3] - 1) * years)));
          const car = pick(carModels[maker[0]]);
          const cw = CLIENTS.map(c => {
            const active = (c[4] === 0 || off >= c[4]) && (c[5] === 0 || off <= c[5]);
            return active ? (isService ? c[1] : c[2]) * (1 + (c[3] - 1) * years) : 0;
          });
          const client = wpick(CLIENTS, cw);
          let u = rng();
          u = u * (0.55 + 0.45 * u);     // 싼 쪽이 더 많게
          const amount = round10k((cat[2] + (cat[3] - cat[2]) * u) * 10000 * maker[2] * (1 + cat[4] * years));
          let pay;
          if (client[6] === "retail") pay = wpick(["카드", "현금", "계좌입금"], [55, 25, 20]);
          else if (client[6] === "dealer") pay = wpick(["계좌입금", "카드"], [85, 15]);
          else pay = "계좌입금";
          const tax = pay === "카드" || rng() < 0.3 ? "Y" : "N";
          const vat = (pay === "카드" || tax === "Y") ? Math.floor(amount * 10 / 110 + 0.5) : 0;
          const unit = isService && rng() < 0.4 ? pick(UNITS) : "";
          // 업체 거래 일부는 외상(미수금): 최근일수록 아직 못 받은 경우가 많게
          let receivable = 0;
          if (pay === "계좌입금" && client[6] === "dealer" && rng() < (off < 45 ? 0.6 : 0.04)) {
            receivable = rng() < 0.7 ? amount : Math.floor(amount / 2);
          }
          // 업체 소개·협업 작업은 일부를 거래처에 지급(미지급금, 매출에서 차감)
          let payout = 0, payoutDue = 0;
          if (client[6] === "dealer" && rng() < 0.25) {
            payout = Math.floor(amount * pick([0.2, 0.3, 0.4]) / 10000) * 10000;
            payoutDue = off < 30 && rng() < 0.6 ? payout : 0;
          }
          incomes.push({
            trx_date: day, income_type: isService ? "서비스제공" : "상품판매", category: cat[0],
            manufacturer: maker[0], car_model: car, product_model: unit, client: client[0],
            amount, vat, net_amount: amount - vat,
            account: pay === "카드" ? "카드" : "국민(법인)", payment_type: pay, tax_invoice: tax,
            memo: "데모 데이터", quantity: 1, unit_price: amount, currency: "KRW", exchange_rate: 1,
            receivable, payout, payout_due: payoutDue,
          });
          // 원가: 상품은 매입가(해마다 조금씩 오름), 수리는 일부에 부품·외주비
          if (!isService) {
            if (rng() < 0.9) {
              const cost = round10k(amount * (0.56 + 0.06 * years + 0.08 * rng()));
              const vendor = wpick(VENDORS, VENDOR_WEIGHTS);
              const cpay = wpick(["계좌입금", "카드"], [7, 3]);
              addExpense(day, "제품원가", "제품매입", vendor, cost, cpay, off < 40 && rng() < 0.5 ? cost : 0);
            }
          } else if (rng() < 0.35) {
            const cost = round10k(amount * (0.10 + 0.20 * rng()));
            const vendor = wpick(VENDORS, VENDOR_WEIGHTS);
            if (cost >= 10000) addExpense(day, "제품원가", "서비스이용", vendor, cost, "카드", 0);
          }
        }
        // 그날그날 나가는 작은 지출
        if (rng() < 0.7) {
          const amount = (1 + randint(3)) * 10000;
          addExpense(day, "비용", "식대", "식당", amount, pick(["카드", "현금"]), 0);
        }
        if (wd === 0) addExpense(day, "비용", "차량유지비", "주유소", (5 + randint(8)) * 10000, "카드", 0);
        if (wd === 5) addExpense(day, "생활", "마트", "마트", (3 + randint(8)) * 10000, "카드", 0);
        if (rng() < 0.06) {
          const who = pick(["철물점", "택배", "문구점"]);
          addExpense(day, "비용", "업무경비", who, (2 + randint(15)) * 10000, "카드", 0);
        }
      }
      // 달마다 정해진 날 나가는 지출 (쉬는 날이어도 나간다)
      if (dom === 10) {
        addExpense(day, "비용", "통신비", "통신사", 110000, "카드", 0);
        addExpense(day, "비용", "보험료", "보험사", 180000, "계좌입금", 0);
      }
      if (dom === 15) {
        addExpense(day, "비용", "수도광열비", "전기·가스", round10k(UTILITY[month - 1] * 10000 * (1 + 0.05 * years)), "계좌입금", 0);
      }
      if (dom === 20) addExpense(day, "비용", "광고비", "온라인 광고", firstYear ? 300000 : 500000, "카드", 0);
      if (dom === 25) {
        addExpense(day, "인건비", "급여", "직원", firstYear ? 3200000 : 3400000, "계좌입금", 0);
        addExpense(day, "비용", "임차료", "건물 임대인", firstYear ? 1500000 : 1600000, "계좌입금", 0);
        if (month === 1 || month === 4 || month === 7 || month === 10) {  // 부가세: 앞 분기 실매출의 3%쯤
          let qm = month - 3, qy = year;
          if (qm < 1) { qm += 12; qy -= 1; }
          const keys = [0, 1, 2].map(k => ym(qy, qm + k));
          let base = 0;
          for (const r of incomes) if (keys.includes(r.trx_date.slice(0, 7))) base += r.amount - r.payout;
          const taxDue = Math.floor(base * 0.03 / 100000 + 0.5) * 100000;
          if (taxDue > 0) addExpense(day, "제세공과금", "부가세", "세무서", taxDue, "계좌입금", 0);
        }
      }
    }

    // 위안화(CNY) 거래 예시
    incomes.push({
      trx_date: isoAt(todayT - 3 * DAY), income_type: "상품판매", category: "앰프", manufacturer: "N/A", car_model: "",
      product_model: "", client: "해외 거래처", amount: 457200, vat: 0, net_amount: 457200,
      account: "기업(웰카오디오-개인)", payment_type: "계좌입금", tax_invoice: "N",
      memo: "데모 데이터 · CNY 거래 예시", quantity: 2, unit_price: 1200, currency: "CNY", exchange_rate: 190.5,
      receivable: 457200, payout: 0, payout_due: 0,
    });

    // 올해 월별 목표: 작년 같은 달 실적 기준 (매출·영업이익 +10%, 지출 예산 +5%, 10만원 단위)
    const targets = {};
    const r100k = v => Math.floor(v / 100000 + 0.5) * 100000;
    for (let m = 1; m <= 12; m++) {
      const month = ym(ty - 1, m);
      let sales = 0, spent = 0;
      for (const r of incomes) if (r.trx_date.slice(0, 7) === month) sales += r.amount - r.payout;
      for (const r of expenses) if (r.trx_date.slice(0, 7) === month) spent += r.amount;
      targets[ym(ty, m)] = { sales: r100k(sales * 1.1), profit: r100k((sales - spent) * 1.1), expense: r100k(spent * 1.05) };
    }
    return { incomes, expenses, targets };
  }

  const api = { generate, mulberry32 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WellcarDemoSeed = api;
})(typeof window !== "undefined" ? window : this);
