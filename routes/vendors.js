const express = require('express');
const router = express.Router();
const Vendor = require('../models/Vendor');

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ─── GET /api/vendors/list — dropdown list (active only) ──────────────────────
router.get('/list', requireAuth, async (req, res) => {
  try {
    const vendors = await Vendor.find({ isActive: true }, '_id name category').sort({ name: 1 }).lean();
    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch vendor list' });
  }
});

// ─── GET /api/vendors ──────────────────────────────────────────────────────────
router.get('/', requireAuth, async (req, res) => {
  try {
    const { category, search, isActive } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ name: re }, { contact: re }, { gstin: re }];
    }
    const vendors = await Vendor.find(filter).sort({ name: 1 }).lean();
    res.json({ success: true, count: vendors.length, data: vendors });
  } catch (err) {
    console.error('Vendors fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch vendors' });
  }
});

// ─── POST /api/vendors ─────────────────────────────────────────────────────────
router.post('/', requireAuth, async (req, res) => {
  try {
    const vendor = await Vendor.create(req.body);
    res.json({ success: true, data: vendor });
  } catch (err) {
    console.error('Vendor create error:', err);
    res.status(500).json({ error: 'Failed to create vendor' });
  }
});

// ─── PUT /api/vendors/:id ──────────────────────────────────────────────────────
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) {
    console.error('Vendor update error:', err);
    res.status(500).json({ error: 'Failed to update vendor' });
  }
});

// ─── DELETE /api/vendors/:id — soft delete ────────────────────────────────────
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!vendor) return res.status(404).json({ error: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete vendor' });
  }
});

module.exports = router;
