import type { RequestHandler } from 'express';
import * as dashboardService from '../services/dashboard.service';

const manager: RequestHandler = async (req, res, next) => {
  try {
    const data = await dashboardService.getManagerDashboard();
    res.json(data);
  } catch (err) {
    next(err);
  }
};

const consultant: RequestHandler = async (req, res, next) => {
  try {
    const data = await dashboardService.getConsultantDashboard(req.userId!);
    res.json(data);
  } catch (err) {
    next(err);
  }
};

export const dashboardController = { manager, consultant };
