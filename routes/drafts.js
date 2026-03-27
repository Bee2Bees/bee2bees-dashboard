const express = require('express');
const router = express.Router();
const Draft = require('../models/Draft');

const DASHBOARD_SECRET = process.env.DASHBOARD_WEBHOOK_SECRET || 'bee2bees_dashboard_2026';
const EXPIRY_DAYS = 7;

function requireBotSecret(req, res, next) {
  if (req.headers['x-dashboard-secret'] !== DASHBOARD_SECRET) {
    return res.status(403).json({ error: 'Invalid secret' });
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

function expiresAt() {
  const d = new Date();
  d.setDate(d.getDate() + EXPIRY_DAYS);
  return d;
}

// ─── POST /api/drafts/save ────────────────────────────────────────────────────
// Bot calls this to save (or overwrite) a draft or queued entry.
//
// For draft:
//   { quoteSerial, agentPhone, type: 'draft', stage, conversationState }
// For queued:
//   { agentPhone, type: 'queued', queryText }
//   (quoteSerial = active quote serial at time of conflict, for reference)
router.post('/drafts/save', requireBotSecret, async (req, res) => {
  try {
    const { quoteSerial, agentPhone, type, stage, conversationState, queryText } = req.body;

    if (!agentPhone || !type) {
      return res.status(400).json({ error: 'agentPhone and type required' });
    }
    if (type === 'draft' && !conversationState) {
      return res.status(400).json({ error: 'conversationState required for draft' });
    }
    if (type === 'queued' && !queryText) {
      return res.status(400).json({ error: 'queryText required for queued' });
    }

    const filter = { quoteSerial: quoteSerial || '', agentPhone, type };
    const update = {
      quoteSerial: quoteSerial || '',
      agentPhone,
      type,
      stage: stage || '',
      conversationState: type === 'draft' ? conversationState : null,
      queryText: type === 'queued' ? queryText : '',
      expiresAt: expiresAt()
    };

    const draft = await Draft.findOneAndUpdate(filter, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    });

    res.json({ success: true, id: draft._id, quoteSerial: draft.quoteSerial, type });
  } catch (err) {
    console.error('Draft save error:', err);
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

// ─── GET /api/drafts/:quoteSerial ─────────────────────────────────────────────
// Bot calls this when agent says "open Goa_143".
// Returns the draft state AND deletes it (agent must re-save if they want to keep it).
router.get('/drafts/:quoteSerial', requireBotSecret, async (req, res) => {
  try {
    const { quoteSerial } = req.params;
    const { agentPhone } = req.query;

    const filter = { quoteSerial, type: 'draft' };
    if (agentPhone) filter.agentPhone = agentPhone;

    const draft = await Draft.findOneAndDelete(filter);

    if (!draft) {
      return res.status(404).json({ error: 'Draft not found or already expired' });
    }

    res.json({
      success: true,
      quoteSerial: draft.quoteSerial,
      agentPhone: draft.agentPhone,
      stage: draft.stage,
      conversationState: draft.conversationState,
      savedAt: draft.updatedAt,
      expiresAt: draft.expiresAt
    });
  } catch (err) {
    console.error('Draft open error:', err);
    res.status(500).json({ error: 'Failed to open draft' });
  }
});

// ─── GET /api/drafts/queue/:phone ─────────────────────────────────────────────
// Bot calls this after finishing a query to check if agent has queued items.
router.get('/drafts/queue/:phone', requireBotSecret, async (req, res) => {
  try {
    const queued = await Draft.find({
      agentPhone: req.params.phone,
      type: 'queued',
      expiresAt: { $gt: new Date() }
    }).sort({ createdAt: 1 }); // oldest first

    res.json({
      success: true,
      count: queued.length,
      data: queued.map(q => ({
        id: q._id,
        quoteSerial: q.quoteSerial,
        queryText: q.queryText,
        savedAt: q.createdAt,
        expiresAt: q.expiresAt
      }))
    });
  } catch (err) {
    console.error('Queue fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch queue' });
  }
});

// ─── DELETE /api/drafts/queue/:id ─────────────────────────────────────────────
// Bot calls this when agent starts a queued query (removes from queue).
// The bot then processes the query normally → lead gets created via existing webhook.
router.delete('/drafts/queue/:id', requireBotSecret, async (req, res) => {
  try {
    const result = await Draft.findOneAndDelete({
      _id: req.params.id,
      type: 'queued'
    });

    if (!result) {
      return res.status(404).json({ error: 'Queued item not found' });
    }

    res.json({ success: true, message: 'Removed from queue' });
  } catch (err) {
    console.error('Queue delete error:', err);
    res.status(500).json({ error: 'Failed to remove from queue' });
  }
});

// ─── GET /api/drafts/list/:phone ──────────────────────────────────────────────
// Bot calls this to list all active drafts for an agent (e.g. for reminder messages).
router.get('/drafts/list/:phone', requireBotSecret, async (req, res) => {
  try {
    const drafts = await Draft.find({
      agentPhone: req.params.phone,
      type: 'draft',
      expiresAt: { $gt: new Date() }
    }).sort({ updatedAt: -1 });

    res.json({
      success: true,
      count: drafts.length,
      data: drafts.map(d => ({
        id: d._id,
        quoteSerial: d.quoteSerial,
        stage: d.stage,
        savedAt: d.updatedAt,
        expiresAt: d.expiresAt
      }))
    });
  } catch (err) {
    console.error('Draft list error:', err);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
});

// ─── GET /api/admin/drafts ────────────────────────────────────────────────────
// Dashboard view — see all active drafts + queue (for team visibility).
router.get('/admin/drafts', requireAuth, async (req, res) => {
  try {
    const { type } = req.query;
    const filter = { expiresAt: { $gt: new Date() } };
    if (type) filter.type = type;

    const items = await Draft.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, count: items.length, data: items });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch drafts' });
  }
});

module.exports = router;
