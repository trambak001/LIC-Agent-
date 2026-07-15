/* ══════════════════════════════════════════════════════════════════
   LIC Premium Reminder Dashboard — Core Application Logic
   ══════════════════════════════════════════════════════════════════ */

// ── Configuration ────────────────────────────────────────────────
const COLUMN_ALIASES = {
    'Client Name':    ['name of assured', 'client name', 'name', 'assured name'],
    'Policy Number':  ['policyno', 'policy number', 'policy no', 'policy_number'],
    'Premium Amount': ['totprem', 'total premium', 'premium amount', 'instprem'],
    'Due Date':       ['fup', 'due date', 'due_date', 'premium due date'],
    'Phone Number':   ['phone number', 'phone', 'mobile', 'contact', 'mobile number'],
};

const REQUIRED_COLS = ['Client Name', 'Policy Number', 'Premium Amount', 'Due Date'];
const GITHUB_REPO = 'trambak001/LIC-Agent-';
const GITHUB_BRANCH_URL = `https://api.github.com/repos/${GITHUB_REPO}/branches?per_page=100`;
const GITHUB_RAW_URL = `https://raw.githubusercontent.com/${GITHUB_REPO}/`;

const loadedBranches = [];


// ── Utilities ────────────────────────────────────────────────────

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}


function slugify(value) {
    const base = String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return base || 'client';
}


function getFirstPhone(records) {
    for (const record of records) {
        const phone = String(record['Phone Number'] || '').trim();
        if (phone && phone.toLowerCase() !== 'nan') return phone;
    }
    return '';
}


function normalizePhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    if (digits.length === 10) return `91${digits}`;
    if (digits.length === 11 && digits.startsWith('0')) return `91${digits.slice(1)}`;
    if (digits.startsWith('91') && digits.length >= 12) return digits;
    return digits;
}


async function loadRepoBranches() {
    const status = document.getElementById('branches-status');
    const select = document.getElementById('branch-select');
    const list = document.getElementById('branches-list');
    const previewButton = document.getElementById('preview-branch-button');

    if (!status || !select || !list || !previewButton) return;

    status.textContent = 'Loading branches from GitHub…';
    select.innerHTML = '';
    list.innerHTML = '';
    loadedBranches.length = 0;

    try {
        const response = await fetch(GITHUB_BRANCH_URL, { headers: { Accept: 'application/vnd.github+json' } });
        if (!response.ok) {
            throw new Error(`GitHub responded with ${response.status}`);
        }

        const branches = await response.json();
        branches.forEach(branch => {
            const branchInfo = {
                name: branch.name,
                url: `https://github.com/${GITHUB_REPO}/tree/${encodeURIComponent(branch.name)}`,
                rawIndexUrl: `${GITHUB_RAW_URL}${encodeURIComponent(branch.name)}/index.html`,
            };
            loadedBranches.push(branchInfo);

            const option = document.createElement('option');
            option.value = branchInfo.name;
            option.textContent = branchInfo.name;
            select.appendChild(option);

            const item = document.createElement('article');
            item.className = 'branch-item';
            item.innerHTML = `
                <div class="branch-item-copy">
                    <div class="branch-item-name">${escapeHtml(branchInfo.name)}</div>
                    <div class="branch-item-desc">Standard branch from GitHub</div>
                </div>
                <div class="branch-item-actions">
                    <a href="${branchInfo.url}" target="_blank" rel="noreferrer" class="branch-link">Open branch</a>
                    <button type="button" class="branch-link branch-link-button" data-branch="${escapeHtml(branchInfo.name)}">Preview here</button>
                    <a href="${branchInfo.url}/commits" target="_blank" rel="noreferrer" class="branch-link">History</a>
                </div>
            `;
            list.appendChild(item);
        });

        status.textContent = `Found ${loadedBranches.length} live branches in ${GITHUB_REPO}.`;
        select.value = loadedBranches[0]?.name || '';
        if (loadedBranches[0]) {
            openBranchPreview(loadedBranches[0].name);
        }

        list.querySelectorAll('.branch-link-button').forEach(button => {
            button.addEventListener('click', () => {
                const branchName = button.getAttribute('data-branch');
                if (branchName) {
                    select.value = branchName;
                    openBranchPreview(branchName);
                }
            });
        });
    } catch (error) {
        status.textContent = 'Could not load GitHub branches right now.';
        list.innerHTML = '<div class="branches-empty">Branch list unavailable. Open a branch on GitHub using the links below.</div>';
        console.error(error);
    }

    previewButton.disabled = !loadedBranches.length;
}


