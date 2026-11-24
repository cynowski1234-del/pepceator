// Testy asystenta AI z podstawionym (fałszywym) Gemini - bez sieci i bez klucza API.
const test = require('node:test');
const assert = require('node:assert');

// Podstawiamy klasę GoogleGenAI, zanim src/ai.js ją wczyta
const calls = [];
let nextResponse = () => ({ text: 'Odpowiedź testowa.' });
const genai = require('@google/genai');
genai.GoogleGenAI = class {
  constructor() {
    this.models = {
      generateContent: async (req) => {
        calls.push(req);
        return nextResponse(req);
      },
    };
  }
};
process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_RETRY_DELAY_MS = '0'; // bez czekania w testach
process.env.GEMINI_MAX_WAIT_MS = '3000'; // krótki limit czasu w testach
const ai = require('../src/ai');

test.beforeEach(() => ai.clearAnswerCache());

const BOT = { id: '999', username: 'PEP BOT' };

function fakeMessage(content, { mentionBot = true, replyTo = null, userId = `u${Math.random()}` } = {}) {
  const sent = [];
  const channel = {
    sendTyping: async () => {},
    send: async (m) => sent.push(['send', m]),
  };
  return {
    sent,
    content,
    author: { id: userId, username: 'janek', tag: 'janek#1' },
    member: { displayName: 'Janek' },
    guild: { name: 'Testowy serwer' },
    channel,
    attachments: new Map(),
    reference: replyTo ? { messageId: replyTo.id } : null,
    fetchReference: async () => replyTo,
    mentions: {
      everyone: false,
      users: new Map(mentionBot ? [[BOT.id, BOT]] : []),
      repliedUser: replyTo?.author ?? null,
      roles: { some: () => false },
    },
    reply: async (m) => sent.push(['reply', m]),
    react: async (e) => sent.push(['react', e]),
  };
}

test('wykrywa pytanie: wzmianka bota albo odpowiedź na jego wiadomość', () => {
  assert.ok(ai.isQuestion(fakeMessage('<@999> hej'), BOT));
  assert.ok(!ai.isQuestion(fakeMessage('zwykła rozmowa', { mentionBot: false }), BOT));
  const botMsg = { id: 'b1', author: BOT, content: 'poprzednia odpowiedź', attachments: new Map() };
  assert.ok(ai.isQuestion(fakeMessage('a dlaczego?', { mentionBot: false, replyTo: botMsg }), BOT));
  const everyone = fakeMessage('<@999> @everyone');
  everyone.mentions.everyone = true;
  assert.ok(!ai.isQuestion(everyone, BOT), '@everyone nie uruchamia AI');
});

test('odpowiada na pytanie, bez pingowania nikogo', async () => {
  const msg = fakeMessage('<@999> jak działa fotosynteza?');
  await ai.answer(msg, BOT);
  const [kind, payload] = msg.sent[0];
  assert.strictEqual(kind, 'reply');
  assert.strictEqual(payload.content, 'Odpowiedź testowa.');
  assert.deepStrictEqual(payload.allowedMentions.parse, []);
  const req = calls.at(-1);
  assert.strictEqual(req.model, ai.MODEL);
  assert.match(req.contents[0].parts[0].text, /jak działa fotosynteza\?/);
  assert.doesNotMatch(req.contents[0].parts[0].text, /<@999>/, 'wzmianka bota usunięta z pytania');
  assert.match(req.config.systemInstruction, /Testowy serwer/);
});

test('pamięta wcześniejszą rozmowę z wątku odpowiedzi', async () => {
  const q1 = { id: 'q1', author: { id: 'u1', username: 'janek' }, member: { displayName: 'Janek' }, content: '<@999> stolica Francji?', attachments: new Map(), reference: null };
  const a1 = { id: 'a1', author: BOT, content: 'Paryż.', attachments: new Map(), reference: { messageId: 'q1' }, fetchReference: async () => q1 };
  const msg = fakeMessage('a ile ma mieszkańców?', { mentionBot: false, replyTo: a1 });
  await ai.answer(msg, BOT);
  const prompt = calls.at(-1).contents[0].parts[0].text;
  assert.match(prompt, /Janek: stolica Francji\?/);
  assert.match(prompt, /Ty \(asystent\): Paryż\./);
  assert.match(prompt, /a ile ma mieszkańców\?/);
});

