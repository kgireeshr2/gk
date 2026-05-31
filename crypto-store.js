/* =============================================================
   crypto-store.js
   AES-GCM encryption / decryption with PBKDF2 key derivation.
   All data-at-rest (localStorage + GitHub file) is ciphertext.
   Plain records only ever exist in memory during an active session.
   ============================================================= */

'use strict';

const ENC_STORE_KEY = 'acctMgr_encStore';  // localStorage key for encrypted blobs

// ──────────────────────────────────────────────
// LOW-LEVEL CRYPTO HELPERS
// ──────────────────────────────────────────────

/** Random bytes → base64 string */
function randB64(bytes = 16) {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return bufToB64(arr);
}

function bufToB64(buf) {
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToBuf(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr.buffer;
}

/**
 * Derive an AES-GCM CryptoKey from a passphrase + salt using PBKDF2.
 * @param {string} passphrase  – user-supplied encryption key
 * @param {string} saltB64     – base64-encoded 16-byte salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveKey(passphrase, saltB64) {
  const enc  = new TextEncoder();
  const base = await crypto.subtle.importKey(
    'raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: b64ToBuf(saltB64), iterations: 150_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string.
 * @returns {{ iv: string, cipher: string }}  both base64
 */
async function encryptText(plaintext, cryptoKey) {
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const buf = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    enc.encode(plaintext)
  );
  return { iv: bufToB64(iv), cipher: bufToB64(buf) };
}

/**
 * Decrypt ciphertext.
 * @returns {string} plaintext
 * @throws if key is wrong
 */
async function decryptText(ivB64, cipherB64, cryptoKey) {
  const buf = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(ivB64)) },
    cryptoKey,
    b64ToBuf(cipherB64)
  );
  return new TextDecoder().decode(buf);
}

// ──────────────────────────────────────────────
// ENCRYPTED STORE  (per-user blobs)
// ──────────────────────────────────────────────
// Structure stored in localStorage / GitHub:
// {
//   "user@email.com": { salt: "b64", iv: "b64", cipher: "b64" },
//   ...
// }

function getEncStore() {
  const raw = localStorage.getItem(ENC_STORE_KEY);
  return raw ? JSON.parse(raw) : {};
}

function setEncStore(store) {
  localStorage.setItem(ENC_STORE_KEY, JSON.stringify(store));
}

/**
 * Load & decrypt records for a user.
 * Returns null if no data exists yet, throws on wrong key.
 */
async function loadUserRecords(userEmail, cryptoKey) {
  const store = getEncStore();
  const entry = store[userEmail];
  if (!entry) return null;   // first time – no data yet
  const plain = await decryptText(entry.iv, entry.cipher, cryptoKey);
  return JSON.parse(plain);
}

/**
 * Encrypt & persist records for a user.
 */
async function saveUserRecords(userEmail, records, cryptoKey) {
  const store   = getEncStore();
  const { iv, cipher } = await encryptText(JSON.stringify(records), cryptoKey);
  // preserve existing salt; create one if new user
  const salt = (store[userEmail] && store[userEmail].salt) || randB64(16);
  store[userEmail] = { salt, iv, cipher };
  setEncStore(store);
}

/**
 * Delete all encrypted data for a user.
 */
function deleteUserStore(userEmail) {
  const store = getEncStore();
  delete store[userEmail];
  setEncStore(store);
}

/**
 * Verify an encryption passphrase without loading records.
 * Returns the derived CryptoKey on success, throws on failure.
 * @param {string} saltB64  – stored alongside user in auth layer
 */
async function verifyAndDeriveKey(passphrase, saltB64) {
  // Just derive; actual verification happens when we try to decrypt
  return deriveKey(passphrase, saltB64);
}

/**
 * Called at registration: generate a salt, do a test round-trip encrypt.
 * Returns { salt: b64, cryptoKey }
 */
async function initEncryption(passphrase) {
  const salt = randB64(16);
  const key  = await deriveKey(passphrase, salt);
  // smoke test
  const { iv, cipher } = await encryptText('__test__', key);
  await decryptText(iv, cipher, key);
  return { salt, cryptoKey: key };
}

// ──────────────────────────────────────────────
// EXPORT RAW (for CSV backup – decrypt first)
// ──────────────────────────────────────────────
async function exportDecrypted(userEmail, cryptoKey) {
  const records = await loadUserRecords(userEmail, cryptoKey);
  return records || [];
}

// ──────────────────────────────────────────────
// LOAD ENCRYPTED STORE FROM GITHUB (JSON string)
// Also restores the users list (needed for encSalt on new devices)
// ──────────────────────────────────────────────
function mergeRemoteStore(jsonString) {
  try {
    const remote = JSON.parse(jsonString);

    // Restore users list — remote encSalt wins (source of truth)
    if (remote.__users && Array.isArray(remote.__users)) {
      const localUsersRaw = localStorage.getItem('acctMgr_users');
      const localUsers    = localUsersRaw ? JSON.parse(localUsersRaw) : [];
      const localMap      = {};
      localUsers.forEach(u => { localMap[u.email] = u; });
      // Merge: remote encSalt/hash overrides local (in case local is stale)
      remote.__users.forEach(u => {
        if (localMap[u.email]) {
          // Update encSalt and hash from remote but keep local password if remote has none
          if (u.encSalt) localMap[u.email].encSalt = u.encSalt;
          if (u.hash)    localMap[u.email].hash    = u.hash;
        } else {
          localMap[u.email] = u;
        }
      });
      localStorage.setItem('acctMgr_users', JSON.stringify(Object.values(localMap)));
      console.log('[Crypto] Users restored from remote:', Object.keys(localMap));
    }

    // Restore encrypted blobs
    const { __users: _u, ...blobs } = remote;
    const local  = getEncStore();
    const merged = { ...local, ...blobs };
    setEncStore(merged);
    console.log('[Crypto] Encrypted blobs restored for users:', Object.keys(blobs));
    return true;
  } catch (err) {
    console.error('[Crypto] mergeRemoteStore failed:', err);
    return false;
  }
}

function getEncStoreJSON() {
  const store    = getEncStore();
  const usersRaw = localStorage.getItem('acctMgr_users');
  const users    = usersRaw ? JSON.parse(usersRaw) : [];
  // All fields needed: hash for login, encSalt for key derivation on new devices
  const safeUsers = users.map(({ email, name, role, encSalt, hash, createdAt }) =>
    ({ email, name, role, encSalt, hash, createdAt })
  );
  return JSON.stringify({ ...store, __users: safeUsers }, null, 2);
}
