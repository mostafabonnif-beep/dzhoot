const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const Channel = require('../models/Channel');
const AuditLog = require('../models/AuditLog');
const Subscription = require('../models/Subscription');
const Plan = require('../models/Plan');
const Device = require('../models/Device');
const { requireAuth, requireAdmin } = require('./auth');
const { escapeRegex } = require('../utils/escapeRegex');
const { audit, reqCtx } = require('../services/audit-log');

function isValidObjectId(id) {
  return mongoose.Types.ObjectId.isValid(id) && /^[0-9a-fA-F]{24}$/.test(id);
}

// Attach subscription + device-usage info to an array of user objects.
// Shape added per user: `subscription: { planId, planName, status, startsAt, expiresAt } | null`
// and `devicesInUse: number`.
async function attachSubscriptionInfo(users) {
  if (users.length === 0) return;
  const userIds = users.map((u) => u._id);

  // Latest subscription per user (prefers the one expiring latest).
  const subs = await Subscription.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $sort: { expiresAt: -1 } },
    { $group: { _id: '$userId', doc: { $first: '$$ROOT' } } },
  ]);
  const subByUser = new Map(subs.map((s) => [String(s._id), s.doc]));
  const planIds = subs.map((s) => s.doc.planId).filter(Boolean);
  const plans = await Plan.find({ _id: { $in: planIds } }).select('name').lean();
  const planByName = new Map(plans.map((p) => [String(p._id), p.name]));

  const deviceCounts = await Device.aggregate([
    { $match: { userId: { $in: userIds } } },
    { $group: { _id: '$userId', count: { $sum: 1 } } },
  ]);
  const deviceCountByUser = new Map(deviceCounts.map((d) => [String(d._id), d.count]));

  const now = Date.now();
  for (const user of users) {
    const sub = subByUser.get(String(user._id));
    // Mirror the user-facing normalization: an ACTIVE subscription whose
    // expiry passed is reported as EXPIRED.
    let status = sub?.status || '';
    if (status === 'ACTIVE' && sub.expiresAt && new Date(sub.expiresAt).getTime() < now) {
      status = 'EXPIRED';
    }
    user.subscription = sub
      ? {
          planId: String(sub.planId || ''),
          planName: sub.planId ? planByName.get(String(sub.planId)) || '' : '',
          status,
          startsAt: sub.startsAt ? new Date(sub.startsAt).toISOString() : null,
          expiresAt: sub.expiresAt ? new Date(sub.expiresAt).toISOString() : null,
        }
      : null;
    user.devicesInUse = deviceCountByUser.get(String(user._id)) || 0;
  }
}

// Get distinct filter options for users
router.get('/filter-options', requireAuth, requireAdmin, async (req, res) => {
  try {
    const roles = await User.distinct('role');
    const statuses = ['Active', 'Inactive'];

    res.json({
      success: true,
      data: {
        role: roles.filter(Boolean).sort(),
        status: statuses,
      },
    });
  } catch (error) {
    console.error('Error fetching user filter options:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch filter options' });
  }
});

// Get all users (Admin only) with server-side filtering & pagination
router.get('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role, status, search, page, pageSize, sortBy, sortOrder } = req.query;
    const filter = {};

    // Multi-value role filter
    if (role) {
      const roles = role
        .split(',')
        .map((r) => r.trim())
        .filter(Boolean);
      if (roles.length > 0) filter.role = { $in: roles };
    }

    // Status filter — supports single and multi-value (e.g. "Active,Inactive")
    if (status) {
      const statuses = status
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const hasActive = statuses.includes('Active');
      const hasInactive = statuses.includes('Inactive');
      // Only apply filter when the selection is not "both" (which means no filter)
      if (hasActive && !hasInactive) {
        filter.isActive = true;
      } else if (hasInactive && !hasActive) {
        filter.isActive = false;
      }
      // Both selected or unrecognized values → no filter (show all)
    }

    // Text search
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ username: regex }, { email: regex }, { channelListCode: regex }];
    }

    const p = parseInt(page, 10) || 1;
    const ps = Math.min(parseInt(pageSize, 10) || 50, 200);
    const order = sortOrder === 'asc' ? 1 : -1;

    // Build sort — channelCount requires computing array length
    let sort = { createdAt: -1 };
    if (sortBy === 'channelCount') {
      sort = { channelCount: order, createdAt: -1 };
    } else if (sortBy === 'lastActivity') {
      sort = { lastLogin: order, createdAt: -1 };
    }

    let users;
    let totalCount;

    if (sortBy === 'channelCount') {
      // Use aggregation to sort by channels array length
      const pipeline = [
        { $match: filter },
        { $addFields: { channelCount: { $size: { $ifNull: ['$channels', []] } } } },
        { $sort: sort },
        { $skip: (p - 1) * ps },
        { $limit: ps },
        {
          $project: {
            password: 0,
            channels: 0,
            emailVerificationToken: 0,
            emailVerificationExpires: 0,
            passwordResetToken: 0,
            passwordResetExpires: 0,
            googleId: 0,
            githubId: 0,
          },
        },
      ];
      [users, totalCount] = await Promise.all([
        User.aggregate(pipeline),
        User.countDocuments(filter),
      ]);
    } else {
      [users, totalCount] = await Promise.all([
        User.find(filter)
          .select('-password')
          .sort(sort)
          .skip((p - 1) * ps)
          .limit(ps),
        User.countDocuments(filter),
      ]);
    }

    // Get last activity date for each user in this page
    const userIds = users.map((u) => u._id);
    const lastActivities = await AuditLog.aggregate([
      { $match: { userId: { $in: userIds } } },
      { $group: { _id: '$userId', lastActivity: { $max: '$timestamp' } } },
    ]);
    const activityMap = {};
    for (const entry of lastActivities) {
      activityMap[entry._id.toString()] = entry.lastActivity;
    }

    const data = users.map((u) => {
      const userObj = typeof u.toJSON === 'function' ? u.toJSON() : { ...u };
      const auditDate = activityMap[(u._id || u.id).toString()] || null;
      const loginDate = userObj.lastLogin || null;
      const fallbackDate = userObj.createdAt || null;
      if (auditDate && loginDate) {
        userObj.lastActivity = new Date(auditDate) > new Date(loginDate) ? auditDate : loginDate;
      } else {
        userObj.lastActivity = auditDate || loginDate || fallbackDate;
      }
      userObj.channelCount = userObj.channelCount ?? (userObj.channels || []).length;
      delete userObj.channels;
      return userObj;
    });

    await attachSubscriptionInfo(data);

    res.json({
      success: true,
      count: data.length,
      totalCount,
      page: p,
      pageSize: ps,
      data,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch users',
    });
  }
});

