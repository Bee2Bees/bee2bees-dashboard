const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
  hotelName: { type: String, required: true },
  starRating: { type: String, default: '' }, // "3 Star" or "4 Star"
  category: { type: String, default: '' },   // Standard/Deluxe/Premium/Luxury
  cpRate: { type: Number, default: 0 },
  mapRate: { type: Number, default: 0 },
  apRate: { type: Number, default: 0 },
  photosUrl: { type: String, default: '' },
  isActive: { type: Boolean, default: true },
  lastSyncedAt: { type: Date, default: null }
}, { timestamps: true });

hotelSchema.index({ hotelName: 1, starRating: 1, category: 1 });

module.exports = mongoose.model('Hotel', hotelSchema);
