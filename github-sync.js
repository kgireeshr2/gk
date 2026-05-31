/* =============================================================
   github-sync.js – Write data.csv back to the GitHub repo
   Uses the GitHub Contents API (works on GitHub Pages).

   Config stored in localStorage: acctMgr_ghConfig
   {
     owner  : 'your-github-username',
     repo   : 'your-repo-name',
     branch : 'main',
     path   : 'data.csv',
     token  : 'ghp_...'   (PAT with repo scope)
   }
   ============================================================= */

'use strict';

const GH_CONFIG_KEY = 'acctMgr_ghConfig';

// ──────────────────────────────────────────────
// Config helpers
// ──────────────────────────────────────────────
// Default config — works out of the box on any browser without manual setup.
// Override via the ⚙ Settings modal if needed.
const GH_DEFAULT_CONFIG = {
  owner:  'kgireeshr2',
  repo:   'gk',
  branch: 'main',
  path:   'encrypted_data.json',
  token:  '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',
};

function getGHConfig() {
  const raw = localStorage.getItem(GH_CONFIG_KEY);
  return raw ? JSON.parse(raw) : GH_DEFAULT_CONFIG;
}

function saveGHConfig(cfg) {
  localStorage.setItem(GH_CONFIG_KEY, JSON.stringify(cfg));
}

function clearGHConfig() {
  localStorage.removeItem(GH_CONFIG_KEY);
}

// ──────────────────────────────────────────────
// Base64 encode / decode (browser-safe, handles UTF-8)
// ──────────────────────────────────────────────
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(b64) {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ──────────────────────────────────────────────
// GitHub API: get current file SHA
// (needed for PUT / update)
// ──────────────────────────────────────────────
async function getFileSHA(cfg) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${cfg.branch}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (res.status === 404) return null;           // file doesn't exist yet
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return json.sha;
}

// ──────────────────────────────────────────────
// GitHub API: write file
// ──────────────────────────────────────────────
async function writeFile(cfg, csvContent) {
  const sha = await getFileSHA(cfg);
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}`;

  const body = {
    message: `chore: update ${cfg.path} via Account Manager`,
    content: toBase64(csvContent),
    branch:  cfg.branch,
  };
  if (sha) body.sha = sha;   // required when updating an existing file

  const res = await fetch(url, {
    method:  'PUT',
    headers: {
      Authorization:  `token ${cfg.token}`,
      Accept:         'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || `GitHub API ${res.status}`);
  }
  return true;
}

// ──────────────────────────────────────────────
// Public: sync encrypted store JSON → GitHub repo
// Called from persistRecords() after every mutation.
// ──────────────────────────────────────────────
async function githubSync(jsonContent) {
  const cfg = getGHConfig();
  if (!cfg) return;  // not configured – skip silently

  const indicator = document.getElementById('syncIndicator');
  if (indicator) { indicator.textContent = '⏳ Syncing…'; indicator.className = 'sync-indicator syncing'; }

  try {
    await writeFile(cfg, jsonContent);
    if (indicator) { indicator.textContent = '✅ Synced'; indicator.className = 'sync-indicator synced'; }
    setTimeout(() => { if (indicator) indicator.textContent = ''; }, 3000);
  } catch (err) {
    console.error('GitHub sync failed:', err);
    if (indicator) { indicator.textContent = '❌ Sync failed'; indicator.className = 'sync-indicator error'; }
    showToast(`Sync failed: ${err.message}`, 'error');
  }
}

// ──────────────────────────────────────────────
// Pull encrypted store from GitHub → merge into
// localStorage. Used by initRecords() on new device.
// ──────────────────────────────────────────────
async function githubLoad() {
  const cfg = getGHConfig();
  if (!cfg) return false;
  try {
    const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/${cfg.path}?ref=${cfg.branch}`;
    const res = await fetch(url, {
      headers: { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github+json' },
    });
    if (res.status === 404) { console.log('[GH Sync] Remote file not found yet.'); return false; }
    if (!res.ok) { console.warn('[GH Sync] Load failed:', res.status, res.statusText); return false; }

    const json = await res.json();
    let content = '';

    if (json.content && json.content.trim().length > 0) {
      // Inline base64 — strip ALL whitespace (GitHub adds \r\n every 60 chars)
      const rawB64 = json.content.replace(/\s/g, '');
      console.log('[GH Sync] Inline base64 length:', rawB64.length);
      content = fromBase64(rawB64);
    } else if (json.download_url) {
      // File too large for inline content — fetch raw directly
      console.log('[GH Sync] Falling back to download_url:', json.download_url);
      const rawRes = await fetch(json.download_url);
      if (!rawRes.ok) { console.warn('[GH Sync] download_url fetch failed'); return false; }
      content = await rawRes.text();
    } else {
      console.warn('[GH Sync] No content or download_url in response. File may be empty.');
      return false;
    }

    console.log('[GH Sync] Content length:', content.length, '| first 60:', content.slice(0, 60));

    try {
      const parsed = JSON.parse(content);
      console.log('[GH Sync] Keys:', Object.keys(parsed));
      console.log('[GH Sync] __users:', parsed.__users ? parsed.__users.map(u => u.email) : 'none');
      console.log('[GH Sync] Blobs for:', Object.keys(parsed).filter(k => k !== '__users'));
    } catch (diagErr) {
      console.error('[GH Sync] JSON parse failed:', diagErr.message, '| snippet:', content.slice(0, 300));
      return false;
    }

    const merged = mergeRemoteStore(content);
    console.log('[GH Sync] Merge result:', merged);
    return merged;
  } catch (err) {
    console.warn('[GH Sync] githubLoad error:', err);
    return false;
  }
}

