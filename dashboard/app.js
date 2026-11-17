/* Deep-Print Radar's page: renders window.RADAR (the same board.json the gate scores) with no
   network and no framework. Views: #/board (the ranked board, filterable and sortable),
   #/detail/<slug> (one protocol's full print), #/filtered?band=&category=&chain=&tier= (a filtered
   board), #/method (the model and its evidence) and #/live (protocols that already trade). */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D) { document.getElementById('rows').innerHTML = '<tr><td colspan="11">No dataset loaded.</td></tr>'; return; }

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var money = function (n) {
    if (n == null) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString('en-US');
  };
  var moneyFull = function (n) { return n == null ? '—' : '$' + Math.round(n).toLocaleString('en-US'); };
  var pct = function (n) { return n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; };
  var ageText = function (d) { return d == null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; };
  var bandLabel = function (b) {
    return { mega: 'Mega', large: 'Large', mid: 'Mid', small: 'Small', micro: 'Micro' }[b] || b;
  };

  // ---- header stats -------------------------------------------------------
  $('asof').textContent = D.as_of;
  $('modelver').textContent = D.model_version;
  $('sha').textContent = D.board_sha256 ? D.board_sha256.slice(0, 16) + '…' : '—';
  var top = D.rows[0];
  $('stats').innerHTML =
    '<div><dt>Protocols ranked</dt><dd>' + D.board_size + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + D.watchlist_size + ' / ' + D.watchlist_size + '</dd></div>' +
    '<div><dt>Total implied value</dt><dd>' + money(D.board_implied_total_usd) + '</dd></div>' +
    '<div><dt>Size curve</dt><dd>10^' + D.fit.intercept + ' × TVL^' + D.fit.slope + '</dd></div>' +
    '<div><dt>Fit R²</dt><dd>' + D.fit.r_squared + '</dd></div>' +
    '<div><dt>Top protocol</dt><dd>' + esc(top ? top.name : '—') + '</dd></div>';

  // ---- filter options -----------------------------------------------------
  var cats = [];
  var chains = [];
  D.rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML = '<option value="">All categories</option>' + cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML = '<option value="">All chains</option>' + chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  // ---- board --------------------------------------------------------------
  function filteredRows() {
    var q = $('q').value.trim().toLowerCase();
    var band = $('band').value, cat = $('cat').value, chain = $('chain').value, tier = $('tier').value;
    var rows = D.rows.filter(function (r) {
      if (band && r.band !== band) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) < 0) return false;
      if (tier && r.tier !== tier) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var sort = $('sort').value;
    var by = {
      value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; }
    }[sort] || function (a, b) { return a.rank - b.rank; };
    return rows.slice().sort(by);
  }

  function rowHtml(r) {
    var g = r.change_7d == null ? '' : (r.change_7d >= 0 ? 'pos' : 'neg');
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span><span class="tier' + (r.tier === 'radar' ? ' radar' : '') + '">' + (r.tier === 'watchlist' ? 'watchlist' : 'below floor') + '</span>' +
      '<small>' + esc(r.slug) + '</small></td>' +
      '<td>' + esc(r.category || '—') + '</td>' +
      '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + g + '">' + pct(r.change_7d) + '</td>' +
      '<td class="num">' + ageText(r.age_days) + '</td>' +
      '<td class="num">' + r.model.curve_multiple.toFixed(2) + '×</td>' +
      '<td class="num"><strong>' + moneyFull(r.implied_value_usd) + '</strong></td>' +
      '<td><span class="band band-' + r.band + '">' + bandLabel(r.band) + '</span></td>' +
      '<td class="planline">$' + r.plan.capital_usd + ' in · $' + r.plan.total_cost_usd + ' all-in · ' + r.plan.hold_days + 'd hold</td>' +
      '</tr>';
  }

  function renderBoard() {
    var rows = filteredRows();
    $('rows').innerHTML = rows.map(rowHtml).join('');
    $('empty').hidden = rows.length > 0;
    $('count').textContent = rows.length + ' of ' + D.board_size + ' protocols shown';
  }

  // ---- detail view ----------------------------------------------------------
  function detailHtml(r) {
    var m = r.model;
    var comps = r.comps.peers.map(function (p) {
      return '<tr><td>' + esc(p.name) + '</td><td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + p.multiple.toFixed(2) + '×</td></tr>';
    }).join('');
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var risks = r.risks.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var formula = 'implied = curve × momentum × seasoning × breadth\n' +
      'curve   = 10^(' + D.fit.intercept + ' + ' + D.fit.slope + ' × log10(' + moneyFull(r.tvl_usd) + ')) × ' + m.category_offset.toFixed(2) + ' (' + esc(r.category || 'no category') + ' offset, ' + m.peer_count + (m.peer_count === 1 ? ' peer' : ' peers') + ')\n' +
      '        = ' + moneyFull(m.curve_value_usd) + '  →  comps cross-check ' + moneyFull(r.comps.comps_value_usd) + ' at ' + (r.comps.median_multiple == null ? '—' : r.comps.median_multiple.toFixed(2) + '×') + ' median\n' +
      'momentum   ×' + m.momentum_factor.toFixed(3) + '  (7d ' + pct(r.change_7d) + (r.change_7d_usd == null ? '' : ', ' + moneyFull(r.change_7d_usd)) + ')\n' +
      'seasoning  ×' + m.seasoning_factor.toFixed(3) + '  (' + ageText(r.age_days) + ' on record)\n' +
      'breadth    ×' + m.breadth_factor.toFixed(3) + '  (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')';
    return '<a class="back" href="#/board">← Back to the board</a>' +
      '<h2>' + esc(r.name) + ' <span class="band band-' + r.band + '">' + bandLabel(r.band) + '</span></h2>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + D.board_size + ' · ' + esc(r.slug) + ' · ' + esc(r.category || 'no category') +
      ' · ' + esc(r.chains.join(', ')) + ' · ' + (r.tier === 'watchlist' ? 'on the watchlist' : 'below the $50M floor') +
      ' · tracked since ' + esc(r.listed_at || 'unknown') + '</p>' +
      '<div class="dgrid"><div><h3>Implied value</h3>' +
      '<p class="bigval">' + moneyFull(r.implied_value_usd) + '</p>' +
      '<p class="bandline">Honest band ' + moneyFull(r.band_low_usd) + ' – ' + moneyFull(r.band_high_usd) +
      ' (half of all launched peers landed inside this spread around the curve).</p>' +
      '<h3>How the number is built</h3><pre class="formula">' + esc(formula) + '</pre></div>' +
      '<div><h3>Size &amp; momentum</h3><dl class="kv">' +
      '<dt>TVL</dt><dd>' + moneyFull(r.tvl_usd) + '</dd>' +
      '<dt>7-day change</dt><dd>' + pct(r.change_7d) + (r.change_7d_usd == null ? '' : ' (' + moneyFull(r.change_7d_usd) + ')') + '</dd>' +
      '<dt>Age</dt><dd>' + ageText(r.age_days) + '</dd>' +
      '<dt>Curve multiple</dt><dd>' + m.curve_multiple.toFixed(2) + '×</dd>' +
      '<dt>Category offset</dt><dd>×' + m.category_offset.toFixed(2) + ' (' + m.peer_count + (m.peer_count === 1 ? ' peer' : ' peers') + ')</dd>' +
      '<dt>Peer median multiple</dt><dd>' + (m.peer_median_multiple == null ? '—' : m.peer_median_multiple.toFixed(2) + '×') + '</dd>' +
      '</dl><h3 style="margin-top:14px">Farm plan totals</h3><dl class="kv">' +
      '<dt>Capital in</dt><dd>$' + r.plan.capital_usd + '</dd>' +
      '<dt>Setup cost</dt><dd>$' + r.plan.setup_cost_usd + '</dd>' +
      '<dt>Weekly cost</dt><dd>$' + r.plan.weekly_cost_usd + '</dd>' +
      '<dt>Hold</dt><dd>' + r.plan.hold_days + ' days</dd>' +
      '<dt>All-in cost</dt><dd>$' + r.plan.total_cost_usd + '</dd></dl></div></div>' +
      '<h3 style="margin-top:16px">' + (r.comps.in_category
        ? 'Nearest launched peers in ' + esc(r.category || 'the same category')
        : 'Nearest launched peers — too few in ' + esc(r.category || 'this category') + ', so nearest across all categories') + '</h3>' +
      '<table class="evidence"><thead><tr><th>Peer (already trading)</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Mcap / TVL</th></tr></thead><tbody>' + comps + '</tbody></table>' +
      '<p class="fineprint">Comps cross-check: median multiple ' + (r.comps.median_multiple == null ? '—' : r.comps.median_multiple.toFixed(2) + '×') +
      ' × TVL = ' + moneyFull(r.comps.comps_value_usd) + ', against the curve value ' + moneyFull(m.curve_value_usd) + '.</p>' +
      '<h3>Farm plan — eight steps, costed and timed</h3><ol class="steps">' + steps + '</ol>' +
      '<h3>Risks this protocol’s own record implies</h3><ul class="risks">' + risks + '</ul>';
  }

  function showDetail(slug) {
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) { r = D.rows[i]; break; }
    var el = $('detail');
    if (!r) { el.hidden = true; return; }
    el.innerHTML = detailHtml(r);
    el.hidden = false;
    el.scrollIntoView();
  }

  // ---- method & live --------------------------------------------------------
  $('method-body').innerHTML =
    '<p><strong>Model ' + esc(D.model_version) + '.</strong> The size curve is fitted at run time from ' + D.fit.peers +
    ' launched peers: log10(market cap) = ' + D.fit.intercept + ' + ' + D.fit.slope + ' × log10(TVL), R² ' + D.fit.r_squared +
    '. Each category shifts the curve by its shrunk median residual (shrinkage constant ' + D.model.offset_shrink +
    '), so thin categories barely move it. Momentum multiplies by 1 + ' + D.model.momentum_rate + ' × clamped 7-day change; ' +
    'seasoning rises from ' + D.model.season_base + ' toward ' + (D.model.season_base + D.model.season_range) +
    ' with a ' + D.model.season_tau_days + '-day time constant; breadth adds up to ' + Math.round(D.model.breadth_cap * 100) +
    '% for multi-chain reach. Unknown ages score at ' + D.model.unknown_age_days + ' days, stated, never hidden.</p>' +
    '<p>Coverage: ' + D.protocols_size + ' protocols in the snapshot, ' + D.pre_token_size + ' record no token, ' +
    D.excluded_size + ' of those are wrapped, staked, bridged or versioned products of a token that already trades, ' +
    'leaving ' + D.board_size + ' on the board — the watchlist’s ' + D.watchlist_size + ' plus ' + D.radar_size +
    ' more below the floor. Bands: ' + D.bands.map(function (b) { return b.label.split(' — ')[0] + ' ' + b.rows; }).join(', ') + '.</p>' +
    '<p>Each row’s band is the fit’s own residual spread: half the launched peers landed between ×' + D.fit.band_factor_low +
    ' and ×' + D.fit.band_factor_high + ' of the curve, so a row’s band_low / band_high carry those same factors. ' +
    'The global median market-cap-per-TVL multiple across launched peers is ' + D.fit.global_median_multiple + '×.</p>';
  $('peers').innerHTML = D.peers.map(function (p) {
    return '<tr><td>' + esc(p.category) + '</td><td class="num">' + p.peers + '</td>' +
      '<td class="num">' + p.median_multiple.toFixed(2) + '×</td><td class="num">×' + p.offset_multiple.toFixed(2) + '</td></tr>';
  }).join('');
  $('provenance').textContent = 'Source: ' + D.source + ' · floor $' + D.floor_usd.toLocaleString('en-US') +
    ' · snapshot date ' + D.as_of + ' · board sha256 ' + (D.board_sha256 || '—');
  $('live-rows').innerHTML = D.live.map(function (p) {
    var vs = p.vs_curve_pct == null ? '—' : (p.vs_curve_pct > 0 ? '+' : '') + p.vs_curve_pct + '%';
    return '<tr><td><span class="pname">' + esc(p.name) + '</span><small> ' + esc(p.symbol || '') + '</small></td>' +
      '<td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + (p.multiple == null ? '—' : p.multiple.toFixed(2) + '×') + '</td>' +
      '<td class="num">' + money(p.fitted_value_usd) + '</td><td class="num">' + vs + '</td></tr>';
  }).join('');

  // ---- routing --------------------------------------------------------------
  function setView(name) {
    document.querySelectorAll('.views a').forEach(function (a) {
      if (a.getAttribute('data-view') === name) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('method').hidden = name !== 'method';
    $('live').hidden = name !== 'live';
    var boardVisible = name === 'board' || name === 'filtered';
    document.querySelector('.controls').style.display = boardVisible ? '' : 'none';
    document.querySelector('.boardwrap').style.display = boardVisible ? '' : 'none';
  }

  function route() {
    var hash = location.hash || '#/board';
    var parts = hash.replace(/^#\/?/, '').split('?');
    var path = parts[0] || 'board';
    var query = {};
    (parts[1] || '').split('&').forEach(function (kv) {
      var pair = kv.split('=');
      if (pair[0]) query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
    });
    if (path.indexOf('detail/') === 0) {
      setView('board');
      renderBoard();
      showDetail(path.slice(7));
      return;
    }
    $('detail').hidden = true;
    if (path === 'filtered') {
      if (query.band) $('band').value = query.band;
      if (query.category) $('cat').value = query.category;
      if (query.chain) $('chain').value = query.chain;
      if (query.tier) $('tier').value = query.tier;
      if (query.q) $('q').value = query.q;
      setView('filtered');
      window.scrollTo(0, 0);
      renderBoard();
      return;
    }
    if (path === 'method') { setView('method'); window.scrollTo(0, 0); return; }
    if (path === 'live') { setView('live'); window.scrollTo(0, 0); return; }
    setView('board');
    window.scrollTo(0, 0);
    renderBoard();
  }

  ['q', 'band', 'cat', 'chain', 'tier', 'sort'].forEach(function (id) {
    $(id).addEventListener('input', renderBoard);
    $(id).addEventListener('change', renderBoard);
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) location.hash = '#/detail/' + tr.getAttribute('data-slug');
  });
  window.addEventListener('hashchange', route);
  route();
})();
