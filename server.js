require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
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

    const lead = await Lead.findOneAndUpdate(
      { agentPhone, stage: { $nin: ['completed', 'lost'] } },
      {
        $set: {
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
          lastActivityAt: new Date()
        },
        $push: historyEntry.length ? { queryHistory: { $each: historyEntry } } : {}
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.json({ success: true, leadId: lead._id });
  } catch (err) {
    console.error('Lead webhook error:', err);
    res.status(500).json({ error: 'Failed to process lead webhook' });
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

// ─── Catch-all: serve index.html ──────────────────────────────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global Error Handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Start ────────────────────────────────────────────────────────────────────
connectDB().then(() => {
  app.listen(PORT, () => {
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
