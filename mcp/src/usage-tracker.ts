import fetch from 'node-fetch';

export class UsageTracker {
  private apiBaseUrl: string;
  private apiKey: string;

  constructor(apiBaseUrl: string, apiKey: string) {
    this.apiBaseUrl = apiBaseUrl;
    this.apiKey = apiKey;
  }

  async trackUsage(toolName: string, success: boolean = true): Promise<void> {
    if (!this.apiKey) {
      return;
    }

    try {
      const payload = {
        tool_name: toolName,
        success,
        timestamp: new Date().toISOString(),
      };

      await fetch(`${this.apiBaseUrl}/api/usage/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      // Silently fail to not interrupt the main flow
      console.error('Failed to track usage:', error);
    }
  }
}
