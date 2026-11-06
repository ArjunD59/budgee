// Generates sample-transactions.csv: a realistic student budget, July through mid October 2026,
// in the format many banks export (spending negative, income positive).
const fs = require('fs');
let s = 20261017;
const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const amt = (lo, hi) => Math.round((lo + rnd() * (hi - lo)) * 100) / 100;
const rows = [];
const add = (y, m, d, desc, cat, a) => rows.push([`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, desc, cat, a]);
const months = [[2026, 7, 31], [2026, 8, 31], [2026, 9, 30], [2026, 10, 17]];
months.forEach(([y, m, last], mi) => {
  const isOct = m === 10;
  // fixed bills
  const bills = [[1, 'Maple Court Apartments Rent', 'Housing', 950], [3, 'Planet Fitness', 'Fitness', 24.99], [5, 'Spotify', 'Subscriptions', 11.99],
    [12, 'Mint Mobile', 'Utilities', 30], [15, 'City Electric Co', 'Utilities', amt(62, 88)], [18, 'Netflix', 'Subscriptions', 15.49], [22, 'iCloud Storage', 'Subscriptions', 2.99], [24, 'Geico Insurance', 'Insurance', 96.4]];
  bills.forEach(([d, desc, cat, a]) => { if (d <= last) add(y, m, d, desc, cat, -a); });
  // paychecks
  [1, 15].forEach((d) => { if (d <= last) add(y, m, d, 'Payroll Direct Deposit', '', 840); });
  for (let d = 1; d <= last; d++) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(), weekend = wd === 0 || wd === 6;
    if (!weekend && rnd() < 0.55) add(y, m, d, pick(['Starbucks #4471', 'Dunkin #331', 'Corner Cafe']), 'Coffee', -amt(3.8, 7.2));
    if ((wd === 0 && rnd() < 0.55) || (wd === 3 && rnd() < 0.5)) add(y, m, d, pick(["Trader Joe's #612", 'Kroger #518', 'Wegmans']), 'Groceries', -amt(36, 82));
    const dineP = (weekend ? 0.6 : 0.2) * (isOct ? 1.6 : 1);
    if (rnd() < dineP) add(y, m, d, pick(['Chipotle', 'Sweetgreen', 'DoorDash *Halal Guys', 'Uber Eats *Shake Shack', 'Cava', 'Pizza Hut']), 'Dining', -amt(10, weekend ? 38 : 20));
    if (!weekend && rnd() < 0.25) add(y, m, d, pick(['Metro Transit', 'Uber Trip']), 'Transport', -amt(5.5, 19));
    if (rnd() < 0.06) add(y, m, d, 'Shell Gas #812', 'Gas', -amt(28, 44));
    if (rnd() < 0.08) add(y, m, d, pick(['Amazon.com', 'Target', 'Uniqlo']), 'Shopping', -amt(12, 60));
    if (weekend && rnd() < 0.15) add(y, m, d, pick(['AMC Theatres', 'Ticketmaster', 'Round1 Bowling']), 'Entertainment', -amt(14, 55));
  }
  if (m === 10) add(y, m, 9, 'Best Buy #1182', 'Shopping', -249.99);
  if (m === 8) add(y, m, 26, 'Campus Bookstore', 'Education', -142.5);
});
rows.sort((a, b) => a[0].localeCompare(b[0]));
const csv = ['Date,Description,Category,Amount', ...rows.map((r) => [r[0], `"${r[1]}"`, r[2], r[3].toFixed(2)].join(','))].join('\n') + '\n';
fs.writeFileSync(__dirname + '/../sample-transactions.csv', csv);
console.log(rows.length, 'rows');
