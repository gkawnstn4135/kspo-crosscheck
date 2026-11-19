/* 공공데이터 교차검증기 — 화면 */
(function () {
  'use strict';
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var fmt = function (n) { return Number(n).toLocaleString('ko-KR'); };
  var SEV = { high: '높음', medium: '중간', low: '낮음' };
  var SEV_ICO = { high: '▲', medium: '◆', low: '●' };
  var SEV_NOTE = { high: '그대로 쓰면 결론이 틀릴 수 있음', medium: '일부 분석에 영향', low: '쓸 때 참고' };

  var SUPP = {
    '2025_올림픽공원_통합공연달력.csv': {
      file: 'data/calendar_2025.csv', title: '2025 올림픽공원 통합 공연 달력',
      text: 'KOPIS 공연 110건과 KSPO 기록을 합친 121건입니다. KSPO 데이터에 없는 33건에는 이유(공연만 빠짐 27건, 기록 공백 6건)를 적었습니다.',
      cols: '공연명, 공연장, 시작일, 종료일, KOPIS, KSPO연계데이터, KOPIS_ID, 출처, 비고'
    },
    '2025_올림픽공원역_일별_퇴장인파지표.csv': {
      file: 'data/daily_index_2025.csv', title: '2025 올림픽공원역 일별 퇴장 인파 지표',
      text: '5·9호선 올림픽공원역 21~23시 승차로 본 365일의 실제 방문 규모입니다. 평소 대비 배수, 그날 KSPO 기록 시간 수, 판정, 주의를 담았습니다.',
      cols: '날짜, 요일, 주말공휴일, 5호선·9호선·합계 21~23시 승차, 평소대비_배수, KSPO연계데이터_기록시간수, KSPO연계데이터_공연기록, KOPIS_공연기간, 판정, 주의'
    }
  };

  var S = { trust: null, rules: null, ref: null, current: null, upload: null, downloads: null };

  /* ---------- 내려받기: GitHub Pages에서는 보통 링크, claude.ai 미리보기에서는 downloads 기능 ---------- */
  if (window.claude && typeof window.claude.use === 'function') {
    try { window.claude.use('downloads').then(function (d) { S.downloads = d; }, function () {}); } catch (e) {}
  }
  function saveText(filename, text, mime) {
    if (S.downloads) {
      return S.downloads.save({ filename: filename, data: text }).then(function () { return '저장했습니다.'; }, function (e) {
        return e && e.code === 'declined' ? '저장을 취소했습니다.' : '이 화면에서는 저장할 수 없습니다. 내용을 복사해 쓰세요.';
      });
    }
    try {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain;charset=utf-8' }));
      a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      return Promise.resolve('내려받기를 시작했습니다.');
    } catch (e) { return Promise.resolve('이 화면에서는 저장할 수 없습니다.'); }
  }
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('a[data-save]');
    if (!a || !S.downloads) return;
    ev.preventDefault();
    fetch(a.getAttribute('href')).then(function (r) { return r.text(); }).then(function (t) {
      var bom = /\.csv$/.test(a.dataset.save) ? '﻿' : '';
      return saveText(a.dataset.save, bom + t.replace(/^﻿/, ''));
    }).then(function (msg) { flash(a, msg); });
  });
  function flash(el, msg) {
    var s = el.parentNode.querySelector('.status');
    if (!s) { s = document.createElement('span'); s.className = 'status'; el.parentNode.appendChild(s); }
    s.textContent = msg;
  }

  /* ---------- 불러오기 ---------- */
  Promise.all([
    fetch('data/trust.json').then(function (r) { return r.json(); }),
    fetch('data/rules.json').then(function (r) { return r.json(); }),
    fetch('data/calendar_2025.csv').then(function (r) { return r.text(); }),
    fetch('data/daily_index_2025.csv').then(function (r) { return r.text(); }),
    fetch('data/recommend.json').then(function (r) { return r.json(); }).catch(function () { return { rules: [] }; })
  ]).then(function (v) {
    S.trust = v[0]; S.rules = v[1]; S.recommend = v[4];
    S.ref = { calendar: Checks.parseRef(v[2]), daily: Checks.parseRef(v[3]) };
    $('#checked-at').textContent = S.trust.checked_at;
    renderPicker(); renderRules(); initReport();
    route();
    window.addEventListener('hashchange', route);
  }).catch(function (e) {
    $('#card').innerHTML = '<div class="card empty">데이터 파일을 불러오지 못했습니다. 웹 서버(GitHub Pages 등)에서 열었는지 확인하세요. (' + esc(e.message) + ')</div>';
  });

  function route() {
    var id = (location.hash || '').slice(1);
    var ds = S.trust.datasets;
    if (id !== 'upload' && !ds.some(function (d) { return d.id === id; })) id = ds[0].id;
    S.current = id;
    document.querySelectorAll('.tile').forEach(function (t) { t.setAttribute('aria-pressed', t.dataset.id === id ? 'true' : 'false'); });
    if (id === 'upload') renderUpload(); else renderCard(ds.find(function (d) { return d.id === id; }));
    renderSupp(); renderComp(); syncReport();
  }
  function go(id) { if (location.hash.slice(1) === id) route(); else location.hash = id; }

  function counts(issues) {
    var c = { high: 0, medium: 0, low: 0 }; issues.forEach(function (i) { c[i.severity]++; }); return c;
  }
  function pills(c) {
    return ['high', 'medium', 'low'].filter(function (k) { return c[k]; }).map(function (k) {
      return '<span class="pill ' + k + '"><span class="ico" aria-hidden="true">' + SEV_ICO[k] + '</span>' + SEV[k] + ' ' + c[k] + '</span>';
    }).join('');
  }

  /* ---------- 1. 데이터 고르기 ---------- */
  function renderPicker() {
    var html = S.trust.datasets.map(function (d) {
      return '<button type="button" class="tile" data-id="' + esc(d.id) + '" aria-pressed="false">' +
        '<span class="t-name">' + esc(d.name) + '</span>' +
        '<span class="t-meta">' + esc(d.provider) + ' · ' + (d.rows_checked != null ? '<span class="num">' + fmt(d.rows_checked) + '</span>건 검사' : 'API 상태만 자동 확인') + '</span>' +
        '<span class="pills">' + pills(counts(d.issues)) + '</span></button>';
    }).join('');
    html += '<button type="button" class="tile upload" data-id="upload" aria-pressed="false"><span class="t-name">내 파일 검사하기</span>' +
      '<span class="t-meta">CSV·API 결과(XML·JSON)를 올리거나 API 주소를 넣으면 같은 규칙으로 검사합니다</span></button>';
    $('#picker').innerHTML = html;
    $('#picker').addEventListener('click', function (e) { var t = e.target.closest('.tile'); if (t) go(t.dataset.id); });
  }

  /* ---------- 2. 신뢰도 카드 ---------- */
  function verdict(c) {
    if (c.high) return '그대로 쓰면 결론이 틀릴 수 있는 문제가 ' + c.high + '건 있습니다.';
    if (c.medium) return '일부 분석에 영향을 주는 문제가 ' + c.medium + '건 있습니다.';
    if (c.low) return '쓸 때 참고할 점이 ' + c.low + '건 있습니다.';
    return '규칙에 걸린 문제가 없습니다.';
  }
  function issueHTML(f, i) {
    var items = f.items && f.items.length ? '<details><summary>목록 보기 (' + f.items.length + '건)</summary><ul>' +
      f.items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></details>' : '';
    return '<li class="issue ' + f.severity + '"><span class="stripe" aria-hidden="true"></span><div class="body">' +
      '<div class="row1"><span class="pill ' + f.severity + '"><span class="ico" aria-hidden="true">' + SEV_ICO[f.severity] + '</span>' + SEV[f.severity] + '</span>' +
      '<span class="code" title="검사 규칙">' + esc(f.rule) + '</span>' + (f.auto ? '<span class="auto" title="매주 자동 재검사가 붙인 항목">자동</span>' : '') + '<span class="title">' + esc(f.title) + '</span></div>' +
      '<p class="detail">' + esc(f.detail) + '</p>' + (f.advice ? '<p class="advice">' + esc(f.advice) + '</p>' : '') + items +
      '<div class="tools"><button class="linkbtn" type="button" data-report="' + i + '">이 문제 제보하기</button></div></div></li>';
  }
  function renderCard(d) {
    var c = counts(d.issues);
    S.shown = d.issues;
    var src = (d.source || []).join(', ');
    var html = '<article class="card"><div class="card-head"><h3>' + esc(d.name) + '</h3>' +
      '<div class="facts"><span><b>제공</b>' + esc(d.provider) + '</span>' + (src ? '<span><b>출처</b>' + esc(src) + '</span>' : '') +
      (d.period ? '<span><b>기간</b><span class="num">' + esc(d.period) + '</span></span>' : '') +
      (d.rows_checked != null ? '<span><b>검사</b><span class="num">' + fmt(d.rows_checked) + '</span>건 · ' + esc(S.trust.checked_at) + '</span>' : '<span><b>검사</b>아직 내용 검사 전, API 상태만 자동 확인</span>') +
      (d.url ? '<span><a href="' + esc(d.url) + '">공공데이터포털 원본</a></span>' : '') + monitorHTML(d.monitor) + '</div>' +
      '<p class="verdict">' + (d.rows_checked == null && !d.issues.length ? '아직 내용을 검사하지 않은 데이터입니다. API 상태만 매주 확인합니다.' : verdict(c)) + '</p><div class="pills">' + pills(c) + '</div></div>' +
      '<ul class="issues">' + d.issues.map(issueHTML).join('') + '</ul>' +
      (d.id === 'kspo-linked-2025' ? evidenceHTML() : '') + '</article>';
    $('#card').innerHTML = html;
    bindIssueReport();
    if (d.id === 'kspo-linked-2025') drawChart();
  }
  function monitorHTML(m) {
    if (!m) return '';
    if (!m.checked_at) return m.last_try ? '<span><b>자동 확인</b><span class="num">' + esc(m.last_try) + '</span> · 확인 실패</span>' : '';
    var s = m.state === 'empty' ? 'API 0건' : 'API 정상 ' + fmt(m.total) + '건';
    if (m.last_try && m.last_try > m.checked_at) s += ' · ' + m.last_try + ' 확인 실패';
    return '<span><b>자동 확인</b><span class="num">' + esc(m.checked_at) + '</span> · ' + esc(s) + '</span>';
  }
  function bindIssueReport() {
    $('#card').querySelectorAll('[data-report]').forEach(function (b) {
      b.addEventListener('click', function () {
        var f = S.shown[+b.dataset.report];
        $('#r-what').value = f.title + ' — ' + f.detail;
        $('#r-how').value = '공공데이터 교차검증기 규칙 ' + f.rule + ' 결과입니다.';
        syncReport(); document.getElementById('sec-report').scrollIntoView(); $('#r-what').focus({ preventScroll: true });
      });
    });
  }

  /* 근거 그래프: 올림픽공원역 일별 21~23시 승차 */
  function evidenceHTML() {
    return '<div class="evidence"><h4>KSPO 기록에 없는 공연일도 지하철 승차에는 남아 있습니다</h4>' +
      '<p class="sub">2025년 올림픽공원역(5·9호선) 하루 21~23시 승차. 공연이 끝나는 시간대라 공연 관객 규모를 보여 줍니다.</p>' +
      '<div class="legend"><span><i style="background:var(--bar-blue)"></i>KSPO에 공연 기록 있음</span>' +
      '<span><i style="background:var(--bar-red)"></i>평소의 3배 이상인데 KSPO 기록 없음 (기록이 온전한 날)</span>' +
      '<span><i style="background:var(--bar)"></i>그 밖의 날</span><span><i style="background:var(--band);outline:1px solid var(--line)"></i>KSPO 기록 공백 기간</span></div>' +
      '<div class="chart" id="chart" role="img" aria-label="2025년 올림픽공원역 일별 21~23시 승차 막대그래프. KSPO 기록이 온전한데 공연 기록이 없는 급증일 5일과 11월 9일 이후 기록 공백 기간을 표시"></div>' +
      '<details class="tablev"><summary>표로 보기: 주의가 붙은 17일</summary><div class="scroll"><table id="flagtable"></table></div></details></div>';
  }
  function drawChart() {
    var host = $('#chart'); if (!host) return;
    var rows = S.ref.daily;
    var W = Math.max(320, host.clientWidth), H = W < 520 ? 200 : 230, m = { l: 46, r: 8, t: 10, b: 26 };
    var pw = W - m.l - m.r, ph = H - m.t - m.b, n = rows.length, bw = pw / n;
    var max = 0; rows.forEach(function (r) { max = Math.max(max, +r.합계_21_23시_승차); });
    var step = max > 10000 ? 4000 : max > 4000 ? 2000 : 1000, top = Math.ceil(max / step) * step;
    var y = function (v) { return m.t + ph - v / top * ph; };
    var cls = function (r) {
      if (r.주의 === 'KSPO 데이터에 공연 기록 없음') return 'var(--bar-red)';
      if (r.KSPO연계데이터_공연기록 === 'True') return 'var(--bar-blue)';
      return 'var(--bar)';
    };
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">';
    // 기록 공백 띠: 11월 이후 기록 시간 12개 미만인 날의 처음~끝
    var gi = rows.map(function (r, i) { return r.날짜 >= '2025-11-01' && +r.KSPO연계데이터_기록시간수 < 12 ? i : -1; }).filter(function (i) { return i >= 0; });
    if (gi.length) {
      var gx0 = m.l + gi[0] * bw, gx1 = m.l + (gi[gi.length - 1] + 1) * bw;
      s += '<rect x="' + gx0 + '" y="' + m.t + '" width="' + (gx1 - gx0) + '" height="' + ph + '" fill="var(--band)"/>' +
        '<text x="' + (gx1 - 4) + '" y="' + (m.t + 13) + '" text-anchor="end">KSPO 기록 공백</text>';
    }
    for (var t = 0; t <= top; t += step) {
      s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(t) + '" y2="' + y(t) + '" stroke="var(--line)" stroke-width="1"/>' +
        '<text x="' + (m.l - 6) + '" y="' + (y(t) + 4) + '" text-anchor="end">' + fmt(t) + '</text>';
    }
    rows.forEach(function (r, i) {
      var v = +r.합계_21_23시_승차, x = m.l + i * bw, h = Math.max(0.5, ph - (y(v) - m.t));
      s += '<rect x="' + (x + bw * 0.1).toFixed(2) + '" y="' + y(v).toFixed(2) + '" width="' + Math.max(0.8, bw * 0.8).toFixed(2) + '" height="' + h.toFixed(2) + '" rx="' + Math.min(1, bw / 3).toFixed(2) + '" fill="' + cls(r) + '"/>';
    });
    // 월 눈금
    rows.forEach(function (r, i) {
      if (r.날짜.slice(8) === '01') {
        var x = m.l + i * bw;
        s += '<line x1="' + x + '" x2="' + x + '" y1="' + (m.t + ph) + '" y2="' + (m.t + ph + 4) + '" stroke="var(--ink-3)"/>' +
          (W < 520 && +r.날짜.slice(5, 7) % 2 === 0 ? '' : '<text x="' + (x + 2) + '" y="' + (H - 8) + '">' + (+r.날짜.slice(5, 7)) + '월</text>');
      }
    });
    s += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + (m.t + ph) + '" y2="' + (m.t + ph) + '" stroke="var(--ink-3)"/>';
    s += '<rect id="hit" x="' + m.l + '" y="' + m.t + '" width="' + pw + '" height="' + ph + '" fill="transparent"/>';
    s += '<line id="cross" x1="0" x2="0" y1="' + m.t + '" y2="' + (m.t + ph) + '" stroke="var(--ink-2)" stroke-width="1" visibility="hidden"/></svg>';
    host.innerHTML = s;
    var svg = host.querySelector('svg'), tip = $('#tip'), cross = host.querySelector('#cross');
    function show(ev) {
      var b = svg.getBoundingClientRect(), sx = (ev.clientX - b.left) * (W / b.width);
      var i = Math.floor((sx - m.l) / bw); if (i < 0 || i >= n) return hide();
      var r = rows[i], cx = m.l + (i + 0.5) * bw;
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      tip.innerHTML = '<b>' + r.날짜 + ' (' + r.요일 + ')</b><br>21~23시 승차 <b class="num">' + fmt(r.합계_21_23시_승차) + '</b>명 · 평소의 ' + r.평소대비_배수 + '배' +
        '<br>KSPO 공연 기록: ' + (r.KSPO연계데이터_공연기록 === 'True' ? '있음' : '없음') + ' · 기록 시간 ' + r.KSPO연계데이터_기록시간수 + '개' +
        '<br>KOPIS 공연 기간: ' + (r.KOPIS_공연기간 === 'True' ? '예' : '아니오') + (r.주의 ? '<br><b>주의</b> ' + esc(r.주의) : '');
      tip.hidden = false;
      var px = ev.pageX + 14, py = ev.pageY + 14, tw = tip.offsetWidth;
      if (px + tw > window.scrollX + document.documentElement.clientWidth - 8) px = ev.pageX - tw - 14;
      tip.style.left = px + 'px'; tip.style.top = py + 'px';
    }
    function hide() { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); }
    svg.addEventListener('pointermove', show); svg.addEventListener('pointerleave', hide); svg.addEventListener('pointerdown', show);
    var flagged = rows.filter(function (r) { return r.주의; });
    $('#flagtable').innerHTML = '<thead><tr><th>날짜</th><th class="r">21~23시 승차</th><th class="r">평소 대비</th><th>KOPIS 공연 기간</th><th>주의</th></tr></thead><tbody>' +
      flagged.map(function (r) {
        return '<tr><td class="num">' + r.날짜 + ' (' + r.요일 + ')</td><td class="r num">' + fmt(r.합계_21_23시_승차) + '</td><td class="r num">' + r.평소대비_배수 + '배</td><td>' +
          (r.KOPIS_공연기간 === 'True' ? '예' : '아니오') + '</td><td>' + esc(r.주의) + '</td></tr>';
      }).join('') + '</tbody>';
  }
  var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { if (S.current === 'kspo-linked-2025') drawChart(); }, 150); });

  /* ---------- 내 파일 검사 ---------- */
  function renderUpload() {
    $('#card').innerHTML = '<div class="drop" id="drop"><p><b>파일을 여기에 끌어다 놓거나 고르세요.</b> 공공데이터포털·문화공공데이터광장에서 받은 CSV, 또는 API 결과를 저장한 XML·JSON을 그대로 올리면 됩니다. UTF-8과 EUC-KR 모두 읽고, ‘이름:값’으로 묶인 칸은 풀어서 검사합니다. 30만 행이 넘는 파일은 앞부분만 검사합니다.</p>' +
      '<div class="btnrow"><input id="file" class="sr" type="file" accept=".csv,.txt,.xml,.json,text/csv,application/xml,application/json"><label class="btn primary" for="file">파일 고르기</label>' +
      '<button class="btn" type="button" id="sample">예시 파일로 해보기</button></div>' +
      '<div class="apiform"><label for="apiurl">API 주소로 바로 불러오기</label><div class="apirow"><input id="apiurl" class="field" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://api.kcisa.kr/openapi/…?serviceKey=인증키&amp;numOfRows=1000&amp;pageNo=1">' +
      '<button class="btn" type="button" id="apigo">불러와서 검사</button></div>' +
      '<p class="hint">인증키가 든 주소는 이 브라우저에서 기관 서버로만 가고, 이 사이트는 저장하지 않습니다. 쪽(pageNo)을 넘기며 최대 100쪽·10만 건까지 받습니다. numOfRows=1000처럼 크게 넣으면 더 빨리 받습니다. 기관 서버가 브라우저 호출을 막으면, 주소를 새 탭에서 열고 결과 화면을 저장(Ctrl+S)해 파일로 올려 주세요.</p></div>' +
      '<p class="status" id="ustatus" aria-live="polite">예시 파일은 KSPO 올림픽공원 2025 연계 데이터 7,803건(API 수집본)입니다.</p></div><div id="uresult"></div>';
    var drop = $('#drop');
    $('#file').addEventListener('change', function (e) { if (e.target.files[0]) readFile(e.target.files[0]); });
    ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer.files[0]; if (f) readFile(f); });
    $('#apigo').addEventListener('click', function () { fetchApi($('#apiurl').value.trim()); });
    $('#apiurl').addEventListener('keydown', function (e) { if (e.key === 'Enter') fetchApi($('#apiurl').value.trim()); });
    $('#sample').addEventListener('click', function () {
      status('예시 파일을 불러오는 중…');
      fetch('data/sample_linked_2025.csv').then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { analyze(b, '올림픽공원_2025_연계데이터_API수집본_7803건.csv'); })
        .catch(function () { status('예시 파일을 불러오지 못했습니다.', true); });
    });
    if (S.upload) showResult(S.upload);
  }
  /* API 주소로 불러오기: 쪽을 넘기며 받은 뒤 한 표로 합쳐 검사 */
  function fetchApi(url) {
    var u;
    try { u = new URL(url); } catch (e) { status('주소 형식이 맞지 않습니다. https://로 시작하는 전체 주소를 붙여 넣으세요.', true); return; }
    if (location.protocol === 'https:' && u.protocol === 'http:') {
      status('http로 시작하는 API(KOPIS 등)는 보안 때문에 이 사이트에서 부를 수 없습니다. 주소를 새 탭에서 열고 결과를 저장해 파일로 올려 주세요.', true); return;
    }
    S.upload = null; $('#uresult').innerHTML = '';
    var pageKey = ['pageNo', 'cpage', 'page'].find(function (k) { return u.searchParams.has(k); }) || 'pageNo';
    var first = +(u.searchParams.get(pageKey) || 1), all = [], meta = null, kind = null, MAX = 100, ROWS = 100000, t0 = Date.now();
    var name = (u.hostname + u.pathname).replace(/\/+$/, '') + ' API 응답';
    function page(i) {
      u.searchParams.set(pageKey, first + i);
      status('API 불러오는 중… ' + (i + 1) + '쪽' + (all.length ? ', ' + fmt(all.length) + (meta && meta.totalCount ? ' / ' + fmt(+meta.totalCount) : '') + '건' : ''));
      return fetch(u.toString()).then(function (r) {
          if (r.status === 401 || r.status === 403) throw new Error('서버가 ' + r.status + ' 오류를 돌려줬습니다. 서버는 이 사이트의 호출을 받았지만 인증키가 맞지 않습니다. 이 API를 신청할 때 받은 키인지 확인하세요.');
          if (!r.ok) throw new Error('서버가 ' + r.status + ' 오류를 돌려줬습니다.');
          return r.arrayBuffer();
        })
        .then(function (b) {
          var a = Checks.parseApi(Checks.decode(b).text);
          if (!a) throw new Error('응답이 XML·JSON이 아닙니다. 주소를 확인하세요.');
          var err = Checks.apiError(a.meta);
          if (err && !a.objs.length) throw new Error('API가 오류를 돌려줬습니다: ' + err + '. 인증키와 주소를 확인하세요.');
          if (!meta) { meta = a.meta; kind = a.kind; }
          all = all.concat(a.objs);
          var total = +meta.totalCount || 0;
          if (a.objs.length && total && all.length < total && i + 1 < MAX && all.length < ROWS) return page(i + 1);
        });
    }
    page(0).then(function () {
      if (!all.length) throw new Error(meta && meta.totalCount === '0' ? '받은 목록이 없습니다. 서버는 이 사이트의 호출을 받아 정상 응답했지만 데이터가 0건입니다(totalCount 0). 기관 쪽에서 데이터를 비웠거나 교체 중일 수 있습니다.' : '받은 목록이 없습니다.');
      done(Checks.runRows(Checks.toRows(all), name, S.rules, S.ref, { kind: kind, meta: meta, encoding: 'UTF-8', t0: t0 }), name);
    }).catch(function (e) {
      var blocked = e instanceof TypeError;
      status(blocked ? '브라우저에서 이 API를 바로 부를 수 없습니다(기관 서버가 막았거나 네트워크 문제). 주소를 새 탭에서 열고, 결과 화면을 저장(Ctrl+S)한 뒤 그 파일을 올려 주세요.' : e.message, true);
    });
  }
  function status(t, err) { var s = $('#ustatus'); if (s) { s.textContent = t; s.className = 'status' + (err ? ' err' : ''); } }
  function readFile(f) {
    if (!/\.(csv|txt|xml|json)$/i.test(f.name)) { status('CSV, XML, JSON 파일만 검사할 수 있습니다. 엑셀 파일이면 CSV로 저장해서 올려 주세요.', true); return; }
    if (f.size > 200 * 1024 * 1024) { status('200MB가 넘는 파일은 브라우저에서 검사하기 어렵습니다. 기간을 나눠 받은 파일을 올려 주세요.', true); return; }
    status(f.name + ' 읽는 중… (' + fmt(Math.round(f.size / 1024)) + 'KB)');
    var rd = new FileReader();
    rd.onload = function () { analyze(rd.result, f.name); };
    rd.onerror = function () { status('파일을 읽지 못했습니다. 다시 골라 주세요.', true); };
    rd.readAsArrayBuffer(f);
  }
  function done(res, name) {
    S.upload = res; showResult(res); renderComp();
    status(name + ' 검사를 마쳤습니다 (' + (res.ms / 1000).toFixed(1) + '초).');
  }
  function onMain(buf, name) { // Worker를 못 쓰는 환경용
    setTimeout(function () {
      try { done(Checks.run(buf, name, S.rules, S.ref), name); }
      catch (e) { status('검사하지 못했습니다: ' + e.message, true); }
    }, 30);
  }
  function analyze(buf, name) {
    S.upload = null; $('#uresult').innerHTML = '';
    status(name + ' 검사 중… 큰 파일은 몇 초 걸립니다.');
    var w;
    try { w = new Worker('worker.js'); } catch (e) { return onMain(buf, name); }
    var settled = false;
    w.onmessage = function (e) {
      settled = true; w.terminate();
      if (e.data.ok) done(e.data.res, name); else status('검사하지 못했습니다: ' + e.data.msg, true);
    };
    w.onerror = function (e) { if (settled) return; settled = true; e.preventDefault(); w.terminate(); onMain(buf, name); };
    w.postMessage({ buf: buf, name: name, rules: S.rules, ref: S.ref });
  }
  function showResult(res) {
    var c = counts(res.findings);
    S.shown = res.findings;
    var tables = res.tables.length === 1 ? res.tables.map(function (t) {
      return (t.period ? '<span><b>기간</b><span class="num">' + t.period.join(' ~ ') + '</span></span>' : '') + (t.hourly ? '<span><b>단위</b>시간별</span>' : '');
    }).join('') : res.tables.map(function (t) {
      return '<span><b>' + esc(t.name) + '</b><span class="num">' + fmt(t.rows) + '</span>행' + (t.period ? ' · <span class="num">' + t.period.join(' ~ ') + '</span>' : '') + (t.hourly ? ' · 시간 단위' : '') + '</span>';
    }).join('');
    $('#uresult').innerHTML = '<article class="card" style="margin-top:12px"><div class="card-head"><h3>' + esc(res.file) + '</h3>' +
      '<div class="facts"><span><b>글자 인코딩</b>' + esc(res.encoding) + '</span><span><b>전체</b><span class="num">' + fmt(res.rows) + '</span>행</span>' + tables + '</div>' +
      '<p class="verdict">' + verdict(c) + '</p><div class="pills">' + pills(c) + '</div>' +
      '<div class="btnrow" style="margin-top:6px"><button class="btn" type="button" id="ujson">결과 JSON 복사</button><button class="btn" type="button" id="usave">결과 JSON 내려받기</button></div></div>' +
      '<ul class="issues">' + (res.findings.length ? res.findings.map(issueHTML).join('') : '<li class="empty">규칙에 걸린 문제가 없습니다. 다른 데이터와 맞춰 보는 B 검사는 올림픽공원 공연 기록이 있는 2025년 데이터에서만 돌아갑니다.</li>') + '</ul></article>';
    bindIssueReport();
    var json = JSON.stringify(Checks.toTrustCard(res), null, 2);
    $('#ujson').addEventListener('click', function () { copy(json, $('#ujson')); });
    $('#usave').addEventListener('click', function () {
      saveText(res.file.replace(/\.[^.]+$/, '') + '_신뢰도카드.json', json, 'application/json').then(function (m) { flash($('#usave'), m); });
    });
    syncReport();
  }
  function copy(text, btn) {
    var done = function (m) { flash(btn, m); };
    try {
      navigator.clipboard.writeText(text).then(function () { done('복사했습니다.'); }, function () { done('복사가 막혀 있습니다. 직접 선택해 복사하세요.'); });
    } catch (e) { done('복사가 막혀 있습니다. 직접 선택해 복사하세요.'); }
  }

  /* ---------- 3. 보완 데이터 ---------- */
  function renderSupp() {
    var d = S.trust.datasets.find(function (x) { return x.id === S.current; });
    var list = d && d.supplements ? d.supplements : [];
    var cards = list.map(function (name) {
      var s = SUPP[name]; if (!s) return '';
      return '<div class="card dl"><h3>' + esc(s.title) + '</h3><p>' + esc(s.text) + '</p><p class="cols">열: ' + esc(s.cols) + '</p>' +
        '<div class="btnrow"><a class="btn primary" href="' + s.file + '" download="' + esc(name) + '" data-save="' + esc(name) + '">CSV 내려받기</a></div></div>';
    }).join('');
    cards += '<div class="card dl"><h3>신뢰도 카드 파일 (AI용)</h3><p>위 주의사항을 한 파일에 담았습니다. ChatGPT 같은 AI에게 KSPO 데이터를 분석시킬 때 이 파일도 함께 올리면, AI가 “방문객은 추정치” 같은 주의사항을 참고해서 답합니다.</p>' +
      '<p class="cols">검사한 KSPO 데이터 ' + S.trust.datasets.length + '종의 주의사항 전부 · JSON 형식</p>' +
      '<div class="btnrow"><a class="btn" href="data/trust.json" download="KSPO_신뢰도카드.json" data-save="KSPO_신뢰도카드.json">파일 내려받기</a></div></div>';
    if (!list.length && S.current !== 'upload') cards = '<div class="card empty">이 데이터는 아직 보완 파일이 없습니다. 주의사항을 참고해 쓰세요.</div>' + cards;
    $('#supp').innerHTML = '<div class="grid2">' + cards + '</div>';
  }

  /* ---------- 4. 함께 쓸 데이터 ---------- */
  function renderComp() {
    var d = S.trust.datasets.find(function (x) { return x.id === S.current; });
    if (S.current === 'upload') {
      if (!S.upload) { $('#comp').innerHTML = '<div class="card empty">파일을 검사하면 열 구성을 보고 함께 맞춰 볼 데이터를 추천합니다.</div>'; return; }
      var recs = Checks.recommend(S.upload, S.recommend);
      $('#comp').innerHTML = recs.length ? '<ul class="card comp">' + recs.map(function (r) {
        return '<li><span><a href="' + esc(r.url) + '">' + esc(r.name) + '</a></span><span class="why">' + esc(r.why) + '</span>' +
          '<span class="because">이 파일의 ‘' + r.because.map(esc).join('’, ‘') + '’ 열을 보고 추천</span></li>';
      }).join('') + '</ul>' : '<div class="card empty">이 파일의 열 구성에 맞는 추천 규칙이 아직 없습니다. 함께 볼 만한 데이터를 알면 아래에서 제보해 주세요.</div>';
      return;
    }
    var list = d && d.companions ? d.companions : [];
    $('#comp').innerHTML = list.length ? '<ul class="card comp">' + list.map(function (c) {
      return '<li><span>' + (c.url ? '<a href="' + esc(c.url) + '">' + esc(c.name) + '</a>' : esc(c.name)) + '</span><span class="why">' + esc(c.why) + '</span></li>';
    }).join('') + '</ul>' : '<div class="card empty">이 데이터와 대조할 공공데이터를 아직 찾지 못했습니다. 아는 데이터가 있으면 아래에서 제보해 주세요.</div>';
  }

  /* ---------- 5. 제보 ---------- */
  function initReport() {
    var opts = S.trust.datasets.map(function (d) { return '<option value="' + esc(d.id) + '">' + esc(d.name) + '</option>'; }).join('') +
      '<option value="upload">직접 올린 파일</option><option value="other">그 밖의 KSPO 데이터</option>';
    $('#r-ds').innerHTML = opts;
    ['#r-ds', '#r-what', '#r-how', '#r-who'].forEach(function (s) { $(s).addEventListener('input', renderReport); });
    $('#r-copy').addEventListener('click', function () { copy($('#r-out').textContent, $('#r-copy')); });
  }
  function syncReport() { if ($('#r-ds') && S.current) { $('#r-ds').value = S.current; renderReport(); } }
  function renderReport() {
    var id = $('#r-ds').value, d = S.trust.datasets.find(function (x) { return x.id === id; });
    var name = d ? d.name : id === 'upload' ? (S.upload ? S.upload.file : '직접 올린 파일') : '(데이터 이름을 적어 주세요)';
    var t = '[공공데이터 오류 제보]\n' +
      '데이터: ' + name + (d && d.url ? '\n주소: ' + d.url : '') + '\n' +
      '문제: ' + ($('#r-what').value.trim() || '(무엇이 틀렸는지 적어 주세요)') + '\n' +
      '근거: ' + ($('#r-how').value.trim() || '(어떻게 확인했는지 적어 주세요)') + '\n' +
      ($('#r-who').value.trim() ? '제보자: ' + $('#r-who').value.trim() + '\n' : '') +
      '작성일: ' + new Date().toISOString().slice(0, 10) + '\n(공공데이터 교차검증기로 작성)';
    $('#r-out').textContent = t;
    var link = $('#r-link');
    link.href = d && d.url ? d.url : 'https://www.data.go.kr';
    link.textContent = d && d.url ? '이 데이터의 공공데이터포털 페이지 열기' : '공공데이터포털 열기';
  }

  /* ---------- 검사 규칙 ---------- */
  function renderRules() {
    var used = {};
    S.trust.datasets.forEach(function (d) { d.issues.forEach(function (i) { used[i.rule] = (used[i.rule] || 0) + 1; }); });
    $('#rules').innerHTML = '<table><thead><tr><th>코드</th><th>규칙</th><th>판정 방법</th><th>KSPO 데이터에서 찾은 건수</th></tr></thead><tbody>' +
      S.rules.rules.map(function (r) {
        return '<tr><td class="c"><span class="code">' + r.code + '</span></td><td class="c">' + esc(r.name) + '</td><td>' + esc(r.how) + '</td><td class="num">' + (used[r.code] || '–') + '</td></tr>';
      }).join('') + '</tbody></table>';
    document.querySelectorAll('[data-jump]').forEach(function (b) {
      b.addEventListener('click', function () { document.getElementById(b.dataset.jump).scrollIntoView(); });
    });
  }
})();
