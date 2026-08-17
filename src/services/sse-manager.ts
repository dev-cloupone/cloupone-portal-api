import type { Response } from 'express';
import { logger } from '../utils/logger';

class SSEManager {
  private connections = new Map<string, Response[]>();

  addConnection(userId: string, res: Response): void {
    const existing = this.connections.get(userId) || [];
    existing.push(res);
    this.connections.set(userId, existing);
  }

  removeConnection(userId: string, res: Response): void {
    const existing = this.connections.get(userId);
    if (!existing) return;
    const filtered = existing.filter(r => r !== res);
    if (filtered.length === 0) {
      this.connections.delete(userId);
    } else {
      this.connections.set(userId, filtered);
    }
  }

  /** Escreve com guarda: uma conexao morta e removida em vez de propagar o erro. */
  private safeWrite(userId: string, res: Response, payload: string): void {
    try {
      if (res.writableEnded || res.destroyed) {
        this.removeConnection(userId, res);
        return;
      }
      res.write(payload);
    } catch (err) {
      logger.warn({ err, userId }, 'SSE write failed, dropping connection');
      this.removeConnection(userId, res);
    }
  }

  send(userId: string, data: object): void {
    const connections = this.connections.get(userId);
    if (!connections) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    // Copia o array: safeWrite pode mutar a lista via removeConnection.
    [...connections].forEach(res => this.safeWrite(userId, res, payload));
  }

  heartbeat(): void {
    for (const [userId, connections] of [...this.connections.entries()]) {
      [...connections].forEach(res => this.safeWrite(userId, res, ': heartbeat\n\n'));
    }
  }

  getConnectionCount(): number {
    let count = 0;
    for (const connections of this.connections.values()) {
      count += connections.length;
    }
    return count;
  }
}

export const sseManager = new SSEManager();

// Heartbeat every 30s. unref() para nao segurar o event loop no shutdown.
const heartbeatTimer = setInterval(() => sseManager.heartbeat(), 30_000);
heartbeatTimer.unref();
