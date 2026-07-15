/* ══════════════════════════════════════════════════════════════════
   Solution 3: Lazy Match — Inline Phone Input with Memory
   Agent types phone numbers next to each client. Numbers are saved
   to localStorage and auto-fill on future uploads.
   ══════════════════════════════════════════════════════════════════ */

const PHONE_DB_KEY = 'lic_client_phones';

// ── Phone DB CRUD ────────────────────────────────────────────────

function loadPhoneDB() {
    try {
        const raw = localStorage.getItem(PHONE_DB_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function savePhoneDB(db) {
    localStorage.setItem(PHONE_DB_KEY, JSON.stringify(db));
}

function clearPhoneDB() {
    localStorage.removeItem(PHONE_DB_KEY);
}


// ── Hook: render phone input inside each client card ─────────────
// Called by app.js renderActions() for each client

function renderPhoneInput(name, records, existingPhone) {
    const db = loadPhoneDB();
    const policies = records.map(r => String(r['Policy Number']).trim());

    // Find saved phone for any policy in this group
    let savedPhone = '';
    for (const p of policies) {
        if (db[p]) { savedPhone = db[p]; break; }
    }

    const phone = existingPhone || savedPhone;
    const inputId = `phone-input-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const statusText = phone ? '✅ Saved' : '📝 Enter number';

    return `
        <div class="phone-row">
            <span style="font-size:.85rem;color:var(--text-sec);">📱</span>
            <input type="tel" class="phone-input" id="${inputId}"
                   placeholder="e.g. 9876543210"
                   value="${phone}"
                   data-policies='${JSON.stringify(policies)}'
                   data-client="${name}">
            <span class="phone-status" style="font-size:.75rem;color:var(--text-muted)">${statusText}</span>
        </div>
    `;
}


// ── Hook: get phone for WhatsApp link ────────────────────────────
// Called by app.js renderActions() to get the phone for WhatsApp buttons

function getPhoneForClient(name, records) {
    const db = loadPhoneDB();
    for (const r of records) {
        const policy = String(r['Policy Number']).trim();
        if (db[policy]) return db[policy];
    }
    return null;
}


// ── Hook: render save button after all action cards ──────────────
// Called by app.js renderActions() at the end

function renderAfterActions(groups) {
    const list = document.getElementById('action-list');
    const db = loadPhoneDB();
    const totalSaved = Object.keys(db).length;

    const saveSection = document.createElement('div');
    saveSection.style.marginTop = '1.25rem';
    saveSection.innerHTML = `
        <button class="btn-save-all" id="save-all-phones">
            💾 Save All Phone Numbers
        </button>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.6rem;">
            <span style="color:var(--text-muted);font-size:.8rem">
                ${totalSaved} phone numbers saved in your browser
            </span>
            ${totalSaved > 0 ? `<button class="btn btn-danger" id="clear-phones-btn">🗑️ Clear All</button>` : ''}
        </div>
    `;
    list.appendChild(saveSection);

    // Save all button
    document.getElementById('save-all-phones').addEventListener('click', () => {
        const inputs = document.querySelectorAll('.phone-input');
        const db = loadPhoneDB();
        let saved = 0;

        inputs.forEach(input => {
            const phone = input.value.trim();
            if (phone) {
                const policies = JSON.parse(input.dataset.policies || '[]');
                policies.forEach(p => {
                    db[p] = phone;
                    saved++;
                });

                // Update status indicator
                const status = input.parentElement.querySelector('.phone-status');
                if (status) {
                    status.textContent = '✅ Saved';
                    status.style.color = 'var(--success)';
                }
            }
        });

        savePhoneDB(db);

        if (saved > 0) {
            showAlert('success', `💾 Saved phone numbers for ${saved} policies! They'll auto-fill next time.`);

            // Update WhatsApp buttons dynamically
            inputs.forEach(input => {
                const phone = input.value.trim();
                if (!phone) return;

                const clientName = input.dataset.client;
                const cardId = `card-${clientName.replace(/\s+/g, '_')}`;
                const card = document.getElementById(cardId);
                if (!card) return;

                const btnRow = card.querySelector('.btn-row');
                const msgTextarea = card.querySelector('.msg-preview');
                if (!btnRow || !msgTextarea) return;

                // Rebuild button row with WhatsApp link
                let cleaned = phone.replace(/[\s\-()]/g, '');
                if (!cleaned.startsWith('+') && !cleaned.startsWith('91')) {
                    cleaned = '91' + cleaned;
                }
                const waLink = `https://wa.me/${cleaned}?text=${encodeURIComponent(msgTextarea.value)}`;

                btnRow.innerHTML = `
                    <a href="${waLink}" target="_blank" class="btn btn-primary">💬 WhatsApp ${clientName.split(' ')[0]}</a>
                    <button class="btn btn-secondary btn-copy" data-msg="${cardId}">📋 Copy Message</button>
                `;

                // Re-attach copy listener
                btnRow.querySelector('.btn-copy').addEventListener('click', function() {
                    navigator.clipboard.writeText(msgTextarea.value).then(() => {
                        this.textContent = '✅ Copied!';
                        this.classList.add('copied');
                        setTimeout(() => {
                            this.textContent = '📋 Copy Message';
                            this.classList.remove('copied');
                        }, 2000);
                    });
                });
            });
        } else {
            showAlert('warning', 'No phone numbers entered to save.');
        }
    });

    // Clear all button
    const clearBtn = document.getElementById('clear-phones-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (confirm('Clear all saved phone numbers?')) {
                clearPhoneDB();
                showAlert('info', 'All saved phone numbers cleared.');
                // Clear input values
                document.querySelectorAll('.phone-input').forEach(input => {
                    input.value = '';
                    const status = input.parentElement.querySelector('.phone-status');
                    if (status) {
                        status.textContent = '📝 Enter number';
                        status.style.color = 'var(--text-muted)';
                    }
                });
            }
        });
    }
}


// ── Sidebar: Saved contacts info ─────────────────────────────────

function renderPhoneSidebar() {
    const panel = document.getElementById('upload-section');
    if (!panel) return;

    const db = loadPhoneDB();
    const count = Object.keys(db).length;
    if (count === 0) return;

    // Insert info after the upload section
    const info = document.createElement('div');
    info.className = 'sidebar-panel';
    info.innerHTML = `
        <h3>📱 Saved Phone Numbers</h3>
        <div class="sidebar-stat">✅ ${count} numbers remembered</div>
        <p style="margin-top:.5rem">Phone numbers you've entered previously will auto-fill when you upload a new due list.</p>
    `;
    panel.parentElement.insertBefore(info, panel.nextSibling);
}


// ── Init ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    renderPhoneSidebar();
});
