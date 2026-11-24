// Whitelista i rangi: pliki whitelist.js / rangi.js + osoby dodane w panelu (Administracja -> Whitelista).
// Używane przez bota (kogo nie sprawdzać) i panel (kto ma dostęp i z jaką rangą).
const { rankInfo } = require('./ranks');

function createTeam({ fileWhitelist, fileRanks, access }) {
  return {
    // whitelista = whitelist.js + każdy dodany w panelu
    whitelist: {
      has: (member, userId) => fileWhitelist.has(member, userId) || access.has(userId ?? member?.id),
      entries: () => fileWhitelist.entries(),
    },
    // rangi = rangi.js + ranga nadana w panelu (liczy się wyższa)
    ranks: {
      rankOf(userId) {
        const a = fileRanks.rankOf(userId);
        const b = rankInfo(access.get(userId)?.rank);
        if (!a) return b;
        if (!b) return a;
        return b.level > a.level ? b : a;
      },
      entries: () => fileRanks.entries(),
    },
  };
}

module.exports = { createTeam };
