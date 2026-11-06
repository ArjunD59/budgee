/* Budgee engine: everything runs in the browser. Nothing is uploaded.
   parse()   reads a CSV or bank export and cleans it up
   analyze() learns your spending patterns and forecasts the month */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BudgeeEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- CSV reading ---------------- */
  function splitCSV(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/).find((l) => l.trim()) || '';
    const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.some((x) => x.trim())) rows.push(row);
        row = [];
      } else cell += c;
    }
    row.push(cell);
    if (row.some((x) => x.trim())) rows.push(row);
    return rows.map((r) => r.map((x) => x.trim()));
  }

  const HEAD = {
    date: /^(transaction |trans\.? |posted |posting )?date$|^date posted$|^posted$|^when$/i,
    amount: /^(transaction )?amount( \(usd\))?$|^amt$|^value$|^total$/i,
    debit: /^debit|withdrawal|^money out|^spent$/i,
    credit: /^credit|deposit|^money in/i,
    category: /^category$|^type$|^categor/i,
    description: /descr|merchant|^name$|payee|memo|details|^narrative$|^transaction$/i
  };

  function findColumns(header) {
    const col = {};
    header.forEach((h, i) => {
      const k = h.trim();
      for (const [key, re] of Object.entries(HEAD)) if (col[key] == null && re.test(k)) { col[key] = i; break; }
    });
    return col;
  }

  function parseAmount(s) {
    if (s == null) return NaN;
    let t = String(s).trim();
    if (!t) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
    const bare = t.replace(/[$€£\s]/g, '');
    if (/^-|-$/.test(bare)) neg = true;
    t = t.replace(/[^0-9.,]/g, '');
    if (/,\d{2}$/.test(t) && !/\.\d/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
    else t = t.replace(/,/g, '');
    const v = parseFloat(t);
    return isNaN(v) ? NaN : (neg ? -v : v);
  }

  const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
  function parseDate(s) {
    if (!s) return null;
    const t = String(s).trim();
    let m;
    if ((m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return mk(+m[1], +m[2] - 1, +m[3]);
    if ((m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
      let y = +m[3]; if (y < 100) y += 2000;
      return mk(y, +m[1] - 1, +m[2]);
    }
    if ((m = t.match(/^(\d{1,2})[ -]([a-z]{3})[a-z]*[ -,]*(\d{4})/i))) return mk(+m[3], MONTHS[m[2].toLowerCase()], +m[1]);
    if ((m = t.match(/^([a-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})/i))) return mk(+m[3], MONTHS[m[1].toLowerCase()], +m[2]);
    return null;
  }
  function mk(y, mo, d) {
    if (mo == null || isNaN(mo) || mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(y, mo, d));
    return dt.getUTCDate() === d ? dt : null;
  }
  const iso = (d) => d.toISOString().slice(0, 10);

  /* ---------------- Categories ---------------- */
  const RULES = [
    ['Housing', /\brent\b|apartment|leasing|mortgage|property mgmt|landlord|hoa\b/],
    ['Utilities', /electric|pse&g|pseg|con ed|water|gas co|utility|comcast|xfinity|verizon fios|optimum|spectrum|internet|t-mobile|verizon|at&t|mint mobile|phone bill/],
    ['Subscriptions', /spotify|netflix|hulu|disney|hbo|max\.com|apple\.com|icloud|youtube|prime video|amazon prime|chatgpt|openai|adobe|patreon|subscription|audible|paramount|peacock/],
    ['Groceries', /grocer|trader joe|shoprite|wegmans|whole foods|aldi|kroger|safeway|publix|stop & shop|acme|costco|bj'?s|lidl|h mart|patel|market/],
    ['Coffee', /starbucks|dunkin|coffee|cafe|café|tea house|boba|bubble tea/],
    ['Dining', /restaurant|chipotle|mcdonald|burger|pizza|sweetgreen|cava|taco|wendy|chick-?fil|subway|panera|shake shack|doordash|uber ?eats|grubhub|seamless|diner|grill|kitchen|sushi|wings|bar &|halal|deli|bagel/],
    ['Gas', /\bgas\b|shell|exxon|mobil|sunoco|bp\b|chevron|wawa fuel|wawa gas|quickchek|speedway|fuel/],
    ['Transport', /uber(?! ?eats)|lyft|nj transit|transit|mta|septa|amtrak|parking|toll|e-?zpass|metro|train|bus\b/],
    ['Shopping', /amazon|target|walmart|best buy|apple store|nike|adidas|zara|h&m|uniqlo|shein|etsy|ebay|macy|tj ?maxx|marshalls|ikea|home depot|lowe'?s|sephora|ulta/],
    ['Entertainment', /amc|regal|cinema|movie|ticketmaster|stubhub|concert|steam|playstation|xbox|nintendo|bowling|arcade|museum|event/],
    ['Health', /pharmacy|cvs|walgreens|rite aid|doctor|dental|clinic|hospital|medical|copay|urgent care|optometr/],
    ['Fitness', /gym|planet fitness|la fitness|crunch|equinox|yoga|peloton|fitness|climbing/],
    ['Travel', /airline|delta|united|jetblue|american air|southwest|spirit air|hotel|marriott|hilton|airbnb|expedia|booking\.com/],
    ['Education', /tuition|bookstore|textbook|chegg|coursera|udemy|university|college|rutgers/],
    ['Insurance', /insurance|geico|progressive|state farm|allstate/]
  ];
  const DISCRETIONARY = new Set(['Dining', 'Coffee', 'Shopping', 'Entertainment', 'Travel', 'Subscriptions']);
  const BILL_LIKE = new Set(['Housing', 'Utilities', 'Insurance', 'Subscriptions', 'Fitness', 'Education', 'Health', 'Other']);

  const titleCase = (s) => s.toLowerCase().replace(/(^|[\s/&-])(\w)/g, (m, a, b) => a + b.toUpperCase());
  function normCategory(c) {
    const t = (c || '').trim().toLowerCase();
    if (!t) return '';
    const alias = { grocery: 'Groceries', food: 'Dining', restaurants: 'Dining', 'food & drink': 'Dining', rent: 'Housing', housing: 'Housing', transportation: 'Transport', travel: 'Travel', gym: 'Fitness', healthcare: 'Health', medical: 'Health', utilities: 'Utilities', subscriptions: 'Subscriptions', subscription: 'Subscriptions', shopping: 'Shopping', entertainment: 'Entertainment', coffee: 'Coffee', dining: 'Dining', gas: 'Gas', fuel: 'Gas', education: 'Education', insurance: 'Insurance' };
    return alias[t] || titleCase(t);
  }
  function guessCategory(desc) {
    const d = (desc || '').toLowerCase();
    for (const [cat, re] of RULES) if (re.test(d)) return cat;
    return '';
  }
  const INCOME = /payroll|direct dep|salary|paycheck|venmo cashout|zelle from|refund|reversal|interest paid|transfer from|deposit/i;
  const TRANSFER = /credit card payment|card payment|autopay payment|payment thank you|online transfer to|transfer to (savings|checking)|internal transfer/i;

  function merchantKey(desc) {
    return (desc || '').toLowerCase()
      .replace(/(pos|debit|purchase|card|sq \*|tst\*|pp\*|paypal \*)/g, ' ')
      .replace(/#\s*\d+|\d{3,}|\*+\w*/g, ' ')
      .replace(/[^a-z& ]/g, ' ')
      .replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' ');
  }

  /* ---------------- parse() ---------------- */
  function parse(text) {
    const grid = splitCSV(text || '');
    const out = { transactions: [], income: [], skipped: 0, warnings: [], error: '' };
    if (grid.length < 2) { out.error = 'That file looks empty. It needs a header row and at least one transaction.'; return out; }
    const col = findColumns(grid[0]);
    if (col.date == null) { out.error = `Couldn't find a date column. Budgee looks for a header named "date" (found: ${grid[0].filter(Boolean).join(', ') || 'no headers'}).`; return out; }
    if (col.amount == null && col.debit == null) { out.error = 'Couldn\'t find an amount column. Budgee looks for a header named "amount", or "debit" and "credit".'; return out; }

    const raw = [];
    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];
      const date = parseDate(row[col.date]);
      let amt;
      if (col.debit != null) {
        const d = parseAmount(row[col.debit]), c = col.credit != null ? parseAmount(row[col.credit]) : NaN;
        amt = !isNaN(d) && d !== 0 ? -Math.abs(d) : !isNaN(c) ? Math.abs(c) : NaN;
      } else amt = parseAmount(row[col.amount]);
      if (!date || isNaN(amt) || amt === 0) { out.skipped++; continue; }
      raw.push({ date, amt, description: col.description != null ? row[col.description] || '' : '', category: col.category != null ? row[col.category] || '' : '' });
    }
    if (!raw.length) { out.error = 'No rows could be read. Check that dates look like 2026-10-14 or 10/14/2026 and amounts are numbers.'; return out; }

    // Sign convention: with a debit column, spending is negative. Otherwise the more common sign is spending.
    let spendSign = col.debit != null ? -1 : 1;
    if (col.debit == null) {
      const neg = raw.filter((x) => x.amt < 0).length, pos = raw.length - neg;
      spendSign = neg > pos ? -1 : 1;
    }
    let id = 0;
    for (const x of raw) {
      const isSpend = Math.sign(x.amt) === spendSign;
      const amount = Math.abs(x.amt);
      if (TRANSFER.test(x.description)) { out.skipped++; continue; }
      if (!isSpend || (spendSign === 1 && INCOME.test(x.description) && !x.category)) {
        out.income.push({ date: iso(x.date), amount, description: x.description });
        continue;
      }
      const given = normCategory(x.category);
      const guessed = guessCategory(x.description);
      out.transactions.push({
        id: ++id, date: iso(x.date), t: x.date.getTime(), amount: Math.round(amount * 100) / 100,
        description: x.description || given || 'Purchase', category: given || guessed || 'Other',
        autoCategory: !given && !!guessed, merchant: merchantKey(x.description) || (given || '').toLowerCase()
      });
    }
    out.transactions.sort((a, b) => a.t - b.t || a.id - b.id);
    if (out.skipped) out.warnings.push(`Skipped ${out.skipped} row${out.skipped === 1 ? '' : 's'} that ${out.skipped === 1 ? 'was a transfer or had' : 'were transfers or had'} a missing date or amount.`);
    const auto = out.transactions.filter((t) => t.autoCategory).length;
    if (auto) out.warnings.push(`Sorted ${auto} transaction${auto === 1 ? '' : 's'} into categories automatically from their descriptions.`);
    return out;
  }

  /* ---------------- helpers ---------------- */
  const DAY = 86400000;
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  const median = (a) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const quantile = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
  const monthKey = (t) => { const d = new Date(t); return d.getUTCFullYear() * 12 + d.getUTCMonth(); };
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; }; }

  /* Recurring bills: same merchant in 2+ months at a similar amount and similar day of month */
  function findRecurring(txns) {
    const groups = new Map();
    for (const t of txns) {
      const k = t.merchant || t.description.toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(t);
    }
    const out = [];
    for (const [key, list] of groups) {
      const byMonth = new Map();
      for (const t of list) { const mk2 = monthKey(t.t); if (!byMonth.has(mk2)) byMonth.set(mk2, []); byMonth.get(mk2).push(t); }
      if (byMonth.size < 2) continue;
      const firsts = [...byMonth.values()].map((a) => a[0]);
      if ([...byMonth.values()].some((a) => a.length > 2)) continue; // frequent merchants (coffee) are not bills
      const amts = firsts.map((t) => t.amount), mean = sum(amts) / amts.length;
      const cv = Math.sqrt(sum(amts.map((a) => (a - mean) ** 2)) / amts.length) / mean;
      const days = firsts.map((t) => new Date(t.t).getUTCDate());
      const dayMed = median(days);
      if (cv > 0.18 || days.some((d) => Math.abs(d - dayMed) > 5)) continue;
      const last = list[list.length - 1];
      // Everyday categories (a lunch spot you hit once a month) need stronger proof before counting as a bill
      if (!BILL_LIKE.has(last.category) && (byMonth.size < 3 || cv > 0.06 || list.length !== byMonth.size)) continue;
      out.push({ key, name: cleanName(last.description), category: last.category, amount: Math.round(median(amts) * 100) / 100, day: Math.round(dayMed), months: byMonth.size, ids: new Set(list.map((t) => t.id)) });
    }
    return out.sort((a, b) => b.amount - a.amount);
  }
  function cleanName(d) {
    const t = (d || '').replace(/[#*]\s*\w*\d\w*|\d{4,}|\s{2,}/g, ' ').replace(/\b(pos|debit|purchase)\b/gi, '').replace(/\s+/g, ' ').trim();
    // keep the bank's capitalization unless it's ALL CAPS
    return (t === t.toUpperCase() ? titleCase(t) : t).slice(0, 40) || 'Recurring charge';
  }

  /* ---------------- analyze() ---------------- */
  function analyze(parsed, opts = {}) {
    const txns = parsed.transactions;
    if (!txns.length) return null;
    const budget = Math.max(0, +opts.budget || 0);
    const asOf = opts.asOf ? parseDate(opts.asOf) : new Date(txns[txns.length - 1].t);
    const Y = asOf.getUTCFullYear(), M = asOf.getUTCMonth(), D = asOf.getUTCDate(), N = daysIn(Y, M);
    const monthStart = Date.UTC(Y, M, 1), asOfT = Date.UTC(Y, M, D);
    const used = txns.filter((t) => t.t <= asOfT);
    const thisMonth = used.filter((t) => t.t >= monthStart);
    const history = used.filter((t) => t.t < monthStart);

    const recurring = findRecurring(used);
    const recurringIds = new Set();
    recurring.forEach((r) => r.ids.forEach((id) => recurringIds.add(id)));
    // One-off splurges (far above that category's normal purchase) count as spent, but don't teach the model your habits
    const byCat = new Map();
    used.forEach((t) => { if (!recurringIds.has(t.id)) { if (!byCat.has(t.category)) byCat.set(t.category, []); byCat.get(t.category).push(t.amount); } });
    const catStats = new Map();
    for (const [k, arr] of byCat) { const med = median(arr); catStats.set(k, { med, mad: median(arr.map((a) => Math.abs(a - med))) || med * 0.25, n: arr.length }); }
    const isOneOff = (t) => { const st = catStats.get(t.category); return !!st && st.n >= 5 && !recurringIds.has(t.id) && t.amount > st.med + 6 * st.mad && t.amount > st.med * 2.5 && t.amount >= 40; };
    const oneOffIds = new Set(used.filter(isOneOff).map((t) => t.id));
    const isVar = (t) => !recurringIds.has(t.id) && !oneOffIds.has(t.id);

    // Daily variable spend for every calendar day we have data for
    const firstT = used[0].t;
    const dayTotals = new Map();
    for (const t of used) if (isVar(t)) dayTotals.set(t.t, (dayTotals.get(t.t) || 0) + t.amount);
    const days = [];
    for (let t = firstT; t <= asOfT; t += DAY) days.push({ t, wd: new Date(t).getUTCDay(), v: dayTotals.get(t) || 0, age: (asOfT - t) / DAY });

    // Weekday profile, recent days weigh more (30 day half-life)
    const histDays = days.filter((d) => d.t < monthStart);
    const pool = histDays.length >= 14 ? histDays : days;
    const wdMean = [], wdSamples = [];
    for (let wd = 0; wd < 7; wd++) {
      const ds = pool.filter((d) => d.wd === wd);
      let ws = 0, vs = 0;
      for (const d of ds) { const w = Math.pow(0.5, d.age / 30); ws += w; vs += w * d.v; }
      wdMean[wd] = ws ? vs / ws : 0;
      wdSamples[wd] = ds.map((d) => d.v);
    }
    const overallMean = sum(pool.map((d) => d.v)) / Math.max(1, pool.length);
    for (let wd = 0; wd < 7; wd++) if (wdSamples[wd].length < 2) { wdMean[wd] = overallMean; wdSamples[wd] = pool.map((d) => d.v); }

    // How this month compares with the usual pattern so far (shrunk toward 1 early in the month)
    const monthDays = days.filter((d) => d.t >= monthStart);
    const varSoFar = sum(monthDays.map((d) => d.v));
    const expectedSoFar = sum(monthDays.map((d) => wdMean[d.wd]));
    let pace = expectedSoFar > 0 && histDays.length >= 14 ? varSoFar / expectedSoFar : 1;
    pace = Math.min(2.5, Math.max(0.4, pace));
    const trust = D / (D + 10);
    const adj = 1 + trust * (pace - 1);

    // Remaining fixed bills this month
    const paidThisMonth = new Set(thisMonth.map((t) => t.merchant));
    const upcoming = recurring.filter((r) => !paidThisMonth.has(r.key) && r.day > D && r.day <= N + 2)
      .map((r) => ({ name: r.name, category: r.category, amount: r.amount, day: Math.min(N, r.day) }));
    const upcomingTotal = sum(upcoming.map((u) => u.amount));

    const spent = sum(thisMonth.map((t) => t.amount));
    const remainingDays = [];
    for (let d = D + 1; d <= N; d++) remainingDays.push({ d, wd: new Date(Date.UTC(Y, M, d)).getUTCDay() });
    const expectedVarRemaining = sum(remainingDays.map((x) => wdMean[x.wd])) * adj;

    // Simulate the rest of the month 2000 times by replaying real days from your history
    const rand = rng(Math.round(spent * 100) + D * 7919 + txns.length);
    const SIMS = 2000, totals = new Float64Array(SIMS);
    const upcomingByDay = new Map();
    upcoming.forEach((u) => upcomingByDay.set(u.day, (upcomingByDay.get(u.day) || 0) + u.amount));
    const pathSums = remainingDays.map(() => []);
    for (let s = 0; s < SIMS; s++) {
      let run = 0;
      remainingDays.forEach((x, i) => {
        const smp = wdSamples[x.wd];
        run += smp[Math.floor(rand() * smp.length)] * adj + (upcomingByDay.get(x.d) || 0);
        if (s < 400) pathSums[i].push(run);
      });
      totals[s] = spent + run;
    }
    const sorted = Array.from(totals).sort((a, b) => a - b);
    const projected = spent + expectedVarRemaining + upcomingTotal;
    const low = Math.min(projected, quantile(sorted, 0.1)), high = Math.max(projected, quantile(sorted, 0.9));
    const pOver = budget ? sorted.filter((v) => v > budget).length / SIMS : null;

    // Day-by-day lines for the chart
    const cumActual = [];
    let c = 0;
    for (let d = 1; d <= D; d++) { c += sum(thisMonth.filter((t) => new Date(t.t).getUTCDate() === d).map((t) => t.amount)); cumActual.push({ d, v: c }); }
    let run = spent;
    const cumForecast = [{ d: D, v: spent, lo: spent, hi: spent }];
    remainingDays.forEach((x, i) => {
      run += wdMean[x.wd] * adj + (upcomingByDay.get(x.d) || 0);
      const ps = pathSums[i].sort((a, b) => a - b);
      cumForecast.push({ d: x.d, v: run, lo: spent + quantile(ps, 0.1), hi: spent + quantile(ps, 0.9) });
    });
    // Same point last month
    const prevStart = Date.UTC(Y, M - 1, 1), prevN = daysIn(Y, M - 1);
    const prev = used.filter((t) => t.t >= prevStart && t.t < monthStart);
    const cumPrev = [];
    if (prev.length && history.length && new Date(history[0].t) <= new Date(prevStart + 3 * DAY)) {
      let pc = 0;
      for (let d = 1; d <= prevN; d++) { pc += sum(prev.filter((t) => new Date(t.t).getUTCDate() === d).map((t) => t.amount)); cumPrev.push({ d, v: pc }); }
    }
    const prevSamePoint = cumPrev.length ? cumPrev[Math.min(D, cumPrev.length) - 1].v : null;

    // Categories: this month, projection, and a typical month from full past months
    const fullMonths = new Map();
    for (const t of history) {
      const k = monthKey(t.t);
      if (!fullMonths.has(k)) fullMonths.set(k, []);
      fullMonths.get(k).push(t);
    }
    const firstDate = new Date(firstT);
    if (firstDate.getUTCDate() > 3) fullMonths.delete(monthKey(firstT)); // partial first month
    const nFull = fullMonths.size;
    const cats = new Map();
    const cat = (name) => { if (!cats.has(name)) cats.set(name, { name, spent: 0, varShare: 0, typical: null, upcoming: 0, count: 0 }); return cats.get(name); };
    thisMonth.forEach((t) => { const k = cat(t.category); k.spent += t.amount; k.count++; });
    upcoming.forEach((u) => { cat(u.category).upcoming += u.amount; });
    // share of variable spending by category, recency weighted
    let shareTot = 0;
    const shareMap = new Map();
    for (const t of used) if (isVar(t)) { const w = Math.pow(0.5, (asOfT - t.t) / DAY / 30) * t.amount; shareMap.set(t.category, (shareMap.get(t.category) || 0) + w); shareTot += w; }
    if (nFull) {
      const perCat = new Map();
      for (const list of fullMonths.values()) {
        const m = new Map();
        list.forEach((t) => m.set(t.category, (m.get(t.category) || 0) + t.amount));
        for (const [k, v] of m) perCat.set(k, (perCat.get(k) || 0) + v);
      }
      for (const [k, v] of perCat) cat(k).typical = v / nFull;
    }
    const categories = [...cats.values()].map((k) => {
      const varPart = shareTot ? expectedVarRemaining * (shareMap.get(k.name) || 0) / shareTot : 0;
      const projectedC = k.spent + k.upcoming + varPart;
      return { name: k.name, spent: r2(k.spent), projected: r2(projectedC), typical: k.typical == null ? null : r2(k.typical), discretionary: DISCRETIONARY.has(k.name), count: k.count };
    }).filter((k) => k.projected > 0.5 || k.spent > 0).sort((a, b) => b.projected - a.projected);

    // Unusual charges: far above what that category normally costs
    const unusual = [];
    for (const t of thisMonth) if (oneOffIds.has(t.id)) {
      const med = catStats.get(t.category).med;
      unusual.push({ date: t.date, description: t.description, category: t.category, amount: t.amount, typical: r2(med), times: t.amount / med });
    }
    unusual.sort((a, b) => b.amount - a.amount);

    // Weekend vs weekday habit
    const wkEnd = (wdMean[0] + wdMean[6]) / 2, wkDay = (wdMean[1] + wdMean[2] + wdMean[3] + wdMean[4] + wdMean[5]) / 5;

    const safePerDay = budget && remainingDays.length ? Math.max(0, (budget - spent - upcomingTotal) / remainingDays.length) : null;
    const usualPerDay = remainingDays.length ? sum(remainingDays.map((x) => wdMean[x.wd])) / remainingDays.length : 0;

    const result = {
      asOf: iso(asOf), year: Y, month: M, day: D, daysInMonth: N, daysLeft: N - D,
      budget, spent: r2(spent), projected: r2(projected), low: r2(low), high: r2(high), pOver,
      upcoming, upcomingTotal: r2(upcomingTotal), safePerDay: safePerDay == null ? null : r2(safePerDay), usualPerDay: r2(usualPerDay),
      pace, historyDays: histDays.length, monthsOfHistory: nFull,
      prevSamePoint: prevSamePoint == null ? null : r2(prevSamePoint),
      cumActual, cumForecast, cumPrev,
      categories, recurring: recurring.map(({ ids, key, ...r }) => r), unusual: unusual.slice(0, 5),
      weekendRatio: wkDay > 0 ? wkEnd / wkDay : 1,
      income: sum((parsed.income || []).filter((i) => { const t = parseDate(i.date).getTime(); return t >= monthStart && t <= asOfT; }).map((i) => i.amount)),
      transactionCount: thisMonth.length
    };
    result.insights = insights(result);
    return result;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const money = (x) => '$' + Math.round(x).toLocaleString('en-US');

  /* Plain-English advice, most valuable first */
  function insights(R) {
    const out = [];
    const over = R.budget ? R.projected - R.budget : 0;
    if (R.budget && over > 0) {
      const room = R.budget - R.spent - R.upcomingTotal;
      out.push({ level: 'bad', title: `On pace to go ${money(over)} over budget`, body: room > 0 && R.daysLeft
        ? `To finish on budget, keep everyday spending to ${money(room / R.daysLeft)} a day for the rest of the month. You usually spend about ${money(R.usualPerDay)} a day.`
        : `Your spending plus the bills still coming already passes your ${money(R.budget)} budget.`, impact: over * 2 });
      // where to cut: discretionary categories running hottest vs normal
      const cuts = R.categories.filter((c) => c.discretionary && c.typical && c.projected > c.typical * 1.1)
        .map((c) => ({ c, left: c.projected - c.spent, save: Math.min(c.projected - c.typical, c.projected - c.spent) }))
        .filter((x) => x.save >= 10).sort((a, b) => b.save - a.save).slice(0, 2);
      for (const { c, left, save } of cuts) out.push({ level: 'warn', title: `${c.name} is running ${Math.round((c.projected / c.typical - 1) * 100)}% above your usual month`, body: c.spent >= c.typical
        ? `You've already spent ${money(c.spent)}, more than a typical month's ${money(c.typical)}. Pausing ${c.name.toLowerCase()} for the rest of the month would save about ${money(left)}.`
        : `On pace for ${money(c.projected)} versus a typical ${money(c.typical)}. Bringing it back to normal would save about ${money(save)}.`, impact: save });
      if (!cuts.length) {
        const big = R.categories.filter((c) => c.discretionary).sort((a, b) => b.projected - a.projected)[0];
        if (big) out.push({ level: 'warn', title: `${big.name} is your biggest flexible expense`, body: `It's on pace for ${money(big.projected)} this month. Trimming it by a quarter would save about ${money(big.projected * 0.25)}.`, impact: big.projected * 0.25 });
      }
    } else if (R.budget) {
      out.push({ level: 'good', title: `On track to finish ${money(-over)} under budget`, body: `Projected month-end spending is ${money(R.projected)} against your ${money(R.budget)} budget${R.safePerDay != null && R.daysLeft ? `. You can spend up to ${money(R.safePerDay)} a day and still make it` : ''}.`, impact: 1000 });
    }
    if (R.prevSamePoint != null && R.prevSamePoint > 0) {
      const diff = R.spent - R.prevSamePoint, pct = diff / R.prevSamePoint;
      if (Math.abs(pct) >= 0.1) out.push({ level: pct > 0 ? 'warn' : 'good', title: `${Math.abs(Math.round(pct * 100))}% ${pct > 0 ? 'more' : 'less'} than this point last month`, body: `By day ${R.day} last month you'd spent ${money(R.prevSamePoint)}. This month it's ${money(R.spent)}.`, impact: Math.abs(diff) });
    }
    const subs = R.recurring.filter((r) => r.category === 'Subscriptions');
    if (subs.length >= 2) {
      const tot = sum(subs.map((s) => s.amount));
      out.push({ level: 'info', title: `${subs.length} subscriptions add up to ${money(tot)} a month`, body: `${subs.map((s) => s.name).slice(0, 4).join(', ')}${subs.length > 4 ? ', and more' : ''}. That's ${money(tot * 12)} a year, so it's worth checking you still use all of them.`, impact: tot * 1.5 });
    }
    if (R.weekendRatio >= 1.6) out.push({ level: 'info', title: `You spend ${R.weekendRatio.toFixed(1)}× more on weekends`, body: 'Weekend days cost noticeably more than weekdays. Planning one lower-cost weekend activity is an easy place to save.', impact: 40 });
    for (const u of R.unusual.slice(0, 2)) out.push({ level: 'info', title: `Unusual charge: ${money(u.amount)} at ${cleanName(u.description)}`, body: `That's about ${u.times.toFixed(1)}× your typical ${u.category.toLowerCase()} purchase of ${money(u.typical)}. Budgee treats it as a one-off, so it counts toward this month but doesn't raise your forecast for the days ahead.`, impact: u.amount / 8 });
    if (R.upcoming.length) out.push({ level: 'info', title: `${money(R.upcomingTotal)} in bills still to come`, body: `${R.upcoming.map((u) => `${u.name} (${money(u.amount)}, around the ${ordinal(u.day)})`).join(', ')}. These are included in your forecast.`, impact: 30 });
    if (R.historyDays < 28) out.push({ level: 'info', title: 'Add more history for a sharper forecast', body: 'Budgee learns your weekly rhythm and regular bills from past months. Uploading two or three months of transactions makes the forecast much more accurate.', impact: 20 });
    return out.sort((a, b) => b.impact - a.impact);
  }
  const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th');

  return { parse, analyze, parseDate, parseAmount, guessCategory, splitCSV, money };
});
