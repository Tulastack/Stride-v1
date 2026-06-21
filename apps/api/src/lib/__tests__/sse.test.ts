import { jest } from '@jest/globals';
// Mock the pool to avoid real DB connections
jest.mock('../../db/queries.js', () => ({ pool: { query: jest.fn() } }));

import { sseManager, broadcastProgress } from '../sse.js';

describe('broadcastProgress SSE serialization', () => {
  it('serializes correctly as event: progress\\ndata: json\\n\\n', () => {
    const written: string[] = [];
    const mockRes: any = {
      write: (s: string) => written.push(s),
      writableEnded: false,
      on: jest.fn(),
    };

    // Register a fake connection
    (sseManager as any).connections.set('user-1', [mockRes]);

    broadcastProgress('user-1', 'test-analysis-id', 'pose_extraction', 30);

    expect(written).toHaveLength(1);
    const frame = written[0]!;
    expect(frame).toMatch(/^event: progress\ndata: \{.*\}\n\n$/);

    const dataLine = frame.split('\n')[1]!.replace('data: ', '');
    const parsed = JSON.parse(dataLine);
    expect(parsed).toMatchObject({
      analysisId: 'test-analysis-id',
      stage: 'pose_extraction',
      pct: 30,
    });

    // Cleanup
    (sseManager as any).connections.delete('user-1');
  });

  it('terminal event complete has pct=100', () => {
    const written: string[] = [];
    const mockRes: any = {
      write: (s: string) => written.push(s),
      writableEnded: false,
      on: jest.fn(),
    };

    (sseManager as any).connections.set('user-2', [mockRes]);

    broadcastProgress('user-2', 'test-id', 'complete', 100);

    expect(written).toHaveLength(1);
    const dataLine = written[0]!.split('\n')[1]!.replace('data: ', '');
    const parsed = JSON.parse(dataLine);
    expect(parsed.pct).toBe(100);
    expect(['complete', 'failed']).toContain(parsed.stage);

    (sseManager as any).connections.delete('user-2');
  });

  it('broadcastProgress does not emit heartbeat keepalive', () => {
    const written: string[] = [];
    const mockRes: any = {
      write: (s: string) => written.push(s),
      writableEnded: false,
      on: jest.fn(),
    };

    (sseManager as any).connections.set('user-3', [mockRes]);

    broadcastProgress('user-3', 'test-id', 'pose_extraction', 30);

    expect(written).toHaveLength(1);
    const frame = written[0]!;
    // broadcastProgress only emits 'event: progress' lines, never ':keepalive' or ':heartbeat'
    expect(frame).not.toContain('keepalive');
    expect(frame).not.toContain('heartbeat');
    // Should contain exactly 'event: progress' — no SSE comment lines (which start with ':')
    const lines = frame.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines) {
      expect(line.startsWith(':')).toBe(false);
    }

    (sseManager as any).connections.delete('user-3');
  });

  it('does not write to a writableEnded response', () => {
    const written: string[] = [];
    const mockRes: any = {
      write: (s: string) => written.push(s),
      writableEnded: true,  // already ended
      on: jest.fn(),
    };

    (sseManager as any).connections.set('user-4', [mockRes]);

    broadcastProgress('user-4', 'test-id', 'finalizing', 95);

    expect(written).toHaveLength(0);

    (sseManager as any).connections.delete('user-4');
  });

  it('includes optional message when provided', () => {
    const written: string[] = [];
    const mockRes: any = {
      write: (s: string) => written.push(s),
      writableEnded: false,
      on: jest.fn(),
    };

    (sseManager as any).connections.set('user-5', [mockRes]);

    broadcastProgress('user-5', 'test-id', 'downloading', 10, 'Fetching video...');

    expect(written).toHaveLength(1);
    const dataLine = written[0]!.split('\n')[1]!.replace('data: ', '');
    const parsed = JSON.parse(dataLine);
    expect(parsed.message).toBe('Fetching video...');

    (sseManager as any).connections.delete('user-5');
  });
});
