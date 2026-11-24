// Asystent AI (Google Gemini): odpowiada na pytania na czacie - po oznaczeniu bota, w odpowiedzi na jego
// wiadomość, a także sam, gdy ktoś zada pytanie (bez pingowania).
const fs = require('node:fs');
const path = require('node:path');
const { GoogleGenAI } = require('@google/genai');
const { analyzeMessage, isScam } = require('./detector');
const { download } = require('./imageScanner');
const events = require('./events');

const API_KEY = (process.env.GEMINI_API_KEY || '').trim();
const MODEL = (process.env.GEMINI_MODEL || 'gemini-3.8-flash').trim();
// Zapasowe modele: używane, gdy główny jest przeciążony (503), wyczerpał limit (429) albo zniknął (404).
// Na darmowym kluczu każdy model ma osobny limit (ok. 20 pytań dziennie), więc więcej modeli = więcej odpowiedzi.
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.6-flash,gemini-3.7-flash,gemini-3.5-flash,gemini-3.1-flash-lite,gemini-3.5-flash-lite')
  .split(',').map((m) => m.trim()).filter((m) => m && m !== MODEL);
const RETRYABLE = new Set([404, 429, 500, 503, 504]);
const PER_CALL_MS = 25 * 1000; // najdłużej na jedną odpowiedź jednego modelu
const MAX_TOTAL_MS = Number(process.env.GEMINI_MAX_WAIT_MS ?? 45 * 1000); // najdłużej na całe pytanie (wszystkie próby)
const RETRY_ROUNDS = 3; // ile razy przejść całą listę modeli, gdy wszystkie są przeciążone
const RETRY_DELAY_MS = Number(process.env.GEMINI_RETRY_DELAY_MS ?? 3000); // przerwa przed kolejną rundą (3 s, potem 6 s)
// Poziom "myślenia" modelu: LOW = szybciej (wystarcza na FAQ), MINIMAL = najszybciej, puste = domyślny modelu
const THINKING = (process.env.GEMINI_THINKING ?? 'LOW').trim().toUpperCase();
const USE_SEARCH = /^(1|true|tak|yes)$/i.test((process.env.GEMINI_SEARCH || '').trim());

const COOLDOWN_MS = 8 * 1000; // jedno pytanie na 8 s od jednej osoby
const MAX_PENDING = 5; // ile pytań naraz może czekać na odpowiedź
const MAX_HISTORY = 10; // ile wcześniejszych wiadomości z wątku odpowiedzi brać pod uwagę
const MAX_IMAGES = 3;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'image/heif'];
const DISCORD_LIMIT = 1900; // Discord pozwala na 2000 znaków w wiadomości

const gemini = API_KEY ? new GoogleGenAI({ apiKey: API_KEY }) : null;
const lastAsked = new Map(); // userId -> ts
let pending = 0;

const isEnabled = () => Boolean(gemini);

// Pamięć odpowiedzi: to samo pytanie (np. "kiedy pep") nie zużywa ponownie limitu Gemini
const ANSWER_CACHE_MS = 6 * 60 * 60 * 1000; // 6 godzin
const answerCache = new Map(); // znormalizowane pytanie -> { text } albo { skip: true }, + ts

const cacheKey = (q) => q.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function cacheGet(key) {
  const entry = answerCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > ANSWER_CACHE_MS) {
    answerCache.delete(key);
    return null;
  }
  return entry;
}

function cacheSet(key, value) {
  answerCache.set(key, { ...value, ts: Date.now() });
  if (answerCache.size > 500) answerCache.delete(answerCache.keys().next().value);
}

// Zapis do panelu administracyjnego (Pytania -> Zadane pytania)
function logAsked(message, question, { answer: text, error, ...rest }) {
  events.record(error ? 'ai-error' : 'ai', {
    guildId: message.guild?.id ?? message.guildId,
    guildName: message.guild?.name,
    user: message.author?.tag,
    userId: message.author?.id,
    channelId: message.channelId,
    question: String(question || '').slice(0, 500),
    ...(text ? { answer: String(text).slice(0, 2000) } : {}),
    ...(error ? { error: String(error) } : {}),
    ...rest,
  });
}

