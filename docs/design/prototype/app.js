const $ = (s) => document.querySelector(s),
  members = ['Kaunda', 'Mizenin'];
const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const money = (n, c = 'USD') =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(
    n / 100,
  );
const cents = (s) =>
  /^\d{1,9}(\.\d{1,2})?$/.test(String(s).trim())
    ? Number(String(s).split('.')[0]) * 100 +
      Number((String(s).split('.')[1] || '').padEnd(2, '0'))
    : null;
let records = [],
  events = [],
  page = 'home',
  split = 'equal',
  editing = null,
  busy = false,
  houseName = 'Our household';
function seed() {
  records = [
    {
      id: 1,
      type: 'expense',
      name: 'Weekly groceries',
      amount: 8436,
      payer: 'Mizenin',
      alloc: [4218, 4218],
      date: '2026-09-19',
      note: 'Groceries for the week',
      icon: '♧',
      version: 1,
    },
    {
      id: 2,
      type: 'expense',
      name: 'Dinner at Juniper',
      amount: 6800,
      payer: 'Kaunda',
      alloc: [3400, 3400],
      date: '2026-09-18',
      note: 'Friday dinner',
      icon: '♜',
      version: 1,
    },
    {
      id: 3,
      type: 'expense',
      name: 'Internet · September',
      amount: 6800,
      payer: 'Mizenin',
      alloc: [3400, 3400],
      date: '2026-09-16',
      note: '',
      icon: '⌁',
      version: 1,
    },
    {
      id: 4,
      type: 'settlement',
      name: 'Kaunda repaid Mizenin',
      amount: 2500,
      from: 'Kaunda',
      to: 'Mizenin',
      date: '2026-09-14',
      note: 'Last week’s balance',
      version: 1,
    },
    {
      id: 5,
      type: 'expense',
      name: 'Household essentials',
      amount: 5000,
      payer: 'Mizenin',
      alloc: [2500, 2500],
      date: '2026-09-12',
      note: '',
      icon: '⌂',
      version: 1,
    },
  ];
  events = records.map((r) => ({
    ...r,
    event: 'created',
    at: r.date,
    recordId: r.id,
    actor: 'Kaunda',
  }));
}
seed();
function balance() {
  return records
    .filter((r) => !r.deleted)
    .reduce(
      (b, r) =>
        b +
        (r.type === 'settlement'
          ? r.from === 'Kaunda'
            ? -r.amount
            : r.amount
          : r.payer === 'Mizenin'
            ? r.alloc[0]
            : -r.alloc[1]),
      0,
    );
}
function statement(b = balance()) {
  return b === 0
    ? 'You’re all settled up'
    : b > 0
      ? 'Kaunda owes Mizenin'
      : 'Mizenin owes Kaunda';
}
function toast(s) {
  $('#toast').textContent = s;
  $('#toast').style.display = 'block';
  setTimeout(() => ($('#toast').style.display = 'none'), 3500);
}
function date(s) {
  return new Date(s + 'T12:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}
function row(r, isEvent = false) {
  let action = isEvent && r.event !== 'created' ? ` · ${r.event}` : '';
  return `<button class="activity ${r.type === 'settlement' ? 'settlement' : ''}" onclick="detail(${r.recordId || r.id})"><span class="activity-name"><span class="activity-icon">${r.type === 'settlement' ? '↗' : r.icon || '◫'}</span><span><strong>${esc(r.name)}${action}</strong><small>${r.type === 'settlement' ? 'Repayment recorded' : esc(r.payer) + ' paid · Split ' + ((r.method || 'equal') === 'equal' ? 'equally' : 'by amount')}${r.deleted ? ' · Deleted' : ''}<span class="mobile-date"> · ${date(r.at || r.date)}</span></small></span></span><span class="activity-date">${date(r.at || r.date)}</span><span class="activity-amount">${money(r.amount)}<small>${r.type === 'settlement' ? 'Repayment' : 'Expense'}</small></span></button>`;
}
function render() {
  page = location.hash.slice(1) || 'home';
  document
    .querySelectorAll('nav a')
    .forEach((a) => a.classList.toggle('active', a.dataset.page === page));
  $('#crumb').textContent =
    {
      home: 'Overview',
      history: 'History',
      household: 'Household',
      auth: 'Sign in',
    }[page] || 'Overview';
  if (page === 'history') return activityHistory();
  if (page === 'household') return household();
  if (page === 'auth') return auth();
  let b = balance(),
    paid = members.map((m) =>
      records
        .filter((r) => !r.deleted && r.type === 'expense' && r.payer === m)
        .reduce((s, r) => s + r.amount, 0),
    ),
    total = paid[0] + paid[1];
  $('#main').innerHTML =
    `<div class="heading"><div><h1>A little clarity, together.</h1><p class="sub">Here’s where things stand in your household.</p></div><div class="actions"><button class="btn" onclick="settlement()">↗ Record repayment</button><button class="btn primary" onclick="expense()">＋ Add expense</button></div></div><section class="balance" aria-label="Current balance"><div><div class="eyebrow">Your balance · All time</div><h2>${statement(b)}</h2><div class="amount">${money(Math.abs(b))}<span class="currency">USD</span></div><p class="sub">${b ? 'A shared view. No second-guessing.' : 'Everything is accounted for.'}</p><button class="btn" onclick="explain()">How this adds up <span>↗</span></button></div><div class="balance-people"><div class="person"><span class="avatar ${b >= 0 ? 'pink' : 'sage'}">${b >= 0 ? 'K' : 'M'}</span><small>${b >= 0 ? 'Kaunda' : 'Mizenin'}</small></div><span class="transfer" ${b === 0 ? 'style="visibility:hidden"' : ''}></span><div class="person"><span class="avatar ${b >= 0 ? 'sage' : 'pink'}">${b >= 0 ? 'M' : 'K'}</span><small>${b >= 0 ? 'Mizenin' : 'Kaunda'}</small></div></div></section><div class="stats">${members.map((m, i) => `<section class="card"><div class="contribution-top"><b class="avatar ${i ? 'sage' : 'pink'}">${m[0]}</b><span>${m} paid</span><span class="sub">All time</span></div><div class="contribution-total">${money(paid[i])}</div><div class="bar"><span style="width:${total ? (paid[i] / total) * 100 : 0}%;background:${i ? '#9caf87' : '#c69b89'}"></span></div><p class="sub">${total ? Math.round((paid[i] / total) * 100) : 0}% of ${money(total)} in shared expenses</p></section>`).join('')}</div><section><div class="section-head"><h2>Recent activity</h2><a class="text" href="#history">View all activity →</a></div><div class="ledger"><div class="ledger-labels"><span>Expense / repayment</span><span>Date</span><span>Amount</span></div>${
      events
        .slice()
        .reverse()
        .sort((a, b) => b.at.localeCompare(a.at))
        .slice(0, 5)
        .map((r) => row(r, true))
        .join('') ||
      '<div class="empty">Your story starts with your first expense.</div>'
    }</div></section><div class="note-row">♧ Only household members can see your shared expenses.</div>`;
}
function modal(title, subtitle, body) {
  $('#modal').innerHTML =
    `<div class="modal-head"><div><h2 id="dialog-title">${title}</h2><div class="sub">${subtitle}</div></div><button class="close" aria-label="Close dialog" onclick="closeModal()">×</button></div>${body}`;
  $('#modal').setAttribute('aria-labelledby', 'dialog-title');
  if (!$('#modal').open) $('#modal').showModal();
}
function closeModal() {
  if ($('#expense-form') && $('#expense-form').dataset.dirty === 'true') {
    if (!confirm('Discard your unsaved expense changes?')) return;
  }
  $('#modal').close();
}
function expense(id) {
  editing = id ? records.find((r) => r.id === id) : null;
  split = editing?.method || 'equal';
  const r = editing || {
    name: '',
    amount: 0,
    date: '2026-09-20',
    payer: 'Kaunda',
    note: '',
    alloc: [0, 0],
  };
  modal(
    editing ? 'Edit expense' : 'Add an expense',
    'The little things, fairly shared.',
    `<form id="expense-form" novalidate><div class="fields"><div class="full"><label for="description">What was it for?</label><input id="description" placeholder="e.g. Groceries for the week" value="${esc(r.name)}" maxlength="120" required></div><div><label for="amount">Amount</label><input id="amount" inputmode="decimal" placeholder="0.00" value="${r.amount ? (r.amount / 100).toFixed(2) : ''}" required></div><div><label for="currency">Currency</label><select id="currency"><option>USD</option></select><small>Household currency. No conversion.</small></div><div><label for="paid">Paid by</label><select id="paid">${members.map((m) => `<option ${m === r.payer ? 'selected' : ''}>${m}</option>`).join('')}</select></div><div><label for="date">Date</label><input type="date" id="date" value="${r.date}" required></div></div><div class="form-section"><div class="section-head"><h3 style="margin:0">Who’s sharing this?</h3><span class="sub">Split the total</span></div><div class="segmented" aria-label="Split method"><button type="button" id="equal" onclick="setSplit('equal')">Equally</button><button type="button" id="exact" onclick="setSplit('exact')">Exact amounts</button></div>${members.map((m, i) => `<div class="allocation"><input type="checkbox" id="participant${i}" aria-label="Include ${m}" ${!editing || r.alloc[i] > 0 ? 'checked' : ''}><b class="avatar ${i ? 'sage' : 'pink'}">${m[0]}</b><span>${m}${i === 0 ? ' (you)' : ''}</span><span class="allocation-value" id="allocation${i}"></span></div>`).join('')}<div class="reconcile" id="reconcile" role="status"></div></div><div class="form-section"><label for="note">Note <span class="sub">(optional)</span></label><textarea id="note" rows="2" placeholder="Anything worth remembering?">${esc(r.note)}</textarea></div><div id="form-error" role="alert"></div><div class="form-foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button id="save" class="btn primary">${editing ? 'Save changes' : 'Add expense'}</button></div></form>`,
  );
  drawAlloc(r.alloc);
  $('#expense-form').addEventListener('input', () => {
    $('#expense-form').dataset.dirty = 'true';
    reconcile();
  });
  $('#expense-form').addEventListener('change', reconcile);
  $('#expense-form').onsubmit = saveExpense;
  reconcile();
  $('#description').focus();
}
function setSplit(s) {
  split = s;
  drawAlloc();
  reconcile();
}
function drawAlloc(vals = [0, 0]) {
  members.forEach(
    (m, i) =>
      ($('#allocation' + i).innerHTML =
        split === 'exact'
          ? `<input type="text" inputmode="decimal" id="exact${i}" aria-label="${m} allocation" value="${(vals[i] / 100).toFixed(2)}">`
          : `<strong id="equal${i}"></strong>`),
  );
  $('#equal').classList.toggle('selected', split === 'equal');
  $('#exact').classList.toggle('selected', split === 'exact');
}
function allocations() {
  let amount = cents($('#amount').value),
    included = members.map((_, i) => $('#participant' + i).checked),
    count = included.filter(Boolean).length,
    rem = (amount || 0) % count;
  return included.map((inc, i) =>
    !inc
      ? 0
      : split === 'exact'
        ? cents($('#exact' + i).value)
        : Math.floor((amount || 0) / count) + (rem-- > 0 ? 1 : 0),
  );
}
function reconcile() {
  let a = cents($('#amount').value),
    alloc = allocations(),
    sum = alloc.reduce((s, n) => s + (n || 0), 0),
    valid = a > 0 && alloc.every((n) => n !== null) && a === sum;
  members.forEach((_, i) => {
    if (split === 'equal') $('#equal' + i).textContent = money(alloc[i]);
    else $('#exact' + i).disabled = !$('#participant' + i).checked;
  });
  $('#reconcile').className = 'reconcile' + (valid ? '' : ' bad');
  $('#reconcile').textContent = valid
    ? `✓ ${money(sum)} of ${money(a)} allocated · Everything adds up`
    : a > 0
      ? `${money(sum)} of ${money(a)} allocated · ${money(Math.abs(a - sum))} ${sum > a ? 'over total' : 'left to allocate'}`
      : 'Enter an amount greater than $0.00, with up to 2 decimal places.';
  $('#save').disabled = !valid;
}
function formError(s) {
  $('#form-error').innerHTML = `<div class="error">${s}</div>`;
}
function saveExpense(e) {
  e.preventDefault();
  if (busy) return;
  let amount = cents($('#amount').value),
    alloc = allocations(),
    name = $('#description').value.trim(),
    d = $('#date').value;
  if (!name || !d) return formError('Add a description and a valid date.');
  if (
    !amount ||
    alloc.some((x) => x === null) ||
    alloc.reduce((a, b) => a + b, 0) !== amount
  )
    return formError('Check the amount and allocations before saving.');
  busy = true;
  $('#save').disabled = true;
  $('#save').textContent = 'Saving…';
  let r = {
    id: editing?.id || Date.now(),
    type: 'expense',
    name,
    amount,
    alloc,
    method: split,
    tripId: $('#expense-trip')?.value || null,
    category: $('#expense-category')?.value || 'Other',
    payer: $('#paid').value,
    date: d,
    note: $('#note').value,
    version: (editing?.version || 0) + 1,
    icon: editing?.icon || '◫',
  };
  setTimeout(() => {
    if (editing) records = records.map((x) => (x.id === r.id ? r : x));
    else records.push(r);
    events.push({
      ...r,
      event: editing ? 'edited' : 'created',
      recordId: r.id,
      at: '2026-09-20',
      actor: 'Kaunda',
    });
    busy = false;
    $('#modal').close();
    render();
    toast(
      editing
        ? 'Expense updated · Revision saved'
        : 'Expense added · Balance updated',
    );
  }, 350);
}
function settlement() {
  let b = balance();
  modal(
    'Record a repayment',
    'Already paid them back? Make a note of it here.',
    `<form id="settlement-form" novalidate><div class="fields"><div><label for="from">From</label><select id="from">${members.map((m) => `<option ${m === (b >= 0 ? 'Kaunda' : 'Mizenin') ? 'selected' : ''}>${m}</option>`).join('')}</select></div><div><label for="to">To</label><select id="to">${members.map((m) => `<option ${m === (b >= 0 ? 'Mizenin' : 'Kaunda') ? 'selected' : ''}>${m}</option>`).join('')}</select></div><div><label for="repay-amount">Amount · USD</label><input id="repay-amount" inputmode="decimal" value="${(Math.abs(b) / 100).toFixed(2)}"></div><div><label for="repay-date">Date</label><input id="repay-date" type="date" value="2026-09-20"></div><div class="full"><label for="repay-note">Note <span class="sub">(optional)</span></label><input id="repay-note" placeholder="e.g. Sent by bank transfer"></div></div><div class="preview" id="settlement-preview" role="status"></div><p class="sub" style="margin-top:14px">This records a repayment. No money is moved.</p><div id="form-error" role="alert"></div><div class="form-foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button id="save" class="btn primary">Record repayment</button></div></form>`,
  );
  $('#settlement-form').oninput = previewSettlement;
  $('#settlement-form').onsubmit = (e) => {
    e.preventDefault();
    if (busy) return;
    let a = cents($('#repay-amount').value),
      from = $('#from').value,
      to = $('#to').value;
    if (!a || from === to || !$('#repay-date').value)
      return formError(
        'Choose different members, a positive amount, and a date.',
      );
    busy = true;
    $('#save').disabled = true;
    $('#save').textContent = 'Saving…';
    let r = {
      id: Date.now(),
      type: 'settlement',
      name: `${from} repaid ${to}`,
      from,
      to,
      amount: a,
      date: $('#repay-date').value,
      note: $('#repay-note').value,
      version: 1,
    };
    setTimeout(() => {
      records.push(r);
      events.push({
        ...r,
        recordId: r.id,
        event: 'created',
        at: '2026-09-20',
        actor: 'Kaunda',
      });
      busy = false;
      $('#modal').close();
      render();
      toast('Repayment recorded · Balance updated');
    }, 350);
  };
  previewSettlement();
}
function previewSettlement() {
  let a = cents($('#repay-amount').value),
    b = balance(),
    after = b + ($('#from').value === 'Kaunda' ? -a : a),
    valid = a > 0 && $('#from').value !== $('#to').value;
  $('#save').disabled = !valid;
  $('#settlement-preview').innerHTML = valid
    ? `<div class="eyebrow">Balance preview</div><p>Now · ${statement(b)} ${money(Math.abs(b))}</p><p>After repayment</p><strong>${statement(after)}${after ? ' ' + money(Math.abs(after)) : ''}</strong>${b * after < 0 ? '<p class="error">This repayment exceeds the current balance. The direction of who owes whom will reverse.</p>' : ''}`
    : 'Enter a positive amount and choose two different members.';
}
function detail(id) {
  let r = records.find((x) => x.id === id);
  if (!r) return unavailable();
  modal(
    esc(r.name),
    `${r.deleted ? 'Deleted · ' : ''}${r.type === 'expense' ? 'Expense' : 'Repayment'} · ${date(r.date)}, ${r.date.slice(0, 4)}`,
    `<div class="amount" style="font-size:36px;margin-bottom:25px">${money(r.amount)}<span class="currency">USD</span></div><div class="detail-grid"><div><small>${r.type === 'expense' ? 'Paid by' : 'From'}</small>${esc(r.payer || r.from)}</div><div><small>${r.type === 'expense' ? 'Created by' : 'To'}</small>${r.type === 'expense' ? esc(events.find((e) => e.recordId === id && e.event === 'created')?.actor || 'Kaunda') : esc(r.to)}</div><div><small>Date</small>${esc(r.date)}</div><div><small>Revision</small>${r.version}</div></div>${r.type === 'expense' ? `<div class="form-section"><h3>Split details</h3>${members.map((m, i) => `<div class="allocation"><b class="avatar ${i ? 'sage' : 'pink'}">${m[0]}</b>${m}<strong class="allocation-value">${money(r.alloc[i])}</strong></div>`).join('')}<div class="reconcile">✓ ${money(r.amount)} allocated in full</div></div>` : ''}<div class="form-section"><label>Note</label><p class="sub">${esc(r.note) || 'No note added.'}</p></div><div class="form-section"><h3>Activity & revisions</h3>${events
      .filter((e) => e.recordId === id)
      .reverse()
      .map(
        (e) =>
          `<div class="history-entry">${e.event === 'created' ? 'Created' : e.event === 'edited' ? 'Edited' : 'Deleted'} by ${e.actor}<small>${date(e.at)} · ${esc(e.name)} · ${money(e.amount)}${e.alloc ? ' · Kaunda ' + money(e.alloc[0]) + ', Mizenin ' + money(e.alloc[1]) : ''}</small>${e.reason ? `<small>Reason: ${esc(e.reason)}</small>` : ''}</div>`,
      )
      .join(
        '',
      )}</div>${r.deleted ? '<div class="error">This record is retained for history and excluded from the balance.</div>' : r.type === 'expense' ? `<div class="form-foot"><button class="btn" style="color:#9f3c32" onclick="confirmDelete(${id})">Delete expense</button><button class="btn primary" onclick="expense(${id})">Edit expense</button></div>` : ''}`,
  );
}
function confirmDelete(id) {
  let r = records.find((x) => x.id === id);
  modal(
    'Delete this expense?',
    'This change will be visible to everyone in the household.',
    `<p><strong>${esc(r.name)} · ${money(r.amount)}</strong></p><p class="sub">It will be removed from the balance. The original expense and its revisions stay in history.</p><label for="reason">Reason (optional)</label><input id="reason" placeholder="e.g. Added by mistake"><div class="form-foot"><button class="btn" onclick="detail(${id})">Keep expense</button><button class="btn danger" onclick="deleteExpense(${id})">Delete expense</button></div>`,
  );
}
function deleteExpense(id) {
  let r = records.find((x) => x.id === id);
  if (r.deleted) return;
  r.deleted = true;
  r.version++;
  events.push({
    ...r,
    event: 'deleted',
    recordId: id,
    at: '2026-09-20',
    actor: 'Kaunda',
    reason: $('#reason').value,
  });
  $('#modal').close();
  render();
  toast('Expense deleted · History preserved');
}
function activityHistory() {
  $('#main').innerHTML =
    `<div class="heading"><div><h1>Your shared history.</h1><p class="sub">Every expense, repayment, and change. All accounted for.</p></div><button class="btn primary" onclick="expense()">＋ Add expense</button></div><div class="filterbar"><input id="search" aria-label="Search history" placeholder="Search descriptions…"><select id="type" aria-label="Activity type"><option value="all">All activity</option><option value="expense">Expenses</option><option value="settlement">Repayments</option><option value="edited">Edits</option><option value="deleted">Deletions</option></select><select id="member" aria-label="Filter by member"><option>All members</option>${members.map((m) => `<option>${m}</option>`).join('')}</select></div><div class="sub" style="margin-bottom:14px">Newest first · All dates · USD</div><div class="ledger" id="history-list"></div>`;
  ['#search', '#type', '#member'].forEach(
    (s) => ($(s).oninput = filterHistory),
  );
  filterHistory();
}
function filterHistory() {
  let q = $('#search').value.toLowerCase(),
    type = $('#type').value,
    member = $('#member').value;
  let list = events
    .slice()
    .reverse()
    .filter(
      (e) =>
        e.name.toLowerCase().includes(q) &&
        (type === 'all' ||
          (e.type === type && e.event === 'created') ||
          e.event === type) &&
        (member === 'All members' ||
          e.payer === member ||
          e.from === member ||
          e.to === member ||
          e.alloc?.[members.indexOf(member)] > 0),
    )
    .sort((a, b) => b.at.localeCompare(a.at));
  $('#history-list').innerHTML =
    list.map((e) => row(e, true)).join('') ||
    '<div class="empty"><h2>No matching activity</h2><p>Try another search or choose all activity.</p><button class="btn" onclick="activityHistory()">Clear filters</button></div>';
}
function explain() {
  let shares = members.map((_, i) =>
      records
        .filter((r) => !r.deleted && r.type === 'expense')
        .reduce((s, r) => s + r.alloc[i], 0),
    ),
    paid = members.map((m) =>
      records
        .filter((r) => !r.deleted && r.payer === m)
        .reduce((s, r) => s + r.amount, 0),
    ),
    repay = records
      .filter((r) => r.type === 'settlement')
      .reduce((s, r) => s + (r.from === 'Kaunda' ? r.amount : -r.amount), 0);
  modal(
    'How your balance adds up',
    'All active expenses and recorded repayments · USD',
    `<div class="allocation">Kaunda’s share of expenses<strong class="allocation-value">${money(shares[0])}</strong></div><div class="allocation">Already paid for expenses<strong class="allocation-value">− ${money(paid[0])}</strong></div><div class="allocation">Net repayments sent<strong class="allocation-value">− ${money(repay)}</strong></div><div class="preview"><strong>${statement()} ${money(Math.abs(balance()))}</strong></div><p class="sub" style="margin-top:20px">Contributions show expenses paid. Repayments reduce what’s owed without increasing shared spending.</p><a href="#history" class="btn" onclick="$('#modal').close()">Explore the full history →</a>`,
  );
}
function household() {
  $('#main').innerHTML =
    `<div class="heading"><div><h1>Your household.</h1><p class="sub">A private place for the expenses you share.</p></div></div><div class="settings"><section class="card"><h2>Household details</h2><label for="house-name">Household name</label><input id="house-name" value="${esc(houseName)}"><label for="default-currency" style="margin-top:20px">Default currency</label><select id="default-currency"><option>USD · US Dollar</option></select><p class="sub" style="margin-top:10px">Existing expenses always keep their original currency.</p><button class="btn primary" style="margin-top:18px" onclick="saveHousehold()">Save details</button></section><section class="card" style="margin-top:20px"><div class="section-head"><h2>Members</h2><button class="text" onclick="invite()">＋ Invite member</button></div><div class="member"><b class="avatar pink">K</b><div>Kaunda<small>You</small></div><span class="badge">Owner</span></div><div class="member"><b class="avatar sage">M</b><div>Mizenin<small>Member</small></div><button class="text" onclick="removeMember()">Manage</button></div><p class="sub" style="margin-top:20px">Membership is invitation-only. Former members remain named in financial history.</p></section><section class="card" style="margin-top:20px"><h2>Account</h2><p class="sub">Signed in as Kaunda · Sample account</p><a class="text" href="#auth">Preview private sign-in →</a></section></div>`;
}
function saveHousehold() {
  let n = $('#house-name').value.trim();
  if (!n) return toast('Enter a household name');
  houseName = n;
  $('.house div').innerHTML = esc(n) + '<small>2 members · USD</small>';
  toast('Household details saved for this preview');
}
function invite() {
  modal(
    'Invite someone',
    'Only invite people you want to share this household with.',
    `<form onsubmit="event.preventDefault();inviteSent()"><label for="invite-email">Email address</label><input type="email" id="invite-email" placeholder="name@example.com" required><p class="sub" style="margin-top:15px">They’ll need to sign in with this email to accept. Invitation links expire after 7 days.</p><div class="form-foot"><button class="btn primary">Preview invitation</button></div></form>`,
  );
}
function inviteSent() {
  modal(
    'Invitation ready',
    'Preview only · No email was sent.',
    `<p>An invitation for <strong>${esc($('#invite-email').value)}</strong> would be valid for 7 days.</p><p class="sub">Pending invitations can be resent or revoked by the household owner.</p><button class="btn" onclick="$('#modal').close()">Done</button>`,
  );
}
function removeMember() {
  modal(
    'Manage Mizenin',
    'Household member',
    `<p class="sub">Removing a member revokes their access but preserves their expenses, repayments, and name in history.</p><div class="error">Mizenin has an outstanding balance. Settle the balance before removing this member.</div><button class="btn" onclick="settlement()">Record repayment</button>`,
  );
}
function auth() {
  $('#main').innerHTML =
    `<div class="auth card"><div class="mark" style="margin-bottom:25px">k•</div><h1>Welcome home.</h1><p class="sub">Sign in to your private household.</p><form onsubmit="event.preventDefault();authSent()"><label for="email">Email address</label><input id="email" type="email" placeholder="you@example.com" required><button class="btn primary">Send sign-in link</button></form><p class="sub" style="margin-top:20px">New here? Accept your household invitation or create a household after signing in.</p><small>Design preview · No authentication or email delivery</small><a class="text" href="#home" style="display:block;margin-top:20px">Return to sample household →</a></div>`;
}
function authSent() {
  modal(
    'Check your inbox',
    'Sign-in link preview',
    `<p>A secure link would be sent to <strong>${esc($('#email').value)}</strong>.</p><p class="sub">The link expires after 15 minutes and can only be used once.</p><button class="btn primary" onclick="setup()">Preview first-time setup</button>`,
  );
}
function setup() {
  modal(
    'Make space for shared expenses',
    'Create your household',
    `<form onsubmit="event.preventDefault();houseName=$('#setup-name').value;$('#modal').close();location.hash='household'"><label for="setup-name">Household name</label><input id="setup-name" required value="Our household"><label for="setup-currency" style="margin-top:18px">Default currency</label><select id="setup-currency"><option>USD · US Dollar</option></select><p class="sub" style="margin-top:20px">You can invite members after creating your household.</p><button class="btn primary">Create household preview</button></form>`,
  );
}
function unavailable() {
  modal(
    'This record isn’t available',
    'It may belong to a household you no longer have access to.',
    `<p class="sub">We haven’t changed your balance. Return to your household or ask the owner to check your access.</p><button class="btn" onclick="$('#modal').close()">Back to household</button>`,
  );
}
function openStates() {
  modal(
    'Recovery states',
    'Explore the designed responses with sample data.',
    `<div class="state-options"><button class="btn" onclick="expense();$('#amount').value='0';reconcile()">Invalid or zero amount</button><button class="btn" onclick="expense();$('#amount').value='40';setSplit('exact')">Allocations don’t match</button><button class="btn" onclick="recovery('network')">Network failure / safe retry</button><button class="btn" onclick="recovery('stale')">Someone edited this expense</button><button class="btn" onclick="recovery('duplicate')">Duplicate submission</button><button class="btn" onclick="unavailable()">Inaccessible record</button><button class="btn" onclick="recovery('empty')">Empty history</button></div>`,
  );
}
function recovery(type) {
  const data = {
    network: [
      'Couldn’t confirm the save',
      'Your draft is safe. Check your connection, then retry.',
      'Retrying uses the same request ID so an expense cannot be recorded twice.',
    ],
    stale: [
      'This expense has changed',
      'Mizenin updated it while you were editing.',
      'Your draft is preserved. Compare the latest version before applying your changes.',
    ],
    duplicate: [
      'Already recorded',
      'This expense was saved successfully.',
      'We found the original submission. No duplicate was created.',
    ],
    empty: [
      'A fresh start, together.',
      'No shared activity yet.',
      'Add your first expense and your balance will appear here.',
    ],
  }[type];
  modal(
    data[0],
    data[1],
    `<p class="sub" style="margin-top:20px">${data[2]}</p><div class="form-foot"><button class="btn" onclick="openStates()">Back to states</button><button class="btn primary" onclick="${type === 'empty' ? 'expense()' : type === 'stale' || type === 'duplicate' ? 'detail(1)' : "toast('Retry preview · Existing save confirmed');detail(1)"}">${type === 'empty' ? 'Add expense' : type === 'stale' ? 'View latest revision' : type === 'duplicate' ? 'View saved expense' : 'Retry safely'}</button></div>`,
  );
}
function resetDemo() {
  seed();
  $('#modal').close();
  render();
  toast('Sample household reset');
}
window.addEventListener('hashchange', render);
$('#modal').addEventListener('cancel', (e) => {
  e.preventDefault();
  closeModal();
});
render();
