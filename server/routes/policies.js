/* ══════════════════════════════════════════════════════════════════
   Policy CRUD Routes
   ══════════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();
const { getDb, evaluatePolicyStatus } = require('../db');


// GET /api/policies — list with optional search, mode, status filters
router.get('/', (req, res) => {
    const db = getDb();
    const { search, mode, status, sort, order } = req.query;

    let sql = 'SELECT * FROM policies WHERE 1=1';
    const params = [];

    if (search) {
        sql += ' AND (client_name LIKE ? OR policy_number LIKE ? OR phone LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term);
    }

    if (mode) {
        sql += ' AND premium_mode = ?';
        params.push(mode);
    }

    if (status) {
        sql += ' AND status = ?';
        params.push(status);
    }

    // Sorting
    const allowedSort = ['client_name', 'policy_number', 'premium_amount', 'next_due_date', 'status', 'premium_mode', 'updated_at'];
    const sortCol = allowedSort.includes(sort) ? sort : 'updated_at';
    const sortDir = order === 'asc' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${sortCol} ${sortDir}`;

    const policies = db.prepare(sql).all(...params);

    // Refresh status for each policy based on current date
    const updateStatus = db.prepare('UPDATE policies SET status = ? WHERE id = ? AND status != ?');
    for (const p of policies) {
        if (p.status !== 'Paid') {
            const computed = evaluatePolicyStatus(p.next_due_date);
            if (computed !== p.status) {
                updateStatus.run(computed, p.id, computed);
                p.status = computed;
            }
        }
    }

    res.json({ policies, total: policies.length });
});


// GET /api/policies/:id — single policy with commission history
router.get('/:id', (req, res) => {
    const db = getDb();
    const policy = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });

    const commissions = db.prepare(
        'SELECT * FROM commissions WHERE policy_number = ? ORDER BY payment_date DESC'
    ).all(policy.policy_number);

    res.json({ policy, commissions });
});


// PUT /api/policies/:id — update editable fields
router.put('/:id', (req, res) => {
    const db = getDb();
    const { phone, premium_mode, status, client_name, premium_amount, fup_date, next_due_date } = req.body;

    const existing = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Policy not found' });

    const updates = [];
    const params = [];

    if (phone !== undefined)          { updates.push('phone = ?');          params.push(phone); }
    if (premium_mode !== undefined)   { updates.push('premium_mode = ?');   params.push(premium_mode); }
    if (status !== undefined)         { updates.push('status = ?');         params.push(status); }
    if (client_name !== undefined)    { updates.push('client_name = ?');    params.push(client_name); }
    if (premium_amount !== undefined) { updates.push('premium_amount = ?'); params.push(premium_amount); }
    if (fup_date !== undefined)       { updates.push('fup_date = ?');       params.push(fup_date); }
    if (next_due_date !== undefined)  { updates.push('next_due_date = ?');  params.push(next_due_date); }

    if (!updates.length) return res.status(400).json({ error: 'No fields to update' });

    updates.push("updated_at = datetime('now')");
    params.push(req.params.id);

    db.prepare(`UPDATE policies SET ${updates.join(', ')} WHERE id = ?`).run(...params);

    const updated = db.prepare('SELECT * FROM policies WHERE id = ?').get(req.params.id);
    res.json({ policy: updated });
});


// DELETE /api/policies/:id — delete single
router.delete('/:id', (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM policies WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Policy not found' });
    res.json({ deleted: true });
});


// DELETE /api/policies/bulk/all — clear all policies
router.delete('/bulk/all', (req, res) => {
    const db = getDb();
    const result = db.prepare('DELETE FROM policies').run();
    db.prepare('DELETE FROM commissions').run();
    res.json({ deleted: result.changes });
});


module.exports = router;
