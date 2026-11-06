import pino from 'pino';
import { config } from './config.js';

export const logger = pino({
  level: config.env === 'test' ? 'silent' : config.logLevel,
  // never log credentials or tokens
  redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
});
