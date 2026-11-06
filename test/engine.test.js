const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('reads the old Budgee format (date,category,amount)', () => {
  const p = E.parse(read('sample.csv'));
  assert.ok(!p.error, p.error);
  assert.ok(p.transactions.length > 10);
  assert.ok(p.transactions.every((t) => t.amount > 0));
});

test('reads a bank export: negative spending, income, transfers, quotes', () => {
  const csv = 'Transaction Date,Description,Amount\n' +
    '10/01/2026,"PAYROLL DIRECT DEP",1200.00\n' +
    '10/02/2026,"STARBUCKS #123, NEW BRUNSWICK",-5.75\n' +
    '10/03/2026,"CHASE CREDIT CARD PAYMENT",-400.00\n' +
    '10/04/2026,"TRADER JOE\'S #612",-64.10\n' +
    '10/05/2026,"UBER   TRIP",($18.20)\n';
  const p = E.parse(csv);
  assert.strictEqual(p.transactions.length, 3);
  assert.strictEqual(p.income.length, 1);
  assert.deepStrictEqual(p.transactions.map((t) => t.category), ['Coffee', 'Groceries', 'Transport']);
  assert.strictEqual(p.transactions[2].amount, 18.2);
});

test('reads debit and credit columns', () => {
  const p = E.parse('Date,Description,Debit,Credit\n2026-10-01,Netflix,15.49,\n2026-10-02,Refund,,20\n');
  assert.strictEqual(p.transactions.length, 1);
  assert.strictEqual(p.transactions[0].category, 'Subscriptions');
  assert.strictEqual(p.income.length, 1);
});

test('explains a file it cannot read', () => {
  assert.match(E.parse('foo,bar\n1,2\n').error, /date column/);
  assert.match(E.parse('').error, /empty/);
});

test('dates and amounts in common formats', () => {
  for (const s of ['2026-10-14', '10/14/2026', '10/14/26', 'Oct 14, 2026', '14 Oct 2026']) assert.strictEqual(E.parseDate(s).toISOString().slice(0, 10), '2026-10-14', s);
  assert.strictEqual(E.parseAmount('$1,234.50'), 1234.5);
  assert.strictEqual(E.parseAmount('(12.00)'), -12);
  assert.strictEqual(E.parseAmount('-$3.10'), -3.1);
});

test('sample forecast: finds bills, one-offs, and stays sensible', () => {
  const p = E.parse(read('sample-transactions.csv'));
  const R = E.analyze(p, { budget: 2200 });
  assert.strictEqual(R.asOf, '2026-10-17');
  const names = R.recurring.map((r) => r.name);
  for (const n of ['Netflix', 'Spotify', 'PSE&G Electric']) assert.ok(names.includes(n), n);
  assert.ok(!names.some((n) => /starbucks|chipotle/i.test(n)), 'everyday merchants are not bills');
  assert.ok(R.upcoming.some((u) => u.name === 'Geico Insurance'), 'insurance on the 24th is still to come');
  assert.ok(R.unusual.some((u) => /best buy/i.test(u.description)));
  assert.ok(R.low <= R.projected && R.projected <= R.high);
  assert.ok(R.projected > R.spent + R.upcomingTotal);
  assert.ok(R.projected < R.spent * 1.6, 'one-off purchase does not inflate the rest of the month');
  assert.ok(R.pOver > 0.5 && R.insights[0].level === 'bad');
});

test('an on-track month says so', () => {
  const p = E.parse(read('sample-transactions.csv'));
  const R = E.analyze(p, { budget: 4000 });
  assert.strictEqual(R.insights[0].level, 'good');
  assert.ok(R.pOver < 0.01);
});

test('works with only a few days of data', () => {
  const p = E.parse('date,amount\n2026-10-01,20\n2026-10-02,35\n2026-10-03,12\n');
  const R = E.analyze(p, { budget: 800 });
  assert.ok(R.projected > 67 && R.projected < 1000);
  assert.ok(R.insights.some((i) => /more history/.test(i.title)));
});
