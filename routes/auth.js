const express = require('express');
const passport = require('passport');
const router = express.Router();

const ALLOWED_DOMAIN = 'bee2bees.com';
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

function isAllowedEmail(email) {
  if (!email) return false;
  const lower = email.toLowerCase();
  if (ALLOWED_EMAILS.includes(lower)) return true;
  const domain = lower.split('@')[1];
  return domain && domain === ALLOWED_DOMAIN;
}

// Google OAuth login
router.get('/google', passport.authenticate('google', {
  scope: ['profile', 'email']
}));

// Google OAuth callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth_failed' }),
  (req, res) => {
    if (!isAllowedEmail(req.user.email)) {
      req.logout((err) => {
        if (err) console.error('Logout error:', err);
        res.redirect('/?error=not_authorized');
      });
      return;
    }
    res.redirect('/');
  }
);

// Logout
router.get('/logout', (req, res) => {
  req.logout((err) => {
    if (err) console.error('Logout error:', err);
    req.session.destroy(() => {
      res.redirect('/');
    });
  });
});

// Get current user
router.get('/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({
      authenticated: true,
      user: {
        name: req.user.displayName,
        email: req.user.email,
        photo: req.user.photo
      }
    });
  } else {
    res.json({ authenticated: false });
  }
});

module.exports = router;