// Wysyła odpowiedź (podzieloną na kawałki, jeśli jest dłuższa niż limit Discorda)
async function deliver(message, send, text) {
  const [first, ...rest] = splitMessage(text);
  await send(first);
  for (const chunk of rest) {
    await message.channel.send({ content: chunk, allowedMentions: { parse: [] } }).catch(() => {});
  }
}

// Baza wiedzy serwera (plik wiedza.md) - czytana na nowo po każdej zmianie pliku, bez restartu bota
const KNOWLEDGE_FILE = path.join(__dirname, '..', 'wiedza.md');
const MAX_KNOWLEDGE_CHARS = 30000;
let knowledgeCache = { mtime: -1, text: '' };
// Z Supabase bot podaje tu funkcję zwracającą tekst bazy wiedzy z bazy danych (zamiast pliku)
let knowledgeSource = null;
function setKnowledgeSource(fn) {
  knowledgeSource = fn;
}

function knowledge() {
  if (knowledgeSource) {
    const text = String(knowledgeSource() || '').trim().slice(0, MAX_KNOWLEDGE_CHARS);
    if (text !== knowledgeCache.text) {
      knowledgeCache = { mtime: -1, text };
      answerCache.clear(); // baza wiedzy się zmieniła - stare odpowiedzi mogą być nieaktualne
      console.log(`[ai] wczytano bazę wiedzy (${text.length} znaków)`);
    }
    return knowledgeCache.text;
  }
  try {
    const { mtimeMs } = fs.statSync(KNOWLEDGE_FILE);
    if (mtimeMs !== knowledgeCache.mtime) {
      const text = fs.readFileSync(KNOWLEDGE_FILE, 'utf8').trim().slice(0, MAX_KNOWLEDGE_CHARS);
      knowledgeCache = { mtime: mtimeMs, text };
      answerCache.clear(); // baza wiedzy się zmieniła - stare odpowiedzi mogą być nieaktualne
      console.log(`[ai] wczytano bazę wiedzy (${text.length} znaków)`);
    }
  } catch {
    knowledgeCache = { mtime: -1, text: '' };
  }
  return knowledgeCache.text;
}

function systemPrompt(guildName, botName) {
  const base = knowledge();
  return [
    `Jesteś ${botName}, pomocnym asystentem na serwerze Discord „${guildName}”.`,
    'Odpowiadasz w języku, w którym zadano pytanie (domyślnie po polsku).',
    'Odpowiadaj konkretnie i zwięźle - zwykle kilka zdań, maksymalnie ok. 1500 znaków.',
    'Możesz używać formatowania Discorda (pogrubienie, listy, bloki kodu), ale z umiarem.',
    'Nie oznaczaj nikogo (@everyone, @here ani wzmianek użytkowników).',
    'Jeśli czegoś nie wiesz albo informacja może być nieaktualna, powiedz to wprost zamiast zgadywać.',
    'Nigdy nie podawaj linków do "darmowego Nitro", giveawayów, kasyn krypto ani podobnych stron - to typowe scamy.',
    'Nigdy nie proś o hasła, tokeny, kody 2FA ani dane do logowania.',
    `Jesteś ${botName} - nie mów, na jakim modelu AI działasz, i nie wspominaj o Gemini ani Google, nawet jeśli ktoś zapyta.`,
    ...(base ? [
      '',
      'BAZA WIEDZY SERWERA - to najważniejsze źródło informacji:',
      '<<<',
      base,
      '>>>',
      'Na pytania o PEP (wersje, daty wydania, zawartość, różnice) odpowiadaj WYŁĄCZNIE na podstawie bazy wiedzy.',
      'Jeśli odpowiedzi nie ma w bazie wiedzy, powiedz, że nie masz tej informacji i żeby śledzić ogłoszenia na serwerze -',
      'nie wymyślaj dat, cen, linków do pobrania ani funkcji.',
      'WAŻNE: ludzie pytają na różne sposoby, krótko, potocznie, z literówkami i bez polskich znaków.',
      'Dopasowuj pytanie do bazy wiedzy PO SENSIE, a nie po dosłownym brzmieniu. Przykłady:',
      '"co to demo", "czym jest demko", "co daje wersja demo" = pytanie o PEP Demo;',
      '"co w jesieni", "co dodaje wiosna", "jaka roznica demo a pelna" = pytania o PEP Jesień/Wiosna i różnice;',
      '"kiedy premiera", "kiedy wyjdzie", "kiedy bedzie mod" = pytanie o datę wydania PEP.',
      'Na tym serwerze słowa "demo", "jesień", "wiosna", "mod", "pełna wersja" oznaczają wersje PEP.',
    ] : []),
  ].join('\n');
}

