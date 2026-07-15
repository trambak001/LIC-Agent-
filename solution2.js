/* ══════════════════════════════════════════════════════════════════
   Solution 2: Portal Contact Import
   Since Selenium can't run in a browser, this solution lets the
   agent export contacts from the LIC portal and upload that file.
   Phone numbers are cached in localStorage for reuse.
   ══════════════════════════════════════════════════════════════════ */

const PORTAL_CACHE_KEY = 'lic_portal_contacts';

// ── Cache CRUD ───────────────────────────────────────────────────

function loadPortalCache() {
    try {
        const raw = localStorage.getItem(PORTAL_CACHE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
}

function savePortalCache(cache) {
    localStorage.setItem(PORTAL_CACHE_KEY, JSON.stringify(cache));
}

function clearPortalCache() {
    localStorage.removeItem(PORTAL_CACHE_KEY);
}


// ── Parse portal export file ─────────────────────────────────────

async function handlePortalFile(file) {
    try {
        const { headers, rows } = await parseFile(file);
        const colMap = autoMapColumns(headers);

        const hasPolicy = Object.values(colMap).includes('Policy Number');
        const hasPhone  = Object.values(colMap).includes('Phone Number');

        if (!hasPolicy || !hasPhone) {
            // Try broader matching — portal exports may use different column names
            const lowerHeaders = headers.map(h => h.toLowerCase());
            const phoneAliases = ['phone', 'mobile', 'contact', 'phone number', 'mobile number', 'cell', 'telephone'];
            const policyAliases = ['policy', 'policyno', 'policy number', 'policy no', 'policy_number', 'pol no'];

            const hasPhoneBroad = phoneAliases.some(a => lowerHeaders.some(h => h.includes(a)));
            const hasPolicyBroad = policyAliases.some(a => lowerHeaders.some(h => h.includes(a)));

            if (!hasPhoneBroad || !hasPolicyBroad) {
                showAlert('error',
                    `Portal export must have columns for Policy Number and Phone Number.<br>` +
                    `Found: ${headers.join(', ')}`
                );
                return;
            }
        }

        const cache = loadPortalCache();
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
                cache[policy] = phone;
                added++;
            }
        });

        savePortalCache(cache);
        showAlert('success', `✅ Portal contacts imported — ${added} entries. Total cached: ${Object.keys(cache).length}`);
        renderPortalStatus();

    } catch (e) {
        showAlert('error', `Error reading portal export: ${e.message}`);
    }
}


// ── Hook: merge phone numbers from portal cache ──────────────────

function mergePhoneNumbers(data) {
    const cache = loadPortalCache();
    if (!Object.keys(cache).length) return data;

    let matched = 0;
    data.forEach(record => {
        if (!record['Phone Number'] || record['Phone Number'].toLowerCase() === 'nan') {
            const policy = String(record['Policy Number']).trim();
            const phone = cache[policy];
            if (phone) {
                record['Phone Number'] = phone;
                matched++;
            }
        }
    });

    const total = data.length;
    if (matched > 0 && matched < total) {
        showAlert('warning', `🔗 Matched ${matched}/${total} policies from portal cache. ${total - matched} still missing.`);
    } else if (matched === total) {
        showAlert('success', `🎉 All ${total} policies matched from portal cache!`);
    } else if (matched === 0 && !data.some(d => d['Phone Number'])) {
        showAlert('info', '📋 Upload your portal contact export above to auto-match phone numbers.');
    }

    return data;
}


// ── UI: Portal status ────────────────────────────────────────────

function renderPortalStatus() {
    const cache = loadPortalCache();
    const count = Object.keys(cache).length;
    const container = document.getElementById('portal-status');

    if (count > 0) {
        container.innerHTML = `
            <div class="sidebar-stat">📦 ${count} contacts cached</div>
            <button class="btn btn-danger" id="clear-portal-btn">🗑️ Clear Cache</button>
        `;
        document.getElementById('clear-portal-btn').addEventListener('click', () => {
            if (confirm('Clear all cached portal contacts?')) {
                clearPortalCache();
                renderPortalStatus();
                showAlert('info', 'Portal cache cleared.');
            }
        });
    } else {
        container.innerHTML = `<div style="color:var(--text-muted);font-size:.82rem;margin-bottom:.5rem">No portal contacts cached yet</div>`;
    }
}


// ── Init ─────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    renderPortalStatus();

    const portalDropzone = document.getElementById('portal-dropzone');
    const portalInput = document.getElementById('portal-input');

    portalDropzone.addEventListener('click', () => portalInput.click());
    portalInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handlePortalFile(e.target.files[0]);
    });
});
