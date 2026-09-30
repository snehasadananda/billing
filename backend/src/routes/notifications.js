const router = require('express').Router();
const { pool } = require('../config/db');
const { asyncHandler, ok, idNum, pageParams } = require('../utils/http');

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req, 20); const cid = req.user.company_id;
  const where = 'company_id=? AND (user_id IS NULL OR user_id=?)'; const args = [cid, req.user.id];
  const unreadOnly = req.query.unread === 'true' ? ' AND is_read=0' : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM notifications WHERE ${where}${unreadOnly}`, args);
  const [[{ unread }]] = await pool.query(`SELECT COUNT(*) unread FROM notifications WHERE ${where} AND is_read=0`, args);
  const [rows] = await pool.query(`SELECT * FROM notifications WHERE ${where}${unreadOnly} ORDER BY id DESC LIMIT ? OFFSET ?`, [...args, limit, offset]);
  ok(res, rows, { unread, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
}));

router.get('/unread-count', asyncHandler(async (req, res) => {
  const [[{ unread }]] = await pool.query('SELECT COUNT(*) unread FROM notifications WHERE company_id=? AND (user_id IS NULL OR user_id=?) AND is_read=0', [req.user.company_id, req.user.id]);
  ok(res, { unread });
}));

router.put('/read-all', asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read=1 WHERE company_id=? AND (user_id IS NULL OR user_id=?)', [req.user.company_id, req.user.id]);
  ok(res, { done: true });
}));

router.put('/:id/read', asyncHandler(async (req, res) => {
  await pool.query('UPDATE notifications SET is_read=1 WHERE id=? AND company_id=?', [idNum.parse(req.params.id), req.user.company_id]);
  ok(res, { done: true });
}));

module.exports = router;
