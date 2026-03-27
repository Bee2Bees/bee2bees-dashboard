const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const Booking = require('../models/Booking');

const DASHBOARD_SECRET = process.env.DASHBOARD_WEBHOOK_SECRET || 'bee2bees_dashboard_2026';

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// Allow either session auth OR x-dashboard-secret header
function requireAuthOrSecret(req, res, next) {
  if (req.isAuthenticated()) return next();
  const secret = req.headers['x-dashboard-secret'];
  if (secret && secret === DASHBOARD_SECRET) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ─── GET /api/bookings ────────────────────────────────────────────────────────
router.get('/bookings', requireAuth, async (req, res) => {
  try {
    const { search, status, queryType, destination, assignedTo, dateFrom, dateTo } = req.query;
    const filter = {};

    if (status)      filter.bookingStatus = status;
    if (queryType)   filter.queryType = queryType;
    if (destination) filter.destination = destination;
    if (assignedTo)  filter.assignedTo = assignedTo;
    if (dateFrom || dateTo) {
      filter.bookingDate = {};
      if (dateFrom) filter.bookingDate.$gte = new Date(dateFrom);
      if (dateTo)   filter.bookingDate.$lte = new Date(dateTo + 'T23:59:59.999Z');
    }
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [
        { bookingSerial: re }, { agentName: re }, { agentNumber: re },
        { customerName: re }, { customerNumber: re }, { destination: re },
        { quoteSerial: re }
      ];
    }

    const bookings = await Booking.find(filter).sort({ bookingDate: -1 }).lean();
    res.json({ success: true, count: bookings.length, data: bookings });
  } catch (err) {
    console.error('Bookings fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch bookings' });
  }
});

// ─── POST /api/bookings ───────────────────────────────────────────────────────
router.post('/bookings', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    // Auto-calculate pending
    body.pending = (body.totalCost || 0) - (body.received || 0);
    const booking = await Booking.create(body);
    res.json({ success: true, data: booking });
  } catch (err) {
    console.error('Booking create error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// ─── GET /api/bookings/checkout-today — bot cron, secret-protected ────────────
// MUST be before /bookings/:id to prevent "checkout-today" being treated as an ID
router.get('/bookings/checkout-today', async (req, res) => {
  try {
    const secret = req.headers['x-dashboard-secret'];
    if (!secret || secret !== DASHBOARD_SECRET) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Find bookings where any hotel.checkOut falls today AND costFormFilledAt is null
    const bookings = await Booking.find({
      'hotels.checkOut': { $gte: today, $lt: tomorrow },
      $or: [{ costFormFilledAt: null }, { costFormFilledAt: { $exists: false } }]
    }).lean();

    res.json({ success: true, bookings });
  } catch (err) {
    console.error('checkout-today error:', err);
    res.status(500).json({ error: 'Failed to fetch checkout bookings' });
  }
});

// ─── GET /api/bookings/:id ────────────────────────────────────────────────────
router.get('/bookings/:id', requireAuth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id).lean();
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ success: true, data: booking });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch booking' });
  }
});

// ─── PUT /api/bookings/:id ────────────────────────────────────────────────────
router.put('/bookings/:id', requireAuth, async (req, res) => {
  try {
    const body = req.body;
    body.pending = (body.totalCost || 0) - (body.received || 0);
    const booking = await Booking.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!booking) return res.status(404).json({ error: 'Booking not found' });
    res.json({ success: true, data: booking });
  } catch (err) {
    console.error('Booking update error:', err);
    res.status(500).json({ error: 'Failed to update booking' });
  }
});

// ─── DELETE /api/bookings/:id ─────────────────────────────────────────────────
router.delete('/bookings/:id', requireAuth, async (req, res) => {
  try {
    await Booking.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete booking' });
  }
});

// ─── POST /api/bookings/:id/actual-costs ──────────────────────────────────────
router.post('/bookings/:id/actual-costs', requireAuth, async (req, res) => {
  try {
    const costs = Array.isArray(req.body) ? req.body : [];
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    booking.actualCosts = costs;
    const totalActual = costs.reduce((s, c) => s + (parseFloat(c.amount) || 0), 0);
    const revenue = booking.totalCost || 0;
    booking.profit = revenue - totalActual;
    booking.margin = revenue > 0 ? Math.round((booking.profit / revenue) * 1000) / 10 : 0;

    await booking.save();
    res.json({ success: true, data: booking });
  } catch (err) {
    console.error('actual-costs error:', err);
    res.status(500).json({ error: 'Failed to save actual costs' });
  }
});

// ─── POST /api/bookings/:id/send-cost-form ────────────────────────────────────
router.post('/bookings/:id/send-cost-form', requireAuthOrSecret, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const token = crypto.randomBytes(16).toString('hex');
    booking.costFormToken = token;
    booking.costFormTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await booking.save();

    const link = `https://bee2bees-dashboard.onrender.com/cost-form/${booking._id}/${token}`;
    const guestName = booking.agentName || booking.customerName || 'Guest';
    const dest = booking.destination === 'Other' ? (booking.destinationOther || 'Other') : booking.destination;
    const message = `🐝 *Bee2Bees DMC — Actual Cost Form*\n\nPlease fill vendor costs for booking *${booking.bookingSerial || booking._id}*\n👤 ${guestName} | 📍 ${dest}\n💰 Revenue: ₹${(booking.totalCost || 0).toLocaleString('en-IN')}\n\n🔗 Fill costs here:\n${link}`;

    res.json({ success: true, link, message });
  } catch (err) {
    console.error('send-cost-form error:', err);
    res.status(500).json({ error: 'Failed to generate cost form link' });
  }
});

module.exports = router;