// Export users as CSV (Admin only) — respects the same filters as the list.
router.get('/export/csv', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { role, status, search } = req.query;
    const filter = {};

    if (role) {
      const roles = role.split(',').map((r) => r.trim()).filter(Boolean);
      if (roles.length > 0) filter.role = { $in: roles };
    }
    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean);
      const hasActive = statuses.includes('Active');
      const hasInactive = statuses.includes('Inactive');
      if (hasActive && !hasInactive) filter.isActive = true;
      else if (hasInactive && !hasActive) filter.isActive = false;
    }
    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      filter.$or = [{ username: regex }, { email: regex }, { channelListCode: regex }];
    }

    const users = await User.find(filter)
      .select('-password -emailVerificationToken -emailVerificationExpires -passwordResetToken -passwordResetExpires -googleId -githubId')
      .sort({ createdAt: -1 })
      .limit(50000)
      .lean();

    await attachSubscriptionInfo(users);

    // CSV formula-injection guard: neutralize cells starting with = + - @.
    const esc = (v) => {
      const s = String(v ?? '');
      const guarded = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return `"${guarded.replace(/"/g, '""')}"`;
    };
    const rows = [
      ['username', 'email', 'role', 'status', 'channel_code', 'channel_count', 'last_login', 'created_at', 'subscription_plan', 'subscription_status', 'subscription_expires_at', 'devices_in_use'].join(','),
    ];
    for (const u of users) {
      const channelCount = u.channels ? u.channels.length : 0;
      rows.push([
        esc(u.username), esc(u.email), esc(u.role),
        esc(u.isActive === false ? 'Inactive' : 'Active'),
        esc(u.channelListCode),
        esc(channelCount),
        esc(u.lastLogin ? new Date(u.lastLogin).toISOString() : ''),
        esc(u.createdAt ? new Date(u.createdAt).toISOString() : ''),
        esc(u.subscription?.planName || ''),
        esc(u.subscription?.status || ''),
        esc(u.subscription?.expiresAt || ''),
        esc(u.devicesInUse ?? 0),
      ].join(','));
    }

    audit({
      ...reqCtx(req),
      action: 'users_export',
      resource: 'User',
      changes: {
        after: {
          count: users.length,
          filters: { role, status, search: search ? String(search).slice(0, 200) : undefined },
        },
      },
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="users.csv"');
    return res.send('\ufeff' + rows.join('\n'));
  } catch (error) {
    console.error('Error exporting users:', error);
    return res.status(500).json({ success: false, error: 'Failed to export users' });
  }
});

// Create new user (Admin only)
router.post('/', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { username, password, email, role, isActive } = req.body;

    // Validate required fields
    if (!username || !password || !email) {
      return res.status(400).json({
        success: false,
        error: 'Username, password, and email are required',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 8 characters long',
      });
    }
    if (password.length > 128) {
      return res.status(400).json({
        success: false,
        error: 'Password must not exceed 128 characters',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ username }, { email }],
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        error: 'Username or email already exists',
      });
    }

    // Create new user with retry-safe channelListCode generation
    const user = await User.generateAndSaveWithCode({
      username,
      password,
      email,
      role: role || 'User',
      isActive: isActive !== undefined ? isActive : true,
    });
    audit({
      userId: req.user.id,
      action: 'create_user',
      resource: 'user',
      resourceId: String(user._id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Return user without password hash
    const userResponse = user.toJSON();
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: userResponse,
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(400).json({
        success: false,
        error: `A user with that ${field} already exists`,
      });
    }
    console.error('Error creating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create user',
    });
  }
});

