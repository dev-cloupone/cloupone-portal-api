import type { RequestHandler } from 'express';
import * as notificationService from '../services/notification.service';

const sendDailyReminders: RequestHandler = async (_req, res, next) => {
  try {
    const result = await notificationService.sendDailyReminders();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

const sendMonthlyReminders: RequestHandler = async (_req, res, next) => {
  try {
    const result = await notificationService.sendMonthlyReminders();
    res.json(result);
  } catch (err) {
    next(err);
  }
};

export const notificationController = {
  sendDailyReminders,
  sendMonthlyReminders,
};
