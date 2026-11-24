// Detektor scam linków. Czysta logika bez zależności od Discorda, więc da się ją testować.
const L = require('./lists');

const ZERO_WIDTH = /[​-‍⁠﻿­᠎]/g;

// Litery z innych alfabetów, które wyglądają jak łacińskie (np. cyrylickie "а")
const HOMOGLYPHS = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j',
  'ѕ': 's', 'ԁ': 'd', 'ɡ': 'g', 'ӏ': 'l', 'һ': 'h', 'ԛ': 'q', 'ԝ': 'w', 'ο': 'o', 'α': 'a',
  'ν': 'v', 'κ': 'k', 'ρ': 'p', 'τ': 't', 'ι': 'i', 'ı': 'i', 'ł': 'l',
};
const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '!': 'i' };

const URL_RE = /\b(?:https?:\/\/)?(?:(?:[\p{L}\p{N}](?:[\p{L}\p{N}-]{0,61}[\p{L}\p{N}])?\.)+\p{L}{2,63}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})?(?:[/?#][^\s<>"'`()[\]]*)?/giu;
const MASKED_LINK_RE = /\[([^\]]{1,300})\]\(\s*<?(https?:\/\/[^\s)>]+)>?\s*\)/gi;
const IP_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const MONEY_RE = /(?:[$€£]\s?\d[\d,.]*\d)|(?:\d[\d,.]*\d\s?(?:[$€£]|usd\b|usdt\b|eur\b|zl\b|pln\b))/;

function cleanText(text) {
  return String(text || '').normalize('NFKC').replace(ZERO_WIDTH, '');
}

function replaceHomoglyphs(text) {
  return [...text].map((c) => HOMOGLYPHS[c] || c).join('');
}

// małe litery, bez polskich ogonków i homoglifów
function plainLower(text) {
  return replaceHomoglyphs(cleanText(text).toLowerCase())
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

function leet(text) {
  return [...text].map((c) => LEET[c] || c).join('');
}

// Zamiana znaków, które scamerzy podmieniają w domenach (dlscord, discorcl, rn -> m ...)
function confusable(s) {
  return s
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/cl/g, 'd')
    .replace(/[l1|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/3/g, 'e')
    .replace(/5/g, 's');
}

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

function normalizeDomain(input) {
  let d = String(input || '').trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/\.+$/, '');
  if (d.startsWith('www.')) d = d.slice(4);
  try {
    d = new URL(`http://${d}`).hostname;
  } catch {
    /* zostaw jak jest */
  }
  return d;
}

function splitDomain(host) {
  const labels = host.split('.');
  const last2 = labels.slice(-2).join('.');
  const suffixLen = labels.length > 2 && L.MULTI_PART_SUFFIXES.has(last2) ? 2 : 1;
  const suffix = labels.slice(-suffixLen).join('.');
  const registrable = labels.slice(-(suffixLen + 1)).join('.');
  const label = labels.length > suffixLen ? labels[labels.length - suffixLen - 1] : host;
  const hostNoSuffix = labels.slice(0, labels.length - suffixLen).join('.');
  return { tld: labels[labels.length - 1], suffix, registrable, label, hostNoSuffix };
}

const SAFE_SET = new Set(L.SAFE_DOMAINS);
const SHORTENER_SET = new Set(L.URL_SHORTENERS);
const IP_LOGGER_SET = new Set(L.IP_LOGGERS);

// Czy host (lub jego domena nadrzędna) jest w zbiorze. `sets` = Set albo tablica Setów.
function inDomainSet(host, sets) {
  const list = [].concat(sets || []).filter((s) => s && s.size);
  if (!list.length) return false;
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    if (list.some((s) => s.has(candidate))) return true;
  }
  return false;
}

