// Uruchamia panel tak jak na Vercelu (Supabase + API Discorda), ale na Twoim komputerze - do sprawdzenia
// konfiguracji przed wdrożeniem.  Użycie:  npm run panel:vercel-local   ->  http://localhost:3001
// Wymaga w .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DISCORD_TOKEN, DISCORD_CLIENT_SECRET, PANEL_SESSION_SECRET.
// W Discord Developer Portal -> OAuth2 -> Redirects dodaj też: http://localhost:3001/auth/callback
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') });

process.env.PANEL_URL = 'http://localhost:3001';
const { createStandalonePanel } = require('../src/panel/standalone');

try {
  createStandalonePanel().listen(3001, '127.0.0.1', () => console.log('🌐 Panel (tryb Vercel): http://localhost:3001'));
} catch (err) {
  console.error(`❌ Panel nie jest skonfigurowany: ${err.message}`);
  process.exitCode = 2;
}
