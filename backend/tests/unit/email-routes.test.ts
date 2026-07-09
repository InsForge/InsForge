import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { mockSendRaw, mockVerifyUser } = vi.hoisted(() => ({
  mockSendRaw: vi.fn(),
  mockVerifyUser: vi.fn((req, _res, next) => {
    req.user = { id: 'user-id', role: 'authenticated' };
    next();
  }),
}));

vi.mock('../../src/services/email/email.service', () => ({
  EmailService: {
    getInstance: () => ({
      sendRaw: mockSendRaw,
    }),
  },
}));

vi.mock('../../src/api/middlewares/auth.js', () => ({
  verifyUser: mockVerifyUser,
}));

import { emailRouter } from '../../src/api/routes/email/index.routes';

let app: express.Express;

describe('Email Routes Unit Tests', () => {
  beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api/email', emailRouter);
    app.use(
      (
        err: { statusCode?: number; message?: string },
        _req: express.Request,
        res: express.Response,
        next: express.NextFunction
      ) => {
        void next;
        res.status(err.statusCode || 500).json({ error: err.message });
      }
    );
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST /api/email/send-raw successfully sends email and returns suppressed status', async () => {
    mockSendRaw.mockResolvedValue({ suppressed: false });

    const response = await request(app)
      .post('/api/email/send-raw')
      .send({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      })
      .expect(200);

    expect(response.body).toEqual({ suppressed: false });
    expect(mockSendRaw).toHaveBeenCalledWith({
      to: 'recipient@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
    });
  });

  it('POST /api/email/send-raw rejects requests from anon role', async () => {
    mockVerifyUser.mockImplementationOnce((req, _res, next) => {
      req.user = { id: 'anon-id', role: 'anon' };
      next();
    });

    const response = await request(app)
      .post('/api/email/send-raw')
      .send({
        to: 'recipient@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      })
      .expect(401);

    expect(response.body.error).toContain('Sending emails requires an authenticated user');
  });

  it('POST /api/email/send-raw validation failure', async () => {
    const response = await request(app)
      .post('/api/email/send-raw')
      .send({
        to: 'invalid-email',
        subject: '',
      })
      .expect(400);

    expect(response.body.error).toBeDefined();
  });
});