/** Czy wiadomość jest pytaniem do bota: wzmianka bota (lub jego roli) albo odpowiedź na jego wiadomość. */
function isQuestion(message, botUser) {
  if (message.mentions.everyone) return false;
  if (message.mentions.users.has(botUser.id)) return true;
  if (message.mentions.repliedUser?.id === botUser.id) return true;
  return message.mentions.roles.some((r) => r.tags?.botId === botUser.id);
}

// --- Automatyczne odpowiedzi (bez oznaczania bota) ---
const SKIP_WORD = 'POMIŃ';
const QUESTION_START = /^(kiedy|jak|czy|co|gdzie|ile|dlaczego|czemu|kto|ktory|ktora|ktore|jaki|jaka|jakie|jakim|po co|skad|o co|w czym|na czym|czym|what|when|how|why|where|who|which|is|are|can|does|do|will)\b/;

const plain = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/ł/g, 'l');

// Słowa kluczowe tematu serwera: stałe + automatycznie z nagłówków pytań w wiedza.md ("## ...").
// Porównujemy po początku słowa, więc "jesien" pasuje też do "jesieni", "demo" do "demka" itd.
const BASE_TOPIC_WORDS = ['pep', 'demo', 'demk', 'jesien', 'wiosn', 'ekstraklas', 'premier'];
// 'mod' tylko jako całe słowo (żeby nie łapać 'moderator', 'model')
const EXACT_TOPIC = /^(mod|moda|modu|modem|modzie|mody|modow|modzik|modzika|modzie)$/;
const STOP_WORDS = new Set(['kiedy', 'czym', 'jest', 'czy', 'jak', 'sie', 'od', 'do', 'oraz', 'albo', 'jaki', 'jaka',
  'jakie', 'ktory', 'ktora', 'ktore', 'gdzie', 'ile', 'dlaczego', 'czemu', 'tego', 'tym', 'ten', 'ta', 'to', 'co',
  'rozni', 'roznica', 'miedzy', 'nowy', 'nowa', 'wersja', 'wersji']);
let topicCache = { source: null, stems: BASE_TOPIC_WORDS };

