/* ══════════════════════════════════════════════════════════════════
   File Upload Routes — Due List & Commission List Processing
   ══════════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const {
    getDb,
    advanceFupDate,
    parseFlexibleDate,
    formatDateISO,
    detectPremiumMode,
    evaluatePolicyStatus,
} = require('../db');

// Multer — store uploads in memory for server-side parsing
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB max
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (['.xlsx', '.xls', '.csv'].includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel (.xlsx/.xls) and CSV (.csv) files are supported for server uploads.'));
        }
    },
});


// ── Column Aliases ───────────────────────────────────────────────
const DUE_LIST_ALIASES = {
    'client_name':     ['name of assured', 'client name', 'name', 'assured name', 'clientname'],
    'policy_number':   ['policyno', 'policy number', 'policy no', 'policy_number', 'policynumber'],
    'premium_amount':  ['totprem', 'total premium', 'premium amount', 'instprem', 'premium', 'premiumamount'],
    'fup_date':        ['fup', 'due date', 'due_date', 'premium due date', 'duedate', 'fup date'],
    'phone':           ['phone number', 'phone', 'mobile', 'contact', 'mobile number', 'mobileno'],
    'premium_mode':    ['mode', 'premium mode', 'pay mode', 'paymode', 'premmode', 'prem mode'],
};

const COMMISSION_ALIASES = {
    'policy_number':      ['policyno', 'policy number', 'policy no', 'policy_number', 'policynumber'],
    'commission_amount':  ['commission', 'comm amount', 'commission amount', 'commamt', 'comm'],
    'payment_date':       ['payment date', 'pay date', 'date', 'commdate', 'comm date', 'paydate'],
};


// ── Helper: auto-map columns ─────────────────────────────────────

function autoMapColumns(headers, aliasMap) {
    const lower = headers.map(h => h.toLowerCase().trim());
    const mapping = {};
    const used = new Set();

    for (const [stdName, aliases] of Object.entries(aliasMap)) {
        for (const alias of aliases) {
            const idx = lower.indexOf(alias);
            if (idx !== -1 && !used.has(idx)) {
                mapping[headers[idx]] = stdName;
                used.add(idx);
                break;
            }
        }
    }
    return mapping;
}


// ── Helper: parse uploaded file ──────────────────────────────────

function parseUploadedFile(buffer, originalName) {
    let XLSX;
    try {
        XLSX = require('xlsx');
    } catch {
        // xlsx might not be installed server-side; use a shim approach
        throw new Error('Server-side XLSX parsing requires the "xlsx" package. Run: npm install xlsx');
    }

    const ext = path.extname(originalName).toLowerCase();
    let workbook;

    if (ext === '.csv') {
        const text = buffer.toString('utf-8');
        workbook = XLSX.read(text, { type: 'string' });
    } else {
        workbook = XLSX.read(buffer, { type: 'buffer' });
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (jsonData.length < 2) throw new Error('File is empty or has no data rows.');

    const headers = jsonData[0].map(h => String(h).trim());
    const rows = jsonData.slice(1)
        .filter(row => row.some(cell => String(cell).trim()))
        .map(row => row.map(cell => String(cell).trim()));

    return { headers, rows };
}


// ── POST /api/upload/duelist ─────────────────────────────────────

router.post('/duelist', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { headers, rows } = parseUploadedFile(req.file.buffer, req.file.originalname);
        const colMap = autoMapColumns(headers, DUE_LIST_ALIASES);

        // Check required columns
        const mapped = new Set(Object.values(colMap));
        const required = ['client_name', 'policy_number', 'premium_amount', 'fup_date'];
        const missing = required.filter(c => !mapped.has(c));

        if (missing.length) {
            return res.status(400).json({
                error: `Missing required columns: ${missing.join(', ')}`,
                found: headers,
            });
        }

        const db = getDb();
        let inserted = 0, updated = 0, skipped = 0;

        const upsert = db.transaction((records) => {
            const findPolicy = db.prepare('SELECT * FROM policies WHERE policy_number = ?');
            const insertPolicy = db.prepare(`
                INSERT INTO policies (policy_number, client_name, phone, premium_amount, premium_mode, fup_date, next_due_date, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const updatePolicy = db.prepare(`
                UPDATE policies
                SET client_name = ?, premium_amount = ?, fup_date = ?, next_due_date = ?,
                    phone = CASE WHEN phone = '' OR phone IS NULL THEN ? ELSE phone END,
                    premium_mode = CASE WHEN ? != '' THEN ? ELSE premium_mode END,
                    updated_at = datetime('now')
                WHERE policy_number = ?
            `);

            for (const record of records) {
                const policyNum = record.policy_number;
                if (!policyNum || !record.client_name) { skipped++; continue; }

                const amount = parseFloat(String(record.premium_amount).replace(/,/g, '').replace(/[^\d.]/g, '')) || 0;
                const fupDate = record.fup_date || '';
                const phone = record.phone || '';
                const modeRaw = record.premium_mode || '';
                const mode = detectPremiumMode(modeRaw) || '';
                const nextDue = fupDate; // Initially same as FUP
                const status = evaluatePolicyStatus(nextDue);

                const existing = findPolicy.get(policyNum);

                if (existing) {
                    updatePolicy.run(
                        record.client_name, amount, fupDate, nextDue,
                        phone, mode, mode, policyNum
                    );
                    updated++;
                } else {
                    insertPolicy.run(
                        policyNum, record.client_name, phone, amount,
                        mode || 'Yearly', fupDate, nextDue, status
                    );
                    inserted++;
                }
            }
        });

        // Map rows to records
        const records = rows.map(row => {
            const obj = {};
            headers.forEach((h, i) => {
                const stdName = colMap[h];
                if (stdName) obj[stdName] = (row[i] || '').trim();
            });
            return obj;
        }).filter(r => r.policy_number && r.client_name);

        upsert(records);

        // Log the upload
        db.prepare('INSERT INTO uploads (file_name, upload_type, records_count) VALUES (?, ?, ?)')
            .run(req.file.originalname, 'due_list', records.length);

        res.json({
            success: true,
            message: `Due list processed: ${inserted} new, ${updated} updated, ${skipped} skipped`,
            inserted,
            updated,
            skipped,
            total: records.length,
        });
    } catch (err) {
        console.error('Due list upload error:', err);
        res.status(500).json({ error: err.message });
    }
});


// ── POST /api/upload/commission ──────────────────────────────────

router.post('/commission', upload.single('file'), (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { headers, rows } = parseUploadedFile(req.file.buffer, req.file.originalname);
        const colMap = autoMapColumns(headers, COMMISSION_ALIASES);

        const mapped = new Set(Object.values(colMap));
        const required = ['policy_number', 'commission_amount'];
        const missing = required.filter(c => !mapped.has(c));

        if (missing.length) {
            return res.status(400).json({
                error: `Missing required columns: ${missing.join(', ')}`,
                found: headers,
            });
        }

        const db = getDb();
        let matched = 0, unmatched = 0;
        const unmatchedPolicies = [];

        const processCommissions = db.transaction((records) => {
            const findPolicy = db.prepare('SELECT * FROM policies WHERE policy_number = ?');
            const insertCommission = db.prepare(`
                INSERT INTO commissions (policy_number, commission_amount, payment_date)
                VALUES (?, ?, ?)
            `);
            const advancePolicy = db.prepare(`
                UPDATE policies
                SET next_due_date = ?, status = 'Paid', updated_at = datetime('now')
                WHERE policy_number = ?
            `);

            for (const record of records) {
                const policyNum = record.policy_number;
                if (!policyNum) continue;

                const policy = findPolicy.get(policyNum);
                if (!policy) {
                    unmatched++;
                    unmatchedPolicies.push(policyNum);
                    continue;
                }

                const commAmount = parseFloat(String(record.commission_amount).replace(/,/g, '').replace(/[^\d.]/g, '')) || 0;
                const payDate = record.payment_date || formatDateISO(new Date());

                // Record commission
                insertCommission.run(policyNum, commAmount, payDate);

                // Advance FUP date based on premium mode
                const newNextDue = advanceFupDate(
                    policy.next_due_date || policy.fup_date,
                    policy.premium_mode
                );
                advancePolicy.run(newNextDue, policyNum);
                matched++;
            }
        });

        const records = rows.map(row => {
            const obj = {};
            headers.forEach((h, i) => {
                const stdName = colMap[h];
                if (stdName) obj[stdName] = (row[i] || '').trim();
            });
            return obj;
        }).filter(r => r.policy_number);

        processCommissions(records);

        // Log the upload
        db.prepare('INSERT INTO uploads (file_name, upload_type, records_count) VALUES (?, ?, ?)')
            .run(req.file.originalname, 'commission', records.length);

        res.json({
            success: true,
            message: `Commission processed: ${matched} matched, ${unmatched} unmatched`,
            matched,
            unmatched,
            unmatchedPolicies: unmatchedPolicies.slice(0, 20), // Show first 20
            total: records.length,
        });
    } catch (err) {
        console.error('Commission upload error:', err);
        res.status(500).json({ error: err.message });
    }
});


// GET /api/uploads — recent upload history
router.get('/history', (_req, res) => {
    const db = getDb();
    const uploads = db.prepare('SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT 50').all();
    res.json({ uploads });
});


module.exports = router;
