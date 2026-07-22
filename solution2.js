/* ══════════════════════════════════════════════════════════════════
   Solution 2: Smart Contact Manager
   Guided portal lookup + bulk import + inline entry + auto-save.
   Combines the best of all 3 solutions into one production tool.
   ══════════════════════════════════════════════════════════════════ */

const CONTACT_DB_KEY = 'lic_smart_contacts';
const LIC_PORTAL_URL = 'https://ebiz.licindia.in/D2CPM/#702';

// ── Contact DB CRUD ──────────────────────────────────────────────

function loadContactDB() {
    try {
        const raw = localStorage.getItem(CONTACT_DB_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function saveContactDB(db) {
    localStorage.setItem(CONTACT_DB_KEY, JSON.stringify(db));
}

function clearContactDB() {
    localStorage.removeItem(CONTACT_DB_KEY);
}

function getContactCount() {
    return Object.keys(loadContactDB()).length;
}


// ── Hook: merge phone numbers into due list (called by app.js) ──

function mergePhoneNumbers(data) {
    const db = loadContactDB();
    if (!Object.keys(db).length) return data;

    let matched = 0;
    data.forEach(record => {
        if (!record['Phone Number'] || record['Phone Number'].toLowerCase() === 'nan') {
            const policy = String(record['Policy Number']).trim();
            if (db[policy]) {
                record['Phone Number'] = db[policy];
                matched++;
            }
        }
    });

    if (matched > 0) {
        showAlert('success', `🔗 Auto-filled ${matched} phone numbers from saved contacts`);
    }

    return data;
}


// ── Hook: get phone for WhatsApp link (called by app.js) ─────────

function getPhoneForClient(name, records) {
    const db = loadContactDB();
    for (const r of records) {
        const policy = String(r['Policy Number']).trim();
        if (db[policy]) return db[policy];
    }
    return null;
}


// ── Hook: render phone input inside each client card ─────────────

function renderPhoneInput(name, records, existingPhone) {
    const db = loadContactDB();
    const policies = records.map(r => String(r['Policy Number']).trim());

    // Find saved phone
    let savedPhone = '';
    for (const p of policies) {
        if (db[p]) { savedPhone = db[p]; break; }
    }

    const phone = existingPhone || savedPhone;
    const inputId = `phone-${slugify(name)}`;
    const hasSaved = !!phone;

    return `
        <div class="phone-lookup-row">
            <div class="phone-input-group">
                <span class="phone-icon">${hasSaved ? '✅' : '📱'}</span>
                <input type="tel" class="phone-input" id="${inputId}"
                       placeholder="Enter phone number"
                       value="${escapeHtml(phone)}"
                       data-policies='${JSON.stringify(policies)}'
                       data-client="${escapeHtml(name)}"
                       autocomplete="tel">
                <span class="phone-save-status" id="status-${inputId}">
                    ${hasSaved ? 'Saved' : 'Not saved'}
                </span>
            </div>
            <button type="button" class="btn-portal-lookup" 
                    onclick="window.open('${LIC_PORTAL_URL}', '_blank')"
                    title="Open LIC Agent Portal to look up this client's phone number">
                🔍 Look up on Portal
            </button>
        </div>
    `;
}


// ── Hook: render after all action cards ──────────────────────────

function renderAfterActions(groups) {
    const list = document.getElementById('action-list');
    const db = loadContactDB();

    // Calculate stats
    let totalClients = 0;
    let clientsWithPhone = 0;

    for (const [name, records] of groups) {
        totalClients++;
        const hasPhone = records.some(r => {
            const p = String(r['Policy Number']).trim();
            return (r['Phone Number'] && r['Phone Number'].toLowerCase() !== 'nan') || db[p];
        });
        if (hasPhone) clientsWithPhone++;
    }

    const missing = totalClients - clientsWithPhone;
    const pct = totalClients ? Math.round((clientsWithPhone / totalClients) * 100) : 0;

    // Stats bar at top
    const statsBar = document.createElement('div');
    statsBar.className = 'contact-stats-bar';
    statsBar.innerHTML = `
        <div class="stats-progress">
            <div class="stats-progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="stats-text">
            <span><strong>${clientsWithPhone}/${totalClients}</strong> clients have phone numbers</span>
            ${missing > 0 
                ? `<span class="stats-missing">⚠️ ${missing} missing — use bulk import or look up on the portal</span>` 
                : `<span class="stats-complete">🎉 All contacts complete!</span>`
            }
        </div>
    `;
    list.insertBefore(statsBar, list.firstChild);

    // Attach auto-save listeners to all phone inputs
    setTimeout(() => {
        document.querySelectorAll('.phone-input').forEach(input => {
            // Save on blur
            input.addEventListener('blur', () => savePhoneFromInput(input));
            // Save on Enter key
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    savePhoneFromInput(input);
                    input.blur();
                }
            });
        });
    }, 100);

    // Footer controls
    const controls = document.createElement('div');
    controls.className = 'contact-controls';
    controls.innerHTML = `
        <div class="contact-controls-row">
            <button type="button" class="btn btn-primary" id="save-all-contacts">
                💾 Save All Numbers
            </button>
            <button type="button" class="btn btn-secondary" id="export-contacts-csv">
                📤 Export Contacts (CSV)
            </button>
            ${getContactCount() > 0 
                ? `<button type="button" class="btn btn-danger" id="clear-all-contacts">🗑️ Clear Saved (${getContactCount()})</button>` 
                : ''
            }
        </div>
    `;
    list.appendChild(controls);

    // Event listeners
    document.getElementById('save-all-contacts')?.addEventListener('click', saveAllPhones);
    document.getElementById('export-contacts-csv')?.addEventListener('click', exportContactsCSV);
    document.getElementById('clear-all-contacts')?.addEventListener('click', () => {
        if (confirm(`Clear all ${getContactCount()} saved contacts? This cannot be undone.`)) {
            clearContactDB();
            showAlert('info', 'All saved contacts cleared.');
            renderManagerStatus();
        }
    });
}