function extractLinks(text) {
  const cleaned = cleanText(text);
  const out = new Map();
  for (const match of cleaned.matchAll(URL_RE)) {
    let raw = match[0].replace(/[.,!?;:*_~]+$/, '');
    const hasScheme = /^https?:\/\//i.test(raw);
    let url;
    try {
      url = new URL(hasScheme ? raw : `http://${raw}`);
    } catch {
      continue;
    }
    const host = url.hostname.replace(/\.+$/, '').replace(/^www\./, '');
    if (!host.includes('.')) continue;
    if (!hasScheme) {
      // Bez http:// akceptujemy tylko sensowne końcówki (żeby "plik.txt" nie był linkiem)
      const tld = host.split('.').pop();
      if (!IP_RE.test(host) && !L.BARE_DOMAIN_TLDS.has(tld) && !tld.startsWith('xn--')) continue;
    }
    if (!out.has(host)) out.set(host, { host, url, raw });
  }
  return [...out.values()];
}

function findInvites(links) {
  const codes = [];
  for (const { host, url } of links) {
    const path = url.pathname.replace(/^\/+/, '');
    if (host === 'discord.gg' && path) codes.push(path.split('/')[0]);
    if (['discord.com', 'discordapp.com'].includes(host) && path.startsWith('invite/')) {
      codes.push(path.split('/')[1]);
    }
  }
  return codes.filter(Boolean);
}

/**
 * Ocena pojedynczej domeny.
 * @returns {{ host, safe: boolean, score: number, reasons: string[] }}
 */
function analyzeDomain(host, ctx = {}) {
  const res = { host, safe: false, score: 0, reasons: [] };
  const add = (pts, reason) => {
    res.score += pts;
    res.reasons.push(`${reason} (+${pts})`);
  };

  if (inDomainSet(host, ctx.blacklist)) {
    add(100, `\`${host}\` jest na czarnej liście`);
    res.score = 100;
    return res;
  }
  if (inDomainSet(host, [SAFE_SET].concat(ctx.safe || []))) {
    res.safe = true;
    return res;
  }
  if (IP_RE.test(host)) {
    add(40, 'link do adresu IP zamiast domeny');
    return res;
  }

  const { tld, label, hostNoSuffix } = splitDomain(host);
  const labelFlat = label.replace(/-/g, '');
  const hostFlat = confusable(hostNoSuffix.replace(/[.-]/g, ''));

  if (inDomainSet(host, IP_LOGGER_SET)) {
    add(70, `\`${host}\` to IP-logger (zapisuje adres IP osoby, która kliknie)`);
  }
  if (inDomainSet(host, SHORTENER_SET)) {
    add(30, `skracacz linków \`${host}\` ukrywa prawdziwy adres`);
  }
  if (host.split('.').some((p) => p.startsWith('xn--'))) {
    add(50, 'domena z podmienionymi znakami (homoglify / punycode)');
  }

  let brandHit = false;
  for (const brand of L.LOOKALIKE_BRANDS) {
    if (labelFlat.length < 5) break;
    if (labelFlat === brand) {
      if (L.EXACT_BRAND_ABUSE.includes(brand)) {
        add(80, `podszywa się pod **${brand}** (nieoficjalna domena)`);
        brandHit = true;
      }
      break;
    }
    // Tekst z OCR ma naturalne literówki (discord -> dlscord), więc tam tego nie sprawdzamy
    if (ctx.ocr) continue;
    const maxDist = brand.length >= 10 ? 2 : 1;
    if (levenshtein(labelFlat, brand) <= maxDist || confusable(labelFlat) === confusable(brand)) {
      add(90, `literówka w domenie - podróbka **${brand}**`);
      brandHit = true;
      break;
    }
  }

  if (!brandHit) {
    const brand = L.BRANDS_IN_DOMAIN.find((b) => hostFlat.includes(confusable(b)));
    if (brand) add(45, `nazwa marki **${brand}** w obcej domenie`);
  }

  const words = L.SCAM_WORDS_IN_DOMAIN.filter((w) => hostFlat.includes(w));
  if (words.length) add(Math.min(40, words.length * 20), `podejrzane słowa w domenie: ${words.join(', ')}`);

  if (L.SUSPICIOUS_TLDS.includes(tld)) add(15, `podejrzana końcówka domeny .${tld}`);

  res.score = Math.min(100, res.score);
  return res;
}

