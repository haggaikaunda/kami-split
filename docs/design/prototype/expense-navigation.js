/* Route-backed expense detail, preserving the originating working surface. */
const mainRender = render;
const expenseOrigins = new Map();
let sourceView = null,
  activeExpenseId = null;
const panel = document.createElement('dialog');
panel.id = 'expense-panel';
panel.setAttribute('aria-labelledby', 'expense-title');
document.body.append(panel);
function captureOrigin() {
  const values = {};
  document.querySelectorAll('#main input,#main select').forEach((e) => {
    if (e.id) values[e.id] = e.value;
  });
  return {
    route: location.hash || '#home',
    scroll: window.scrollY,
    values,
    tripTab,
    focus: document.activeElement,
    focusAction: document.activeElement?.getAttribute('onclick'),
    nodes: [...$('#main').childNodes],
    chart: $('#modal').open ? $('#modal').innerHTML : null,
  };
}
function restoreOrigin(origin) {
  if (!origin) return;
  sourceView = origin;
  mainRender();
  for (const [id, value] of Object.entries(origin.values)) {
    const el = document.getElementById(id);
    if (el) el.value = value;
  }
  if ($('#history-list')) filterHistory();
  if ($('#trip-expenses')) tripExpenseList();
  requestAnimationFrame(() => {
    window.scrollTo(0, origin.scroll);
    if (origin.chart) {
      $('#modal').innerHTML = origin.chart;
      $('#modal').classList.remove('financial-form');
      $('#modal').showModal();
    } else {
      const target = [...document.querySelectorAll('#main button')].find(
        (e) => e.getAttribute('onclick') === origin.focusAction,
      );
      target?.focus({ preventScroll: true });
    }
  });
}
function expenseMarkup(r) {
  let creator =
    events.find((e) => e.recordId === r.id && e.event === 'created')?.actor ||
    'Kaunda';
  return `<div class="expense-identity"><span class="activity-icon cat-${(r.category || 'Other').toLowerCase()}">${icon(r.category || 'Other')}</span><span class="eyebrow">${r.deleted ? 'Deleted expense' : 'Shared expense'} · USD</span><h1 id="expense-title" tabindex="-1">${esc(r.name)}</h1><p class="sub">${new Date(r.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</p><div class="amount">${money(r.amount)}</div></div>${r.deleted ? '<div class="error">Deleted · Retained in history and excluded from all balances and spending totals.</div>' : ''}<div class="expense-columns"><div><section class="card expense-section"><h2>Expense details</h2><dl class="expense-facts"><div><dt>Paid by</dt><dd>${esc(r.payer)}</dd></div><div><dt>Category</dt><dd>${esc(r.category || 'Other')}</dd></div><div><dt>Trip</dt><dd>${r.tripId ? `<a href="#trips/${r.tripId}">${esc(tripName(r.tripId) || 'Unavailable trip')} ↗</a>` : 'Everyday expense'}</dd></div><div><dt>Created by</dt><dd>${esc(creator)}</dd></div><div><dt>Revision</dt><dd>${r.version}</dd></div></dl></section><section class="card expense-section"><h2>How it’s shared</h2><p class="sub">${r.method === 'exact' ? 'Exact amounts' : 'Equal split'}</p>${members.map((m, i) => `<div class="allocation"><span class="avatar ${i ? 'sage' : 'pink'}">${m[0]}</span><span>${m}</span><strong class="allocation-value">${money(r.alloc[i])}</strong></div>`).join('')}<div class="reconcile">✓ ${money(r.alloc.reduce((s, a) => s + a, 0))} allocated · Everything adds up</div></section><section class="card expense-section"><h2>Note</h2><p class="expense-note">${esc(r.note) || 'No note added.'}</p></section></div><section class="card expense-section revision-section"><h2>Activity & revisions</h2><p class="sub">A record of every financial change.</p>${events
    .filter((e) => e.recordId === r.id)
    .reverse()
    .map(
      (e) =>
        `<div class="history-entry"><strong>${{ created: 'Created', edited: 'Edited', deleted: 'Deleted' }[e.event]} by ${esc(e.actor)}</strong><small>${e.at} · Revision ${e.version}</small><p>${esc(e.name)} · ${money(e.amount)}</p><small>${esc(e.payer)} paid${e.alloc ? ' · ' + members.map((m, i) => esc(m) + ' ' + money(e.alloc[i])).join(' / ') : ''}</small><small>${esc(e.category || 'Other')} · ${esc(tripName(e.tripId) || 'Everyday expense')}</small><small>Expense date: ${esc(e.date)} · ${e.method === 'exact' ? 'Exact amounts' : 'Equal split'}</small>${e.note ? `<p>Note: ${esc(e.note)}</p>` : ''}${e.reason ? `<p>Reason: ${esc(e.reason)}</p>` : ''}</div>`,
    )
    .join(
      '',
    )}</section></div>${r.deleted ? '' : `<div class="expense-actions"><button class="btn delete-link" onclick="confirmDelete(${r.id})">Delete expense</button><button class="btn primary" onclick="expense(${r.id})">Edit expense</button></div>`}`;
}
const legacyDetail = detail;
detail = function (id) {
  let r = records.find((r) => r.id === id);
  if (r?.type === 'settlement') return legacyDetail(id);
  if (activeExpenseId === id && location.hash.startsWith('#expenses/')) {
    $('#modal').close();
    return render();
  }
  sourceView = captureOrigin();
  expenseOrigins.set(String(id), sourceView);
  $('#modal').close();
  location.hash = 'expenses/' + id;
};
function returnFromExpense() {
  if (expenseOrigins.has(String(activeExpenseId))) window.history.back();
  else location.hash = 'history';
}
function openFullExpense() {
  window.history.replaceState(
    null,
    '',
    '#expenses/' + activeExpenseId + '?view=full',
  );
  render();
}
function showExpenseRoute() {
  let match = location.hash.match(/^#expenses\/([^?]+)/),
    id = Number(match?.[1]);
  activeExpenseId = id;
  let r = records.find((r) => r.id === id && r.type === 'expense'),
    origin = expenseOrigins.get(String(id)),
    full =
      location.hash.includes('view=full') ||
      matchMedia('(max-width:760px)').matches ||
      !origin;
  $('#crumb').textContent = 'Expense detail';
  if (!r) {
    panel.close();
    $('#main').innerHTML =
      `<div class="empty"><h1>Expense unavailable</h1><p>This record may not exist or you may no longer have access.</p><a class="btn" href="#history">Back to history</a></div>`;
    return;
  }
  if (full) {
    panel.close();
    panel.innerHTML = '';
    $('#main').innerHTML =
      `<div class="expense-page"><div class="expense-page-toolbar"><button class="text" onclick="returnFromExpense()">← ${origin ? 'Back to ' + (origin.route.startsWith('#trips') ? 'trip' : origin.route === '#history' ? 'history' : 'overview') : 'Back to history'}</button><span class="sub">Private household record</span></div>${expenseMarkup(r)}</div>`;
    window.scrollTo(0, 0);
    $('#expense-title').focus({ preventScroll: true });
  } else {
    if ($('#main .expense-page') && origin?.nodes)
      $('#main').replaceChildren(...origin.nodes);
    if (!sourceView || !$('#main').children.length) {
      $('#main').innerHTML = '<div class="empty">Household expenses</div>';
    }
    panel.innerHTML = `<div class="expense-panel-toolbar"><button class="text" onclick="openFullExpense()">Open full page ↗</button><button class="close" aria-label="Close expense details" onclick="returnFromExpense()">×</button></div>${expenseMarkup(r)}`;
    if (!panel.open) panel.showModal();
    panel.querySelector('#expense-title').focus({ preventScroll: true });
  }
}
render = function () {
  if (location.hash.startsWith('#expenses/')) return showExpenseRoute();
  let previous = activeExpenseId,
    origin = expenseOrigins.get(String(previous));
  activeExpenseId = null;
  panel.close();
  if (origin && location.hash === origin.route) {
    tripTab = origin.tripTab;
    restoreOrigin(origin);
  } else mainRender();
};
window.removeEventListener('hashchange', mainRender);
window.addEventListener('hashchange', () => {
  if ($('#modal').open) $('#modal').close();
  render();
});
panel.addEventListener('cancel', (e) => {
  e.preventDefault();
  returnFromExpense();
});
const standardModal = modal;
modal = function (title, subtitle, body) {
  standardModal(title, subtitle, body);
  $('#modal').classList.toggle(
    'financial-form',
    !!$('#expense-form') || !!$('#settlement-form'),
  );
};
const standardClose = closeModal;
closeModal = function () {
  if (busy) return;
  const form = $('#settlement-form');
  if (
    form?.dataset.dirty === 'true' &&
    !confirm('Discard your unsaved repayment changes?')
  )
    return;
  standardClose();
};
const standardSettlement = settlement;
settlement = function () {
  standardSettlement();
  $('#settlement-form').addEventListener('input', () => {
    $('#settlement-form').dataset.dirty = 'true';
  });
};
matchMedia('(max-width:760px)').addEventListener('change', () => {
  if (activeExpenseId !== null && !$('#modal').open) showExpenseRoute();
});
render();
