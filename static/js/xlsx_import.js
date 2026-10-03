/* 엑셀(.xlsx/.xlsm) 브라우저 파서 — 외부 라이브러리 없이 ZIP + 시트 XML을 직접 해석.
   - 내역 시트: '영업일자'와 함께 '매출액'+'매출유형' 또는 '지출금액'+'지출유형' 열이 있는 시트
     (원본 경영관리 엑셀의 매출집계·지출집계와 월별 시트, 이 시스템이 내보낸 매출내역·지출내역)
   - 월별 합계 시트: '영업월'·'매출액'·'지출액' 열이 있는 시트(원본의 'OOOO년 경영분석')는
     엑셀이 직접 계산한 월 합계라서, 읽어 낸 내역과 맞는지 대조하는 데 쓴다. */
(function () {
  "use strict";

  const td = new TextDecoder();
  const readU16 = (b, o) => b[o] | (b[o + 1] << 8);
  const readU32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined")
      throw new Error("이 브라우저는 압축 해제를 지원하지 않습니다. 최신 크롬/엣지/사파리를 사용해 주세요.");
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    let eocd = -1;
    const scanEnd = Math.max(0, buf.length - 22 - 65536);
    for (let i = buf.length - 22; i >= scanEnd; i--) {
      if (readU32(buf, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("엑셀(zip) 형식이 아닙니다.");
    const count = readU16(buf, eocd + 10);
    let p = readU32(buf, eocd + 16);
    const entries = {};
    for (let i = 0; i < count; i++) {
      if (readU32(buf, p) !== 0x02014b50) break;
      const method = readU16(buf, p + 10);
      const compSize = readU32(buf, p + 20);
      const nameLen = readU16(buf, p + 28), extraLen = readU16(buf, p + 30), cmtLen = readU16(buf, p + 32);
      const localOffset = readU32(buf, p + 42);
      const name = td.decode(buf.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method, compSize, localOffset };
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return {
      async read(name) {
        const e = entries[name];
        if (!e) return null;
        const lp = e.localOffset;
        const nLen = readU16(buf, lp + 26), xLen = readU16(buf, lp + 28);
        const start = lp + 30 + nLen + xLen;
        const data = buf.subarray(start, start + e.compSize);
        if (e.method === 0) return data;
        if (e.method === 8) return inflateRaw(data);
        throw new Error("지원하지 않는 압축 방식입니다.");
      },
    };
  }

  const parseXml = bytes => new DOMParser().parseFromString(td.decode(bytes), "application/xml");

  function textOf(node) {
    let s = "";
    for (const t of node.getElementsByTagName("t")) s += t.textContent;
    return s;
  }

  function colOf(ref) {
    const m = /^([A-Z]+)\d+$/.exec(ref || "");
    return m ? m[1] : null;
  }

  const pad2 = n => String(n).padStart(2, "0");

  function serialToISO(n, date1904) {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.floor(n) * 86400000);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  function validYMD(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
      ? `${y}-${pad2(m)}-${pad2(d)}` : null;
  }

  /** 엑셀 날짜(일련번호) 또는 '2023-01-02', '2023.1.2', '2023/01/02', '2023년 1월 2일', '20230102' */
  function toISO(v, date1904) {
    if (typeof v === "number") {
      if (v > 25000 && v < 80000) return serialToISO(v, date1904);
      if (!(v >= 19000101 && v <= 21001231)) return null;  // 20230102 같은 숫자형 날짜만 아래에서 해석
    }
    const s = String(v ?? "").trim();
    let m = /^(\d{4})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/.exec(s);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
    if (m) return validYMD(+m[1], +m[2], +m[3]);
    return null;
  }

  /** 숫자 해석: 1,000 / ₩1,000 / 1,000원 / (1,000)=음수 / '-'=0 */
  function num(v) {
    if (typeof v === "number") return isFinite(v) ? v : 0;
    let s = String(v || "").trim();
    if (!s || s === "-") return 0;
    const neg = /^\(.*\)$/.test(s);
    s = s.replace(/[^\d.\-]/g, "");
    const n = parseFloat(s);
    return isFinite(n) ? (neg ? -Math.abs(n) : n) : 0;
  }
  const txt = v => (v === null || v === undefined) ? "" : String(v).trim();
  const isYes = v => /^(Y|YES|O|예|발행|TRUE|1)$/i.test(txt(v));

  /** 미수금·미지급금: 숫자면 금액, 'Y'·'미수' 같은 표시면 전액, 비었거나 'N'이면 0 */
  function balance(v, amount) {
    if (v === undefined || v === null || v === "") return 0;
    if (typeof v !== "number" && /^(Y|YES|O|예|미수|미지급|있음)$/i.test(txt(v))) return Math.max(amount, 0);
    const n = Math.round(num(v));
    return Math.min(Math.max(n, 0), Math.max(amount, 0));
  }

  function normCurrency(v) {
    const s = txt(v).toUpperCase();
    if (!s) return "KRW";
    if (/^(CNY|RMB|CNH|위안|元|위안화)$/.test(s)) return "CNY";
    if (/^(KRW|원|₩|원화)$/.test(s)) return "KRW";
    return s;
  }

  // 시트 XML → [{rowNum, cells: {A: value, ...}}]
  function readSheetRows(doc, sst) {
    const rows = [];
    for (const rowEl of doc.getElementsByTagName("row")) {
      const cells = {};
      for (const c of rowEl.getElementsByTagName("c")) {
        const col = colOf(c.getAttribute("r"));
        if (!col) continue;
        const t = c.getAttribute("t");
        let value = null;
        if (t === "inlineStr") {
          value = textOf(c);
        } else {
          const vEl = c.getElementsByTagName("v")[0];
          if (!vEl) continue;
          const raw = vEl.textContent;
          if (t === "s") value = sst[+raw] ?? "";
          else if (t === "str") value = raw;
          else if (t === "b") value = raw === "1" ? "Y" : "N";
          else if (t === "e") value = null;      // #DIV/0! 같은 오류 값
          else value = parseFloat(raw);
        }
        if (value !== null && value !== "") cells[col] = value;
      }
      if (Object.keys(cells).length)
        rows.push({ rowNum: +rowEl.getAttribute("r") || rows.length + 1, cells });
    }
    return rows;
  }

  // 표준 필드 → 헤더 이름 후보(공백·줄바꿈을 지운 이름). 원본 엑셀과 이 시스템이 내보낸 파일을 모두 읽는다.
  const COMMON = {
    currency: ["거래통화", "통화"],
    exchange_rate: ["CNY기준환율", "기준환율", "환율"],
    quantity: ["수량"],
    unit_price: ["단가"],
  };
  const INCOME_HEADERS = Object.assign({
    trx_date: ["영업일자"], income_type: ["매출유형"], category: ["매출구분"],
    manufacturer: ["차량제조사"], product_model: ["제품모델"], client: ["거래처명", "거래처"],
    amount: ["매출액"], cash: ["현금매출액"], card: ["카드매출액"], vat: ["부가세"],
    net_amount: ["순매출액"], account: ["계좌"], payment_type: ["결제유형"],
    tax_invoice: ["세금계산서발행유무", "세금계산서"], memo: ["적요"],
    receivable: ["미수금"], payable_note: ["미지급금"],
  }, COMMON);
  const EXPENSE_HEADERS = Object.assign({
    trx_date: ["영업일자"], expense_type: ["지출유형"], item: ["거래품목"],
    payment_type: ["결제유형"], client: ["거래처명", "거래처"], amount: ["지출금액"],
    memo: ["적요"], payable: ["미지급금"],
  }, COMMON);

  const norm = s => String(s).replace(/\s+/g, "");

  /** 한 행의 헤더 이름 → 열 문자 (같은 이름이 여러 번이면 왼쪽 것) */
  function headerMap(row) {
    const map = {};
    for (const [col, v] of Object.entries(row.cells))
      if (typeof v === "string" && !(norm(v) in map)) map[norm(v)] = col;
    return map;
  }

  function resolve(map, spec) {
    const cols = {};
    for (const [field, names] of Object.entries(spec)) {
      const hit = names.find(n => map[n]);
      if (hit) cols[field] = map[hit];
    }
    return cols;
  }

  function findHeader(rows, maxRow, test) {
    for (const r of rows) {
      if (r.rowNum > maxRow) break;
      const map = headerMap(r);
      if (test(map)) return { headerRow: r.rowNum, map };
    }
    return null;
  }

  const fmtNum = n => Math.round(n).toLocaleString("ko-KR");
  const MAX_ISSUES = 300;

  function extractEntries(sheetName, rows, date1904, issues) {
    const h = findHeader(rows, 15, m => m["영업일자"]);
    if (!h) return null;
    const isIncome = h.map["매출액"] && h.map["매출유형"];
    const isExpense = h.map["지출금액"] && h.map["지출유형"];
    if (!isIncome && !isExpense) return null;
    const kind = isIncome ? "income" : "expense";
    const cols = resolve(h.map, isIncome ? INCOME_HEADERS : EXPENSE_HEADERS);
    // level: skip(건너뛴 행) / info(등록은 하되 알아 둘 점)
    const note = (row, reason, level) => {
      if (issues.length < MAX_ISSUES) issues.push({ sheet: sheetName, row, reason, level: level || "info" });
    };

    const records = [];
    let skipped = 0;
    for (const r of rows) {
      if (r.rowNum <= h.headerRow) continue;
      const cell = f => cols[f] ? r.cells[cols[f]] : undefined;
      const rawDate = cell("trx_date");
      const amount = Math.round(num(cell("amount")));
      if (rawDate === undefined) {
        // 날짜 없이 금액만 있는 행은 합계 행이거나 입력 누락일 수 있어 알려 준다
        if (amount && Object.keys(r.cells).length > 1) {
          skipped++;
          note(r.rowNum, `영업일자 없이 금액 ${fmtNum(amount)}원이 있어 건너뜀 (합계 행인지 확인)`, "skip");
        }
        continue;
      }
      const trx_date = toISO(rawDate, date1904);
      if (!trx_date) {
        skipped++;
        note(r.rowNum, `영업일자 '${txt(rawDate).slice(0, 20)}'을(를) 날짜로 읽을 수 없어 건너뜀`, "skip");
        continue;
      }
      if (!amount) { skipped++; continue; }  // 금액 0/누락 행(빈 서식 행)은 조용히 건너뜀
      const src = `${sheetName}!${r.rowNum}`;

      const currency = normCurrency(cell("currency"));
      const qty = num(cell("quantity")) || 1;
      let rate = num(cell("exchange_rate"));
      let unit = num(cell("unit_price"));
      if (currency !== "KRW" && !rate && !unit)
        note(r.rowNum, `${currency} 거래인데 환율·단가가 없어 원화 금액만 저장`);
      if (!rate) rate = currency === "KRW" ? 1 : (unit ? amount / (qty * unit) : 1);
      if (!unit) unit = amount / qty / (currency === "KRW" ? 1 : rate);
      unit = Math.round(unit * 100) / 100;
      rate = Math.round(rate * 10000) / 10000;
      if (currency !== "KRW" && Math.abs(qty * unit * rate - amount) > 1)
        note(r.rowNum, `${currency} 금액 확인 필요: 수량×단가×환율(${fmtNum(qty * unit * rate)}) ≠ 금액(${fmtNum(amount)}). 엑셀의 원화 금액으로 저장`);
      const common = {
        trx_date, client: txt(cell("client")), currency, exchange_rate: rate, quantity: qty,
        unit_price: unit, amount, payment_type: txt(cell("payment_type")), src,
      };

      if (isIncome) {
        const vat = Math.round(num(cell("vat")));
        if (!common.payment_type) {
          if (num(cell("card")) > 0) common.payment_type = "카드";
          else if (num(cell("cash")) > 0) common.payment_type = "현금";
        }
        let memo = txt(cell("memo"));
        // 원본 매출집계에만 있는 '미지급금' 열은 담을 곳이 없어 적요에 남긴다
        const payNote = cell("payable_note");
        if (payNote !== undefined && txt(payNote) && !/^(N|NO|0|-)$/i.test(txt(payNote))) {
          const n = num(payNote);
          memo = (memo ? memo + " " : "") + (n ? `[미지급금 ${fmtNum(n)}원]` : `[미지급금 ${txt(payNote)}]`);
          note(r.rowNum, "매출 행의 미지급금 값을 적요에 기록");
        }
        let incomeType = txt(cell("income_type"));
        if (!incomeType) { incomeType = "기타"; note(r.rowNum, "매출유형이 비어 있어 '기타'로 등록"); }
        records.push(Object.assign(common, {
          income_type: incomeType,
          category: txt(cell("category")),
          manufacturer: txt(cell("manufacturer")),
          product_model: txt(cell("product_model")),
          vat,
          net_amount: Math.round(num(cell("net_amount"))) || (amount - vat),
          account: txt(cell("account")),
          tax_invoice: isYes(cell("tax_invoice")) ? "Y" : "N",
          memo,
          receivable: balance(cell("receivable"), amount),
        }));
      } else {
        let expenseType = txt(cell("expense_type"));
        if (!expenseType) { expenseType = "기타"; note(r.rowNum, "지출유형이 비어 있어 '기타'로 등록"); }
        records.push(Object.assign(common, {
          expense_type: expenseType,
          item: txt(cell("item")),
          memo: txt(cell("memo")),
          payable: balance(cell("payable"), amount),
        }));
      }
    }
    return { kind, records, skipped, headerRow: h.headerRow };
  }

  /** '영업월'·'매출액'·'지출액' 표에서 월별 합계를 읽는다 (원본 'OOOO년 경영분석' 시트). */
  function extractMonthly(sheetName, rows) {
    const h = findHeader(rows, 60, m => m["영업월"] && m["매출액"] && (m["지출액"] || m["지출금액"]) && !m["영업일자"]);
    if (!h) return null;
    const cMonth = h.map["영업월"], cInc = h.map["매출액"], cExp = h.map["지출액"] || h.map["지출금액"];
    const months = [];
    for (const r of rows) {
      if (r.rowNum <= h.headerRow) continue;
      const mv = r.cells[cMonth];
      let year = null, month = null, m;
      if (typeof mv === "number" && mv >= 1 && mv <= 12 && Number.isInteger(mv)) month = mv;
      else if ((m = /^(\d{1,2})\s*월$/.exec(txt(mv)))) month = +m[1];
      else if ((m = /^(\d{4})\D?(\d{1,2})$/.exec(txt(mv)))) { year = +m[1]; month = +m[2]; }
      if (!month || month > 12) continue;  // '합계', '월 평균' 등
      months.push({ year, month, income: Math.round(num(r.cells[cInc])), expense: Math.round(num(r.cells[cExp])) });
    }
    return months.length ? { sheet: sheetName, months } : null;
  }

  /**
   * 파일 하나를 분석한다.
   * 반환: { file, sheets: [{id, file, name, kind, records, skipped}], summaries: [...], issues: [...] }
   */
  async function parse(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const zip = await unzip(buf);

    const wbBytes = await zip.read("xl/workbook.xml");
    if (!wbBytes) throw new Error("엑셀 통합문서(xl/workbook.xml)를 찾을 수 없습니다.");
    const wb = parseXml(wbBytes);
    const date1904 = [...wb.getElementsByTagName("workbookPr")]
      .some(el => ["1", "true"].includes(el.getAttribute("date1904")));

    const relsBytes = await zip.read("xl/_rels/workbook.xml.rels");
    const relMap = {};
    if (relsBytes) {
      for (const rel of parseXml(relsBytes).getElementsByTagName("Relationship")) {
        let target = rel.getAttribute("Target") || "";
        if (target.startsWith("/")) target = target.slice(1);
        else target = "xl/" + target.replace(/^\.\//, "");
        relMap[rel.getAttribute("Id")] = target;
      }
    }

    const sstBytes = await zip.read("xl/sharedStrings.xml");
    const sst = [];
    if (sstBytes) {
      for (const si of parseXml(sstBytes).getElementsByTagName("si")) sst.push(textOf(si));
    }

    const result = { file: file.name, sheets: [], summaries: [], issues: [] };
    for (const sheetEl of wb.getElementsByTagName("sheet")) {
      const name = sheetEl.getAttribute("name");
      const rid = sheetEl.getAttribute("r:id") || sheetEl.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const path = relMap[rid];
      if (!path) continue;
      const bytes = await zip.read(path);
      if (!bytes) continue;
      const rows = readSheetRows(parseXml(bytes), sst);
      const sheetIssues = [];
      const ex = extractEntries(name, rows, date1904, sheetIssues);
      if (ex) {
        if (ex.records.length || sheetIssues.length) {
          result.sheets.push({ id: `${file.name} › ${name}`, file: file.name, name, kind: ex.kind,
            records: ex.records, skipped: ex.skipped });
          for (const it of sheetIssues) result.issues.push(Object.assign({ file: file.name }, it));
        }
        continue;
      }
      const mo = extractMonthly(name, rows);
      if (mo) result.summaries.push(Object.assign({ file: file.name }, mo));
    }
    return result;
  }

  const incKey = r => [r.trx_date, r.income_type, r.category, r.client, r.amount, r.vat, r.memo].join("\u0001");
  const expKey = r => [r.trx_date, r.expense_type, r.item, r.client, r.amount, r.memo].join("\u0001");

  /**
   * 고른 시트의 내역을 합친다. 같은 내역이 다른 시트에도 있으면(예: 매출집계와 매출집계_1월)
   * 먼저 나온 시트의 것만 쓰고, 한 시트 안의 같은 내역은 정당한 중복 거래로 보고 모두 쓴다.
   */
  function combine(sheets, selectedIds) {
    const out = { incomes: [], expenses: [], dupInFile: 0, perSheet: {} };
    const seen = new Map();
    for (const s of sheets) {
      if (!selectedIds.has(s.id)) continue;
      let used = 0, dup = 0;
      for (const rec of s.records) {
        const key = s.kind + "\u0002" + (s.kind === "income" ? incKey(rec) : expKey(rec));
        const first = seen.get(key);
        if (first !== undefined && first !== s.id) { dup++; continue; }
        seen.set(key, s.id);
        (s.kind === "income" ? out.incomes : out.expenses).push(rec);
        used++;
      }
      out.dupInFile += dup;
      out.perSheet[s.id] = { used, dup };
    }
    return out;
  }

  window.WellcarXlsx = { parse, combine, toISO, num };
})();
