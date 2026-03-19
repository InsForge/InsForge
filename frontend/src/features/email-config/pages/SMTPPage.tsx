import { useState } from 'react';
import { Card } from '@/components/radix';
import { Button, Tabs, Tab } from '@insforge/ui';
import { Input } from '@insforge/ui';
import { Label } from '@/components/radix';
import { Switch } from '@insforge/ui';
import { Mail, Server, CheckCircle2, AlertCircle } from 'lucide-react';

export default function SMTPPage() {
  const [activeTab, setActiveTab] = useState<'provider' | 'test'>('provider');
  const [provider, setProvider] = useState<'cloud' | 'smtp'>('cloud');
  const [smtpConfig, setSmtpConfig] = useState({
    host: '',
    port: '587',
    secure: false,
    user: '',
    pass: '',
    from: '',
    rejectUnauthorized: true,
  });
  const [testEmail, setTestEmail] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [testMessage, setTestMessage] = useState('');

  const handleTestConnection = async () => {
    setTestStatus('loading');
    setTestMessage('');

    try {
      const response = await fetch('/api/email/test-smtp', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          provider: 'smtp',
          config: smtpConfig,
        }),
      });

      if (response.ok) {
        setTestStatus('success');
        setTestMessage('SMTP connection successful!');
      } else {
        const error = await response.json();
        setTestStatus('error');
        setTestMessage(error.message || 'Connection failed');
      }
    } catch (error) {
      setTestStatus('error');
      setTestMessage('Network error while testing connection');
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmail) {
      setTestMessage('Please enter a test email address');
      setTestStatus('error');
      return;
    }

    setTestStatus('loading');
    setTestMessage('');

    try {
      const response = await fetch('/api/email/send-raw', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: testEmail,
          subject: 'InsForge SMTP Test Email',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2 style="color: #333;">SMTP Configuration Test</h2>
              <p>Congratulations! Your SMTP configuration is working correctly.</p>
              <p>You have successfully set up custom SMTP for InsForge.</p>
              <div style="background: #f4f4f4; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <strong>Configuration:</strong><br>
                Host: ${smtpConfig.host}<br>
                Port: ${smtpConfig.port}<br>
                From: ${smtpConfig.from || smtpConfig.user}
              </div>
            </div>
          `,
        }),
      });

      if (response.ok) {
        setTestStatus('success');
        setTestMessage('Test email sent successfully!');
      } else {
        const error = await response.json();
        setTestStatus('error');
        setTestMessage(error.message || 'Failed to send test email');
      }
    } catch (error) {
      setTestStatus('error');
      setTestMessage('Network error while sending email');
    }
  };

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 text-foreground">SMTP Configuration</h1>
        <p className="text-muted-foreground">
          Configure custom SMTP server for sending emails instead of using InsForge cloud email
          service.
        </p>
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(value) => setActiveTab(value as 'provider' | 'test')}
        className="w-full mb-6"
      >
        <Tab value="provider">Email Provider</Tab>
        <Tab value="test">Test Connection</Tab>
      </Tabs>

      <div className="space-y-6">
        {activeTab === 'provider' && (
          <>
            {/* Provider Selection */}
            <Card className="p-6">
              <h2 className="text-2xl font-semibold mb-6 text-foreground">Select Email Provider</h2>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Server className="h-5 w-5" />
                      <div>
                        <h3 className="font-semibold text-foreground">InsForge Cloud Email</h3>
                        <p className="text-sm text-muted-foreground">
                          Use InsForge cloud email service (requires PROJECT_ID)
                        </p>
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={provider === 'cloud'}
                    onCheckedChange={(checked) => setProvider(checked ? 'cloud' : 'smtp')}
                  />
                </div>

                <div className="flex items-center justify-between p-4 border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <Mail className="h-5 w-5" />
                      <div>
                        <h3 className="font-semibold text-foreground">Custom SMTP Server</h3>
                        <p className="text-sm text-muted-foreground">
                          Use your own SMTP server (Gmail, Outlook, SendGrid, etc.)
                        </p>
                      </div>
                    </div>
                  </div>
                  <Switch
                    checked={provider === 'smtp'}
                    onCheckedChange={(checked) => setProvider(checked ? 'smtp' : 'cloud')}
                  />
                </div>
              </div>
            </Card>

            {/* SMTP Configuration Form */}
            {provider === 'smtp' && (
              <Card className="p-6">
                <h2 className="text-2xl font-semibold mb-6 text-foreground">
                  SMTP Server Settings
                </h2>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="host">SMTP Host *</Label>
                      <Input
                        id="host"
                        placeholder="smtp.gmail.com"
                        value={smtpConfig.host}
                        onChange={(e) => setSmtpConfig({ ...smtpConfig, host: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="port">SMTP Port</Label>
                      <Input
                        id="port"
                        type="number"
                        placeholder="587"
                        value={smtpConfig.port}
                        onChange={(e) => setSmtpConfig({ ...smtpConfig, port: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <Label htmlFor="secure">Use SSL/TLS</Label>
                      <p className="text-sm text-muted-foreground">
                        Enable for port 465, disable for port 587
                      </p>
                    </div>
                    <Switch
                      id="secure"
                      checked={smtpConfig.secure}
                      onCheckedChange={(checked) =>
                        setSmtpConfig({ ...smtpConfig, secure: checked })
                      }
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="user">SMTP User *</Label>
                      <Input
                        id="user"
                        placeholder="your-email@gmail.com"
                        value={smtpConfig.user}
                        onChange={(e) => setSmtpConfig({ ...smtpConfig, user: e.target.value })}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="pass">SMTP Password *</Label>
                      <Input
                        id="pass"
                        type="password"
                        placeholder="Your password or app password"
                        value={smtpConfig.pass}
                        onChange={(e) => setSmtpConfig({ ...smtpConfig, pass: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="from">From Email (optional)</Label>
                    <Input
                      id="from"
                      placeholder="your-email@gmail.com"
                      value={smtpConfig.from}
                      onChange={(e) => setSmtpConfig({ ...smtpConfig, from: e.target.value })}
                    />
                    <p className="text-sm text-muted-foreground">
                      Defaults to SMTP user if not specified
                    </p>
                  </div>

                  <div className="flex items-center justify-between p-4 border rounded-lg">
                    <div>
                      <Label htmlFor="rejectUnauthorized">Verify SSL Certificates</Label>
                      <p className="text-sm text-muted-foreground">
                        Disable only for testing with self-signed certificates
                      </p>
                    </div>
                    <Switch
                      id="rejectUnauthorized"
                      checked={smtpConfig.rejectUnauthorized}
                      onCheckedChange={(checked) =>
                        setSmtpConfig({ ...smtpConfig, rejectUnauthorized: checked })
                      }
                    />
                  </div>

                  <div className="p-4 bg-muted rounded-lg">
                    <h4 className="font-semibold mb-2 text-foreground">Quick Setup Examples:</h4>
                    <div className="space-y-2 text-sm text-foreground">
                      <div>
                        <strong className="text-foreground">Gmail:</strong> smtp.gmail.com:587, use
                        App Password
                      </div>
                      <div>
                        <strong className="text-foreground">Outlook:</strong> smtp.office365.com:587
                      </div>
                      <div>
                        <strong className="text-foreground">SendGrid:</strong> smtp.sendgrid.net:587
                        or 2525
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            )}
          </>
        )}

        {activeTab === 'test' && (
          <>
            <Card className="p-6">
              <h2 className="text-2xl font-semibold mb-6 text-foreground">Test SMTP Connection</h2>
              {provider === 'smtp' ? (
                <div className="space-y-4">
                  <Button
                    onClick={handleTestConnection}
                    disabled={testStatus === 'loading' || !smtpConfig.host || !smtpConfig.user}
                    className="w-full"
                  >
                    {testStatus === 'loading' ? 'Testing...' : 'Test SMTP Connection'}
                  </Button>

                  {testStatus !== 'idle' && (
                    <div
                      className={`flex items-center gap-3 p-4 rounded-lg ${
                        testStatus === 'success'
                          ? 'bg-green-50 text-green-800 border-green-200'
                          : 'bg-red-50 text-red-800 border-red-200'
                      }`}
                    >
                      {testStatus === 'success' ? (
                        <CheckCircle2 className="h-5 w-5" />
                      ) : (
                        <AlertCircle className="h-5 w-5" />
                      )}
                      <span>{testMessage}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center text-muted-foreground py-8">
                  Switch to SMTP provider to test connection
                </div>
              )}
            </Card>

            <Card className="p-6">
              <h2 className="text-2xl font-semibold mb-6 text-foreground">Send Test Email</h2>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="testEmail">Test Email Address *</Label>
                  <Input
                    id="testEmail"
                    type="email"
                    placeholder="recipient@example.com"
                    value={testEmail}
                    onChange={(e) => setTestEmail(e.target.value)}
                  />
                </div>

                <Button
                  onClick={handleSendTestEmail}
                  disabled={testStatus === 'loading' || !testEmail}
                  className="w-full"
                >
                  {testStatus === 'loading' ? 'Sending...' : 'Send Test Email'}
                </Button>

                {testStatus !== 'idle' && testStatus !== 'loading' && (
                  <div
                    className={`flex items-center gap-3 p-4 rounded-lg ${
                      testStatus === 'success'
                        ? 'bg-green-50 text-green-800 border-green-200'
                        : 'bg-red-50 text-red-800 border-red-200'
                    }`}
                  >
                    {testStatus === 'success' ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <AlertCircle className="h-5 w-5" />
                    )}
                    <span>{testMessage}</span>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
