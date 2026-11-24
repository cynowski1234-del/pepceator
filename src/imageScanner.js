// Skanowanie obrazków: OCR (tekst/linki na zdjęciu), kody QR i pamięć znanych obrazków scamu.
const sharp = require('sharp');
const jsQR = require('jsqr');
const { analyzeMessage, analyzeText } = require('./detector');
const KNOWN_SCAM_IMAGES = require('./knownScamImages');

const MAX_BYTES = 10 * 1024 * 1024; // większych obrazków nie pobieramy
const MAX_IMAGES = 4; // ile obrazków z jednej wiadomości skanować
const MAX_QUEUE = 30; // przy zalewie obrazków pomijamy OCR (hash i QR dalej działają)
const HASH_DISTANCE = 5; // ile bitów (z 64) może się różnić "ten sam" obrazek
const IMAGE_EXT = /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i;
const DISCORD_QR_LOGIN = /discord(?:app)?\.com\/ra\//i;
const BUILTIN_HASHES = KNOWN_SCAM_IMAGES.map((k) => k.hash);

// ---------- OCR (PaddleOCR) ----------
// Model łaciński (angielski + polski). Przy pierwszym uruchomieniu pobiera się (~10 MB)
// do folderu ~/.cache/ppu-paddle-ocr.

let servicePromise = null;
let pending = 0;
let queue = Promise.resolve();

function getOcr() {
  if (!servicePromise) {
    servicePromise = (async () => {
      const P = await import('ppu-paddle-ocr');
      const service = new P.PaddleOcrService({ model: P.V5_LATIN_MOBILE_MODEL });
      await service.initialize();
      console.log('[ocr] gotowe');
      return service;
    })().catch((err) => {
      servicePromise = null;
      throw err;
    });
  }
  return servicePromise;
}

// OCR po kolei (jeden obrazek naraz), żeby nie zapchać procesora
function recognize(png) {
  const job = queue.then(async () => {
    const service = await getOcr();
    const ab = png.buffer.slice(png.byteOffset, png.byteOffset + png.length);
    const result = await service.recognize(ab);
    return result.text || '';
  });
  queue = job.catch(() => {});
  return job;
}

async function ocr(buffer) {
  const base = sharp(buffer).rotate().flatten({ background: '#ffffff' });
  const meta = await sharp(buffer).metadata();
  // małe obrazki powiększamy, ogromne zmniejszamy
  const resized = (meta.width || 0) < 600
    ? base.resize({ width: 1200 })
    : base.resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true });
  const png = await resized.png().toBuffer();
  let text = await recognize(png);

  // Kolaże screenów (typowe dla scamów) mają drobny tekst. Jeśli coś jest podejrzane,
  // czytamy jeszcze każdą ćwiartkę osobno - wtedy OCR widzi więcej.
  const { width, height } = await sharp(png).metadata();
  if (width >= 800 && height >= 500 && analyzeText(normalizeOcrText(text)).score > 0) {
    const w = Math.floor(width / 2);
    const h = Math.floor(height / 2);
    for (const [x, y] of [[0, 0], [w, 0], [0, h], [w, h]]) {
      const tile = await sharp(png).extract({ left: x, top: y, width: w, height: h }).png().toBuffer();
      text += `\n${await recognize(tile)}`;
    }
  }
  return text;
}

