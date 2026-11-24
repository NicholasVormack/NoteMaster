/**
 * Auth routes: register and log in.
 *
 * The original login handler answered with a 500 for a wrong password and then
 * fell through to `jwt.sign`, so a request with any password came back with a
 * valid token. That is an authentication bypass, and it is fixed here by
 * returning immediately on every failure path.
 */

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const User = require('../models/user');

const router = express.Router();

const MIN_PASSWORD = 6;
const BCRYPT_ROUNDS = 10;

const signToken = (username, secret) =>
  jwt.sign({ username }, secret, { expiresIn: '7d' });

const secretOrFail = (res) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    res.status(500).json({ msg: 'Server misconfigured: JWT_SECRET is not set.' });
    return null;
  }
  return secret;
};

const validateCredentials = ({ username, password }) => {
  if (typeof username !== 'string' || username.trim().length < 3) {
    return 'Usernames must be at least 3 characters.';
  }
  if (username.trim().length > 32) {
    return 'Usernames are limited to 32 characters.';
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return `Password length must be at least ${MIN_PASSWORD} characters.`;
  }
  return null;
};

router.post('/', async (req, res) => {
  const secret = secretOrFail(res);
  if (!secret) return undefined;

  const { username, password } = req.body || {};
  const problem = validateCredentials({ username, password });
  if (problem) return res.status(400).json({ msg: problem });

  const trimmed = username.trim();

  try {
    const existing = await User.findOne({ username: trimmed });
    if (existing) {
      return res.status(409).json({ msg: `User ${trimmed} already exists. Try logging in.` });
    }

    const user = await User.create({
      username: trimmed,
      passwordHash: bcrypt.hashSync(password, BCRYPT_ROUNDS),
      numNotes: 0,
    });

    return res.status(201).json({
      token: signToken(user.username, secret),
      user: { username: user.username },
    });
  } catch (error) {
    return res.status(500).json({ msg: 'Could not create that account.' });
  }
});

router.post('/login', async (req, res) => {
  const secret = secretOrFail(res);
  if (!secret) return undefined;

  const { username, password } = req.body || {};

  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ msg: 'Username and password are required.' });
  }

  try {
    const user = await User.findOne({ username: username.trim() });

    // Same response for "no such user" and "wrong password": the previous
    // version told an attacker which usernames exist.
    if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
      return res.status(401).json({ msg: 'Invalid username or password.' });
    }

    return res.json({
      token: signToken(user.username, secret),
      user: { username: user.username },
    });
  } catch (error) {
    return res.status(500).json({ msg: 'Could not sign you in.' });
  }
});

module.exports = router;
