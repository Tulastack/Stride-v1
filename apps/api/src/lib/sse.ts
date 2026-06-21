import type { Response } from 'express';
import type { SSEEvent } from '../types.js';

class SSEManager {
  // Map of userId -> array of active response objects
  private connections = new Map<string, Response[]>();

  /**
   * Register a new client SSE connection
   */
  public addConnection(userId: string, res: Response): void {
    const userConnections = this.connections.get(userId) ?? [];
    userConnections.push(res);
    this.connections.set(userId, userConnections);

    // Keep-alive heartbeat every 15 seconds to prevent connection timeout
    const heartbeatInterval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 15000);

    res.on('close', () => {
      clearInterval(heartbeatInterval);
      this.removeConnection(userId, res);
    });
  }

  /**
   * Remove a client SSE connection
   */
  private removeConnection(userId: string, res: Response): void {
    const userConnections = this.connections.get(userId);
    if (!userConnections) return;

    const index = userConnections.indexOf(res);
    if (index !== -1) {
      userConnections.splice(index, 1);
    }

    if (userConnections.length === 0) {
      this.connections.delete(userId);
    } else {
      this.connections.set(userId, userConnections);
    }
  }

  /**
   * Broadcast an event to all active connections for a given user
   */
  public sendEvent(userId: string, event: SSEEvent): boolean {
    const userConnections = this.connections.get(userId);
    if (!userConnections || userConnections.length === 0) {
      return false;
    }

    const payload = `event: message\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of userConnections) {
      try {
        res.write(payload);
      } catch (err) {
        console.error(`Failed to send SSE to user ${userId}:`, err);
      }
    }
    return true;
  }

  /**
   * Broadcast a stage progress event to all active connections for a given user.
   * Emits: event: progress\ndata: {"analysisId":"...","stage":"...","pct":0-100,"message":"..."}\n\n
   */
  public broadcastProgress(userId: string, analysisId: string, stage: string, pct: number, message?: string): void {
    const userConnections = this.connections.get(userId);
    if (!userConnections || userConnections.length === 0) {
      return;
    }

    const data: Record<string, unknown> = { analysisId, stage, pct };
    if (message !== undefined && message !== '') {
      data.message = message;
    }

    const payload = `event: progress\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of userConnections) {
      if (!res.writableEnded) {
        try {
          res.write(payload);
        } catch (err) {
          console.error(`Failed to send progress SSE to user ${userId}:`, err);
        }
      }
    }
  }
}

export const sseManager = new SSEManager();

/**
 * Convenience export: broadcast stage progress for an analysis to all connections of userId.
 */
export function broadcastProgress(userId: string, analysisId: string, stage: string, pct: number, message?: string): void {
  sseManager.broadcastProgress(userId, analysisId, stage, pct, message);
}
