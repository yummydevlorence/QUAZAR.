const nodemailer = require('nodemailer');

let transporter;

function getTransporter() {
  if (transporter) return transporter;

  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/\s/g, '');
  const missing = [
    ['SMTP_HOST', host],
    ['SMTP_USER', user],
    ['SMTP_PASS', pass]
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) {
    throw new Error(`Missing SMTP configuration: ${missing.join(', ')}`);
  }

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be a valid port number.');
  }

  const secureValue = process.env.SMTP_SECURE;
  if (secureValue && !['true', 'false'].includes(secureValue.toLowerCase())) {
    throw new Error('SMTP_SECURE must be true or false.');
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: secureValue ? secureValue.toLowerCase() === 'true' : port === 465,
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    auth: {
      user,
      pass
    }
  });
  return transporter;
}

async function verifyEmailTransport() {
  await getTransporter().verify();
}

function emailFailureMessage(error) {
  if (error.code === 'EAUTH' || error.responseCode === 535) {
    return 'The SMTP provider rejected the login. Check SMTP_USER and SMTP_PASS; Gmail requires a current Google App Password.';
  }
  if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS'].includes(error.code)) {
    return 'Could not connect to the SMTP server. Check SMTP_HOST, SMTP_PORT, SMTP_SECURE, and your network connection.';
  }
  if (error.code === 'EENVELOPE' || (error.responseCode >= 550 && error.responseCode <= 553)) {
    return 'The SMTP provider rejected the sender or recipient. Check SMTP_USER, SMTP_FROM, and the recipient address.';
  }
  return 'OTP email could not be sent. Check the VS Code backend terminal or run "npm run check-email" for SMTP diagnostics.';
}

async function sendOtpEmail(to, code) {
  await getTransporter().sendMail({
    from: (process.env.SMTP_FROM || process.env.SMTP_USER).trim(),
    to,
    subject: 'Your QuazarTech verification code',
    text: `Your QuazarTech verification code is ${code}.\n\nIt expires in 15 minutes. If you did not request this code, you can ignore this email.`
  });
}

module.exports = { sendOtpEmail, verifyEmailTransport, emailFailureMessage };