// ──────────────────────────────────────────────
// Settings Modal – open / close
// ──────────────────────────────────────────────
function openSettingsModal() {
  const cfg = getGHConfig();  // always returns at least the default
  document.getElementById('ghOwner').value  = cfg.owner  || '';
  document.getElementById('ghRepo').value   = cfg.repo   || '';
  document.getElementById('ghBranch').value = cfg.branch || 'main';
  document.getElementById('ghPath').value   = cfg.path   || 'encrypted_data.json';
  document.getElementById('ghToken').value  = cfg.token  || '';
  document.getElementById('settingsModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.add('hidden');
  document.body.style.overflow = '';
}

// ──────────────────────────────────────────────
// Settings save
// ──────────────────────────────────────────────
async function saveSettings(e) {
  e.preventDefault();
  const cfg = {
    owner:  document.getElementById('ghOwner').value.trim(),
    repo:   document.getElementById('ghRepo').value.trim(),
    branch: document.getElementById('ghBranch').value.trim() || 'main',
    path:   document.getElementById('ghPath').value.trim()   || 'data.csv',
    token:  document.getElementById('ghToken').value.trim(),
  };

  if (!cfg.owner || !cfg.repo || !cfg.token) {
    showToast('Owner, Repo and Token are required.', 'error');
    return;
  }

  // Test connection: verify the REPO exists (not the file — file won't exist on first sync)
  const btn = document.getElementById('btnSaveSettings');
  btn.disabled = true;
  btn.textContent = 'Testing…';

  try {
    const repoRes = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
      headers: { Authorization: `token ${cfg.token}`, Accept: 'application/vnd.github+json' },
    });
    if (repoRes.status === 401 || repoRes.status === 403) throw new Error('Invalid token or insufficient permissions.');
    if (repoRes.status === 404) throw new Error(`Repo "${cfg.owner}/${cfg.repo}" not found. Check username and repo name.`);
    if (!repoRes.ok) throw new Error(`GitHub API ${repoRes.status}: ${repoRes.statusText}`);
    saveGHConfig(cfg);
    updateSettingsBadge();
    closeSettingsModal();
    showToast('GitHub sync configured! ✅');
  } catch (err) {
    showToast(`Connection failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save & Connect';
  }
}

// ──────────────────────────────────────────────
// Boot – wire up settings UI
// ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btnOpenSettings').addEventListener('click', openSettingsModal);
  document.getElementById('btnCloseSettings').addEventListener('click', closeSettingsModal);
  document.getElementById('btnCancelSettings').addEventListener('click', closeSettingsModal);
  document.getElementById('btnDisconnectGH').addEventListener('click', () => {
    clearGHConfig();
    closeSettingsModal();
    showToast('GitHub sync disconnected.', 'error');
    updateSettingsBadge();
  });

  document.getElementById('btnForcePull').addEventListener('click', async () => {
    const cfg = getGHConfig();
    if (!cfg) { showToast('Connect GitHub first — open ⚙ settings.', 'error'); return; }
    const btn = document.getElementById('btnForcePull');
    btn.disabled = true;
    btn.textContent = 'Pulling…';
    try {
      const ok = await githubLoad();
      if (!ok) { showToast('Pull failed or no remote data yet.', 'error'); return; }
      // Re-render with newly merged data via forcePull event (handled in app.js)
      if (window.currentCryptoKey && window.currentUserEmail) {
        document.dispatchEvent(new CustomEvent('forcePull'));
      }
      showToast('Pulled latest data from GitHub ✅');
    } catch (err) {
      showToast(`Pull failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↓ Pull';
    }
  });

  document.getElementById('btnForcePush').addEventListener('click', async () => {
    const cfg = getGHConfig();
    if (!cfg) { showToast('Connect GitHub first.', 'error'); return; }
    const btn = document.getElementById('btnForcePush');
    btn.disabled = true;
    btn.textContent = 'Pushing…';
    try {
      await writeFile(cfg, getEncStoreJSON());
      showToast('Force push successful! ✅ Data is now on GitHub.');
    } catch (err) {
      showToast(`Force push failed: ${err.message}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = '↑ Force Push';
    }
  });
  document.getElementById('settingsModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeSettingsModal();
  });
  document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    await saveSettings(e);
    updateSettingsBadge();
  });

  updateSettingsBadge();
});

function updateSettingsBadge() {
  const btn = document.getElementById('btnOpenSettings');
  const cfg = getGHConfig();  // always has at least the default
  btn.title = `GitHub sync: ${cfg.owner}/${cfg.repo}`;
  btn.classList.add('btn-connected');
}
