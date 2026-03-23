const express = require('express');
const router = express.Router();
const Lead = require('../models/Lead');

// Auth middleware
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Authentication required' });
}

// GET /api/leads - list all leads
router.get('/', requireAuth, async (req, res) => {
  try {
    const leads = await Lead.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: leads });
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({ error: 'Failed to fetch leads' });
  }
});

// POST /api/leads - create new lead
router.post('/', requireAuth, async (req, res) => {
  try {
    const { agentPhone, agentName, agentCompany, destination, status, assignedTo, notes, totalValue } = req.body;

    if (!agentPhone) {
      return res.status(400).json({ error: 'Agent phone number is required' });
    }

    const lead = await Lead.create({
      agentPhone,
      agentName: agentName || '',
      agentCompany: agentCompany || '',
      destination: destination || '',
      enquiryDate: new Date(),
      status: status || 'नई पूछताछ',
      assignedTo: assignedTo || '',
      notes: notes || '',
      totalValue: totalValue || 0
    });

    res.status(201).json({ success: true, data: lead });
  } catch (err) {
    console.error('Error creating lead:', err);
    res.status(500).json({ error: 'Failed to create lead' });
  }
});

// PUT /api/leads/:id - update lead
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { status, assignedTo, notes, totalValue, destination, agentName, agentCompany } = req.body;

    const updateFields = {};
    if (status !== undefined) updateFields.status = status;
    if (assignedTo !== undefined) updateFields.assignedTo = assignedTo;
    if (notes !== undefined) updateFields.notes = notes;
    if (totalValue !== undefined) updateFields.totalValue = totalValue;
    if (destination !== undefined) updateFields.destination = destination;
    if (agentName !== undefined) updateFields.agentName = agentName;
    if (agentCompany !== undefined) updateFields.agentCompany = agentCompany;

    const lead = await Lead.findByIdAndUpdate(
      req.params.id,
      { $set: updateFields },
      { new: true }
    );

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    res.json({ success: true, data: lead });
  } catch (err) {
    console.error('Error updating lead:', err);
    res.status(500).json({ error: 'Failed to update lead' });
  }
});

module.exports = router;
