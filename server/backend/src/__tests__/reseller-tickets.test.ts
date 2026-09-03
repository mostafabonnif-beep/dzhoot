import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import Reseller from '../models/Reseller';
import SupportTicket from '../models/SupportTicket';

let currentReseller: any = null;
jest.mock('../middleware/requireReseller', () => {
  const requireReseller = (req: any, _res: any, next: any) => {
    req.reseller = currentReseller;
    next();
  };
  return { requireReseller, requireResellerOrApiKeyForReads: requireReseller };
});

const ADMIN_ID = new mongoose.Types.ObjectId();
jest.mock('../routes/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.user = { id: ADMIN_ID, role: 'Admin' };
    next();
  },
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const resellerRouter = require('../routes/reseller');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const adminTicketsRouter = require('../routes/admin-tickets');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/reseller', resellerRouter);
  app.use('/api/v1/admin/tickets', adminTicketsRouter);
  return app;
}

let resellerSeq = 0;
async function makeReseller(username: string) {
  resellerSeq += 1;
  const r = await Reseller.create({
    name: `محل ${username}`,
    city: 'الجزائر',
    status: 'Active',
    username,
    prefix: ('S' + String(resellerSeq).padStart(2, '0')),
  });
  return r.toObject();
}

describe('Support tickets (تذاكر الدعم)', () => {
  beforeEach(async () => {
    currentReseller = null;
    await SupportTicket.deleteMany({});
    await Reseller.deleteMany({});
  });

  it('reseller opens a ticket, admin replies, reseller sees the thread', async () => {
    const app = buildApp();
    const reseller = await makeReseller('tester');
    currentReseller = reseller;

    const create = await request(app).post('/api/v1/reseller/tickets').send({
      subject: 'مشكلة في التوليد',
      body: 'رصيد الشهري ناقص مع أني دفعت',
      priority: 'HIGH',
    });
    expect(create.status).toBe(201);
    const ticketId = create.body.data._id;

    const list = await request(app).get('/api/v1/reseller/tickets');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].subject).toBe('مشكلة في التوليد');

    const adminReply = await request(app)
      .post(`/api/v1/admin/tickets/${ticketId}/reply`)
      .send({ body: 'تم التحقق، الرصيد مضاف' });
    expect(adminReply.status).toBe(200);

    const thread = await request(app).get(`/api/v1/reseller/tickets/${ticketId}`);
    expect(thread.status).toBe(200);
    expect(thread.body.data.messages).toHaveLength(2);
    expect(thread.body.data.messages[1]).toMatchObject({ author: 'admin', body: 'تم التحقق، الرصيد مضاف' });
  });

  it('admin ticket list includes reseller info and status counts', async () => {
    const app = buildApp();
    const reseller = await makeReseller('tester2');
    currentReseller = reseller;
    await request(app).post('/api/v1/reseller/tickets').send({ subject: 'سؤال', body: 'كيف أجدد؟' });

    const res = await request(app).get('/api/v1/admin/tickets');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].reseller).toMatchObject({ username: 'tester2', name: 'محل tester2' });
    expect(res.body.summary.OPEN).toBe(1);
  });

  it('reseller reply reopens a closed ticket', async () => {
    const app = buildApp();
    const reseller = await makeReseller('tester3');
    currentReseller = reseller;

    const create = await request(app).post('/api/v1/reseller/tickets').send({ subject: 'مغلق', body: 'شكرًا' });
    const ticketId = create.body.data._id;
    await request(app).post(`/api/v1/admin/tickets/${ticketId}/close`);

    const reply = await request(app)
      .post(`/api/v1/reseller/tickets/${ticketId}/reply`)
      .send({ body: 'رجاءً سؤال إضافي' });
    expect(reply.status).toBe(200);
    expect(reply.body.data.status).toBe('OPEN');

    const reopen = await request(app).post(`/api/v1/admin/tickets/${ticketId}/reopen`);
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.status).toBe('OPEN');
  });

  it('reseller cannot read another reseller ticket', async () => {
    const app = buildApp();
    const r1 = await makeReseller('owner1');
    const r2 = await makeReseller('owner2');
    currentReseller = r1;
    const create = await request(app).post('/api/v1/reseller/tickets').send({ subject: 'سري', body: 'محتوى' });
    const ticketId = create.body.data._id;

    currentReseller = r2;
    const res = await request(app).get(`/api/v1/reseller/tickets/${ticketId}`);
    expect(res.status).toBe(404);
  });

  it('validates required fields on ticket creation', async () => {
    const app = buildApp();
    const reseller = await makeReseller('tester4');
    currentReseller = reseller;
    const res = await request(app).post('/api/v1/reseller/tickets').send({ body: 'بدون عنوان' });
    expect(res.status).toBe(400);
  });
});
