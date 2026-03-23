const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: { type: String, default: '' },
  phone: { type: String, required: true, unique: true, index: true },
  email: { type: String, default: '' },
  company: { type: String, default: '' },
  city: { type: String, default: '' },
  source: { type: String, default: '' },
  tags: [{ type: String }],
  status: {
    type: String,
    enum: ['active', 'unsubscribed'],
    default: 'active'
  }
}, { timestamps: true });

module.exports = mongoose.model('Contact', contactSchema);
