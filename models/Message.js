const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  conversationId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Conversation',
    required: true,
    index: true
  },
  agentPhone: {
    type: String,
    required: true,
    index: true
  },
  direction: {
    type: String,
    enum: ['incoming', 'outgoing'],
    required: true
  },
  sentBy: {
    type: String,
    default: 'bot'
  },
  message: {
    type: String,
    required: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  isRead: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: false
});

messageSchema.index({ conversationId: 1, timestamp: 1 });

module.exports = mongoose.model('Message', messageSchema);
