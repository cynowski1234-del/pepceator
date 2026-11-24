// Widoki HTML panelu (renderowane po stronie serwera, bez JavaScriptu w przeglądarce).
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { icon } = require('./icons');

const BRAND = 'PEP Creators';
// Wersja stylu w adresie (/panel.css?v=...): po zmianie CSS przeglądarka od razu pobiera nowy plik
const CSS_VERSION = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, 'panel.css'))).digest('hex').slice(0, 10);

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

// Oficjalne logo Discorda (Clyde)
const DISCORD_LOGO = '<svg class="discord-logo" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"/></svg>';

function page(title, body, { bodyClass = '' } = {}) {
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(title)} · ${BRAND}</title>
<link rel="stylesheet" href="/panel.css?v=${CSS_VERSION}">
</head>
<body class="${bodyClass}">
${body}
</body>
</html>`;
}

function flash({ ok, err }) {
  return (ok ? `<div class="flash ok">${icon('check')}<span>${esc(ok)}</span></div>` : '')
    + (err ? `<div class="flash err">${icon('ban')}<span>${esc(err)}</span></div>` : '');
}

// Kropka statusu (pulsuje, gdy "włączone")
const dot = (on) => `<span class="dot ${on ? 'on' : 'off'}"></span>`;

// ---------- logowanie ----------

function loginPage({ error, configured }) {
  return page('Logowanie', `
<main class="login-wrap">
  <section class="login-card">
    <div class="brand-mark">PEP</div>
    <h1>${BRAND}</h1>
    <p class="muted">Panel zarządzania botem</p>
    ${error ? `<div class="flash err">${icon('ban')}<span>${esc(error)}</span></div>` : ''}
    ${configured
    ? `<a class="discord-btn" href="/login">${DISCORD_LOGO}<span>Zaloguj się przez Discord</span></a>`
    : `<span class="discord-btn disabled">${DISCORD_LOGO}<span>Zaloguj się przez Discord</span></span>
       <p class="hint">Logowanie nie jest skonfigurowane – brak <code>DISCORD_CLIENT_SECRET</code> w pliku .env.</p>`}
  </section>
</main>`, { bodyClass: 'login' });
}

function deniedPage(name) {
  return page('Brak dostępu', `
<main class="login-wrap">
  <section class="login-card">
    <div class="brand-mark">PEP</div>
    <h1>Brak dostępu</h1>
    <p class="muted">${esc(name)}, panel ${BRAND} jest dostępny tylko dla administratorów serwera i osób z rangą PEP CREATOR, DEVELOPER albo ALPHA TESTER.</p>
    <a class="btn" href="/">Wróć</a>
  </section>
</main>`, { bodyClass: 'login' });
}

// ---------- układ panelu ----------

function layout({
  title, active, user, csrf, guilds, content, notice, badge, guides = [], isCreator = false,
}) {
  const isQuestions = active === 'pytania';
  const isAntispam = active.startsWith('antyspam');
  const nav = (key, href, label, ico) => `<a class="${active === key ? 'active' : ''}" href="${href}">${ico ? icon(ico) : ''}<span>${label}</span></a>`;
  return page(title, `
<header class="topbar">
  <div class="brand"><span class="brand-mark small">PEP</span> ${BRAND}</div>
  <div class="user">
    ${user.avatar ? `<img src="${esc(user.avatar)}" alt="" width="28" height="28">` : ''}
    <span>${esc(user.name)}</span>
    ${badge ? `<span class="rank rank-${esc(badge.slug)}">${esc(badge.name)}</span>` : ''}
    <form method="post" action="/logout"><input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="link">${icon('logout')}<span>Wyloguj</span></button></form>
  </div>
