/* KSPO API 자동 재검사 — GitHub Actions가 매주 돌립니다.
   data/monitor.json의 API를 한 쪽씩 불러 응답 상태와 전체 건수를 확인하고,
   data/trust.json의 신뢰도 카드에 결과를 적습니다(자동으로 붙인 주의사항은 auto: true).
   인증키는 환경변수(GitHub Secrets)에서만 읽고 파일에 남기지 않습니다.
   시험용: RECHECK_MOCK=<폴더> 이면 실제로 부르지 않고 <폴더>/<dataset>.xml 을 응답으로 씁니다
   (파일 첫 줄이 HTTP 401 이면 401 응답으로 봄). RECHECK_TODAY=YYYY-MM-DD 로 날짜를 고정할 수 있습니다. */
'use strict';
const fs = require('fs');
const path = require('path');
const Checks = require('../checks.js');

const ROOT = path.join(__dirname, '..');
const TRUST = path.join(ROOT, 'data', 'trust.json');
const MONITOR = path.join(ROOT, 'data', 'monitor.json');
const today = process.env.RECHECK_TODAY || new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 날짜
const fmt = (n) => Number(n).toLocaleString('ko-KR');

async function call(api, key) {
  const mock = process.env.RECHECK_MOCK;
  if (mock) {
    const f = path.join(mock, api.dataset + '.xml');
    if (!fs.existsSync(f)) return { status: 0, text: '' };
    const text = fs.readFileSync(f, 'utf8');
    const m = /^HTTP (\d{3})/.exec(text);
    return m ? { status: +m[1], text: text.slice(text.indexOf('\n') + 1) } : { status: 200, text };
  }
  const enc = key.includes('%') ? key : encodeURIComponent(key);
  const url = api.url.replace('{KEY}', enc);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 30000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'kspo-crosscheck-recheck' } });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, text: Checks.decode(buf).text };
  } finally { clearTimeout(t); }
}

// 응답 → { state, total, latest, msg }
function judge(res) {
  if (res.status === 401 || res.status === 403) return { state: 'key_error', msg: '인증키 거절(' + res.status + ')' };
  if (res.status >= 500) return { state: 'down', msg: '서버 오류 HTTP ' + res.status }; // 기관 서버 문제: 카드에 기록
  if (res.status !== 200) return { state: 'error', msg: res.status ? 'HTTP ' + res.status : '응답 없음' };
  const a = Checks.parseApi(res.text);
  if (!a) return { state: 'error', msg: 'XML·JSON 응답이 아님' };
  const err = Checks.apiError(a.meta);
  if (err && !a.objs.length) return { state: 'api_error', msg: err };
  const total = a.meta.totalCount !== undefined ? +a.meta.totalCount : a.objs.length;
  let latest = null;
  a.objs.forEach((o) => Object.keys(o).forEach((k) => {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(o[k] || ''));
    if (m && m[1] < '2100' && (!latest || m[1] > latest)) latest = m[1];
  }));
  return { state: total === 0 ? 'empty' : 'ok', total, latest };
}

function autoIssues(ds, now, prev) {
  const out = [];
  const before = prev && prev.total != null ? fmt(prev.total) + '건(' + (prev.checked_at || '이전 수집') + ')' : null;
  const lastFull = ((prev && prev.history) || []).filter((h) => h.total > 0).pop();
  if (now.state === 'down') {
    out.push({ rule: 'A8', severity: 'medium', title: 'API가 응답하지 않음', auto: true,
      detail: today + ' 자동 확인: 기관 서버가 오류(' + now.msg + ')를 돌려줘 데이터를 받을 수 없었습니다.' +
        (prev && prev.state === 'empty' ? ' 직전 확인(' + prev.checked_at + ')에는 0건이었습니다.' : ''),
      advice: '잠시 뒤 다시 시도하거나, 예시 파일과 보완 데이터를 쓰세요.' });
  } else if (now.state === 'empty') {
    out.push({ rule: 'A8', severity: 'high', title: 'API가 0건을 돌려줌', auto: true,
      detail: today + ' 자동 확인: 정상 응답이지만 전체 건수(totalCount)가 0입니다.' +
        (lastFull ? ' 마지막으로 데이터가 있던 확인은 ' + lastFull.date + '(' + fmt(lastFull.total) + '건)입니다.' : ''),
      advice: '지금은 API로 받을 수 없습니다. 예시 파일과 보완 데이터를 쓰고, 다시 열렸는지 다음 확인을 보세요.' });
  } else if (now.state === 'ok' && prev && prev.state === 'empty') {
    out.push({ rule: 'A8', severity: 'low', title: 'API가 다시 열림', auto: true,
      detail: today + ' 자동 확인: 0건이던 API가 다시 ' + fmt(now.total) + '건을 돌려줍니다' + (prev.checked_at ? '(직전 0건 확인: ' + prev.checked_at + ')' : '') + '.',
      advice: '비어 있던 기간에 받은 결과가 있다면 다시 받으세요.' });
  } else if (now.state === 'ok' && prev && prev.total != null && prev.total !== now.total) {
    const diff = now.total - prev.total;
    out.push({ rule: 'A8', severity: 'low', title: '전체 건수가 바뀜', auto: true,
      detail: today + ' 자동 확인: 전체 건수가 ' + before + '에서 ' + fmt(now.total) + '건으로 ' + (diff > 0 ? fmt(diff) + '건 늘었' : fmt(-diff) + '건 줄었') + '습니다.' +
        (now.latest ? ' 첫 쪽에서 가장 최근 날짜는 ' + now.latest + '입니다.' : ''),
      advice: '새 기록이 실제로 들어왔는지, 같은 기록이 다시 등록된 것인지 확인하세요.' });
  }
  return out;
}