test('długa odpowiedź jest dzielona na kilka wiadomości (limit Discorda)', async () => {
  nextResponse = () => ({ text: Array.from({ length: 60 }, (_, i) => `Akapit ${i} `.repeat(8)).join('\n\n') });
  const msg = fakeMessage('<@999> opowiedz długo');
  await ai.answer(msg, BOT);
  assert.ok(msg.sent.length > 1, 'więcej niż jedna wiadomość');
  for (const [, m] of msg.sent) assert.ok(m.content.length <= 2000, `kawałek ma ${m.content.length} znaków`);
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('limit: ta sama osoba nie może pytać co sekundę', async () => {
  const a = fakeMessage('<@999> pytanie 1', { userId: 'spammer' });
  const b = fakeMessage('<@999> pytanie 2', { userId: 'spammer' });
  await ai.answer(a, BOT);
  await ai.answer(b, BOT);
  assert.deepStrictEqual(b.sent, [['react', '⏳']]);
});

test('błąd limitu Gemini (429) daje czytelny komunikat', async () => {
  nextResponse = () => { throw Object.assign(new Error('Resource exhausted'), { status: 429 }); };
  const msg = fakeMessage('<@999> cokolwiek');
  await ai.answer(msg, BOT);
  assert.strictEqual(msg.sent[0][1].content, ai.UNAVAILABLE_MESSAGE);
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('AI nie wyśle scam linku, nawet gdyby go wygenerowało', async () => {
  nextResponse = () => ({ text: 'Odbierz darmowe nitro tutaj: https://discorcl.gift/free' });
  const msg = fakeMessage('<@999> gdzie darmowe nitro?');
  await ai.answer(msg, BOT);
  assert.match(msg.sent[0][1].content, /podejrzany link/);
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('splitMessage nie gubi treści', () => {
  const text = 'abc '.repeat(1500);
  const parts = ai.splitMessage(text);
  assert.ok(parts.every((p) => p.length <= 1900));
  assert.strictEqual(parts.join(' ').replace(/\s+/g, ' ').trim(), text.trim());
});

test('gdy główny model jest przeciążony (503), odpowiada model zapasowy', async () => {
  const used = [];
  nextResponse = (req) => {
    used.push(req.model);
    if (req.model === ai.MODEL) throw Object.assign(new Error('high demand'), { status: 503 });
    return { text: `Odpowiedź z ${req.model}` };
  };
  const msg = fakeMessage('<@999> test zapasowego modelu');
  await ai.answer(msg, BOT);
  assert.deepStrictEqual(used, [ai.MODEL, ai.FALLBACK_MODELS[0]]);
  assert.strictEqual(msg.sent[0][1].content, `Odpowiedź z ${ai.FALLBACK_MODELS[0]}`);
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('przy przeciążeniu wszystkich modeli bot ponawia całą listę i dopiero potem zgłasza błąd', async () => {
  let n = 0;
  nextResponse = () => { n++; throw Object.assign(new Error('high demand'), { status: 503 }); };
  const msg = fakeMessage('<@999> wszystko przeciążone');
  await ai.answer(msg, BOT);
  assert.strictEqual(n, 3 * (1 + ai.FALLBACK_MODELS.length), 'trzy rundy po wszystkich modelach');
  assert.strictEqual(msg.sent[0][1].content, ai.UNAVAILABLE_MESSAGE);
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('model bez obsługi poziomu myślenia: pytanie ponowione bez tego ustawienia', async () => {
  const seen = [];
  nextResponse = (req) => {
    seen.push(Boolean(req.config.thinkingConfig));
    if (req.config.thinkingConfig) throw Object.assign(new Error('thinking_level is not supported'), { status: 400 });
    return { text: 'Działa bez thinking.' };
  };
  const msg = fakeMessage('<@999> stary model');
  await ai.answer(msg, BOT);
  assert.deepStrictEqual(seen, [true, false]);
  assert.strictEqual(msg.sent[0][1].content, 'Działa bez thinking.');
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('baza wiedzy wiedza.md trafia do instrukcji dla AI', async () => {
  const msg = fakeMessage('<@999> kiedy pep');
  await ai.answer(msg, BOT);
  const sys = calls.at(-1).config.systemInstruction;
  assert.match(sys, /BAZA WIEDZY/);
  assert.match(sys, /między lutym a marcem/);
});

test('wyczerpany limit (429): jedna próba na każdym modelu, bez kolejnych rund', async () => {
  let n = 0;
  nextResponse = () => { n++; throw Object.assign(new Error('quota'), { status: 429 }); };
  const msg = fakeMessage('<@999> limit');
  await ai.answer(msg, BOT);
  assert.strictEqual(n, 1 + ai.FALLBACK_MODELS.length, 'nie zużywa limitu powtórkami');
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

// --- odpowiedzi bez pingowania bota ---
function chatMessage(content, opts = {}) {
  const m = fakeMessage(content, { mentionBot: false, ...opts });
  if (opts.mentionOther) m.mentions.users = new Map([['123', { id: '123' }]]);
  if (opts.replyToHuman) {
    m.reference = { messageId: 'h1' };
    m.mentions.repliedUser = { id: '555' };
  }
  return m;
}

test('bez pingowania: bot rozpoznaje pytania na czacie', () => {
  for (const q of ['kiedy pep', 'Kiedy PEP?', 'czym się różni demo od jesieni', 'jak zainstalować moda?', 'pep wyjdzie w tym roku', 'Ktoś wie, co z tym?']) {
    assert.ok(ai.shouldAutoAnswer(chatMessage(q), BOT), `powinien odpowiedzieć: ${q}`);
  }
});

test('bez pingowania: bot nie wtrąca się w zwykłą rozmowę', () => {
  for (const q of ['hej', 'xd', 'dobra gra wczoraj', 'gg wp', 'super, dzięki']) {
    assert.ok(!ai.shouldAutoAnswer(chatMessage(q), BOT), `nie powinien: ${q}`);
  }
  assert.ok(!ai.shouldAutoAnswer(chatMessage('idziesz jutro?', { mentionOther: true }), BOT), 'pytanie do oznaczonej innej osoby');
  assert.ok(!ai.shouldAutoAnswer(chatMessage('a ty kiedy grasz?', { replyToHuman: true }), BOT), 'odpowiedź na wiadomość innej osoby');
  assert.ok(!ai.shouldAutoAnswer(chatMessage('co to? https://example.com'), BOT), 'wiadomość z linkiem');
});

test('bez pingowania: gdy AI uzna, że to nie pytanie do bota (POMIŃ), bot nic nie pisze', async () => {
  nextResponse = () => ({ text: 'POMIŃ' });
  const msg = chatMessage('jak tam u ciebie?');
  await ai.answer(msg, BOT, { auto: true });
  assert.deepStrictEqual(msg.sent, []);
  assert.match(calls.at(-1).contents[0].parts[0].text, /NIE oznaczyła cię/);
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('bez pingowania: normalne pytanie dostaje odpowiedź', async () => {
  nextResponse = () => ({ text: 'W poprzednich latach między lutym a marcem.' });
  const msg = chatMessage('kiedy pep');
  await ai.answer(msg, BOT, { auto: true });
  assert.strictEqual(msg.sent[0][0], 'reply');
  assert.match(msg.sent[0][1].content, /lutym a marcem/);
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('bez pingowania: błędy i limity nie spamują czatu', async () => {
  nextResponse = () => { throw Object.assign(new Error('quota'), { status: 429 }); };
  const msg = chatMessage('kiedy pep?');
  await ai.answer(msg, BOT, { auto: true });
  assert.deepStrictEqual(msg.sent, [], 'przy błędzie milczy');
  const again = chatMessage('kiedy pep?', { userId: msg.author.id });
  await ai.answer(again, BOT, { auto: true });
  assert.deepStrictEqual(again.sent, [], 'przy limicie 8 s milczy (bez ⏳)');
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('pamięć: drugie takie samo pytanie nie idzie do Gemini', async () => {
  let n = 0;
  nextResponse = () => { n++; return { text: 'Między lutym a marcem.' }; };
  const a = chatMessage('kiedy pep');
  await ai.answer(a, BOT, { auto: true });
  const b = chatMessage('Kiedy PEP?!');
  await ai.answer(b, BOT, { auto: true });
  assert.strictEqual(n, 1, 'Gemini zapytany tylko raz');
  assert.match(b.sent[0][1].content, /lutym a marcem/);
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('pamięć: błędy nie są zapamiętywane, a POMIŃ nie blokuje pytania z oznaczeniem', async () => {
  nextResponse = () => ({ text: 'POMIŃ' });
  await ai.answer(chatMessage('jak tam?'), BOT, { auto: true });
  nextResponse = () => ({ text: 'Dobrze, dzięki!' });
  const mention = fakeMessage('<@999> jak tam?');
  await ai.answer(mention, BOT);
  assert.strictEqual(mention.sent[0][1].content, 'Dobrze, dzięki!');

  nextResponse = () => { throw Object.assign(new Error('x'), { status: 503 }); };
  await ai.answer(fakeMessage('<@999> nowe pytanie'), BOT);
  nextResponse = () => ({ text: 'Teraz działa.' });
  const retry = fakeMessage('<@999> nowe pytanie');
  await ai.answer(retry, BOT);
  assert.strictEqual(retry.sent[0][1].content, 'Teraz działa.');
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('różnie sformułowane pytania o PEP są rozpoznawane (słowa kluczowe z wiedza.md)', () => {
  const variants = ['co to demo', 'czym jest demko', 'co daje wiosna', 'co w jesieni', 'jaka roznica demo a pelna',
    'kiedy premiera', 'kiedy wyjdzie mod', 'pep jesien', 'wiosna kiedy', 'demo czy jesień lepsze'];
  for (const q of variants) {
    assert.ok(ai.shouldAutoAnswer(chatMessage(q), BOT), `powinien odpowiedzieć: ${q}`);
  }
  for (const q of ['co to demo', 'czym jest demko', 'co w jesieni', 'wiosna kiedy', 'kiedy wyjdzie mod']) {
    assert.ok(ai.isTopical(q), `temat PEP: ${q}`);
  }
  for (const q of ['moderator mnie zbanował', 'gg wp', 'nowy model telefonu']) {
    assert.ok(!ai.isTopical(q), `nie temat PEP: ${q}`);
  }
});

test('pytanie z tematu PEP dostaje wskazówkę, żeby go nie pomijać', async () => {
  await ai.answer(chatMessage('co to demo'), BOT, { auto: true });
  const prompt = calls.at(-1).contents[0].parts[0].text;
  assert.match(prompt, /zawiera słowa z bazy wiedzy/);
  assert.match(calls.at(-1).config.systemInstruction, /"co to demo".*PEP Demo/);
});

test('limit czasu: gdy Gemini nie odpowiada, bot odpuszcza po kilku sekundach zamiast czekać minutami', async () => {
  // fałszywy Gemini, który nigdy nie odpowiada (aż do przerwania przez limit czasu)
  nextResponse = (req) => new Promise((_, reject) => {
    req.config.abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' })));
  });
  const t0 = Date.now();
  const msg = fakeMessage('<@999> wolne pytanie');
  await ai.answer(msg, BOT);
  const took = Date.now() - t0;
  assert.ok(took < 5000, `trwało ${took} ms`);
  assert.strictEqual(msg.sent[0][1].content, ai.UNAVAILABLE_MESSAGE);
  const req = calls.at(-1);
  assert.strictEqual(req.config.httpOptions.retryOptions.attempts, 1, 'bez wewnętrznych powtórek biblioteki');
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
});

test('komunikat o błędzie nie wspomina o Gemini ani szczegółach technicznych', async () => {
  for (const status of [429, 503, 504, 400, 403, 404]) {
    nextResponse = () => { throw Object.assign(new Error('api key invalid / high demand'), { status }); };
    const msg = fakeMessage('<@999> pytanie ' + status);
    await ai.answer(msg, BOT);
    assert.strictEqual(msg.sent[0][1].content, 'Pytanie jest w tej chwili nieosiągalne, spróbuj później.');
  }
  nextResponse = () => ({ text: 'Odpowiedź testowa.' });
  assert.match(calls.at(-1).config.systemInstruction, /nie wspominaj o Gemini/);
});
