# Custom SMTP Email Configuration

This guide explains how to configure InsForge to use a custom SMTP server for sending emails instead of the default cloud email service.

## Overview

InsForge supports two email providers:

1. **Cloud (Default)**: Uses InsForge cloud email service (requires `PROJECT_ID`)
2. **SMTP**: Uses your own SMTP server (Gmail, Outlook, SendGrid, Mailgun, etc.)

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

The required dependency `nodemailer` is now included in `backend/package.json`.

### 2. Configure Environment Variables

Add the following to your `.env` file:

```bash
# Enable SMTP email provider
EMAIL_PROVIDER=smtp

# SMTP Server Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-email@gmail.com
SMTP_REJECT_UNAUTHORIZED=true
```

### 3. Restart Docker Containers

```bash
docker compose down
docker compose up -d
```

## SMTP Configuration Examples

### Gmail

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password  # Use App Password, not regular password
SMTP_FROM=your-email@gmail.com
```

**Note**: You need to enable 2-Factor Authentication and create an [App Password](https://support.google.com/accounts/answer/185833).

### Outlook / Office365

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.office365.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@outlook.com
SMTP_PASS=your-password
SMTP_FROM=your-email@outlook.com
```

### SendGrid

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=SG.your-sendgrid-api-key
SMTP_FROM=your-verified-sender@yourdomain.com
```

### Mailgun

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.mailgun.org
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=postmaster@yourdomain.mailgun.org
SMTP_PASS=your-mailgun-api-key
SMTP_FROM=your-verified-sender@yourdomain.com
```

### Mailtrap (Testing)

```bash
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_USER=your-mailtrap-username
SMTP_PASS=your-mailtrap-password
SMTP_FROM=test@yourdomain.com
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `EMAIL_PROVIDER` | No | `cloud` | Email provider: `cloud` or `smtp` |
| `SMTP_HOST` | Yes (SMTP) | - | SMTP server hostname |
| `SMTP_PORT` | No | `587` | SMTP server port (typically 587 for TLS, 465 for SSL) |
| `SMTP_SECURE` | No | `false` | Use SSL/TLS? Set to `true` for port 465 |
| `SMTP_USER` | Yes (SMTP) | - | SMTP username/email |
| `SMTP_PASS` | Yes (SMTP) | - | SMTP password or API key |
| `SMTP_FROM` | No | `SMTP_USER` | Default "from" email address |
| `SMTP_REJECT_UNAUTHORIZED` | No | `true` | Reject self-signed certificates (set to `false` for testing only) |

## Important Notes

### Security

- **Never commit your `.env` file to version control**
- Use strong passwords and consider using API keys instead of regular passwords
- For production, enable `SMTP_REJECT_UNAUTHORIZED=true` to prevent MITM attacks

### Limitations

- **SMTP provider does NOT support template-based emails**
- You can only use `sendRaw()` for custom emails
- Template-based emails (email verification, password reset) still require cloud provider

### Email Templates

If you need to use template-based emails (like email verification or password reset codes), keep the default cloud provider:

```bash
# Leave empty or set to 'cloud' for template support
EMAIL_PROVIDER=cloud

# Requires PROJECT_ID for cloud templates
PROJECT_ID=your-project-id
```

## Troubleshooting

### Authentication Failed

- Verify your SMTP credentials are correct
- For Gmail, use an [App Password](https://support.google.com/accounts/answer/185833) instead of your regular password
- Check if your email provider requires "Less Secure Apps" to be enabled (deprecated for Gmail)

### Connection Timeout

- Verify `SMTP_HOST` and `SMTP_PORT` are correct
- Check if your firewall allows outbound connections to the SMTP server
- Some ISPs block port 25, try using port 587 or 2525 instead

### Certificate Errors

For testing only, you can disable certificate validation:

```bash
SMTP_REJECT_UNAUTHORIZED=false
```

**Warning**: Never use this in production!

### Testing SMTP Configuration

You can test your SMTP configuration using the API:

```bash
curl -X POST http://localhost:7130/api/email/send-raw \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "recipient@example.com",
    "subject": "Test Email",
    "html": "<h1>Hello from SMTP!</h1>"
  }'
```

## Migrating from Cloud to SMTP

1. Add SMTP configuration to your `.env` file
2. Set `EMAIL_PROVIDER=smtp`
3. Restart Docker containers
4. Test sending emails with `/api/email/send-raw`

**Note**: If you were using template-based emails, you'll need to either:
- Keep using cloud provider for templates
- Implement your own email templates in your application code

## Support

For issues or questions:
- GitHub Issues: https://github.com/InsForge/InsForge/issues
- Documentation: https://insforge.dev/docs