function analyzeText(content) {
  const raw = cleanText(content);
  const plain = plainLower(raw);
  const leeted = leet(plain);
  const flat = leeted.replace(/[^a-z]/g, '');
  const reasons = [];
  let score = 0;
  const add = (pts, reason) => {
    score += pts;
    reasons.push(`${reason} (+${pts})`);
  };

  if (flat.includes('mrbeast')) add(40, 'wzmianka o MrBeast (najczęstszy motyw scamów)');
  for (const [re, pts, label] of L.TEXT_RULES) {
    if (re.test(plain) || re.test(leeted)) add(pts, label);
  }
  if (MONEY_RE.test(plain)) add(15, 'kwota pieniędzy');
  if (/@(everyone|here)\b/i.test(raw)) add(20, 'ping @everyone / @here');

  // Sam tekst bez linku to słabszy dowód (max 60),
  // chyba że naraz pasuje wiele cech scamu - wtedy max 90.
  return { score: Math.min(reasons.length >= 5 ? 90 : 60, score), reasons };
}

function maskedLinkMismatch(content) {
  const reasons = [];
  for (const m of cleanText(content).matchAll(MASKED_LINK_RE)) {
    const shown = extractLinks(m[1]);
    if (!shown.length) continue;
    let real;
    try {
      real = splitDomain(new URL(m[2]).hostname.replace(/^www\./, '')).registrable;
    } catch {
      continue;
    }
    for (const s of shown) {
      if (splitDomain(s.host).registrable !== real) {
        reasons.push(`link udaje \`${s.host}\`, a prowadzi do \`${real}\``);
      }
    }
  }
  return reasons;
}

/**
 * Główna funkcja: ocenia treść wiadomości.
 * @param {string} content
 * @param {{ safe?: Set<string>|Set<string>[], blacklist?: Set<string>|Set<string>[] }} ctx
 *   safe = dodatkowe zaufane domeny (wbudowane są zawsze), blacklist = zablokowane domeny,
 *   ocr = true gdy tekst pochodzi z rozpoznawania obrazka (łagodniejsze sprawdzanie literówek)
 */
function analyzeMessage(content, ctx = {}) {
  const links = extractLinks(content);
  const domains = links.map((l) => analyzeDomain(l.host, ctx));
  const risky = domains.filter((d) => !d.safe);
  const text = analyzeText(content);
  const masked = maskedLinkMismatch(content);

  const reasons = [];
  let score;
  if (!links.length) {
    score = text.score;
  } else if (!risky.length) {
    // tylko zaufane linki (np. YouTube) - tekst liczy się w połowie
    score = Math.floor(text.score / 2);
  } else {
    const worst = risky.reduce((a, b) => (b.score > a.score ? b : a));
    score = worst.score + text.score;
    for (const d of risky) if (d.score) reasons.push(...d.reasons);
  }
  if (masked.length) {
    score += 60;
    reasons.push(...masked.map((r) => `${r} (+60)`));
  }
  if (score > 0) reasons.push(...text.reasons);

  return {
    score: Math.min(100, score),
    reasons,
    hosts: links.map((l) => l.host),
    riskyHosts: risky.filter((d) => d.score > 0).map((d) => d.host),
    unsafeHosts: risky.map((d) => d.host), // wszystkie domeny spoza listy zaufanych
    invites: findInvites(links),
    shortLinks: links.filter((l) => inDomainSet(l.host, SHORTENER_SET)).map((l) => l.url.href),
  };
}

// Wewnętrzna granica: od tylu "dowodów" wiadomość jest scamem (-> usunięcie wiadomości).
// Nie jest to skala dla użytkownika - na zewnątrz bot mówi tylko: scam albo nie.
const SCAM_THRESHOLD = 60;
const isScam = (result) => (result?.score ?? 0) >= SCAM_THRESHOLD;

// Powody bez wewnętrznych punktów - do raportów i komend
const displayReasons = (reasons) => (reasons || []).map((r) => r.replace(/\s*\(\+\d+\)\s*$/, ''));

module.exports = {
  analyzeMessage,
  SCAM_THRESHOLD,
  isScam,
  displayReasons,
  isShortener: (host) => inDomainSet(host, SHORTENER_SET),
  analyzeDomain,
  analyzeText,
  extractLinks,
  normalizeDomain,
  splitDomain,
  levenshtein,
  cleanText,
};
