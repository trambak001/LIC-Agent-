/* ══════════════════════════════════════════════════════════════════
   LIC Dashboard — SQLite Database Setup & Helpers (sql.js)
   Uses sql.js (pure-JS SQLite via WASM) — no native build tools needed.
   ══════════════════════════════════════════════════════════════════ */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'lic-database.sqlite');

let dbWrapper = null;


// ── Wrapper class to mimic better-sqlite3 API ────────────────────
// Routes use db.prepare(sql).all/get/run — this wrapper provides that.

class PreparedStatement {
    constructor(db, sql, wrapper) {
        this._db = db;
        this._sql = sql;
        this._wrapper = wrapper;
    }

    all(...params) {
        let stmt;
        try {
            stmt = this._db.prepare(this._sql);
            if (params.length) stmt.bind(params);
            const results = [];
            while (stmt.step()) {
                results.push(stmt.getAsObject());
            }
            return results;
        } finally {
            if (stmt) stmt.free();
        }
    }

    get(...params) {
        const results = this.all(...params);
        return results[0] || undefined;
    }

    run(...params) {
        this._db.run(this._sql, params);
        this._wrapper._save();
        return { changes: this._db.getRowsModified() };
    }
}


class DbWrapper {
    constructor(sqlDb, dbPath) {
        this._db = sqlDb;
        this._path = dbPath;
    }

    exec(sql) {
        this._db.exec(sql);
        this._save();
    }

    prepare(sql) {
        return new PreparedStatement(this._db, sql, this);
    }

    transaction(fn) {
        const wrapper = this;
        return function (...args) {
            wrapper._db.run('BEGIN TRANSACTION');
            try {
                const result = fn(...args);
                wrapper._db.run('COMMIT');
                wrapper._save();
                return result;
            } catch (err) {
                wrapper._db.run('ROLLBACK');
                throw err;
            }
        };
    }

    pragma(str) {
        try { this._db.run(`PRAGMA ${str}`); } catch (e) { /* ignore unsupported */ }
    }

    _save() {
        try {
            const data = this._db.export();
            fs.writeFileSync(this._path, Buffer.from(data));
        } catch (err) {
            console.error('Failed to persist database:', err);
        }
    }
}


// ── Initialization ───────────────────────────────────────────────

async function initDb() {
    if (dbWrapper) return dbWrapper;

    const SQL = await initSqlJs();

    let db;
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(fileBuffer);
    } else {
        db = new SQL.Database();
    }

    dbWrapper = new DbWrapper(db, DB_PATH);
    dbWrapper.pragma('journal_mode = WAL');
    dbWrapper.pragma('foreign_keys = ON');
    migrate(dbWrapper);

    return dbWrapper;
}


function getDb() {
    if (!dbWrapper) {
        throw new Error('Database not initialized. Call initDb() first.');
    }
    return dbWrapper;
}


// ── Schema Migration ─────────────────────────────────────────────

function migrate(db) {
    db.exec(`
        CREATE TABLE IF NOT EXISTS policies (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            policy_number   TEXT    NOT NULL UNIQUE,
            client_name     TEXT    NOT NULL,
            phone           TEXT    DEFAULT '',
            premium_amount  REAL    DEFAULT 0,
            premium_mode    TEXT    DEFAULT 'Yearly'
                            CHECK (premium_mode IN ('Monthly','Quarterly','Half-Yearly','Yearly')),
            fup_date        TEXT    DEFAULT '',
            next_due_date   TEXT    DEFAULT '',
            status          TEXT    DEFAULT 'Active'
                            CHECK (status IN ('Active','Paid','Overdue','Lapsed')),
            created_at      TEXT    DEFAULT (datetime('now')),
            updated_at      TEXT    DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS commissions (
            id                INTEGER PRIMARY KEY AUTOINCREMENT,
            policy_number     TEXT    NOT NULL,
            commission_amount REAL    DEFAULT 0,
            payment_date      TEXT    DEFAULT '',
            uploaded_at       TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (policy_number) REFERENCES policies(policy_number)
                ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS uploads (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            file_name     TEXT    NOT NULL,
            upload_type   TEXT    NOT NULL
                          CHECK (upload_type IN ('due_list','commission')),
            records_count INTEGER DEFAULT 0,
            uploaded_at   TEXT    DEFAULT (datetime('now'))
        );
    `);

    // Create indexes (ignore if exist)
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_policies_policy_number ON policies(policy_number)'); } catch {}
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_commissions_policy_number ON commissions(policy_number)'); } catch {}
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_policies_status ON policies(status)'); } catch {}
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_policies_next_due ON policies(next_due_date)'); } catch {}
}


// ── Premium Mode Helpers ─────────────────────────────────────────

const MODE_MONTHS = {
    'Monthly':     1,
    'Quarterly':   3,
    'Half-Yearly': 6,
    'Yearly':      12,
};


function advanceFupDate(dateStr, mode) {
    const parsed = parseFlexibleDate(dateStr);
    if (!parsed) return dateStr;
    const months = MODE_MONTHS[mode] || 12;
    parsed.setMonth(parsed.getMonth() + months);
    return formatDateISO(parsed);
}


function parseFlexibleDate(raw) {
    if (!raw) return null;
    const s = String(raw).trim();

    // ISO: 2025-07-15
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
        const d = new Date(s);
        return isNaN(d) ? null : d;
    }

    // DD/MM/YYYY or DD-MM-YYYY
    const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmy) {
        const d = new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
        return isNaN(d) ? null : d;
    }

    // Fallback
    const d = new Date(s);
    return isNaN(d) ? null : d;
}


function formatDateISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}


function detectPremiumMode(raw) {
    if (!raw) return null;
    const s = String(raw).toLowerCase().trim();
    if (/month/i.test(s) || s === 'm' || s === '1')   return 'Monthly';
    if (/quart/i.test(s) || s === 'q' || s === '3')    return 'Quarterly';
    if (/half/i.test(s)  || s === 'h' || s === 'hy' || s === '6') return 'Half-Yearly';
    if (/year|annual/i.test(s) || s === 'y' || s === '12') return 'Yearly';
    return null;
}


function evaluatePolicyStatus(nextDueDate) {
    if (!nextDueDate) return 'Active';
    const due = parseFlexibleDate(nextDueDate);
    if (!due) return 'Active';

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffDays = Math.floor((due - today) / (1000 * 60 * 60 * 24));

    if (diffDays < -30) return 'Lapsed';
    if (diffDays < 0)   return 'Overdue';
    return 'Active';
}


module.exports = {
    initDb,
    getDb,
    advanceFupDate,
    parseFlexibleDate,
    formatDateISO,
    detectPremiumMode,
    evaluatePolicyStatus,
    MODE_MONTHS,
};
