const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const pool = require('../config/db');
require('dotenv').config();

// Nodemailer transporter — using Gmail SMTP
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Generate a 6-digit random OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Save OTP to DB (hashed) and send email
async function createAndSendOTP(email, purpose) {
  const otp = generateOTP();
  const hashedOtp = await bcrypt.hash(otp, 10);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

  // Expire any previous unused OTP for this email/purpose
  await pool.query(
    'UPDATE otp_codes SET is_used = 1 WHERE email = ? AND purpose = ? AND is_used = 0',
    [email, purpose]
  );

  await pool.query(
    'INSERT INTO otp_codes (email, otp_code, purpose, expires_at) VALUES (?, ?, ?, ?)',
    [email, hashedOtp, purpose, expiresAt]
  );

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'ChatNow OTP Code',
    text: `Your OTP is: ${otp}. It will expire in 10 minutes.`
  });

  return true;
}

// Verify OTP
async function verifyOTP(email, purpose, enteredOtp) {
  const otpString = String(enteredOtp).trim();

  const [rows] = await pool.query(
    'SELECT * FROM otp_codes WHERE email = ? AND purpose = ? AND is_used = 0 ORDER BY created_at DESC LIMIT 1',
    [email, purpose]
  );

  if (rows.length === 0) {
    return { success: false, message: 'OTP not found or has expired' };
  }

  const otpRecord = rows[0];

  if (new Date() > new Date(otpRecord.expires_at)) {
    return { success: false, message: 'OTP expired' };
  }

  // ✅ YE 2 LINES YAHAN ADD KARO
  const isMatch = await bcrypt.compare(otpString, otpRecord.otp_code);
  console.log('bcrypt match result:', isMatch);
  console.log('hash in DB:', otpRecord.otp_code);

  if (!isMatch) {
    return { success: false, message: 'Wrong OTP' };
  }

  await pool.query('UPDATE otp_codes SET is_used = 1 WHERE id = ?', [otpRecord.id]);

  return { success: true, message: 'OTP verified' };
}
module.exports = { generateOTP, createAndSendOTP, verifyOTP };