require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const session = require('express-session');
const { MongoStore } = require('connect-mongo');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

const Conversation = require('./models/Conversation');
const Message = require('./models/Message');
const Lead = require('./models/Lead');
const Booking = require('./models/Booking');
const Vendor = require('./models/Vendor');

const app = express();
const PORT = process.env.PORT || 4000;
const DASHBOARD_SECRET = process.env.DASHBOARD_WEBHOOK_SECRET || 'bee2bees_dashboard_2026';

// Trust reverse proxy (required for Render/Heroku so OAuth callback URL uses https://)
app.set('trust proxy', 1);

// ─── Middleware ──────────────────────────────────────────────────────────────
app.use(morgan('dev'));
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback_secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 7 * 24 * 60 * 60 // 7 days in seconds
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

app.use(passport.initialize());
app.use(passport.session());

// ─── Passport Google OAuth ────────────────────────────────────────────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_ID !== 'to_be_added') {
  passport.use(new GoogleStrategy({
    clientID: GOOGLE_CLIENT_ID,
    clientSecret: GOOGLE_CLIENT_SECRET,
    callbackURL: '/auth/google/callback'
  }, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails && profile.emails[0] ? profile.emails[0].value : '';
    const user = {
      id: profile.id,
      displayName: profile.displayName,
      email: email,
      photo: profile.photos && profile.photos[0] ? profile.photos[0].value : ''
    };
    return done(null, user);
  }));
} else {
  console.warn('⚠️  Google OAuth not configured. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env');
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

// ─── MongoDB Connection ───────────────────────────────────────────────────────
let dbConnected = false;

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000
    });
    dbConnected = true;
    console.log('✅ MongoDB connected successfully');
  } catch (err) {
    dbConnected = false;
    console.error('❌ MongoDB connection failed:', err.message);
    console.log('🔄 Retrying in 30 seconds...');
    setTimeout(connectDB, 30000);
  }
}

mongoose.connection.on('disconnected', () => {
  dbConnected = false;
  console.warn('⚠️  MongoDB disconnected. Reconnecting...');
  setTimeout(connectDB, 5000);
});

mongoose.connection.on('connected', () => {
  dbConnected = true;
});

// ─── DB health check middleware ───────────────────────────────────────────────
function checkDB(req, res, next) {
  if (!dbConnected) {
    return res.status(503).json({
      error: 'Database unavailable',
      message: 'MongoDB से कनेक्शन नहीं है। कृपया थोड़ी देर बाद कोशिश करें।'
    });
  }
  next();
}

