/* =============================================================
   app.js – Account Manager  (CRUD + CSV import/export)
   Storage: AES-GCM encrypted per-user blobs (via crypto-store.js)
   ============================================================= */

'use strict';

// ──────────────────────────────────────────────
// 1. CONSTANTS & HELPERS
// ──────────────────────────────────────────────
const uid = () => '_' + Math.random().toString(36).slice(2, 10);

const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast toast-${type}`;
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.add('hidden'), 2800);
}

// ──────────────────────────────────────────────
// 2. IN-MEMORY RECORDS  (encrypted at rest via crypto-store.js)
// ──────────────────────────────────────────────
let records = [];

async function persistRecords() {
  await saveUserRecords(window.currentUserEmail, records, window.currentCryptoKey);
  githubSync(getEncStoreJSON());
}

// ──────────────────────────────────────────────
// 3. CSV PARSER / SERIALISER
// ──────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    // handle quoted fields containing commas
    const cols = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else { cur += ch; }
    }
    cols.push(cur);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (cols[i] || '').trim().replace(/^"|"$/g, ''); });
    if (!obj.id) obj.id = uid();
    return obj;
  });
}

function toCSV(data) {
  const headers = ['id','fullName','dob','email','phone','purpose','accountCreatedFor','authType','comments','image1','image2','image3','createdAt'];
  const escape = v => {
    const s = (v ?? '').toString();
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const rows = data.map(r => headers.map(h => escape(r[h] || '')).join(','));
  return [headers.join(','), ...rows].join('\n');
}

// ──────────────────────────────────────────────
// 4. LOAD RECORDS ON AUTH READY
// ──────────────────────────────────────────────
async function initRecords() {
  // Note: githubLoad() already ran at page boot (in auth.js DOMContentLoaded)
  // so remote encStore + users are already merged into localStorage before login.
  try {
    const existing = await loadUserRecords(window.currentUserEmail, window.currentCryptoKey);
    records = existing !== null ? existing : [];
  } catch (err) {
    console.error('[initRecords] Decryption failed:', err);
    records = [];
  }

  if (records.length === 0) {
    await persistRecords();
  }
}

// ──────────────────────────────────────────────
// 5. RENDER CARDS
// ──────────────────────────────────────────────
function applyFilters() {
  const q   = document.getElementById('searchInput').value.toLowerCase();
  const auth = document.getElementById('filterAuth').value;
  const plat = document.getElementById('filterPlatform').value;

  return records.filter(r => {
    const matchQ = !q || [r.fullName, r.email, r.accountCreatedFor, r.purpose, r.phone]
      .some(v => (v || '').toLowerCase().includes(q));
    const matchA = !auth || r.authType === auth;
    const matchP = !plat || r.accountCreatedFor === plat;
    return matchQ && matchA && matchP;
  });
}

function imageCell(src) {
  if (src && src.trim()) {
    return `<img src="${escHtml(src)}" alt="" loading="lazy" onerror="if(this.parentElement){this.parentElement.innerHTML='<span class=no-image>\uD83D\uDDBC</span>'}else{this.style.display='none'}" />`;
  }
  return `<span class="no-image">🖼</span>`;
}

function escHtml(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderCards() {
  const container = document.getElementById('cardsContainer');
  const empty     = document.getElementById('emptyState');
  const filtered  = applyFilters();

  document.getElementById('recordCount').textContent = `${filtered.length} record${filtered.length !== 1 ? 's' : ''}`;

  if (filtered.length === 0) {
    container.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');

  container.innerHTML = filtered.map(r => `
    <div class="card" data-id="${r.id}">
      <div class="card-images">
        ${imageCell(r.image1)}
        ${imageCell(r.image2)}
        ${imageCell(r.image3)}
      </div>
      <div class="card-body">
        <div class="card-name">${escHtml(r.fullName)}</div>
        <div class="card-email">✉ ${escHtml(r.email)}</div>
        ${r.phone ? `<div class="card-phone">📞 ${escHtml(r.phone)}</div>` : ''}
        <div class="card-tags">
          <span class="tag tag-platform">${escHtml(r.accountCreatedFor)}</span>
          <span class="tag tag-auth">${escHtml(r.authType)}</span>
        </div>
        <div class="card-purpose">${escHtml(r.purpose)}</div>
        <div class="card-date">Added ${fmt(r.createdAt)}</div>
      </div>
      <div class="card-actions">
        <button class="btn-view"  data-id="${r.id}">👁 View</button>
        <button class="btn-edit"  data-id="${r.id}">✏️ Edit</button>
        <button class="btn-delete" data-id="${r.id}">🗑 Delete</button>
      </div>
    </div>
  `).join('');
}

// ──────────────────────────────────────────────
// 6. MODAL HELPERS
// ──────────────────────────────────────────────
function openModal()  { document.getElementById('modal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal() { document.getElementById('modal').classList.add('hidden');    document.body.style.overflow = ''; }
function openViewModal()  { document.getElementById('viewModal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeViewModal() { document.getElementById('viewModal').classList.add('hidden');    document.body.style.overflow = ''; }
function openDeleteModal()  { document.getElementById('deleteModal').classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeDeleteModal() { document.getElementById('deleteModal').classList.add('hidden');    document.body.style.overflow = ''; }

// ──────────────────────────────────────────────
// 7. FORM RESET & POPULATE
// ──────────────────────────────────────────────
function resetForm() {
  document.getElementById('accountForm').reset();
  document.getElementById('fieldId').value = '';
  ['previewImg1','previewImg2','previewImg3'].forEach(id => {
    const el = document.getElementById(id);
    el.src = '';
    el.classList.add('hidden');
  });
  clearErrors();
  document.getElementById('modalTitle').textContent = 'Add Account';
  document.getElementById('btnSave').textContent = 'Save Account';
}

function populateForm(r) {
  document.getElementById('fieldId').value       = r.id;
  document.getElementById('fieldFullName').value = r.fullName   || '';
  document.getElementById('fieldDob').value      = r.dob        || '';
  document.getElementById('fieldEmail').value    = r.email      || '';
  document.getElementById('fieldPhone').value    = r.phone      || '';
  document.getElementById('fieldPlatform').value = r.accountCreatedFor || '';
  document.getElementById('fieldAuth').value     = r.authType   || '';
  document.getElementById('fieldPurpose').value  = r.purpose    || '';
  document.getElementById('fieldComments').value = r.comments   || '';
  // Images
  ['1','2','3'].forEach(n => {
    const urlEl = document.getElementById(`fieldImg${n}URL`);
    const prev  = document.getElementById(`previewImg${n}`);
    urlEl.value = r[`image${n}`] || '';
    if (r[`image${n}`]) { prev.src = r[`image${n}`]; prev.classList.remove('hidden'); }
    else { prev.src = ''; prev.classList.add('hidden'); }
  });
  document.getElementById('modalTitle').textContent = 'Edit Account';
  document.getElementById('btnSave').textContent = 'Update Account';
}

// ──────────────────────────────────────────────
// 8. VALIDATION
// ──────────────────────────────────────────────
function clearErrors() {
  ['errFullName','errDob','errEmail','errPlatform','errAuth','errPurpose'].forEach(id => {
    document.getElementById(id).textContent = '';
  });
  ['fieldFullName','fieldDob','fieldEmail','fieldPlatform','fieldAuth','fieldPurpose'].forEach(id => {
    document.getElementById(id).classList.remove('invalid');
  });
}

function setError(fieldId, errId, msg) {
  document.getElementById(fieldId).classList.add('invalid');
  document.getElementById(errId).textContent = msg;
}

function validateForm() {
  clearErrors();
  let valid = true;
  const fn = document.getElementById('fieldFullName').value.trim();
  const dob = document.getElementById('fieldDob').value;
  const email = document.getElementById('fieldEmail').value.trim();
  const plat = document.getElementById('fieldPlatform').value;
  const auth = document.getElementById('fieldAuth').value;
  const pur = document.getElementById('fieldPurpose').value.trim();

  if (!fn)                              { setError('fieldFullName','errFullName','Full name is required.'); valid = false; }
  if (!dob)                             { setError('fieldDob','errDob','Date of birth is required.'); valid = false; }
  if (!email || !/\S+@\S+\.\S+/.test(email)) { setError('fieldEmail','errEmail','Valid email is required.'); valid = false; }
  if (!plat)                            { setError('fieldPlatform','errPlatform','Please select a platform.'); valid = false; }
  if (!auth)                            { setError('fieldAuth','errAuth','Please select an auth type.'); valid = false; }
  if (!pur)                             { setError('fieldPurpose','errPurpose','Purpose is required.'); valid = false; }
  return valid;
}

// ──────────────────────────────────────────────
// 9. COLLECT FORM DATA
// ──────────────────────────────────────────────
function collectForm() {
  return {
    fullName:          document.getElementById('fieldFullName').value.trim(),
    dob:               document.getElementById('fieldDob').value,
    email:             document.getElementById('fieldEmail').value.trim(),
    phone:             document.getElementById('fieldPhone').value.trim(),
    accountCreatedFor: document.getElementById('fieldPlatform').value,
    authType:          document.getElementById('fieldAuth').value,
    purpose:           document.getElementById('fieldPurpose').value.trim(),
    comments:          document.getElementById('fieldComments').value.trim(),
    image1:            document.getElementById('fieldImg1URL').value.trim() || document.getElementById('previewImg1').src || '',
    image2:            document.getElementById('fieldImg2URL').value.trim() || document.getElementById('previewImg2').src || '',
    image3:            document.getElementById('fieldImg3URL').value.trim() || document.getElementById('previewImg3').src || '',
  };
}

// ──────────────────────────────────────────────
// 10. CRUD OPERATIONS
// ──────────────────────────────────────────────
async function createRecord(data) {
  const record = { id: uid(), createdAt: new Date().toISOString(), ...data };
  records.unshift(record);
  await persistRecords();
  return record;
}

async function updateRecord(id, data) {
  const idx = records.findIndex(r => r.id === id);
  if (idx === -1) return;
  records[idx] = { ...records[idx], ...data };
  await persistRecords();
}

async function deleteRecord(id) {
  records = records.filter(r => r.id !== id);
  await persistRecords();
}

// ──────────────────────────────────────────────
// 11. VIEW MODAL CONTENT
// ──────────────────────────────────────────────
function buildViewContent(r) {
  const imgSlot = (src) => src
    ? `<img src="${escHtml(src)}" alt="" loading="lazy" onerror="this.style.display='none'" />`
    : `<span class="no-img">🖼</span>`;

  return `
    <div class="view-images" style="padding:1rem 1.5rem 0">
      ${imgSlot(r.image1)}${imgSlot(r.image2)}${imgSlot(r.image3)}
    </div>
    <div class="view-fields">
      <div class="view-field"><span class="vf-label">Full Name</span><span class="vf-value">${escHtml(r.fullName)}</span></div>
      <div class="view-field"><span class="vf-label">Date of Birth</span><span class="vf-value">${fmt(r.dob)}</span></div>
      <div class="view-field"><span class="vf-label">Email</span><span class="vf-value">${escHtml(r.email)}</span></div>
      <div class="view-field"><span class="vf-label">Phone</span><span class="vf-value">${escHtml(r.phone) || '—'}</span></div>
      <div class="view-field"><span class="vf-label">Platform / App</span><span class="vf-value">${escHtml(r.accountCreatedFor)}</span></div>
      <div class="view-field"><span class="vf-label">Auth Type</span><span class="vf-value">${escHtml(r.authType)}</span></div>
      <div class="view-field span2"><span class="vf-label">Purpose</span><span class="vf-value">${escHtml(r.purpose)}</span></div>
      <div class="view-field span2"><span class="vf-label">Comments</span><span class="vf-value">${escHtml(r.comments) || '—'}</span></div>
      <div class="view-field"><span class="vf-label">Created At</span><span class="vf-value">${fmt(r.createdAt)}</span></div>
      <div class="view-field"><span class="vf-label">Record ID</span><span class="vf-value" style="font-size:.75rem;opacity:.5">${r.id}</span></div>
    </div>
  `;
}

// ──────────────────────────────────────────────
// 12. IMAGE PREVIEW (URL input & file upload)
// ──────────────────────────────────────────────
function setupImagePreviews() {
  ['1','2','3'].forEach(n => {
    const urlInput  = document.getElementById(`fieldImg${n}URL`);
    const fileInput = document.getElementById(`fieldImg${n}File`);
    const preview   = document.getElementById(`previewImg${n}`);

    urlInput.addEventListener('input', () => {
      const val = urlInput.value.trim();
      if (val) { preview.src = val; preview.classList.remove('hidden'); }
      else     { preview.src = ''; preview.classList.add('hidden'); }
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.src = e.target.result;
        preview.classList.remove('hidden');
        urlInput.value = e.target.result;  // store base64 as URL
      };
      reader.readAsDataURL(file);
    });
  });
}

// ──────────────────────────────────────────────
// 14. EXPORT CSV  (decrypted, for backup)
// ──────────────────────────────────────────────
function exportCSV() {
  const csv  = toCSV(records);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'data.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exported (decrypted backup)!');
}

// ──────────────────────────────────────────────
// 14. IMPORT CSV
// ──────────────────────────────────────────────
function importCSV(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = parseCSV(e.target.result);
      if (imported.length === 0) { showToast('No records found in CSV.', 'error'); return; }
      // Merge: skip duplicates by id
      const existing = new Set(records.map(r => r.id));
      const newOnes  = imported.filter(r => !existing.has(r.id));
      records = [...newOnes, ...records];
      persistRecords().then(() => {
        renderCards();
        showToast(`Imported ${newOnes.length} new record(s).`);
      });
    } catch {
      showToast('Failed to parse CSV.', 'error');
    }
  };
  reader.readAsText(file);
}

// ──────────────────────────────────────────────
// 15. EVENT LISTENERS
// ──────────────────────────────────────────────
let pendingDeleteId = null;

document.addEventListener('authReady', async () => {
  await initRecords();
  renderCards();
  setupImagePreviews();

  // Add new
  document.getElementById('btnAddNew').addEventListener('click', () => {
    resetForm();
    openModal();
  });

  // Close modal buttons
  document.getElementById('btnCloseModal').addEventListener('click', closeModal);
  document.getElementById('btnCancel').addEventListener('click', closeModal);
  document.getElementById('btnCloseViewModal').addEventListener('click', closeViewModal);
  document.getElementById('btnCloseDeleteModal').addEventListener('click', closeDeleteModal);
  document.getElementById('btnCancelDelete').addEventListener('click', closeDeleteModal);

  // Close on overlay click
  document.getElementById('modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
  document.getElementById('viewModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeViewModal(); });
  document.getElementById('deleteModal').addEventListener('click', e => { if (e.target === e.currentTarget) closeDeleteModal(); });

  // Form submit (create / update)
  document.getElementById('accountForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!validateForm()) return;

    const id   = document.getElementById('fieldId').value;
    const data = collectForm();

    if (id) {
      await updateRecord(id, data);
      showToast('Account updated!');
    } else {
      await createRecord(data);
      showToast('Account added!');
    }
    closeModal();
    renderCards();
  });

  // Card action buttons (delegated)
  document.getElementById('cardsContainer').addEventListener('click', e => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const id  = btn.dataset.id;
    const rec = records.find(r => r.id === id);

    if (btn.classList.contains('btn-view')) {
      document.getElementById('viewModalTitle').textContent = rec.fullName;
      document.getElementById('viewContent').innerHTML = buildViewContent(rec);
      openViewModal();
    }
    if (btn.classList.contains('btn-edit')) {
      resetForm();
      populateForm(rec);
      openModal();
    }
    if (btn.classList.contains('btn-delete')) {
      pendingDeleteId = id;
      document.getElementById('deleteTargetName').textContent = rec.fullName;
      openDeleteModal();
    }
  });

  // Confirm delete
  document.getElementById('btnConfirmDelete').addEventListener('click', async () => {
    if (!pendingDeleteId) return;
    await deleteRecord(pendingDeleteId);
    pendingDeleteId = null;
    closeDeleteModal();
    renderCards();
    showToast('Account deleted.', 'error');
  });

  // Export CSV
  document.getElementById('btnExportCSV').addEventListener('click', exportCSV);

  // Import CSV
  document.getElementById('btnImportCSV').addEventListener('click', () => {
    document.getElementById('csvFileInput').click();
  });
  document.getElementById('csvFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) { importCSV(file); e.target.value = ''; }
  });

  // Search & filter
  ['searchInput','filterAuth','filterPlatform'].forEach(id => {
    document.getElementById(id).addEventListener('input', renderCards);
    document.getElementById(id).addEventListener('change', renderCards);
  });

  // Keyboard ESC
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (!document.getElementById('deleteModal').classList.contains('hidden')) { closeDeleteModal(); return; }
    if (!document.getElementById('viewModal').classList.contains('hidden'))   { closeViewModal();   return; }
    if (!document.getElementById('modal').classList.contains('hidden'))       { closeModal();       return; }
  });
});
