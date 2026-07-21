/* ══════════════════════════════════════════════════════════════════
   LIC Premium Dashboard v2 — Full-Stack Client Application
   ══════════════════════════════════════════════════════════════════ */

const API = '';  // Same origin — Express serves both API and static files


// ── Utilities ────────────────────────────────────────────────────

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatNum(n) {
    return Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatDate(dateStr) {
    if (!dateStr || dateStr === '—') return '—';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `91${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
    if (digits.startsWith('91') && digits.length >= 12) return digits;
    return digits;
}

function whatsappLink(phone, message) {
    const cleaned = normalizePhone(phone);
    if (!cleaned) return '';
    return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}


// ── Alert System ─────────────────────────────────────────────────

function showAlert(type, msg) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const container = document.getElementById('alerts');
    const el = document.createElement('div');
    el.className = `alert alert-${type}`;
    el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
    container.appendChild(el);

    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-8px)';
        el.style.transition = '.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 5000);
}


// ── Tab Navigation ───────────────────────────────────────────────

function initTabs() {
    const tabs = document.querySelectorAll('.tab-btn');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            const target = document.getElementById(`content-${tab.dataset.tab}`);
            if (target) target.classList.add('active');

            // Refresh data when switching tabs
            const tabName = tab.dataset.tab;
            if (tabName === 'dashboard') loadDashboard();
            if (tabName === 'policies')  loadPolicies();
            if (tabName === 'insights')  loadInsights();
            if (tabName === 'upload')    loadUploadHistory();
        });
    });
}


// ── API Helpers ──────────────────────────────────────────────────

async function apiGet(path) {
    const res = await fetch(`${API}${path}`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiPut(path, body) {
    const res = await fetch(`${API}${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiDelete(path) {
    const res = await fetch(`${API}${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
}

async function apiUpload(path, file) {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API}${path}`, { method: 'POST', body: form });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || 'Upload failed');
    }
    return res.json();
}


// ══════════════════════════════════════════════════════════════════
//  DASHBOARD TAB
// ══════════════════════════════════════════════════════════════════

async function loadDashboard() {
    try {
        const stats = await apiGet('/api/stats');
        renderDashboardMetrics(stats);
        renderDashboardAlerts(stats);
        renderRecentUploads(stats.recentUploads);
    } catch (err) {
        console.error('Dashboard load error:', err);
    }
}

function renderDashboardMetrics(stats) {
    // Hero stats
    document.getElementById('stat-policies').textContent = stats.totalPolicies;
    document.getElementById('stat-premium').textContent = `₹${formatNum(stats.totalPremium)}`;
    document.getElementById('stat-collection').textContent = `${stats.collectionRate}%`;

    // Metrics grid
    const el = document.getElementById('dash-metrics');
    el.innerHTML = `
        <div class="metric">
            <div class="metric-icon">👤</div>
            <div class="metric-value">${stats.totalClients}</div>
            <div class="metric-label">Total Clients</div>
        </div>
        <div class="metric">
            <div class="metric-icon">📋</div>
            <div class="metric-value">${stats.totalPolicies}</div>
            <div class="metric-label">Total Policies</div>
        </div>
        <div class="metric">
            <div class="metric-icon">💰</div>
            <div class="metric-value">₹${formatNum(stats.totalPremium)}</div>
            <div class="metric-label">Total Premium</div>
        </div>
        <div class="metric">
            <div class="metric-icon">⚠️</div>
            <div class="metric-value">${stats.overdue}</div>
            <div class="metric-label">Overdue</div>
        </div>
        <div class="metric">
            <div class="metric-icon">❌</div>
            <div class="metric-value">${stats.lapsed}</div>
            <div class="metric-label">Lapsed</div>
        </div>
        <div class="metric">
            <div class="metric-icon">✅</div>
            <div class="metric-value">${stats.paid}</div>
            <div class="metric-label">Paid</div>
        </div>
    `;
}

function renderDashboardAlerts(stats) {
    const el = document.getElementById('dash-alerts');
    el.innerHTML = '';

    if (stats.overdue > 0) {
        showDashAlert(el, 'warning', `⚠️ ${stats.overdue} policies are overdue — go to Insights for details`);
    }
    if (stats.lapsed > 0) {
        showDashAlert(el, 'error', `❌ ${stats.lapsed} policies are at risk of lapsing`);
    }
    if (stats.totalPolicies === 0) {
        showDashAlert(el, 'info', 'ℹ️ No policies yet — go to the Upload tab to import a due list');
    }
}

function showDashAlert(container, type, msg) {
    const div = document.createElement('div');
    div.className = `alert alert-${type}`;
    div.innerHTML = msg;
    container.appendChild(div);
}

function renderRecentUploads(uploads) {
    const card = document.getElementById('recent-uploads-card');
    const body = document.getElementById('recent-uploads-body');

    if (!uploads || !uploads.length) {
        card.style.display = 'none';
        return;
    }

    card.style.display = '';
    body.innerHTML = uploads.map(u => `
        <tr>
            <td>${escapeHtml(u.file_name)}</td>
            <td><span class="mode-tag">${u.upload_type === 'due_list' ? '📋 Due List' : '💰 Commission'}</span></td>
            <td>${u.records_count}</td>
            <td>${formatDate(u.uploaded_at)}</td>
        </tr>
    `).join('');
}


// ══════════════════════════════════════════════════════════════════
//  UPLOAD TAB
// ══════════════════════════════════════════════════════════════════

function initUploads() {
    // Due list upload
    setupDropzone('dropzone-duelist', 'file-duelist', async (file) => {
        const resultEl = document.getElementById('duelist-result');
        resultEl.innerHTML = '<div class="result-box result-success">⏳ Processing due list...</div>';

        try {
            const result = await apiUpload('/api/upload/duelist', file);
            resultEl.innerHTML = `
                <div class="result-box result-success">
                    ✅ ${result.message}<br>
                    <small>Total records: ${result.total}</small>
                </div>
            `;
            showAlert('success', `Due list uploaded — ${result.inserted} new, ${result.updated} updated`);
            loadDashboard();
        } catch (err) {
            resultEl.innerHTML = `<div class="result-box result-error">❌ ${escapeHtml(err.message)}</div>`;
            showAlert('error', err.message);
        }
    });

    // Commission upload
    setupDropzone('dropzone-commission', 'file-commission', async (file) => {
        const resultEl = document.getElementById('commission-result');
        resultEl.innerHTML = '<div class="result-box result-success">⏳ Processing commissions...</div>';

        try {
            const result = await apiUpload('/api/upload/commission', file);
            let html = `
                <div class="result-box result-success">
                    ✅ ${result.message}<br>
                    <small>Total records: ${result.total}</small>
                </div>
            `;
            if (result.unmatchedPolicies && result.unmatchedPolicies.length) {
                html += `
                    <div class="result-box result-error" style="margin-top:.4rem">
                        ⚠️ Unmatched policy numbers: ${result.unmatchedPolicies.map(p => escapeHtml(p)).join(', ')}
                    </div>
                `;
            }
            resultEl.innerHTML = html;
            showAlert('success', `Commissions processed — ${result.matched} matched, FUP dates advanced`);
            loadDashboard();
        } catch (err) {
            resultEl.innerHTML = `<div class="result-box result-error">❌ ${escapeHtml(err.message)}</div>`;
            showAlert('error', err.message);
        }
    });
}

function setupDropzone(dropzoneId, fileInputId, handler) {
    const dropzone = document.getElementById(dropzoneId);
    const fileInput = document.getElementById(fileInputId);
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handler(e.target.files[0]);
        fileInput.value = '';
    });

    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]);
    });
}

