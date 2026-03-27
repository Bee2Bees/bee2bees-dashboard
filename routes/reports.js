const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');
const Booking = require('../models/Booking');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function getDateRange(period, dateFrom, dateTo) {
  const now = new Date();
  let from, to;
  if (period === 'today') {
    from = new Date(now); from.setHours(0, 0, 0, 0);
    to = new Date(now); to.setHours(23, 59, 59, 999);
  } else if (period === 'week') {
    from = new Date(now);
    const day = from.getDay();
    const diff = (day === 0) ? -6 : 1 - day; // Monday
    from.setDate(from.getDate() + diff);
    from.setHours(0, 0, 0, 0);
    to = new Date(now); to.setHours(23, 59, 59, 999);
  } else if (period === 'month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    to = new Date(now); to.setHours(23, 59, 59, 999);
  } else if (period === 'year') {
    from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    to = new Date(now); to.setHours(23, 59, 59, 999);
  } else if (period === 'custom' && dateFrom && dateTo) {
    from = new Date(dateFrom + 'T00:00:00.000Z');
    to = new Date(dateTo + 'T23:59:59.999Z');
  } else {
    // default: this month
    from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    to = new Date(now); to.setHours(23, 59, 59, 999);
  }
  return { from, to };
}

// ─── GET /api/reports/overview ────────────────────────────────────────────────
router.get('/overview', requireAuth, async (req, res) => {
  try {
    const { period = 'month', dateFrom, dateTo } = req.query;
    const { from, to } = getDateRange(period, dateFrom, dateTo);
    const dateFilter = { createdAt: { $gte: from, $lte: to } };
    const bookingDateFilter = { bookingDate: { $gte: from, $lte: to } };

    // ── Leads ──
    const leadStages = ['new_query','quote_sent','changes_requested','follow_up','booking_confirmed','advance_received','voucher_sent','completed','lost'];
    const leadAgg = await Lead.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$stage', count: { $sum: 1 } } }
    ]);
    const leadMap = {};
    leadAgg.forEach(l => { leadMap[l._id] = l.count; });
    const leadsTotal = leadAgg.reduce((s, l) => s + l.count, 0);
    const leads = { total: leadsTotal };
    leadStages.forEach(s => { leads[s] = leadMap[s] || 0; });

    // ── Bookings ──
    const bookingAgg = await Booking.aggregate([
      { $match: bookingDateFilter },
      { $group: {
        _id: '$bookingStatus',
        count: { $sum: 1 },
        revenue: { $sum: '$totalCost' },
        received: { $sum: '$received' },
        pending: { $sum: '$pending' },
        profit: { $sum: { $ifNull: ['$profit', 0] } }
      }}
    ]);
    const bkMap = {};
    bookingAgg.forEach(b => { bkMap[b._id] = b; });
    const allBk = await Booking.aggregate([
      { $match: bookingDateFilter },
      { $group: {
        _id: null,
        total: { $sum: 1 },
        revenue: { $sum: '$totalCost' },
        received: { $sum: '$received' },
        pending: { $sum: '$pending' },
        totalCost: { $sum: { $reduce: { input: '$actualCosts', initialValue: 0, in: { $add: ['$$value', '$$this.amount'] } } } },
        profit: { $sum: { $ifNull: ['$profit', 0] } }
      }}
    ]);
    const bkTotals = allBk[0] || { total: 0, revenue: 0, received: 0, pending: 0, totalCost: 0, profit: 0 };
    const margin = bkTotals.revenue > 0 ? Math.round((bkTotals.profit / bkTotals.revenue) * 1000) / 10 : 0;

    const bookings = {
      total: bkTotals.total,
      confirmed: (bkMap['Confirmed'] || {}).count || 0,
      onHold: (bkMap['On Hold'] || {}).count || 0,
      cancelled: (bkMap['Cancelled'] || {}).count || 0,
      revenue: bkTotals.revenue,
      received: bkTotals.received,
      pending: bkTotals.pending,
      totalCost: bkTotals.totalCost,
      profit: bkTotals.profit,
      margin
    };

    // ── Top Agents ──
    const topAgentsAgg = await Booking.aggregate([
      { $match: bookingDateFilter },
      { $match: { queryType: 'B2B' } },
      { $group: {
        _id: '$agentNumber',
        name: { $first: '$agentName' },
        company: { $first: { $literal: '' } },
        bookings: { $sum: 1 },
        revenue: { $sum: '$totalCost' }
      }},
      { $sort: { revenue: -1 } },
      { $limit: 10 }
    ]);
    // Also get lead counts per agent
    const agentLeadAgg = await Lead.aggregate([
      { $match: dateFilter },
      { $group: { _id: '$agentPhone', leads: { $sum: 1 } } }
    ]);
    const agentLeadMap = {};
    agentLeadAgg.forEach(a => { agentLeadMap[a._id] = a.leads; });

    const topAgents = topAgentsAgg.map(a => ({
      phone: a._id,
      name: a.name || '',
      company: a.company || '',
      leads: agentLeadMap[a._id] || 0,
      bookings: a.bookings,
      revenue: a.revenue
    }));

    // ── Staff Performance ──
    const staffAgg = await Booking.aggregate([
      { $match: bookingDateFilter },
      { $match: { assignedTo: { $ne: '' } } },
      { $group: {
        _id: '$assignedTo',
        bookings: { $sum: 1 },
        revenue: { $sum: '$totalCost' }
      }},
      { $sort: { revenue: -1 } }
    ]);
    const staffLeadAgg = await Lead.aggregate([
      { $match: dateFilter },
      { $match: { assignedTo: { $exists: true, $ne: '' } } },
      { $group: { _id: '$assignedTo', leads: { $sum: 1 } } }
    ]);
    const staffLeadMap = {};
    staffLeadAgg.forEach(s => { staffLeadMap[s._id] = s.leads; });

    const staffPerformance = staffAgg.map(s => ({
      name: s._id,
      leads: staffLeadMap[s._id] || 0,
      bookings: s.bookings,
      revenue: s.revenue
    }));

    // ── Vendor Spend ──
    const vendorAgg = await Booking.aggregate([
      { $match: bookingDateFilter },
      { $unwind: '$actualCosts' },
      { $group: {
        _id: { vendorName: '$actualCosts.vendorName', category: '$actualCosts.category' },
        totalAmount: { $sum: '$actualCosts.amount' },
        bookingCount: { $sum: 1 }
      }},
      { $sort: { totalAmount: -1 } },
      { $limit: 20 }
    ]);
    const vendors = vendorAgg.map(v => ({
      _id: v._id.vendorName,
      name: v._id.vendorName,
      category: v._id.category,
      totalAmount: v.totalAmount,
      bookingCount: v.bookingCount
    }));

    res.json({ success: true, leads, bookings, topAgents, staffPerformance, vendors });
  } catch (err) {
    console.error('Reports overview error:', err);
    res.status(500).json({ error: 'Failed to load reports' });
  }
});

module.exports = router;
