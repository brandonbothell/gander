import { RequestWithUser } from "../camera";
import express from "express";
import config from '../../config.json'
import jwt from 'jsonwebtoken';

// --- JWT Middleware ---
export async function jwtAuth(req: RequestWithUser, res: express.Response, next: express.NextFunction) {
  const JWT_SECRET = process.env.JWT_SECRET || config.jwtSecret;

  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { username: string };
    req.user = payload;

    // --- Trusted IPs check removed ---

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}
