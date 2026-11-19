/* 교차검증기 검사 엔진: 브라우저(window.Checks)와 node(require) 양쪽에서 씁니다.
   규칙의 기준값은 data/rules.json에서 받습니다. AI를 호출하지 않습니다. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Checks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------- 읽기 ---------- */
  function decode(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    try {
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''), encoding: 'UTF-8' };
    } catch (e) {
      return { text: new TextDecoder('euc-kr').decode(u8), encoding: 'EUC-KR(CP949)' };
    }
  }

  function sniffDelimiter(text) {
    var line = text.slice(0, text.indexOf('\n') > 0 ? text.indexOf('\n') : 2000);
    var counts = { ',': 0, '\t': 0, ';': 0 };
    for (var i = 0; i < line.length; i++) if (counts[line[i]] !== undefined) counts[line[i]]++;
    return counts['\t'] > counts[','] ? '\t' : counts[';'] > counts[','] ? ';' : ',';
  }

  function parseCSV(text, maxRows) {
    var d = sniffDelimiter(text).charCodeAt(0);
    maxRows = maxRows || Infinity;
    var rows = [], row = [], field = '', i = 0, n = text.length, q = false;
    while (i < n) {
      var c = text.charCodeAt(i);
      if (q) {
        if (c === 34) {
          if (text.charCodeAt(i + 1) === 34) { field += '"'; i += 2; continue; }
          q = false; i++; continue;
        }
        var j = text.indexOf('"', i); if (j < 0) j = n;
        field += text.slice(i, j); i = j; continue;
      }
      if (c === 34 && field === '') { q = true; i++; continue; }
      if (c === d) { row.push(field); field = ''; i++; continue; }
      if (c === 10 || c === 13) {
        row.push(field); field = ''; rows.push(row); row = [];
        if (c === 13 && text.charCodeAt(i + 1) === 10) i++;
        i++;
        if (rows.length > maxRows) { // 나머지는 줄 수만 셈
          var rest = 0; for (var z = i; z < n; z++) if (text.charCodeAt(z) === 10) rest++;
          if (n > i && text.charCodeAt(n - 1) !== 10) rest++;
          var out = rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
          out.restLines = rest; return out;
        }
        continue;
      }
      var k = i;
      while (k < n) { var e = text.charCodeAt(k); if (e === d || e === 10 || e === 13) break; k++; }
      field += text.slice(i, k); i = k;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(function (r) { return !(r.length === 1 && r[0].trim() === ''); });
  }

  /* ---------- 값 해석 ---------- */
  var DT = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
  var TM = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;
  var NOYEAR = /^(\d{1,2})[./-](\d{1,2})(?:\s|$|[~(])|^\d{1,2}월\s?\d{1,2}일/;
  function pad(x) { return (x < 10 ? '0' : '') + x; }
  var TR = /^\d{1,2}:\d{2}(:\d{2})?\s*~\s*\d{1,2}:\d{2}(:\d{2})?$/; // 11:20~12:50
  var DATES = /\d{4}[-./]\d{1,2}[-./]\d{1,2}/g;
  function datesIn(v) { return (String(v || '').match(DATES) || []).map(function (x) { var d = parseDT(x); return d ? d.day : null; }).filter(Boolean); }
  function fileYear(name) { var m = /(^|[^0-9])(20\d{2})(?=[^0-9]|$)/.exec(name || ''); return m ? m[2] : null; }
  function fileDate(name) { var m = /(^|[^0-9])(20\d{2})(\d{2})(\d{2})(?=[^0-9]|$)/.exec(name || ''); return m ? m[2] + '-' + m[3] + '-' + m[4] : null; }
  function parseDT(s) {
    var m = DT.exec(s); if (!m) return null;
    var mo = +m[2], da = +m[3]; if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
    return { day: m[1] + '-' + pad(mo) + '-' + pad(da), hasTime: m[4] !== undefined,
      h: m[4] !== undefined ? +m[4] : null, mi: m[5] !== undefined ? +m[5] : null, s: m[6] !== undefined ? +m[6] : 0 };
  }
  function num(s) {
    if (s === '' || s == null) return NaN;
    var t = String(s).replace(/,/g, '').trim();
    if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
    return +t;
  }
  function dayIndex(day) { return Math.round(Date.parse(day + 'T00:00:00Z') / 864e5); }
  function dayFromIndex(i) { return new Date(i * 864e5).toISOString().slice(0, 10); }
  function fmt(n) { return Number(n).toLocaleString('ko-KR'); }
  function pct(x) { return Math.round(x * 100) + '%'; }

  /* ---------- 표 만들기: 묶인 칸 풀기, 섞인 형식 나누기 ---------- */
  var PACK_PART = /,\s*(?=[^,:]{1,20}:)/;
  function looksPacked(v) {
    if (!v || v.indexOf(':') < 0) return false;
    var parts = v.split(PACK_PART);
    if (parts.length < 2) return false;
    for (var i = 0; i < parts.length; i++) if (!/^\s*[^:,]{1,20}:/.test(parts[i])) return false;
    return true;
  }
  function unpack(v) {
    var o = {}, keys = [];
    v.split(PACK_PART).forEach(function (p) {
      var i = p.indexOf(':'); var k = p.slice(0, i).trim(); o[k] = p.slice(i + 1).trim(); keys.push(k);
    });
    return { o: o, keys: keys };
  }

  function buildTables(rows) {
    var headers = rows[0].map(function (h) { return h.trim(); });
    var body = rows.slice(1);
    var notes = [];
    // 묶인 칸 찾기
    var packedCol = -1;
    for (var c = 0; c < headers.length; c++) {
      var seen = 0, hit = 0;
      for (var r = 0; r < body.length && seen < 400; r++) {
        var v = body[r][c]; if (!v) continue; seen++; if (looksPacked(v)) hit++;
      }
      if (seen >= 10 && hit / seen >= 0.8) { packedCol = c; break; }
    }
    if (packedCol < 0) {
      return { tables: [{ name: '전체', headers: headers, rows: body }], packed: null, notes: notes };
    }
    var titleCol = headers.findIndex(function (h) { return /^(title|제목)$/i.test(h); });
    var groups = {}, order = [];
    body.forEach(function (r) {
      var u = unpack(r[packedCol] || '');
      var sig = u.keys.join('|');
      if (!groups[sig]) { groups[sig] = { keys: u.keys, rows: [], titles: {} }; order.push(sig); }
      var g = groups[sig];
      var base = r.filter(function (_, i) { return i !== packedCol; });
      g.rows.push(base.concat(u.keys.map(function (k) { return u.o[k]; })));
      if (titleCol >= 0) {
        var t = (r[titleCol] || '').replace(/^\s*\d{6,8}\s*/, '').trim();
        g.titles[t] = (g.titles[t] || 0) + 1;
      }
    });
    var baseHeaders = headers.filter(function (_, i) { return i !== packedCol; });
    var tables = order.map(function (sig, n) {
      var g = groups[sig];
      var name = Object.keys(g.titles).sort(function (a, b) { return g.titles[b] - g.titles[a]; })[0] || ('형식 ' + (n + 1));
      return { name: name, headers: baseHeaders.concat(g.keys), rows: g.rows, packedKeys: g.keys };
    }).filter(function (t) { return t.rows.length >= Math.max(20, body.length * 0.001); });
    tables.sort(function (a, b) { return b.rows.length - a.rows.length; });
    return { tables: tables, packed: { column: headers[packedCol], keyCount: tables.length ? tables[0].packedKeys.length : 0 }, notes: notes };
  }

  /* ---------- 열 성격 파악 ---------- */
  function profile(table, R) {
    var idRe = new RegExp(R.patterns.id_name, 'i');
    var n = table.rows.length;
    return table.headers.map(function (h, c) {
      var vals = table.rows.map(function (r) { return r[c] == null ? '' : String(r[c]).trim(); });
      var nonEmpty = vals.filter(function (v) { return v !== ''; });
      var distinct = new Set(nonEmpty).size;
      var dtHit = 0, timeHit = 0, tmHit = 0, numHit = 0, intOnly = true, minV = Infinity, noYear = 0;
      var stepN = Math.max(1, Math.floor(nonEmpty.length / 4000));
      var sample = stepN > 1 ? nonEmpty.filter(function (_, i) { return i % stepN === 0; }) : nonEmpty;
      sample.forEach(function (v) {
        var d = parseDT(v); if (d) { dtHit++; if (d.hasTime) timeHit++; }
        if (TM.test(v)) tmHit++;
        var x = num(v); if (!isNaN(x)) { numHit++; if (x % 1 !== 0) intOnly = false; if (x < minV) minV = x; }
        if (NOYEAR.test(v) && isNaN(num(v))) noYear++;
      });
      var ne = sample.length || 1;
      if (stepN > 1 && numHit / ne >= 0.9) { // 숫자 열이면 최솟값·정수 여부는 전체로
        nonEmpty.forEach(function (v) { var x = num(v); if (!isNaN(x)) { if (x % 1 !== 0) intOnly = false; if (x < minV) minV = x; } });
      }
      return {
        name: h, index: c, vals: vals, nonEmpty: nonEmpty.length, blank: n - nonEmpty.length, distinct: distinct,
        isDate: dtHit / ne >= 0.9 && nonEmpty.length > 0, hasTime: timeHit / ne >= 0.9,
        isTimeOnly: tmHit / ne >= 0.9 && nonEmpty.length > 0,
        isNum: numHit / ne >= 0.9 && nonEmpty.length >= 20 && dtHit / ne < 0.5 && tmHit / ne < 0.5,
        intOnly: intOnly, min: minV, dtRatio: dtHit / ne, tmRatio: tmHit / ne, noYearRatio: noYear / ne,
        isId: idRe.test(h) || (distinct === n && n > 50 && numHit / ne >= 0.9 && intOnly),
        constant: distinct <= 1
      };
    });
  }

  function primaryTime(cols, table) {
    var cands = cols.filter(function (c) { return c.isDate && !c.constant; });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return (b.hasTime - a.hasTime) || (a.index - b.index); });
    var c = cands[0];
    var timeCol = null;
    if (!c.hasTime) timeCol = cols.find(function (x) { return x.isTimeOnly; }) || null;
    var stamps = table.rows.map(function (r, i) {
      var d = parseDT(c.vals[i]); if (!d) return null;
      if (!d.hasTime && timeCol) { var m = TM.exec(timeCol.vals[i]); if (m) { d.h = +m[1]; d.mi = +m[2]; d.s = +(m[3] || 0); d.hasTime = true; } }
      return d;
    });
    return { col: c, timeCol: timeCol, stamps: stamps };
  }

  /* ---------- 공연명 맞추기 ---------- */
  function makeMatcher(R) {
    var stop = new Set(R.match.stop), al = R.match.aliases, minT = R.match.min_token, subMin = R.match.substring_min_hangul;
    function norm(s) { s = String(s || '').toLowerCase(); Object.keys(al).forEach(function (k) { s = s.split(k).join(al[k]); }); return s; }
    function tok(s) {
      var out = new Set(); (norm(s).match(/[a-z0-9]+|[가-힣]+/g) || []).forEach(function (w) { if (w.length >= minT && !stop.has(w)) out.add(w); });
      return out;
    }
    function compact(s) { return norm(s).replace(/[^a-z0-9가-힣]/g, ''); }
    return function (a, b) {
      var ta = tok(a), tb = tok(b), ca = compact(b), cb = compact(a), hit = false;
      if (ca && cb && (ca === cb || (Math.min(ca.length, cb.length) >= 6 && (ca.indexOf(cb) >= 0 || cb.indexOf(ca) >= 0)))) return true;
      ta.forEach(function (w) { if (tb.has(w)) hit = true; else if (/^[가-힣]+$/.test(w) && w.length >= subMin && ca.indexOf(w) >= 0) hit = true; });
      if (!hit) tb.forEach(function (w) { if (/^[가-힣]+$/.test(w) && w.length >= subMin && cb.indexOf(w) >= 0) hit = true; });
      return hit;
    };
  }

  /* ---------- 검사 ---------- */
  function finding(rule, severity, title, detail, extra) {
    var f = { rule: rule, severity: severity, title: title, detail: detail };
    if (extra) Object.keys(extra).forEach(function (k) { f[k] = extra[k]; });
    return f;
  }

  function spans(days) { // 연속된 날짜를 구간으로
    var idx = days.map(dayIndex).sort(function (a, b) { return a - b; }), out = [];
    idx.forEach(function (i) { var l = out[out.length - 1]; if (l && i - l[1] <= 3) l[1] = i; else out.push([i, i]); });
    return out.map(function (s) { return s[0] === s[1] ? dayFromIndex(s[0]) : dayFromIndex(s[0]) + ' ~ ' + dayFromIndex(s[1]); });
  }

  function checkTable(table, R, ref, ctx) {
    var T = R.thresholds, out = [], n = table.rows.length;
    var cols = profile(table, R);
    var pt = primaryTime(cols, table);
    var label = ctx.multi ? '[' + table.name + '] ' : '';
    var info = { name: table.name, rows: n, columns: table.headers.length, period: null, hourly: false, columnNames: table.headers.slice(0, 200) };

    // 기간
    var days = [];
    if (pt) {
      var ds = pt.stamps.filter(Boolean).map(function (s) { return s.day; }).sort();
      if (ds.length) { info.period = [ds[0], ds[ds.length - 1]]; }
    }

    // A1 결측
    var blankCols = cols.filter(function (c) { return c.blank / n >= T.a1_blank_ratio; })
      .map(function (c) { return c.name + ' ' + pct(c.blank / n); });
    if (blankCols.length) out.push(finding('A1', 'low', label + '빈칸이 많은 열',
      '빈칸 비율이 ' + pct(T.a1_blank_ratio) + ' 이상인 열: ' + blankCols.join(', ') + '. 빈칸이 0을 뜻하는지 측정이 안 된 것인지 확인하세요.'));

    // A2 중복
    var keyCols = cols.filter(function (c) { return !c.isId && !(c.distinct === n && n > 50); });
    if (keyCols.length >= 2) {
      var seen = new Set(), dup = 0, emptyRows = 0;
      for (var r = 0; r < n; r++) {
        var k = keyCols.map(function (c) { return c.vals[r]; }).join('\u0001');
        if (!k.replace(/\u0001/g, '').trim()) { emptyRows++; continue; }
        if (seen.has(k)) dup++; else seen.add(k);
      }
      if (emptyRows) out.push(finding('A1', emptyRows / n >= 0.01 ? 'medium' : 'low', label + '내용이 빈 행',
        fmt(emptyRows) + '행은 번호 말고는 모든 칸이 비어 있습니다. 분석 전에 지우세요.'));
      if (dup > 0) out.push(finding('A2', dup / n >= 0.01 ? 'medium' : 'low', label + '같은 기록 반복',
        '번호 열을 빼고 모든 값이 같은 행이 ' + fmt(dup) + '건(' + (dup / n * 100).toFixed(1) + '%) 있습니다.'));
    }

    // A3 시간 공백 (정시 기록이면 시간 단위 데이터로 봄)
    var hoursByDay = {};
    if (pt) {
      var timed = pt.stamps.filter(function (s) { return s && s.hasTime; });
      var onHour = timed.filter(function (s) { return s.mi === 0 && s.s === 0; }).length;
      var uniq = new Set(timed.map(function (s) { return s.day + ' ' + s.h; })).size;
      info.hourly = timed.length >= 48 && onHour / timed.length >= 0.95 && uniq / timed.length >= 0.95;
      timed.forEach(function (s) { (hoursByDay[s.day] = hoursByDay[s.day] || new Set()).add(s.h); });
      if (info.hourly && info.period && !ctx.partial) {
        var a = dayIndex(info.period[0]), b = dayIndex(info.period[1]), sparse = [], zero = 0;
        for (var i = a; i <= b; i++) {
          var dd = dayFromIndex(i), hs = hoursByDay[dd] ? hoursByDay[dd].size : 0;
          if (hs < T.sparse_hours) { sparse.push(dd); if (!hs) zero++; }
        }
        var total = b - a + 1;
        if (sparse.length) out.push(finding('A3', sparse.length / total >= 0.1 ? 'high' : sparse.length >= 3 ? 'medium' : 'low',
          label + '기록이 빈 날', '시간 단위 데이터인데 ' + fmt(total) + '일 중 ' + fmt(sparse.length) + '일은 기록된 시간대가 ' + T.sparse_hours + '개 미만이고, ' +
          zero + '일은 기록이 아예 없습니다. 주로 ' + spans(sparse).slice(0, 3).join(', ') + '.', { days: sparse }));
      }
    }
    var nameRe = /명|제목|이름|title|name|nm$/i, idRe2 = new RegExp(R.patterns.id_name, 'i');
    var nameCol = cols.find(function (c) { return nameRe.test(c.name) && !idRe2.test(c.name) && !c.isNum && !c.isDate && c.nonEmpty >= n * 0.5 && c.distinct >= 20 && c.distinct / c.nonEmpty >= 0.05; });
    info.catalog = !!nameCol && !info.hourly; // 공연 목록·강좌 목록처럼 한 행이 한 항목인 데이터
    if (pt && !info.hourly && !info.catalog && info.period && !ctx.partial) {
      var span = dayIndex(info.period[1]) - dayIndex(info.period[0]) + 1;
      var have = new Set(pt.stamps.filter(Boolean).map(function (s) { return s.day; })).size;
      if (span >= 60 && have / span < 0.5) out.push(finding('A3', 'medium', label + '기록이 있는 날이 드묾',
        info.period[0] + ' ~ ' + info.period[1] + '(' + fmt(span) + '일) 중 기록이 있는 날은 ' + fmt(have) + '일(' + pct(have / span) + ')뿐입니다. 특정 상황에서만 남기는 기록이라 연속된 추이 분석에는 쓸 수 없습니다.'));
    }
    if (pt && pt.timeCol) {
      var mirror = 0, cnt = 0;
      table.rows.forEach(function (r, i) {
        var d = parseDT(pt.col.vals[i]), m = TM.exec(pt.timeCol.vals[i]); if (!d || !m || m[3] === undefined) return; cnt++;
        if (m[2] === d.day.slice(5, 7) && m[3] === d.day.slice(8, 10)) mirror++;
      });
      if (cnt >= 20 && mirror / cnt >= 0.9) out.push(finding('A6', 'medium', label + '‘' + pt.timeCol.name + '’의 분·초가 날짜와 같음',
        '‘' + pt.timeCol.name + '’ ' + fmt(cnt) + '건 중 ' + pct(mirror / cnt) + '의 분·초가 ‘' + pt.col.name + '’의 월·일과 같습니다(예: ' + pt.col.vals[0] + ' → ' + pt.timeCol.vals[0] +
        '). 시각을 저장할 때 형식이 잘못된 것으로 보여 분·초는 믿을 수 없습니다.'));
    }
    if (!ctx.multi) cols.filter(function (c) { return c.isId && c.intOnly && c.distinct === c.nonEmpty && c.nonEmpty >= 50; }).forEach(function (c) {
      var v = c.vals.map(num).filter(function (x) { return !isNaN(x); }), lo = Infinity, hi = -Infinity;
      for (var vi = 0; vi < v.length; vi++) { if (v[vi] < lo) lo = v[vi]; if (v[vi] > hi) hi = v[vi]; }
      var gap = hi - lo + 1 - v.length;
      if (gap > 0 && gap / (hi - lo + 1) <= 0.5) out.push(finding('A8', 'low', label + '‘' + c.name + '’ 번호가 비어 있음',
        '‘' + c.name + '’ 열 번호가 ' + fmt(lo) + '~' + fmt(hi) + '인데 ' + fmt(v.length) + '행뿐이라 ' + fmt(gap) + '건이 빠졌거나 지워졌습니다.'));
    });
    info.coveredDays = Object.keys(hoursByDay).filter(function (d) { return !info.hourly || hoursByDay[d].size >= T.sparse_hours; });
    if (pt && !Object.keys(hoursByDay).length) info.coveredDays = Array.from(new Set(pt.stamps.filter(Boolean).map(function (s) { return s.day; })));

    // A4 파생값 위장
    var nums = cols.filter(function (c) { return c.isNum && !c.isId && !c.constant; });
    var numVals = {}; nums.forEach(function (c) { numVals[c.name] = c.vals.map(num); });
    var derived = new Set();
    nums.forEach(function (ca) {
      nums.forEach(function (cb) {
        if (ca === cb || derived.has(cb.name + '>' + ca.name)) return;
        var A = numVals[ca.name], B = numVals[cb.name], tally = {}, cnt = 0;
        var quick = {}, qc = 0;
        for (var q = 0; q < n && qc < 300; q++) { if (!(A[q] > 0) || isNaN(B[q])) continue; var qr = Math.round(B[q] / A[q] * 1e4) / 1e4; quick[qr] = (quick[qr] || 0) + 1; qc++; }
        if (qc < 30) return;
        var qtop = Object.keys(quick).map(function (k) { return quick[k]; }).sort(function (x, y) { return y - x; });
        if ((qtop[0] + (qtop[1] || 0)) / qc < 0.9) return;
        for (var i = 0; i < n; i++) {
          if (!(A[i] > 0) || isNaN(B[i])) continue;
          var r = Math.round(B[i] / A[i] * 1e4) / 1e4; tally[r] = (tally[r] || 0) + 1; cnt++;
        }
        if (cnt < 30) return;
        var top = Object.keys(tally).sort(function (x, y) { return tally[y] - tally[x]; }).slice(0, 2);
        var cover = top.reduce(function (s, k) { return s + tally[k]; }, 0) / cnt;
        var ratios = top.map(Number).filter(function (x) { return tally[x] / cnt >= 0.01; });
        if (cover >= T.a4_cover && ratios.every(function (x) { return x > 1; })) {
          derived.add(ca.name + '>' + cb.name); cb.derived = true;
          out.push(finding('A4', 'high', label + '‘' + cb.name + '’ 열은 실측이 아닐 수 있음',
            '‘' + cb.name + '’ 값의 ' + pct(cover) + '가 ‘' + ca.name + '’ × ' + ratios.join(' 또는 × ') + '입니다. 따로 측정한 값이 아니라 계산한 추정치일 가능성이 큽니다.'));
        }
      });
    });

    // A5 기간 이상치 (하루 최댓값의 월별 중앙값, 기록이 빈 날은 뺌)
    if (pt && !ctx.partial && !info.catalog) {
      var ex = new RegExp(R.patterns.a5_exclude);
      var okDay = function (d) { return !info.hourly || (hoursByDay[d] && hoursByDay[d].size >= T.sparse_hours); };
      nums.filter(function (c) { return c.intOnly && c.min >= 0 && !ex.test(c.name) && !c.derived; }).forEach(function (c) {
        var dmax = {};
        pt.stamps.forEach(function (s, i) { if (!s || !okDay(s.day)) return; var v = numVals[c.name][i]; if (isNaN(v)) return; if (!(dmax[s.day] >= v)) dmax[s.day] = v; });
        var byM = {};
        Object.keys(dmax).forEach(function (d) { (byM[d.slice(0, 7)] = byM[d.slice(0, 7)] || []).push(dmax[d]); });
        var ms = Object.keys(byM).sort(); if (ms.length < 6) return;
        var mmed = {}; ms.forEach(function (m) { var a = byM[m].sort(function (x, y) { return x - y; }); mmed[m] = a[Math.floor(a.length / 2)]; });
        var sorted = ms.map(function (m) { return mmed[m]; }).sort(function (a, b) { return a - b; });
        var med = sorted[Math.floor(sorted.length / 2)];
        var low = ms.filter(function (m) { return mmed[m] < med * T.a5_fraction; });
        var ok = ms.filter(function (m) { return low.indexOf(m) < 0; }).map(function (m) { return mmed[m]; });
        if (low.length && low.length <= ms.length / 3 && med >= 20) out.push(finding('A5', 'medium', label + '‘' + c.name + '’ 값이 유독 낮은 달',
          low.map(function (m) { return +m.slice(5) + '월'; }).join('·') + '의 하루 최댓값이 보통 ' + low.map(function (m) { return fmt(mmed[m]); }).join('·') +
          ' 수준이라 다른 달(' + fmt(Math.min.apply(null, ok)) + '~' + fmt(Math.max.apply(null, ok)) + ')의 3분의 1에도 못 미칩니다. 수집 장비나 방식이 바뀌었는지 확인하세요.'));
      });
    }

    // A6 형식 불일치
    var tre = new RegExp(R.patterns.time_name, 'i');
    cols.forEach(function (c) {
      if (!tre.test(c.name) || !c.nonEmpty || c.isNum) return;
      var bad = c.vals.filter(function (v) { return v && !parseDT(v) && !TM.test(v) && !TR.test(v); });
      if (1 - bad.length / c.nonEmpty >= T.a6_parse_ratio) return;
      var same = cols.find(function (o) {
        if (o === c) return false; var eq = 0, m = 0;
        for (var i = 0; i < n && m < 2000; i++) { if (!c.vals[i]) continue; m++; if (c.vals[i] === o.vals[i]) eq++; }
        return m && eq / m >= 0.8;
      });
      out.push(finding('A6', 'medium', label + '‘' + c.name + '’ 칸에 시각이 아닌 값',
        '‘' + c.name + '’ 값의 ' + pct(bad.length / c.nonEmpty) + '가 날짜·시각 형식이 아닙니다(예: ' + bad.slice(0, 2).join(', ') + ').' +
        (same ? ' 대부분 ‘' + same.name + '’ 열과 같은 값이라 다른 칸의 값이 잘못 들어간 것으로 보입니다.' : '')));
    });
    var dlName = /시간|일시|일자|날짜|시각|기간|일정|date|time|temporal|period|coverage/i;
    cols.forEach(function (c) {
      if (c.noYearRatio >= 0.1) {
        out.push(finding('A6', 'medium', label + '연도 없는 날짜',
          '‘' + c.name + '’ 값의 ' + pct(c.noYearRatio) + '가 연도 없이 월·일만 적혀 있어 언제인지 알 수 없습니다.'));
        return;
      }
      if (c.isNum || c.isDate || !dlName.test(c.name) || !c.nonEmpty) return;
      var dayish = /일시|일자|날짜|기간|일정|date|temporal|period|coverage/i.test(c.name); // 시각만 적는 열(시작종료시간)은 시각만 있어도 정상
      var info2 = 0, nod = 0, filler = 0, fx = '';
      c.vals.forEach(function (v) {
        if (!v) return;
        if (!/\d/.test(v)) { if (v.length <= 5) filler++; return; }
        info2++;
        if (/\d{4}/.test(v)) return;
        var timeOnly = TM.test(v) || TR.test(v);
        var frag = /\d{1,2}\s*일|\d{1,2}\s*\(|\(\s*[월화수목금토일]\s*\)|\d{1,2}[./]\d{1,2}|\d{1,2}\s*월/.test(v);
        if (frag || (dayish && (timeOnly || /\d{1,2}:\d{2}|\d{1,2}\s*시/.test(v)))) { nod++; if (!fx && frag) fx = v; }
      });
      if (info2 >= 20 && nod / info2 >= 0.3) out.push(finding('A6', 'medium', label + '연도 없는 날짜',
        '‘' + c.name + '’에 날짜·시각이 적힌 ' + fmt(info2) + '건 중 ' + pct(nod / info2) + '가 ' + (fx ? '‘' + fx.slice(0, 30) + '’처럼 ' : '') + '연도 없이(대부분 월도 없이) 적혀 있어 언제인지 알 수 없습니다.' +
        (filler >= 10 ? ' 그 밖에 ‘.’·‘-’처럼 내용 없는 값도 ' + fmt(filler) + '건 있습니다.' : '')));
    });

    // A6 시작·종료 날짜 짝 맞추기
    var sRe = /시작|start|부터/i, eRe = /종료|끝|end|까지/i;
    cols.filter(function (c) { return c.isDate && eRe.test(c.name); }).forEach(function (ec) {
      var starts = cols.filter(function (c) { return c.isDate && sRe.test(c.name) && c !== ec; });
      if (!starts.length) return;
      var sc = starts.find(function (c) { return c.name.replace(sRe, '') === ec.name.replace(eRe, ''); }) || starts[0];
      var m = 0, same = 0, before = 0, ranged = 0, ex = null;
      for (var i = 0; i < n; i++) {
        var sd = datesIn(sc.vals[i]), ed = datesIn(ec.vals[i]); if (!sd.length || !ed.length) continue; m++;
        if (sd.length >= 2) ranged++;
        if (ed[0] === sd[0]) same++; if (ed[0] < sd[0]) { before++; if (!ex) ex = sc.vals[i] + ' → ' + ec.vals[i]; }
      }
      if (m < 20) return;
      if (ranged / m >= 0.9 && same / m >= 0.9) out.push(finding('A6', 'medium', label + '‘' + ec.name + '’에 종료일이 아닌 시작일이 들어 있음',
        '‘' + ec.name + '’ 값의 ' + pct(same / m) + '가 ‘' + sc.name + '’의 시작 날짜와 같습니다(예: ' + sc.vals[0] + ' → ' + ec.vals[0] + '). 실제 종료일은 ‘' + sc.name + '’ 칸의 ‘~’ 뒤에 들어 있어 두 칸 이름과 내용이 맞지 않습니다.'));
      else if (before / m >= 0.01) out.push(finding('A6', 'medium', label + '종료일이 시작일보다 빠른 행',
        fmt(before) + '행은 ‘' + ec.name + '’이 ‘' + sc.name + '’보다 빠릅니다(예: ' + ex + ').'));
    });
    // A6 자리 채움 날짜(9999-12-31 등), A5 동떨어진 날짜
    var holder = {}, holderN = 0, far = {}, farN = 0, farEx = '', p1y = null;
    var dcols = cols.filter(function (c) { return c.isDate; });
    if (dcols.length && n >= 50) {
      var yrs = [];
      dcols.forEach(function (c) { c.vals.forEach(function (v) { datesIn(v).forEach(function (d) { var y = +d.slice(0, 4); if (y > 1900 && y < 2100) yrs.push(y); }); }); });
      yrs.sort(function (a, b) { return a - b; });
      p1y = yrs.length ? yrs[Math.floor(yrs.length * 0.01)] : null;
      dcols.forEach(function (c) {
        c.vals.forEach(function (v) {
          var ds = datesIn(v);
          if (ds.some(function (d) { var y = +d.slice(0, 4); return y >= 2100 || y <= 1900; })) { holder[c.name] = (holder[c.name] || 0) + 1; holderN++; }
          else if (p1y && ds.some(function (d) { return +d.slice(0, 4) < p1y - 5; })) { far[c.name] = (far[c.name] || 0) + 1; farN++; if (!farEx) farEx = v; }
        });
      });
      var list = function (o) { return Object.keys(o).map(function (k) { return '‘' + k + '’ ' + fmt(o[k]) + '건'; }).join(', '); };
      if (holderN) out.push(finding('A6', 'low', label + '자리 채움용 날짜',
        '9999-12-31처럼 실제 날짜가 아닌 값이 있습니다: ' + list(holder) + '. ‘종료일 없음’을 뜻한다면 분석 전에 따로 처리하세요.'));
      if (farN) out.push(finding('A5', 'low', label + '다른 기록과 동떨어진 날짜',
        '대부분 ' + p1y + '년 이후인데 훨씬 이른 날짜가 있습니다: ' + list(far) + '(예: ' + farEx + '). 잘못 입력된 날짜인지 확인하세요.'));
    }
    // A1 모든 행이 같은 값인 열
    if (n >= 50) {
      var consts = cols.filter(function (c) { return c.constant && c.nonEmpty === n && !c.isDate; }).map(function (c) { return '‘' + c.name + '’(' + c.vals[0] + ')'; });
      if (consts.length) out.push(finding('A1', 'low', label + '모든 행이 같은 값인 열',
        consts.join(', ') + ' 열은 모든 행이 같은 값이라 담긴 정보가 없습니다.'));
    }
    // A6 앞뒤 빈칸, HTML 기호
    var sp = [], ent = [], entEx = '';
    cols.forEach(function (c) {
      if (c.isNum || c.isDate) return;
      var a = 0, b = 0;
      for (var i = 0; i < n; i++) {
        var raw = table.rows[i][c.index]; if (!raw) continue;
        if (raw !== raw.trim()) a++;
        if (/&(lt|gt|amp|quot|apos|#\d+);/.test(raw)) { b++; if (!entEx) entEx = raw; }
      }
      if (a >= 5 && a / (c.nonEmpty || 1) >= 0.01) sp.push('‘' + c.name + '’ ' + fmt(a) + '건');
      if (b) ent.push('‘' + c.name + '’ ' + fmt(b) + '건');
    });
    if (sp.length) out.push(finding('A6', 'low', label + '앞뒤에 빈칸이 붙은 값',
      sp.join(', ') + '. 같은 이름이 다르게 집계될 수 있으니 공백을 지우고 쓰세요.'));
    if (ent.length) out.push(finding('A6', 'low', label + 'HTML 기호가 그대로 남은 값',
      ent.join(', ') + '(예: ' + entEx.slice(0, 60) + '). ‘&lt;’는 ‘<’로 바꿔 읽어야 합니다.'));
    // 목록형 데이터: 같은 이름 반복, 빈 연도
    // 같은 제목 반복: 목록형 데이터의 이름 열, 또는 긴 글 제목 열(‘20251207 입출차정보’ 같은 날짜 붙은 꼬리표는 제외)
    var titleCol = (info.catalog && nameCol) || cols.find(function (c) {
      if (!/제목|title/i.test(c.name) || c.isNum || c.isDate || c.nonEmpty < 50) return false;
      var len = 0, tag = 0, k = 0;
      for (var i = 0; i < n && k < 2000; i++) { var v = c.vals[i]; if (!v) continue; k++; len += v.length; if (/^\d{6,8}\s/.test(v)) tag++; }
      return k && len / k >= 12 && tag / k < 0.5;
    });
    if (titleCol) {
      var cnt2 = {}, dup2 = 0, dupEx = '', top2 = '', topN = 0;
      titleCol.vals.forEach(function (v) { if (!v) return; cnt2[v] = (cnt2[v] || 0) + 1; if (cnt2[v] === 2) { dup2++; if (!dupEx) dupEx = v; } if (cnt2[v] > topN) { topN = cnt2[v]; top2 = v; } });
      var uniq2 = Object.keys(cnt2).length, avg2 = titleCol.nonEmpty / (uniq2 || 1);
      if (dup2 && dup2 / n < 0.1 && avg2 < 2) out.push(finding('A2', 'low', label + '같은 ‘' + titleCol.name + '’ 반복',
        '같은 ‘' + titleCol.name + '’이 두 번 이상 나오는 항목이 ' + fmt(dup2) + '개 있습니다(예: ' + dupEx.slice(0, 60) + '). 중복 등록인지 확인하세요.'));
      else if (dup2 && avg2 >= 2) out.push(finding('A2', avg2 >= 10 ? 'medium' : 'low', label + '같은 ‘' + titleCol.name + '’이 여러 번 나옴',
        fmt(titleCol.nonEmpty) + '행 중 서로 다른 ‘' + titleCol.name + '’은 ' + fmt(uniq2) + '개뿐이라 하나가 평균 ' + avg2.toFixed(1) + '번 나옵니다(가장 많은 것: ‘' + top2.slice(0, 40) + '’ ' + fmt(topN) + '번). 정기적으로 반복되는 항목인지, 같은 글이 중복 등록된 것인지 확인하세요.'));
    }
    if (info.catalog && nameCol) {
      if (pt && p1y) {
        var yc = {}; pt.stamps.forEach(function (st) { if (st) yc[st.day.slice(0, 4)] = (yc[st.day.slice(0, 4)] || 0) + 1; });
        var ys = Object.keys(yc).map(Number).filter(function (y) { return y >= p1y && y < 2100; }).sort(), gaps = [];
        for (var y = ys[0]; y <= ys[ys.length - 1]; y++) if (!yc[y]) gaps.push(y);
        if (gaps.length && ys[ys.length - 1] - ys[0] >= 3) out.push(finding('A3', 'low', label + '기록이 하나도 없는 해',
          ys[0] + '~' + ys[ys.length - 1] + '년 중 ' + gaps.join('·') + '년에는 기록이 하나도 없습니다. 그 해에 정말 없었는지, 빠진 것인지 확인하세요.'));
      }
    }

    // A7 갱신 중단
    if (info.period && !ctx.partial) {
      var age = Math.round((ctx.today - Date.parse(info.period[1] + 'T00:00:00Z')) / 864e5);
      var fy = fileYear(ctx.fileName), fd = fileDate(ctx.fileName); // '2023년 자료', '_20231231'처럼 기간이 정해진 파일은 제외
      var closed = (fy && info.period[1].slice(0, 4) === fy && info.period[1].slice(5) >= '12-01') ||
        (fd && dayIndex(info.period[1]) >= dayIndex(fd) - 45);
      if (age > T.a7_days && !closed) out.push(finding('A7', 'medium', label + '오래된 최신 기록',
        '가장 최근 기록이 ' + info.period[1] + '로 ' + fmt(age) + '일 전입니다. 갱신이 멈췄는지 확인하세요.'));
    }

    // B 검사: 올림픽공원 공연 데이터로 보이는 경우에만
    var evRe = new RegExp(R.patterns.event_name), audRe = new RegExp(R.patterns.audience_name);
    var evCol = cols.find(function (c) { return evRe.test(c.name) && c.nonEmpty > 0; });
    if (!ctx.partial && !info.catalog && ref && pt && evCol && info.period && info.period[0] <= ref.daily[ref.daily.length - 1].날짜 && info.period[1] >= ref.daily[0].날짜) {
      var match = makeMatcher(R);
      var evByDay = {};
      pt.stamps.forEach(function (s, i) { if (s && evCol.vals[i]) (evByDay[s.day] = evByDay[s.day] || new Set()).add(evCol.vals[i]); });
      var covered = new Set(info.coveredDays);
      // B1
      var missing = [], unknown = [], checked = 0;
      ref.calendar.filter(function (e) { return e.KOPIS === 'True'; }).forEach(function (e) {
        var ds = []; for (var i = dayIndex(e.시작일); i <= dayIndex(e.종료일); i++) ds.push(dayFromIndex(i));
        if (ds[ds.length - 1] < info.period[0] || ds[0] > info.period[1]) return;
        var cov = ds.filter(function (d) { return covered.has(d); });
        var names = []; ds.forEach(function (d) { if (evByDay[d]) evByDay[d].forEach(function (x) { names.push(x); }); });
        if (names.some(function (x) { return match(e.공연명, x); })) { checked++; return; }
        if (!cov.length) { unknown.push(e); return; }
        checked++; missing.push(e);
      });
      if (missing.length || unknown.length) {
        var byVenue = {}; missing.forEach(function (e) { byVenue[e.공연장] = (byVenue[e.공연장] || 0) + 1; });
        out.push(finding('B1', 'high', label + 'KOPIS에 있는 공연이 빠짐',
          '같은 기간 KOPIS 공연 ' + fmt(checked + unknown.length) + '건 중 ' + fmt(missing.length) + '건은 그날 기록이 있는데 공연만 빠졌습니다' +
          (missing.length ? '(' + Object.keys(byVenue).map(function (v) { return v + ' ' + byVenue[v]; }).join(', ') + ')' : '') + '.' +
          (unknown.length ? ' ' + fmt(unknown.length) + '건은 기록이 빈 날에 열려 확인할 수 없습니다.' : ''),
          { items: missing.map(function (e) { return e.시작일 + ' ' + e.공연명 + ' (' + e.공연장 + ')'; }) }));
      }
      // B2
      var surge = ref.daily.filter(function (d) { return +d.평소대비_배수 >= T.surge_ratio && covered.has(d.날짜) && !evByDay[d.날짜]; });
      if (surge.length) {
        var kd = surge.filter(function (d) { return d.KOPIS_공연기간 === 'True'; });
        out.push(finding('B2', 'medium', label + '인파는 몰렸는데 행사 기록이 없는 날',
          '기록이 온전한 날 중 올림픽공원역 21~23시 승차가 평소의 ' + T.surge_ratio + '배 이상인데 행사 기록이 없는 날이 ' + surge.length + '일입니다' +
          (kd.length ? '. 그중 ' + kd.length + '일은 KOPIS 공연 기간과 겹칩니다' : '') + '.',
          { items: surge.map(function (d) { return d.날짜 + ' (평소의 ' + d.평소대비_배수 + '배' + (d.KOPIS_공연기간 === 'True' ? ', KOPIS 공연 기간' : '') + ')'; }) }));
      }
      // B4
      var audCol = cols.find(function (c) { return audRe.test(c.name) && c.isNum; });
      if (audCol) {
        var aud = {}; pt.stamps.forEach(function (s, i) { var v = num(audCol.vals[i]); if (s && v > 0 && evCol.vals[i]) aud[s.day] = Math.max(aud[s.day] || 0, v); });
        var xs = [], ys = [];
        ref.daily.forEach(function (d) { if (aud[d.날짜]) { xs.push(aud[d.날짜]); ys.push(+d.합계_21_23시_승차); } });
        if (xs.length >= 20) {
          var r2 = Math.pow(corr(xs, ys), 2);
          if (r2 < 0.5) out.push(finding('B4', 'medium', label + '‘' + audCol.name + '’ 열이 실제 인파를 거의 설명하지 못함',
            '공연이 기록된 ' + xs.length + '일의 ‘' + audCol.name + '’ 열과 올림픽공원역 21~23시 승차의 설명력(R²)이 ' + r2.toFixed(2) + '입니다. 관객 규모 분석에 그대로 쓰지 마세요.'));
        }
      }
    }
    // (가) 교차 검증 기준 데이터(현재 2025년)가 없는 기간이면 건너뛴 사실을 알림
    if (!ctx.partial && ref && pt && evCol && info.period) {
      var r0 = ref.daily[0].날짜, r1 = ref.daily[ref.daily.length - 1].날짜, ry = r0.slice(0, 4) === r1.slice(0, 4) ? r0.slice(0, 4) + '년' : r0 + ' ~ ' + r1;
      if (info.period[1] < r0 || info.period[0] > r1) out.push(finding('안내', 'low', label + '교차 검증을 하지 못함',
        '교차 검증용 기준 데이터(KOPIS 공연 달력, 올림픽공원역 승하차 지표)는 지금 ' + ry + '치만 있어, 이 데이터(' + info.period[0] + ' ~ ' + info.period[1] + ')의 B 검사(공연 누락, 인파 급증일, 규모, 날짜 대조)는 건너뛰었습니다. 문제가 없다는 뜻이 아닙니다.'));
      else if (info.period[0] < r0 || info.period[1] > r1) out.push(finding('안내', 'low', label + '교차 검증은 일부 기간만',
        '교차 검증용 기준 데이터는 지금 ' + ry + '치만 있어, 이 데이터(' + info.period[0] + ' ~ ' + info.period[1] + ') 중 그 기간만 B 검사를 했습니다.'));
    }
    // B3 목록형 공연 데이터: 날짜가 KOPIS 공연 기간과 맞는지
    if (!ctx.partial && info.catalog && ref && pt && evCol) {
      var mt = makeMatcher(R), kop = ref.calendar.filter(function (e) { return e.KOPIS === 'True'; });
      var y0 = ref.daily[0].날짜, y1 = ref.daily[ref.daily.length - 1].날짜;
      var matched = 0, outside = [], found = new Set();
      pt.stamps.forEach(function (st, i) {
        if (!st || st.day < y0 || st.day > y1) return; var t = evCol.vals[i]; if (!t) return;
        var best = null, bd = 1e9, x = dayIndex(st.day);
        kop.forEach(function (e) {
          if (!mt(t, e.공연명)) return;
          var a = dayIndex(e.시작일), b = dayIndex(e.종료일), dist = x < a ? a - x : x > b ? x - b : 0;
          if (dist < bd) { bd = dist; best = e; }
        });
        if (!best || bd > 120) return;
        matched++; found.add(best.KOPIS_ID);
        if (bd > 0) outside.push({ t: t, day: st.day, e: best, gap: dayIndex(best.시작일) - x });
      });
      if (matched >= 5 && outside.length / matched >= 0.5) {
        var early = outside.filter(function (o) { return o.gap > 0; });
        var avg = early.length ? Math.round(early.reduce(function (s, o) { return s + o.gap; }, 0) / early.length) : 0;
        out.push(finding('B3', 'medium', label + '‘' + pt.col.name + '’가 실제 공연 기간과 다름',
          'KOPIS 공연과 이름이 맞는 ' + y0.slice(0, 4) + '년 항목 ' + matched + '건 중 ' + outside.length + '건은 ‘' + pt.col.name + '’가 실제 공연 기간 밖입니다' +
          (early.length ? '(' + early.length + '건은 평균 ' + avg + '일 앞섬)' : '') + '. 공연일이 아니라 게시일·등록일일 가능성이 큽니다.',
          { items: outside.map(function (o) { return o.day + ' ' + o.t + ' → 실제 ' + o.e.시작일 + (o.e.종료일 !== o.e.시작일 ? '~' + o.e.종료일 : '') + ' (' + o.e.공연장 + ')'; }) }));
      }
      if (matched >= 5) info.kopisFound = found.size;
    }
    info.hasDate = !!pt;
    info.findings = out.length;
    return { info: info, findings: out };
  }

  function corr(x, y) {
    var n = x.length, mx = 0, my = 0, sxy = 0, sxx = 0, syy = 0;
    for (var i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n;
    for (i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) * (x[i] - mx); syy += (y[i] - my) * (y[i] - my); }
    return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
  }

  /* ---------- API 응답(XML·JSON) 읽기 ---------- */
  var META_KEYS = ['totalCount', 'numOfRows', 'pageNo', 'resultCode', 'resultMsg', 'returnReasonCode', 'returnAuthMsg', 'errMsg', 'currentCount', 'matchCount'];
  function unent(v) {
    return String(v).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, function (m, c) { return String.fromCharCode(+c); }).replace(/&amp;/g, '&').trim();
  }
  function clip(v) { v = String(v); return v.length > 1000 ? v.slice(0, 1000) + '…' : v; } // 긴 본문(HTML 등)은 잘라서 메모리를 아낌
  function toRows(objs) {
    var headers = [], idx = {};
    objs.forEach(function (o) { Object.keys(o).forEach(function (k) { if (!(k in idx)) { idx[k] = headers.length; headers.push(k); } }); });
    return [headers].concat(objs.map(function (o) { return headers.map(function (h) { return o[h] == null ? '' : String(o[h]); }); }));
  }
  function parseXML(text) {
    var meta = {};
    META_KEYS.forEach(function (k) { var m = new RegExp('<' + k + '>([^<]*)</' + k + '>').exec(text); if (m) meta[k] = m[1].trim(); });
    var best = null;
    ['item', 'db', 'row', 'record', 'list', 'data'].forEach(function (tag) {
      var re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'g'), blocks = [], m;
      while ((m = re.exec(text))) if (/<[A-Za-z_]/.test(m[1])) blocks.push(m[1]);
      if (blocks.length && (!best || blocks.length > best.length)) best = blocks;
    });
    if (!best) return { objs: [], meta: meta };
    var objs = best.map(function (b) {
      var o = {}, re = /<([A-Za-z_][\w.\-]*)(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/\1>)/g, m;
      while ((m = re.exec(b))) if (m[1] !== 'script') o[m[1]] = clip(unent(m[2] || ''));
      return o;
    });
    return { objs: objs, meta: meta };
  }
  function parseJSON(text) {
    var j = JSON.parse(text), meta = {}, arr = null;
    (function walk(o, d) {
      if (d > 7 || !o || typeof o !== 'object') return;
      if (Array.isArray(o)) {
        if (o.length && o[0] && typeof o[0] === 'object' && !Array.isArray(o[0]) && (!arr || o.length > arr.length)) arr = o;
        if (o.length) walk(o[0], d + 1); return;
      }
      Object.keys(o).forEach(function (k) {
        if (META_KEYS.indexOf(k) >= 0 && (typeof o[k] !== 'object' || o[k] === null)) meta[k] = String(o[k]);
        else if (k === 'item' && o[k] && typeof o[k] === 'object' && !Array.isArray(o[k]) && !arr) arr = [o[k]];
        walk(o[k], d + 1);
      });
    })(j, 0);
    var objs = (arr || []).map(function (x) {
      var o = {};
      Object.keys(x).forEach(function (k) {
        var v = x[k];
        if (v && typeof v === 'object' && !Array.isArray(v)) Object.keys(v).forEach(function (s2) { o[k + '.' + s2] = v[s2] && typeof v[s2] === 'object' ? JSON.stringify(v[s2]) : v[s2]; });
        else o[k] = Array.isArray(v) ? clip(v.join(', ')) : typeof v === 'string' ? clip(v) : v;
      });
      return o;
    });
    return { objs: objs, meta: meta };
  }
  // CSV가 아니라 API 응답이면 {kind, objs, meta}, 아니면 null
  function parseApi(text) {
    var t = text.replace(/^\uFEFF/, '');
    if (/^\s*[\[{]/.test(t)) { // JSON을 먼저 봄(값 안에 <br> 같은 HTML이 있어도 XML로 착각하지 않게)
      try { var js = parseJSON(t); js.kind = 'JSON'; return js; } catch (e) { /* JSON이 아니면 아래로 */ }
    }
    var lt = t.search(/<[A-Za-z?!]/);
    if (lt >= 0 && lt < 400 && /<\/[A-Za-z_][\w.\-]*>/.test(t.slice(0, 20000))) { var x = parseXML(t); x.kind = 'XML'; return x; }
    return null;
  }
  function apiError(meta) {
    var code = meta.resultCode || meta.returnReasonCode || '';
    if (code && !/^(0+|00|INFO-000|OK)$/i.test(code)) return (meta.resultMsg || meta.returnAuthMsg || meta.errMsg || '') + ' (코드 ' + code + ')';
    return '';
  }

  /* ---------- 파일 하나 검사 ---------- */
  function run(bytes, fileName, R, ref, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8[0] === 0x50 && u8[1] === 0x4B) throw new Error('엑셀(xlsx)이나 압축(zip) 파일입니다. 엑셀에서 ‘CSV(쉼표로 분리)’로 저장하거나 압축을 풀어서 올려 주세요.');
    if (u8[0] === 0xD0 && u8[1] === 0xCF) throw new Error('옛 엑셀(xls) 파일입니다. 엑셀에서 ‘CSV(쉼표로 분리)’로 저장해서 올려 주세요.');
    var dec = decode(u8);
    var api = parseApi(dec.text);
    if (api) {
      var err = apiError(api.meta);
      if (!api.objs.length) throw new Error(err ? 'API가 오류를 돌려줬습니다: ' + err + '. 인증키와 주소를 확인하세요.' : (+api.meta.totalCount > 0 ? 'API가 빈 목록을 돌려줬습니다(전체 ' + fmt(+api.meta.totalCount) + '건, ' + (api.meta.pageNo || '?') + '쪽). pageNo가 너무 크지 않은지 확인하세요.' : api.meta.totalCount === '0' ? 'API가 정상 응답했지만 데이터가 0건입니다(totalCount 0). 기관 쪽에서 데이터를 비웠거나 교체 중일 수 있습니다.' : 'API 응답에서 목록(item)을 찾지 못했습니다.'));
      return runRows(toRows(api.objs), fileName, R, ref, { today: opts.today, t0: t0, encoding: dec.encoding, kind: api.kind, meta: api.meta });
    }
    var rows = parseCSV(dec.text, R.thresholds.max_rows || 300000);
    dec.text = null;
    return runRows(rows, fileName, R, ref, { today: opts.today, t0: t0, encoding: dec.encoding, kind: 'CSV' });
  }

  // 표(머리줄 + 행)를 검사. API 여러 페이지를 합친 표도 여기로 들어옴
  function runRows(rows, fileName, R, ref, opts) {
    opts = opts || {};
    var t0 = opts.t0 || Date.now();
    if (!rows.length) throw new Error('파일이 비어 있습니다.');
    if (rows.length < 2) throw new Error('머리줄(열 이름)만 있고 데이터 행이 없습니다.');
    var isApi = opts.kind && opts.kind !== 'CSV';
    var apiShort = isApi && opts.meta && +opts.meta.totalCount > rows.length - 1;
    var partial = rows.restLines > 0 || apiShort;
    var built = buildTables(rows);
    var T = R.thresholds, findings = [], total = rows.length - 1 + (rows.restLines || 0);
    if (rows.restLines > 0) findings.push(finding('안내', 'low', '앞부분만 검사함',
      '파일이 커서(약 ' + fmt(total) + '행) 앞 ' + fmt(rows.length - 1) + '행만 검사했습니다. 기간 전체가 필요한 검사(기록 공백, 갱신 중단, 연도 범위, 교차 검증)는 건너뛰었습니다.'));
    if (rows[0].length === 1) findings.push(finding('안내', 'medium', '열을 나누지 못함',
      '쉼표·탭으로 나뉜 열을 찾지 못해 열이 1개뿐입니다. CSV 파일이 맞는지, 다른 형식을 확장자만 바꾼 것은 아닌지 확인하세요.'));
    var w = rows[0].length, ragged = 0, ex1 = -1;
    for (var ri = 1; ri < rows.length; ri++) if (rows[ri].length !== w) { ragged++; if (ex1 < 0) ex1 = ri + 1; }
    if (ragged && w > 1) findings.push(finding('A6', ragged / (rows.length - 1) >= 0.01 ? 'medium' : 'low', '열 개수가 맞지 않는 행',
      fmt(ragged) + '행의 칸 수가 머리줄(' + w + '칸)과 다릅니다(처음: ' + fmt(ex1) + '번째 줄). 따옴표 없이 쉼표가 들어간 값(예: 1,234)이 있으면 열이 밀립니다.'));

    // 파일 전체 검사: A8, A6(묶인 칸·섞인 형식)
    if (isApi && opts.meta && +opts.meta.totalCount > total) findings.push(finding('A8', 'medium', 'API 결과 일부만 받음',
      'API는 전체 ' + fmt(+opts.meta.totalCount) + '건이라고 알려 주는데 받은 것은 ' + fmt(total) + '건입니다. 일부만으로는 판단할 수 없어 기간 전체를 보는 검사(기록 공백, 갱신 중단, 교차 검증)는 건너뛰었습니다. numOfRows를 늘리거나 pageNo를 바꿔 모두 받은 뒤 검사하세요.'));
    if (!partial && !isApi && T.truncation_rows.indexOf(total) >= 0) findings.push(finding('A8', 'high', '행 수가 다운로드 한도와 같음',
      '데이터가 정확히 ' + fmt(total) + '행입니다. 다운로드 한도에서 잘려 나머지가 빠졌을 가능성이 큽니다.'));
    if (built.packed) findings.push(finding('A6', 'low', '한 칸에 여러 값이 묶여 있음',
      '‘' + built.packed.column + '’ 칸 하나에 값 ' + built.packed.keyCount + '개가 ‘이름:값’ 형태로 묶여 있어 바로 계산할 수 없습니다. 풀어서 검사했습니다.'));
    if (built.tables.length > 1) findings.push(finding('A6', 'medium', '형식이 다른 기록이 섞여 있음',
      '한 파일에 ' + built.tables.map(function (t) { return '‘' + t.name + '’ ' + fmt(t.rows.length) + '행'; }).join(', ') + '이 섞여 있습니다. 나눠서 검사했습니다.'));

    var ctx = { today: opts.today || Date.now(), multi: built.tables.length > 1, partial: partial, fileName: fileName };
    var tables = built.tables.map(function (t) { var res = checkTable(t, R, ref, ctx); findings = findings.concat(res.findings); return res.info; });

    // A8: 파일 이름의 연도를 다 채우는지
    var fy0 = fileYear(fileName), ym = fy0 ? [fy0, fy0] : null;
    var periods = tables.filter(function (t) { return t.period; });
    if (ym && periods.length && !partial) {
      var lo = periods.map(function (t) { return t.period[0]; }).sort()[0], hi = periods.map(function (t) { return t.period[1]; }).sort().pop();
      var y0 = ym[1] + '-01-01', y1 = ym[1] + '-12-31';
      var a = Math.max(dayIndex(lo), dayIndex(y0)), b = Math.min(dayIndex(hi), dayIndex(y1));
      var span = Math.max(0, b - a + 1), yearDays = dayIndex(y1) - dayIndex(y0) + 1;
      if (span / yearDays < 0.5 && lo.slice(0, 4) <= ym[1] && hi.slice(0, 4) >= ym[1]) findings.push(finding('A8', 'high', '파일 이름의 연도를 다 담지 못함',
        '파일 이름은 ' + ym[1] + '년인데 ' + ym[1] + '년 데이터는 ' + dayFromIndex(a) + ' ~ ' + dayFromIndex(b) + '(' + span + '일)뿐입니다.'));
    }

    var order = { high: 0, medium: 1, low: 2 };
    findings.sort(function (x, y) { return order[x.severity] - order[y.severity]; });
    return { file: fileName, encoding: (opts.kind && opts.kind !== 'CSV' ? 'API ' + opts.kind + ' · ' : '') + opts.encoding, rows: total, tables: tables, findings: findings, ms: Date.now() - t0 };
  }

  /* 열 이름을 보고 함께 맞춰 볼 데이터 추천 (규칙은 data/recommend.json) */
  function recommend(result, RC) {
    var out = [];
    (RC && RC.rules || []).forEach(function (rule) {
      var re = new RegExp(rule.cols, 'i'), hit = [];
      result.tables.forEach(function (t) {
        if (rule.need_date && !t.hasDate) return;
        (t.columnNames || []).forEach(function (c) { if (re.test(c) && hit.indexOf(c) < 0) hit.push(c); });
      });
      if (hit.length) out.push({ id: rule.id, name: rule.name, why: rule.why, url: rule.url, because: hit.slice(0, 4) });
    });
    return out;
  }

  /* trust-card 형식으로 내보내기 (AI·프로그램용) */
  function toTrustCard(result) {
    return {
      schema: 'kspo-trust-card/0.1', checked_at: new Date().toISOString().slice(0, 10),
      datasets: [{ id: 'uploaded-file', name: result.file, rows_checked: result.rows,
        period: result.tables.filter(function (t) { return t.period; }).map(function (t) { return t.period.join(' ~ '); })[0] || null,
        issues: result.findings.map(function (f) { return { rule: f.rule, severity: f.severity, title: f.title, detail: f.detail }; }) }]
    };
  }

  function parseRef(text) { // 참조용 CSV → 객체 배열
    var rows = parseCSV(text.replace(/^﻿/, '')), h = rows[0];
    return rows.slice(1).map(function (r) { var o = {}; h.forEach(function (k, i) { o[k] = r[i]; }); return o; });
  }

  return { decode: decode, parseCSV: parseCSV, parseRef: parseRef, parseApi: parseApi, apiError: apiError, recommend: recommend, toRows: toRows, run: run, runRows: runRows, toTrustCard: toTrustCard, makeMatcher: makeMatcher };
});
