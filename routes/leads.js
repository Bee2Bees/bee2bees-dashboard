const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');

const STAGES = [
  'new_query', 'quote_sent', 'changes_requested', 'follow_up',
  'booking_confirmed', 'advance_received', 'voucher_sent', 'completed', 'lost'
];

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Authentication required' });
}

// ── GET /api/leads — grouped by stage for kanban ──────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, assignedTo, source } = req.query;
    const filter = {};
    if (assignedTo) filter.assignedTo = assignedTo;
    if (source) filter.source = source;
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [
        { agentName: re }, { agentPhone: re }, { agentCompany: re },
        { destination: re }, { guestName: re }
      ];
    }

    const leads = await Lead.find(filter).sort({ lastActivityAt: -1 }).lean();

    // Group by stage
    const grouped = {};
    STAGES.forEach(s => { grouped[s] = []; });
    leads.forEach(l => {
      const stage = l.stage || 'new_query';
      if (grouped[stage]) grouped[stage].push(l);
      else grouped['new_query'].push(l);
    });

    res.json({ success: true, data: grouped, total: leads.length });
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// ── GET /api/leads/stats ──────────────────────────────────────────────────────
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const now = new Date();
    const startOfDay = new Date(now); startOfDay.setHours(0,0,0,0);
    const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay()); startOfWeek.setHours(0,0,0,0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const [today, thisWeek, thisMonth, thisYear, stageCounts, completedRevenue, topAgents] = await Promise.all([
      Lead.countDocuments({ createdAt: { $gte: startOfDay } }),
      Lead.countDocuments({ createdAt: { $gte: startOfWeek } }),
      Lead.countDocuments({ createdAt: { $gte: startOfMonth } }),
      Lead.countDocuments({ createdAt: { $gte: startOfYear } }),
      Lead.aggregate([{ $group: { _id: '$stage', count: { $sum: 1 } } }]),
      Lead.aggregate([
        { $match: { stage: 'completed' } },
        { $group: { _id: null, total: { $sum: '$quoteAmount' } } }
      ]),
      Lead.aggregate([
        { $match: { stage: { $in: ['booking_confirmed', 'advance_received', 'voucher_sent', 'completed'] } } },
        { $group: { _id: '$agentPhone', name: { $first: '$agentName' }, company: { $first: '$agentCompany' }, count: { $sum: 1 }, revenue: { $sum: '$quoteAmount' } } },
        { $sort: { count: -1 } },
        { $limit: 10 }
      ])
    ]);

    const stageMap = {};
    stageCounts.forEach(s => { stageMap[s._id] = s.count; });
    const total = Object.values(stageMap).reduce((a, b) => a + b, 0);
    const completed = stageMap['completed'] || 0;
    const conversionRate = total > 0 ? Math.round((completed / total) * 100) : 0;
    const totalRevenue = completedRevenue[0]?.total || 0;

    res.json({
      success: true,
      data: {
        today, thisWeek, thisMonth, thisYear,
        stageMap, conversionRate, totalRevenue, topAgents
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ── GET /api/leads/by-phone/:phone ────────────────────────────────────────────
router.get('/by-phone/:phone', requireAuth, async (req, res) => {
  try {
    const leads = await Lead.find({ agentPhone: req.params.phone }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: leads });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// ── GET /api/leads/:id ────────────────────────────────────────────────────────
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).lean();
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, data: lead });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch lead' });
  }
});

// ── POST /api/leads ───────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const {
      agentPhone, agentName, agentCompany, destination, checkIn, checkOut,
      nights, adults, kids, rooms, mealPlan, quoteAmount, advanceAmount,
      guestName, guestPhone, hotelName, assignedTo, stage, source, notes
    } = req.body;

    if (!agentPhone) return res.status(400).json({ error: 'Agent phone is required' });

    const lead = await Lead.create({
      agentPhone, agentName: agentName || '', agentCompany: agentCompany || '',
      destination: destination || '',
      checkIn: checkIn || null, checkOut: checkOut || null,
      nights: nights || 0, adults: adults || 0, kids: kids || 0, rooms: rooms || 0,
      mealPlan: mealPlan || '', quoteAmount: quoteAmount || 0, advanceAmount: advanceAmount || 0,
      guestName: guestName || '', guestPhone: guestPhone || '', hotelName: hotelName || '',
      assignedTo: assignedTo || '', stage: stage || 'new_query', source: source || 'manual',
      lastActivityAt: new Date(),
      notes: notes ? [{ text: notes, addedBy: 'System', addedAt: new Date() }] : []
    });

    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    console.error('Error creating lead:', err);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// ── PUT /api/leads/update-by-phone ── (bot uses this, no auth — secret header) ─
router.put('/update-by-phone', async (req, res) => {
  const secret = req.headers['x-dashboard-secret'];
  if (secret !== (process.env.DASHBOARD_WEBHOOK_SECRET || 'bee2bees_dashboard_2026')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const { agentPhone, stage, quoteAmount, advanceAmount, hotelName, guestName } = req.body;
    if (!agentPhone) return res.status(400).json({ error: 'agentPhone required' });

    const updateFields = { lastActivityAt: new Date() };
    if (stage) updateFields.stage = stage;
    if (quoteAmount !== undefined) updateFields.quoteAmount = quoteAmount;
    if (advanceAmount !== undefined) updateFields.advanceAmount = advanceAmount;
    if (hotelName) updateFields.hotelName = hotelName;
    if (guestName) updateFields.guestName = guestName;

    // Update most recent lead for this phone
    const lead = await Lead.findOneAndUpdate(
      { agentPhone },
      { $set: updateFields },
      { new: true, sort: { createdAt: -1 } }
    );
    if (!lead) return res.status(404).json({ error: 'No lead found for this phone' });
    res.json({ success: true, data: lead });
  } catch (err) {
    console.error('update-by-phone error:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// ── PUT /api/leads/:id ────────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const allowed = [
      'stage', 'assignedTo', 'destination', 'checkIn', 'checkOut', 'nights',
      'adults', 'kids', 'rooms', 'mealPlan', 'quoteAmount', 'advanceAmount',
      'guestName', 'guestPhone', 'hotelName', 'agentName', 'agentCompany',
      'followUpCount', 'lastFollowUpAt'
    ];
    const updateFields = { lastActivityAt: new Date() };
    allowed.forEach(key => {
      if (req.body[key] !== undefined) updateFields[key] = req.body[key];
    });

    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, data: lead });
  } catch (err) {
    console.error('Error updating lead:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

// ── POST /api/leads/:id/note ──────────────────────────────────────────────────
router.post('/:id/note', requireAuth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Note text required' });

    const addedBy = req.user?.displayName || req.user?.email || 'Team';
    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      {
        $push: { notes: { text: text.trim(), addedBy, addedAt: new Date() } },
        $set: { lastActivityAt: new Date() }
      },
      { new: true }
    );
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    res.json({ success: true, data: lead });
  } catch (err) {
    console.error('Error adding note:', err);
    res.status(500).json({ error: 'Failed to add note' });
  }
});

// ── DELETE /api/leads/:id ─────────────────────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    await Lead.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete lead' });
  }
});

module.exports = router;