</header>
<div class="shell">
  <nav class="sidebar">
    ${nav('pulpit', '/panel', 'Pulpit', 'dashboard')}
    <details class="group" ${active.startsWith('serwer') ? 'open' : ''}>
      <summary>${icon('server')}<span>Serwery</span>${icon('chevron', 'caret')}</summary>
      ${guilds.map((g) => nav(`serwer-${g.id}`, `/panel/serwery/${esc(g.id)}`, esc(g.name))).join('') || '<span class="muted">brak</span>'}
    </details>
    <details class="group" ${isQuestions ? 'open' : ''}>
      <summary>${icon('chat')}<span>Edycja Pytania</span>${icon('chevron', 'caret')}</summary>
      ${nav('pytania', '/panel/pytania', 'Pytania i odpowiedzi', 'edit')}
    </details>
    <details class="group" ${isAntispam ? 'open' : ''}>
      <summary>${icon('shield')}<span>Anty Spam</span>${icon('chevron', 'caret')}</summary>
      ${nav('antyspam-frazy', '/panel/antyspam/frazy', 'Zablokowane frazy', 'ban')}
      ${nav('antyspam-kanaly', '/panel/antyspam/kanaly', 'Kanały ochrony linków', 'link')}
      ${nav('antyspam-logi', '/panel/antyspam/logi', 'Logi użytkownika', 'userLog')}
    </details>
    ${isCreator ? `<details class="group" ${active.startsWith('admin-') ? 'open' : ''}>
      <summary>${icon('lock')}<span>Administracja</span>${icon('chevron', 'caret')}</summary>
      ${nav('admin-whitelist', '/panel/administracja/whitelista', 'Whitelista', 'userCheck')}
      ${nav('admin-rangi', '/panel/administracja/rangi', 'Rangi', 'star')}
    </details>` : ''}
    <details class="group" ${active.startsWith('instrukcje') ? 'open' : ''}>
      <summary>${icon('book')}<span>Instrukcje</span>${icon('chevron', 'caret')}</summary>
      ${guides.map((t) => nav(`instrukcje-${t.slug}`, `/panel/instrukcje/${esc(t.slug)}`, esc(t.title), t.icon || 'book')).join('')
        || nav('instrukcje', '/panel/instrukcje', 'Brak instrukcji')}
    </details>
  </nav>
  <main class="content">
    <h1>${esc(title)}</h1>
    ${flash(notice || {})}
    ${content}
  </main>
</div>`);
}

const TYPE_LABEL = {
  scam: '<span class="badge red">scam</span>',
  spam: '<span class="badge orange">spam</span>',
  phrase: '<span class="badge purple">fraza</span>',
  ai: '<span class="badge blue">odpowiedź AI</span>',
  'ai-error': '<span class="badge gray">AI – błąd</span>',
};

const fmtTime = (ts) => new Date(ts).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw' });

function eventsTable(list) {
  if (!list.length) return '<p class="muted">Na razie brak zdarzeń.</p>';
  return `<table>
<thead><tr><th>Czas</th><th>Serwer</th><th>Typ</th><th>Użytkownik</th><th>Szczegóły</th></tr></thead>
<tbody>${list.map((e) => `<tr>
  <td class="nowrap">${esc(fmtTime(e.ts))}</td>
  <td>${esc(e.guildName || '-')}</td>
  <td>${TYPE_LABEL[e.type] || esc(e.type)}</td>
  <td>${esc(e.user || '-')}</td>
  <td>${esc(e.summary || e.question || '')}</td>
</tr>`).join('')}</tbody></table>`;
}

function dashboard({ status, totals, events }) {
  const card = (ico, label, value, sub = '') => `<div class="card">
  <div class="card-head">${icon(ico)}<span class="label">${label}</span></div>
  <div class="value">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
  return `
<div class="cards">
  ${card('pulse', 'Bot', `${dot(status.online)}${status.online ? 'online' : 'offline'}`, `${esc(status.tag)} · ping ${esc(status.ping)} ms`)}
  ${card('clock', 'Działa od', esc(status.uptime))}
  ${card('server', 'Serwery', esc(status.guilds))}
  ${card('shield', 'Usunięte scamy', esc((totals.scam || 0) + (totals.spam || 0)), `w tym spam: ${esc(totals.spam || 0)}`)}
  ${card('ban', 'Zablokowane frazy', esc(totals.phrase || 0), 'usuniętych wiadomości')}
  ${card('sparkles', 'Odpowiedzi AI', esc(totals.ai || 0), `nieudane: ${esc(totals['ai-error'] || 0)}`)}
  ${card('database', 'Baza phishingu', esc(status.phishing), 'znanych domen scamowych')}
  ${card('bot', 'Asystent AI', `${dot(status.ai)}${status.ai ? 'włączony' : 'wyłączony'}`, status.ai ? 'odpowiada na pytania na czacie' : 'brak klucza w .env')}
</div>
<h2>${icon('pulse')}Ostatnie zdarzenia</h2>
${eventsTable(events)}`;
}

