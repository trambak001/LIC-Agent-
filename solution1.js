/* ══════════════════════════════════════════════════════════════════
   Solution 1: Master Database — VLOOKUP Phone Numbers
   Stores a master client list in localStorage and merges phone
   numbers into the monthly due list automatically.
   ══════════════════════════════════════════════════════════════════ */

const MASTER_DB_KEY = 'lic_master_clients';

// ── Master DB CRUD ───────────────────────────────────────────────

function loadMasterDB() {
    try {
        const raw = localStorage.getItem(MASTER_DB_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveMasterDB(db) {
    localStorage.setItem(MASTER_DB_KEY, JSON.stringify(db));
}

function clearMasterDB() {
    localStorage.removeItem(MASTER_DB_KEY);
}


// ── Parse master file and store ──────────────────────────────────

async function handleMasterFile(file) {
    try {
        const { headers, rows } = await parseFile(file);
        const colMap = autoMapColumns(headers);

        const hasPolicy = Object.values(colMap).includes('Policy Number');
        const hasPhone  = Object.values(colMap).includes('Phone Number');

        if (!hasPolicy || !hasPhone) {
            showAlert('error', `Master file must have Policy Number and Phone Number columns. Found: ${headers.join(', ')}`);
            return;
        }

        const db = loadMasterDB();
        let added = 0;

        rows.forEach(row => {
            const obj = {};
            headers.forEach((h, i) => {
                const std = colMap[h];
                if (std) obj[std] = (row[i] || '').trim();
            });

            const policy = obj['Policy Number'];
            const phone  = obj['Phone Number'];
            if (policy && phone && phone.toLowerCase() !== 'nan') {
                db[policy] = phone;
                added++;
            }
        });

        saveMasterDB(db);
        showAlert('success', `Master DB updated — ${added} new entries. Total: ${Object.keys(db).length} contacts.`);
        renderMasterStatus();

    } catch (e) {
        showAlert('error', `Error reading master file: ${e.message}`);
    }
}


// ── Hook: merge phone numbers into due list ──────────────────────
// This function name is called by app.js if it exists

function mergePhoneNumbers(data) {
    const db = loadMasterDB();
    if (!Object.keys(db).length) return data;

    let matched = 0;
    data.forEach(record => {
        if (!record['Phone Number'] || record['Phone Number'].toLowerCase() === 'nan') {
            const policy = String(record['Policy Number']).trim();
            const phone = db[policy];
            if (phone) {
                record['Phone Number'] = phone;
                matched++;
            }
        }
    });

    if (matched > 0) {
        showAlert('success', `🔗 Merged ${matched} phone numbers from Master Database`);
    } else if (data.length > 0 && !data.some(d => d['Phone Number'])) {
        showAlert('warning', 'No phone numbers found in Master DB for these policies. Upload a master client list above.');
    }

    return data;
}


// ── UI: Master status ────────────────────────────────────────────

function renderMasterStatus() {
    const db = loadMasterDB();
    const count = Object.keys(db).length;
    const container = document.getElementById('master-status');

    if (count > 0) {
        container.innerHTML = `
            <div class="sidebar-stat">✅ ${count} contacts saved</div>
            <button class="btn btn-danger" id="clear-master-btn">🗑️ Clear Database</button>
        `;
        document.getElementById('clear-master-btn').addEventListener('click', () => {
            if (confirm('Clear all saved master contacts?')) {
                clearMasterDB();
                renderMasterStatus();
                showAlert('info', 'Master database cleared.');
            }
        });
    } else {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:.82rem;margin-bottom:.5rem">No contacts saved yet</div>`;
    }
}


// ── Init ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    renderMasterStatus();

    const masterDropzone = document.getElementById('master-dropzone');
    const masterInput = document.getElementById('master-input');

    masterDropzone.addEventListener('click', () => masterInput.click());
    masterInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleMasterFile(e.target.files[0]);
    });
});
