import type { RequestHandler } from 'express';
import { z } from 'zod';
import * as settingsService from '../services/project-notification-settings.service';
import { V } from '../utils/validation-messages';

const projectIdSchema = z.string().uuid();

const getSettingsSchema = z.object({
  eventType: z.string().default('ticket_created'),
});

const getSettings: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const { eventType } = getSettingsSchema.parse(req.query);
    const data = await settingsService.getSettings(projectId, eventType);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const upsertSettingsSchema = z.object({
  settings: z.array(z.object({
    userId: z.string().uuid(),
    eventType: z.string(),
    channelEmail: z.boolean(),
    channelInApp: z.boolean(),
  })),
});

const upsertSettings: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const { settings } = upsertSettingsSchema.parse(req.body);
    await settingsService.upsertSettings(projectId, settings);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

const getEmails: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const data = await settingsService.getEmails(projectId);
    res.json({ data });
  } catch (err) {
    next(err);
  }
};

const addEmailSchema = z.object({
  email: z.string().email(V.emailInvalid),
  eventType: z.string().default('ticket_created'),
});

const addEmail: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const parsed = addEmailSchema.parse(req.body);
    const created = await settingsService.addEmail(projectId, parsed.email, parsed.eventType);
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
};

const removeEmailSchema = z.object({
  id: z.string().uuid(),
});

const removeEmail: RequestHandler = async (req, res, next) => {
  try {
    const projectId = projectIdSchema.parse(req.params.projectId);
    const { id } = removeEmailSchema.parse(req.params);
    await settingsService.removeEmail(projectId, id);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
};

export const projectNotificationSettingsController = {
  getSettings,
  upsertSettings,
  getEmails,
  addEmail,
  removeEmail,
};
