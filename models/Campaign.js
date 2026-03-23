const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true },
  message: { type: String, default: '' },
  templateName: { type: String, default: '' },
  templateLanguage: { type: String, default: 'en' },
  useVariables: { type: Boolean, default: false }, // true = send {{1}} = contact name
  contacts: [{ type: String }],
  status: {
    type: String,
    enum: ['draft', 'sending', 'sent', 'failed'],
    default: 'draft'
  },
  totalContacts: { type: Number, default: 0 },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  repliedCount: { type: Number, default: 0 },
  scheduledAt: { type: Date, default: null },
  sentAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('Campaign', campaignSchema);