async function openBranchPreview(branchName) {
    const branch = loadedBranches.find(item => item.name === branchName);
    const iframe = document.getElementById('branch-preview-frame');
    const label = document.getElementById('branch-preview-label');
    const openLink = document.getElementById('branch-preview-open');

    if (!branch || !iframe || !label || !openLink) return;

    label.textContent = branch.name;
    openLink.href = branch.url;

    try {
        const response = await fetch(branch.rawIndexUrl);
        if (!response.ok) {
            throw new Error(`Unable to fetch ${branch.name} index.html (${response.status})`);
        }

        const html = await response.text();
        const parsed = new DOMParser().parseFromString(html, 'text/html');
        const branchRoot = `${GITHUB_RAW_URL}${encodeURIComponent(branch.name)}/`;

        const localStyles = [...parsed.querySelectorAll('link[rel="stylesheet"]')]
            .filter(link => {
                const href = link.getAttribute('href') || '';
                return href && !/^https?:\/\//i.test(href) && !href.startsWith('//');
            });

        for (const link of localStyles) {
            const href = link.getAttribute('href') || '';
            const cssUrl = new URL(href, branchRoot).href;
            const cssResponse = await fetch(cssUrl);
            if (!cssResponse.ok) {
                throw new Error(`Unable to fetch ${href} (${cssResponse.status})`);
            }
            const cssText = await cssResponse.text();
            const styleTag = parsed.createElement('style');
            styleTag.textContent = cssText;
            link.replaceWith(styleTag);
        }

        const localScripts = [...parsed.querySelectorAll('script[src]')]
            .filter(script => {
                const src = script.getAttribute('src') || '';
                return src && !/^https?:\/\//i.test(src) && !src.startsWith('//');
            });

        for (const script of localScripts) {
            const src = script.getAttribute('src') || '';
            const scriptUrl = new URL(src, branchRoot).href;
            const scriptResponse = await fetch(scriptUrl);
            if (!scriptResponse.ok) {
                throw new Error(`Unable to fetch ${src} (${scriptResponse.status})`);
            }
            const scriptText = await scriptResponse.text();
            const inlineScript = parsed.createElement('script');
            inlineScript.textContent = scriptText;
            script.replaceWith(inlineScript);
        }

        iframe.srcdoc = '<!doctype html>' + parsed.documentElement.outerHTML;
    } catch (error) {
        iframe.srcdoc = `
            <!doctype html>
            <html lang="en">
            <head>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: Arial, sans-serif; margin: 0; padding: 24px; background: #fff7f8; color: #8b1e2d; }
                    .error-box { border: 1px solid rgba(139, 30, 45, .18); background: #fff; border-radius: 16px; padding: 20px; }
                    .error-title { font-weight: 700; margin-bottom: 8px; }
                </style>
            </head>
            <body>
                <div class="error-box">
                    <div class="error-title">Preview unavailable for ${escapeHtml(branch.name)}</div>
                    <div>${escapeHtml(error.message)}</div>
                </div>
            </body>
            </html>
        `;
    }
}


// ── File Parsing ─────────────────────────────────────────────────

