const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const SupportTicket = require('../models/SupportTicket');
const Reseller = require('../models/Reseller');
const { audit, reqCtx } = require('../services/audit-log');

// Admin support tickets: /api/v1/admin/tickets
const { requireAuth, requireAdmin } = require('./auth');
router.use(requireAuth);
router.use(requireAdmin);

function parseId(id) {
  return mongoose.isValidObjectId(id) ? id : null;
}

async function enrichTickets(tickets) {
  const resellerIds = [...new Set(tickets.map((t) => String(t.resellerId)).filter(Boolean))];
  const resellers = resellerIds.length
    ? await Reseller.find({ _id: { $in: resellerIds } }).select('name city phone username status').lean()
    : [];
  const resellerMap = new Map(resellers.map((r) => [String(r._id), r]));
  return tickets.map((t) => ({
    _id: t._id,
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    messageCount: (t.messages || []).length,
    lastMessage: t.messages?.length
      ? {
          author: t.messages[t.messages.length - 1].author,
          body: t.messages[t.messages.length - 1].body,
          createdAt: t.messages[t.messages.length - 1].createdAt,
        }
      : null,
    closedAt: t.closedAt || null,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    reseller: resellerMap.get(String(t.resellerId)) || null,
  }));
}

// GET / — all tickets, newest first. Filters: ?status=OPEN|PENDING|CLOSED, ?resellerId=
router.get('/', async (req, res) => {
  try {
    const { status, resellerId } = req.query;
    const filter = {};
    if (['OPEN', 'PENDING', 'CLOSED'].includes(status)) filter.status = status;
    if (parseId(resellerId)) filter.resellerId = resellerId;
    const tickets = await SupportTicket.find(filter).sort({ createdAt: -1 }).limit(500).lean().exec();
    const data = await enrichTickets(tickets);
    const counts = await SupportTicket.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]).exec();
    const summary = { OPEN: 0, PENDING: 0, CLOSED: 0 };
    for (const c of counts) if (c._id in summary) summary[c._id] = c.count;
    res.json({ success: true, data, summary });
  } catch (err) {
    console.error('[admin-tickets] list error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// GET /:id — full thread with reseller info
router.get('/:id', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findById(id).lean().exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    const reseller = await Reseller.findById(ticket.resellerId).select('name city phone username status').lean().exec();
    res.json({ success: true, data: { ...ticket, reseller } });
  } catch (err) {
    console.error('[admin-tickets] detail error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/reply — admin replies; reopens a closed ticket.
router.post('/:id/reply', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findById(id).exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    const body = String(req.body?.body || '').trim().slice(0, 4000);
    if (!body) return res.status(400).json({ success: false, error: 'body is required' });
    ticket.messages.push({ author: 'admin', body });
    ticket.status = 'OPEN';
    ticket.closedAt = null;
    await ticket.save();
    audit({ ...reqCtx(req), action: 'ADMIN_TICKET_REPLY', resource: 'SupportTicket', resourceId: String(ticket._id) });
    res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('[admin-tickets] reply error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/close
router.post('/:id/close', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findById(id).exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    ticket.status = 'CLOSED';
    ticket.closedAt = new Date();
    await ticket.save();
    audit({ ...reqCtx(req), action: 'ADMIN_TICKET_CLOSE', resource: 'SupportTicket', resourceId: String(ticket._id) });
    res.json({ success: true, data: { _id: ticket._id, status: 'CLOSED' } });
  } catch (err) {
    console.error('[admin-tickets] close error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// POST /:id/reopen
router.post('/:id/reopen', async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (!id) return res.status(400).json({ success: false, error: 'Invalid ticket id' });
    const ticket = await SupportTicket.findById(id).exec();
    if (!ticket) return res.status(404).json({ success: false, error: 'Ticket not found' });
    ticket.status = 'OPEN';
    ticket.closedAt = null;
    await ticket.save();
    audit({ ...reqCtx(req), action: 'ADMIN_TICKET_REOPEN', resource: 'SupportTicket', resourceId: String(ticket._id) });
    res.json({ success: true, data: { _id: ticket._id, status: 'OPEN' } });
  } catch (err) {
    console.error('[admin-tickets] reopen error:', err);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

module.exports = router;
