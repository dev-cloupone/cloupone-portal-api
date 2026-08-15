import type { Response } from 'express';

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

  send(userId: string, data: object): void {
    const connections = this.connections.get(userId);
    if (!connections) return;
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    connections.forEach(res => res.write(payload));
  }

  heartbeat(): void {
    for (const connections of this.connections.values()) {
      connections.forEach(res => res.write(': heartbeat\n\n'));
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

// Heartbeat every 30s
setInterval(() => sseManager.heartbeat(), 30_000);