// ── Save phone from a single input ───────────────────────────────

function savePhoneFromInput(input) {
    const phone = input.value.trim();
    if (!phone) return;

    const policies = JSON.parse(input.dataset.policies || '[]');
    const clientName = input.dataset.client;
    const db = loadContactDB();

    policies.forEach(p => { db[p] = phone; });
    saveContactDB(db);

    // Update status indicator
    const statusEl = document.getElementById(`status-${input.id}`);
    if (statusEl) {
        statusEl.textContent = 'Saved ✓';
        statusEl.classList.add('saved');
    }

    // Update icon
    const icon = input.parentElement.querySelector('.phone-icon');
    if (icon) icon.textContent = '✅';

    // Dynamically update WhatsApp button
    updateWhatsAppButton(input, phone, clientName);
}


// ── Save all phones at once ──────────────────────────────────────

function saveAllPhones() {
    const inputs = document.querySelectorAll('.phone-input');
    const db = loadContactDB();
    let saved = 0;

    inputs.forEach(input => {
        const phone = input.value.trim();
        if (phone) {
            const policies = JSON.parse(input.dataset.policies || '[]');
            policies.forEach(p => { db[p] = phone; saved++; });

            const statusEl = document.getElementById(`status-${input.id}`);
            if (statusEl) {
                statusEl.textContent = 'Saved ✓';
                statusEl.classList.add('saved');
            }
            const icon = input.parentElement.querySelector('.phone-icon');
            if (icon) icon.textContent = '✅';

            updateWhatsAppButton(input, phone, input.dataset.client);
        }
    });

    saveContactDB(db);

    if (saved > 0) {
        showAlert('success', `💾 Saved phone numbers for ${saved} policies!`);
    } else {
        showAlert('warning', 'No phone numbers to save. Enter numbers first.');
    }

    renderManagerStatus();
}


// ── Update WhatsApp button dynamically ───────────────────────────

