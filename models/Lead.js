const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  text: { type: String, required: true },
  addedBy: { type: String, default: '' },
  addedAt: { type: Date, default: Date.now }
}, { _id: true });

const queryHistorySchema = new mongoose.Schema({
  query: { type: String, default: '' },
  response: { type: String, default: '' },
  timestamp: { type: Date, default: Date.now }
}, { _id: true });

const leadSchema = new mongoose.Schema({
  quoteSerial: { type: String, default: '', index: true },

  agentPhone: { type: String, required: true, index: true },
  agentName: { type: String, default: '' },
  agentCompany: { type: String, default: '' },

  // Booking details
  destination: { type: String, default: '' },
  checkIn: { type: Date, default: null },
  checkOut: { type: Date, default: null },
  nights: { type: Number, default: 0 },
  adults: { type: Number, default: 0 },
  kids: { type: Number, default: 0 },
  rooms: { type: Number, default: 0 },
  mealPlan: { type: String, default: '' },

  // Financial
  quoteAmount: { type: Number, default: 0 },
  advanceAmount: { type: Number, default: 0 },

  // Guest info
  guestName: { type: String, default: '' },
  guestPhone: { type: String, default: '' },
  hotelName: { type: String, default: '' },

  // CRM fields
  assignedTo: { type: String, default: '' },
  source: {
    type: String,
    enum: ['whatsapp_bot', 'manual'],
    default: 'manual'
  },
  stage: {
    type: String,
    enum: [
      'new_query', 'quote_sent', 'changes_requested', 'follow_up',
      'booking_confirmed', 'advance_received', 'voucher_sent',
      'completed', 'lost'
    ],
    default: 'new_query',
    index: true
  },

  // Activity tracking
  followUpCount: { type: Number, default: 0 },
  lastFollowUpAt: { type: Date, default: null },
  lastActivityAt: { type: Date, default: Date.now },

  // Notes (array of {text, addedBy, addedAt})
  notes: [noteSchema],

  // Day-wise itinerary from bot
  itinerary: [{
    day:                 { type: Number, default: 1 },
    date:                { type: Date,   default: null },
    activity:            { type: String, default: '' },
    activityDescription: { type: String, default: '' },
    lunchIncluded:       { type: String, default: 'None' },
    dinnerIncluded:      { type: String, default: 'None' }
  }],

  // Full query history from bot
  queryHistory: [queryHistorySchema]
}, {
  timestamps: true
});

module.exports = mongoose.model('Lead', leadSchema);
