const { verifyEmailTransport } = require('./email');

verifyEmailTransport()
  .then(() => {
    console.log('SMTP connection and authentication succeeded. No email was sent.');
  })
  .catch((error) => {
    console.error('SMTP check failed:', {
      code: error.code,
      responseCode: error.responseCode,
      command: error.command,
      message: error.message
    });
    process.exitCode = 1;
  });