// Animowana lista rozwijana (bez JavaScriptu): każda opcja to przycisk, kliknięcie od razu zapisuje wybór
function dropdown({ action, csrf, name, options, selected }) {
  const current = options.find((o) => o.value === selected) || options[0];
  return `<form method="post" action="${action}" class="dropdown-form">
  <input type="hidden" name="_csrf" value="${esc(csrf)}">
  <details class="dropdown">
    <summary>${current.icon ? icon(current.icon) : ''}<span>${esc(current.label)}</span>${icon('chevron', 'caret')}</summary>
    <div class="dropdown-menu">
      ${options.map((o) => `<button class="opt${o.value === current.value ? ' selected' : ''}" name="${esc(name)}" value="${esc(o.value)}">
        ${o.icon ? icon(o.icon) : ''}<span>${esc(o.label)}</span>${o.value === current.value ? icon('check', 'tick') : ''}</button>`).join('')}
    </div>
  </details>
</form>`;
}

function guildPage({
  guild, csrf, channels, logChannelId, learnedImages, events, canEdit = true,
}) {
  return `
${canEdit ? '' : readOnlyNote('ustawień serwera')}
<section class="panel-box">
  <h2>${icon('megaphone')}Kanał raportów</h2>
  <p class="muted">Tu bot wysyła raport o każdym usuniętym scamie.${canEdit ? ' Kliknij kanał, żeby zapisać.' : ''}</p>
  ${!canEdit ? `<p class="readonly-value">${icon(logChannelId ? 'hash' : 'ban')}<span>${esc(channels.find((c) => c.id === logChannelId)?.name || 'raporty wyłączone')}</span></p>` : dropdown({
    action: `/panel/serwery/${esc(guild.id)}/logi`,
    csrf,
    name: 'channelId',
    selected: logChannelId || '',
    options: [{ value: '', label: 'raporty wyłączone', icon: 'ban' }, ...channels.map((c) => ({ value: c.id, label: c.name, icon: 'hash' }))],
  })}
</section>
<section class="panel-box">
  <h2>${icon('dashboard')}Raport serwera</h2>
  <p class="muted">Raport z całego serwera i lista osób, które wysyłały scam linki (ostatnie 24 godziny).
  Wysyłany automatycznie codziennie o 20:00 na kanał raportów.</p>
  <form method="post" action="/panel/serwery/${esc(guild.id)}/raport">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <button class="btn" ${canEdit && logChannelId ? '' : 'disabled'}>${icon('megaphone')}<span>Wyślij raport teraz</span></button>
    ${logChannelId ? '' : '<span class="muted small">najpierw ustaw kanał raportów</span>'}
  </form>
</section>
<section class="panel-box">
  <h2>${icon('image')}Zapamiętane obrazki scamu</h2>
  <p>Bot pamięta <b>${esc(learnedImages)}</b> obrazków scamu z tego serwera i usuwa ich kopie od razu.</p>
  <form method="post" action="/panel/serwery/${esc(guild.id)}/obrazy-wyczysc">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <button class="btn danger" ${learnedImages && canEdit ? '' : 'disabled'}>${icon('trash')}<span>Zapomnij wszystkie</span></button>
  </form>
</section>
<h2>${icon('pulse')}Ostatnie zdarzenia na tym serwerze</h2>
${eventsTable(events)}`;
}

