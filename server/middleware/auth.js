/**
 * JWT authentication middleware.
 *
 * The signing secret comes from the environment. The previous version hardcoded
 * 'secret', which means anyone who read the repository could mint a valid token
 * for any username.
 */

const jwt = require('jsonwebtoken');

const PUBLIC_ROUTES = [{ path: '/api/auth', method: 'POST' }];

const isPublic = (req) =>
  PUBLIC_ROUTES.some((route) => req.path.startsWith(route.path) && req.method === route.method);

const auth = (req, res, next) => {
  if (isPublic(req)) return next();

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    // Fail loudly. A missing secret must never degrade into "allow everyone".
    return res.status(500).json({ msg: 'Server misconfigured: JWT_SECRET is not set.' });
  }

  const raw = req.header('x-auth-token');
  if (!raw) return res.status(401).json({ msg: 'Invalid token. Access denied.' });

  // The client stores the token JSON-encoded, so accept both forms.
  let token = raw;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') token = parsed;
  } catch (error) {
    // Raw token, not JSON: use it as-is.
  }

  try {
    req.username = jwt.verify(token, secret);
    return next();
  } catch (error) {
    return res.status(401).json({ msg: 'Token is not valid.' });
  }
};

module.exports = auth;
