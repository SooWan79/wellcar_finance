/* 경량 SVG 차트 (외부 라이브러리 없이 동작) */
(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const tooltip = () => document.getElementById("tooltip");

  function el(tag, attrs) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function fmtWon(v) {
    return "₩" + Math.round(v).toLocaleString("ko-KR");
  }

  // 축 눈금: 0을 포함한 "nice" 스텝
  function niceTicks(maxV, count) {
    if (maxV <= 0) maxV = 1;
    const rough = maxV / count;
    const pow = Math.pow(10, Math.floor(Math.log10(rough)));
    const candidates = [1, 2, 2.5, 5, 10];
    let step = pow;
    for (const c of candidates) {
      if (rough <= c * pow) { step = c * pow; break; }
    }
    const ticks = [];
    for (let v = 0; v <= maxV + step * 0.999; v += step) ticks.push(v);
    return ticks;
  }

  function fmtTick(v) {
    if (v >= 100000000) return (v / 100000000).toLocaleString("ko-KR") + "억";
    if (v >= 10000) return (v / 10000).toLocaleString("ko-KR") + "만";
    return v.toLocaleString("ko-KR");
  }

  function showTip(evt, title, rows) {
    const t = tooltip();
    t.innerHTML = `<div class="tt-title">${title}</div>` + rows.map(r =>
      `<div class="tt-row"><span style="color:${r.color}">●</span> <span>${r.name}</span>` +
      `<span class="v">${fmtWon(r.value)}</span></div>`).join("");
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

  /**
   * 그룹 막대 차트.
   * container: DOM node, labels: x축 라벨 배열,
   * series: [{name, color, values:[...]}], opts: {xTickEvery}
   */
  function groupedBars(container, labels, series, opts) {
    opts = opts || {};
    container.innerHTML = "";
    if (!labels.length) {
      container.innerHTML = '<p class="empty-msg">표시할 데이터가 없습니다.</p>';
      return;
    }
    // 범례 (시리즈 2개 이상)
    if (series.length >= 2) {
      const lg = document.createElement("div");
      lg.className = "legend";
      lg.innerHTML = series.map(s =>
        `<span class="key"><span class="swatch" style="background:${s.color}"></span>${s.name}</span>`).join("");
      container.appendChild(lg);
    }

    const W = 960, H = 300;
    const m = { top: 12, right: 12, bottom: 34, left: 56 };
    const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, role: "img" });

    const maxV = Math.max(1, ...series.flatMap(s => s.values.map(v => Math.abs(v || 0))));
    const ticks = niceTicks(maxV, 4);
    const top = ticks[ticks.length - 1];
    const y = v => m.top + ih - (v / top) * ih;

    // 그리드 + y축 라벨
    for (const tv of ticks) {
      const gy = y(tv);
      svg.appendChild(el("line", {
        x1: m.left, x2: m.left + iw, y1: gy, y2: gy,
        stroke: tv === 0 ? "var(--baseline)" : "var(--grid-line)", "stroke-width": 1,
      }));
      const lbl = el("text", {
        x: m.left - 8, y: gy + 4, "text-anchor": "end",
        "font-size": 11, fill: "var(--ink-3)",
      });
      lbl.textContent = fmtTick(tv);
      svg.appendChild(lbl);
    }

    const n = labels.length, sn = series.length;
    const slot = iw / n;
    const gap = 2;                       // 인접 막대 2px 간격
    const groupPad = Math.min(slot * 0.18, 14);
    const barW = Math.max(2, (slot - groupPad * 2 - gap * (sn - 1)) / sn);

    const xTickEvery = opts.xTickEvery || Math.ceil(n / 16);

    labels.forEach((lab, i) => {
      const gx = m.left + i * slot;
      // 호버 히트 영역(마크보다 크게)
      const hit = el("rect", {
        x: gx, y: m.top, width: slot, height: ih, fill: "transparent",
      });
      const hover = el("rect", {
        x: gx + 1, y: m.top, width: slot - 2, height: ih,
        fill: "var(--accent-soft)", opacity: 0, rx: 4,
      });
      svg.appendChild(hover);

      series.forEach((s, si) => {
        const v = s.values[i] || 0;
        const bx = gx + groupPad + si * (barW + gap);
        const by = y(Math.abs(v));
        const bh = Math.max(v !== 0 ? 2 : 0, m.top + ih - by);
        if (bh > 0) {
          // 상단만 4px 라운드, 베이스라인에 고정
          const r = Math.min(4, barW / 2, bh);
          const x0 = bx, y0 = m.top + ih - bh, w = barW, h = bh;
          const d = `M${x0},${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + w - r}` +
            ` Q${x0 + w},${y0} ${x0 + w},${y0 + r} V${y0 + h} H${x0} Z`;
          svg.appendChild(el("path", { d, fill: s.color }));
        }
      });

      hit.addEventListener("mousemove", evt => {
        hover.setAttribute("opacity", 1);
        showTip(evt, opts.titleFn ? opts.titleFn(lab, i) : lab,
          series.map(s => ({ name: s.name, color: s.color, value: s.values[i] || 0 })));
      });
      hit.addEventListener("mouseleave", () => {
        hover.setAttribute("opacity", 0);
        hideTip();
      });
      svg.appendChild(hit);

      if (i % xTickEvery === 0) {
        const t = el("text", {
          x: gx + slot / 2, y: m.top + ih + 18, "text-anchor": "middle",
          "font-size": 11, fill: "var(--ink-3)",
        });
        t.textContent = opts.xLabelFn ? opts.xLabelFn(lab, i) : lab;
        svg.appendChild(t);
      }
    });

    container.appendChild(svg);
  }

  /** 단일 색조 가로 막대 breakdown (합계 대비 비중) */
  function hBars(container, items, color) {
    container.innerHTML = "";
    if (!items.length) {
      container.innerHTML = '<p class="empty-msg">데이터가 없습니다.</p>';
      return;
    }
    const total = items.reduce((a, b) => a + b.value, 0) || 1;
    const max = Math.max(...items.map(i => i.value), 1);
    const list = document.createElement("div");
    list.className = "hbar-list";
    for (const it of items) {
      const row = document.createElement("div");
      row.className = "hbar-row";
      const pct = (it.value / total * 100).toFixed(1);
      row.innerHTML =
        `<span class="hb-name" title="${it.name}">${it.name}</span>` +
        `<span class="hb-track"><span class="hb-fill" style="width:${(it.value / max * 100).toFixed(1)}%;background:${color}"></span></span>` +
        `<span class="hb-val">${fmtWon(it.value)}<span class="hb-pct">${pct}%</span></span>`;
      row.addEventListener("mousemove", evt =>
        showTip(evt, it.name, [{ name: `${it.cnt || 0}건 · ${pct}%`, color, value: it.value }]));
      row.addEventListener("mouseleave", hideTip);
      list.appendChild(row);
    }
    container.appendChild(list);
  }

  window.WCharts = { groupedBars, hBars, fmtWon };
})();