function questionsPage({ items, csrf, canEdit }) {
  const ro = canEdit ? '' : 'disabled';
  const list = items.map((item, i) => `
<details class="qa">
  <summary>${icon('question')}<span class="q">${esc(item.q)}</span>${icon('chevron', 'caret')}</summary>
  <form method="post" action="/panel/pytania/${i}/zapisz" class="qa-form">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <label>Pytanie<input name="q" value="${esc(item.q)}" maxlength="300" required ${ro}></label>
    <label>Odpowiedź bota<textarea name="a" rows="5" maxlength="4000" required ${ro}>${esc(item.a)}</textarea></label>
    ${canEdit ? `<div class="row">
      <button class="btn">${icon('check')}<span>Zapisz zmiany</span></button>
      <button class="btn danger" formaction="/panel/pytania/${i}/usun">${icon('trash')}<span>Usuń pytanie</span></button>
    </div>` : ''}
  </form>
</details>`).join('');
  return `
<p class="muted">Na te pytania bot odpowiada na czacie (także zadane innymi słowami). Zmiany działają od razu.</p>
${canEdit ? '' : '<div class="flash err">Możesz tylko przeglądać – edycja bazy pytań jest dla administratorów głównego serwera.</div>'}
${list || '<p class="muted">Baza pytań jest pusta.</p>'}
${canEdit ? `
<details class="qa add" ${items.length ? '' : 'open'}>
  <summary>${icon('plus')}<span class="q">Dodaj pytanie</span>${icon('chevron', 'caret')}</summary>
  <form method="post" action="/panel/pytania/dodaj" class="qa-form">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <label>Pytanie<input name="q" maxlength="300" placeholder="np. Gdzie pobrać PEP?" required></label>
    <label>Odpowiedź bota<textarea name="a" rows="5" maxlength="4000" required></textarea></label>
    <button class="btn">${icon('plus')}<span>Dodaj</span></button>
  </form>
</details>` : ''}`;
}

// ---------- Anty Spam ----------

// Przełącznik serwera (gdy administrator zarządza kilkoma)
function guildTabs(guilds, current, basePath) {
  if (guilds.length < 2) return '';
  return `<div class="tabs">${guilds.map((g) => `<a class="${g.id === current.id ? 'active' : ''}" href="${basePath}?serwer=${esc(g.id)}">${esc(g.name)}</a>`).join('')}</div>`;
}

// Wybór kanałów: "wszystkie" albo zaznaczone (działa bez JavaScriptu)
function channelPicker(channels, selected) {
  const all = !selected.length;
  return `
<div class="scope">
  <label class="radio"><input type="radio" name="scope" value="all" ${all ? 'checked' : ''}><span class="mark"></span>Wszystkie kanały</label>
  <label class="radio"><input type="radio" name="scope" value="selected" ${all ? '' : 'checked'}><span class="mark"></span>Tylko zaznaczone kanały:</label>
  <div class="checks">
    ${channels.map((c) => `<label class="check"><input type="checkbox" name="channels" value="${esc(c.id)}" ${selected.includes(c.id) ? 'checked' : ''}><span class="mark"></span>${icon('hash')}<span>${esc(c.name)}</span></label>`).join('') || '<span class="muted">brak kanałów tekstowych</span>'}
  </div>
</div>`;
}

const channelNames = (ids, channels) => (ids.length
  ? ids.map((id) => `#${esc(channels.find((c) => c.id === id)?.name || 'usunięty-kanał')}`).join(', ')
  : '<span class="muted">wszystkie kanały</span>');

