/* ══════════════════════════════════════════════════════════════════
   LIC Premium Dashboard — Express Server Entry Point
   ══════════════════════════════════════════════════════════════════ */

const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./db');

const policyRoutes = require('./routes/policies');
const uploadRoutes = require('./routes/uploads');
const statsRoutes = require('./routes/stats');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Serve static files (index.html, style.css, app.js, assets/)
app.use(express.static(path.join(__dirname, '..')));

// ── API Routes ───────────────────────────────────────────────────
app.use('/api/policies', policyRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/stats', statsRoutes);

// ── Health check ─────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Fallback: serve index.html for non-API routes ────────────────
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// ── Start (async to init database first) ─────────────────────────
async function start() {
    try {
        await initDb();
        console.log('  ✅ SQLite database initialized');

        app.listen(PORT, () => {
            console.log(`\n  ╔══════════════════════════════════════════════════╗`);
            console.log(`  ║  LIC Premium Dashboard Server                   ║`);
            console.log(`  ║  Running on http://localhost:${PORT}               ║`);
            console.log(`  ╚══════════════════════════════════════════════════╝\n`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

start();
