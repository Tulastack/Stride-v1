const express = require('express');
const { body, validationResult } = require('express-validator');
const pool = require('../db');

const router = express.Router();

const validateUser = [
  body('firstName')
    .trim()
    .notEmpty().withMessage('First name is required')
    .isLength({ max: 100 }).withMessage('First name must be 100 characters or fewer'),
  body('lastName')
    .trim()
    .notEmpty().withMessage('Last name is required')
    .isLength({ max: 100 }).withMessage('Last name must be 100 characters or fewer'),
  body('email')
    .trim()
    .notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Must be a valid email address')
    .normalizeEmail()
    .isLength({ max: 255 }).withMessage('Email must be 255 characters or fewer'),
];

// POST /api/users — register a new user
router.post('/', validateUser, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ error: errors.array()[0].msg });
  }

  const { firstName, lastName, email } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO users_2 (first_name, last_name, email)
       VALUES ($1, $2, $3)
       RETURNING id, first_name, last_name, email, created_at`,
      [firstName, lastName, email]
    );

    return res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    // Unique constraint violation (duplicate email)
    if (err.code === '23505') {
      return res.status(409).json({ error: 'A user with that email already exists.' });
    }
    console.error('DB error code:', err.code, '| message:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
