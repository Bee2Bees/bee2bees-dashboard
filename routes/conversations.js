const express = require('express');
const router = express.Router();
const axios = require('axios');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');

const WA_TOKEN = process.env.WHATSAPP_TOKEN;
const WA_PHONE_ID = process.env.PHONE_NUMBER_ID;

async function sendWhatsAppMessage(to, text) {
  const response = await axios.post(
    `https://graph.facebook.com/v22.0/${WA_PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
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

// Auth middleware
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Authentication required' });
}

// GET /api/conversations - list all conversations
router.get('/', requireAuth, async (req, res) => {
  try {
    const conversations = await Conversation.find()
      .sort({ lastMessageTime: -1 })
      .lean();
    res.json({ success: true, data: conversations });
  } catch (err) {
    console.error('Error fetching conversations:', err);
    res.status(500).json({ error: 'Failed to fetch conversations' });
  }
});

// GET /api/conversations/:phone - get full conversation history
router.get('/:phone', requireAuth, async (req, res) => {
  try {
    const phone = req.params.phone;
    const conversation = await Conversation.findOne({ agentPhone: phone }).lean();
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    const messages = await Message.find({ agentPhone: phone })
      .sort({ timestamp: 1 })
      .lean();

    // Mark messages as read
    await Message.updateMany(
      { agentPhone: phone, isRead: false, direction: 'incoming' },
      { $set: { isRead: true } }
    );
    await Conversation.updateOne(
      { agentPhone: phone },
      { $set: { unreadCount: 0 } }
    );

    res.json({ success: true, data: { conversation, messages } });
  } catch (err) {
    console.error('Error fetching conversation history:', err);
    res.status(500).json({ error: 'Failed to fetch conversation history' });
  }
});

// POST /api/conversations/:phone/takeover - team takes over from bot
router.post('/:phone/takeover', requireAuth, async (req, res) => {
  try {
    const phone = req.params.phone;
    const teamMember = req.user.displayName || req.user.email;

    const conversation = await Conversation.findOneAndUpdate(
      { agentPhone: phone },
      {
        $set: {
          status: 'human',
          assignedTo: teamMember
        }
      },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Log system message
    await Message.create({
      conversationId: conversation._id,
      agentPhone: phone,
      direction: 'outgoing',
      sentBy: 'system',
      message: `✅ ${teamMember} ने बातचीत संभाल ली है`,
      timestamp: new Date(),
      isRead: true
    });

    res.json({ success: true, data: conversation });
  } catch (err) {
    console.error('Error taking over conversation:', err);
    res.status(500).json({ error: 'Failed to take over conversation' });
  }
});

// POST /api/conversations/:phone/handback - silent hand back to bot
router.post('/:phone/handback', requireAuth, async (req, res) => {
  try {
    const phone = req.params.phone;
    const teamMember = req.user.displayName || req.user.email;

    const conversation = await Conversation.findOneAndUpdate(
      { agentPhone: phone },
      {
        $set: {
          status: 'bot',
          assignedTo: ''
        }
      },
      { new: true }
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Silent handback — no WhatsApp message sent to agent
    // Log internal system note only
    await Message.create({
      conversationId: conversation._id,
      agentPhone: phone,
      direction: 'outgoing',
      sentBy: 'system',
      message: `🤖 Bot को वापस दिया गया (by ${teamMember})`,
      timestamp: new Date(),
      isRead: true
    });

    res.json({ success: true, data: conversation });
  } catch (err) {
    console.error('Error handing back conversation:', err);
    res.status(500).json({ error: 'Failed to hand back conversation' });
  }
});

// POST /api/conversations/:phone/send - team sends manual message via WhatsApp
router.post('/:phone/send', requireAuth, async (req, res) => {
  try {
    const phone = req.params.phone;
    const { message } = req.body;
    const teamMember = req.user.displayName || req.user.email;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Message cannot be empty' });
    }

    const conversation = await Conversation.findOne({ agentPhone: phone });
    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    // Send via WhatsApp API
    let whatsappError = null;
    try {
      await sendWhatsAppMessage(phone, message.trim());
    } catch (waErr) {
      whatsappError = waErr.response?.data?.error?.message || waErr.message;
      console.error('WhatsApp API error:', waErr.response?.data || waErr.message);
    }

    if (whatsappError) {
      return res.status(502).json({
        error: 'WhatsApp message failed',
        detail: whatsappError
      });
    }

    // Save to MongoDB
    const newMessage = await Message.create({
      conversationId: conversation._id,
      agentPhone: phone,
      direction: 'outgoing',
      sentBy: teamMember,
      message: message.trim(),
      timestamp: new Date(),
      isRead: true
    });

    // Update conversation: set status to human, update last message
    await Conversation.updateOne(
      { agentPhone: phone },
      {
        $set: {
          lastMessage: message.trim(),
          lastMessageTime: new Date(),
          status: 'human',
          assignedTo: conversation.assignedTo || teamMember
        }
      }
    );

    res.json({ success: true, data: newMessage });
  } catch (err) {
    console.error('Error sending message:', err);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// GET /api/conversations/:phone/status - bot checks if conversation is taken over
// No login required; validated by X-Dashboard-Secret header
router.get('/:phone/status', (req, res, next) => {
  const secret = req.headers['x-dashboard-secret'];
  if (secret !== (process.env.DASHBOARD_WEBHOOK_SECRET || 'bee2bees_dashboard_2026')) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}, async (req, res) => {
  try {
    const phone = req.params.phone;
    const conversation = await Conversation.findOne({ agentPhone: phone }).lean();
    if (!conversation) {
      return res.json({ status: 'bot', assignedTo: null });
    }
    res.json({
      status: conversation.status || 'bot',
      assignedTo: conversation.assignedTo || null,
    });
  } catch (err) {
    console.error('Error fetching conversation status:', err);
    res.status(500).json({ error: 'Failed to fetch status' });
  }
});

module.exports = router;
