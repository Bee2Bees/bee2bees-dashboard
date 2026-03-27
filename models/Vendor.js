const mongoose = require('mongoose');
const vendorSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  category:    { type: String, enum: ['hotel','transport','activity','food','misc'], default: 'hotel' },
  contact:     { type: String, default: '' },
  gstin:       { type: String, default: '' },
  isActive:    { type: Boolean, default: true },
  notes:       { type: String, default: '' }
}, { timestamps: true });
vendorSchema.index({ name: 1 });
module.exports = mongoose.model('Vendor', vendorSchema);
