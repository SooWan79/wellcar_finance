/* 경량 SVG 차트 (외부 라이브러리 없이 동작)
   - groupedBars: 묶음 막대(+ 목표 같은 기준선 표시), 음수 지원
   - lines: 꺾은선(누적 손익 등), 십자선 툴팁, 음수 지원
   - hBars: 항목별 가로 막대(비중)
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
  function hideTip() { tooltip().hidden = true; }

  /** 범례: 막대는 네모, 선은 짧은 선, 목표선은 짧은 눈금 */
  function legend(container, items) {
    const lg = document.createElement("div");
    lg.className = "legend";
    for (const it of items) {
      const key = document.createElement("span");
      key.className = "key";
      const sw = document.createElement("span");
      sw.className = "swatch" + (it.shape === "line" ? " line" : it.shape === "tick" ? " tick" : "") + (it.dashed ? " dashed" : "");
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

  function axes(svg, m, iw, ih, scale, y) {
    for (const tv of scale.ticks) {
      const gy = y(tv);
      svg.appendChild(el("line", {
        x1: m.left, x2: m.left + iw, y1: gy, y2: gy,
        stroke: tv === 0 ? "var(--baseline)" : "var(--grid-line)", "stroke-width": 1,
      }));
      const lbl = el("text", { x: m.left - 8, y: gy + 4, "text-anchor": "end", "font-size": 11, fill: "var(--ink-3)" });
      lbl.textContent = fmtTick(tv);
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
   */
  function groupedBars(container, labels, series, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!labels.length) {
      container.innerHTML = '<p class="empty-msg">표시할 데이터가 없습니다.</p>';
      return;
    }
    const mk = opts.markers && opts.markers.values.some(v => v !== null && v !== undefined) ? opts.markers : null;
    const legendItems = series.map(s => ({ name: s.name, color: s.color }));
    if (mk) legendItems.push({ name: mk.name, color: mk.color, shape: "tick" });
    if (legendItems.length >= 2) legend(container, legendItems);

    const { W, H, narrow } = frame(container);
    const m = { top: 12, right: 10, bottom: 34, left: narrow ? 48 : 60 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    if (opts.ariaLabel) svg.setAttribute("aria-label", opts.ariaLabel);

    const all = series.flatMap(s => s.values).concat(mk ? mk.values : []).filter(v => v !== null && v !== undefined);
    const scale = niceScale(Math.min(0, ...all), Math.max(0, ...all), 4);
    const y = v => m.top + ih - (v - scale.lo) / (scale.hi - scale.lo) * ih;
    axes(svg, m, iw, ih, scale, y);

    const n = labels.length, sn = series.length;
    const slot = iw / n;
    const gap = 2;  // 맞닿은 막대 사이 2px
    const groupPad = Math.min(slot * 0.18, 14);
    const barW = Math.max(2, Math.min(BAR_MAX, (slot - groupPad * 2 - gap * (sn - 1)) / sn));
    const groupW = barW * sn + gap * (sn - 1);
    // x축 글자는 서로 겹치지 않게 최소 42px 간격
    const xTickEvery = Math.max(opts.xTickEvery || 1, Math.ceil(n * 42 / iw));
    const y0 = y(0);

    labels.forEach((lab, i) => {
      const gx = m.left + i * slot;
      const bx0 = gx + (slot - groupW) / 2;
      const hover = el("rect", { x: gx + 1, y: m.top, width: slot - 2, height: ih, fill: "var(--accent-soft)", opacity: 0, rx: 4 });
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
      const hit = el("rect", { x: gx, y: m.top, width: slot, height: ih, fill: "transparent" });
      hit.addEventListener("mousemove", evt => {
        hover.setAttribute("opacity", 1);
        const rows = series.map(s => ({ name: s.name, color: s.color, value: s.values[i] }));
        if (mk) rows.push({ name: mk.name, color: mk.color, value: mk.values[i], shape: "tick" });
        showTip(evt, opts.titleFn ? opts.titleFn(lab, i) : lab, rows);
      });
      hit.addEventListener("mouseleave", () => { hover.setAttribute("opacity", 0); hideTip(); });
      svg.appendChild(hit);
      if (i % xTickEvery === 0) {
        const t = el("text", { x: gx + slot / 2, y: m.top + ih + 18, "text-anchor": "middle", "font-size": 11, fill: "var(--ink-3)" });
        t.textContent = opts.xLabelFn ? opts.xLabelFn(lab, i) : lab;
        svg.appendChild(t);
      }
    });
    container.appendChild(svg);
  }

  /**
   * 꺾은선 차트. series: [{name, color, values:[숫자|null], dashed?}] — null이 나오면 그 뒤는 그리지 않음(진행 중 기간).
   * opts: {xLabelFn, xTickEvery, titleFn, ariaLabel}
   */
  function lines(container, labels, series, opts) {
    opts = opts || {};
    container.innerHTML = "";
    const live = series.filter(s => s.values.some(v => v !== null && v !== undefined));
    if (!labels.length || !live.length) {
      container.innerHTML = '<p class="empty-msg">표시할 데이터가 없습니다.</p>';
      return;
    }
    if (series.length >= 2) legend(container, series.map(s => ({ name: s.name, color: s.color, shape: "line", dashed: s.dashed })));

    const { W, H, narrow } = frame(container);
    // 오른쪽 여백: 마지막 눈금 글자('12/24~')가 선 끝 아래 가운데에 놓여도 잘리지 않게
    const m = { top: 14, right: 24, bottom: 34, left: narrow ? 48 : 60 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });
    if (opts.ariaLabel) svg.setAttribute("aria-label", opts.ariaLabel);
    const all = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
    const scale = niceScale(Math.min(0, ...all), Math.max(0, ...all), 4);
    const y = v => m.top + ih - (v - scale.lo) / (scale.hi - scale.lo) * ih;
    axes(svg, m, iw, ih, scale, y);
    const n = labels.length;
    const x = i => m.left + (n === 1 ? iw / 2 : i * iw / (n - 1));

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
      showTip(evt, opts.titleFn ? opts.titleFn(labels[i], i) : labels[i],
        series.map(s => ({ name: s.name, color: s.color, value: s.values[i], shape: "line" })));
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

  window.WCharts = { groupedBars, lines, hBars, fmtWon, fmtTick };
})();
