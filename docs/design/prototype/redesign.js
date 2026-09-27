/* Design preview: trips are associations on the shared ledger, never copied expenses. */
const TODAY = '2026-09-20';
const icons = {
  Dining:
    '<path d="M5 3v6m3-6v6M3 3v5c0 2 7 2 7 0V3M6.5 10v11M17 3v18m0-18c-5 4-5 9 0 9"/>',
  Groceries: '<path d="m4 8 2 12h12l2-12H4Zm4 0 4-5 4 5M9 12v4m6-4v4"/>',
  Accommodation:
    '<path d="M3 21V7l9-4 9 4v14M8 21v-5h8v5M7 8h2m6 0h2M7 12h2m6 0h2"/>',
  Transport:
    '<path d="m4 15 2-9h12l2 9M4 15h16v4H4v-4Zm2 4v2m12-2v2M7 12h10M7 16h1m8 0h1"/>',
  Activities: '<path d="m3 20 7-15 5 10 3-6 4 11H3ZM7 11l3 2 3-2"/>',
  Home: '<path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-7h6v7"/>',
  Other:
    '<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 12h8m-4-4v8"/>',
  repayment: '<path d="M4 8h15m-5-5 5 5-5 5M20 16H5m5-5-5 5 5 5"/>',
  trip: '<path d="m3 12 18-8-8 18-2-9-8-1Zm8 1 10-9"/>',
};
const icon = (n) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[n] || icons.Other}</svg>`;
const photos = {
  maui: 'https://images.unsplash.com/photo-1616398377801-d6a1a8705c98?auto=format&fit=crop&w=1000&q=80',
  tahoe:
    'https://images.unsplash.com/photo-1647285471436-9d1b1e9d6e47?auto=format&fit=crop&w=1000&q=80',
};
let trips = [],
  tripFilter = 'all',
  chartMode = 'monthly',
  chartScope = 'household',
  chartYear = 2026,
  chartMonth = 8;
const originalSeed = seed;
seed = function () {
  originalSeed();
  trips = [
    {
      id: 'maui',
      name: 'A week in Maui',
      place: 'Kīhei & the Road to Hāna',
      start: '2026-09-05',
      end: '2026-09-13',
      cover: 'maui',
    },
    {
      id: 'tahoe',
      name: 'Lake Tahoe escape',
      place: 'California',
      start: '2026-08-14',
      end: '2026-08-17',
      cover: 'tahoe',
    },
    {
      id: 'porto',
      name: 'Porto, here we come',
      place: 'Portugal',
      start: '2027-05-12',
      end: '2027-05-18',
      cover: null,
    },
  ];
  records.forEach((r) => {
    r.category =
      { 1: 'Groceries', 2: 'Dining', 3: 'Home', 5: 'Home' }[r.id] || 'Other';
  });
  const samples = [
    [
      'Kīhei beach condo',
      64000,
      'Mizenin',
      '2026-09-05',
      'Accommodation',
      'maui',
    ],
    ['Flights to Kahului', 64000, 'Kaunda', '2026-09-05', 'Transport', 'maui'],
    ['Poke bowls in Pāʻia', 8620, 'Kaunda', '2026-09-06', 'Dining', 'maui'],
    [
      'Molokini snorkel outing',
      14000,
      'Mizenin',
      '2026-09-07',
      'Activities',
      'maui',
    ],
    ['Hāna picnic supplies', 4210, 'Kaunda', '2026-09-08', 'Groceries', 'maui'],
    ['Road to Hāna gas', 5380, 'Kaunda', '2026-09-09', 'Transport', 'maui'],
    [
      'Ride to Kahului Airport',
      4210,
      'Mizenin',
      '2026-09-13',
      'Transport',
      'maui',
    ],
    ['Lakeside cabin', 42000, 'Kaunda', '2026-08-14', 'Accommodation', 'tahoe'],
    ['Car rental', 34000, 'Mizenin', '2026-08-14', 'Transport', 'tahoe'],
    ['Dinner at the lake', 8000, 'Mizenin', '2026-08-16', 'Dining', 'tahoe'],
    ['Summer groceries', 12600, 'Kaunda', '2026-07-09', 'Groceries', null],
    ['Summer groceries', 12600, 'Mizenin', '2026-07-23', 'Groceries', null],
    ['Spring household supplies', 18000, 'Kaunda', '2026-04-05', 'Home', null],
    ['Spring household supplies', 18000, 'Mizenin', '2026-04-18', 'Home', null],
    ['Winter household supplies', 15000, 'Kaunda', '2026-01-06', 'Home', null],
    ['Winter household supplies', 15000, 'Mizenin', '2026-01-16', 'Home', null],
    [
      'Shared expenses · December',
      48000,
      'Kaunda',
      '2025-12-02',
      'Other',
      null,
    ],
    [
      'Shared expenses · November',
      48000,
      'Mizenin',
      '2025-11-02',
      'Other',
      null,
    ],
    ['Shared expenses · June', 25000, 'Kaunda', '2024-06-02', 'Other', null],
    ['Shared expenses · June', 25000, 'Mizenin', '2024-06-12', 'Other', null],
  ];
  samples.forEach(([name, amount, payer, date, category, tripId], i) =>
    records.push({
      id: 100 + i,
      type: 'expense',
      name,
      amount,
      payer,
      date,
      category,
      tripId,
      alloc: [amount / 2, amount / 2],
      method: 'equal',
      note: '',
      version: 1,
    }),
  );
  events = records.map((r) => ({
    ...r,
    event: 'created',
    at: r.date,
    recordId: r.id,
    actor: r.payer || 'Kaunda',
  }));
};
seed();
const activeExpenses = () =>
  records.filter((r) => r.type === 'expense' && !r.deleted);
const tripRecords = (id) => activeExpenses().filter((r) => r.tripId === id);
const totalOf = (list, scope = 'household') =>
  list.reduce((s, r) => s + (scope === 'share' ? r.alloc[0] : r.amount), 0);
const tripStatus = (t) =>
  t.start > TODAY ? 'Upcoming' : t.end < TODAY ? 'Past' : 'In progress';
const tripName = (id) => trips.find((t) => t.id === id)?.name;
const originalRender = render;
render = function () {
  page = location.hash.slice(1) || 'home';
  let route = page.split('/')[0];
  document
    .querySelectorAll('nav a')
    .forEach((a) => a.classList.toggle('active', a.dataset.page === route));
  $('#crumb').textContent =
    {
      home: 'Overview',
      trips: 'Trips',
      history: 'History',
      household: 'Household',
      auth: 'Sign in',
    }[route] || 'Overview';
  if (route === 'home') return overview();
  if (route === 'trips')
    return page.includes('/') ? tripDetail(page.split('/')[1]) : tripsPage();
  originalRender();
};
row = function (r, isEvent = false) {
  let category = r.type === 'settlement' ? 'repayment' : r.category || 'Other',
    t = tripName(r.tripId),
    change = isEvent && r.event !== 'created' ? ` · ${r.event}` : '';
  return `<button class="activity ${r.type === 'settlement' ? 'settlement' : ''}" onclick="detail(${r.recordId || r.id})"><span class="activity-name"><span class="activity-icon cat-${category.toLowerCase()}">${icon(category)}</span><span><strong>${esc(r.name)}${change}</strong><small>${date(r.at || r.date)} · ${r.type === 'settlement' ? 'Repayment' : esc(r.payer) + ' paid'}${t ? ' · ' + esc(t) : ''}</small></span></span><span class="activity-date">${r.type === 'settlement' ? 'Recorded' : esc(category)}</span><span class="activity-amount">${money(r.amount)}<small>${r.type === 'settlement' ? 'Repayment' : 'Your share ' + money(r.alloc[0])}</small></span></button>`;
};
function overview() {
  let b = balance(),
    expenses = activeExpenses(),
    paid = members.map((m) =>
      expenses.filter((r) => r.payer === m).reduce((s, r) => s + r.amount, 0),
    );
  $('#main').innerHTML =
    `<div class="heading"><div><div class="eyebrow">OUR HOUSEHOLD</div><h1>Good things, shared.</h1><p class="sub">Everyday expenses. Memorable adventures. All in one place.</p></div><div class="actions"><button class="btn" onclick="settlement()">${icon('repayment')} Record repayment</button><button class="btn primary" onclick="expense()">＋ Add expense</button></div></div><div class="overview-top"><section class="balance" aria-label="Current balance"><div><div class="eyebrow">Household balance · All time</div><h2>${statement(b)}</h2><div class="amount">${money(Math.abs(b))}<span class="currency">USD</span></div><button class="text" onclick="explain()">How this adds up ↗</button></div><div class="balance-avatar"><span class="avatar pink">K</span><span class="avatar sage">M</span></div></section><section class="card contributions"><div class="section-head"><h2>Who paid what</h2><span class="sub">All time · USD</span></div>${members.map((m, i) => `<div class="contribution-line"><span class="avatar ${i ? 'sage' : 'pink'}">${m[0]}</span><span>${m}<small>Expenses paid</small></span><strong>${money(paid[i])}</strong></div>`).join('')}<div class="contribution-track">${paid.map((n, i) => `<span style="width:${(n / (paid[0] + paid[1] || 1)) * 100}%;background:${i ? '#95bca9' : '#dfb7a4'}"></span>`).join('')}</div></section></div><div id="spending-panel"></div><div class="overview-bottom"><section><div class="section-head"><h2>Recent activity</h2><a href="#history" class="text">View all →</a></div><div class="ledger">${events
      .slice()
      .reverse()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 4)
      .map((r) => row(r, true))
      .join(
        '',
      )}</div></section><section class="trip-peek"><div class="section-head"><h2>Away, together</h2><a href="#trips" class="text">All trips →</a></div>${tripCard(trips[0], true)}</section></div>`;
  renderSpending();
}
function chartBuckets(
  list,
  mode = chartMode,
  year = chartYear,
  month = chartMonth,
) {
  let bins = [];
  if (mode === 'daily') {
    let count = new Date(year, month + 1, 0).getDate();
    for (let d = 1; d <= count; d++) {
      let key = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      bins.push({
        label: String(d),
        long: date(key) + ', ' + year,
        records: list.filter((r) => r.date === key),
      });
    }
  } else if (mode === 'monthly') {
    for (let m = 0; m < 12; m++) {
      let key = `${year}-${String(m + 1).padStart(2, '0')}`;
      let label = new Date(year, m, 1).toLocaleDateString('en-US', {
        month: 'short',
      });
      bins.push({
        label,
        long: label + ' ' + year,
        records: list.filter((r) => r.date.startsWith(key)),
      });
    }
  } else
    for (let y = year - 4; y <= year; y++)
      bins.push({
        label: String(y),
        long: String(y),
        records: list.filter((r) => r.date.startsWith(String(y))),
      });
  return bins;
}
let shownBuckets = [];
function bars(bins, scope, handler) {
  let vals = bins.map((b) => totalOf(b.records, scope)),
    max = Math.max(...vals, 1);
  return `<div class="chart-axis"><span>${money(Math.max(...vals, 0))}</span><span>$0</span></div><div class="chart-bars ${bins.length > 20 ? 'dense' : ''}">${bins.map((b, i) => `<button class="chart-column" aria-label="${esc(b.long)}: ${money(vals[i])}. ${b.records.length} expenses. View details" onclick="${handler}(${i})"><span class="bar-space"><span class="chart-bar ${vals[i] ? '' : 'zero'} ${vals[i] === max && vals[i] > 0 ? 'peak' : ''}" style="height:${vals[i] ? Math.max(2, (vals[i] / max) * 100) : 2}%"><span class="bar-tooltip">${money(vals[i])}</span></span></span><span class="bar-label">${bins.length > 20 && i % 5 !== 0 && i !== bins.length - 1 ? '' : esc(b.label)}</span></button>`).join('')}</div>`;
}
function renderSpending() {
  let list = activeExpenses();
  shownBuckets = chartBuckets(list);
  let visible = shownBuckets.flatMap((b) => b.records),
    label =
      chartMode === 'daily'
        ? new Date(chartYear, chartMonth, 1).toLocaleDateString('en-US', {
            month: 'long',
            year: 'numeric',
          })
        : chartMode === 'monthly'
          ? String(chartYear)
          : `${chartYear - 4}–${chartYear}`;
  $('#spending-panel').innerHTML =
    `<section class="card spending-card"><div class="spending-heading"><div><h2>Spending, in perspective</h2><div class="chart-total">${money(totalOf(visible, chartScope))}<span>USD</span></div><p class="sub">${chartScope === 'share' ? 'Your allocated share' : 'Total shared spending'} · ${label}</p></div><div class="chart-controls"><div class="segmented">${['daily', 'monthly', 'yearly'].map((m) => `<button class="${chartMode === m ? 'selected' : ''}" aria-pressed="${chartMode === m}" onclick="setChartMode('${m}')">${m[0].toUpperCase() + m.slice(1)}</button>`).join('')}</div><select aria-label="Spending scope" onchange="chartScope=this.value;renderSpending()"><option value="household" ${chartScope === 'household' ? 'selected' : ''}>Household spending</option><option value="share" ${chartScope === 'share' ? 'selected' : ''}>My allocated share</option></select></div></div><div class="chart" aria-label="${chartMode} spending in USD">${bars(shownBuckets, chartScope, 'openBucket')}</div><div class="chart-foot"><span>Expenses only · Select a bar to explore</span><div class="period"><button aria-label="Previous period" onclick="shiftPeriod(-1)">‹</button><span>${label}</span><button aria-label="Next period" onclick="shiftPeriod(1)">›</button></div><button class="text" onclick="chartTable()">View data</button></div></section>`;
}
function setChartMode(m) {
  chartMode = m;
  renderSpending();
}
function shiftPeriod(d) {
  if (chartMode === 'daily') {
    let date = new Date(chartYear, chartMonth + d, 1);
    chartYear = date.getFullYear();
    chartMonth = date.getMonth();
  } else chartYear += d * (chartMode === 'yearly' ? 5 : 1);
  renderSpending();
}
function openBucket(i) {
  let b = shownBuckets[i];
  modal(
    esc(b.long),
    `${chartScope === 'share' ? 'Your allocated share' : 'Household spending'} · ${money(totalOf(b.records, chartScope))}`,
    b.records.length
      ? `<div class="ledger chart-records">${b.records
          .slice()
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((r) => row(r))
          .join('')}</div>`
      : '<div class="empty"><h3>No expenses in this period</h3><p>Try another period or add an expense.</p></div>',
  );
}
function chartTable() {
  modal(
    'Spending data',
    'Exact amounts · USD · ' +
      (chartScope === 'share' ? 'Your allocated share' : 'Household spending'),
    `<div class="table-scroll"><table><thead><tr><th>Period</th><th>Expenses</th><th>Amount</th></tr></thead><tbody>${shownBuckets.map((b) => `<tr><td>${esc(b.long)}</td><td>${b.records.length}</td><td>${money(totalOf(b.records, chartScope))}</td></tr>`).join('')}</tbody></table></div>`,
  );
}
function tripCard(t, compact = false) {
  let list = tripRecords(t.id);
  return `<a href="#trips/${t.id}" class="trip-card ${compact ? 'compact' : ''}"><div class="trip-cover ${t.cover ? '' : 'cover-plain'}">${t.cover ? `<img src="${photos[t.cover]}" alt="${t.cover === 'maui' ? 'Turquoise waves along Maui’s volcanic coastline' : 'Rocky shores of Lake Tahoe'}" loading="lazy">` : `<span>${icon('trip')}</span>`}<span class="trip-status">${tripStatus(t)}</span></div><div class="trip-card-body"><h3>${esc(t.name)}</h3><p class="sub">${date(t.start)} – ${date(t.end)}, ${t.start.slice(0, 4)}</p><div class="trip-card-bottom"><div><small>Total spent · USD</small><strong>${money(totalOf(list))}</strong></div><span class="sub">${list.length} expenses ↗</span></div></div></a>`;
}
function tripsPage() {
  let included = trips.filter(
    (t) => tripFilter === 'all' || tripStatus(t).toLowerCase() === tripFilter,
  );
  $('#main').innerHTML =
    `<div class="heading"><div><div class="eyebrow">SHARED EXPERIENCES</div><h1>Little escapes. Big memories.</h1><p class="sub">A place for every trip, and everything you spent along the way.</p></div><button class="btn primary" onclick="newTrip()">＋ New trip</button></div><div class="trips-toolbar"><div class="segmented">${['all', 'upcoming', 'past'].map((v) => `<button aria-pressed="${tripFilter === v}" class="${tripFilter === v ? 'selected' : ''}" onclick="tripFilter='${v}';tripsPage()">${v === 'all' ? 'All trips' : v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div><span class="sub">${trips.length} trips · ${money(totalOf(activeExpenses().filter((r) => r.tripId)))} spent in USD</span></div><div class="trip-grid">${included.map((t) => tripCard(t)).join('') || '<div class="empty">No trips here yet.</div>'}</div><div class="trip-explainer">${icon('trip')}<div><strong>One expense. Always counted once.</strong><p class="sub">Trip expenses also appear in your household history. Repayments stay with your household.</p></div></div><p class="photo-credit">Photos: <a href="https://unsplash.com/it/foto/onde-del-mare-che-si-infrangono-sugli-scogli-durante-il-giorno-u5hob7DWLbQ" target="_blank" rel="noreferrer">Jordan McQueen</a> and <a href="https://unsplash.com/photos/a-rocky-shore-with-clear-blue-water-and-mountains-in-the-background-nNCdDwX-lBY" target="_blank" rel="noreferrer">Peter Hulce / Unsplash</a></p>`;
}
let currentTrip = null,
  tripTab = 'overview',
  tripBuckets = [];
function tripDetail(id) {
  let t = trips.find((t) => t.id === id);
  if (!t)
    return ($('#main').innerHTML =
      '<div class="empty"><h1>Trip not found</h1><a class="btn" href="#trips">Back to trips</a></div>');
  if (currentTrip !== id) tripTab = 'overview';
  currentTrip = id;
  let list = tripRecords(id),
    total = totalOf(list),
    paid = members.map((m) => totalOf(list.filter((r) => r.payer === m)));
  $('#main').innerHTML =
    `<a href="#trips" class="text back-link">← All trips</a><section class="trip-hero ${t.cover ? '' : 'cover-plain'}">${t.cover ? `<img src="${photos[t.cover]}" alt="${esc(t.place)}">` : ''}<div class="trip-hero-content"><span class="trip-status">${tripStatus(t)}</span><h1>${esc(t.name)}</h1><p>${esc(t.place)} · ${date(t.start)} – ${date(t.end)}, ${t.start.slice(0, 4)}</p></div></section><div class="trip-detail-toolbar"><div class="trip-tabs">${['overview', 'expenses'].map((v) => `<button class="${tripTab === v ? 'selected' : ''}" onclick="tripTab='${v}';tripDetail('${t.id}')">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div><button class="btn primary" onclick="expense(null,'${t.id}')">＋ Add expense</button></div>${
      tripTab === 'overview'
        ? `<div class="trip-metrics"><section class="card"><div class="eyebrow">Total trip spending</div><div class="chart-total">${money(total)}<span>USD</span></div><p class="sub">${list.length} expenses · No repayments included</p></section><section class="card"><div class="eyebrow">Your allocated share</div><div class="chart-total">${money(totalOf(list, 'share'))}<span>USD</span></div><p class="sub">Kaunda’s share of trip expenses</p></section><section class="card"><div class="eyebrow">Who paid what</div>${members.map((m, i) => `<div class="paid-mini"><span class="avatar ${i ? 'sage' : 'pink'}">${m[0]}</span><span>${m}</span><strong>${money(paid[i])}</strong></div>`).join('')}</section></div><div class="trip-analytics"><section class="card"><div class="section-head"><h2>Spending by day</h2><span class="sub">USD</span></div><div class="chart" id="trip-chart"></div><p class="sub">Select a day to see its expenses.</p></section><section class="card"><h2>Where it went</h2>${categoryBars(list)}</section></div><div class="trip-settlement-note">${icon('repayment')}<p>These expenses are included in your household balance.</p><button class="text" onclick="settlement()">Record a household repayment ↗</button></div>`
        : `<div class="filterbar"><input id="trip-search" aria-label="Search trip expenses" placeholder="Search this trip’s expenses…" oninput="tripExpenseList()"><select id="trip-category" aria-label="Filter trip category" onchange="tripExpenseList()"><option value="all">All categories</option>${Object.keys(
            icons,
          )
            .filter((k) => !['repayment', 'trip'].includes(k))
            .map((k) => `<option>${k}</option>`)
            .join('')}</select></div><div id="trip-expenses"></div>`
    }`;
  if (tripTab === 'overview') {
    let keys = [...new Set(list.map((r) => r.date))].sort();
    if (keys.length) {
      let from = keys[0],
        to = keys[keys.length - 1];
      tripBuckets = [];
      for (
        let d = new Date(from + 'T12:00:00');
        d <= new Date(to + 'T12:00:00');
        d.setDate(d.getDate() + 1)
      ) {
        let key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        tripBuckets.push({
          label: date(key),
          long: date(key),
          records: list.filter((r) => r.date === key),
        });
      }
      $('#trip-chart').innerHTML = bars(
        tripBuckets,
        'household',
        'openTripDay',
      );
      $('#trip-chart').style.setProperty('--bucket-count', tripBuckets.length);
    } else
      $('#trip-chart').innerHTML =
        '<div class="empty">Your spending chart starts with your first expense.</div>';
  } else tripExpenseList();
}
function categoryBars(list) {
  let total = totalOf(list);
  if (!total)
    return '<p class="sub">Your category breakdown will appear here.</p>';
  return Object.keys(icons)
    .filter((k) => !['repayment', 'trip'].includes(k))
    .map((k) => ({
      name: k,
      value: totalOf(list.filter((r) => (r.category || 'Other') === k)),
    }))
    .filter((c) => c.value)
    .sort((a, b) => b.value - a.value)
    .map(
      (c) =>
        `<div class="category-summary"><div><span class="category-dot cat-${c.name.toLowerCase()}">${icon(c.name)}</span><span>${c.name}</span><strong>${money(c.value)}</strong></div><div class="bar"><span style="width:${(c.value / total) * 100}%;background:#81a996"></span></div></div>`,
    )
    .join('');
}
function openTripDay(i) {
  let b = tripBuckets[i];
  modal(
    esc(b.long),
    `${tripName(currentTrip)} · ${money(totalOf(b.records))}`,
    b.records.length
      ? `<div class="ledger chart-records">${b.records.map((r) => row(r)).join('')}</div>`
      : '<div class="empty">No expenses recorded on this day.</div>',
  );
}
function tripExpenseList() {
  let q = $('#trip-search').value.toLowerCase(),
    c = $('#trip-category').value,
    list = tripRecords(currentTrip).filter(
      (r) =>
        r.name.toLowerCase().includes(q) && (c === 'all' || r.category === c),
    ),
    days = [...new Set(list.map((r) => r.date))].sort().reverse();
  $('#trip-expenses').innerHTML =
    days
      .map(
        (d) =>
          `<div class="day-heading"><strong>${date(d)}, ${d.slice(0, 4)}</strong><span>${money(totalOf(list.filter((r) => r.date === d)))}</span></div><div class="ledger">${list
            .filter((r) => r.date === d)
            .map((r) => row(r))
            .join('')}</div>`,
      )
      .join('') ||
    '<div class="empty"><h3>No expenses found</h3><p>Add an expense or try a different search.</p></div>';
}
function newTrip() {
  modal(
    'A new adventure',
    'Keep its spending together, from the first expense.',
    `<form id="new-trip-form"><div class="fields"><div class="full"><label for="trip-name">Trip name</label><input id="trip-name" placeholder="e.g. A weekend in Portland" required maxlength="80"></div><div class="full"><label for="trip-place">Destination <span class="sub">(optional)</span></label><input id="trip-place" placeholder="Where are you headed?" maxlength="100"></div><div><label for="trip-start">Start date</label><input id="trip-start" type="date" value="${TODAY}" required></div><div><label for="trip-end">End date</label><input id="trip-end" type="date" value="${TODAY}" required></div></div><p class="sub" style="margin-top:18px">Shared with your household. Choose who participates in each expense.</p><div id="form-error" role="alert"></div><div class="form-foot"><button type="button" class="btn" onclick="closeModal()">Cancel</button><button class="btn primary">Create trip</button></div></form>`,
  );
  $('#new-trip-form').onsubmit = (e) => {
    e.preventDefault();
    let name = $('#trip-name').value.trim(),
      start = $('#trip-start').value,
      end = $('#trip-end').value;
    if (!name || end < start)
      return formError(
        'Enter a trip name and an end date on or after the start date.',
      );
    let t = {
      id: 'trip-' + Date.now(),
      name,
      place: $('#trip-place').value.trim(),
      start,
      end,
      cover: null,
    };
    trips.push(t);
    $('#modal').close();
    location.hash = 'trips/' + t.id;
    toast('Trip created · Ready for your first expense');
  };
}
const originalExpense = expense;
expense = function (id, tripId) {
  originalExpense(id);
  let r = id ? records.find((r) => r.id === id) : null,
    chosen = r?.tripId || tripId || null,
    fields = $('#expense-form .fields'),
    amount = $('#amount').parentElement,
    currency = $('#currency').parentElement;
  amount.classList.add('amount-field');
  currency.classList.add('currency-field');
  fields.prepend(currency);
  fields.prepend(amount);
  let description = $('#description').parentElement;
  description.classList.add('description-field');
  fields.insertAdjacentHTML(
    'beforeend',
    `<div><label for="expense-category">Category</label><select id="expense-category">${Object.keys(
      icons,
    )
      .filter((k) => !['repayment', 'trip'].includes(k))
      .map(
        (k) =>
          `<option ${k === (r?.category || 'Other') ? 'selected' : ''}>${k}</option>`,
      )
      .join(
        '',
      )}</select></div><div><label for="expense-trip">Trip <span class="sub">(optional)</span></label><select id="expense-trip"><option value="">Everyday expense</option>${trips.map((t) => `<option value="${t.id}" ${chosen === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}</select></div>`,
  );
  if (tripId && !r) {
    let t = trips.find((t) => t.id === tripId);
    $('#date').value =
      TODAY < t.start ? t.start : TODAY > t.end ? t.end : TODAY;
  }
  $('#amount').focus();
};
const originalDetail = detail;
detail = function (id) {
  originalDetail(id);
  let r = records.find((r) => r.id === id);
  if (!r || r.type !== 'expense') return;
  let grid = $('#modal .detail-grid');
  grid.insertAdjacentHTML(
    'beforeend',
    `<div><small>Category</small>${esc(r.category || 'Other')}</div><div><small>Trip</small>${r.tripId ? `<a class="text" href="#trips/${r.tripId}" onclick="$('#modal').close()">${esc(tripName(r.tripId) || 'Unavailable trip')} ↗</a>` : 'Everyday expense'}</div>`,
  );
};
resetDemo = function () {
  seed();
  chartMode = 'monthly';
  chartScope = 'household';
  chartYear = 2026;
  chartMonth = 8;
  tripFilter = 'all';
  currentTrip = null;
  $('#modal').close();
  if (location.hash !== '#home') location.hash = 'home';
  else render();
  toast('Sample household reset');
};
/* The existing listener captured the original function. Delegate all navigation here. */
document.querySelector('nav a[data-page=trips]').innerHTML =
  icon('trip') + '<span>Trips</span>';
window.removeEventListener('hashchange', originalRender);
window.addEventListener('hashchange', render);
render();
