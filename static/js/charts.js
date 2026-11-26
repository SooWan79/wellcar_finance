/* 경량 SVG 차트 (외부 라이브러리 없이 동작)
   - groupedBars: 묶음 막대(+ 목표 같은 기준선 표시, 이동평균 같은 겹침 선), 음수 지원
   - lines: 꺾은선(누적 손익·예측 등), 십자선 툴팁, 음수 지원, 예측 범위 띠·구분선
   - hBars: 항목별 가로 막대(비중)
   - spark: 표 안에 넣는 작은 추세선(SVG 문자열)
   - mini: 여러 개를 나란히 놓는 작은 꺾은선(유형별 추세·가격 추이), 범위 띠·툴팁
   - scatter: 점 그림(비중 × 증감률 지도), 기준선·사분면 이름·겹치지 않는 이름표
   색은 호출하는 쪽이 디자인 토큰(--series-*)에서 읽어 넘긴다. 글자는 항상 글자색 토큰을 쓴다. */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const tooltip = () => document.getElementById("tooltip");
  const BAR_MAX = 24;  // 막대는 최대 24px — 칸이 넓어도 남는 폭은 여백으로

  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  const fmtWon = v => "₩" + Math.round(v).toLocaleString("ko-KR");

  // 거래처명 등 데이터 값은 HTML로 해석되지 않게 이스케이프
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g,
      c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /** 0을 포함하는 깔끔한 눈금 (음수 구간도) */
  function niceScale(minV, maxV, count) {
    minV = Math.min(0, minV);
    maxV = Math.max(0, maxV);
    if (maxV - minV <= 0) maxV = 1;
    const rough = (maxV - minV) / count;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    let step = pow;
    for (const c of [1, 2, 2.5, 5, 10]) {
      if (rough <= c * pow) { step = c * pow; break; }
    }
    const lo = Math.floor(minV / step + 1e-9) * step;  // 0은 0으로 (작은 오차로 한 칸 내려가지 않게)
    const hi = Math.ceil(maxV / step - 1e-9) * step;
    const ticks = [];
    for (let v = lo; v <= hi + step * 1e-6; v += step) ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    return { lo, hi: hi === lo ? lo + step : hi, ticks };
  }

  function fmtTick(v) {
    const a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 100000000) return s + (a / 100000000).toLocaleString("ko-KR", { maximumFractionDigits: 1 }) + "억";
    if (a >= 10000) return s + (a / 10000).toLocaleString("ko-KR") + "만";
    return s + a.toLocaleString("ko-KR");
  }

  /** 툴팁: 값이 먼저(굵게), 이름은 보조. shape: bar(네모) / line(짧은 선) */
  function showTip(evt, title, rows) {
    const t = tooltip();
    t.innerHTML = `<div class="tt-title">${esc(title)}</div>` + rows.map(r =>
      `<div class="tt-row"><span class="tt-key ${r.shape === "line" ? "line" : r.shape === "tick" ? "tick" : ""}" style="background:${r.color}"></span>` +
      `<span>${esc(r.name)}</span><span class="v">${r.value === null || r.value === undefined ? "–" : (r.fmt || fmtWon)(r.value)}</span></div>`).join("");
    t.hidden = false;
    const pad = 14;
    let x = evt.clientX + pad, y = evt.clientY + pad;
    const rect = t.getBoundingClientRect();
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    t.style.left = x + "px";
    t.style.top = y + "px";
  }
  function hideTip() { const t = tooltip(); if (t) t.hidden = true; }
  // 휴대폰: 누르면 뜬 툴팁이 남지 않게 스크롤하거나 차트 밖을 누르면 닫는다
  window.addEventListener("scroll", hideTip, { passive: true });
  document.addEventListener("touchstart", e => {
    if (!(e.target.closest && e.target.closest("svg, .hbar-row"))) hideTip();
  }, { passive: true });

  /** 범례: 막대는 네모, 선은 짧은 선, 목표선은 짧은 눈금 */
  function legend(container, items) {
    const lg = document.createElement("div");
    lg.className = "legend";
    for (const it of items) {
      const key = document.createElement("span");
      key.className = "key";
      const sw = document.createElement("span");
      sw.className = "swatch" + (it.shape === "line" ? " line" : it.shape === "tick" ? " tick" : it.shape === "band" ? " band" : "") + (it.dashed ? " dashed" : "");
      sw.style.background = it.dashed ? "transparent" : it.color;
      if (it.dashed) sw.style.borderColor = it.color;
      key.appendChild(sw);
      key.appendChild(document.createTextNode(it.name));
      lg.appendChild(key);
    }
    container.appendChild(lg);
  }

  /** 그릴 영역 크기: 상자 폭에 맞춰(글자가 작아지지 않게) 320~960px, 좁으면 낮게 */
  function frame(container) {
    const w = Math.round(container.clientWidth || 960);
    const W = Math.max(320, Math.min(960, w));
    return { W, H: W < 600 ? 230 : 300, narrow: W < 600 };
  }

  function axes(svg, m, iw, ih, scale, y, tickFmt) {
    for (const tv of scale.ticks) {
      const gy = y(tv);
      svg.appendChild(el("line", {
        x1: m.left, x2: m.left + iw, y1: gy, y2: gy,
        stroke: tv === 0 ? "var(--baseline)" : "var(--grid-line)", "stroke-width": 1,
      }));
      const lbl = el("text", { x: m.left - 8, y: gy + 4, "text-anchor": "end", "font-size": 11, fill: "var(--ink-3)" });
      lbl.textContent = (tickFmt || fmtTick)(tv);
      svg.appendChild(lbl);
    }
  }

  /** 막대 경로: 기준선(base)에서 끝(end)까지, 끝 쪽만 4px 둥글게 (SVG 좌표라 위가 작은 값) */
  function barPath(x, w, base, end) {
    const top = Math.min(base, end), h = Math.abs(end - base);
    const r = Math.min(4, w / 2, h);
    if (end <= base) {  // 양수: 위쪽 끝이 둥금
      return `M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${top + h} Z`;
    }
    return `M${x},${top} H${x + w} V${top + h - r} Q${x + w},${top + h} ${x + w - r},${top + h} H${x + r} Q${x},${top + h} ${x},${top + h - r} Z`;
  }

  /**
   * 묶음 막대 차트.
   * labels: x축 라벨, series: [{name, color, values:[숫자|null]}],
   * opts: {xLabelFn, xTickEvery, titleFn, markers: {name, color, values}}  — markers는 목표 같은 기준값(짧은 가로선)
   *       lines: [{name, color, values, dashed}] — 막대 위에 겹쳐 그리는 선(이동평균·이익 등, 같은 눈금)
   */
  function groupedBars(container, labels, series, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!labels.length) {
      container.innerHTML = '<p class="empty-msg">표시할 데이터가 없습니다.</p>';
      return;
    }
    const mk = opts.markers && opts.markers.values.some(v => v !== null && v !== undefined) ? opts.markers : null;
    const over = (opts.lines || []).filter(l => l.values.some(v => v !== null && v !== undefined));
    const legendItems = series.map(s => ({ name: s.name, color: s.color }));
    if (mk) legendItems.push({ name: mk.name, color: mk.color, shape: "tick" });
    for (const l of over) legendItems.push({ name: l.name, color: l.color, shape: "line", dashed: l.dashed });
    if (legendItems.length >= 2) legend(container, legendItems);

    const { W, H, narrow } = frame(container);
    const m = { top: 12, right: 10, bottom: 34, left: narrow ? 48 : 60 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    if (opts.ariaLabel) svg.setAttribute("aria-label", opts.ariaLabel);

    const all = series.flatMap(s => s.values).concat(mk ? mk.values : []).concat(over.flatMap(l => l.values))
      .filter(v => v !== null && v !== undefined);
    const scale = niceScale(Math.min(0, ...all), Math.max(0, ...all), 4);
    const y = v => m.top + ih - (v - scale.lo) / (scale.hi - scale.lo) * ih;
    axes(svg, m, iw, ih, scale, y, opts.tickFmt);

    const n = labels.length, sn = series.length;
    const slot = iw / n;
    const gap = 2;  // 맞닿은 막대 사이 2px
    const groupPad = Math.min(slot * 0.18, 14);
    const barW = Math.max(2, Math.min(BAR_MAX, (slot - groupPad * 2 - gap * (sn - 1)) / sn));
    const groupW = barW * sn + gap * (sn - 1);
    // x축 글자는 서로 겹치지 않게 최소 42px 간격
    const xTickEvery = Math.max(opts.xTickEvery || 1, Math.ceil(n * 42 / iw));
    const y0 = y(0);
    const hovers = [];

    labels.forEach((lab, i) => {
      const gx = m.left + i * slot;
      const bx0 = gx + (slot - groupW) / 2;
      const hover = el("rect", { x: gx + 1, y: m.top, width: slot - 2, height: ih, fill: "var(--accent-soft)", opacity: 0, rx: 4 });
      hovers.push(hover);
      svg.appendChild(hover);
      series.forEach((s, si) => {
        const v = s.values[i];
        if (v === null || v === undefined || v === 0) return;
        const bx = bx0 + si * (barW + gap);
        let vy = y(v);
        if (Math.abs(vy - y0) < 2) vy = y0 + (v > 0 ? -2 : 2);  // 아주 작은 값도 보이게 최소 2px
        svg.appendChild(el("path", { d: barPath(bx, barW, y0, vy), fill: s.color }));
      });
      if (mk && mk.values[i] !== null && mk.values[i] !== undefined) {
        const ty = y(mk.values[i]);
        svg.appendChild(el("line", {
          x1: bx0 - 3, x2: bx0 + groupW + 3, y1: ty, y2: ty,
          stroke: mk.color, "stroke-width": 2, "stroke-linecap": "round",
        }));
      }
      if (i % xTickEvery === 0) {
        const t = el("text", { x: gx + slot / 2, y: m.top + ih + 18, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-3)" });
        t.textContent = opts.xLabelFn ? opts.xLabelFn(lab, i) : lab;
        svg.appendChild(t);
      }
    });
    // 겹침 선: 막대 묶음 가운데를 잇는다 (막대보다 위, 누름 영역보다 아래)
    for (const l of over) {
      let d = "", last = -1;
      l.values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        d += (last === i - 1 && d ? " L" : " M") + (m.left + (i + 0.5) * slot).toFixed(1) + "," + y(v).toFixed(1);
        last = i;
      });
      if (!d) continue;
      // 바탕색 테두리를 먼저 깔아 막대 위에서도 선이 또렷하게
      svg.appendChild(el("path", { d: d.trim(), fill: "none", stroke: "var(--surface)", "stroke-width": 4, "stroke-linejoin": "round", "stroke-linecap": "round", opacity: 0.85 }));
      svg.appendChild(el("path", {
        d: d.trim(), fill: "none", stroke: l.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round",
        ...(l.dashed ? { "stroke-dasharray": "6 5" } : {}),
      }));
      if (!l.dashed && last >= 0) {
        svg.appendChild(el("circle", { cx: m.left + (last + 0.5) * slot, cy: y(l.values[last]), r: 4, fill: l.color, stroke: "var(--surface)", "stroke-width": 2 }));
      }
    }
    labels.forEach((lab, i) => {
      const gx = m.left + i * slot, hover = hovers[i];
      const hit = el("rect", { x: gx, y: m.top, width: slot, height: ih, fill: "transparent" });
      hit.addEventListener("mousemove", evt => {
        hover.setAttribute("opacity", 1);
        const rows = series.map(s => ({ name: s.name, color: s.color, value: s.values[i], fmt: opts.valueFmt }));
        if (mk) rows.push({ name: mk.name, color: mk.color, value: mk.values[i], shape: "tick", fmt: opts.valueFmt });
        for (const l of over) rows.push({ name: l.name, color: l.color, value: l.values[i], shape: "line", fmt: opts.valueFmt });
        showTip(evt, opts.titleFn ? opts.titleFn(lab, i) : lab, rows.concat(opts.tipExtra ? opts.tipExtra(i) || [] : []));
      });
      hit.addEventListener("mouseleave", () => { hover.setAttribute("opacity", 0); hideTip(); });
      svg.appendChild(hit);
    });
    container.appendChild(svg);
  }

  /**
   * 꺾은선 차트. series: [{name, color, values:[숫자|null], dashed?}] — null이 나오면 그 뒤는 그리지 않음(진행 중 기간).
   * opts: {xLabelFn, xTickEvery, titleFn, ariaLabel, valueFmt, tickFmt,
   *        band: {name, color, lo:[], hi:[]} (예측 범위 띠), divider: {index, label} (예측 시작 세로선),
   *        tipExtra: i => [{name, color, value, fmt}] (툴팁에 덧붙일 줄)}
   */
  function lines(container, labels, series, opts) {
    opts = opts || {};
    container.innerHTML = "";
    const live = series.filter(s => s.values.some(v => v !== null && v !== undefined));
    if (!labels.length || !live.length) {
      container.innerHTML = '<p class="empty-msg">표시할 데이터가 없습니다.</p>';
      return;
    }
    const band = opts.band && opts.band.lo.some(v => v !== null && v !== undefined) ? opts.band : null;
    const legendItems = series.map(s => ({ name: s.name, color: s.color, shape: "line", dashed: s.dashed }));
    if (band) legendItems.push({ name: band.name, color: band.color, shape: "band" });
    if (legendItems.length >= 2) legend(container, legendItems);

    const { W, H, narrow } = frame(container);
    // 오른쪽 여백: 마지막 눈금 글자('12/24~')가 선 끝 아래 가운데에 놓여도 잘리지 않게
    const m = { top: 14, right: 24, bottom: 34, left: narrow ? 48 : 60 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    if (opts.ariaLabel) svg.setAttribute("aria-label", opts.ariaLabel);
    const all = series.flatMap(s => s.values).concat(band ? band.lo.concat(band.hi) : [])
      .filter(v => v !== null && v !== undefined);
    const scale = niceScale(Math.min(0, ...all), Math.max(0, ...all), 4);
    const y = v => m.top + ih - (v - scale.lo) / (scale.hi - scale.lo) * ih;
    axes(svg, m, iw, ih, scale, y, opts.tickFmt);
    const n = labels.length;
    const x = i => m.left + (n === 1 ? iw / 2 : i * iw / (n - 1));

    if (band) {  // 예측 범위: 같은 색의 옅은 띠 (선보다 먼저 그려 선이 위에 보이게)
      const idx = band.lo.map((v, i) => (v === null || v === undefined || band.hi[i] === null || band.hi[i] === undefined ? -1 : i)).filter(i => i >= 0);
      if (idx.length >= 2) {
        const top = idx.map(i => `${x(i).toFixed(1)},${y(band.hi[i]).toFixed(1)}`);
        const bottom = idx.slice().reverse().map(i => `${x(i).toFixed(1)},${y(band.lo[i]).toFixed(1)}`);
        svg.appendChild(el("polygon", { points: top.concat(bottom).join(" "), fill: band.color, "fill-opacity": 0.16, stroke: "none" }));
      }
    }
    if (opts.divider && opts.divider.index > 0 && opts.divider.index < n) {
      const dx = x(opts.divider.index);
      svg.appendChild(el("line", { x1: dx, x2: dx, y1: m.top, y2: m.top + ih, stroke: "var(--ink-3)", "stroke-width": 1, "stroke-dasharray": "3 4" }));
      if (opts.divider.label) {
        const t = el("text", { x: dx + 5, y: m.top + 10, "font-size": 11, fill: "var(--ink-3)" });
        t.textContent = opts.divider.label;
        svg.appendChild(t);
      }
    }

    for (const s of series) {
      let d = "", last = -1;
      s.values.forEach((v, i) => {
        if (v === null || v === undefined) return;
        d += (last === i - 1 && d ? " L" : " M") + x(i).toFixed(1) + "," + y(v).toFixed(1);
        last = i;
      });
      if (!d) continue;
      svg.appendChild(el("path", {
        d: d.trim(), fill: "none", stroke: s.color, "stroke-width": 2,
        "stroke-linejoin": "round", "stroke-linecap": "round",
        ...(s.dashed ? { "stroke-dasharray": "6 5" } : {}),
      }));
      if (!s.dashed && last >= 0) {  // 끝점: 2px 바탕색 테두리를 두른 점
        svg.appendChild(el("circle", { cx: x(last), cy: y(s.values[last]), r: 4.5, fill: s.color, stroke: "var(--surface)", "stroke-width": 2 }));
      }
    }
    const xTickEvery = Math.max(opts.xTickEvery || 1, Math.ceil(n * 46 / iw));
    const ticks = [];
    for (let i = 0; i < n; i += xTickEvery) ticks.push(i);
    if (ticks[ticks.length - 1] !== n - 1) {
      // 마지막 칸(기간 끝)은 늘 보이되, 바로 앞 눈금과 46px보다 가까우면 앞 눈금을 뺀다
      if (ticks.length > 1 && x(n - 1) - x(ticks[ticks.length - 1]) < 46) ticks.pop();
      ticks.push(n - 1);
    }
    for (const i of ticks) {
      const t = el("text", { x: x(i), y: m.top + ih + 18, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-3)" });
      t.textContent = opts.xLabelFn ? opts.xLabelFn(labels[i], i) : labels[i];
      svg.appendChild(t);
    }
    // 십자선: 가장 가까운 x에 붙고, 그 x의 모든 값을 한 툴팁에
    const cross = el("line", { x1: 0, x2: 0, y1: m.top, y2: m.top + ih, stroke: "var(--ink-3)", "stroke-width": 1, opacity: 0 });
    svg.appendChild(cross);
    const hit = el("rect", { x: m.left - 8, y: m.top, width: iw + 16, height: ih, fill: "transparent" });
    hit.addEventListener("mousemove", evt => {
      const box = svg.getBoundingClientRect();
      const px = (evt.clientX - box.left) / box.width * W;
      const i = Math.max(0, Math.min(n - 1, Math.round((px - m.left) / (n === 1 ? 1 : iw / (n - 1)))));
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("opacity", 0.5);
      const rows = series.filter(s => s.values[i] !== null && s.values[i] !== undefined)
        .map(s => ({ name: s.name, color: s.color, value: s.values[i], shape: "line", fmt: opts.valueFmt }));
      showTip(evt, opts.titleFn ? opts.titleFn(labels[i], i) : labels[i],
        rows.concat(opts.tipExtra ? opts.tipExtra(i) || [] : []));
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
    svg.appendChild(hit);
    container.appendChild(svg);
  }

  /** 단일 색 가로 막대 breakdown (합계 대비 비중). opts.fmt로 값 표시 형식을 바꿀 수 있다 */
  function hBars(container, items, color, opts) {
    opts = opts || {};
    const fmt = opts.fmt || fmtWon;
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = '<p class="empty-msg">데이터가 없습니다.</p>';
      return;
    }
    const total = items.reduce((a, b) => a + Math.max(b.value, 0), 0) || 1;
    const max = Math.max(...items.map(i => i.value), 1);
    const list = document.createElement("div");
    list.className = "hbar-list";
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "hbar-row";
      const pct = (Math.max(it.value, 0) / total * 100).toFixed(1);
      row.innerHTML =
        `<span class="hb-name" title="${esc(it.name)}">${esc(it.name)}</span>` +
        `<span class="hb-track"><span class="hb-fill" style="width:${(Math.max(it.value, 0) / max * 100).toFixed(1)}%;background:${color}"></span></span>` +
        `<span class="hb-val">${esc(fmt(it.value))}<span class="hb-pct">${pct}%</span></span>`;
      row.addEventListener("mousemove", evt =>
        showTip(evt, it.name, [{ name: `${(it.cnt || 0).toLocaleString("ko-KR")}건 · ${pct}%`, color, value: it.value, fmt }]));
      row.addEventListener("mouseleave", hideTip);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  /**
   * 작은 추세선(표·목록 안). values: 숫자 배열(오래된 순), 반환: SVG 문자열 — 숫자만 들어가 이스케이프가 필요 없다.
   * 마지막 점에 2px 바탕색 테두리를 두른 점, 0선은 옅게.
   */
  function spark(values, color, opts) {
    opts = opts || {};
    const W = opts.width || 76, H = opts.height || 24, pad = 3;
    const vals = values.map(v => Number(v) || 0);
    if (vals.length < 2) return "";
    const lo = Math.min(0, ...vals), hi = Math.max(...vals, lo + 1);
    const x = i => pad + i * (W - pad * 2) / (vals.length - 1);
    const y = v => H - pad - (v - lo) / (hi - lo) * (H - pad * 2);
    const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const last = vals.length - 1;
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">` +
      `<line x1="${pad}" x2="${W - pad}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" stroke="var(--grid-line)" stroke-width="1"/>` +
      `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>` +
      `<circle cx="${x(last).toFixed(1)}" cy="${y(vals[last]).toFixed(1)}" r="2.6" fill="${color}" stroke="var(--surface)" stroke-width="1.4"/></svg>`;
  }

  /**
   * 작은 꺾은선(여러 개를 나란히 놓고 모양을 견주는 용도). 축 없이 선·끝점만, 눈금은 차트마다 값의 범위에 맞춘다.
   * values: [숫자|null] (null은 그 구간에 자료 없음 — 선을 끊는다)
   * opts: {height, band: {lo:[], hi:[]} (같은 색 옅은 띠), zero(0부터 그리기), name, valueFmt, titleFn, tipExtra, ariaLabel}
   */
  function mini(container, labels, values, color, opts) {
    opts = opts || {};
    container.innerHTML = "";
    const has = v => v !== null && v !== undefined;
    const idx = values.map((v, i) => (has(v) ? i : -1)).filter(i => i >= 0);
    if (!idx.length) {
      container.innerHTML = '<p class="mini-empty">자료 없음</p>';
      return;
    }
    const W = Math.max(160, Math.min(520, Math.round(container.clientWidth || 260))), H = opts.height || 64;
    const padX = 7, padT = 8, padB = 8, n = values.length;
    const band = opts.band || null;
    const all = idx.map(i => values[i]);
    if (band) for (const i of idx) { if (has(band.lo[i])) all.push(band.lo[i]); if (has(band.hi[i])) all.push(band.hi[i]); }
    let lo = Math.min(...all), hi = Math.max(...all);
    if (opts.zero) lo = Math.min(lo, 0);
    if (hi - lo < 1e-9) { const d = Math.abs(lo || 1) * 0.1; lo -= d; hi += d; }
    const x = i => padX + (n === 1 ? (W - padX * 2) / 2 : i * (W - padX * 2) / (n - 1));
    const y = v => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", class: "mini" });
    if (opts.ariaLabel) svg.setAttribute("aria-label", opts.ariaLabel);
    if (band) {
      const b = idx.filter(i => has(band.lo[i]) && has(band.hi[i]));
      if (b.length >= 2) {
        const top = b.map(i => `${x(i).toFixed(1)},${y(band.hi[i]).toFixed(1)}`);
        const bottom = b.slice().reverse().map(i => `${x(i).toFixed(1)},${y(band.lo[i]).toFixed(1)}`);
        svg.appendChild(el("polygon", { points: top.concat(bottom).join(" "), fill: color, "fill-opacity": 0.14, stroke: "none" }));
      }
    }
    let d = "", last = -1;
    for (const i of idx) {
      d += (last === i - 1 && d ? " L" : " M") + x(i).toFixed(1) + "," + y(values[i]).toFixed(1);
      // 앞뒤가 비어 혼자 있는 점은 선이 그려지지 않으니 점으로 찍는다
      if (!has(values[i - 1]) && !has(values[i + 1]) && i !== idx[idx.length - 1]) {
        svg.appendChild(el("circle", { cx: x(i), cy: y(values[i]), r: 2.2, fill: color }));
      }
      last = i;
    }
    svg.appendChild(el("path", { d: d.trim(), fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    svg.appendChild(el("circle", { cx: x(last), cy: y(values[last]), r: 4, fill: color, stroke: "var(--surface)", "stroke-width": 2 }));
    const cross = el("line", { x1: 0, x2: 0, y1: 2, y2: H - 2, stroke: "var(--ink-3)", "stroke-width": 1, opacity: 0 });
    svg.appendChild(cross);
    const hit = el("rect", { x: 0, y: 0, width: W, height: H, fill: "transparent" });
    hit.addEventListener("mousemove", evt => {
      const box = svg.getBoundingClientRect();
      const px = (evt.clientX - box.left) / box.width * W;
      let best = idx[0];
      for (const i of idx) if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
      cross.setAttribute("x1", x(best));
      cross.setAttribute("x2", x(best));
      cross.setAttribute("opacity", 0.5);
      const rows = [{ name: opts.name || "", color, value: values[best], shape: "line", fmt: opts.valueFmt }];
      showTip(evt, opts.titleFn ? opts.titleFn(labels[best], best) : labels[best], rows.concat(opts.tipExtra ? opts.tipExtra(best) || [] : []));
    });
    hit.addEventListener("mouseleave", () => { cross.setAttribute("opacity", 0); hideTip(); });
    svg.appendChild(hit);
    container.appendChild(svg);
  }

  /** 글자 폭 어림(11px 기준): 한글·한자는 넓고 영문·숫자는 좁다 */
  function textWidth(s, size) {
    let w = 0;
    for (const ch of String(s)) w += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : 0.58;
    return w * (size || 11);
  }

  /**
   * 점 그림. points: [{name, x, y, ...}] — x·y는 숫자.
   * opts: {color, xTitle, yTitle, xFmt, yFmt, xRef: {value, label} (세로 기준선), yClamp: [lo, hi] (넘는 값은 끝에 붙여 그림),
   *        quadrants: {tr, tl, br, bl} (기준선으로 나뉜 네 칸의 이름), labelMax(이름표 개수), tipRows: p => [...], ariaLabel}
   * 이름표는 x가 큰 점부터 붙이고, 다른 이름표·점과 겹치면 자리를 바꿔 보다가 안 되면 생략한다(툴팁으로 확인).
   */
  function scatter(container, points, opts) {
    opts = opts || {};
    container.innerHTML = "";
    const pts = points.filter(p => isFinite(p.x) && isFinite(p.y));
    if (!pts.length) {
      container.innerHTML = '<p class="empty-msg">표시할 데이터가 없습니다.</p>';
      return;
    }
    const { W, narrow } = frame(container);
    const H = narrow ? 290 : 340;
    const m = { top: 22, right: 18, bottom: 44, left: narrow ? 46 : 56 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    if (opts.ariaLabel) svg.setAttribute("aria-label", opts.ariaLabel);
    const color = opts.color || "var(--accent)";
    const clamp = opts.yClamp || [-Infinity, Infinity];
    const cy = p => Math.max(clamp[0], Math.min(clamp[1], p.y));
    const ys = pts.map(cy);
    const yScale = niceScale(Math.min(0, ...ys), Math.max(0, ...ys), 4);
    const xScale = niceScale(0, Math.max(...pts.map(p => p.x), opts.xRef ? opts.xRef.value : 0), 4);
    const X = v => m.left + (v - xScale.lo) / (xScale.hi - xScale.lo) * iw;
    const Y = v => m.top + ih - (v - yScale.lo) / (yScale.hi - yScale.lo) * ih;
    const xFmt = opts.xFmt || (v => String(v)), yFmt = opts.yFmt || (v => String(v));
    // 눈금
    for (const tv of yScale.ticks) {
      svg.appendChild(el("line", { x1: m.left, x2: m.left + iw, y1: Y(tv), y2: Y(tv), stroke: tv === 0 ? "var(--baseline)" : "var(--grid-line)", "stroke-width": 1 }));
      const t = el("text", { x: m.left - 8, y: Y(tv) + 4, "text-anchor": "end", "font-size": 11, fill: "var(--ink-3)" });
      t.textContent = yFmt(tv);
      svg.appendChild(t);
    }
    for (const tv of xScale.ticks) {
      const t = el("text", { x: X(tv), y: m.top + ih + 16, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-3)" });
      t.textContent = xFmt(tv);
      svg.appendChild(t);
    }
    svg.appendChild(el("line", { x1: m.left, x2: m.left, y1: m.top, y2: m.top + ih, stroke: "var(--grid-line)", "stroke-width": 1 }));
    if (opts.xTitle) {
      const t = el("text", { x: m.left + iw, y: H - 6, "text-anchor": "end", "font-size": 11, fill: "var(--ink-3)" });
      t.textContent = opts.xTitle + " →";
      svg.appendChild(t);
    }
    if (opts.yTitle) {
      const t = el("text", { x: 4, y: 12, "font-size": 11, fill: "var(--ink-3)" });
      t.textContent = "↑ " + opts.yTitle;
      svg.appendChild(t);
    }
    const boxes = [];  // 이미 자리 잡은 글자·점 (겹침 판정용)
    const hits = b => boxes.some(o => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
    if (opts.xRef) {
      const rx = X(opts.xRef.value);
      svg.appendChild(el("line", { x1: rx, x2: rx, y1: m.top, y2: m.top + ih, stroke: "var(--ink-3)", "stroke-width": 1, "stroke-dasharray": "3 4" }));
      if (opts.xRef.label) {
        const t = el("text", { x: rx + 4, y: m.top + ih - 5, "font-size": 10.5, fill: "var(--ink-3)" });
        t.textContent = opts.xRef.label;
        svg.appendChild(t);
        boxes.push({ x: rx + 2, y: m.top + ih - 16, w: textWidth(opts.xRef.label, 10.5) + 4, h: 14 });
      }
      // 사분면 이름: 기준선으로 나뉜 네 칸의 구석에 옅게
      const q = opts.quadrants || {};
      const zeroY = Y(0);
      const put = (text, x, y, anchor) => {
        if (!text) return;
        const w = textWidth(text, 11);
        const bx = anchor === "end" ? x - w : x;
        const t = el("text", { x, y, "text-anchor": anchor, "font-size": 11, "font-weight": 700, fill: "var(--ink-3)", opacity: 0.85 });
        t.textContent = text;
        svg.appendChild(t);
        boxes.push({ x: bx - 2, y: y - 11, w: w + 4, h: 14 });
      };
      if (zeroY - m.top > 30) { put(q.tr, m.left + iw - 4, m.top + 12, "end"); put(q.tl, m.left + 6, m.top + 12, "start"); }
      if (m.top + ih - zeroY > 30) { put(q.br, m.left + iw - 4, m.top + ih - 6, "end"); put(q.bl, m.left + 6, m.top + ih - 22, "start"); }
    }
    // 점 (큰 것부터 그려 작은 점이 위에 오게 하지 않고, x 큰 순으로 이름표 우선권)
    const R = 6;
    const placed = pts.map(p => ({ p, px: X(p.x), py: Y(cy(p)), out: p.y !== cy(p) }));
    for (const o of placed) boxes.push({ x: o.px - R, y: o.py - R, w: R * 2, h: R * 2 });
    for (const o of placed) {
      svg.appendChild(el("circle", { cx: o.px, cy: o.py, r: R, fill: opts.colorOf ? opts.colorOf(o.p) || color : color, "fill-opacity": 0.9, stroke: "var(--surface)", "stroke-width": 2 }));
    }
    const labelMax = opts.labelMax === undefined ? (narrow ? 7 : 14) : opts.labelMax;
    let shown = 0;
    for (const o of placed.slice().sort((a, b) => (b.p.rank || 0) - (a.p.rank || 0) || b.p.x - a.p.x)) {
      if (shown >= labelMax) break;
      const w = textWidth(o.p.name, 11), h = 13;
      const cands = [
        { x: o.px + R + 4, y: o.py - h / 2, anchor: "start", tx: o.px + R + 4 },
        { x: o.px - R - 4 - w, y: o.py - h / 2, anchor: "end", tx: o.px - R - 4 },
        { x: o.px - w / 2, y: o.py - R - 3 - h, anchor: "middle", tx: o.px },
        { x: o.px - w / 2, y: o.py + R + 3, anchor: "middle", tx: o.px },
      ];
      const ok = cands.find(c => c.x >= m.left + 2 && c.x + w <= W - 2 && c.y >= 2 && c.y + h <= m.top + ih + 2 && !hits({ x: c.x, y: c.y, w, h }));
      if (!ok) continue;
      const t = el("text", { x: ok.tx, y: ok.y + h - 3, "text-anchor": ok.anchor, "font-size": 11, "font-weight": 600, fill: "var(--ink-2)" });
      t.textContent = o.p.name;
      svg.appendChild(t);
      boxes.push({ x: ok.x, y: ok.y, w, h });
      shown++;
    }
    for (const o of placed) {
      const hit = el("circle", { cx: o.px, cy: o.py, r: 13, fill: "transparent" });
      hit.addEventListener("mousemove", evt => showTip(evt, o.p.name, opts.tipRows ? opts.tipRows(o.p) : [
        { name: opts.xTitle || "x", color, value: o.p.x, fmt: xFmt }, { name: opts.yTitle || "y", color, value: o.p.y, fmt: yFmt }]));
      hit.addEventListener("mouseleave", hideTip);
      svg.appendChild(hit);
    }
    container.appendChild(svg);
  }

  window.WCharts = { groupedBars, lines, hBars, spark, mini, scatter, fmtWon, fmtTick, hideTip };
})();
