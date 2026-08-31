const mongoose = require('mongoose');

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE_NUMBER = 10000;
const MAX_SEARCH_LENGTH = 120;

function parsePagination(query = {}) {
  const rawPage = Number.parseInt(String(query.page ?? '1'), 10);
  const rawLimit = Number.parseInt(String(query.limit ?? DEFAULT_PAGE_SIZE), 10);
  const page = Number.isFinite(rawPage) ? Math.min(Math.max(rawPage, 1), MAX_PAGE_NUMBER) : 1;
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
}

function escapeRegex(value) {
  return String(value).slice(0, MAX_SEARCH_LENGTH).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function addSearchFilter(query, search) {
  const normalized = String(search ?? '').trim().slice(0, MAX_SEARCH_LENGTH);
  if (normalized) query.title = { $regex: escapeRegex(normalized), $options: 'i' };
  return query;
}

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(String(value));
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  addSearchFilter,
  isValidObjectId,
  parsePagination,
};
