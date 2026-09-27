// LyricDock Helper UI (Tauri 2, withGlobalTauri). Pages switch in place; the Rust side does the work.
const invoke = (cmd, args) => window.__TAURI__.core.invoke(cmd, args);
const $ = id => document.getElementById(id);
const toast = (text, bad) => {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' error' : '');
  t.textContent = text;
  $('toasts').append(t);
  setTimeout(() => t.remove(), 3500);
};
if (!document.fonts.check('16px "Segoe Fluent Icons"') && !document.fonts.check('16px "Segoe MDL2 Assets"')) document.body.classList.add('no-fluent');

// ---- navigation
document.querySelectorAll('.nav-item').forEach(b => b.onclick = () => {
  document.querySelectorAll('.nav-item').forEach(x => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current', 'page');
  document.querySelectorAll('.page').forEach(p => { p.hidden = p.id !== `page-${b.dataset.page}`; });
  live(b.dataset.page === 'developer' && $('dev-live').checked);
});
document.addEventListener('click', e => { const u = e.target.closest('[data-url]')?.dataset.url; if (u) invoke('open_url', { url: u }).catch(err => toast(String(err), true)); });

// ---- status
let st = null;
async function refresh() {
  st = await invoke('status');
  const ok = st.spicetify && st.loader_installed && st.enabled;
  const cls = !st.spicetify ? 's-bad' : ok ? 's-ok' : 's-warn';
  $('ring').className = `ring ${cls}`;
  $('ext-badge').className = `badge ${cls}`;
  $('ext-badge').textContent = !st.spicetify ? 'Spicetify missing' : ok ? 'Installed' : st.loader_installed ? 'Not enabled' : 'Not installed';
  $('ext-title').textContent = ok ? 'Ready' : 'Needs attention';
  $('ext-sub').textContent = !st.spicetify ? 'Install Spicetify first, then click Install / repair.'
    : ok ? 'The auto-updating loader is installed and enabled in Spicetify.' : 'Click Install / repair to set it up.';
  $('banner-spicetify').hidden = !!st.spicetify;
  const chip = (k, v) => `<span class="chip">${k} <b>${v}</b></span>`;
  $('chips').innerHTML = chip('Spicetify', st.spicetify ? 'found' : 'missing') + chip('Loader', st.loader_installed ? 'installed' : 'missing')
    + chip('Enabled', st.enabled ? 'yes' : 'no') + (st.dev_copy ? chip('Dev copy', 'present') : '');
  $('st-helper').textContent = `v${st.version}`;
  $('st-auto').textContent = st.autostart ? 'On' : 'Off';
  $('st-adb').textContent = st.adb ? 'Found' : '—';
  $('set-auto').checked = st.autostart;
  $('ab-ver').textContent = st.version; $('ab-spice').textContent = st.spicetify || 'not found';
  $('ab-ext').textContent = st.extensions_dir || '—'; $('ab-adb').textContent = st.adb || 'not installed (not needed)';
  $('btn-link').textContent = st.link_running ? 'Stop' : 'Start';
  $('dev-link-sub').textContent = st.link_running ? 'Running - Spotify reaches the phone over adb too.' : 'Stopped. Points Spotify\'s localhost:8975 at the phone over adb (development path).';
  fetch('https://raw.githubusercontent.com/DhakadG/lyricdock/main/extension/version.json', { cache: 'no-store' })
    .then(r => r.json()).then(j => { $('st-latest').textContent = `v${j.version}`; }).catch(() => { $('st-latest').textContent = 'offline'; });
}
$('btn-refresh').onclick = () => refresh().then(() => toast('Status updated'));
$('btn-install').onclick = () => invoke('install_extension').then(() => toast('Installer opened in a PowerShell window')).catch(e => toast(String(e), true));
$('btn-kiosk').onclick = () => invoke('setup_phone').then(() => toast('Phone setup opened in a PowerShell window')).catch(e => toast(String(e), true));

// ---- settings
$('set-auto').onchange = e => invoke('set_autostart', { on: e.target.checked }).then(() => toast(e.target.checked ? 'Starts with Windows' : 'No longer starts with Windows'))
  .catch(err => { e.target.checked = !e.target.checked; toast(String(err), true); });
const devOn = localStorage.getItem('dev') === '1';
$('set-dev').checked = devOn; $('nav-dev').hidden = !devOn;
$('set-dev').onchange = e => { localStorage.setItem('dev', e.target.checked ? '1' : '0'); $('nav-dev').hidden = !e.target.checked; };

// ---- developer
$('btn-link').onclick = async () => { const run = await invoke('link', { start: !st?.link_running }).catch(e => toast(String(e), true)); st.link_running = run; refresh(); };
$('btn-restart').onclick = () => invoke('phone', { action: 'restart' }).then(() => toast('App restarted on the phone')).catch(e => toast(String(e), true));
let liveT = null;
async function shot() {
  try { const b = await invoke('phone', { action: 'screen' }); $('shot').style.backgroundImage = `url(data:image/png;base64,${b})`; } catch (e) { /* no phone */ }
  try { $('dev-devices').textContent = (await invoke('phone', { action: 'devices' })).split('\n').slice(1).join(' · ') || 'No phone on adb'; } catch (e) { $('dev-devices').textContent = 'adb not found'; }
}
function live(on) { clearInterval(liveT); if (on) { shot(); liveT = setInterval(shot, 2000); } }
$('dev-live').onchange = e => live(e.target.checked);
$('shot').onclick = shot;

$('btn-quit').onclick = () => invoke('quit');
refresh().catch(e => toast(String(e), true));
setInterval(() => refresh().catch(() => {}), 15000);