function topicStems() {
  const base = knowledge();
  if (base === topicCache.source) return topicCache.stems;
  const fromFaq = [...base.matchAll(/^#{2,}\s*(.+)$/gm)]
    .flatMap((m) => plain(m[1]).split(/[^a-z0-9]+/))
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
    .map((w) => w.slice(0, Math.max(4, w.length - 2))); // prosty "rdzeń": jesien -> jesi, wiosna -> wios
  topicCache = { source: base, stems: [...new Set([...BASE_TOPIC_WORDS, ...fromFaq])] };
  return topicCache.stems;
}

/** Czy wiadomość dotyczy tematu z bazy wiedzy (PEP, demo, jesień...). */
function isTopical(text) {
  const stems = topicStems();
  return plain(text).split(/[^a-z0-9]+/).some((w) => w && (EXACT_TOPIC.test(w) || stems.some((s) => w.startsWith(s))));
}

/**
 * Czy bot ma sam odpowiedzieć na wiadomość, w której go nie oznaczono.
 * Tylko wiadomości wyglądające na pytanie (albo o PEP) i nie skierowane do innej osoby.
 */
function shouldAutoAnswer(message, botUser) {
  if (message.mentions.everyone) return false;
  // rozmowa między ludźmi: odpowiedź na wiadomość innej osoby albo oznaczony ktoś inny
  if (message.reference && message.mentions.repliedUser && message.mentions.repliedUser.id !== botUser.id) return false;
  if ([...message.mentions.users.keys()].some((id) => id !== botUser.id)) return false;
  const text = plain((message.content || '').trim());
  if (text.length < 4 || text.length > 600) return false;
  if (/https?:\/\//.test(text)) return false; // linki - to nie pytania
  return /\?\s*$/.test(text) || QUESTION_START.test(text) || isTopical(text);
}

function cleanText(message, botUser) {
  return (message.content || '')
    .replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '')
    .replace(/<@&\d+>/g, (m) => (message.mentions.roles.some((r) => m.includes(r.id) && r.tags?.botId === botUser.id) ? '' : m))
    .trim();
}

// Wcześniejsze wiadomości z wątku odpowiedzi (A odpowiada na B, B na C...), od najstarszej
async function replyChain(message, botUser) {
  const chain = [];
  let current = message;
  while (chain.length < MAX_HISTORY && current.reference?.messageId) {
    const prev = await current.fetchReference().catch(() => null);
    if (!prev) break;
    const who = prev.author.id === botUser.id ? 'Ty (asystent)' : (prev.member?.displayName || prev.author.username);
    const text = cleanText(prev, botUser) || (prev.attachments.size ? '[obrazek]' : '');
    if (text) chain.unshift(`${who}: ${text.slice(0, 1500)}`);
    current = prev;
  }
  return chain;
}

async function imageParts(message) {
  const parts = [];
  for (const att of message.attachments.values()) {
    if (parts.length >= MAX_IMAGES) break;
    const type = (att.contentType || '').split(';')[0];
    if (!IMAGE_TYPES.includes(type) || att.size > MAX_IMAGE_BYTES) continue;
    try {
      const buf = await download(att.url);
      parts.push({ inlineData: { mimeType: type, data: buf.toString('base64') } });
    } catch {
      /* pomijamy obrazek, którego nie da się pobrać */
    }
  }
  return parts;
}

// Dzieli długą odpowiedź na kawałki mieszczące się w limicie Discorda (najlepiej na końcu akapitu / linii)
function splitMessage(text, limit = DISCORD_LIMIT) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > limit) {
    let cut = rest.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = rest.lastIndexOf(' ', limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isTimeout = (err) => ['AbortError', 'TimeoutError'].includes(err?.name) || /aborted|timed? ?out/i.test(String(err?.message));

// Jedno zapytanie z limitem czasu (bez wewnętrznych powtórek biblioteki - powtarzamy sami, z innym modelem).
// Jeśli model nie obsługuje ustawienia "myślenia", ponawia bez niego.
async function callModel(model, request, timeoutMs) {
  const withLimits = (req) => ({
    ...req,
    model,
    config: {
      ...req.config,
      httpOptions: { timeout: timeoutMs, retryOptions: { attempts: 1 } },
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });
  const withThinking = THINKING
    ? { ...request, config: { ...request.config, thinkingConfig: { thinkingLevel: THINKING } } }
    : request;
  try {
    try {
      return await gemini.models.generateContent(withLimits(withThinking));
    } catch (err) {
      if (THINKING && err?.status === 400 && /thinking/i.test(String(err.message))) {
        return await gemini.models.generateContent(withLimits(request));
      }
      throw err;
    }
  } catch (err) {
    // przekroczony czas traktujemy jak przeciążenie - spróbujemy innego modelu
    if (isTimeout(err) && !err.status) throw Object.assign(err, { status: 504 });
    throw err;
  }
}

// Pyta główny model, a gdy jest przeciążony / bez limitu - kolejne zapasowe.
// Gdy wszystkie są przeciążone, czeka chwilę i próbuje jeszcze raz (przeciążenia Gemini zwykle szybko mijają).
async function generate(request) {
  const start = Date.now();
  const timeLeft = () => MAX_TOTAL_MS - (Date.now() - start);
  let lastError = Object.assign(new Error('Gemini nie odpowiedział na czas'), { status: 504 });
  for (let round = 0; round < RETRY_ROUNDS; round++) {
    if (round > 0) {
      if (timeLeft() < RETRY_DELAY_MS * round + 2000) break;
      await sleep(RETRY_DELAY_MS * round);
    }
    let overloaded = false;
    for (const model of [MODEL, ...FALLBACK_MODELS]) {
      if (timeLeft() < 2000) throw lastError; // limit czasu na całe pytanie
      try {
        const response = await callModel(model, request, Math.min(PER_CALL_MS, timeLeft()));
        return { response, model };
      } catch (err) {
        lastError = err;
        if (!RETRYABLE.has(err?.status)) throw err; // np. zły klucz - inny model nie pomoże
        if (err.status >= 500) overloaded = true;
        console.warn(`[ai] ${model} niedostępny (${err.status}), próbuję dalej`);
      }
    }
    // Kolejna runda tylko przy przeciążeniu (503) - przy wyczerpanym limicie (429) ponawianie
    // nic nie da, a tylko zużywa limit jeszcze szybciej
    if (!overloaded) break;
  }
  throw lastError;
}

// Jeden komunikat dla użytkowników przy każdym problemie (bez szczegółów technicznych i nazw usług).
// Dokładna przyczyna (limit, przeciążenie, zły klucz...) trafia tylko do logu bota.
const UNAVAILABLE_MESSAGE = 'Pytanie jest w tej chwili nieosiągalne, spróbuj później.';

/** Odpowiada na pytanie z wiadomości. auto = bot nie był oznaczony (sam zdecydował, że to pytanie). */
async function answer(message, botUser, { auto = false } = {}) {
  const send = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: true } }).catch(() => {});

  // auto = wiadomość bez oznaczenia bota: w razie czegokolwiek bot po prostu milczy (zero spamu)
  if (!gemini) {
    if (auto) return undefined;
    return send(UNAVAILABLE_MESSAGE);
  }
  const question = cleanText(message, botUser);
  if (!question && !message.attachments.size) {
    if (auto) return undefined;
    return send('👋 Cześć! Zadaj mi pytanie, np. `jak działa X?`');
  }

  const last = lastAsked.get(message.author.id) || 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return auto ? undefined : message.react('⏳').catch(() => {});
  }
  if (pending >= MAX_PENDING) {
    return auto ? undefined : send('⏳ Odpowiadam teraz na kilka pytań naraz – spróbuj za chwilę.');
  }
  lastAsked.set(message.author.id, Date.now());
  pending++;

  // "Bot pisze..." do czasu odpowiedzi (w trybie auto nie - bo może zdecydować, że nie odpowie)
  let typing = null;
  if (!auto) {
    await message.channel.sendTyping().catch(() => {});
    typing = setInterval(() => message.channel.sendTyping().catch(() => {}), 8000);
  }

  try {
    knowledge(); // wczytaj zmiany w wiedza.md (czyści też pamięć odpowiedzi)
    const history = await replyChain(message, botUser);

    // To samo pytanie zadane wcześniej (np. "kiedy pep") - odpowiedź z pamięci, bez zużywania limitu Gemini
    const key = !history.length && !message.attachments.size && question ? cacheKey(question) : null;
    const cached = key ? cacheGet(key) : null;
    if (cached && (!cached.skip || auto)) {
      if (cached.skip) return undefined;
      await deliver(message, send, cached.text);
      logAsked(message, question, { answer: cached.text, cached: true, auto });
      console.log(`[ai] z pamięci | ${message.guild.name} | ${message.author.tag} | ${question.slice(0, 60).replace(/\n/g, ' ')}`);
      return undefined;
    }

    const author = message.member?.displayName || message.author.username;
    const prompt = [
      history.length ? `Wcześniejsza rozmowa w tym wątku:\n${history.join('\n')}\n` : '',
      auto
        ? `Wiadomość od ${author} napisana na czacie (NIE oznaczyła cię). Odpowiedz, jeśli to pytanie, na które możesz pomóc `
          + '(zwłaszcza o PEP). Jeśli to rozmowa między ludźmi, pytanie do konkretnej innej osoby, żart, zwykły komentarz '
          + `albo coś, na co nie warto odpowiadać - napisz dokładnie jedno słowo: ${SKIP_WORD}`
          + (isTopical(question)
            ? '\nUWAGA: ta wiadomość zawiera słowa z bazy wiedzy (temat PEP). Jeśli jest choć trochę pytaniem albo prośbą '
              + `o informację - ODPOWIEDZ z bazy wiedzy, nawet gdy jest krótka lub inaczej sformułowana. ${SKIP_WORD} `
              + 'tylko wtedy, gdy to ewidentnie nie pytanie (np. "gram w demo xd").'
            : '')
        : `Pytanie od ${author}:`,
      question || '(użytkownik przesłał tylko obrazek)',
    ].join('\n');

    const { response, model } = await generate({
      contents: [{ role: 'user', parts: [{ text: prompt }, ...(await imageParts(message))] }],
      config: {
        systemInstruction: systemPrompt(message.guild.name, botUser.username),
        ...(USE_SEARCH ? { tools: [{ googleSearch: {} }] } : {}),
      },
    });

    let text = (response.text || '').trim();
    const skipped = !text || plain(text).replace(/[^a-z]/g, '').startsWith('pomin');
    if (auto && skipped) {
      if (key && text) cacheSet(key, { skip: true });
      console.log(`[ai] ${model} | pominięto (nie pytanie do bota): ${question.slice(0, 60).replace(/\n/g, ' ')}`);
      return undefined;
    }
    let cacheable = Boolean(text) && !skipped;
    if (!text) {
      text = response.promptFeedback?.blockReason
        ? '🙅 Nie mogę odpowiedzieć na to pytanie.'
        : '🤔 Nie wiem, co odpowiedzieć – spróbuj zapytać inaczej.';
    }
    // Zabezpieczenie: AI nie może wysłać linku, który nasza ochrona uznałaby za scam
    const check = analyzeMessage(text);
    if (check.riskyHosts.length && isScam(check)) {
      console.warn(`[ai] zablokowano odpowiedź z podejrzanym linkiem: ${check.riskyHosts.join(', ')}`);
      text = '⚠️ Odpowiedź zawierała podejrzany link, więc jej nie wyślę. Spróbuj zapytać inaczej.';
      cacheable = false;
    }
    if (key && cacheable) cacheSet(key, { text });

    await deliver(message, send, text);
    logAsked(message, question, { answer: text, model, auto });
    console.log(`[ai] ${model} | ${message.guild.name} | ${message.author.tag} | ${question.slice(0, 60).replace(/\n/g, ' ')}`);
  } catch (err) {
    console.warn(`[ai] błąd Gemini (${err?.status ?? '?'}): ${String(err?.message).slice(0, 200)}`);
    logAsked(message, question, { error: err?.status ?? 'błąd', auto });
    if (!auto) await send(UNAVAILABLE_MESSAGE);
  } finally {
    if (typing) clearInterval(typing);
    pending--;
  }
  return undefined;
}

module.exports = {
  isEnabled, isQuestion, shouldAutoAnswer, isTopical, answer, setKnowledgeSource, UNAVAILABLE_MESSAGE, clearAnswerCache: () => answerCache.clear(), splitMessage, cleanText, MODEL, FALLBACK_MODELS, USE_SEARCH,
};
