// Music-video background wrapper (the web twin of PageClient.java): an https page around YouTube's player, so the
// embed gets a real referrer; postMessage commands from the app are passed through. A file, not inline: the CSP
// (_headers) allows scripts from this site only.
const q = new URLSearchParams(location.search), id = /^[\w-]{11}$/.test(q.get('v') || '') ? q.get('v') : '', t = /^\d{1,6}$/.test(q.get('t') || '') ? q.get('t') : '0';
document.getElementById('p').src = `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=1&controls=0&disablekb=1&fs=0&loop=1&playlist=${id}`
  + `&playsinline=1&rel=0&iv_load_policy=3&enablejsapi=1&origin=${encodeURIComponent(location.origin)}&start=${t}`;
addEventListener('message', e => { if (e.source === parent) document.getElementById('p').contentWindow.postMessage(e.data, '*'); });
