const router = require('express').Router();
const { asyncHandler, ok } = require('../utils/http');
const { dashboard } = require('../services/reports');
const { refreshStatuses } = require('../services/ledger');
const { pool } = require('../config/db');

router.get('/summary', asyncHandler(async (req, res) => {
  await refreshStatuses(pool, req.user.company_id);
  ok(res, await dashboard(req.user.company_id, req.query));
}));

module.exports = router;