async function loadUploadHistory() {
    try {
        const data = await apiGet('/api/upload/history');
        const body = document.getElementById('upload-history-body');
        if (!data.uploads || !data.uploads.length) {
            body.innerHTML = '<tr><td colspan="4" style="text-align:center; color:var(--text-muted)">No uploads yet</td></tr>';
            return;
        }
        body.innerHTML = data.uploads.map(u => `
            <tr>
                <td>${escapeHtml(u.file_name)}</td>
                <td><span class="mode-tag">${u.upload_type === 'due_list' ? '📋 Due List' : '💰 Commission'}</span></td>
                <td>${u.records_count}</td>
                <td>${formatDate(u.uploaded_at)}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Upload history error:', err);
    }
}


// ══════════════════════════════════════════════════════════════════
//  POLICY DATABASE TAB
// ══════════════════════════════════════════════════════════════════

let policyDebounce = null;

function initPolicyFilters() {
    const search = document.getElementById('policy-search');
    const filterMode = document.getElementById('filter-mode');
    const filterStatus = document.getElementById('filter-status');
    const exportBtn = document.getElementById('export-csv-btn');

    const reload = () => {
        clearTimeout(policyDebounce);
        policyDebounce = setTimeout(loadPolicies, 300);
    };

    if (search) search.addEventListener('input', reload);
    if (filterMode) filterMode.addEventListener('change', reload);
    if (filterStatus) filterStatus.addEventListener('change', reload);

    if (exportBtn) {
        exportBtn.addEventListener('click', exportPoliciesCsv);
    }
}

async function loadPolicies() {
    try {
        const search = document.getElementById('policy-search')?.value || '';
        const mode = document.getElementById('filter-mode')?.value || '';
        const status = document.getElementById('filter-status')?.value || '';

        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (mode) params.set('mode', mode);
        if (status) params.set('status', status);
        params.set('sort', 'updated_at');
        params.set('order', 'desc');

        const data = await apiGet(`/api/policies?${params}`);
        renderPolicyTable(data.policies);
    } catch (err) {
        console.error('Policy load error:', err);
        showAlert('error', 'Could not load policies');
    }
}

function renderPolicyTable(policies) {
    const body = document.getElementById('policy-table-body');
    const empty = document.getElementById('policy-empty');

    if (!policies.length) {
        body.innerHTML = '';
        empty.classList.remove('hidden');
        return;
    }

    empty.classList.add('hidden');

    body.innerHTML = policies.map(p => {
        const statusClass = `status-${p.status.toLowerCase()}`;
        const statusIcons = { Active: '🔵', Paid: '✅', Overdue: '⚠️', Lapsed: '❌' };
        const waPhone = normalizePhone(p.phone);

        return `
            <tr>
                <td><strong>${escapeHtml(p.client_name)}</strong></td>
                <td class="font-mono">${escapeHtml(p.policy_number)}</td>
                <td class="text-right">₹${formatNum(p.premium_amount)}</td>
                <td><span class="mode-tag">${escapeHtml(p.premium_mode)}</span></td>
                <td>${formatDate(p.fup_date)}</td>
                <td>${formatDate(p.next_due_date)}</td>
                <td><span class="status-badge ${statusClass}">${statusIcons[p.status] || ''} ${p.status}</span></td>
                <td>${p.phone ? escapeHtml(p.phone) : '<span style="color:var(--text-muted)">—</span>'}</td>
                <td>
                    <div style="display:flex; gap:.3rem">
                        <button class="btn-icon" onclick="openPolicyModal(${p.id})" title="Edit">✏️</button>
                        ${waPhone ? `<a class="btn-icon" href="${whatsappLink(waPhone, buildReminder(p))}" target="_blank" title="WhatsApp">💬</a>` : ''}
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function buildReminder(policy) {
    const name = policy.client_name || 'Client';
    return (
        `Hi ${name},\n\n` +
        `This is a friendly reminder regarding your LIC policy ` +
        `*No. ${policy.policy_number}*.\n` +
        `The premium of *₹${formatNum(policy.premium_amount)}* is due on ` +
        `*${formatDate(policy.next_due_date || policy.fup_date)}*.\n\n` +
        `Please clear the payment at the earliest to keep your ` +
        `policy active. Let me know if you need any assistance!`
    );
}


// ── Policy Modal ─────────────────────────────────────────────────

async function openPolicyModal(id) {
    const modal = document.getElementById('policy-modal');
    const body = document.getElementById('modal-body');
    const title = document.getElementById('modal-title');

    try {
        const data = await apiGet(`/api/policies/${id}`);
        const p = data.policy;
        const comms = data.commissions || [];

        title.textContent = `${p.client_name} — ${p.policy_number}`;

        let commHtml = '';
        if (comms.length) {
            commHtml = `
                <div class="commission-history">
                    <h4>💰 Commission History (${comms.length})</h4>
                    ${comms.map(c => `
                        <div class="commission-item">
                            <span>₹${formatNum(c.commission_amount)}</span>
                            <span>${formatDate(c.payment_date)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        body.innerHTML = `
            <div class="modal-row">
                <div class="modal-field">
                    <label>Client Name</label>
                    <input type="text" id="edit-name" value="${escapeHtml(p.client_name)}">
                </div>
                <div class="modal-field">
                    <label>Policy Number</label>
                    <input type="text" value="${escapeHtml(p.policy_number)}" disabled>
                </div>
            </div>
            <div class="modal-row">
                <div class="modal-field">
                    <label>Premium Amount</label>
                    <input type="number" id="edit-amount" value="${p.premium_amount}">
                </div>
                <div class="modal-field">
                    <label>Premium Mode</label>
                    <select id="edit-mode">
                        ${['Monthly','Quarterly','Half-Yearly','Yearly'].map(m =>
                            `<option value="${m}" ${m === p.premium_mode ? 'selected' : ''}>${m}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
            <div class="modal-row">
                <div class="modal-field">
                    <label>Phone Number</label>
                    <input type="tel" id="edit-phone" value="${escapeHtml(p.phone || '')}" placeholder="e.g. 9876543210">
                </div>
                <div class="modal-field">
                    <label>Status</label>
                    <select id="edit-status">
                        ${['Active','Paid','Overdue','Lapsed'].map(s =>
                            `<option value="${s}" ${s === p.status ? 'selected' : ''}>${s}</option>`
                        ).join('')}
                    </select>
                </div>
            </div>
            <div class="modal-row">
                <div class="modal-field">
                    <label>FUP Date</label>
                    <input type="date" id="edit-fup" value="${p.fup_date || ''}">
                </div>
                <div class="modal-field">
                    <label>Next Due Date</label>
                    <input type="date" id="edit-nextdue" value="${p.next_due_date || ''}">
                </div>
            </div>
            ${commHtml}
            <div class="modal-actions">
                <button class="btn btn-danger btn-sm" onclick="deletePolicy(${p.id})">🗑️ Delete</button>
                <button class="btn btn-secondary btn-sm" id="modal-close-btn">Cancel</button>
                <button class="btn btn-primary btn-sm" onclick="savePolicy(${p.id})">💾 Save Changes</button>
            </div>
        `;

        document.getElementById('modal-close-btn').addEventListener('click', closePolicyModal);
        modal.classList.remove('hidden');
    } catch (err) {
        showAlert('error', 'Could not load policy details');
        console.error(err);
    }
}

function closePolicyModal() {
    document.getElementById('policy-modal').classList.add('hidden');
}

async function savePolicy(id) {
    try {
        const body = {
            client_name:    document.getElementById('edit-name').value.trim(),
            premium_amount: parseFloat(document.getElementById('edit-amount').value) || 0,
            premium_mode:   document.getElementById('edit-mode').value,
            phone:          document.getElementById('edit-phone').value.trim(),
            status:         document.getElementById('edit-status').value,
            fup_date:       document.getElementById('edit-fup').value,
            next_due_date:  document.getElementById('edit-nextdue').value,
        };

        await apiPut(`/api/policies/${id}`, body);
        showAlert('success', 'Policy updated successfully');
        closePolicyModal();
        loadPolicies();
    } catch (err) {
        showAlert('error', 'Failed to update policy');
        console.error(err);
    }
}

async function deletePolicy(id) {
    if (!confirm('Are you sure you want to delete this policy?')) return;

    try {
        await apiDelete(`/api/policies/${id}`);
        showAlert('success', 'Policy deleted');
        closePolicyModal();
        loadPolicies();
    } catch (err) {
        showAlert('error', 'Failed to delete policy');
        console.error(err);
    }
}


// ── CSV Export ────────────────────────────────────────────────────

async function exportPoliciesCsv() {
    try {
        const search = document.getElementById('policy-search')?.value || '';
        const mode = document.getElementById('filter-mode')?.value || '';
        const status = document.getElementById('filter-status')?.value || '';

        const params = new URLSearchParams();
        if (search) params.set('search', search);
        if (mode) params.set('mode', mode);
        if (status) params.set('status', status);

        const data = await apiGet(`/api/policies?${params}`);

        if (!data.policies.length) {
            showAlert('warning', 'No policies to export');
            return;
        }

        const cols = ['client_name', 'policy_number', 'premium_amount', 'premium_mode', 'fup_date', 'next_due_date', 'status', 'phone'];
        const headers = ['Client Name', 'Policy Number', 'Premium Amount', 'Premium Mode', 'FUP Date', 'Next Due Date', 'Status', 'Phone'];

        const escapeCsv = (v) => {
            const s = v == null ? '' : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };

        const lines = [headers.map(escapeCsv).join(',')];
        for (const p of data.policies) {
            lines.push(cols.map(c => escapeCsv(p[c])).join(','));
        }

        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `lic_policies_${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showAlert('success', `Exported ${data.policies.length} policies to CSV`);
    } catch (err) {
        showAlert('error', 'Export failed');
        console.error(err);
    }
}


// ══════════════════════════════════════════════════════════════════
//  INSIGHTS TAB
// ══════════════════════════════════════════════════════════════════

async function loadInsights() {
    try {
        const data = await apiGet('/api/stats/insights');
        const grid = document.getElementById('insights-grid');
        const empty = document.getElementById('insights-empty');

        if (!data.insights.length) {
            grid.innerHTML = '';
            empty.classList.remove('hidden');
            return;
        }

        empty.classList.add('hidden');

        grid.innerHTML = data.insights.map(insight => {
            let dataHtml = '';

            if (insight.data && Array.isArray(insight.data)) {
                const items = insight.data.slice(0, 6);
                dataHtml = `
                    <ul class="insight-data-list">
                        ${items.map(item => {
                            // Handle different data shapes
                            if (item.policy_number && item.client_name) {
                                return `<li>
                                    <span>${escapeHtml(item.client_name)} (${escapeHtml(item.policy_number)})</span>
                                    <span>${item.premium_amount ? '₹' + formatNum(item.premium_amount) : ''}${item.commission_amount ? '₹' + formatNum(item.commission_amount) : ''}${item.total_premium ? '₹' + formatNum(item.total_premium) : ''}</span>
                                </li>`;
                            }
                            if (item.premium_mode) {
                                return `<li><span>${item.premium_mode}</span><span>${item.count} policies</span></li>`;
                            }
                            if (item.client_name && item.policies) {
                                return `<li><span>${escapeHtml(item.client_name)}</span><span>${item.policies} policies — ₹${formatNum(item.total_premium)}</span></li>`;
                            }
                            return `<li>${JSON.stringify(item)}</li>`;
                        }).join('')}
                    </ul>
                `;
            }

            return `
                <div class="insight-card type-${insight.type}">
                    <div class="insight-card-head">
                        <span class="insight-card-icon">${insight.icon}</span>
                        <span class="insight-card-title">${escapeHtml(insight.title)}</span>
                    </div>
                    <div class="insight-card-desc">${escapeHtml(insight.description)}</div>
                    ${dataHtml}
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Insights load error:', err);
    }
}


// ══════════════════════════════════════════════════════════════════
//  INITIALIZATION
// ══════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initUploads();
    initPolicyFilters();

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closePolicyModal);
    document.getElementById('policy-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closePolicyModal();
    });

    // Load initial dashboard data
    loadDashboard();
});

// Expose modal functions globally for inline onclick handlers
window.openPolicyModal = openPolicyModal;
window.savePolicy = savePolicy;
window.deletePolicy = deletePolicy;
