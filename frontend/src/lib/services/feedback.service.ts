const INSFORGE_BASE_URL = 'https://trqnn5z3.us-east.insforge.app';

export interface FeedbackRecord {
  name: string;
  email: string;
  page: string;
  feedback: string;
  screenshots?: string[];
}

export interface CreateFeedbackResponse {
  message: string;
  id?: string;
}

export interface UploadResult {
  url: string;
  key: string;
}

class FeedbackService {
  private getToken(): string {
    return import.meta.env.VITE_PUBLIC_CONTACT_SERVICE_TOKEN || '';
  }

  /**
   * Generate a unique file name to avoid conflicts
   */
  generateUniqueFileName(originalName: string): string {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 8);
    const extension = originalName.substring(originalName.lastIndexOf('.'));
    const nameWithoutExt = originalName.substring(0, originalName.lastIndexOf('.'));
    return `${nameWithoutExt}-${timestamp}-${randomStr}${extension}`;
  }

  /**
   * Upload a screenshot file to InsForge Storage
   */
  async uploadScreenshot(file: File, _fileName?: string): Promise<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(
      `${INSFORGE_BASE_URL}/api/storage/buckets/feedback-screenshots/objects`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.getToken()}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      url: data.url,
      key: data.key,
    };
  }

  /**
   * Create a new feedback record with optional screenshots
   */
  async createFeedback(data: FeedbackRecord): Promise<CreateFeedbackResponse> {
    const response = await fetch(`${INSFORGE_BASE_URL}/api/database/records/page_feedbacks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.getToken()}`,
      },
      body: JSON.stringify({
        name: data.name,
        email: data.email,
        page: data.page,
        feedback: data.feedback,
        screenshots: data.screenshots || [],
      }),
    });

    if (!response.ok) {
      throw new Error(`Create feedback failed: ${response.statusText}`);
    }

    return response.json();
  }
}

export const feedbackService = new FeedbackService();