// Poprawki typowych błędów OCR w adresach: "site . com" -> "site.com", "https: //" -> "https://"
function normalizeOcrText(text) {
  return text
    .replace(/https?\s*:\s*\/\s*\//gi, (m) => m.replace(/\s+/g, ''))
    .replace(/(\w)\s+\.\s*(\w)/g, '$1.$2')
    .replace(/(\w)\.\s+(com|net|org|gg|io|xyz|ru|gift|gifts|live|site|online|shop|store|pl|me|top|click|link|fun)\b/gi, '$1.$2');
}

// ---------- hash obrazka (dHash 64-bit) ----------

async function dHash(buffer) {
  const px = await sharp(buffer).rotate().grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      bits = (bits << 1n) | (px[y * 9 + x] > px[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, '0');
}

function popcount(n) {
  let c = 0;
  while (n) {
    c += Number(n & 1n);
    n >>= 1n;
  }
  return c;
}

function hamming(a, b) {
  return popcount(BigInt(`0x${a}`) ^ BigInt(`0x${b}`));
}

// Prawie jednolite obrazki (np. czarny kwadrat) mają "pusty" hash - nie nadają się do porównań
function isUsefulHash(hash) {
  const ones = popcount(BigInt(`0x${hash}`));
  return ones >= 8 && ones <= 56;
}

// ---------- QR ----------

async function findQr(buffer) {
  const { data, info } = await sharp(buffer)
    .rotate()
    .resize({ width: 1500, height: 1500, fit: 'inside', withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const code = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return code?.data || null;
}

// ---------- pobieranie i skan ----------

function isImage(att) {
  return att && att.size <= MAX_BYTES
    && (att.contentType?.startsWith('image/') || IMAGE_EXT.test(att.name || ''));
}

// Obrazki wysłane jako link (np. i.imgur.com/abc.png) - Discord robi z nich podgląd typu "image".
// Pobieramy je przez proxy Discorda (images-ext-*.discordapp.net), nie bezpośrednio z obcej strony.
function imageEmbeds(message) {
  return message.embeds
    .filter((e) => e.data?.type === 'image')
    .map((e) => {
      const media = e.thumbnail || e.image;
      let host = 'link';
      try { host = new URL(e.url).hostname; } catch { /* brak */ }
      return { url: media?.proxyURL, name: `link-${host}`, size: 0, contentType: 'image/link' };
    })
    .filter((x) => x.url);
}

function collectImages(message) {
  const list = [...message.attachments.values()];
  if (message.messageSnapshots) {
    for (const snap of message.messageSnapshots.values()) {
      const atts = snap.attachments ?? snap.message?.attachments;
      if (atts) list.push(...atts.values());
    }
  }
  return [...list.filter(isImage), ...imageEmbeds(message)].slice(0, MAX_IMAGES);
}

async function download(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('za duży plik');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('za duży plik');
  return buf;
}

const cache = new Map(); // hash -> { qr, text } (ten sam obrazek nie jest czytany drugi raz)
function remember(hash, value) {
  cache.set(hash, value);
  if (cache.size > 500) cache.delete(cache.keys().next().value);
}

/**
 * Skanuje jeden obrazek (Buffer).
 * @returns {Promise<{ hash: string, qr: string|null, text: string, ocrSkipped: boolean }>}
 */
async function scanBuffer(buffer, { withOcr = true } = {}) {
  const hash = await dHash(buffer);
  const cached = cache.get(hash);
  if (cached && (cached.ocrDone || !withOcr)) return { hash, qr: cached.qr, text: cached.text, ocrSkipped: false };

  const qr = await findQr(buffer).catch(() => null);
  let text = '';
  let ocrSkipped = !withOcr;
  if (withOcr) {
    if (pending >= MAX_QUEUE) {
      ocrSkipped = true;
    } else {
      pending++;
      try {
        text = await ocr(buffer);
      } catch (err) {
        ocrSkipped = true;
        console.warn(`[ocr] błąd: ${err.message}`);
      } finally {
        pending--;
      }
    }
  }
  if (!ocrSkipped) remember(hash, { qr, text, ocrDone: true });
  return { hash, qr, text, ocrSkipped };
}

/** Pobiera i skanuje obrazki z wiadomości. */
async function scanMessage(message, opts = {}) {
  const results = [];
  for (const att of collectImages(message)) {
    try {
      const buf = await download(att.url);
      results.push({ name: att.name || 'obrazek', buffer: buf, ...(await scanBuffer(buf, opts)) });
    } catch (err) {
      console.warn(`[obrazek] ${att.name}: ${err.message}`);
    }
  }
  return results;
}

/**
 * Ocena zeskanowanych obrazków.
 * @param images wynik scanMessage
 * @param messageText treść wiadomości (łączona z tekstem z obrazka)
 * @param ctx kontekst detektora (whitelist/blacklist)
 * @param knownHashes hashe obrazków oznaczonych wcześniej jako scam
 */
function evaluate(images, messageText, ctx, knownHashes = []) {
  const allKnown = [...BUILTIN_HASHES, ...knownHashes];
  let best = { score: 0, reasons: [], riskyHosts: [] };
  const consider = (score, reasons, riskyHosts = []) => {
    if (score > best.score) best = { score: Math.min(100, score), reasons, riskyHosts };
  };

  for (const img of images) {
    const tag = `[obrazek \`${img.name}\`]`;
    if (isUsefulHash(img.hash) && allKnown.some((h) => hamming(h, img.hash) <= HASH_DISTANCE)) {
      consider(100, [`${tag} znany obrazek scamu (+100)`]);
    }
    if (img.qr) {
      if (DISCORD_QR_LOGIN.test(img.qr)) {
        consider(100, [`${tag} kod QR logowania do Discorda - zeskanowanie oddaje konto oszustowi (+100)`]);
      } else {
        const r = analyzeMessage(`${messageText}\n${img.qr}`, ctx);
        consider(r.score + 20, [`${tag} zawiera kod QR prowadzący do: \`${img.qr.slice(0, 100)}\` (+20)`, ...r.reasons], r.riskyHosts);
      }
    }
    if (img.text.trim()) {
      const r = analyzeMessage(`${messageText}\n${normalizeOcrText(img.text)}`, { ...ctx, ocr: true });
      consider(r.score, r.reasons.map((x) => `${tag} ${x}`), r.riskyHosts);
    }
  }

  // Scamerzy dzielą "dowody" na kilka zdjęć (profil MrBeasta, kod bonusowy, wypłata...).
  // Każde z osobna wygląda niewinnie, więc oceniamy też tekst ze wszystkich zdjęć razem.
  const withText = images.filter((i) => i.text.trim());
  if (withText.length > 1) {
    const allText = withText.map((i) => normalizeOcrText(i.text)).join('\n');
    const r = analyzeMessage(`${messageText}\n${allText}`, { ...ctx, ocr: true });
    consider(r.score, r.reasons.map((x) => `[${withText.length} obrazki razem] ${x}`), r.riskyHosts);
  }
  return best;
}

async function shutdown() {
  if (servicePromise) await (await servicePromise.catch(() => null))?.destroy();
}

module.exports = {
  warmup: () => getOcr().catch((e) => console.warn(`[ocr] nie udało się uruchomić: ${e.message}`)),
  download,
  scanMessage,
  scanBuffer,
  evaluate,
  collectImages,
  normalizeOcrText,
  isUsefulHash,
  hamming,
  dHash,
  shutdown,
};
