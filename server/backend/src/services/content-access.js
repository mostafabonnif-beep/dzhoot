const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return value.map((id) => String(id)).filter(Boolean).slice(0, 10000);
}

/**
 * Resolve the catalog scope granted by the customer's active plan.
 * Admins retain full catalog access; customers default to all active shared
 * catalog items for backward compatibility unless a plan explicitly uses
 * features.contentScope.mode = 'selected'.
 */
async function getContentScope(user) {
  if (!user || user.role === 'Admin') return { mode: 'all' };
  const subscription = await Subscription.findOne({ userId: user.id, status: 'ACTIVE' }).lean().exec();
  if (!subscription) return { mode: 'none' };
  const plan = await Plan.findById(subscription.planId).lean().exec();
  const content = plan?.features?.contentScope;
  if (!content || content.mode !== 'selected') return { mode: 'all' };
  return {
    mode: 'selected',
    channelIds: normalizeIds(content.channelIds),
    movieIds: normalizeIds(content.movieIds),
    seriesIds: normalizeIds(content.seriesIds),
  };
}

function idsFor(scope, type) {
  if (!scope || scope.mode === 'none') return [];
  if (scope.mode === 'all') return null;
  return scope[`${type}Ids`] || [];
}

function canAccess(scope, type, id) {
  const ids = idsFor(scope, type);
  return ids === null || ids.includes(String(id));
}

/**
 * Add the plan scope to a Mongo filter. The filter is unchanged for an
 * unrestricted scope, while selected/empty scopes become an explicit $in
 * constraint. This keeps list, search, category, and home queries aligned.
 */
function applyScopeFilter(filter, scope, type, field = '_id') {
  const ids = idsFor(scope, type);
  if (ids !== null) filter[field] = { $in: ids };
  return filter;
}

module.exports = { getContentScope, idsFor, canAccess, applyScopeFilter };
