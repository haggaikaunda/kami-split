const fs = require('fs'),
  vm = require('vm'),
  assert = require('assert');
const code = fs
  .readFileSync('app.js', 'utf8')
  .split('window.addEventListener')[0];
const context = vm.createContext({ Intl, Date, console });
vm.runInContext(code, context);
for (const [expr, result] of [
  ["cents('0.10')", 10],
  ["cents('42.18')", 4218],
  ["cents('1.001')", null],
  ["cents('-1')", null],
  ['balance()', 4218],
  ['statement()', 'Kaunda owes Mizenin'],
])
  assert.equal(vm.runInContext(expr, context), result, expr);
vm.runInContext(
  "records.push({type:'expense',amount:1001,payer:'Kaunda',alloc:[501,500]})",
  context,
);
assert.equal(vm.runInContext('balance()', context), 3718);
vm.runInContext(
  "records.push({type:'settlement',from:'Kaunda',to:'Mizenin',amount:3718})",
  context,
);
assert.equal(vm.runInContext('balance()', context), 0);
vm.runInContext('records[records.length-2].deleted=true', context);
assert.equal(vm.runInContext('balance()', context), 500);
console.log(
  'Passed: decimal parsing, initial balance, odd-cent expense, repayment, soft-delete balance.',
);
vm.runInContext(
  fs.readFileSync('redesign.js', 'utf8').split('/* The existing listener')[0],
  context,
);
assert.equal(
  vm.runInContext('balance()', context),
  4218,
  'Trip samples preserve initial relationship balance',
);
assert.equal(vm.runInContext("totalOf(tripRecords('maui'))", context), 164420);
assert.equal(
  vm.runInContext(
    "chartBuckets(activeExpenses(),'monthly',2026,8).length",
    context,
  ),
  12,
);
assert.equal(
  vm.runInContext(
    "chartBuckets(activeExpenses(),'daily',2026,8).length",
    context,
  ),
  30,
);
assert.equal(
  vm.runInContext(
    "chartBuckets(activeExpenses(),'yearly',2026,8).length",
    context,
  ),
  5,
);
assert.equal(
  vm.runInContext(
    "totalOf(chartBuckets(activeExpenses(),'monthly',2026,8)[8].records)",
    context,
  ),
  191456,
);
vm.runInContext(
  "records.push({id:999,type:'settlement',amount:100000,from:'Kaunda',to:'Mizenin',date:'2026-09-20',tripId:'maui'})",
  context,
);
assert.equal(
  vm.runInContext("totalOf(tripRecords('maui'))", context),
  164420,
  'Repayments excluded from trip spending',
);
vm.runInContext('records.find(r=>r.id===100).deleted=true', context);
assert.equal(
  vm.runInContext("totalOf(tripRecords('maui'))", context),
  100420,
  'Deleted expenses excluded',
);
vm.runInContext(
  'records.find(r=>r.id===101).amount=10000;records.find(r=>r.id===101).alloc=[5000,5000]',
  context,
);
assert.equal(
  vm.runInContext("totalOf(tripRecords('maui'))", context),
  46420,
  'Edited expense totals update',
);
assert.equal(
  vm.runInContext("totalOf(tripRecords('maui'),'share')", context),
  23210,
  'Allocated share is distinct from paid',
);
console.log(
  'Passed: trip association, daily/monthly/yearly buckets, shares, edits, and repayment/deletion exclusions.',
);