// Get user by ID (Admin or own profile)
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format' });
    }

    // Check if user is accessing their own profile or is admin
    if (req.user.role !== 'Admin' && req.user.id.toString() !== id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const user = await User.findById(id)
      .select('-password')
      .populate(
        'channels',
        'channelName channelGroup channelUrl channelImg tvgLogo order channelId',
      );

    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    const data = user.toJSON ? user.toJSON() : { ...user };
    await attachSubscriptionInfo([data]);

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch user',
    });
  }
});

// Update user (Admin or own profile)
router.put('/:id', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format' });
    }

    const { username, email, password, role, isActive, allCatalog } = req.body;

    // Check if user is accessing their own profile or is admin
    const isAdmin = req.user.role === 'Admin';
    const isOwnProfile = req.user.id.toString() === id.toString();

    if (!isAdmin && !isOwnProfile) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Update fields
    if (username) user.username = username;
    if (email) user.email = email;

    // Non-admin users cannot change password through this endpoint
    // (must use the dedicated /auth/change-password route which verifies current password)
    if (password) {
      if (!isAdmin) {
        return res.status(403).json({
          success: false,
          error: 'Use the change-password endpoint to update your password',
        });
      }
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          error: 'Password must be at least 8 characters long',
        });
      }
      if (password.length > 128) {
        return res.status(400).json({
          success: false,
          error: 'Password must not exceed 128 characters',
        });
      }
      user.password = password; // Will be hashed by pre-save hook
    }

    // Only admin can change role, isActive and allCatalog
    const previousRole = user.role;
    if (isAdmin) {
      if (role !== undefined) user.role = role;
      if (isActive !== undefined) user.isActive = isActive;
      if (allCatalog !== undefined) user.allCatalog = allCatalog === true;
    }

    await user.save();
    audit({
      userId: req.user.id,
      action: 'update_user',
      resource: 'user',
      resourceId: String(user._id),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    // Dedicated audit entry for role changes (especially escalation to Admin)
    if (role !== undefined && role !== previousRole) {
      audit({
        userId: req.user.id,
        action: role === 'Admin' ? 'role_escalation' : 'role_change',
        resource: 'user',
        resourceId: String(user._id),
        changes: { before: { role: previousRole }, after: { role } },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      console.warn(
        `[SECURITY] Role changed for user ${user.username} (${user._id}): ${previousRole} -> ${role} by ${req.user.id}`,
      );
    }

    // Return user without password hash
    const userResponse = user.toJSON();
    res.json({
      success: true,
      message: 'User updated successfully',
      data: userResponse,
    });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      return res.status(400).json({
        success: false,
        error: `A user with that ${field} already exists`,
      });
    }
    console.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update user',
    });
  }
});

// Delete user (Admin only)
router.delete('/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format' });
    }

    if (id.toString() === req.user.id.toString()) {
      return res.status(400).json({
        success: false,
        error: 'Cannot delete your own admin account',
      });
    }

    const user = await User.findByIdAndDelete(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Purge all sessions and refresh tokens for deleted user
    const Session = require('../models/Session');
    const RefreshToken = require('../models/RefreshToken');
    await Promise.all([
      Session.deleteMany({ userId: id }),
      RefreshToken.deleteMany({ userId: id }),
    ]);

    audit({
      userId: req.user.id,
      action: 'delete_user',
      resource: 'user',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete user',
    });
  }
});

// Note: Channel assignment removed - users manage their own channels via /api/v1/user-playlist

// Revoke pairing code (Admin or own profile)
router.put('/:id/revoke-code', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format' });
    }

    if (req.user.role !== 'Admin' && req.user.id.toString() !== id.toString()) {
      return res.status(403).json({ success: false, error: 'Access denied' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    user.codeRevokedAt = new Date();
    await user.save();

    audit({
      userId: req.user.id,
      action: 'revoke_code',
      resource: 'user',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Channel list code revoked. Use regenerate-code to issue a new one.',
    });
  } catch (error) {
    console.error('Error revoking code:', error);
    res.status(500).json({ success: false, error: 'Failed to revoke code' });
  }
});

// Regenerate playlist code (Admin or own profile)
router.put('/:id/regenerate-code', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
      return res.status(400).json({ success: false, error: 'Invalid user ID format' });
    }

    // Check if user is accessing their own profile or is admin
    if (req.user.role !== 'Admin' && req.user.id.toString() !== id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
      });
    }

    // Revoke old code and generate new one
    user.channelListCode = await User.generateChannelListCode();
    user.codeRevokedAt = null; // Clear revocation on the new code
    await user.save();
    audit({
      userId: req.user.id,
      action: 'regenerate_code',
      resource: 'user',
      resourceId: id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.json({
      success: true,
      message: 'Channel list code regenerated successfully',
      data: {
        channelListCode: user.channelListCode,
      },
    });
  } catch (error) {
    console.error('Error regenerating code:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to regenerate code',
    });
  }
});

module.exports = router;
