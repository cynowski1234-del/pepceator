// Wbudowana lista znanych obrazków scamu (dHash 64-bit, patrz imageScanner.dHash).
// Działa na każdym serwerze. Obrazki oznaczone przez moderatorów trafiają osobno do data/guilds.json.
// Żeby dodać nowy: node -e "require('./src/imageScanner').dHash(require('fs').readFileSync('plik.png')).then(console.log)"
module.exports = [
  { hash: '2d64a5a4e9a6269e', opis: 'MrBeast - kolaż "kasyno krypto, $2500 bonusu, udana wypłata USDT"' },
];
