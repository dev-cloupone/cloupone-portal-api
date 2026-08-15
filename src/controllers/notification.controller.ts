import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as notificationService from '../services/notification.service';
import { sseManager } from '../services/sse-manager';
import { paginationSchema } from '../utils/pagination';

const list: RequestHandler = async (req, res, next) => {
  try {
    const params = paginationSchema.parse(req.query);
    const result = await notificationService.listByUser(req.userId!, params);
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const getUnreadCount: RequestHandler = async (req, res, next) => {
  try {
    const count = await notificationService.getUnreadCount(req.userId!);
    res.json({ count });
  } catch (err) {
    next(err);
  }
};

const idSchema = z.string().uuid();

const markAsRead: RequestHandler = async (req, res, next) => {
  try {
    const id = idSchema.parse(req.params.id);
    await notificationService.markAsRead(id, req.userId!);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const markAllAsRead: RequestHandler = async (req, res, next) => {
  try {
    await notificationService.markAllAsRead(req.userId!);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const stream: RequestHandler = (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const userId = req.userId!;
  sseManager.addConnection(userId, res);

  // Send connection established event
  res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

  req.on('close', () => {
    sseManager.removeConnection(userId, res);
  });
};

export const notificationController = {
  list,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  stream,
};
