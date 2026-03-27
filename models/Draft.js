const mongoose = require('mongoose');

const draftSchema = new mongoose.Schema({
  quoteSerial: { type: String, required: true },   // e.g. "Goa_143"
  agentPhone:  { type: String, required: true },
  type:        { type: String, enum: ['draft', 'queued'], required: true },

  // Draft-only: full conversation state + which stage bot was at when saved
  stage:             { type: String, default: '' },  // e.g. "payment", "quote_sent"
  conversationState: { type: mongoose.Schema.Types.Mixed, default: null },

  // Queued-only: raw query text
  queryText: { type: String, default: '' },

  expiresAt: { type: Date, required: true }
}, { timestamps: true });

// One draft entry per (quoteSerial + agentPhone + type) — upsert keeps only latest
draftSchema.index({ quoteSerial: 1, agentPhone: 1, type: 1 }, { unique: true });
draftSchema.index({ agentPhone: 1, type: 1 });
draftSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // MongoDB TTL auto-cleanup

module.exports = mongoose.model('Draft', draftSchema);
