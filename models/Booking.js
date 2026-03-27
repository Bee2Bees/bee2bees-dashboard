const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
  hotelName:          { type: String, default: '' },
  checkIn:            { type: Date, default: null },
  checkOut:           { type: Date, default: null },
  nights:             { type: Number, default: 0 },
  breakfastIncluded:  { type: String, default: 'Yes' }, // Yes / No
  roomType:           { type: String, default: '' },
  adultExtraMattress: { type: Number, default: 0 },
  childExtraMattress: { type: Number, default: 0 }
}, { _id: false });

const itineraryDaySchema = new mongoose.Schema({
  day:                 { type: Number, default: 1 },
  date:                { type: Date, default: null },
  activity:            { type: String, default: '' },
  activityDescription: { type: String, default: '' },
  lunchIncluded:       { type: String, default: 'None' }, // None / At Hotel / Outside
  dinnerIncluded:      { type: String, default: 'None' }
}, { _id: false });

const paymentSchema = new mongoose.Schema({
  serialNo:      { type: Number, default: 1 },
  paymentDate:   { type: Date, default: null },
  amount:        { type: Number, default: 0 },
  paymentMethod: { type: String, default: 'UPI' }, // Net Banking / UPI / Credit Card / Debit Card
  bank:          { type: String, default: 'Bee2Bees' } // Bee2Bees / Tara Personal / Mummy Personal / Sachin Personal / Taku
}, { _id: false });

const bookingSchema = new mongoose.Schema({
  // Core
  queryType:     { type: String, enum: ['B2B', 'B2C'], default: 'B2B' },
  bookingSerial: { type: String, default: '' },
  bookingDate:   { type: Date, default: Date.now },
  bookingStatus: { type: String, enum: ['Confirmed', 'On Hold', 'Cancelled'], default: 'Confirmed' },
  assignedTo:    { type: String, default: '' },
  invoiceNumber: { type: String, default: '' }, // B2B only

  // People
  agentName:      { type: String, default: '' }, // B2B
  agentNumber:    { type: String, default: '' }, // B2B
  customerName:   { type: String, default: '' },
  customerNumber: { type: String, default: '' },

  // Destination
  destination:      { type: String, default: 'Goa' },
  destinationOther: { type: String, default: '' },

  // Booking Type
  bookingType:      { type: String, default: 'Full Package' },
  bookingTypeOther: { type: String, default: '' },

  // Pax
  adults:   { type: Number, default: 1 },
  kids:     { type: Number, default: 0 },
  child:    { type: Number, default: 0 },
  kidsAges: { type: [Number], default: [] },

  // Transport
  vehicleType:    { type: String, default: '' },
  pickupLocation: { type: String, default: '' },
  pickupTime:     { type: String, default: '' },
  dropLocation:   { type: String, default: '' },
  dropTime:       { type: String, default: '' },

  // Hotels (Full Package / Hotel Only)
  hotels: { type: [hotelSchema], default: [{}] },

  // Day-wise Itinerary (not for Hotel Only)
  itinerary: { type: [itineraryDaySchema], default: [] },

  // Financials
  totalCost: { type: Number, default: 0 },
  received:  { type: Number, default: 0 },
  pending:   { type: Number, default: 0 },

  // Payment entries
  payments: { type: [paymentSchema], default: [] },

  // Misc
  remarks:     { type: String, default: '' },
  relatedLead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: null },
  quoteSerial: { type: String, default: '' }
}, { timestamps: true });

bookingSchema.index({ bookingSerial: 1 });
bookingSchema.index({ bookingDate: -1 });
bookingSchema.index({ agentNumber: 1 });
bookingSchema.index({ customerNumber: 1 });

module.exports = mongoose.model('Booking', bookingSchema);
