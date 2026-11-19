/* 큰 파일을 검사하는 동안 화면이 멈추지 않도록 검사를 따로 돌립니다. */
importScripts('checks.js');
self.onmessage = function (e) {
  var d = e.data;
  try {
    var res = self.Checks.run(d.buf, d.name, d.rules, d.ref);
    self.postMessage({ ok: true, res: res });
  } catch (err) {
    self.postMessage({ ok: false, msg: err && err.message ? err.message : String(err) });
  }
};
