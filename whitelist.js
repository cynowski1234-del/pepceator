// =====================================================================
//  WHITELISTA – osoby i role, których wiadomości bot NIGDY nie usuwa
//  (scam linki, zablokowane frazy, spam na wielu kanałach).
//
//  Jak dodać osobę:
//   1. Discord → Ustawienia → Zaawansowane → włącz "Tryb dewelopera".
//   2. Kliknij osobę prawym przyciskiem → "Kopiuj ID użytkownika".
//   3. Wklej ID poniżej w cudzysłowie, z przecinkiem na końcu, np.:
//        '123456789012345678', // Janek
//
//  Zmiany działają od razu po zapisaniu pliku (bez restartu bota).
//  Asystent AI dalej odpowiada tym osobom normalnie.
// =====================================================================

module.exports = {
  // ID użytkowników
  users: [
    // '123456789012345678', // przykład: Janek
  ],

  // ID ról – każdy, kto ma taką rolę, jest na whiteliście
  // (PPM na rolę w Ustawieniach serwera → Role → "Kopiuj ID roli")
  roles: [
    // '123456789012345678', // przykład: rola "Zaufani"
  ],
};