function updateWhatsAppButton(input, phone, clientName) {
    // Walk up to find the client card
    const card = input.closest('.client-card');
    if (!card) return;

    const btnRow = card.querySelector('.btn-row');
    const msgTextarea = card.querySelector('.msg-preview');
    if (!btnRow || !msgTextarea) return;

    const waPhone = normalizePhone(phone);
    if (!waPhone) return;

    const waLink = whatsappLink(waPhone, msgTextarea.value);
    const firstName = (clientName || 'Client').split(' ')[0];
    const cardId = card.id;

    btnRow.innerHTML = `
        <a href="${waLink}" target="_blank" class="btn btn-primary">💬 WhatsApp ${escapeHtml(firstName)}</a>
        <button class="btn btn-secondary btn-copy" data-msg="${cardId}">📋 Copy Message</button>
    `;

    // Remove no-phone notice
    const noPhoneDiv = card.querySelector('.no-phone-info');
    if (noPhoneDiv) noPhoneDiv.remove();

    // Re-attach copy listener
    const copyBtn = btnRow.querySelector('.btn-copy');
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(msgTextarea.value).then(() => {
                copyBtn.textContent = '✅ Copied!';
                copyBtn.classList.add('copied');
                setTimeout(() => {
                    copyBtn.textContent = '📋 Copy Message';
                    copyBtn.classList.remove('copied');
                }, 2000);
            });
        });
    }
}


// ── Export contacts as CSV ───────────────────────────────────────

function exportContactsCSV() {
    const db = loadContactDB();
    const entries = Object.entries(db);

    if (!entries.length) {
        showAlert('warning', 'No saved contacts to export.');
        return;
    }

    const csv = 'Policy Number,Phone Number\n' +
        entries.map(([policy, phone]) => `${policy},${phone}`).join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lic_contacts_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    showAlert('success', `📤 Exported ${entries.length} contacts as CSV`);
}


// ── Bulk import handler ──────────────────────────────────────────

async function handleBulkImport(file) {
    try {
        const { headers, rows } = await parseFile(file);
        const colMap = autoMapColumns(headers);

        const hasPolicy = Object.values(colMap).includes('Policy Number');
        const hasPhone  = Object.values(colMap).includes('Phone Number');

        // Also check for name-based matching
        const hasName = Object.values(colMap).includes('Client Name');

        if (!hasPolicy && !hasName) {
            showAlert('error', `File must have a Policy Number or Client Name column.<br>Found: ${headers.join(', ')}`);
            return;
        }

        if (!hasPhone) {
            // Broader check
            const lowerHeaders = headers.map(h => h.toLowerCase());
            const phoneAliases = ['phone', 'mobile', 'contact', 'cell', 'telephone', 'whatsapp'];
            const hasPhoneBroad = phoneAliases.some(a => lowerHeaders.some(h => h.includes(a)));

            if (!hasPhoneBroad) {
                showAlert('error', `File must have a Phone Number column.<br>Found: ${headers.join(', ')}`);
                return;
            }
        }

        const db = loadContactDB();
        let added = 0;

        rows.forEach(row => {
            const obj = {};
            headers.forEach((h, i) => {
                const std = colMap[h];
                if (std) obj[std] = (row[i] || '').trim();
            });

            const policy = obj['Policy Number'];
            const phone  = obj['Phone Number'];
            if (policy && phone && phone.toLowerCase() !== 'nan' && phone !== '') {
                db[policy] = phone;
                added++;
            }
        });

        saveContactDB(db);
        showAlert('success', `✅ Imported ${added} contacts. Total saved: ${Object.keys(db).length}`);
        renderManagerStatus();

    } catch (e) {
        showAlert('error', `Error importing file: ${e.message}`);
    }
}


// ── UI: Manager status panel ─────────────────────────────────────

function renderManagerStatus() {
    const count = getContactCount();
    const container = document.getElementById('manager-status');
    if (!container) return;

    if (count > 0) {
        container.innerHTML = `
            <div class="manager-stat">
                <span class="manager-stat-icon">✅</span>
                <span><strong>${count}</strong> contacts saved in your browser</span>
            </div>
        `;
    } else {
        container.innerHTML = `
            <div class="manager-stat">
                <span class="manager-stat-icon">📭</span>
                <span>No contacts saved yet — import or enter them below</span>
            </div>
        `;
    }
}


// ── Init ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    renderManagerStatus();

    // Bulk import file input
    const importDropzone = document.getElementById('import-dropzone');
    const importInput = document.getElementById('import-input');

    if (importDropzone && importInput) {
        importDropzone.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', (e) => {
            if (e.target.files[0]) handleBulkImport(e.target.files[0]);
        });
    }

    // Portal button
    const portalBtn = document.getElementById('open-portal-btn');
    if (portalBtn) {
        portalBtn.addEventListener('click', () => {
            window.open(LIC_PORTAL_URL, '_blank');
        });
    }
});