async function parseFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv')) {
        const text = await file.text();
        return parseCSV(text);
    } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const buffer = await file.arrayBuffer();
        return parseExcel(buffer);
    } else if (name.endsWith('.pdf')) {
        const buffer = await file.arrayBuffer();
        return await parsePDF(buffer);
    }
    throw new Error('Unsupported file type. Use Excel, CSV, or PDF.');
}


function parseCSV(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw new Error('CSV file is empty or has no data rows.');

    const parseLine = (line) => {
        const cells = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                cells.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        cells.push(current.trim());
        return cells.map(cell => cell.replace(/^"|"$/g, ''));
    };

    const headers = parseLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        rows.push(parseLine(line));
    }

    return { headers, rows };
}


function parseExcel(buffer) {
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (jsonData.length < 2) throw new Error('Excel sheet is empty or has no data rows.');

    const headers = jsonData[0].map(h => String(h).trim());
    const rows = jsonData.slice(1).filter(row => row.some(cell => String(cell).trim()));

    return {
        headers,
        rows: rows.map(row => row.map(cell => String(cell).trim())),
    };
}


async function parsePDF(buffer) {
    if (typeof pdfjsLib === 'undefined') {
        throw new Error('PDF.js library not loaded. Check your internet connection.');
    }

    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
    const allItems = [];

    // Extract text items with positions from all pages
    for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        for (const item of content.items) {
            const text = item.str.trim();
            if (text) {
                allItems.push({
                    text,
                    x: Math.round(item.transform[4]),
                    y: Math.round(item.transform[5]),
                    page: p,
                });
            }
        }
    }

    if (!allItems.length) throw new Error('No text found in this PDF.');

    // Group items into rows by y-coordinate (within 4px tolerance)
    const rowMap = new Map();
    for (const item of allItems) {
        let assigned = false;
        for (const [key, arr] of rowMap) {
            if (Math.abs(item.y - key) <= 4) {
                arr.push(item);
                assigned = true;
                break;
            }
        }
        if (!assigned) rowMap.set(item.y, [item]);
    }

    // Sort rows top→bottom (PDF y is bottom-up, so descending)
    const rows = [...rowMap.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([, items]) => {
            items.sort((a, b) => a.x - b.x);
            return items;
        });

    // Find header row
    let headerIdx = -1;
    let headerCols = null;

    for (let i = 0; i < rows.length; i++) {
        const rowText = rows[i].map(it => it.text).join(' ').toLowerCase();
        if (rowText.includes('policyno') || (rowText.includes('s.no') && rowText.includes('name'))) {
            headerIdx = i;
            headerCols = rows[i].map(it => ({ text: it.text, x: it.x }));
            break;
        }
    }

    if (!headerCols) throw new Error('Could not find a table header in this PDF. Expected columns like PolicyNo, Name of Assured, etc.');

    // Extract data rows — assign items to nearest column
    const dataRows = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        const rowText = row.map(it => it.text).join(' ').toLowerCase();

        // Skip repeated headers on later pages
        if (rowText.includes('policyno') || (rowText.includes('s.no') && rowText.includes('name'))) continue;
        // Skip summary / total rows
        if (rowText.includes('total') || rowText.includes('grand')) continue;

        const record = new Array(headerCols.length).fill('');
        for (const item of row) {
            let closest = 0, minDist = Infinity;
            for (let c = 0; c < headerCols.length; c++) {
                const dist = Math.abs(item.x - headerCols[c].x);
                if (dist < minDist) { minDist = dist; closest = c; }
            }
            record[closest] = record[closest] ? record[closest] + ' ' + item.text : item.text;
        }

        // Keep rows that have at least some data
        if (record.filter(c => c.trim()).length >= 3) {
            dataRows.push(record);
        }
    }

    if (!dataRows.length) throw new Error('Found headers but no data rows in the PDF.');

    return {
        headers: headerCols.map(h => h.text),
        rows: dataRows,
    };
}


