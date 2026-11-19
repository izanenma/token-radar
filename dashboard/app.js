// Token Radar's console. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board as plain HTML strings: a filterable, sortable table, a per-protocol drawer with
// the model's own inputs, the comparables behind its multiple, and the protocol's farm plan. No
// network: every byte it shows is in data.js. Events are wired once per render, by delegation.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', watchlist: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(n) {
    if (n === null || n === undefined) return 'unknown';
    if (n >= 365) return (n / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(n)) + 'd';
  }
  function chainsText(p, n) {
    var list = p.chains && p.chains.length ? p.chains : ['an unnamed chain'];
    return esc(list.slice(0, n || 2).join(', '));
  }
  // The model in one function: the page recomputes a row from the snapshot figures and checks the
  // number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
  function impliedOf(row, model) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var ageDays = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturity = model.maturity_floor + (Math.min(Math.max(ageDays, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * growthMult * maturity));
  }

  // The farm plan is the same derivation main.ts writes to board.json: category, chains, TVL and age
  // decide the action, the capital, the hold and every cost and time. No name is special-cased.
  function firstChain(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdFor(ageDays) {
    if (ageDays === null || ageDays === undefined) return 30;
    if (ageDays < 180) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }
  var ACTION_RULES = [
    { words: ['lend', 'cdp', 'collateral'], fn: function (name, capital, chain) { return 'Lend $' + capital + ' of USDC on ' + name + ' (' + chain + ') and leave the deposit earning for the full hold.'; } },
    { words: ['dex', 'yield', 'leveraged farm'], fn: function (name, capital, chain) { return 'Add $' + capital + " to " + name + "'s deepest " + chain + ' pool as liquidity and leave it in place.'; } },
    { words: ['bridge'], fn: function (name, capital, chain) { return 'Send $' + capital + ' of USDC across ' + name + ' to ' + chain + ', then put the bridged funds to work in the destination app.'; } },
    { words: ['staking', 'restak'], fn: function (name, capital, chain) { return "Stake $" + capital + " of the native asset through " + name + ' and keep the liquid receipt token.'; } },
    { words: ['perpetual', 'derivative'], fn: function (name, capital, chain) { return 'Fund a $' + capital + ' USDC margin account on ' + name + ' and open a single small hedged position.'; } },
    { words: ['prediction'], fn: function (name, capital, chain) { return 'Back one outcome with $' + capital + ' on ' + name + ' and leave the position until the market resolves.'; } },
    { words: ['curator', 'allocator'], fn: function (name, capital, chain) { return 'Place $' + capital + ' into a ' + name + ' vault on ' + chain + ' and hold the vault shares.'; } },
    { words: ['stable'], fn: function (name, capital, chain) { return 'Mint or lock $' + capital + ' of stable value through ' + name + ' on ' + chain + '.'; } },
    { words: ['rwa'], fn: function (name, capital, chain) { return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it.'; } },
    { words: ['insurance'], fn: function (name, capital, chain) { return 'Underwrite $' + capital + ' of cover through ' + name + ' on ' + chain + ' and keep the policy active.'; } }
  ];
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTION_RULES.length; i++) {
      var rule = ACTION_RULES[i];
      for (var j = 0; j < rule.words.length; j++) {
        if (c.indexOf(rule.words[j]) >= 0) return rule.fn(p.name, capital, chain);
      }
    }
    return 'Open a $' + capital + ' position in ' + p.name + ' on ' + chain + ' and leave it working.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = firstChain(p);
    var capital = capitalFor(p);
    var hold = holdFor(p.age_days);
    return [
      { text: "Read " + p.name + "'s own docs and check whether it runs a points or rewards program, so you farm what it actually counts.", cost: 'free', time: '20 minutes' },
      { text: 'Move $' + capital + ' of USDC to ' + chain + ' on the cheapest route and keep the receipt for the farm log.', cost: 'about $' + (capital >= 150 ? 6 : 3) + ' of gas or bridge fees', time: '10 to 20 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      { text: 'Do one on-chain action a week inside the protocol, such as a deposit, a swap, a borrow or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days so the activity shows up in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "When you leave, confirm any claim only on the protocol's own site or docs, and never pay a fee to claim.", cost: 'free to check, and never pay to claim', time: '10 minutes' }
    ].map(stepText);
  }

  function multipleFor(row) {
    var found = null;
    (DATA.multiples || []).forEach(function (m) { if (m.category === (row.category || 'Other')) found = m; });
    return found;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watchlist') === '1') state.watchlist = true;
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlist) params.set('watchlist', '1');
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function visibleRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.watchlist && !r.on_watchlist) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function options(list, current, allLabel) {
    var out = '<option value="all"' + (current === 'all' ? ' selected' : '') + '>' + esc(allLabel) + '</option>';
    list.forEach(function (v) {
      out += '<option value="' + esc(v) + '"' + (v === current ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    return out;
  }
  function sortTh(key, label) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' v' : ' ^') : '';
    return '<th scope="col"><button type="button" data-sort="' + key + '">' + esc(label) + esc(arrow) + '</button></th>';
  }

  function headerHtml() {
    return '<header class="top">' +
      '<div class="brand"><span class="mark"></span><span>Token Radar</span></div>' +
      '<div class="top-meta"><span>Snapshot ' + esc(DATA.as_of) + '</span><span>DefiLlama protocol index</span><span>' + esc(DATA.model_version) + ' model</span></div>' +
      '</header>';
  }
  function ledeHtml() {
    return '<section class="lede"><div>' +
      '<h1>' + DATA.watchlist_size + ' watchlist protocols, ranked by implied value</h1>' +
      '<p>The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is a model, not a promise — and the multiple behind it is read off the live-token protocols in each category, not chosen by hand.</p>' +
      '</div><div class="facts">' +
      '<div class="fact"><span>Watchlist covered</span><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b></div>' +
      '<div class="fact"><span>Pre-token rows scored</span><b>' + DATA.board_size + '</b></div>' +
      '<div class="fact"><span>Global multiple</span><b>' + DATA.global_multiple + 'x</b></div>' +
      '<div class="fact"><span>Live-token protocols set aside</span><b>' + DATA.live_size + '</b></div>' +
      '</div></section>';
  }
  function controlsHtml() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    return '<div class="controls">' +
      '<div class="field"><label for="q">Search</label><input type="search" id="q" placeholder="Search name or chain" value="' + esc(state.q) + '" aria-label="Search the board"></div>' +
      '<div class="field"><label for="category">Category</label><select id="category" aria-label="Filter by category">' + options(categories, state.category, 'All categories') + '</select></div>' +
      '<div class="field"><label for="chain">Chain</label><select id="chain" aria-label="Filter by chain">' + options(chains, state.chain, 'All chains') + '</select></div>' +
      '<label class="check"><input type="checkbox" id="watchlist"' + (state.watchlist ? ' checked' : '') + '>Watchlist only</label>' +
      '<div class="field"><span class="sub">Token status</span><div class="tabs">' +
      '<button type="button" data-tab="pre-token" aria-pressed="' + (state.tab === 'pre-token') + '">Pre-token</button>' +
      '<button type="button" data-tab="live" aria-pressed="' + (state.tab === 'live') + '">Live token</button>' +
      '</div></div>' +
      '<span class="count">' + (state.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols') + '</span>' +
      '</div>';
  }
  function boardHtml() {
    var list = sortRows(visibleRows());
    if (list.length === 0) {
      return '<div class="panel"><div class="empty"><h2>No protocol matches that filter</h2>' +
        '<p>Clear the search or pick another category to see the board again.</p>' +
        '<button class="button" type="button" data-clear="1">Clear filters</button></div></div>';
    }
    var max = list[0].implied_value_usd || 1;
    var rows = list.map(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var width = Math.max(3, Math.round((r.implied_value_usd / max) * 100));
      return '<tr data-slug="' + esc(r.slug) + '" data-selected="' + (state.selected === r.slug) + '" tabindex="0">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><div class="name"><b>' + esc(r.name) + (r.on_watchlist ? ' <span class="watch">WATCHLIST</span>' : '') + '</b>' +
        '<span class="sub">' + esc(r.category || 'Other') + ' on ' + chainsText(r, 2) + '</span></div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + growthClass + '">' + growth + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td><div class="implied"><div class="bar" aria-hidden="true"><i style="width:' + width + '%"></i></div>' +
        '<span class="num">' + money(r.implied_value_usd) + '</span></div></td>' +
        '<td><span class="status pre">no token</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>' +
      '<caption class="sub">Pre-token protocols, strongest implied value first. Select a row for its model, its comparables and its farm plan.</caption>' +
      '<thead><tr>' + sortTh('implied', 'Rank') + sortTh('name', 'Protocol') + sortTh('tvl', 'TVL') + sortTh('growth', '7d') + sortTh('age', 'Age') + sortTh('implied', 'Implied value') + '<th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }
  function liveHtml() {
    var rows = DATA.live.map(function (r) {
      return '<tr>' +
        '<td class="num">live</td>' +
        '<td><div class="name"><b>' + esc(r.name) + '</b><span class="sub">' + esc(r.category || 'Other') + ' on ' + chainsText(r, 2) + '</span></div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg') + '">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + money(r.mcap_usd) + '</td>' +
        '<td><span class="status live">already trades</span></td></tr>';
    }).join('');
    return '<div class="panel"><div class="table-wrap"><table>' +
      '<caption class="sub">Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking — and their market-cap-to-TVL ratios are what price the board.</caption>' +
      '<thead><tr><th scope="col">Status</th><th scope="col">Protocol</th><th scope="col">TVL</th><th scope="col">7d</th><th scope="col">Market cap</th><th scope="col">Token</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div></div>';
  }
  function modelHtml() {
    var m = DATA.model;
    var multRows = (DATA.multiples || []).slice(0, 12).map(function (x) {
      return '<tr><td>' + esc(x.category) + '</td><td class="num">' + x.multiple.toFixed(3) + 'x</td><td class="num">' + x.count + '</td><td>' + (x.source === 'category' ? 'median of its live protocols' : 'global fallback') + '</td></tr>';
    }).join('');
    return '<section class="panel model"><h2>How implied value is computed</h2>' +
      '<p>Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The multiple is the market speaking: the median market-cap-to-TVL ratio of the live-token protocols in the same category (at least 3, each with $1M+ TVL), clamped to ' + m.multiple_floor + '–' + m.multiple_cap + 'x; a thin category falls back to the global median of ' + DATA.global_multiple + 'x.</p>' +
      '<div class="formula">implied = round( tvl_usd x category_multiple x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') )</div>' +
      '<p>TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. The early radar is every pre-token protocol below the watchlist floor, by TVL, and the live-token protocols are set aside with their market caps shown.</p>' +
      '<table class="mult-table"><thead><tr><th scope="col">Category</th><th scope="col" class="num">Multiple</th><th scope="col" class="num">Live comps</th><th scope="col">Source</th></tr></thead><tbody>' + multRows + '</tbody></table>' +
      '<p class="note">Showing the 12 highest multiples of ' + (DATA.multiples || []).length + ' categories. Every category the board uses is listed in the data.</p></section>';
  }
  function drawerHtml() {
    if (!state.selected) return '';
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === state.selected) row = r; });
    if (!row) return '';
    var steps = farmSteps(row);
    var mult = multipleFor(row);
    var recomputed = impliedOf(row, DATA.model);
    var eq = [
      ['TVL', money(row.tvl_usd)],
      ['Category multiple (' + (row.category || 'Other') + ')', row.category_multiple.toFixed(3) + 'x'],
      ['Seven-day growth', pct(row.change_7d)],
      ['Growth multiplier', String(row.growth_multiplier)],
      ['Age with no token', age(row.age_days)],
      ['Maturity multiplier', String(row.maturity_multiplier)]
    ].map(function (pair) {
      return '<div class="eq-row"><span>' + esc(pair[0]) + '</span><b>' + esc(pair[1]) + '</b></div>';
    }).join('');
    var compTitle = '';
    var compRows = '';
    if (mult && mult.top && mult.top.length) {
      compTitle = mult.source === 'category'
        ? 'Comparables: ' + (row.category || 'Other') + ' (median of ' + mult.count + ' live protocols)'
        : 'Comparables: ' + (row.category || 'Other') + ' has only ' + mult.count + ' live protocol' + (mult.count === 1 ? '' : 's') + ', too few to price it, so the global median prices this row';
      compRows = '<section><h3>' + esc(compTitle) + '</h3><div class="comps">' + mult.top.map(function (c) {
        return '<div class="comp-row"><span>' + esc(c.name) + '</span><b>' + money(c.mcap_usd) + ' mcap / ' + money(c.tvl_usd) + ' TVL = ' + c.ratio.toFixed(3) + 'x</b></div>';
      }).join('') + '</div></section>';
    }
    var stepLis = steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return '<li><b>' + esc(action) + '</b><span class="cost">' + esc(tail) + '</span></li>';
    }).join('');
    return '<aside class="drawer" id="detail" aria-labelledby="detail-title">' +
      '<div class="drawer-head"><div><span class="rankline">Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' · Watchlist' : '') + '</span>' +
      '<h2 id="detail-title">' + esc(row.name) + '</h2>' +
      '<p class="sub">' + esc(row.category || 'Other') + ' on ' + esc((row.chains || []).join(', ') || 'an unnamed chain') + '</p></div>' +
      '<button class="close" type="button" aria-label="Close details" data-close="1">Close</button></div>' +
      '<section><h3>Implied value</h3><div class="equation">' + eq +
      '<div class="eq-row total"><span>Implied value</span><b>' + money(row.implied_value_usd) + '</b></div></div>' +
      '<p class="note">Model ' + esc(DATA.model_version) + ': the page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.</p></section>' +
      compRows +
      '<section><h3>Farm plan</h3><ol class="steps">' + stepLis + '</ol></section></aside>';
  }

  function render() {
    var focusQ = document.activeElement && document.activeElement.id === 'q';
    var caret = focusQ ? document.getElementById('q').selectionStart : null;
    app.innerHTML = '<div class="shell">' + headerHtml() + ledeHtml() + controlsHtml() +
      (state.tab === 'pre-token' ? boardHtml() : liveHtml()) +
      (state.tab === 'pre-token' ? modelHtml() : '') + '</div>' + drawerHtml();
    app.setAttribute('aria-busy', 'false');
    if (focusQ) {
      var q = document.getElementById('q');
      q.focus();
      try { q.setSelectionRange(caret, caret); } catch (e) { /* older browsers */ }
    }
  }

  function bind() {
    app.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'q') { state.q = e.target.value; writeHash(); render(); }
    });
    app.addEventListener('change', function (e) {
      if (!e.target) return;
      if (e.target.id === 'category') { state.category = e.target.value; writeHash(); render(); }
      else if (e.target.id === 'chain') { state.chain = e.target.value; writeHash(); render(); }
      else if (e.target.id === 'watchlist') { state.watchlist = e.target.checked; writeHash(); render(); }
    });
    app.addEventListener('click', function (e) {
      var t = e.target;
      var sortBtn = t.closest ? t.closest('[data-sort]') : null;
      if (sortBtn) {
        var key = sortBtn.getAttribute('data-sort');
        if (state.sort === key) state.dir = -state.dir;
        else { state.sort = key; state.dir = -1; }
        render();
        return;
      }
      var tabBtn = t.closest ? t.closest('[data-tab]') : null;
      if (tabBtn) { state.tab = tabBtn.getAttribute('data-tab'); render(); return; }
      if (t.closest && t.closest('[data-clear]')) { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlist = false; writeHash(); render(); return; }
      if (t.closest && t.closest('[data-close]')) { closeDetail(); return; }
      var tr = t.closest ? t.closest('tr[data-slug]') : null;
      if (tr) openDetail(tr.getAttribute('data-slug'));
    });
    app.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && e.target && e.target.matches && e.target.matches('tr[data-slug]')) {
        e.preventDefault();
        openDetail(e.target.getAttribute('data-slug'));
      }
    });
    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && state.selected) closeDetail();
    });
  }

  function openDetail(slug) {
    var found = DATA.rows.some(function (r) { return r.slug === slug; });
    if (!found) return;
    state.selected = slug;
    writeHash();
    render();
  }
  function closeDetail() {
    state.selected = null;
    writeHash();
    render();
  }

  readHash();
  bind();
  render();
})();
