/* ══════════════════════════════════════════════════════════════════
   Dashboard Statistics & Smart Insights Routes
   ══════════════════════════════════════════════════════════════════ */

const express = require('express');
const router = express.Router();
const { getDb, formatDateISO } = require('../db');


// GET /api/stats — dashboard-wide analytics
router.get('/', (_req, res) => {
    const db = getDb();

    const totalPolicies = db.prepare('SELECT COUNT(*) as c FROM policies').get().c;
    const totalPremium = db.prepare('SELECT COALESCE(SUM(premium_amount), 0) as s FROM policies').get().s;
    const totalCommissions = db.prepare('SELECT COALESCE(SUM(commission_amount), 0) as s FROM commissions').get().s;
    const totalClients = db.prepare('SELECT COUNT(DISTINCT client_name) as c FROM policies').get().c;

    const byStatus = db.prepare(`
        SELECT status, COUNT(*) as count, COALESCE(SUM(premium_amount), 0) as premium
        FROM policies GROUP BY status
    `).all();

    const byMode = db.prepare(`
        SELECT premium_mode, COUNT(*) as count, COALESCE(SUM(premium_amount), 0) as premium
        FROM policies GROUP BY premium_mode
    `).all();

    const recentUploads = db.prepare(
        'SELECT * FROM uploads ORDER BY uploaded_at DESC LIMIT 5'
    ).all();

    const overdue = db.prepare("SELECT COUNT(*) as c FROM policies WHERE status = 'Overdue'").get().c;
    const lapsed = db.prepare("SELECT COUNT(*) as c FROM policies WHERE status = 'Lapsed'").get().c;
    const paid = db.prepare("SELECT COUNT(*) as c FROM policies WHERE status = 'Paid'").get().c;

    const collectionRate = totalPolicies > 0
        ? Math.round((paid / totalPolicies) * 100)
        : 0;

    res.json({
        totalPolicies,
        totalPremium,
        totalCommissions,
        totalClients,
        overdue,
        lapsed,
        paid,
        collectionRate,
        byStatus,
        byMode,
        recentUploads,
    });
});


// GET /api/stats/insights — smart insights
router.get('/insights', (_req, res) => {
    const db = getDb();
    const today = formatDateISO(new Date());

    const insights = [];

    // 1. Overdue policies
    const overdueList = db.prepare(`
        SELECT policy_number, client_name, next_due_date, premium_amount
        FROM policies
        WHERE status IN ('Overdue', 'Lapsed')
        ORDER BY next_due_date ASC
        LIMIT 10
    `).all();

    if (overdueList.length) {
        insights.push({
            type: 'danger',
            icon: '⚠️',
            title: `${overdueList.length} Overdue / Lapsed Policies`,
            description: 'These policies have passed their due date without payment.',
            data: overdueList,
        });
    }

    // 2. Upcoming dues in next 7 days
    const next7 = new Date();
    next7.setDate(next7.getDate() + 7);
    const next7Str = formatDateISO(next7);

    const upcoming7 = db.prepare(`
        SELECT policy_number, client_name, next_due_date, premium_amount, phone
        FROM policies
        WHERE next_due_date BETWEEN ? AND ? AND status NOT IN ('Paid', 'Lapsed')
        ORDER BY next_due_date ASC
    `).all(today, next7Str);

    if (upcoming7.length) {
        const totalDue = upcoming7.reduce((s, p) => s + p.premium_amount, 0);
        insights.push({
            type: 'warning',
            icon: '📅',
            title: `${upcoming7.length} Policies Due This Week`,
            description: `Total premium of ₹${totalDue.toLocaleString('en-IN')} due in the next 7 days.`,
            data: upcoming7,
        });
    }

    // 3. Upcoming dues in next 30 days
    const next30 = new Date();
    next30.setDate(next30.getDate() + 30);
    const next30Str = formatDateISO(next30);

    const upcoming30 = db.prepare(`
        SELECT COUNT(*) as count, COALESCE(SUM(premium_amount), 0) as premium
        FROM policies
        WHERE next_due_date BETWEEN ? AND ? AND status NOT IN ('Paid', 'Lapsed')
    `).get(today, next30Str);

    if (upcoming30.count > 0) {
        insights.push({
            type: 'info',
            icon: '📊',
            title: `${upcoming30.count} Policies Due in 30 Days`,
            description: `₹${upcoming30.premium.toLocaleString('en-IN')} in premiums expected over the next month.`,
        });
    }

    // 4. Top clients by premium
    const topClients = db.prepare(`
        SELECT client_name, COUNT(*) as policies, SUM(premium_amount) as total_premium
        FROM policies
        GROUP BY client_name
        ORDER BY total_premium DESC
        LIMIT 5
    `).all();

    if (topClients.length) {
        insights.push({
            type: 'success',
            icon: '💎',
            title: 'Top Clients by Premium Value',
            description: 'Your highest-value clients across all policies.',
            data: topClients,
        });
    }

    // 5. Mode distribution insight
    const modes = db.prepare(`
        SELECT premium_mode, COUNT(*) as count
        FROM policies GROUP BY premium_mode ORDER BY count DESC
    `).all();

    if (modes.length) {
        const topMode = modes[0];
        insights.push({
            type: 'info',
            icon: '📈',
            title: `Most Common Mode: ${topMode.premium_mode}`,
            description: `${topMode.count} out of ${modes.reduce((s, m) => s + m.count, 0)} policies use ${topMode.premium_mode} premium mode.`,
            data: modes,
        });
    }

    // 6. Recent commission activity
    const recentComm = db.prepare(`
        SELECT c.policy_number, c.commission_amount, c.payment_date, p.client_name
        FROM commissions c
        LEFT JOIN policies p ON c.policy_number = p.policy_number
        ORDER BY c.uploaded_at DESC
        LIMIT 5
    `).all();

    if (recentComm.length) {
        insights.push({
            type: 'success',
            icon: '💰',
            title: 'Recent Commission Payments',
            description: 'Latest commissions recorded in the system.',
            data: recentComm,
        });
    }

    // 7. Policies with no phone number
    const noPhone = db.prepare("SELECT COUNT(*) as c FROM policies WHERE phone = '' OR phone IS NULL").get().c;
    if (noPhone > 0) {
        insights.push({
            type: 'warning',
            icon: '📱',
            title: `${noPhone} Policies Missing Phone Numbers`,
            description: 'Add phone numbers to enable WhatsApp reminders for these clients.',
        });
    }

    res.json({ insights });
});


module.exports = router;
