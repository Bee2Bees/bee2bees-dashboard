const mongoose = require('mongoose');

const sharedActivitySchema = new mongoose.Schema({
  activityId: { type: Number, default: null },
  activityName: { type: String, required: true },
  adultPrice: { type: Number, default: 0 },
  childPrice: { type: Number, default: 0 },
  description: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  lastSyncedAt: { type: Date, default: null }
}, { timestamps: true });

sharedActivitySchema.index({ activityName: 1 });

module.exports = mongoose.model('SharedActivity', sharedActivitySchema);
