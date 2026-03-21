import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as platformSettingsService from '../services/platform-settings.service';
import { V } from '../utils/validation-messages';

const updateSchema = z.object({
  settings: z.array(z.object({
    key: z.string().min(1, V.requiredFem('Chave')).max(100, V.max('Chave', 100)),
    value: z.string({ message: V.valueRequired }),
  })).max(50, 'Máximo de 50 configurações'),
});

export const list: RequestHandler = async (_req, res, next) => {
  try {
    const settings = await platformSettingsService.getAllSettings();
    res.json(settings);
  } catch (err) {
    next(err);
  }
};

export const update: RequestHandler = async (req, res, next) => {
  try {
    const { settings } = updateSchema.parse(req.body);
    const result = await platformSettingsService.upsertSettings(settings, req.userId!);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
