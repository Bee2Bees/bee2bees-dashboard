const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema({
  agentPhone: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  agentName: {
    type: String,
    default: 'Unknown Agent'
  },
  agentCompany: {
    type: String,
    default: ''
  },
  status: {
    type: String,
    enum: ['bot', 'human', 'resolved'],
    default: 'bot'
  },
  assignedTo: {
    type: String,
    default: ''
  },
  lastMessage: {
    type: String,
    default: ''
  },
  lastMessageTime: {
    type: Date,
    default: Date.now
  },
  unreadCount: {
    type: Number,
    default: 0
  },
  labels: [{
    type: String,
    enum: ['new_enquiry', 'following_up', 'quote_sent', 'booking_confirmed']
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Conversation', conversationSchema);
