const express = require('express');
const router = express.Router();
const { google } = require('googleapis');

const Hotel = require('../models/Hotel');
const SharedActivity = require('../models/SharedActivity');
const PrivateActivity = require('../models/PrivateActivity');
const Transfer = require('../models/Transfer');

const SHEET_ID = process.env.GOOGLE_SHEETS_PRICING_ID || '1GT6TGIV3ZGRMPMULYYBnfV5b6tIVGSkV85PB8gNJajw';

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.status(401).json({ error: 'Not authenticated' });
}

// ─── Google Sheets Auth ───────────────────────────────────────────────────────
function getSheetsClient() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: privateKey
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });
  return google.sheets({ version: 'v4', auth });
}

// ─── Helper: parse number ─────────────────────────────────────────────────────
function toNum(val) {
  if (val === undefined || val === null || val === '') return 0;
  const n = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ─── Sync: Hotels ─────────────────────────────────────────────────────────────
async function syncHotels(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Hotels!A:H'
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return 0;

  const now = new Date();
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const hotelName = (row[0] || '').trim();
    if (!hotelName) continue;

    await Hotel.findOneAndUpdate(
      { hotelName, starRating: (row[1] || '').trim(), category: (row[2] || '').trim() },
      {
        hotelName,
        starRating: (row[1] || '').trim(),
        category: (row[2] || '').trim(),
        cpRate: toNum(row[3]),
        mapRate: toNum(row[4]),
        apRate: toNum(row[5]),
        photosUrl: (row[6] || '').trim(),
        isActive: true,
        lastSyncedAt: now
      },
      { upsert: true, new: true }
    );
    count++;
  }

  return count;
}

// ─── Sync: Shared Activities ──────────────────────────────────────────────────
async function syncSharedActivities(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Shared Activities!A:E'
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return 0;

  const now = new Date();
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const activityName = (row[1] || '').trim();
    if (!activityName) continue;

    await SharedActivity.findOneAndUpdate(
      { activityName },
      {
        activityId: toNum(row[0]),
        activityName,
        adultPrice: toNum(row[2]),
        childPrice: toNum(row[3]),
        description: (row[4] || '').trim(),
        isActive: true,
        lastSyncedAt: now
      },
      { upsert: true, new: true }
    );
    count++;
  }

  return count;
}

// ─── Sync: Private Activities ─────────────────────────────────────────────────
async function syncPrivateActivities(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Private Activities!A:F'
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return 0;

  const now = new Date();
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const activityName = (row[0] || '').trim();
    if (!activityName) continue;

    await PrivateActivity.findOneAndUpdate(
      { activityName, vehicleType: (row[1] || '').trim() },
      {
        activityName,
        unitType: (row[2] || '').trim(),
        adultPrice: toNum(row[3]),
        childPrice: toNum(row[4]),
        vehicleType: (row[1] || '').trim(),
        description: (row[5] || '').trim(),
        isActive: true,
        lastSyncedAt: now
      },
      { upsert: true, new: true }
    );
    count++;
  }

  return count;
}

// ─── Sync: Transfers ──────────────────────────────────────────────────────────
async function syncTransfers(sheets) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: 'Transfers!A:D'
  });

  const rows = res.data.values || [];
  if (rows.length < 2) return 0;

  const now = new Date();
  let count = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const transferName = (row[0] || '').trim();
    if (!transferName) continue;

    await Transfer.findOneAndUpdate(
      { transferName, vehicleType: (row[1] || '').trim() },
      {
        transferName,
        vehicleType: (row[1] || '').trim(),
        price: toNum(row[2]),
        description: (row[3] || '').trim(),
        isActive: true,
        lastSyncedAt: now
      },
      { upsert: true, new: true }
    );
    count++;
  }

  return count;
}

// ─── GET /api/hotels ──────────────────────────────────────────────────────────
router.get('/hotels', requireAuth, async (req, res) => {
  try {
    const { search, star, category } = req.query;
    const filter = { isActive: true };

    if (star) filter.starRating = star;
    if (category) filter.category = category;
    if (search) filter.hotelName = { $regex: search, $options: 'i' };

    const hotels = await Hotel.find(filter).sort({ starRating: 1, category: 1, hotelName: 1 });
    res.json({ success: true, count: hotels.length, data: hotels });
  } catch (err) {
    console.error('Hotels fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch hotels' });
  }
});

