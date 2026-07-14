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

    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        // Simple CSV split (handles basic quoting)
        const cells = line.match(/(".*?"|[^",]+|(?<=,)(?=,))/g) || [];
        rows.push(cells.map(c => c.trim().replace(/^"|"$/g, '')));
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
    let cleaned = phone.replace(/[\s\-()]/g, '');
    if (!cleaned.startsWith('+') && !cleaned.startsWith('91')) {
        cleaned = '91' + cleaned;
    }
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
    const columns = REQUIRED_COLS.filter(c => data[0] && data[0][c] !== undefined);
    if (data[0] && data[0]['Phone Number']) columns.push('Phone Number');

    const thead = document.getElementById('table-head');
    const tbody = document.getElementById('table-body');

    thead.innerHTML = `<tr>${columns.map(c => `<th>${c}</th>`).join('')}</tr>`;

    tbody.innerHTML = data.map(row =>
        `<tr>${columns.map(c => {
            let val = row[c] ?? '';
            if (c === 'Premium Amount') val = '₹' + formatNum(val);
            return `<td>${val}</td>`;
        }).join('')}</tr>`
    ).join('');
}


function renderActions(groups, hasPhone) {
    const list = document.getElementById('action-list');
    list.innerHTML = '';

    for (const [name, records] of groups) {
        const total = records.reduce((s, r) => s + (r['Premium Amount'] || 0), 0);
        const n = records.length;
        const tag = n === 1 ? 'policy' : 'policies';
        const msg = buildMessage(name, records);

        // Phone number
        let phone = '';
        if (hasPhone) {
            phone = (records[0]['Phone Number'] || '').trim();
            if (phone.toLowerCase() === 'nan') phone = '';
        }

        // Call hook for solution branches to inject phone
        if (typeof getPhoneForClient === 'function') {
            const injected = getPhoneForClient(name, records);
            if (injected) phone = injected;
        }

        const cardId = `card-${name.replace(/\s+/g, '_')}`;
        const card = document.createElement('div');
        card.className = 'client-card';
        card.id = cardId;

        // Mini table for policies
        const miniRows = records.map(r =>
            `<tr><td>${r['Policy Number']}</td><td>₹${formatNum(r['Premium Amount'])}</td><td>${r['Due Date']}</td></tr>`
        ).join('');

        // Phone-dependent buttons
        let actionButtons = '';
        if (phone) {
            const waLink = whatsappLink(phone, msg);
            actionButtons = `
                <a href="${waLink}" target="_blank" class="btn btn-primary">💬 WhatsApp ${name.split(' ')[0]}</a>
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
                    <span class="client-name">${name}</span>
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
                    <textarea class="msg-preview" id="msg-${cardId}">${msg}</textarea>
                    <div class="btn-row">${actionButtons}</div>
                </div>
            </div>
        `;

        list.appendChild(card);
    }

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
    }
}


// ── Event Listeners ──────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('file-input');

    // Click to browse
    dropzone.addEventListener('click', () => fileInput.click());

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
});
