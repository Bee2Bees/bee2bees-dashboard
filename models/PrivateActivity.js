const mongoose = require('mongoose');

const privateActivitySchema = new mongoose.Schema({
  activityName: { type: String, required: true },
  unitType: { type: String, default: '' }, // Per Person / Per Vehicle
  adultPrice: { type: Number, default: 0 },
  childPrice: { type: Number, default: 0 },
  vehicleType: { type: String, default: '' },
  description: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  lastSyncedAt: { type: Date, default: null }
}, { timestamps: true });

privateActivitySchema.index({ activityName: 1 });

module.exports = mongoose.model('PrivateActivity', privateActivitySchema);
