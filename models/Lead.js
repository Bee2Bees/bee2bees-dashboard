const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  agentPhone: {
    type: String,
    required: true
  },
  agentName: {
    type: String,
    default: ''
  },
  agentCompany: {
    type: String,
    default: ''
  },
  destination: {
    type: String,
    default: ''
  },
  enquiryDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['नई पूछताछ', 'फॉलो अप', 'कोटेशन भेजा', 'बुकिंग कन्फर्म', 'पेमेंट मिला'],
    default: 'नई पूछताछ'
  },
  assignedTo: {
    type: String,
    default: ''
  },
  notes: {
    type: String,
    default: ''
  },
  totalValue: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Lead', leadSchema);
