// Ochrona przed podwójnym działaniem, gdy przez pomyłkę działają dwa boty na tym samym tokenie
// (np. na hostingu i na komputerze). Przed odpowiedzią AI, usunięciem wiadomości albo raportem bot
// rezerwuje daną rzecz w Supabase - drugi bot widzi, że jest już zajęta, i nic nie robi.
// Bez Supabase (tryb plików) działa zawsze jeden bot, więc rezerwacja zawsze się udaje.
const os = require('node:os');
const crypto = require('node:crypto');
const { getDb } = require('./db');

// identyfikator tej kopii bota (komputer + proces)
const INSTANCE = `${os.hostname()}#${process.pid}#${crypto.randomBytes(3).toString('hex')}`;
const KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * Rezerwuje akcję. true = ta kopia bota ma to zrobić, false = robi to już inna kopia.
 * @param {string} kind np. 'ai', 'mod', 'report'
 * @param {string} id   np. ID wiadomości
 */
async function claim(kind, id) {
  const db = getDb();
  if (!db?.claim) return true;
  try {
    return await db.claim(`claim:${kind}:${id}`, INSTANCE);
  } catch (err) {
    // baza chwilowo niedostępna - lepiej zadziałać (ewentualnie podwójnie) niż wcale
    console.warn(`[claims] rezerwacja nieudana (${err.message}) - działam dalej`);
    return true;
  }
}

/** Usuwa stare rezerwacje (starsze niż doba). */
async function cleanup() {
  const db = getDb();
  if (!db?.removeOlderClaims) return;
  await db.removeOlderClaims(new Date(Date.now() - KEEP_MS).toISOString());
}

module.exports = { claim, cleanup, INSTANCE };
