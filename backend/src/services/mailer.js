const nodemailer = require('nodemailer');
const env = require('../config/env');
const { AppError } = require('../utils/errors');

const configured = () => !!env.smtp.host;

async function sendMail({ to, subject, text, html, attachments }) {
  if (!configured()) throw new AppError(400, 'EMAIL_NOT_CONFIGURED', 'Email is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in the backend .env file.');
  const transporter = nodemailer.createTransport({
    host: env.smtp.host, port: env.smtp.port, secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  await transporter.sendMail({ from: env.smtp.from, to, subject, text, html, attachments });
}

module.exports = { sendMail, configured };
