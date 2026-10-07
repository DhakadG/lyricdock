// LyricDock's icon on every *.lyricdock.losthusky.qzz.io Worker (auth, the info site, admin, the web app). The files live
// once, in the web app's public icons (web/public/icons, never behind sign-in); the others link to them and send the
// browser's automatic /favicon.ico (and iOS' /apple-touch-icon.png) there.
const ICONS = 'https://app.lyricdock.losthusky.qzz.io/icons';

export const ICON_LINKS = `<link rel="icon" href="${ICONS}/icon.svg" type="image/svg+xml"><link rel="icon" href="${ICONS}/icon-192.png" sizes="192x192" type="image/png"><link rel="apple-touch-icon" href="${ICONS}/apple-touch-icon.png"><meta name="theme-color" content="#0b0b0e">`;

const PATHS = { '/favicon.ico': 'icon-192.png', '/favicon.svg': 'icon.svg', '/apple-touch-icon.png': 'apple-touch-icon.png', '/apple-touch-icon-precomposed.png': 'apple-touch-icon.png' };

// The icon redirect for an icon path, else null.
export const icon = pathname => Object.hasOwn(PATHS, pathname)
  ? new Response(null, { status: 301, headers: { location: `${ICONS}/${PATHS[pathname]}`, 'cache-control': 'public, max-age=604800' } })
  : null;

// Put the icon links into a page's <head>.
export const withIcon = html => html.replace('</head>', `${ICON_LINKS}\n</head>`);
