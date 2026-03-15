import OpenAI from 'openai';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import logger from '@/utils/logger.js';

export class MiniMaxProvider {
  private static instance: MiniMaxProvider;
  private client: OpenAI | null = null;

  private constructor() {}

  static getInstance(): MiniMaxProvider {
    if (!MiniMaxProvider.instance) {
      MiniMaxProvider.instance = new MiniMaxProvider();
    }
    return MiniMaxProvider.instance;
  }

  /**
   * Create the OpenAI-compatible client for MiniMax API
   */
  private createClient(apiKey: string): OpenAI {
    return new OpenAI({
      baseURL: 'https://api.minimax.io/v1',
      apiKey,
    });
  }

  /**
   * Get MiniMax API key from environment
   */
  async getApiKey(): Promise<string> {
    const apiKey = process.env.MINIMAX_API_KEY;
    if (!apiKey) {
      throw new AppError(
        'MINIMAX_API_KEY not found in environment variables',
        500,
        ERROR_CODES.AI_INVALID_API_KEY
      );
    }
    return apiKey;
  }

  /**
   * Get or create the OpenAI-compatible client
   */
  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      this.client = this.createClient(await this.getApiKey());
    }
    return this.client;
  }

  /**
   * Check if MiniMax is properly configured
   */
  isConfigured(): boolean {
    return !!process.env.MINIMAX_API_KEY;
  }

  /**
   * Send a request to MiniMax API using the OpenAI-compatible client
   * @param request - Function that takes an OpenAI client and returns a Promise
   * @returns The result of the request
   */
  async sendRequest<T>(request: (client: OpenAI) => Promise<T>): Promise<T> {
    const client = await this.getClient();

    try {
      return await request(client);
    } catch (error) {
      logger.error('MiniMax API request failed', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }
}
