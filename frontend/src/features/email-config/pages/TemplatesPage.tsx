import { useState } from 'react';
import { Card } from '@/components/radix';
import { Button } from '@insforge/ui';
import { Input } from '@insforge/ui';
import { Label } from '@/components/radix';
import { Textarea } from '@/components/radix';
import { Mail, Plus, Trash2, Eye, Save } from 'lucide-react';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody?: string;
  created: string;
  updated: string;
}

const defaultTemplates: EmailTemplate[] = [
  {
    id: 'welcome-email',
    name: 'Welcome Email',
    subject: 'Welcome to {{name}}!',
    htmlBody: `<h1>Welcome {{name}}!</h1>
<p>Thank you for joining us. We're excited to have you on board.</p>
<p>Best regards,<br>The Team</p>`,
    textBody: 'Welcome {{name}}! Thank you for joining us.',
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
  {
    id: 'password-reset',
    name: 'Password Reset',
    subject: 'Reset Your Password',
    htmlBody: `<h1>Reset Your Password</h1>
<p>Hi {{name}},</p>
<p>Click the link below to reset your password:</p>
<p><a href="{{resetLink}}">Reset Password</a></p>
<p>This link will expire in 1 hour.</p>`,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  },
];

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>(defaultTemplates);
  const [selectedTemplate, setSelectedTemplate] = useState<EmailTemplate | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [previewMode, setPreviewMode] = useState<'html' | 'text'>('html');

  const handleCreateTemplate = () => {
    const newTemplate: EmailTemplate = {
      id: `template-${Date.now()}`,
      name: 'New Template',
      subject: 'Email Subject',
      htmlBody: '<h1>Email Content</h1><p>Your content here...</p>',
      textBody: 'Plain text version',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
    };
    setTemplates([...templates, newTemplate]);
    setSelectedTemplate(newTemplate);
    setIsEditing(true);
  };

  const handleSaveTemplate = () => {
    if (!selectedTemplate) return;

    setTemplates(
      templates.map((t) =>
        t.id === selectedTemplate.id
          ? { ...selectedTemplate, updated: new Date().toISOString() }
          : t
      )
    );
    setIsEditing(false);
  };

  const handleDeleteTemplate = (id: string) => {
    setTemplates(templates.filter((t) => t.id !== id));
    if (selectedTemplate?.id === id) {
      setSelectedTemplate(null);
    }
  };

  const availableVariables = ['name', 'email', 'resetLink', 'verificationCode'];

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold mb-2 text-foreground">Email Templates</h1>
          <p className="text-muted-foreground">
            Create and manage email templates with dynamic variables
          </p>
        </div>
        <Button onClick={handleCreateTemplate}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Templates List */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="p-4">
            <h2 className="text-xl font-semibold mb-4 text-foreground">Templates</h2>
            <div className="space-y-2">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedTemplate?.id === template.id
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'hover:bg-muted'
                  }`}
                  onClick={() => setSelectedTemplate(template)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{template.name}</div>
                      <div className="text-sm opacity-70 truncate">{template.subject}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteTemplate(template.id);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="text-xl font-semibold mb-4 text-foreground">Available Variables</h2>
            <div className="space-y-2">
              {availableVariables.map((variable) => (
                <div key={variable} className="flex items-center gap-2 p-2 bg-muted rounded">
                  <code className="text-sm font-mono text-primary">{'{{' + variable + '}}'}</code>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              Use these variables in your templates with {'{{variable}}'} syntax
            </p>
          </Card>
        </div>

        {/* Template Editor */}
        <div className="lg:col-span-2">
          {selectedTemplate ? (
            <Card className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">
                  {isEditing ? 'Edit Template' : selectedTemplate.name}
                </h2>
                <div className="flex gap-2">
                  {isEditing && (
                    <>
                      <Button onClick={handleSaveTemplate}>
                        <Save className="h-4 w-4 mr-2" />
                        Save
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setIsEditing(false);
                          // Reset to original
                          const original = templates.find((t) => t.id === selectedTemplate.id);
                          if (original) setSelectedTemplate(original);
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                  {!isEditing && <Button onClick={() => setIsEditing(true)}>Edit</Button>}
                </div>
              </div>

              <div className="space-y-6">
                {isEditing ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="template-name">Template Name</Label>
                      <Input
                        id="template-name"
                        value={selectedTemplate.name}
                        onChange={(e) =>
                          setSelectedTemplate({ ...selectedTemplate, name: e.target.value })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="template-subject">Subject Line</Label>
                      <Input
                        id="template-subject"
                        value={selectedTemplate.subject}
                        onChange={(e) =>
                          setSelectedTemplate({ ...selectedTemplate, subject: e.target.value })
                        }
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label className="text-sm text-muted-foreground">Template Name</Label>
                      <div className="text-lg font-medium text-foreground">
                        {selectedTemplate.name}
                      </div>
                    </div>
                    <div>
                      <Label className="text-sm text-muted-foreground">Subject</Label>
                      <div className="text-lg text-foreground">{selectedTemplate.subject}</div>
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-foreground">HTML Body</Label>
                    <div className="flex gap-2">
                      <Button
                        variant={previewMode === 'html' ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPreviewMode('html')}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Preview
                      </Button>
                    </div>
                  </div>
                  <Textarea
                    value={selectedTemplate.htmlBody}
                    onChange={(e) =>
                      setSelectedTemplate({ ...selectedTemplate, htmlBody: e.target.value })
                    }
                    disabled={!isEditing}
                    rows={15}
                    className="font-mono text-sm"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-foreground">Plain Text Version (optional)</Label>
                  <Textarea
                    value={selectedTemplate.textBody || ''}
                    onChange={(e) =>
                      setSelectedTemplate({ ...selectedTemplate, textBody: e.target.value })
                    }
                    disabled={!isEditing}
                    rows={4}
                    className="font-mono text-sm"
                  />
                </div>

                {previewMode === 'html' && (
                  <div className="border rounded-lg p-4">
                    <Label className="text-sm text-muted-foreground mb-2">Preview</Label>
                    <div
                      dangerouslySetInnerHTML={{ __html: selectedTemplate.htmlBody }}
                      className="prose prose-sm max-w-none"
                    />
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card className="p-12 text-center">
              <Mail className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No Template Selected</h3>
              <p className="text-muted-foreground">
                Select a template from the list or create a new one to get started
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
