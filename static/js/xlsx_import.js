/* 엑셀(.xlsx/.xlsm) 브라우저 파서 — 외부 라이브러리 없이 ZIP + 시트 XML을 직접 해석.
   엑셀 '매출집계*' / '지출집계*' 시트에서 수입/지출 내역을 추출한다. */
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

  function serialToISO(n, date1904) {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const d = new Date(epoch + Math.floor(n) * 86400000);
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }

  function toISO(v, date1904) {
    if (typeof v === "number" && v > 25000 && v < 80000) return serialToISO(v, date1904);
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
    return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
  }

  const num = v => {
    const n = typeof v === "number" ? v : parseFloat(String(v || "").replace(/,/g, ""));
    return isFinite(n) ? n : 0;
  };
  const txt = v => (v === null || v === undefined) ? "" : String(v).trim();

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
          else value = parseFloat(raw);
        }
        if (value !== null && value !== "") cells[col] = value;
      }
      if (Object.keys(cells).length)
        rows.push({ rowNum: +rowEl.getAttribute("r") || rows.length + 1, cells });
    }
    return rows;
  }

  // 헤더 텍스트 → 열 문자 매핑 (상위 10행 내에서 '영업일자'가 있는 행을 헤더로 간주)
  function findHeader(rows) {
    for (const r of rows.slice(0, 12)) {
      const map = {};
      for (const [col, v] of Object.entries(r.cells))
        if (typeof v === "string") map[v.trim()] = col;
      if (map["영업일자"]) return { headerRow: r.rowNum, map };
    }
    return null;
  }

  function extractFromSheet(sheetName, rows, date1904) {
    const h = findHeader(rows);
    if (!h) return null;
    const m = h.map;
    const isIncome = m["매출액"] && m["매출유형"];
    const isExpense = m["지출금액"] && m["지출유형"];
    if (!isIncome && !isExpense) return null;

    const records = [];
    let skipped = 0;
    for (const r of rows) {
      if (r.rowNum <= h.headerRow) continue;
      const cell = name => m[name] ? r.cells[m[name]] : undefined;
      const trx_date = toISO(cell("영업일자"), date1904);
      const amount = Math.round(num(cell(isIncome ? "매출액" : "지출금액")));
      if (!trx_date) continue;               // 빈 행/수식 잔여 행
      if (!amount) { skipped++; continue; }  // 금액 0/누락 행
      if (isIncome) {
        const vat = Math.round(num(cell("부가세")));
        let payment = txt(cell("결제유형"));
        if (!payment) {
          if (num(cell("카드매출액")) > 0) payment = "카드";
          else if (num(cell("현금매출액")) > 0) payment = "현금";
        }
        const taxRaw = txt(cell("세금계산서발행유무")).toUpperCase();
        records.push({
          trx_date,
          income_type: txt(cell("매출유형")) || "기타",
          category: txt(cell("매출구분")),
          manufacturer: txt(cell("차량제조사")),
          product_model: txt(cell("제품모델")),
          client: txt(cell("거래처명")),
          currency: "KRW", exchange_rate: 1, quantity: 1, unit_price: amount,
          amount, vat,
          net_amount: Math.round(num(cell("순매출액"))) || (amount - vat),
          account: txt(cell("계좌")),
          payment_type: payment,
          tax_invoice: taxRaw === "Y" ? "Y" : "N",
          memo: txt(cell("적요")),
        });
      } else {
        records.push({
          trx_date,
          expense_type: txt(cell("지출유형")) || "기타",
          item: txt(cell("거래품목")),
          payment_type: txt(cell("결제유형")),
          client: txt(cell("거래처명")),
          currency: "KRW", exchange_rate: 1, quantity: 1, unit_price: amount,
          amount,
          memo: txt(cell("적요")),
        });
      }
    }
    return { kind: isIncome ? "income" : "expense", records, skipped };
  }

  const incKey = r => [r.trx_date, r.income_type, r.category, r.client, r.amount, r.vat, r.memo].join("");
  const expKey = r => [r.trx_date, r.expense_type, r.item, r.client, r.amount, r.memo].join("");

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

    const result = { incomes: [], expenses: [], sheets: [], skippedRows: 0, dupInFile: 0 };
    const seen = new Map(); // key → 최초 발견 시트 (시트 간 중복 제거, 시트 내 중복은 유지)

    for (const sheetEl of wb.getElementsByTagName("sheet")) {
      const name = sheetEl.getAttribute("name");
      const rid = sheetEl.getAttribute("r:id") || sheetEl.getAttributeNS(
        "http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
      const path = relMap[rid];
      if (!path) continue;
      const bytes = await zip.read(path);
      if (!bytes) continue;
      const rows = readSheetRows(parseXml(bytes), sst);
      const ex = extractFromSheet(name, rows, date1904);
      if (!ex || !ex.records.length) continue;
      let added = 0;
      for (const rec of ex.records) {
        const key = (ex.kind === "income" ? "I" : "E") + (ex.kind === "income" ? incKey(rec) : expKey(rec));
        const firstSheet = seen.get(key);
        if (firstSheet !== undefined && firstSheet !== name) { result.dupInFile++; continue; }
        seen.set(key, name);
        (ex.kind === "income" ? result.incomes : result.expenses).push(rec);
        added++;
      }
      result.skippedRows += ex.skipped;
      result.sheets.push({ name, kind: ex.kind, count: added });
    }
    return result;
  }

  window.WellcarXlsx = { parse };
})();
