// Anty Spam: dopasowanie zablokowanych fraz i sprawdzanie, na których kanałach działa blokada.
//
// Zasady dopasowania frazy:
// - wielkość liter, polskie znaki i interpunkcja nie mają znaczenia ("Free Nitro!!!" = "free nitro"),
// - fraza pasuje jako całe słowa ("ok" nie usunie słowa "token"),
// - gwiazdka * łapie dowolną końcówkę słowa ("kurw*" -> "kurwa", "kurwy"...).

const ZERO_WIDTH = /[​-‍⁠﻿­]/g;

function normalize(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(ZERO_WIDTH, '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}*]+/gu, ' ')
    .trim();
}

const regexCache = new Map();
function phraseRegex(phrase) {
  if (regexCache.has(phrase)) return regexCache.get(phrase);
  const words = normalize(phrase).split(' ').filter(Boolean);
  const body = words
    .map((w) => w.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\p{L}\\p{N}]*'))
    .join(' ');
  const re = body ? new RegExp(`(?:^| )${body}(?= |$)`, 'u') : null;
  regexCache.set(phrase, re);
  if (regexCache.size > 2000) regexCache.delete(regexCache.keys().next().value);
  return re;
}

// Kanał wiadomości + kanał nadrzędny (dla wątków), żeby ustawienie kanału działało też w jego wątkach
function channelIdsOf(message) {
  const ids = [message.channelId];
  const parent = message.channel?.parentId;
  if (parent && message.channel?.isThread?.()) ids.push(parent);
  return ids;
}

const appliesTo = (channels, ids) => !channels?.length || ids.some((id) => channels.includes(id));

/** Zwraca pierwszą zablokowaną frazę, która pasuje do treści na tym kanale, albo null. */
function findBlockedPhrase(content, rules, channelIds) {
  const text = normalize(content);
  if (!text) return null;
  for (const rule of rules || []) {
    if (!appliesTo(rule.channels, channelIds)) continue;
    const re = phraseRegex(rule.phrase);
    if (re && re.test(text)) return rule;
  }
  return null;
}

/** Czy na tym kanale działa blokada scam linków (pusta lista = wszystkie kanały). */
const isProtectedChannel = (protectedChannels, channelIds) => appliesTo(protectedChannels, channelIds);

module.exports = {
  normalize, findBlockedPhrase, isProtectedChannel, channelIdsOf,
};
