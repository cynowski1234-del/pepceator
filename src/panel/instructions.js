// Kategoria "Instrukcje": każdy plik .txt (albo .md) w folderze instrukcje/ to jedna instrukcja w menu panelu.
// Pliki są czytane przy każdym wyświetleniu, więc zmiany widać od razu (bez restartu).
//
// Format pliku (zwykły tekst):
//   # Tytuł instrukcji      -> pierwsza linia: tytuł w menu (może mieć "?", którego nie ma w nazwie pliku)
//   ## Nagłówek             -> nowa karta z nagłówkiem
//   - punkt                 -> punkt listy
//   **pogrubienie**         -> pogrubiony tekst,  `kod` -> wyróżniony tekst
//   pusta linia             -> nowy akapit
// Ikony kart i menu dobierają się same po słowach w tytule (pytania, spam, ochrona, logi, serwer, ważne...).
const fs = require('node:fs');
const path = require('node:path');
const { icon } = require('./icons');

const DEFAULT_DIR = path.join(__dirname, '..', '..', 'instrukcje');
const MAX_SIZE = 200 * 1024;
const TITLE_LINE = /^﻿?#\s+(.+?)\s*$/; // "# Tytuł" (jeden #), także z BOM z Notatnika

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const plain = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');
const slugify = (s) => plain(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'instrukcja';

// Ikona po słowach w tytule / nagłówku
const ICON_RULES = [
  [/wazn|uwag|ostrzez|ograniczen/, 'alert'],
  [/pytan|odpowiedz|faq/, 'question'],
  [/spam|fraz/, 'ban'],
  [/ochron|link|scam/, 'shield'],
  [/log/, 'userLog'],
  [/serwer|server|raport/, 'server'],
  [/rang/, 'star'],
  [/whitelist/, 'userCheck'],
  [/\bai\b|gemini|asystent/, 'sparkles'],
  [/kanal/, 'hash'],
  [/komend/, 'hash'],
  [/widzi|co widac|podglad/, 'search'],
];
const iconFor = (text) => ICON_RULES.find(([re]) => re.test(plain(text)))?.[1] || 'book';
const isImportant = (text) => /wazn|uwag|ostrzez/.test(plain(text));

// --- znaczniki w tekście instrukcji ---
// Rangi: "Pep Creators" (w cudzysłowie, dowolna pisownia) albo PEP CREATOR (wielkimi literami) -> odznaka rangi
const RANK_BADGES = [
  [/pep\s*creators?/i, 'creator', 'PEP CREATOR'],
  [/developers?/i, 'developer', 'DEVELOPER'],
  [/alpha\s*testers?/i, 'tester', 'ALPHA TESTER'],
  [/administrator(?:zy|ów|a)?/i, 'admin', 'ADMINISTRATOR'],
];
const RANK_WORDS = 'pep\\s*creators?|developers?|alpha\\s*testers?|administrator(?:zy|ów|a)?';
const QUOTED_RANK = new RegExp(`(?:&quot;|„|“|”)\\s*(${RANK_WORDS})\\s*(?:&quot;|”|“)`, 'gi');
const CAPS_RANK = /\b(PEP\s*CREATORS?|DEVELOPERS?|ALPHA\s*TESTERS?|ADMINISTRATOR)\b/g;

// Hasztagi -> link do zakładki panelu (jak wzmianka kanału w Discordzie)
const HASHTAG_LINKS = {
  whitelista: ['/panel/administracja/whitelista', 'userCheck'],
  whitelist: ['/panel/administracja/whitelista', 'userCheck'],
  rangi: ['/panel/administracja/rangi', 'star'],
  pulpit: ['/panel', 'dashboard'],
  pytania: ['/panel/pytania', 'question'],
  pytaniaiodpowiedzi: ['/panel/pytania', 'question'],
  edycjapytania: ['/panel/pytania', 'question'],
  edycjapytan: ['/panel/pytania', 'question'],
  frazy: ['/panel/antyspam/frazy', 'ban'],
  zablokowanefrazy: ['/panel/antyspam/frazy', 'ban'],
  antyspam: ['/panel/antyspam/frazy', 'ban'],
  ochrona: ['/panel/antyspam/kanaly', 'shield'],
  kanalyochrony: ['/panel/antyspam/kanaly', 'shield'],
  kanalyochronylinkow: ['/panel/antyspam/kanaly', 'shield'],
  logi: ['/panel/antyspam/logi', 'userLog'],
  logiuzytkownika: ['/panel/antyspam/logi', 'userLog'],
  instrukcje: ['/panel/instrukcje', 'book'],
};
const HASHTAG = /(^|[\s(>])#([\p{L}\p{N}_-]+)/gu;

function inline(s) {
  const tokens = [];
  const keep = (html) => `\u0000${tokens.push(html) - 1}\u0000`; // chroni wstawiony HTML przed kolejnymi zamianami
  const badge = (word) => {
    const [, slug, name] = RANK_BADGES.find(([re]) => re.test(word)) || [];
    return slug ? keep(`<span class="rank rank-${slug}">${name}</span>`) : word;
  };
  return esc(s)
    .replace(QUOTED_RANK, (m, word) => badge(word))
    .replace(CAPS_RANK, (m, word) => badge(word))
    .replace(HASHTAG, (m, pre, tag) => {
      const link = HASHTAG_LINKS[plain(tag).replace(/[^a-z0-9]/g, '')];
      return pre + keep(link
        ? `<a class="tag-chip" href="${link[0]}">${icon(link[1])}<span>#${tag}</span></a>`
        : `<span class="tag-chip">#${tag}</span>`);
    })
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\u0000(\d+)\u0000/g, (m, i) => tokens[Number(i)]);
}

// Tekst -> karty HTML (najpierw escapowanie, potem tylko nasze proste znaczniki)
function render(text, title = '') {
  const cards = [];
  let card = null;
  let list = null;
  let para = [];

  const openCard = (heading) => {
    card = { heading, body: [] };
    cards.push(card);
  };
  const flushPara = () => {
    if (!para.length) return;
    if (!card) openCard(title);
    card.body.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    if (!card) openCard(title);
    card.body.push(`<ul class="guide-list">${list.map((li) => `<li>${inline(li)}</li>`).join('')}</ul>`);
    list = null;
  };

  for (const raw of String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const heading = line.match(/^#{1,3}\s+(.+)$/);
    const bullet = line.match(/^\s*[-*•]\s+(.+)$/);
    if (heading) {
      flushPara(); flushList();
      openCard(heading[1].trim());
    } else if (bullet) {
      flushPara();
      (list ||= []).push(bullet[1]);
    } else if (!line.trim()) {
      flushPara(); flushList();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara(); flushList();

  return cards.map((c) => {
    const important = isImportant(c.heading);
    return `<section class="panel-box guide-card${important ? ' important' : ''}">
  ${c.heading ? `<h2>${icon(iconFor(c.heading))}<span>${inline(c.heading)}</span></h2>` : ''}
  ${c.body.join('\n  ')}
</section>`;
  }).join('\n');
}

function firstLine(text) {
  return String(text).replace(/\r\n/g, '\n').split('\n').find((l) => l.trim()) || '';
}

function titleLine(file) {
  try {
    const m = firstLine(fs.readFileSync(file, 'utf8').slice(0, 2000)).match(TITLE_LINE);
    return m ? m[1].trim().slice(0, 100) : '';
  } catch {
    return '';
  }
}

// treść bez linii z tytułem (tytuł trafia do nagłówka pierwszej karty)
function withoutTitle(text) {
  const lines = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const i = lines.findIndex((l) => l.trim());
  if (i >= 0 && TITLE_LINE.test(lines[i])) lines.splice(i, 1);
  return lines.join('\n');
}

function create(dir = DEFAULT_DIR) {
  // lista instrukcji: pliki .txt/.md posortowane po nazwie (np. "1 Pytania.txt", "2 Anty Spam.txt")
  function list() {
    let files;
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const used = new Set();
    return files
      .filter((f) => f.isFile() && /\.(txt|md)$/i.test(f.name) && !f.name.startsWith('_') && !f.name.startsWith('.'))
      .map((f) => f.name)
      .sort((a, b) => a.localeCompare(b, 'pl', { numeric: true }))
      .map((file) => {
        const title = titleLine(path.join(dir, file))
          || file.replace(/\.(txt|md)$/i, '').replace(/^\d+[\s._-]+/, '').trim() || file;
        let slug = slugify(title);
        while (used.has(slug)) slug += '-2';
        used.add(slug);
        return {
          slug, title, file, icon: iconFor(title),
        };
      });
  }

  function find(slug) {
    const topic = list().find((t) => t.slug === slug);
    if (!topic) return null;
    try {
      const full = path.join(dir, topic.file);
      if (fs.statSync(full).size > MAX_SIZE) {
        return { ...topic, html: '<section class="panel-box"><p class="muted">Plik jest za duży (maks. 200 KB).</p></section>' };
      }
      return { ...topic, html: render(withoutTitle(fs.readFileSync(full, 'utf8')), topic.title) };
    } catch {
      return null;
    }
  }

  return { list, find, dir };
}

module.exports = {
  create, render, iconFor, DEFAULT_DIR,
};
