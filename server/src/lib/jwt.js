import jwt from 'jsonwebtoken';

export function signToken(payload, expiresIn) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: expiresIn || Number(process.env.JWT_EXPIRY) || 900,
  });
}