// ─── Webhook Route (no auth needed) ──────────────────────────────────────────
app.post('/api/webhook/message', async (req, res) => {
  try {
    const secret = req.headers['x-dashboard-secret'];
    if (secret !== DASHBOARD_SECRET) {
      return res.status(403).json({ error: 'Invalid webhook secret' });
    }

    if (!dbConnected) {
      return res.status(503).json({ error: 'Database unavailable' });
    }

    const { agentPhone, agentName, agentCompany, direction, sentBy, message } = req.body;

    if (!agentPhone || !message || !direction) {
      return res.status(400).json({ error: 'Missing required fields: agentPhone, message, direction' });
    }

    // Upsert conversation
    let conversation = await Conversation.findOneAndUpdate(
      { agentPhone },
      {
        $set: {
          agentName: agentName || 'Unknown',
          agentCompany: agentCompany || '',
          lastMessage: message,
          lastMessageTime: new Date()
        },
        $setOnInsert: {
          status: 'bot',
          unreadCount: 0
        }
      },
      { upsert: true, new: true }
    );

    // Increment unread if incoming
    if (direction === 'incoming') {
      await Conversation.updateOne(
        { _id: conversation._id },
        { $inc: { unreadCount: 1 } }
      );
    }

    // Save message
    await Message.create({
      conversationId: conversation._id,
      agentPhone,
      direction,
      sentBy: sentBy || (direction === 'incoming' ? 'agent' : 'bot'),
      message,
      timestamp: new Date(),
      isRead: direction === 'outgoing'
    });

    // For every incoming message: ensure an active lead exists — create one if not
    if (direction === 'incoming') {
      const activeLead = await Lead.findOne(
        { agentPhone, stage: { $nin: ['completed', 'lost'] } },
        '_id lastActivityAt',
        { sort: { createdAt: -1 } }
      );

      if (activeLead) {
        // Just touch lastActivityAt
        Lead.updateOne({ _id: activeLead._id }, { lastActivityAt: new Date() }).catch(() => {});
      } else {
        // Auto-create a new lead so it appears in the kanban immediately
        const prefix = 'LEAD';
        const count = await Lead.countDocuments();
        const quoteSerial = `${prefix}_${String(count + 1).padStart(3, '0')}`;
        Lead.create({
          quoteSerial,
          agentPhone,
          agentName: agentName || '',
          agentCompany: agentCompany || '',
          stage: 'new_query',
          source: 'whatsapp_bot',
          lastActivityAt: new Date()
        }).catch(err => console.error('Auto-lead create error:', err));
      }
    }

    res.json({ success: true, message: 'Message saved' });
  } catch (err) {
    console.error('Webhook error:', err);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// ─── Webhook: Lead from bot ───────────────────────────────────────────────────
app.post('/api/webhook/lead', async (req, res) => {
  try {
    const secret = req.headers['x-dashboard-secret'];
    if (secret !== DASHBOARD_SECRET) {
      return res.status(403).json({ error: 'Invalid webhook secret' });
    }
    if (!dbConnected) return res.status(503).json({ error: 'Database unavailable' });

    const {
      agentPhone, agentName, agentCompany, destination,
      checkIn, checkOut, nights, adults, kids, rooms, mealPlan,
      quoteAmount, stage, source, queryText, responseText
    } = req.body;

    if (!agentPhone) return res.status(400).json({ error: 'agentPhone required' });

    const Lead = require('./models/Lead');
    const historyEntry = queryText
      ? [{ query: queryText || '', response: responseText || '', timestamp: new Date() }]
      : [];

    // Find the most recent new_query lead for this phone — only update if still at initial stage.
    // If the existing lead has already progressed (quote sent, modify, etc.), this is a NEW enquiry.
    const existingNewQueryLead = await Lead.findOne(
      { agentPhone, stage: 'new_query' },
      null,
      { sort: { createdAt: -1 } }
    );

    let lead;
    if (existingNewQueryLead) {
      // Still at new_query stage — fill in / update the query details
      const updateOp = {
        $set: {
          agentName: agentName || existingNewQueryLead.agentName,
          agentCompany: agentCompany || existingNewQueryLead.agentCompany,
          destination: destination || existingNewQueryLead.destination,
          checkIn: checkIn || existingNewQueryLead.checkIn,
          checkOut: checkOut || existingNewQueryLead.checkOut,
          nights: nights || existingNewQueryLead.nights,
          adults: adults || existingNewQueryLead.adults,
          kids: kids || existingNewQueryLead.kids,
          rooms: rooms || existingNewQueryLead.rooms,
          mealPlan: mealPlan || existingNewQueryLead.mealPlan,
          quoteAmount: quoteAmount || existingNewQueryLead.quoteAmount,
          stage: stage || existingNewQueryLead.stage,
          source: source || existingNewQueryLead.source,
          lastActivityAt: new Date()
        }
      };
      if (historyEntry.length) updateOp.$push = { queryHistory: { $each: historyEntry } };
      lead = await Lead.findByIdAndUpdate(existingNewQueryLead._id, updateOp, { new: true });
    } else {
      // Either no lead at all, OR existing lead has progressed past new_query (quote_sent, modify, etc.)
      // → This is a fresh enquiry: create a new lead
      // Generate quote serial for new lead
      const prefix = (destination || 'LEAD').trim().slice(0, 4).toUpperCase().replace(/[^A-Z]/g, 'X');
      const count = await Lead.countDocuments();
      const quoteSerial = `${prefix}_${String(count + 1).padStart(3, '0')}`;
      lead = await Lead.create({
        quoteSerial,
        agentPhone,
        agentName: agentName || '',
        agentCompany: agentCompany || '',
        destination: destination || '',
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        nights: nights || 0,
        adults: adults || 0,
        kids: kids || 0,
        rooms: rooms || 0,
        mealPlan: mealPlan || '',
        quoteAmount: quoteAmount || 0,
        stage: stage || 'new_query',
        source: source || 'whatsapp_bot',
        lastActivityAt: new Date(),
        queryHistory: historyEntry
      });
    }

    res.json({ success: true, leadId: lead._id });
  } catch (err) {
    console.error('Lead webhook error:', err);
    res.status(500).json({ error: 'Failed to process lead webhook' });
  }
});

// ─── Webhook: Booking from bot ────────────────────────────────────────────────
app.post('/api/webhook/booking', async (req, res) => {
  try {
    const secret = req.headers['x-dashboard-secret'];
    if (secret !== DASHBOARD_SECRET) {
      return res.status(403).json({ error: 'Invalid webhook secret' });
    }
    if (!dbConnected) return res.status(503).json({ error: 'Database unavailable' });

    const body = req.body;

    // Auto-generate bookingSerial if not provided
    if (!body.bookingSerial) {
      const dest = (body.destination || 'BOOK').trim().slice(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
      const count = await Booking.countDocuments();
      body.bookingSerial = `${dest}_${String(count + 1).padStart(3, '0')}`;
    }

    // Auto-calculate pending
    body.pending = (body.totalCost || 0) - (body.received || 0);

    const booking = await Booking.create(body);

    // Mark related lead as confirmed if quoteSerial provided
    if (body.quoteSerial) {
      Lead.findOneAndUpdate(
        { quoteSerial: body.quoteSerial },
        { stage: 'booking_confirmed', lastActivityAt: new Date() }
      ).catch(err => console.error('Lead confirm error:', err));
    }

    res.json({ success: true, bookingId: booking._id, bookingSerial: booking.bookingSerial });
  } catch (err) {
    console.error('Booking webhook error:', err);
    res.status(500).json({ error: 'Failed to create booking' });
  }
});

// ─── Stats Route ──────────────────────────────────────────────────────────────
app.get('/api/stats', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!dbConnected) {
    return res.status(503).json({ error: 'Database unavailable' });
  }

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      totalConversations,
      todayConversations,
      botHandling,
      teamHandling,
      resolved,
      newLeadsThisWeek,
      totalLeads
    ] = await Promise.all([
      Conversation.countDocuments(),
      Conversation.countDocuments({ lastMessageTime: { $gte: today } }),
      Conversation.countDocuments({ status: 'bot' }),
      Conversation.countDocuments({ status: 'human' }),
      Conversation.countDocuments({ status: 'resolved' }),
      Lead.countDocuments({ createdAt: { $gte: weekAgo } }),
      Lead.countDocuments()
    ]);

    // Lead status breakdown
    const leadStatusCounts = await Lead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({
      success: true,
      data: {
        totalConversations,
        todayConversations,
        botHandling,
        teamHandling,
        resolved,
        newLeadsThisWeek,
        totalLeads,
        leadStatusCounts
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/auth', require('./routes/auth'));
app.use('/api/conversations', checkDB, require('./routes/conversations'));
app.use('/api/leads', checkDB, require('./routes/leads'));
app.use('/api', checkDB, require('./routes/campaigns'));
app.use('/api', checkDB, require('./routes/pricing'));
app.use('/api', checkDB, require('./routes/drafts'));
app.use('/api', checkDB, require('./routes/bookings'));
app.use('/api/vendors', checkDB, require('./routes/vendors'));
app.use('/api/reports', checkDB, require('./routes/reports'));

// ─── Public Cost Form Routes ──────────────────────────────────────────────────
// GET /cost-form/:id/:token — serve the mobile HTML form
app.get('/cost-form/:id/:token', async (req, res) => {
  try {
    if (!dbConnected) {
      return res.status(503).send('<h2>Database unavailable. Please try again later.</h2>');
    }
    const { id, token } = req.params;
    const booking = await Booking.findById(id).lean();
    if (!booking || booking.costFormToken !== token || !booking.costFormTokenExpiry || new Date() > new Date(booking.costFormTokenExpiry)) {
      return res.status(400).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Invalid Link</title><style>body{font-family:sans-serif;text-align:center;padding:60px 20px;background:#f5f5f5;}h2{color:#dc2626;}p{color:#6b7280;}</style></head><body><h2>❌ Invalid or Expired Link</h2><p>This cost form link is invalid or has expired. Please request a new link.</p></body></html>`);
    }

    const dest = booking.destination === 'Other' ? (booking.destinationOther || 'Other') : (booking.destination || '');
    const guestName = booking.agentName || booking.customerName || 'Guest';
    const checkIn = booking.hotels && booking.hotels[0] && booking.hotels[0].checkIn
      ? new Date(booking.hotels[0].checkIn).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '-';
    const checkOut = booking.hotels && booking.hotels[0] && booking.hotels[0].checkOut
      ? new Date(booking.hotels[0].checkOut).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '-';
    const todayStr = new Date().toISOString().split('T')[0];

    // Build existing costs rows if any
    const existingCosts = (booking.actualCosts || []);
    const existingRowsJS = JSON.stringify(existingCosts);

    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0">
<title>Bee2Bees — Cost Entry</title>
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0f4f8;color:#1a1a2e;}
.header{background:#1a1a2e;color:#fff;padding:16px 20px;text-align:center;}
.header h1{font-size:20px;font-weight:700;}
.header p{font-size:12px;opacity:0.7;margin-top:2px;}
.booking-summary{background:#fff;margin:16px;border-radius:10px;padding:16px;box-shadow:0 2px 8px rgba(0,0,0,0.08);}
.booking-summary h3{font-size:14px;font-weight:700;color:#1a1a2e;margin-bottom:10px;border-bottom:1px solid #e5e7eb;padding-bottom:8px;}
.summary-row{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;}
.summary-row .label{color:#6b7280;}
.summary-row .val{font-weight:600;color:#1a1a2e;}
.revenue-chip{background:#d1fae5;color:#065f46;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:700;display:inline-block;margin-top:8px;}
.form-wrap{margin:0 16px 16px;}
.form-wrap h3{font-size:15px;font-weight:700;margin-bottom:12px;color:#1a1a2e;}
.cost-row{background:#fff;border-radius:10px;padding:14px;margin-bottom:12px;box-shadow:0 2px 6px rgba(0,0,0,0.06);position:relative;}
.cost-row-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
.cost-row-num{font-size:12px;font-weight:700;color:#6b7280;}
.remove-btn{background:#fee2e2;color:#dc2626;border:none;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;}
.field{margin-bottom:10px;}
.field label{display:block;font-size:11px;font-weight:600;color:#374151;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em;}
.field input,.field select{width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:14px;background:#fff;-webkit-appearance:none;}
.field input:focus,.field select:focus{outline:none;border-color:#1a1a2e;}
.field-row{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.add-btn{width:100%;padding:12px;background:#e0f2fe;color:#0369a1;border:2px dashed #7dd3fc;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;margin-bottom:16px;}
.submit-btn{width:100%;padding:16px;background:#1a1a2e;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;margin-bottom:20px;}
.submit-btn:disabled{opacity:0.6;cursor:not-allowed;}
.profit-bar{background:#fff;border-radius:10px;padding:14px;margin-bottom:16px;box-shadow:0 2px 6px rgba(0,0,0,0.06);}
.profit-bar h4{font-size:13px;font-weight:700;margin-bottom:8px;color:#374151;}
.profit-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}
.profit-item{text-align:center;}
.profit-item .pval{font-size:15px;font-weight:700;}
.profit-item .plbl{font-size:10px;color:#6b7280;margin-top:2px;}
.success-msg{background:#d1fae5;border-radius:10px;padding:20px;text-align:center;color:#065f46;font-weight:600;font-size:16px;display:none;margin-bottom:20px;}
.error-msg{background:#fee2e2;border-radius:10px;padding:12px;text-align:center;color:#dc2626;font-size:13px;display:none;margin-bottom:12px;}
</style>
</head>
<body>
<div class="header">
  <h1>🐝 Bee2Bees DMC</h1>
  <p>Actual Cost Entry Form</p>
</div>

<div class="booking-summary">
  <h3>📋 Booking Details</h3>
  <div class="summary-row"><span class="label">Serial</span><span class="val">${booking.bookingSerial || '-'}</span></div>
  <div class="summary-row"><span class="label">Guest / Agent</span><span class="val">${guestName}</span></div>
  <div class="summary-row"><span class="label">Destination</span><span class="val">${dest}</span></div>
  <div class="summary-row"><span class="label">Check-in → Check-out</span><span class="val">${checkIn} → ${checkOut}</span></div>
  <div class="revenue-chip">💰 Revenue: ₹${(booking.totalCost || 0).toLocaleString('en-IN')}</div>
</div>

<div class="form-wrap">
  <h3>💰 Actual Cost Entry</h3>

  <div id="costRows"></div>

  <div class="profit-bar">
    <h4>📊 Profit Summary</h4>
    <div class="profit-grid">
      <div class="profit-item"><div class="pval" id="sumRevenue">₹${(booking.totalCost || 0).toLocaleString('en-IN')}</div><div class="plbl">Revenue</div></div>
      <div class="profit-item"><div class="pval" id="sumCost">₹0</div><div class="plbl">Actual Cost</div></div>
      <div class="profit-item"><div class="pval" id="sumProfit">₹0</div><div class="plbl">Profit</div></div>
    </div>
  </div>

  <button class="add-btn" onclick="addRow()">+ Add Another Entry</button>

  <div class="success-msg" id="successMsg">✅ Costs saved successfully! Thank you.</div>
  <div class="error-msg" id="errorMsg"></div>

  <button class="submit-btn" id="submitBtn" onclick="submitForm()">✅ Submit Costs</button>
</div>

<script>
const REVENUE = ${booking.totalCost || 0};
let rowCount = 0;

function addRow(data) {
  const i = rowCount++;
  const today = '${todayStr}';
  const row = document.createElement('div');
  row.className = 'cost-row';
  row.id = 'row_' + i;
  row.innerHTML = \`<div class="cost-row-header">
    <span class="cost-row-num">Entry #\${i+1}</span>
    <button class="remove-btn" onclick="removeRow(\${i})">✕ Remove</button>
  </div>
  <div class="field"><label>Vendor Name</label><input type="text" id="vn_\${i}" placeholder="e.g. Hotel Sunflower" value="\${data&&data.vendorName?data.vendorName:''}"></div>
  <div class="field-row">
    <div class="field"><label>Category</label><select id="vc_\${i}">
      <option value="hotel" \${data&&data.category==='hotel'?'selected':''}>Hotel</option>
      <option value="transport" \${data&&data.category==='transport'?'selected':''}>Transport</option>
      <option value="activity" \${data&&data.category==='activity'?'selected':''}>Activity</option>
      <option value="food" \${data&&data.category==='food'?'selected':''}>Food</option>
      <option value="misc" \${data&&data.category==='misc'?'selected':''}>Misc</option>
    </select></div>
    <div class="field"><label>Amount (₹)</label><input type="number" id="va_\${i}" placeholder="0" value="\${data&&data.amount?data.amount:''}" oninput="updateSummary()"></div>
  </div>
  <div class="field"><label>Description</label><input type="text" id="vd_\${i}" placeholder="e.g. 3N standard room" value="\${data&&data.description?data.description:''}"></div>
  <div class="field-row">
    <div class="field"><label>Payment Method</label><select id="vm_\${i}">
      <option value="UPI" \${data&&data.paymentMethod==='UPI'?'selected':''}>UPI</option>
      <option value="Cash" \${data&&data.paymentMethod==='Cash'?'selected':''}>Cash</option>
      <option value="Bank Transfer" \${data&&data.paymentMethod==='Bank Transfer'?'selected':''}>Bank Transfer</option>
      <option value="Credit Card" \${data&&data.paymentMethod==='Credit Card'?'selected':''}>Credit Card</option>
    </select></div>
    <div class="field"><label>Paid By</label><select id="vb_\${i}">
      <option value="Tara" \${data&&data.paidBy==='Tara'?'selected':''}>Tara</option>
      <option value="Sachin" \${data&&data.paidBy==='Sachin'?'selected':''}>Sachin</option>
      <option value="Jyoti" \${data&&data.paidBy==='Jyoti'?'selected':''}>Jyoti</option>
      <option value="Suman" \${data&&data.paidBy==='Suman'?'selected':''}>Suman</option>
      <option value="Gineeta" \${data&&data.paidBy==='Gineeta'?'selected':''}>Gineeta</option>
      <option value="Bee2Bees Account" \${data&&data.paidBy==='Bee2Bees Account'?'selected':''}>Bee2Bees Account</option>
    </select></div>
  </div>
  <div class="field"><label>Date Paid</label><input type="date" id="vp_\${i}" value="\${data&&data.paidOn?new Date(data.paidOn).toISOString().split('T')[0]:today}"></div>\`;
  document.getElementById('costRows').appendChild(row);
  updateSummary();
}

function removeRow(i) {
  const el = document.getElementById('row_' + i);
  if (el) el.remove();
  updateSummary();
}

function updateSummary() {
  let total = 0;
  document.querySelectorAll('[id^="va_"]').forEach(el => {
    total += parseFloat(el.value) || 0;
  });
  const profit = REVENUE - total;
  document.getElementById('sumCost').textContent = '₹' + total.toLocaleString('en-IN');
  document.getElementById('sumProfit').textContent = '₹' + profit.toLocaleString('en-IN');
  document.getElementById('sumProfit').style.color = profit >= 0 ? '#065f46' : '#dc2626';
}

async function submitForm() {
  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Saving...';
  document.getElementById('errorMsg').style.display = 'none';

  const costs = [];
  document.querySelectorAll('.cost-row').forEach(row => {
    const i = row.id.replace('row_', '');
    const amount = parseFloat(document.getElementById('va_' + i)?.value) || 0;
    if (amount > 0 || document.getElementById('vn_' + i)?.value) {
      costs.push({
        vendorName: document.getElementById('vn_' + i)?.value || '',
        category: document.getElementById('vc_' + i)?.value || 'misc',
        description: document.getElementById('vd_' + i)?.value || '',
        amount,
        paymentMethod: document.getElementById('vm_' + i)?.value || 'UPI',
        paidBy: document.getElementById('vb_' + i)?.value || '',
        paidOn: document.getElementById('vp_' + i)?.value || null
      });
    }
  });

  try {
    const res = await fetch(window.location.href, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ costs })
    });
    const data = await res.json();
    if (data.success) {
      document.getElementById('successMsg').style.display = 'block';
      btn.style.display = 'none';
      document.querySelector('.add-btn').style.display = 'none';
    } else {
      throw new Error(data.error || 'Failed to save');
    }
  } catch(e) {
    document.getElementById('errorMsg').textContent = '❌ Error: ' + e.message;
    document.getElementById('errorMsg').style.display = 'block';
    btn.disabled = false;
    btn.textContent = '✅ Submit Costs';
  }
}

// Init with existing costs or 1 blank row
const existing = ${existingRowsJS};
if (existing && existing.length) {
  existing.forEach(c => addRow(c));
} else {
  addRow();
}
</script>
</body>
</html>`);
  } catch (err) {
    console.error('Cost form GET error:', err);
    res.status(500).send('<h2>Server error. Please try again later.</h2>');
  }
});

// POST /cost-form/:id/:token — save costs
app.post('/cost-form/:id/:token', express.json(), async (req, res) => {
  try {
    if (!dbConnected) return res.status(503).json({ error: 'Database unavailable' });
    const { id, token } = req.params;
    const booking = await Booking.findById(id);
    if (!booking || booking.costFormToken !== token || !booking.costFormTokenExpiry || new Date() > new Date(booking.costFormTokenExpiry)) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }
    const costs = (req.body.costs || []).map(c => ({
      vendorName: c.vendorName || '',
      category: c.category || 'misc',
      description: c.description || '',
      amount: parseFloat(c.amount) || 0,
      paymentMethod: c.paymentMethod || 'UPI',
      paidBy: c.paidBy || '',
      paidOn: c.paidOn || null
    }));
    booking.actualCosts = costs;
    const totalActual = costs.reduce((s, c) => s + c.amount, 0);
    const revenue = booking.totalCost || 0;
    booking.profit = revenue - totalActual;
    booking.margin = revenue > 0 ? Math.round((booking.profit / revenue) * 1000) / 10 : 0;
    booking.costFormFilledAt = new Date();
    await booking.save();
    res.json({ success: true, message: 'Costs saved successfully' });
  } catch (err) {
    console.error('Cost form POST error:', err);
    res.status(500).json({ error: 'Failed to save costs' });
  }
});

// ─── Catch-all: serve index.html ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Background: Auto-move stale leads ───────────────────────────────────────
// Every hour:
//   quote_sent / changes_requested → follow_up  after 24h silence
//   follow_up                      → lost        after 7 days silence
function startLeadAutoMover() {
  const run = async () => {
    if (!dbConnected) return;
    try {
      const now = new Date();
      const h24 = new Date(now - 24 * 60 * 60 * 1000);
      const d7  = new Date(now - 7  * 24 * 60 * 60 * 1000);

      const toFollowUp = await Lead.updateMany(
        { stage: { $in: ['quote_sent', 'changes_requested'] }, lastActivityAt: { $lt: h24 } },
        { stage: 'follow_up', lastActivityAt: now }
      );

      const toLost = await Lead.updateMany(
        { stage: 'follow_up', lastActivityAt: { $lt: d7 } },
        { stage: 'lost', lastActivityAt: now }
      );

      if (toFollowUp.modifiedCount || toLost.modifiedCount) {
        console.log(`[AUTO-MOVER] follow_up: ${toFollowUp.modifiedCount}, lost: ${toLost.modifiedCount}`);
      }
    } catch (e) {
      console.error('[AUTO-MOVER] error:', e.message);
    }
  };

  run(); // run once on startup
  setInterval(run, 60 * 60 * 1000); // then every hour
}

// ─── Start ────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
    startLeadAutoMover();
    console.log(`\n🚀 Bee2Bees Dashboard running on http://localhost:${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}`);
    console.log(`🔗 Webhook: POST http://localhost:${PORT}/api/webhook/message`);
    console.log(`   Header: X-Dashboard-Secret: ${DASHBOARD_SECRET}\n`);
  });
}).catch(err => {
  console.error('Startup error:', err);
  // Still start server even if DB fails initially
  app.listen(PORT, () => {
    console.log(`🚀 Server started on port ${PORT} (DB connection pending...)`);
  });
});