// ── Column Mapping ───────────────────────────────────────────────

function autoMapColumns(headers) {
    const lowerHeaders = headers.map(h => h.toLowerCase().trim());
    const mapping = {};       // original header → standard name
    const usedIndices = new Set();

    for (const [stdName, aliases] of Object.entries(COLUMN_ALIASES)) {
        for (const alias of aliases) {
            const idx = lowerHeaders.indexOf(alias);
            if (idx !== -1 && !usedIndices.has(idx)) {
                mapping[headers[idx]] = stdName;
                usedIndices.add(idx);
                break;
            }
        }
    }
    return mapping;
}


// ── Data Processing ──────────────────────────────────────────────

function processData(headers, rows, colMap) {
    return rows.map(row => {
        const obj = {};
        headers.forEach((h, i) => {
            const stdName = colMap[h];
            if (stdName) obj[stdName] = (row[i] || '').trim();
        });
        // Clean premium amount
        if (obj['Premium Amount']) {
            obj['Premium Amount'] = parseFloat(
                String(obj['Premium Amount']).replace(/,/g, '').replace(/[^\d.]/g, '')
            ) || 0;
        }
        return obj;
    }).filter(obj => obj['Client Name'] && obj['Policy Number']);
}


function groupByClient(data) {
    const groups = new Map();
    for (const record of data) {
        const name = record['Client Name'];
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(record);
    }
    // Sort by name
    return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}


// ── Message Generation ───────────────────────────────────────────

function buildMessage(name, records) {
    if (records.length === 1) {
        const p = records[0];
        return (
            `Hi ${name},\n\n` +
            `This is a friendly reminder regarding your LIC policy ` +
            `*No. ${p['Policy Number']}*.\n` +
            `The premium of *₹${formatNum(p['Premium Amount'])}* is due on ` +
            `*${p['Due Date']}*.\n\n` +
            `Please clear the payment at the earliest to keep your ` +
            `policy active. Let me know if you need any assistance!`
        );
    }

    const total = records.reduce((s, r) => s + (r['Premium Amount'] || 0), 0);
    const lines = records.map((p, i) =>
        `  ${i + 1}. Policy *No. ${p['Policy Number']}* — ₹${formatNum(p['Premium Amount'])} (Due: ${p['Due Date']})`
    ).join('\n');

    return (
        `Hi ${name},\n\n` +
        `This is a friendly reminder for your *${records.length} LIC policies*:\n\n` +
        `${lines}\n\n` +
        `📌 *Total Premium: ₹${formatNum(total)}*\n\n` +
        `Please clear the payments at the earliest to keep your ` +
        `policies active. Let me know if you need any assistance!`
    );
}


function whatsappLink(phone, message) {
    const cleaned = normalizePhone(phone);
    if (!cleaned) return '';
    return `https://wa.me/${cleaned}?text=${encodeURIComponent(message)}`;
}


function formatNum(n) {
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}


// ── UI Rendering ─────────────────────────────────────────────────

function showAlert(type, msg) {
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    const container = document.getElementById('alerts');
    const el = document.createElement('div');
    el.className = `alert alert-${type}`;
    el.innerHTML = `<span>${icons[type] || ''}</span><span>${msg}</span>`;
    container.appendChild(el);

    // Auto-dismiss after 6s
    setTimeout(() => {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-8px)';
        el.style.transition = '.3s ease';
        setTimeout(() => el.remove(), 300);
    }, 6000);
}


function clearAlerts() {
    document.getElementById('alerts').innerHTML = '';
}


function showLoading() { document.getElementById('loading').classList.remove('hidden'); }
function hideLoading() { document.getElementById('loading').classList.add('hidden'); }


function showResults() { document.getElementById('results').classList.remove('hidden'); }
function hideResults() { document.getElementById('results').classList.add('hidden'); }


