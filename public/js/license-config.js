// Configurazione delle licenze. Finché il server non è online resta spenta: l'app è tutta libera.
// Per accenderla: enabled true, apiBase = indirizzo del server, publicKeyJwk = chiave PUBBLICA
// stampata da `node server/license-server.js --new-key` (la privata resta solo sul server).
export const LICENSE_CONFIG = {
  enabled: false,
  apiBase: 'https://ertsrfsxnrjwkbdrzxxw.supabase.co/functions/v1/license',
  publicKeyJwk: {"kty": "EC", "crv": "P-256", "x": "aw0mZAnqDPoavwkWT9alncXzl9NxBDp95twxSZY4k18", "y": "zs8q6CkdFN1u3GmoFLkXBZeaTdgHD090dBbTDmVcRvY"},
  // pagina di acquisto sul sito (non mostrata su iPhone: lì si comprerà dentro l'app, regole di Apple)
  buyUrl: '',
};
