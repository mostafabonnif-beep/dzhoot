import type { Request, Response } from 'express';

jest.mock('../models/Session', () => ({
  findOne: jest.fn(),
  deleteOne: jest.fn(),
}));

const mockUserFindOne = jest.fn();
jest.mock('../models/User', () => ({
  findOne: (...args: unknown[]) => mockUserFindOne(...args),
}));

import { requireTvOrSessionAuth } from '../middleware/requireTvOrSessionAuth';

function mockResponse() {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
}

/** Mongoose-style query: .select() resolves to the given document. */
function queryResolving(doc: unknown) {
  return { select: jest.fn().mockResolvedValue(doc) };
}

describe('requireTvOrSessionAuth demo credential', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDemo = process.env.DEMO_TV_CODE;

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalDemo === undefined) delete process.env.DEMO_TV_CODE;
    else process.env.DEMO_TV_CODE = originalDemo;
    jest.clearAllMocks();
  });

  it('does not accept the historical DEMO fallback in production', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_TV_CODE;
    mockUserFindOne.mockReturnValue(queryResolving(null));

    const req = { headers: { 'x-tv-code': 'DEMO' } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn();

    await requireTvOrSessionAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('does not accept the historical DEMO fallback outside production either', async () => {
    delete process.env.NODE_ENV;
    delete process.env.DEMO_TV_CODE;
    mockUserFindOne.mockReturnValue(queryResolving(null));

    const req = { headers: { 'x-tv-code': 'DEMO' } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn();

    await requireTvOrSessionAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('accepts only the explicitly configured demo code in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_TV_CODE = 'safe-demo-code-2026-x';

    const req = { headers: { 'x-tv-code': 'SAFE-DEMO-CODE-2026-X' } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn();

    await requireTvOrSessionAuth(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect((req as any).user.demo).toBe(true);
    expect(mockUserFindOne).not.toHaveBeenCalled();
  });

  it('rejects a wrong code even when a demo code is configured', async () => {
    process.env.NODE_ENV = 'production';
    process.env.DEMO_TV_CODE = 'safe-demo-code-2026-x';
    mockUserFindOne.mockReturnValue(queryResolving(null));

    const req = { headers: { 'x-tv-code': 'DEMO' } } as unknown as Request;
    const res = mockResponse();
    const next = jest.fn();

    await requireTvOrSessionAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
