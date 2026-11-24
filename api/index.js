// Vercel: punkt wejścia panelu "PEP Creators" (cały ruch kierowany tutaj przez vercel.json).
// Bot Discorda NIE działa na Vercelu - uruchamiasz go osobno na hostingu (plik bot.js).
const { createStandalonePanel } = require('../src/panel/standalone');

let app;
try {
  app = createStandalonePanel();
} catch (err) {
  // brak konfiguracji - czytelny komunikat zamiast pustego błędu 500 (bez wartości sekretów)
  console.error(`[panel] ${err.message}`);
  app = (req, res) => {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(`Panel nie jest skonfigurowany: ${err.message}.\nUstaw je w Vercel -> Settings -> Environment Variables i zrób Redeploy.`);
  };
}

module.exports = app;
