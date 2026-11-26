/* 분석 화면(매출 분석·지출 분석)이 함께 쓰는 도우미: 기간·비교 범위, 기간별 구간 합계, 순위 목록, 교차표, 엑셀 시트.
   app.js가 넘긴 ctx로 WellcarHubKit(ctx)를 만들어 sales.js·costs.js가 쓴다. 계산은 metrics.js가 한다. */
(function () {
  "use strict";

  window.WellcarHubKit = function make(ctx) {
    const { $, api, esc, fmt, fmtWon, todayStr, toast } = ctx;
    const M = window.WellcarMetrics;

    // ---------------------------------------------------------------- 표시 도우미
    const dash = '<span class="muted">–</span>';
    const has = v => v !== null && v !== undefined;
    const fmtPct = (v, digits) => (!has(v) || !isFinite(v) ? "–"
      : `${(Math.round(v * 10 ** (digits ?? 1)) / 10 ** (digits ?? 1)).toLocaleString("ko-KR")}%`);
    const unset = s => (s === "" || !has(s) ? "(미지정)" : s);
    const sum = a => a.reduce((x, y) => x + y, 0);
    /** 만 원 단위 짧은 금액 */
    const man = v => (!has(v) ? "–" : `${v < 0 ? "−" : ""}${Math.abs(Math.round(v / 10000)).toLocaleString("ko-KR")}만`);

    /** 증감 칩: 화살표는 방향, 색은 좋고 나쁨. pp=true면 %p */
    function changeChip(pct, upGood, pp) {
      if (!has(pct) || !isFinite(pct)) return dash;
      const r = Math.round(pct * 10) / 10, unit = pp ? "%p" : "%";
      if (r === 0) return `<span class="delta flat">― 0${unit}</span>`;
      const good = (r > 0) === upGood;
      return `<span class="delta ${good ? "up" : "down"}">${r > 0 ? "▲" : "▼"} ${Math.abs(r).toLocaleString("ko-KR")}${unit}</span>`;
    }

    /** /api/agg + 조건(f.분류=값, 빈 문자열은 '미지정'을 뜻함) */
    function aggf(kind, from, to, group, filters) {
      const p = new URLSearchParams({ kind, from, to });
      if (group) p.set("group", group);
      for (const [k, v] of Object.entries(filters || {})) if (has(v)) p.set("f." + k, v);
      return api(`/api/agg?${p}`).then(r => {
        if (r.truncated) toast("내역이 너무 많아 일부만 집계했습니다. 기간을 줄여 보세요.", true);
        return r.rows;
      });
    }
    const inRange = (r, range) => !!range && r.date >= range.from && r.date <= range.to;
    /** 표 칸 안의 짧은 금액: 만 원 단위 숫자만 */
    const fmtShort = v => (!has(v) ? "–" : Math.round(v / 10000).toLocaleString("ko-KR"));

    // ---------------------------------------------------------------- 기간·비교 범위
    const PERIODS = [["this-month", "이번 달", "month", 0], ["last-month", "지난 달", "month", -1],
      ["this-quarter", "이번 분기", "quarter", 0], ["last-quarter", "지난 분기", "quarter", -1],
      ["this-year", "올해", "year", 0], ["last-year", "작년", "year", -1],
      ["last-12m", "최근 12개월", null, 12], ["last-24m", "최근 24개월", null, 24], ["custom", "직접 지정", null, 0]];
    const minD = (a, b) => (a < b ? a : b);

    /**
     * 화면 상태(st: {period, from, to, compare})에서 집계 범위를 정한다.
     * 진행 중인 기간은 오늘까지만 보고, 비교(전년 동기·전기)도 같은 날짜 수만큼만 본다.
     * 반환 {cur, ly, prev, cmp, cmpName, label, days, win(받아 둘 자료 범위)} — 기간이 잘못됐으면 null
     */
    function resolveRange(st) {
      const today = todayStr();
      const def = PERIODS.find(p => p[0] === st.period) || PERIODS[4];
      let cur, ly, prev, label;
      if (def[2]) {
        const p = M.shift(M.periodOf(def[2], today), def[3]);
        if (p.start > today) return null;
        const going = p.end > today;
        cur = { from: p.start, to: going ? today : p.end };
        const days = M.diffDays(cur.from, cur.to) + 1;
        const cut = q => (going ? M.firstDays(q, days) : { from: q.start, to: q.end });
        ly = cut(M.lastYear(p));
        prev = cut(M.shift(p, -1));
        label = `${def[1]} (${p.label}${going ? " · 오늘까지" : ""})`;
      } else {
        if (def[0] === "custom") {
          if (!st.from || !st.to || st.from > st.to || st.from > today) return null;
          cur = { from: st.from, to: minD(st.to, today) };
          label = `${cur.from} ~ ${cur.to}`;
        } else {
          cur = { from: M.addDays(M.addMonths(today, -def[3]), 1), to: today };
          label = def[1];
        }
        const days = M.diffDays(cur.from, cur.to) + 1;
        ly = { from: M.addYears(cur.from, -1), to: M.addYears(cur.to, -1) };
        prev = { from: M.addDays(cur.from, -days), to: M.addDays(cur.from, -1) };
      }
      const cmp = st.compare === "prev" ? prev : ly;
      // 자료는 한 번에 받아 화면에서 나눈다: 전년 동기·전기, 12개월 추세선까지 덮는 범위(주 단위 정렬용 1주 여유)
      const start = [M.addYears(cur.from, -1), prev.from, ly.from, M.addDays(M.addMonths(cur.to, -13), 1)].reduce(minD);
      return {
        cur, ly, prev, cmp, cmpName: st.compare === "prev" ? "전기" : "전년 동기", label,
        days: M.diffDays(cur.from, cur.to) + 1, today,
        win: { from: M.addDays(start, -7), to: cur.to },
      };
    }

    /** 기간 선택 상자·날짜 칸·비교 선택을 상태에 묶는다 */
    function bindPeriod(ids, st, onChange) {
      const sel = $(ids.period), from = $(ids.from), to = $(ids.to), cmp = $(ids.compare);
      sel.innerHTML = PERIODS.map(p => `<option value="${p[0]}">${p[1]}</option>`).join("");
      const show = () => {
        sel.value = st.period;
        cmp.value = st.compare;
        const r = resolveRange(st);
        if (r && st.period !== "custom") { from.value = r.cur.from; to.value = r.cur.to; }
      };
      show();
      sel.addEventListener("change", () => {
        if (sel.value === "custom") { st.from = from.value; st.to = to.value; }
        st.period = sel.value;
        show();
        onChange();
      });
      for (const el of [from, to]) {
        el.addEventListener("change", () => {
          st.period = "custom"; st.from = from.value; st.to = to.value;
          sel.value = "custom";
          onChange();
        });
      }
      cmp.addEventListener("change", () => { st.compare = cmp.value; onChange(); });
      return show;
    }

    // ---------------------------------------------------------------- 기간별 보기
    // ma: 이동평균 구간 수, k: 추세를 볼 때 견주는 묶음(최근 k개 vs 그 앞 k개)
    const UNIT = {
      day: { label: "일별", one: "일", per: "하루마다", ma: 7, k: 7 }, week: { label: "주별", one: "주", per: "한 주마다", ma: 4, k: 4 },
      month: { label: "월별", one: "개월", per: "한 달마다", ma: 3, k: 3 }, quarter: { label: "분기별", one: "분기", per: "한 분기마다", ma: 4, k: 2 },
      year: { label: "연도별", one: "년", per: "한 해마다", ma: 0, k: 1 },
    };
    const MAX_BUCKETS = 120;
    /** 범위 길이에 어울리는 기본 단위 */
    const autoUnit = days => (days <= 45 ? "day" : days <= 200 ? "week" : days <= 1100 ? "month" : days <= 2600 ? "quarter" : "year");

    /**
     * 기간별 구간과 합계. idx: M.dateIndex, 반환 {rows: [{b, cur, prev, ly, going, partial}], cut(앞에서 잘라 낸 구간 수)}
     * going: 오늘이 든 진행 중 구간, partial: 범위에 잘려 온전하지 않은 구간
     */
    function series(idx, unit, range) {
      const today = todayStr();
      let buckets = M.periodsIn(unit, range.from, range.to);
      const cut = Math.max(0, buckets.length - MAX_BUCKETS);
      buckets = buckets.slice(cut);
      return {
        cut,
        rows: buckets.map(b => {
          // 오늘이 든 구간은 아직 끝나지 않았다(일 단위의 오늘 포함)
          const going = b.to === today && (unit === "day" || b.end > today);
          return {
            b, cur: idx.sum(b), prev: idx.sum(M.prevRangeOf(unit, b)), ly: idx.sum(M.lyRangeOf(unit, b)),
            going, partial: !b.full && !going,
          };
        }),
      };
    }
    /** 기간 칸: 이름(휴대폰에서는 짧은 이름) + 진행 중·일부 표시 */
    const periodCell = r => `<span class="only-wide">${esc(r.b.name)}</span><span class="only-narrow">${esc(r.b.tick)}</span>` +
      (r.going ? ' <span class="tag cur">진행 중</span>' : r.partial ? ' <span class="tag">일부</span>' : "");
    const periodTitle = r => r.b.name + (r.going ? " (진행 중)" : r.partial ? " (일부)" : "");

    /** 추세 한 줄 설명. vals: 온전한 구간의 값, name: '실매출' 등, upGood: 늘면 좋은지 */
    function trendNote(unit, vals, name, upGood, fmtVal) {
      const U = UNIT[unit], t = M.trendSummary(vals, U.k);
      if (!t.dir) return vals.length ? `추세는 온전한 ${U.label.replace("별", "")} 구간이 4개 이상일 때 계산합니다 (지금 ${vals.length}개).` : "";
      const word = t.dir === "up" ? "늘어나는" : t.dir === "down" ? "줄어드는" : "비슷한";
      const good = t.dir === "flat" ? "flat" : (t.dir === "up") === upGood ? "up" : "down";
      return `추세: <span class="delta ${good}">${t.dir === "up" ? "▲" : t.dir === "down" ? "▼" : "―"} ${word} 흐름</span> ` +
        `최근 ${t.k}${U.one} 평균 ${fmtVal(t.recent)} — 그 앞 ${t.k}${U.one}(${fmtVal(t.prior)})보다 ${fmtPct(Math.abs(t.changePct))} ${t.changePct >= 0 ? "많음" : "적음"}` +
        // 기간 전체에 그은 직선의 기울기는 방향이 같을 때만 덧붙인다(최근 흐름과 엇갈리면 헷갈린다)
        (has(t.slopePct) && t.dir !== "flat" && (t.slopePct > 0) === (t.changePct > 0) && Math.abs(t.slopePct) >= 0.1
          ? ` · 기간 전체로 보면 ${U.per} 평균 ${t.slopePct >= 0 ? "+" : "−"}${fmtPct(Math.abs(t.slopePct))}씩` : "");
    }

    // ---------------------------------------------------------------- 순위 목록 (값·비중·증감·추세선)
    /** rows를 keyFn으로 묶어 {key, v(값 합계), cnt, min, max, gross}. valueFn: 행의 값(실매출·지출금액) */
    function groupRows(rows, keyFn, valueFn) {
      const m = new Map();
      for (const r of rows) {
        const k = keyFn(r);
        let g = m.get(k);
        if (!g) { g = { key: k, v: 0, cnt: 0, gross: 0, min: null, max: null }; m.set(k, g); }
        g.v += valueFn(r);
        g.cnt += Number(r.cnt) || 0;
        g.gross += Number(r.amount) || 0;
        if (has(r.amount_min)) g.min = g.min === null ? r.amount_min : Math.min(g.min, r.amount_min);
        if (has(r.amount_max)) g.max = g.max === null ? r.amount_max : Math.max(g.max, r.amount_max);
      }
      return m;
    }
    /** 묶음의 값: 금액(v) / 건수(cnt) / 건당 평균(avg) */
    const measureOf = (g, measure) => (!g ? null : measure === "cnt" ? g.cnt : measure === "avg" ? (g.cnt ? g.v / g.cnt : null) : g.v);
    const fmtMeasure = (v, measure) => (!has(v) ? "–" : measure === "cnt" ? `${fmt(v)}건` : fmtWon(v));

    /**
     * 순위 목록 자료. cur·cmp: 기간·비교 기간의 행, trend: {rows, months} (월별 추세선용, 없으면 생략)
     * 반환 {items: [{key, g, v, c, spark}], totalV, totalCnt} — 값 큰 순
     */
    function rankData(cur, cmp, keyFn, valueFn, measure, trend) {
      const a = groupRows(cur, keyFn, valueFn), b = groupRows(cmp || [], keyFn, valueFn);
      const items = [...a.values()].filter(g => g.cnt > 0)
        .map(g => ({ key: g.key, g, v: measureOf(g, measure), c: measureOf(b.get(g.key), measure), cg: b.get(g.key) || null }))
        .sort((x, y) => (y.v ?? -Infinity) - (x.v ?? -Infinity));
      if (trend) {
        const byKeyMonth = new Map();
        for (const r of trend.rows) {
          const k = keyFn(r) + "\u001e" + r.date.slice(0, 7);
          let g = byKeyMonth.get(k);
          if (!g) { g = { v: 0, cnt: 0 }; byKeyMonth.set(k, g); }
          g.v += valueFn(r);
          g.cnt += Number(r.cnt) || 0;
        }
        for (const it of items) it.spark = trend.months.map(mk => measureOf(byKeyMonth.get(it.key + "\u001e" + mk) || { v: 0, cnt: 0 }, measure) || 0);
      }
      return { items, totalV: sum(items.map(it => it.g.v)), totalCnt: sum(items.map(it => it.g.cnt)), cmpHas: !!cmp };
    }

    /**
     * 순위 목록 HTML. o: {list(목록 이름), nameOf, measure, color, selected(고른 키), upGood, valueName('실매출'), top}
     * 줄을 누르면 data-list·data-key로 알 수 있다.
     */
    function rankHtml(data, o) {
      if (!data.items.length) return '<p class="empty-msg">이 기간·조건의 내역이 없습니다.</p>';
      const top = data.items.slice(0, o.top || 10);
      const max = Math.max(...top.map(it => Math.max(it.v || 0, 0)), 1);
      const rows = top.map(it => {
        const share = o.measure === "avg" ? null : o.measure === "cnt" ? (data.totalCnt ? it.g.cnt / data.totalCnt * 100 : null)
          : (data.totalV ? it.g.v / data.totalV * 100 : null);
        const on = o.selected !== undefined && o.selected === it.key, dim = o.selected !== undefined && !on;
        const meta = [has(share) ? fmtPct(share) : null, `${fmt(it.g.cnt)}건`,
          o.measure !== "avg" ? `건당 ${fmtWon(it.g.cnt ? it.g.v / it.g.cnt : 0)}` : `${o.valueName} ${fmtWon(it.g.v)}`].filter(Boolean);
        return `<button type="button" class="rank-row${on ? " on" : ""}${dim ? " dim" : ""}" data-list="${o.list}" data-key="${esc(it.key)}" aria-pressed="${on}">` +
          `<span class="rk-name" title="${esc(o.nameOf(it.key))}">${esc(o.nameOf(it.key))}</span>` +
          `<span class="rk-val">${fmtMeasure(it.v, o.measure)}</span>` +
          `<span class="rk-spark">${it.spark ? WCharts.spark(it.spark, o.color) : ""}</span>` +
          `<span class="rk-bar"><span style="width:${(Math.max(it.v || 0, 0) / max * 100).toFixed(1)}%;background:${o.color}"></span></span>` +
          `<span class="rk-chg">${!data.cmpHas ? "" : !has(it.c) ? '<span class="muted">신규</span>' : changeChip(M.pctChange(it.v, it.c), o.upGood)}</span>` +
          `<span class="rk-meta">${meta.join(" · ")}</span></button>`;
      }).join("");
      const rest = data.items.length - top.length;
      return rows + (rest > 0 ? `<p class="rank-more">외 ${fmt(rest)}개 · 전체는 엑셀로 받기에서 볼 수 있습니다</p>` : "");
    }

    // ---------------------------------------------------------------- 교차표 (칸이 진할수록 큼)
    /**
     * o: {rows: [키], cols: [키], rowName, colName, corner, cell(r, c) → {v, title}|null, rowTotal(r) → 값, fmtCell, tone('income'|'expense'),
     *     selRow, selCol}
     */
    function matrixHtml(o) {
      if (!o.rows.length || !o.cols.length) return '<p class="empty-msg">이 기간·조건의 내역이 없습니다.</p>';
      const vals = [];
      for (const r of o.rows) for (const c of o.cols) { const x = o.cell(r, c); if (x && x.v > 0) vals.push(x.v); }
      const max = Math.max(...vals, 1), tone = `var(--series-${o.tone || "income"})`;
      const head = `<tr><th>${esc(o.corner)}</th>${o.cols.map(c => `<th class="num${o.selCol === c ? " sel" : ""}">${esc(o.colName(c))}</th>`).join("")}` +
        (o.rowTotal ? '<th class="num">합계</th>' : "") + "</tr>";
      const body = o.rows.map(r => {
        const tds = o.cols.map(c => {
          const x = o.cell(r, c);
          if (!x || !x.v) return '<td class="num heat empty"><span class="muted">·</span></td>';
          const a = Math.round(12 + 78 * (Math.max(x.v, 0) / max));
          return `<td class="num heat${a > 55 ? " hot" : ""}${o.selRow === r || o.selCol === c ? " sel" : ""}" ` +
            `style="background:color-mix(in srgb, ${tone} ${a}%, var(--surface))" title="${esc(x.title || "")}">${o.fmtCell(x.v)}</td>`;
        }).join("");
        return `<tr${o.selRow === r ? ' class="sel"' : ""}><td class="strong">${esc(o.rowName(r))}</td>${tds}` +
          (o.rowTotal ? `<td class="num strong">${o.fmtCell(o.rowTotal(r))}</td>` : "") + "</tr>";
      }).join("");
      return `<table class="data compact matrix"><thead>${head}</thead><tbody>${body}</tbody></table>`;
    }

    // ---------------------------------------------------------------- 누름 단추 묶음·하위 탭
    function setSeg(id, attr, value) {
      document.querySelectorAll(`#${id} [data-${attr}]`).forEach(b => {
        const on = b.dataset[attr] === value;
        b.classList.toggle("on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    function bindSeg(id, attr, onPick) {
      $(id).addEventListener("click", e => {
        const b = e.target.closest(`[data-${attr}]`);
        if (!b || b.disabled) return;
        setSeg(id, attr, b.dataset[attr]);
        onPick(b.dataset[attr]);
      });
    }
    /** 하위 탭: #<tabsId> [data-tab] 단추와 #<prefix>-<tab> 구역 */
    function bindTabs(tabsId, prefix, tabs, st, onShow) {
      const show = () => {
        for (const t of tabs) $(`${prefix}-${t}`).hidden = t !== st.tab;
        document.querySelectorAll(`#${tabsId} [data-tab]`).forEach(b => {
          const on = b.dataset.tab === st.tab;
          b.classList.toggle("on", on);
          b.setAttribute("aria-selected", String(on));
        });
      };
      $(tabsId).addEventListener("click", e => {
        const b = e.target.closest("[data-tab]");
        if (!b || b.dataset.tab === st.tab) return;
        st.tab = b.dataset.tab;
        show();
        onShow();
      });
      show();
      return show;
    }

    // ---------------------------------------------------------------- 엑셀 시트
    const XS = () => window.WellcarXlsxWriter.S;
    const xl = {
      won: v => (!has(v) ? null : { v: Math.round(v), s: XS().won }),
      pct: v => (!has(v) || !isFinite(v) ? null : { v: v / 100, s: XS().pct }),
      head: v => ({ v, s: XS().head }),
      /** 제목·설명·머리글·내용·합계 줄로 된 시트 */
      sheet(name, title, sub, head, rows, widths, total) {
        const S = XS();
        const out = [[{ v: title, s: S.title }], [{ v: sub, s: S.muted }], [], head.map(v => ({ v, s: S.head }))].concat(rows);
        if (total) {
          out.push(total.map((c, i) => (c === null || c === undefined ? null
            : typeof c === "object" ? Object.assign({}, c, { s: c.s === S.pct ? S.totalPct : S.totalNum })
              : { v: c, s: i === 0 ? S.totalLabel : S.totalNum })));
        }
        return { name, widths, freeze: "B5", rows: out };
      },
    };

    return {
      M, dash, has, fmtPct, unset, sum, man, fmtShort, changeChip, aggf, inRange,
      PERIODS, resolveRange, bindPeriod, UNIT, autoUnit, series, periodCell, periodTitle, trendNote,
      groupRows, measureOf, fmtMeasure, rankData, rankHtml, matrixHtml,
      setSeg, bindSeg, bindTabs, xl,
    };
  };
})();
