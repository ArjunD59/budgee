/* Budgee charts: hand-drawn SVG so there are no outside libraries to load. */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, parent) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  };
  const money = (v) => '$' + Math.round(v).toLocaleString('en-US');
  const short = (v) => v >= 1000 ? '$' + (v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : '$' + Math.round(v);
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function niceStep(max, ticks) {
    const raw = max / ticks, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p;
  }

  /* Cumulative spending: actual line, dashed forecast with its likely range, budget line, last month */
  function forecast(host, R, opt = {}) {
    host.innerHTML = '';
    const W = Math.max(260, host.clientWidth), H = Math.max(140, host.clientHeight);
    const compact = !!opt.compact;
    const pad = compact ? { l: 6, r: 58, t: 14, b: 22 } : { l: 52, r: 74, t: 18, b: 30 };
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Spending so far ${money(R.spent)}, projected ${money(R.projected)} by the end of ${MONTHS[R.month]}` }, host);
    const N = R.daysInMonth;
    const prevMax = R.cumPrev.length ? R.cumPrev[R.cumPrev.length - 1].v : 0;
    const top = Math.max(R.high, R.budget || 0, compact ? 0 : prevMax) * 1.08;
    const step = niceStep(top, compact ? 3 : 4), yMax = Math.ceil(top / step) * step;
    const x = (d) => pad.l + (d - 1) / (N - 1) * (W - pad.l - pad.r);
    const y = (v) => H - pad.b - v / yMax * (H - pad.t - pad.b);

    if (!compact) for (let v = 0; v <= yMax + 1e-6; v += step) {
      el('line', { class: 'ax', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, svg);
      el('text', { class: 'ax-t', x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, svg).textContent = short(v);
    } else el('line', { class: 'ax', x1: pad.l, x2: W - pad.r, y1: y(0), y2: y(0) }, svg);
    const ticks = compact ? [1, Math.round(N / 2), N] : [1, 8, 15, 22, N];
    for (const d of ticks) el('text', { class: 'ax-t', x: x(d), y: H - pad.b + 17, 'text-anchor': d === 1 ? 'start' : d === N ? 'end' : 'middle' }, svg).textContent = `${MONTHS[R.month]} ${d}`;

    // last month (only on the full chart)
    if (!compact && R.cumPrev.length) {
      const pts = R.cumPrev.filter((p) => p.d <= N).map((p) => `${x(p.d)},${y(p.v)}`).join(' ');
      el('polyline', { class: 'c-prev', points: pts }, svg);
    }
    // likely range
    const F = R.cumForecast;
    if (F.length > 1) {
      const up = F.map((p) => `${x(p.d)},${y(p.hi)}`), dn = F.slice().reverse().map((p) => `${x(p.d)},${y(p.lo)}`);
      el('polygon', { class: 'c-band', points: up.concat(dn).join(' ') }, svg);
    }
    // budget line
    if (R.budget) {
      el('line', { class: 'c-budget', x1: pad.l, x2: W - pad.r, y1: y(R.budget), y2: y(R.budget) }, svg);
      el('text', { class: 'c-budget-t', x: W - pad.r + 6, y: y(R.budget) + 4 }, svg).textContent = compact ? 'Budget' : `Budget ${short(R.budget)}`;
    }
    // today marker
    if (!compact && R.daysLeft > 0) {
      el('line', { class: 'c-today', x1: x(R.day), x2: x(R.day), y1: pad.t, y2: H - pad.b }, svg);
      el('text', { class: 'c-today-t', x: x(R.day) + 6, y: pad.t + 10 }, svg).textContent = 'Today';
    }
    // forecast + actual
    if (F.length > 1) el('polyline', { class: 'c-fore', points: F.map((p) => `${x(p.d)},${y(p.v)}`).join(' ') }, svg);
    const A = [{ d: 1, v: 0 }].concat(R.cumActual);
    el('polyline', { class: 'c-actual', points: A.map((p) => `${x(Math.max(1, p.d))},${y(p.v)}`).join(' ') }, svg);
    el('circle', { class: 'c-dot', cx: x(R.day), cy: y(R.spent), r: 5 }, svg);
    if (R.daysLeft > 0) {
      el('circle', { class: 'c-end', cx: x(N), cy: y(R.projected), r: 5 }, svg);
      const ty = Math.abs(y(R.projected) - y(R.budget || -1e9)) < 14 ? y(R.projected) + (R.projected > R.budget ? -10 : 18) : y(R.projected) + 4;
      el('text', { class: 'c-end-t', x: x(N) + 9, y: ty }, svg).textContent = short(R.projected);
    }
  }

  window.BudgeeCharts = { forecast };
})();
