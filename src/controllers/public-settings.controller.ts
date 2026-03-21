import type { RequestHandler } from 'express';
import { getPublicSettings } from '../services/platform-settings.service';

const getSettings: RequestHandler = async (_req, res, next) => {
  try {
    const settings = await getPublicSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
};

export const publicSettingsController = { getSettings };
