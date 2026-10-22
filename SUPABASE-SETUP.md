# QuazarTech on Supabase – setup (3 steps)

1. **Create the tables.** Supabase dashboard -> SQL Editor -> New query -> paste the
   contents of `database/supabase-schema.sql` -> Run.
2. **Install and copy your data** (in the project folder, in a terminal):
   ```
   npm install
   npm run migrate
   ```
   This copies `back-end/quazar.db` (users, products, orders, reviews...) into Supabase.
   It only runs if Supabase is empty; add `--replace` to overwrite.
3. **Start the site:** `npm start` -> http://localhost:8000

`back-end/.env` holds your `DATABASE_URL`, backend port (`PORT=8000`), and SMTP credentials. Never share it or commit it to Git.

**Email verification:** OTPs are emailed using SMTP. For Gmail, enable 2-Step Verification on the sender account, create a Google App Password, then add the following to `back-end/.env` (use the App Password, not your regular Gmail password):

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-sender@gmail.com
SMTP_PASS=your-16-character-app-password-without-spaces
```

Restart `npm start` after saving the settings. `SMTP_FROM` can optionally be set to a verified sender address; otherwise `SMTP_USER` is used.

To test the SMTP connection and authentication without sending a message, run
`npm run check-email` from the project folder. A successful check confirms that
the backend can connect and authenticate, but does not guarantee that a recipient
will accept an email. If the check reports an authentication error, create a new
Google App Password and update `SMTP_PASS`; if it reports a connection error,
check the host, port, TLS setting, and network access.
The SQLite files are no longer used by the site; keep them as a backup.
Product photos uploaded from the admin page are still saved in the local `images/` folder.