function phrasesPage({
  guild, guilds, csrf, rules, channels, canEdit = true,
}) {
  return `
${guildTabs(guilds, guild, '/panel/antyspam/frazy')}
${canEdit ? '' : readOnlyNote('w Anty Spam')}
<p class="muted">Bot usuwa każdą wiadomość, która zawiera zablokowaną frazę. Wielkość liter, polskie znaki i interpunkcja
nie mają znaczenia. Gwiazdka <code>*</code> na końcu słowa łapie odmiany, np. <code>kup*</code> → „kupuj”, „kupcie”.
Wiadomości moderatorów nie są usuwane.</p>

${canEdit ? `<section class="panel-box">
  <h2>${icon('plus')}Dodaj frazę – ${esc(guild.name)}</h2>
  <form method="post" action="/panel/antyspam/${esc(guild.id)}/frazy/dodaj">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <label>Fraza<input name="phrase" maxlength="100" placeholder="np. darmowe konto, kup*" required></label>
    ${channelPicker(channels, [])}
    <button class="btn">${icon('ban')}<span>Zablokuj frazę</span></button>
  </form>
</section>` : ''}

<h2>${icon('ban')}Zablokowane frazy (${rules.length})</h2>
${rules.length ? `<table>
<thead><tr><th>Fraza</th><th>Gdzie działa</th><th></th></tr></thead>
<tbody>${rules.map((r) => `<tr>
  <td><code>${esc(r.phrase)}</code></td>
  <td>${channelNames(r.channels, channels)}</td>
  <td class="nowrap">${canEdit ? `<form method="post" action="/panel/antyspam/${esc(guild.id)}/frazy/${esc(r.id)}/usun">
    <input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn danger small">${icon('trash')}<span>Usuń</span></button></form>` : ''}</td>
</tr>`).join('')}</tbody></table>` : '<p class="muted">Brak zablokowanych fraz.</p>'}`;
}

function channelsPage({
  guild, guilds, csrf, protectedChannels, channels, canEdit = true,
}) {
  return `
${guildTabs(guilds, guild, '/panel/antyspam/kanaly')}
${canEdit ? '' : readOnlyNote('w Anty Spam')}
<p class="muted">Na wybranych kanałach bot sprawdza i usuwa scam linki, podejrzane obrazki i spam z przejętych kont.
Zablokowane frazy mają własne ustawienie kanałów (przy każdej frazie).</p>
<section class="panel-box">
  <h2>${icon('link')}Blokada scam linków – ${esc(guild.name)}</h2>
  <p>Teraz działa na: <b>${channelNames(protectedChannels, channels)}</b></p>
  ${canEdit ? `<form method="post" action="/panel/antyspam/${esc(guild.id)}/kanaly">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    ${channelPicker(channels, protectedChannels)}
    <button class="btn">${icon('check')}<span>Zapisz</span></button>
  </form>` : ''}
</section>`;
}

// Logi użytkownika: komu bot usuwał wiadomości i za co
function userLogsPage({ users, query, total }) {
  const search = `<form method="get" action="/panel/antyspam/logi" class="search">
  ${icon('search')}<input name="q" value="${esc(query)}" placeholder="Szukaj po nazwie lub ID użytkownika" autocomplete="off">
  <button class="btn">Szukaj</button>${query ? '<a class="btn ghost" href="/panel/antyspam/logi">Wyczyść</a>' : ''}
</form>`;
  if (!users.length) {
    return `${search}<p class="muted">${query ? 'Brak wyników dla tego wyszukiwania.' : 'Bot jeszcze nikomu nie usunął wiadomości.'}</p>`;
  }
  const counts = (u) => ['scam', 'spam', 'phrase'].filter((t) => u.counts[t])
    .map((t) => `${TYPE_LABEL[t]}<b>${u.counts[t]}</b>`).join(' ');
  return `${search}
<p class="muted">Użytkownicy, którym bot usunął wiadomości (${esc(users.length)}${total > users.length ? ` z ${esc(total)}` : ''}). Kliknij, żeby zobaczyć historię.</p>
${users.map((u) => `
<details class="qa user-log">
  <summary>${icon('userLog')}
    <span class="q">${esc(u.user)}</span>
    <span class="meta"><code>${esc(u.userId || '-')}</code> · ${counts(u)} · ostatnio ${esc(fmtTime(u.last))}</span>
  </summary>
  <table>
    <thead><tr><th>Czas</th><th>Serwer / kanał</th><th>Typ</th><th>Powód</th><th>Treść wiadomości</th></tr></thead>
    <tbody>${u.events.map((e) => `<tr>
      <td class="nowrap">${esc(fmtTime(e.ts))}</td>
      <td>${esc(e.guildName || '-')}<br><span class="muted">#${esc(e.channelName || '?')}</span></td>
      <td>${TYPE_LABEL[e.type] || esc(e.type)}${e.deleted === false ? '<br><span class="badge gray">nie usunięto</span>' : ''}</td>
      <td>${esc(e.summary || '')}</td>
      <td>${e.content ? `<code class="msg">${esc(e.content)}</code>` : '<span class="muted">(brak tekstu)</span>'}</td>
    </tr>`).join('')}</tbody>
  </table>
</details>`).join('')}`;
}

// Tryb podglądu (ranga bez uprawnień do zmian w danej sekcji)
function readOnlyNote(what) {
  return `<div class="flash info">${icon('lock')}<span>Tryb podglądu – Twoja ranga nie pozwala na zmiany ${esc(what)}.</span></div>`;
}

const PERM_LABELS = [['servers', 'Ustawienia serwerów'], ['questions', 'Edycja Pytania'], ['antispam', 'Anty Spam']];

// Rangi (podgląd; nadawanie rang: Administracja -> Whitelista albo plik rangi.js)
function ranksPage({ ranks, invalid, me }) {
  const yes = `<span class="perm yes">${icon('check')}edycja</span>`;
  const no = `<span class="perm no">${icon('lock')}podgląd</span>`;
  const source = (u) => (u.source === 'panel' ? '<span class="badge blue">panel</span>' : '<span class="badge gray">rangi.js</span>');
  return `
<p class="muted">Rangi dają dostęp do panelu także osobom bez uprawnienia Administratora na serwerze.
Rangę nadaje osoba z rangą PEP CREATOR w zakładce <b>Administracja → Whitelista</b>.</p>
${me ? `<div class="flash ok">${icon('star')}<span>Twoja ranga: <b>${esc(me.name)}</b> – ${esc(me.opis)}.</span></div>` : ''}
${invalid.length ? `<div class="flash err">${icon('ban')}<span>Pominięto w rangi.js: ${invalid.map(esc).join(', ')}</span></div>` : ''}
<section class="panel-box">
  <h2>${icon('star')}Uprawnienia rang</h2>
  <table>
    <thead><tr><th>Ranga</th>${PERM_LABELS.map(([, l]) => `<th>${l}</th>`).join('')}<th>Dodawanie osób</th></tr></thead>
    <tbody>${ranks.map((r) => `<tr>
      <td><span class="rank rank-${esc(r.slug)}">${esc(r.name)}</span></td>
      ${PERM_LABELS.map(([k]) => `<td>${r.perms[k] ? yes : no}</td>`).join('')}
      <td>${r.name === 'PEP CREATOR' ? yes : no}</td>
    </tr>`).join('')}
    <tr><td><span class="rank rank-admin">ADMINISTRATOR</span></td>${PERM_LABELS.map(() => `<td>${yes}</td>`).join('')}<td>${no}</td></tr>
    </tbody>
  </table>
</section>
${ranks.map((r) => `
<section class="panel-box">
  <h2><span class="rank rank-${esc(r.slug)}">${esc(r.name)}</span> <span class="muted small">(${r.users.length})</span></h2>
  ${r.users.length ? `<table><thead><tr><th>Użytkownik</th><th>ID</th><th>Źródło</th></tr></thead><tbody>${r.users.map((u) => `<tr>
    <td>${icon('userCheck')} ${u.found ? esc(u.name) : '<span class="muted">nie znaleziono</span>'}</td><td><code>${esc(u.id)}</code></td><td>${source(u)}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Nikt nie ma tej rangi.</p>'}
</section>`).join('')}`;
}

const RANK_CHOICES = [
  ['PEP CREATOR', 'creator', 'pełny dostęp + dodawanie osób'],
  ['DEVELOPER', 'developer', 'pytania i Anty Spam'],
  ['ALPHA TESTER', 'tester', 'tylko podgląd'],
  ['', 'none', 'bez dostępu do panelu'],
];

// Whitelista: osoby dodane w panelu (PEP CREATOR) + z pliku whitelist.js, role z pliku
function whitelistPage({
  people, roles, invalid, canManage, csrf, myId,
}) {
  const rankBadge = (rank) => (rank
    ? `<span class="rank rank-${esc(RANK_CHOICES.find(([n]) => n === rank)?.[1] || 'admin')}">${esc(rank)}</span>`
    : '<span class="badge gray">tylko whitelista</span>');
  const sourceCell = (p) => (p.source === 'panel'
    ? `<span class="badge blue">panel</span>${p.addedBy ? ` <span class="muted small">dodał(a): ${esc(p.addedBy)}</span>` : ''}`
    : '<span class="badge gray">whitelist.js</span>');
  const removeCell = (p) => {
    if (!canManage || p.source !== 'panel') return '';
    if (p.id === myId) return '<span class="muted small">to Ty</span>';
    return `<form method="post" action="/panel/administracja/whitelista/${esc(p.id)}/usun">
      <input type="hidden" name="_csrf" value="${esc(csrf)}"><button class="btn danger small">${icon('trash')}<span>Usuń</span></button></form>`;
  };
  return `
${invalid.length ? `<div class="flash err">${icon('ban')}<span>Pominięto nieprawidłowe ID w whitelist.js: ${invalid.map(esc).join(', ')}</span></div>` : ''}
${canManage ? `
<section class="panel-box">
  <h2>${icon('plus')}Dodaj osobę</h2>
  <form method="post" action="/panel/administracja/whitelista/dodaj" class="add-person">
    <input type="hidden" name="_csrf" value="${esc(csrf)}">
    <label>Discord ID użytkownika
      <input name="userId" inputmode="numeric" maxlength="25" placeholder="np. 123456789012345678" required autocomplete="off">
    </label>
    <div class="label-like">Ranga</div>
    <div class="rank-picker">
      ${RANK_CHOICES.map(([name, slug, opis], i) => `<label class="radio rank-option">
        <input type="radio" name="rank" value="${esc(name)}" ${i === 1 ? 'checked' : ''}><span class="mark"></span>
        ${name ? `<span class="rank rank-${slug}">${esc(name)}</span>` : '<span class="badge gray">tylko whitelista</span>'}
        <span class="muted small">${esc(opis)}</span></label>`).join('')}
    </div>
    <button class="btn">${icon('plus')}<span>Dodaj osobę</span></button>
  </form>
</section>` : ''}
${people.length ? `<section class="panel-box">
  <h2>${icon('userCheck')}Osoby (${people.length})</h2>
  <table><thead><tr><th>Użytkownik</th><th>ID</th><th>Ranga</th><th>Źródło</th><th></th></tr></thead><tbody>${people.map((p) => `<tr>
    <td>${icon('userCheck')} ${p.found ? esc(p.name) : '<span class="muted">nie znaleziono</span>'}</td>
    <td><code>${esc(p.id)}</code></td>
    <td>${rankBadge(p.rank)}</td>
    <td>${sourceCell(p)}</td>
    <td class="nowrap">${removeCell(p)}</td></tr>`).join('')}</tbody></table>
</section>` : ''}`;
}

// Instrukcja z pliku (html jest już bezpieczny - escapowany w instructions.js)
function instructionsPage(topic, topics) {
  const i = topics.findIndex((t) => t.slug === topic.slug);
  const prev = topics[i - 1];
  const next = topics[i + 1];
  return `<div class="guide">${topic.html || ''}</div>
<div class="row guide-nav">
  ${prev ? `<a class="btn ghost" href="/panel/instrukcje/${prev.slug}">← ${esc(prev.title)}</a>` : ''}
  ${next ? `<a class="btn" href="/panel/instrukcje/${next.slug}">${esc(next.title)} →</a>` : ''}
</div>`;
}

// Brak plików w folderze instrukcje/ - strona zostaje pusta
function noInstructionsPage() {
  return '';
}

module.exports = {
  noInstructionsPage,
  instructionsPage,
  ranksPage,
  whitelistPage,
  esc, loginPage, deniedPage, layout, dashboard, guildPage, questionsPage, phrasesPage, channelsPage, userLogsPage, BRAND,
};
