/* Budgee app: connects the page to the engine. */
(function () {
  'use strict';
  const E = window.BudgeeEngine, C = window.BudgeeCharts;
  const $ = (s) => document.querySelector(s);
  const money = (v, cents) => (v < 0 ? '-' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const CATEGORIES = ['Housing', 'Utilities', 'Groceries', 'Dining', 'Coffee', 'Transport', 'Gas', 'Shopping', 'Entertainment', 'Subscriptions', 'Health', 'Fitness', 'Travel', 'Education', 'Insurance', 'Other'];
  const SAMPLE_BUDGET = 2200;

  const state = { text: '', name: '', parsed: null, result: null, overrides: new Map(), sample: false };
  const store = {
    get(k) { try { return localStorage.getItem('budgee.' + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('budgee.' + k, v); } catch (e) {} }
  };

  /* ---------- toast + notices ---------- */
  let toastT;
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3200); }
  function notice(kind, title, body) {
    const n = $('#notice');
    if (!title) { n.hidden = true; return; }
    n.className = 'notice ' + (kind || '');
    n.innerHTML = `<strong>${esc(title)}</strong>${esc(body || '')}`;
    n.hidden = false;
  }

  /* ---------- loading files ---------- */
  function setFile(name, text, sample) {
    state.text = text; state.name = name; state.sample = !!sample; state.overrides.clear();
    $('#drop').classList.add('ready');
    $('#dropMain').textContent = name;
    $('#dropSub').textContent = 'Ready. Set your budget and get your forecast.';
    notice();
  }
  function readFile(file) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { notice('bad', 'That file is too large.', ' Budgee reads files up to 15 MB. Try exporting fewer months.'); return; }
    if (!/\.(csv|txt)$/i.test(file.name) && !/csv|text/.test(file.type)) { notice('bad', 'Budgee needs a CSV file.', ` "${file.name}" isn't one. In your bank's export options, choose CSV (sometimes called "Comma separated" or "Spreadsheet").`); return; }
    const r = new FileReader();
    r.onload = () => setFile(file.name, String(r.result), false);
    r.onerror = () => notice('bad', "Couldn't open that file.", ' Try downloading it from your bank again.');
    r.readAsText(file);
  }
  async function loadSample(go) {
    try {
      const text = await (await fetch('sample-transactions.csv')).text();
      setFile('Sample: a student’s July to mid-October spending', text, true);
      if (!$('#budgetInput').value) $('#budgetInput').value = SAMPLE_BUDGET;
      if (go) run(true);
      return text;
    } catch (e) { notice('bad', "Couldn't load the sample data.", ' Check your connection and try again.'); }
  }

  /* ---------- run the forecast ---------- */
  function run(scroll) {
    if (!state.text) { notice('bad', 'Add your transactions first.', ' Drop a CSV in the box, or use the sample data to see how it works.'); $('#drop').focus(); return; }
    const budget = parseFloat($('#budgetInput').value);
    if (!(budget > 0)) { notice('bad', 'Enter your monthly budget.', ' This is the total you plan to spend in a month, including rent and bills.'); $('#budgetInput').focus(); return; }
    if (!state.sample) store.set('budget', String(budget));
    const parsed = E.parse(state.text);
    if (parsed.error) { notice('bad', "Budgee couldn't read that file.", ' ' + parsed.error); $('#dashboard').hidden = true; return; }
    parsed.transactions.forEach((t) => { if (state.overrides.has(t.id)) t.category = state.overrides.get(t.id); });
    state.parsed = parsed;
    const R = E.analyze(parsed, { budget });
    if (!R) { notice('bad', 'No spending found in that file.', ' Budgee found only income or transfers. Make sure the file includes purchases.'); return; }
    state.result = R;
    notice();
    $('#dashboard').hidden = false; // show first so the chart can measure its real size
    render(R, parsed);
    if (scroll) $('#dashboard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- render ---------- */
  function render(R, parsed) {
    const over = R.budget && R.projected > R.budget;
    const monthName = MONTHS[R.month];
    $('#dashAsOf').textContent = `${monthName} ${R.year} · as of ${monthName.slice(0, 3)} ${R.day}${R.daysLeft ? ` · ${R.daysLeft} day${R.daysLeft === 1 ? '' : 's'} left` : ' · month complete'}`;
    const v = $('#verdict');
    v.className = 'verdict ' + (over ? 'bad' : 'good');
    v.textContent = over ? `You're on pace to overspend by ${money(R.projected - R.budget)}.` : `You're on track to stay ${money(R.budget - R.projected)} under budget.`;
    $('#verdictSub').textContent = R.daysLeft
      ? `Based on ${R.monthsOfHistory ? `${R.monthsOfHistory} month${R.monthsOfHistory === 1 ? '' : 's'} of your history, ` : ''}your weekly rhythm, and ${R.upcoming.length ? `${R.upcoming.length} bill${R.upcoming.length === 1 ? '' : 's'} still due` : 'no bills left to come'}, Budgee expects you to finish ${monthName} between ${money(R.low)} and ${money(R.high)}.`
      : `${monthName} is complete. You spent ${money(R.spent)} against a ${money(R.budget)} budget.`;

    $('#kSpent').textContent = money(R.spent);
    $('#kSpentSub').textContent = R.prevSamePoint != null ? `${money(R.prevSamePoint)} at this point last month` : `${R.transactionCount} purchases this month`;
    const kp = $('#kProj'); kp.textContent = money(R.projected); kp.className = 'kpi-num ' + (over ? 'bad' : 'good');
    $('#kProjSub').textContent = R.daysLeft ? `Likely ${money(R.low)} to ${money(R.high)}` : 'Final total';
    const odds = Math.round((R.pOver || 0) * 100);
    const ko = $('#kOdds'); ko.textContent = odds >= 99 ? '99%+' : odds <= 1 ? 'Under 1%' : odds + '%';
    ko.className = 'kpi-num ' + (odds >= 60 ? 'bad' : odds >= 30 ? 'warn' : 'good');
    $('#kOddsSub').textContent = odds >= 60 ? 'Likely without changes' : odds >= 30 ? 'Could go either way' : 'Comfortably on track';
    const ks = $('#kSafe');
    if (R.daysLeft && R.safePerDay != null) {
      ks.textContent = money(R.safePerDay) + '/day';
      ks.className = 'kpi-num ' + (R.safePerDay < R.usualPerDay * 0.8 ? 'warn' : 'good');
      $('#kSafeSub').textContent = `You usually spend ${money(R.usualPerDay)}/day`;
    } else { ks.textContent = '—'; ks.className = 'kpi-num'; $('#kSafeSub').textContent = 'Month complete'; }

    // legend + chart
    const sw = (cls) => `<svg class="sw" viewBox="0 0 22 8" aria-hidden="true"><line class="${cls}" x1="1" y1="4" x2="21" y2="4"/></svg>`;
    $('#legend').innerHTML = `<span>${sw('c-actual')}Spent so far</span><span>${sw('c-fore')}Forecast, with likely range</span><span>${sw('c-budget')}Budget</span>${R.cumPrev.length ? `<span>${sw('c-prev')}Last month</span>` : ''}`;
    C.forecast($('#mainChart'), R);

    // insights
    $('#insights').innerHTML = R.insights.slice(0, 6).map((i) => `<li class="insight ${i.level}"><div><strong>${esc(i.title)}</strong><p>${esc(i.body)}</p></div></li>`).join('');

    // categories
    const maxV = Math.max(...R.categories.map((c) => Math.max(c.projected, c.typical || 0)), 1);
    $('#cats').innerHTML = R.categories.slice(0, 10).map((c) => {
      const hot = c.typical && c.projected > c.typical * 1.15 && c.discretionary;
      return `<div class="cat-row">
        <span class="cat-name">${esc(c.name)}${hot ? '<span class="pill pill-bad">above usual</span>' : ''}</span>
        <span class="cat-amt"><b>${money(c.spent)}</b> → ${money(c.projected)}${c.typical != null ? ` · usually ${money(c.typical)}` : ''}</span>
        <div class="cat-bar${hot ? ' hot' : ''}" aria-hidden="true">
          <span class="proj" style="width:${(c.projected / maxV * 100).toFixed(1)}%"></span>
          <span class="so-far" style="width:${(c.spent / maxV * 100).toFixed(1)}%"></span>
          ${c.typical != null ? `<span class="typ" style="left:${(c.typical / maxV * 100).toFixed(1)}%"></span>` : ''}
        </div></div>`;
    }).join('');

    // bills
    const upcomingNames = new Set(R.upcoming.map((u) => u.name));
    const billTotal = R.recurring.reduce((s, b) => s + b.amount, 0);
    $('#billsNote').textContent = R.recurring.length ? `${money(billTotal)} a month` : '';
    $('#bills').innerHTML = R.recurring.length ? R.recurring.map((b) => {
      const status = upcomingNames.has(b.name) ? `<span class="pill pill-warn">Due ~${ordinal(b.day)}</span>` : b.day <= R.day ? '<span class="pill pill-good">Paid</span>' : '<span class="pill">Not this month</span>';
      return `<li><span class="bill-name">${esc(b.name)}<small>${esc(b.category)} · around the ${ordinal(b.day)} · seen ${b.months} months</small></span><span class="bill-amt">${money(b.amount, true)}</span>${status}</li>`;
    }).join('') : '<li><span class="bill-name">No regular bills found yet<small>Bills show up here once Budgee sees them in two different months.</small></span></li>';

    renderTx();
    $('#warnings').textContent = parsed.warnings.join(' ');
  }

  function renderTx() {
    const R = state.result, P = state.parsed; if (!R) return;
    const q = ($('#txSearch').value || '').toLowerCase();
    const month = R.asOf.slice(0, 7);
    const oneoffs = new Set(R.unusual.map((u) => u.date + u.description + u.amount));
    const list = P.transactions.filter((t) => t.date.slice(0, 7) === month && t.date <= R.asOf)
      .filter((t) => !q || `${t.description} ${t.category}`.toLowerCase().includes(q)).slice().reverse();
    const cats = new Set(CATEGORIES); P.transactions.forEach((t) => cats.add(t.category));
    const opts = [...cats];
    $('#txBody').innerHTML = list.length ? list.map((t) => `<tr class="${oneoffs.has(t.date + t.description + t.amount) ? 'oneoff' : ''}">
      <td class="d">${MONTHS[+t.date.slice(5, 7) - 1].slice(0, 3)} ${+t.date.slice(8)}</td>
      <td class="desc" title="${esc(t.description)}">${esc(t.description)}</td>
      <td><select data-id="${t.id}" aria-label="Category for ${esc(t.description)}">${opts.map((c) => `<option${c === t.category ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></td>
      <td class="amt">${money(t.amount, true)}</td></tr>`).join('') : `<tr><td class="fine">${q ? 'No purchases match that search.' : 'No purchases yet this month.'}</td></tr>`;
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

  /* ---------- template download ---------- */
  function downloadTemplate() {
    const csv = 'date,description,category,amount\n2026-10-01,Rent,Housing,950.00\n2026-10-02,Trader Joe\'s,Groceries,54.20\n2026-10-02,Starbucks,Coffee,5.75\n2026-10-03,Chipotle,Dining,12.40\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'budgee-template.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ---------- hero demo ---------- */
  async function demo() {
    try {
      const text = await (await fetch('sample-transactions.csv')).text();
      const R = E.analyze(E.parse(text), { budget: SAMPLE_BUDGET });
      $('#demoProj').textContent = money(R.projected);
      $('#demoOf').textContent = `projected, of a ${money(R.budget)} budget`;
      const over = R.projected > R.budget;
      const pill = $('#demoPill'); pill.textContent = over ? `${money(R.projected - R.budget)} over` : 'On track'; pill.className = 'pill ' + (over ? 'pill-bad' : 'pill-good');
      const tip = R.insights.find((i) => i.level === 'warn') || R.insights[0];
      $('#demoTip').textContent = tip ? `${tip.title}. ${tip.body}` : '';
      C.forecast($('#demoChart'), R, { compact: true });
      state.demo = R;
    } catch (e) { $('.hero-demo').hidden = true; }
  }

  /* ---------- wiring ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    if (b.dataset.action === 'sample') { loadSample(true); }
    if (b.dataset.action === 'template') downloadTemplate();
  });
  $('#fileInput').addEventListener('change', (e) => readFile(e.target.files[0]));
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => readFile(e.dataTransfer.files[0]));
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) { readFile(e.dataTransfer.files[0]); $('#try').scrollIntoView({ behavior: 'smooth' }); } });
  $('#uploadForm').addEventListener('submit', (e) => { e.preventDefault(); run(true); });
  $('#newFile').addEventListener('click', () => { $('#try').scrollIntoView({ behavior: 'smooth' }); $('#fileInput').click(); });
  $('#txSearch').addEventListener('input', renderTx);
  $('#txBody').addEventListener('change', (e) => {
    const s = e.target.closest('select'); if (!s) return;
    state.overrides.set(+s.dataset.id, s.value);
    const y = window.scrollY; run(false); window.scrollTo(0, y);
    toast('Category updated. Forecast recalculated.');
  });
  let rt;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (state.result && !$('#dashboard').hidden) C.forecast($('#mainChart'), state.result); if (state.demo) C.forecast($('#demoChart'), state.demo, { compact: true }); }, 150); });

  const savedBudget = store.get('budget');
  if (savedBudget) $('#budgetInput').value = savedBudget;
  demo();
  window.__budgee = state;
})();
