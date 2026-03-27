const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ─── GET /api/bookings ────────────────────────────────────────────────────────
router.get('/bookings', requireAuth, async (req, res) => {
  try {
    const { search, status, queryType, destination, assignedTo } = req.query;
    const filter = {};

    if (status)      filter.bookingStatus = status;
    if (queryType)   filter.queryType = queryType;
    if (destination) filter.destination = destination;
    if (assignedTo)  filter.assignedTo = assignedTo;
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

module.exports = router;
