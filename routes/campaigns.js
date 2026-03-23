const express = require('express');
const router = express.Router();
const axios = require('axios');
const Contact = require('../models/Contact');
const Campaign = require('../models/Campaign');

const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.PHONE_NUMBER_ID;

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Authentication required' });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatPhone(phone) {
  let p = String(phone).replace(/[\s\-\(\)\+]/g, ''); // remove spaces, dashes, brackets, +
  if (p.startsWith('0')) p = p.slice(1);               // remove leading 0
  if (p.length === 10) p = '91' + p;                   // 10-digit Indian mobile → add 91
  return p;
}

// ─── Send a WhatsApp template message ────────────────────────────────────────
async function sendTemplateMessage(to, templateName, language, variables) {
  const components = [];
  if (variables && variables.length > 0) {
    components.push({
      type: 'body',
      parameters: variables.map(v => ({ type: 'text', text: String(v) }))
    });
  }

  const response = await axios.post(
    `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: language || 'en' },
        components: components.length ? components : undefined
      }
    },
    {
      headers: {
        Authorization: `Bearer ${WA_TOKEN}`,
        'Content-Type': 'application/json'
      }
    }
  );
  return response.data;
}

// ═════════════════════════════════════════════════════════════
// CONTACTS
// ═════════════════════════════════════════════════════════════

// GET /api/contacts
router.get('/contacts', requireAuth, async (req, res) => {
  try {
    const { search, source, tag, status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (source) filter.source = source;
    if (tag) filter.tags = tag;
    if (search) {
      const re = new RegExp(search, 'i');
      filter.$or = [{ name: re }, { phone: re }, { company: re }, { city: re }, { email: re }];
    }
    const contacts = await Contact.find(filter).sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: contacts, total: contacts.length });
  } catch (err) {
    console.error('Contacts fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch contacts' });
  }
});

// POST /api/contacts/upload — bulk upsert from parsed array
router.post('/contacts/upload', requireAuth, async (req, res) => {
  try {
    const { contacts } = req.body;
    if (!Array.isArray(contacts) || contacts.length === 0) {
      return res.status(400).json({ error: 'contacts array required' });
    }

    let inserted = 0, updated = 0, skipped = 0;

    for (const c of contacts) {
      if (!c.phone) { skipped++; continue; }

      // Normalize phone: strip spaces/dashes, ensure no leading +
      const phone = String(c.phone).replace(/[\s\-()]/g, '');
      if (!phone) { skipped++; continue; }

      try {
        const result = await Contact.findOneAndUpdate(
          { phone },
          {
            $set: {
              name: c.name || '',
              email: c.email || '',
              company: c.company || '',
              city: c.city || '',
              source: c.source || '',
              tags: c.tags || []
            },
            $setOnInsert: { status: 'active' }
          },
          { upsert: true, new: true }
        );
        if (result.createdAt?.getTime() === result.updatedAt?.getTime()) inserted++;
        else updated++;
      } catch (e) {
        if (e.code === 11000) updated++;
        else skipped++;
      }
    }

    res.json({ success: true, inserted, updated, skipped, total: contacts.length });
  } catch (err) {
    console.error('Contacts upload error:', err);
    res.status(500).json({ error: 'Failed to upload contacts' });
  }
});

// PUT /api/contacts/:id
router.put('/contacts/:id', requireAuth, async (req, res) => {
  try {
    const { name, email, company, city, source, tags, status } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (email !== undefined) update.email = email;
    if (company !== undefined) update.company = company;
    if (city !== undefined) update.city = city;
    if (source !== undefined) update.source = source;
    if (tags !== undefined) update.tags = tags;
    if (status !== undefined) update.status = status;

    const contact = await Contact.findByIdAndUpdate(req.params.id, { $set: update }, { new: true });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json({ success: true, data: contact });
  } catch (err) {
    console.error('Contact update error:', err);
    res.status(500).json({ error: 'Failed to update contact' });
  }
});

// DELETE /api/contacts/:id
router.delete('/contacts/:id', requireAuth, async (req, res) => {
  try {
    await Contact.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Contact delete error:', err);
    res.status(500).json({ error: 'Failed to delete contact' });
  }
});

// ═════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═════════════════════════════════════════════════════════════

// GET /api/campaigns
router.get('/campaigns', requireAuth, async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 }).lean();
    res.json({ success: true, data: campaigns });
  } catch (err) {
    console.error('Campaigns fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch campaigns' });
  }
});

// POST /api/campaigns
router.post('/campaigns', requireAuth, async (req, res) => {
  try {
    const { name, message, templateName, templateLanguage, contacts, useVariables } = req.body;
    if (!name) return res.status(400).json({ error: 'Campaign name required' });

    const campaign = await Campaign.create({
      name,
      message: message || '',
      templateName: templateName || '',
      templateLanguage: templateLanguage || 'en',
      useVariables: useVariables === true || useVariables === 'true',
      contacts: contacts || [],
      totalContacts: (contacts || []).length,
      status: 'draft'
    });
    res.status(201).json({ success: true, data: campaign });
  } catch (err) {
    console.error('Campaign create error:', err);
    res.status(500).json({ error: 'Failed to create campaign' });
  }
});

// GET /api/campaigns/:id
router.get('/campaigns/:id', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json({ success: true, data: campaign });
  } catch (err) {
    console.error('Campaign fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch campaign' });
  }
});

// GET /api/campaigns/:id/stats
router.get('/campaigns/:id/stats', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const deliveryRate = campaign.totalContacts > 0
      ? Math.round((campaign.sentCount / campaign.totalContacts) * 100)
      : 0;

    res.json({
      success: true,
      data: {
        name: campaign.name,
        status: campaign.status,
        totalContacts: campaign.totalContacts,
        sentCount: campaign.sentCount,
        failedCount: campaign.failedCount,
        repliedCount: campaign.repliedCount,
        deliveryRate,
        sentAt: campaign.sentAt
      }
    });
  } catch (err) {
    console.error('Campaign stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// POST /api/campaigns/:id/send — trigger broadcast
router.post('/campaigns/:id/send', requireAuth, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'sending') {
      return res.status(409).json({ error: 'Campaign is already sending' });
    }
    if (campaign.status === 'sent') {
      return res.status(409).json({ error: 'Campaign already sent' });
    }
    if (!campaign.templateName) {
      return res.status(400).json({ error: 'Template name required to send campaign' });
    }
    if (!campaign.contacts || campaign.contacts.length === 0) {
      return res.status(400).json({ error: 'No contacts selected for this campaign' });
    }

    // Mark as sending immediately
    await Campaign.findByIdAndUpdate(campaign._id, {
      $set: { status: 'sending', sentCount: 0, failedCount: 0 }
    });

    // Respond immediately — sending happens in background
    res.json({ success: true, message: 'Campaign sending started', total: campaign.contacts.length });

    // ── Background send loop ──────────────────────────────
    let sentCount = 0;
    let failedCount = 0;

    for (const rawPhone of campaign.contacts) {
      const phone = formatPhone(rawPhone);
      try {
        // Fetch contact name for template variable {{1}}
        const contact = await Contact.findOne({ $or: [{ phone: rawPhone }, { phone }] }).lean();
        const contactName = contact?.name || 'Agent';

        // Only pass variables if template uses parameters like {{1}}
        const variables = campaign.useVariables ? [contactName] : [];
        await sendTemplateMessage(
          phone,
          campaign.templateName,
          campaign.templateLanguage || 'en',
          variables
        );
        sentCount++;
      } catch (err) {
        failedCount++;
        console.error(`Campaign send failed for ${rawPhone} (formatted: ${phone}):`, err.response?.data || err.message);
      }

      // Update progress every 10 messages
      if ((sentCount + failedCount) % 10 === 0) {
        await Campaign.findByIdAndUpdate(campaign._id, {
          $set: { sentCount, failedCount }
        });
      }

      // 1 second delay between messages to respect rate limits
      await sleep(1000);
    }

    // Final update
    await Campaign.findByIdAndUpdate(campaign._id, {
      $set: {
        status: failedCount === campaign.contacts.length ? 'failed' : 'sent',
        sentCount,
        failedCount,
        sentAt: new Date()
      }
    });

    console.log(`✅ Campaign "${campaign.name}" done: ${sentCount} sent, ${failedCount} failed`);
  } catch (err) {
    console.error('Campaign send error:', err);
    await Campaign.findByIdAndUpdate(req.params.id, { $set: { status: 'failed' } }).catch(() => {});
    // Response already sent, so just log
  }
});

module.exports = router;