(async () => {
  const trust = JSON.parse(fs.readFileSync(TRUST, 'utf8'));
  const mon = JSON.parse(fs.readFileSync(MONITOR, 'utf8'));
  const order = { high: 0, medium: 1, low: 2 };
  let checked = 0;
  const alerts = [];
  for (const api of mon.apis) {
    let ds = trust.datasets.find((d) => d.id === api.dataset);
    if (!ds) { // monitor.json에 새로 넣은 API: 빈 카드를 만들어 상태부터 확인
      ds = { id: api.dataset, name: api.name || api.dataset, provider: api.provider || '한국체육산업개발(주)',
        source: api.source ? [api.source] : [], url: api.page || '', rows_checked: null, period: null, issues: [], auto_created: today };
      trust.datasets.push(ds);
      console.log('· ' + ds.name + ': 새 카드를 만듦');
    }
    const key = process.env[api.secret];
    if (!key && !process.env.RECHECK_MOCK) { console.log('· ' + ds.name + ': ' + api.secret + ' 키가 없어 건너뜀'); continue; }
    let now;
    try { now = judge(await call(api, key || '')); } catch (e) { now = { state: 'error', msg: e.name === 'AbortError' ? '30초 안에 응답 없음' : e.message }; }
    const prev = ds.monitor || null;
    console.log('· ' + ds.name + ': ' + now.state + (now.total != null ? ' ' + now.total + '건' : '') + (now.msg ? ' (' + now.msg + ')' : ''));
    checked++;
    if (now.state === 'key_error' || now.state === 'error' || now.state === 'api_error') {
      alerts.push(ds.name + ': ' + now.msg + (now.state === 'key_error' ? ' → Settings → Secrets의 ' + api.secret + ' 값을 새 인증키로 바꾸세요.' : ''));
      // 우리 쪽(키·네트워크) 문제일 수 있어 카드 내용은 그대로 두고 확인 기록만 남김
      ds.monitor = Object.assign({}, prev || {}, { last_try: today, last_try_state: now.state, last_try_msg: now.msg });
      continue;
    }
    ds.issues = ds.issues.filter((i) => !i.auto).concat(autoIssues(ds, now, prev));
    ds.issues.sort((x, y) => order[x.severity] - order[y.severity]);
    const hist = ((prev && prev.history) || []).concat([{ date: today, state: now.state, total: now.total }]).slice(-26);
    ds.monitor = { checked_at: today, state: now.state, total: now.state === 'down' ? (prev && prev.total) : now.total, latest: now.latest, history: hist };
  }
  trust.monitored_at = today;
  fs.writeFileSync(TRUST, JSON.stringify(trust, null, 2) + '\n');
  console.log('확인한 API ' + checked + '개, ' + TRUST + ' 저장');
  // 키 오류 등 우리 쪽 문제는 파일로 남겨, 배포가 끝난 뒤 작업을 실패로 표시하게 함(GitHub 실패 알림)
  if (alerts.length && process.env.RECHECK_ALERT_FILE) fs.writeFileSync(process.env.RECHECK_ALERT_FILE, alerts.join('\n') + '\n');
  if (alerts.length) console.log('확인 실패:\n' + alerts.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