// ─── GET /api/activities/shared ───────────────────────────────────────────────
router.get('/activities/shared', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    const filter = { isActive: true };
    if (search) filter.activityName = { $regex: search, $options: 'i' };

    const activities = await SharedActivity.find(filter).sort({ activityId: 1, activityName: 1 });
    res.json({ success: true, count: activities.length, data: activities });
  } catch (err) {
    console.error('Shared activities fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch shared activities' });
  }
});

// ─── GET /api/activities/private ─────────────────────────────────────────────
router.get('/activities/private', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    const filter = { isActive: true };
    if (search) filter.activityName = { $regex: search, $options: 'i' };

    const activities = await PrivateActivity.find(filter).sort({ activityName: 1 });
    res.json({ success: true, count: activities.length, data: activities });
  } catch (err) {
    console.error('Private activities fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch private activities' });
  }
});

// ─── GET /api/transfers ───────────────────────────────────────────────────────
router.get('/transfers', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    const filter = { isActive: true };
    if (search) filter.transferName = { $regex: search, $options: 'i' };

    const transfers = await Transfer.find(filter).sort({ transferName: 1 });
    res.json({ success: true, count: transfers.length, data: transfers });
  } catch (err) {
    console.error('Transfers fetch error:', err);
    res.status(500).json({ error: 'Failed to fetch transfers' });
  }
});

// ─── POST /api/sync/sheets ────────────────────────────────────────────────────
router.post('/sync/sheets', requireAuth, async (req, res) => {
  try {
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      return res.status(400).json({ error: 'Google service account credentials not configured' });
    }

    const sheets = getSheetsClient();

    const [hotelsCount, sharedCount, privateCount, transfersCount] = await Promise.all([
      syncHotels(sheets),
      syncSharedActivities(sheets),
      syncPrivateActivities(sheets),
      syncTransfers(sheets)
    ]);

    res.json({
      success: true,
      synced: {
        hotels: hotelsCount,
        sharedActivities: sharedCount,
        privateActivities: privateCount,
        transfers: transfersCount
      },
      syncedAt: new Date()
    });
  } catch (err) {
    console.error('Sync error:', err);
    res.status(500).json({ error: 'Sync failed: ' + err.message });
  }
});

// ─── GET /api/sync/status ─────────────────────────────────────────────────────
router.get('/sync/status', requireAuth, async (req, res) => {
  try {
    const [
      hotelCount, sharedCount, privateCount, transferCount,
      lastHotel, lastShared, lastPrivate, lastTransfer
    ] = await Promise.all([
      Hotel.countDocuments({ isActive: true }),
      SharedActivity.countDocuments({ isActive: true }),
      PrivateActivity.countDocuments({ isActive: true }),
      Transfer.countDocuments({ isActive: true }),
      Hotel.findOne({ isActive: true }).sort({ lastSyncedAt: -1 }).select('lastSyncedAt'),
      SharedActivity.findOne({ isActive: true }).sort({ lastSyncedAt: -1 }).select('lastSyncedAt'),
      PrivateActivity.findOne({ isActive: true }).sort({ lastSyncedAt: -1 }).select('lastSyncedAt'),
      Transfer.findOne({ isActive: true }).sort({ lastSyncedAt: -1 }).select('lastSyncedAt')
    ]);

    const lastSynced = [
      lastHotel?.lastSyncedAt,
      lastShared?.lastSyncedAt,
      lastPrivate?.lastSyncedAt,
      lastTransfer?.lastSyncedAt
    ].filter(Boolean).sort().pop() || null;

    res.json({
      success: true,
      counts: {
        hotels: hotelCount,
        sharedActivities: sharedCount,
        privateActivities: privateCount,
        transfers: transferCount
      },
      lastSyncedAt: lastSynced
    });
  } catch (err) {
    console.error('Sync status error:', err);
    res.status(500).json({ error: 'Failed to get sync status' });
  }
});

module.exports = router;
