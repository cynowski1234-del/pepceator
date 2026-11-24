// Ikony panelu: proste ikony konturowe SVG (24x24), kolor i animacje z CSS (klasa .ico).
const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/>',
  chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.2-4.6A8 8 0 1 1 21 12z"/><path d="M8.5 12h.01M12 12h.01M15.5 12h.01"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 16l-5-5-9 9"/>',
  megaphone: '<path d="M3 10v4a1 1 0 0 0 1 1h3l7 4V5L7 9H4a1 1 0 0 0-1 1z"/><path d="M18 9a3.5 3.5 0 0 1 0 6"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
  book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5M8 7h7M8 11h5"/>',
  star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
  userCheck: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 11l2 2 4-4"/>',
  userLog: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 8h4M17 12h4M17 16h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  logout: '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 8l4 4-4 4M20 12H10"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4"/><circle cx="12" cy="3" r="1"/><path d="M9 14h.01M15 14h.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pulse: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  hash: '<path d="M5 9h14M5 15h14M10 4L8 20M16 4l-2 16"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>',
  sparkles: '<path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8z"/><path d="M19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>',
};

/** Ikona jako <svg>; name z listy ICONS, extra = dodatkowa klasa CSS (np. do animacji). */
function icon(name, extra = '') {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="ico ico-${name}${extra ? ` ${extra}` : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

module.exports = { icon, ICONS };
