const mongoose = require('mongoose');

const transferSchema = new mongoose.Schema({
  transferName: { type: String, required: true },
  vehicleType: { type: String, default: '' },
  price: { type: Number, default: 0 },
  description: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  lastSyncedAt: { type: Date, default: null }
}, { timestamps: true });

transferSchema.index({ transferName: 1 });

module.exports = mongoose.model('Transfer', transferSchema);
