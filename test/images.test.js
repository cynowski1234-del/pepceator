// Test skanowania obrazków (OCR, QR, hash). Pierwsze uruchomienie pobiera dane OCR - może potrwać.
const test = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const QRCode = require('qrcode');
const img = require('../src/imageScanner');
const { SCAM_THRESHOLD } = require('../src/detector');

const DELETE = SCAM_THRESHOLD; // scam = usunięcie wiadomości

// Obrazek z tekstem (biały tekst na ciemnym tle, jak typowy scam)
async function textImage(lines, { bg = '#111', fg = '#fff' } = {}) {
  const tspans = lines.map((l, i) => `<text x="40" y="${90 + i * 70}" font-size="48" font-family="Arial" font-weight="bold" fill="${fg}">${l}</text>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${120 + lines.length * 70}"><rect width="100%" height="100%" fill="${bg}"/>${tspans}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function check(buffer, text = '') {
  const scan = await img.scanBuffer(buffer);
  return { scan, result: img.evaluate([{ name: 'test.png', ...scan }], text, {}, []) };
}

test.after(() => img.shutdown());

test('MrBeast giveaway na obrazku', { timeout: 180000 }, async () => {
  const { scan, result } = await check(await textImage([
    'MrBeast GIVEAWAY', 'I am giving away $2500 to everyone!', 'Go to mrbeast-gift.xyz', 'Use promo code: BEAST2500',
  ]));
  assert.ok(result.score >= DELETE, `wynik ${result.score}\nOCR: ${scan.text}\n${result.reasons.join('\n')}`);
});

test('Free Nitro na jasnym tle', { timeout: 120000 }, async () => {
  const { scan, result } = await check(await textImage([
    'FREE DISCORD NITRO', 'Claim your gift now:', 'https://discord-nitro-gift.click',
  ], { bg: '#fff', fg: '#222' }));
  assert.ok(result.score >= DELETE, `wynik ${result.score}\nOCR: ${scan.text}\n${result.reasons.join('\n')}`);
});

test('zwykły screenshot nie jest usuwany', { timeout: 120000 }, async () => {
  const { scan, result } = await check(await textImage([
    'gg wp, dobra gra dzisiaj', 'jutro gramy o 20:00 na discord.com', 'mrbeast nowy film jest spoko',
  ]));
  assert.ok(result.score < DELETE, `wynik ${result.score}\nOCR: ${scan.text}\n${result.reasons.join('\n')}`);
});

test('kod QR logowania do Discorda', { timeout: 60000 }, async () => {
  const qr = await QRCode.toBuffer('https://discord.com/ra/abcdefghijklmnopqrstuvwxyz123456', { width: 400 });
  const scaled = await sharp({ create: { width: 900, height: 700, channels: 3, background: '#2b2d31' } })
    .composite([{ input: qr, left: 250, top: 150 }]).png().toBuffer();
  const { result } = await check(scaled);
  assert.strictEqual(result.score, 100, result.reasons.join('\n'));
});

test('ten sam obrazek po przeróbce (JPG, mniejszy) jest rozpoznany', { timeout: 120000 }, async () => {
  const original = await textImage(['MrBeast GIVEAWAY', 'claim $2500 now']);
  const altered = await sharp(original).resize({ width: 700 }).jpeg({ quality: 60 }).toBuffer();
  const h1 = await img.dHash(original);
  const scan = await img.scanBuffer(altered, { withOcr: false });
  const result = img.evaluate([{ name: 'x.jpg', ...scan, text: '' }], '', {}, [h1]);
  assert.strictEqual(result.score, 100, `odległość ${img.hamming(h1, scan.hash)}`);
});

test('inny obrazek nie jest mylony ze znanym scamem', { timeout: 60000 }, async () => {
  const known = await img.dHash(await textImage(['MrBeast GIVEAWAY', 'claim $2500 now']));
  const other = await img.dHash(await textImage(['Zapisy na turniej', 'sobota 18:00', 'nagroda: rola VIP'], { bg: '#1b4d3e' }));
  assert.ok(img.hamming(known, other) > 5, `odległość ${img.hamming(known, other)}`);
});

// Prawdziwy przykład: kolaż "MrBeast kasyno krypto" (rozmazany, mały tekst)
const fs = require('node:fs');
const path = require('node:path');
const FIXTURE = fs.readFileSync(path.join(__dirname, 'fixtures', 'mrbeast-casino.png'));

test('prawdziwy scam MrBeast-kasyno: sam OCR wystarcza do usunięcia', { timeout: 180000 }, async () => {
  const scan = await img.scanBuffer(FIXTURE);
  // podmieniony hash = udajemy, że obrazka nie ma na liście znanych scamów
  const result = img.evaluate([{ name: 'scam.png', ...scan, hash: '0f0f0f0f0f0f0f0f' }], '', {}, []);
  assert.ok(result.score >= DELETE, `wynik ${result.score}\nOCR: ${scan.text}\n${result.reasons.join('\n')}`);
});

test('prawdziwy scam MrBeast-kasyno: rozpoznany z listy znanych także po przeróbce', { timeout: 60000 }, async () => {
  const altered = await sharp(FIXTURE).resize({ width: 800 }).jpeg({ quality: 50 }).toBuffer();
  const scan = await img.scanBuffer(altered, { withOcr: false });
  const result = img.evaluate([{ name: 'x.jpg', ...scan, text: '' }], '', {}, []);
  assert.strictEqual(result.score, 100, result.reasons.join('\n'));
});

// Prawdziwa wiadomość scamera: "@everyone" + 4 osobne zdjęcia (wycięte ze zrzutu ekranu)
test('wiadomość @everyone z 4 osobnymi zdjęciami scamu kasynowego: usunięcie', { timeout: 300000 }, async () => {
  const shot = fs.readFileSync(path.join(__dirname, 'fixtures', 'mrbeast-discord-message.webp'));
  const panels = [[193, 210], [617, 210], [193, 493], [617, 493]];
  const scans = [];
  for (const [i, [left, top]] of panels.entries()) {
    const panel = await sharp(shot).extract({ left, top, width: 413, height: 272 }).png().toBuffer();
    scans.push({ name: `panel${i + 1}.png`, ...(await img.scanBuffer(panel)) });
  }
  const single = Math.max(...scans.map((s) => img.evaluate([s], '@everyone', {}, []).score));
  const result = img.evaluate(scans, '@everyone', {}, []);
  assert.ok(result.score >= DELETE, `razem ${result.score} (najlepsze pojedyncze: ${single})\n${result.reasons.join('\n')}`);
});

test('zrzut ekranu całej wiadomości scamera jest wykrywany', { timeout: 180000 }, async () => {
  const shot = fs.readFileSync(path.join(__dirname, 'fixtures', 'mrbeast-discord-message.webp'));
  const scan = await img.scanBuffer(shot);
  const result = img.evaluate([{ name: 'zrzut.webp', ...scan, hash: '0f0f0f0f0f0f0f0f' }], '', {}, []);
  assert.ok(result.score >= DELETE, `wynik ${result.score}\n${result.reasons.join('\n')}`);
});