function renderMetrics(data, groups) {
    const totalPremium = data.reduce((s, d) => s + (d['Premium Amount'] || 0), 0);
    const totalPolicies = data.length;
    const totalClients = groups.size;

    document.getElementById('metrics').innerHTML = `
        <div class="metric">
            <div class="metric-icon">👤</div>
            <div class="metric-value">${totalClients}</div>
            <div class="metric-label">Total Clients</div>
        </div>
        <div class="metric">
            <div class="metric-icon">📋</div>
            <div class="metric-value">${totalPolicies}</div>
            <div class="metric-label">Total Policies</div>
        </div>
        <div class="metric">
            <div class="metric-icon">💰</div>
            <div class="metric-value">₹${formatNum(totalPremium)}</div>
            <div class="metric-label">Total Premium Due</div>
        </div>
    `;
}


function renderTable(data) {
    const columns = [...REQUIRED_COLS];
    if (data.some(row => String(row['Phone Number'] || '').trim() && String(row['Phone Number']).toLowerCase() !== 'nan')) {
        columns.push('Phone Number');
    }

    const thead = document.getElementById('table-head');
    const tbody = document.getElementById('table-body');

    thead.innerHTML = `<tr>${columns.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;

    tbody.innerHTML = data.map(row =>
        `<tr>${columns.map(c => {
            let val = row[c] ?? '';
            if (c === 'Premium Amount') val = '₹' + formatNum(val);
            return `<td>${escapeHtml(val)}</td>`;
        }).join('')}</tr>`
    ).join('');
}


function renderActions(groups, hasPhone) {
    const list = document.getElementById('action-list');
    list.innerHTML = '';

    Array.from(groups.entries()).forEach(([name, records], index) => {
        const total = records.reduce((s, r) => s + (r['Premium Amount'] || 0), 0);
        const n = records.length;
        const tag = n === 1 ? 'policy' : 'policies';
        const msg = buildMessage(name, records);
        const safeName = escapeHtml(name);

        let phone = hasPhone ? getFirstPhone(records) : '';

        // Call hook for solution branches to inject phone
        if (typeof getPhoneForClient === 'function') {
            const injected = getPhoneForClient(name, records);
            if (injected) phone = injected;
        }

        const waPhone = normalizePhone(phone);

        const cardId = `card-${slugify(name)}-${index}`;
        const card = document.createElement('div');
        card.className = 'client-card';
        card.id = cardId;

        // Mini table for policies
        const miniRows = records.map(r =>
            `<tr><td>${escapeHtml(r['Policy Number'])}</td><td>₹${escapeHtml(formatNum(r['Premium Amount']))}</td><td>${escapeHtml(r['Due Date'])}</td></tr>`
        ).join('');

        // Phone-dependent buttons
        let actionButtons = '';
        if (waPhone) {
            const waLink = whatsappLink(waPhone, msg);
            actionButtons = `
                <a href="${waLink}" target="_blank" class="btn btn-primary">💬 WhatsApp ${escapeHtml(name.split(' ')[0] || 'Client')}</a>
                <button class="btn btn-secondary btn-copy" data-msg="${cardId}">📋 Copy Message</button>
            `;
        } else {
            actionButtons = `
                <button class="btn btn-secondary btn-copy" data-msg="${cardId}">📋 Copy Message</button>
                <div class="no-phone-info">📱 No phone number available — copy the message and send manually</div>
            `;
        }

        // Phone input hook for solution 3
        let phoneInputHTML = '';
        if (typeof renderPhoneInput === 'function') {
            phoneInputHTML = renderPhoneInput(name, records, phone);
        }

        card.innerHTML = `
            <div class="client-header" onclick="toggleCard('${cardId}')">
                <div class="client-info">
                    <span class="client-name">${safeName}</span>
                    <div class="client-tags">
                        <span class="tag tag-policies">${n} ${tag}</span>
                        <span class="tag tag-amount">₹${formatNum(total)}</span>
                    </div>
                </div>
                <span class="client-chevron">▼</span>
            </div>
            <div class="client-body">
                <div class="client-body-inner">
                    <table class="mini-table">
                        <thead><tr><th>Policy Number</th><th>Premium</th><th>Due Date</th></tr></thead>
                        <tbody>${miniRows}</tbody>
                    </table>
                    ${phoneInputHTML}
                    <div class="msg-label">Message Preview</div>
                    <textarea class="msg-preview" id="msg-${cardId}">${escapeHtml(msg)}</textarea>
                    <div class="btn-row">${actionButtons}</div>
                </div>
            </div>
        `;

        list.appendChild(card);
    });

    // Render extra UI from solution branches
    if (typeof renderAfterActions === 'function') {
        renderAfterActions(groups);
    }

    // Copy button listeners
    document.querySelectorAll('.btn-copy').forEach(btn => {
        btn.addEventListener('click', () => {
            const msgId = 'msg-' + btn.getAttribute('data-msg');
            const textarea = document.getElementById(msgId);
            if (textarea) {
                navigator.clipboard.writeText(textarea.value).then(() => {
                    btn.textContent = '✅ Copied!';
                    btn.classList.add('copied');
                    setTimeout(() => {
                        btn.textContent = '📋 Copy Message';
                        btn.classList.remove('copied');
                    }, 2000);
                });
            }
        });
    });
}


function toggleCard(cardId) {
    const card = document.getElementById(cardId);
    if (card) card.classList.toggle('open');
}


// ── Main Handler ─────────────────────────────────────────────────

async function handleFile(file) {
    clearAlerts();
    hideResults();
    showLoading();

    try {
        // 1. Parse file
        const { headers, rows } = await parseFile(file);

        // 2. Map columns
        const colMap = autoMapColumns(headers);

        // 3. Check required columns
        const mapped = new Set(Object.values(colMap));
        const missing = REQUIRED_COLS.filter(c => !mapped.has(c));
        if (missing.length) {
            showAlert('error', `Missing required columns: ${missing.join(', ')}`);
            showAlert('info', `Columns found: ${headers.join(', ')}`);
            return;
        }

        // 4. Process data
        let data = processData(headers, rows, colMap);
        if (!data.length) {
            showAlert('error', 'No valid data rows found after parsing.');
            return;
        }

        showAlert('success', `File parsed — <strong>${data.length}</strong> records found`);

        // 5. Hook for solution branches to merge phone numbers
        if (typeof mergePhoneNumbers === 'function') {
            data = mergePhoneNumbers(data);
        }

        const hasPhone = data.some(d => d['Phone Number'] && d['Phone Number'].toLowerCase() !== 'nan');

        // 6. Group and render
        const groups = groupByClient(data);
        renderMetrics(data, groups);
        renderTable(data);
        renderActions(groups, hasPhone);
        showResults();

    } catch (err) {
        showAlert('error', err.message);
        console.error(err);
    } finally {
        hideLoading();
        const fileInput = document.getElementById('file-input');
        if (fileInput) fileInput.value = '';
    }
}


// ── Event Listeners ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');
    const browseButton = document.getElementById('browse-button');
    const branchSelect = document.getElementById('branch-select');
    const previewBranchButton = document.getElementById('preview-branch-button');

    // Click to browse
    dropzone.addEventListener('click', () => fileInput.click());
    browseButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        fileInput.click();
    });

    fileInput.addEventListener('click', () => {
        fileInput.value = '';
    });

    // File selected
    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    // Drag & Drop
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
        if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    if (branchSelect) {
        branchSelect.addEventListener('change', () => {
            openBranchPreview(branchSelect.value);
        });
    }

    if (previewBranchButton) {
        previewBranchButton.addEventListener('click', () => {
            if (branchSelect?.value) {
                openBranchPreview(branchSelect.value);
            }
        });
    }

    loadRepoBranches();
});
