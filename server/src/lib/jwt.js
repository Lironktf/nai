import jwt from 'jsonwebtoken';

export function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: Number(process.env.JWT_EXPIRY) || 900,
  });
}
