const { CognitoJwtVerifier } = require('aws-jwt-verify');

let verifier;

function getVerifier() {
  if (!verifier) {
    verifier = CognitoJwtVerifier.create({
      userPoolId: process.env.COGNITO_USER_POOL_ID,
      tokenUse: 'access',
      clientId: process.env.COGNITO_CLIENT_ID,
    });
  }
  return verifier;
}

/**
 * Express middleware that validates Cognito JWT tokens.
 * Expects: Authorization: Bearer <token>
 * Sets req.user with the decoded token claims (sub, email, etc.)
 */
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7);

  try {
    const payload = await getVerifier().verify(token);
    req.user = {
      sub: payload.sub,
      username: payload.username,
      email: payload.email,
    };
    next();
  } catch (err) {
    console.error('JWT verification failed:', err.message);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

module.exports = authMiddleware;
