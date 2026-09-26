// Drive the phone app's WebView over Chrome DevTools Protocol (adb forward tcp:9333 -> webview_devtools_remote_<pid>).
// node scripts/cdp.mjs eval "<js expression>"      -> prints the result
// node scripts/cdp.mjs shot out.png                -> screenshot of the page
const [, , cmd, arg] = process.argv;
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const ws = new WebSocket(list.find(p => p.url.includes('android_asset')).webSocketDebuggerUrl);
let id = 0;
const call = (method, params = {}) => new Promise((res, rej) => {
  const my = ++id;
  const on = e => { const m = JSON.parse(e.data); if (m.id !== my) return; ws.removeEventListener('message', on); m.error ? rej(new Error(m.error.message)) : res(m.result); };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id: my, method, params }));
});
await new Promise(r => ws.addEventListener('open', r));
if (cmd === 'eval') {
  const r = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true });
  console.log(r.exceptionDetails ? 'ERROR: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text) : JSON.stringify(r.result.value));
} else if (cmd === 'shot') {
  const r = await call('Page.captureScreenshot', { format: 'png' });
  (await import('node:fs')).writeFileSync(arg, Buffer.from(r.data, 'base64'));
  console.log('saved', arg);
}
ws.close();
