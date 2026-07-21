import OpenAI from 'openai';

import {
  ERROR_CODES,
  type AIModelSchema,
  type ImageGenerationRequest,
  type ImageGenerationResponse,
} from '@insforge/shared-schemas';
import { AppError, UpstreamError } from '@/utils/errors.js';
import logger from '@/utils/logger.js';

type AtlasCloudModelType = 'Text' | 'Image' | string;

interface RawAtlasCloudModel {
  model?: string;
  id?: string;
  type?: AtlasCloudModelType;
  created?: number;
}

interface AtlasCloudModelResponse {
  data?: RawAtlasCloudModel[];
}

interface AtlasCloudTaskResponse {
  data?: unknown;
  id?: string;
  request_id?: string;
  task_id?: string;
}

const ATLASCLOUD_MODEL_PREFIX = 'atlascloud/';
const ATLASCLOUD_MODELS_URL = 'https://api.atlascloud.ai/api/v1/models';
const ATLASCLOUD_DEFAULT_LLM_BASE_URL = 'https://api.atlascloud.ai/v1';
const ATLASCLOUD_DEFAULT_MEDIA_BASE_URL = 'https://api.atlascloud.ai/api/v1';
const IMAGE_POLL_INTERVAL_MS = 1500;
const IMAGE_POLL_TIMEOUT_MS = 120_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function extractTaskId(payload: AtlasCloudTaskResponse): string | undefined {
  const direct =
    getString(payload.id) ?? getString(payload.request_id) ?? getString(payload.task_id);
  if (direct) {
    return direct;
  }
  const data = asObject(payload.data);
  return data
    ? (getString(data.id) ?? getString(data.request_id) ?? getString(data.task_id))
    : undefined;
}

function collectImageUrls(value: unknown, urls = new Set<string>()): string[] {
  if (!value) {
    return Array.from(urls);
  }
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value) || value.startsWith('data:image/')) {
      urls.add(value);
    }
    return Array.from(urls);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectImageUrls(item, urls);
    }
    return Array.from(urls);
  }
  const object = asObject(value);
  if (!object) {
    return Array.from(urls);
  }
  for (const key of ['url', 'image_url', 'imageUrl', 'output_url', 'uri']) {
    collectImageUrls(object[key], urls);
  }
  for (const key of ['data', 'result', 'results', 'output', 'outputs', 'images', 'image']) {
    collectImageUrls(object[key], urls);
  }
  return Array.from(urls);
}

function isCompletedStatus(status: string | undefined): boolean {
  return ['completed', 'succeeded', 'success', 'done', 'finished'].includes(
    status?.toLowerCase() ?? ''
  );
}

function isFailedStatus(status: string | undefined): boolean {
  return ['failed', 'error', 'cancelled', 'canceled'].includes(status?.toLowerCase() ?? '');
}

export class AtlasCloudProvider {
  private static instance: AtlasCloudProvider;
  private atlasCloudClient: OpenAI | null = null;
  private currentApiKey: string | undefined;

  private constructor() {}

  static getInstance(): AtlasCloudProvider {
    if (!AtlasCloudProvider.instance) {
      AtlasCloudProvider.instance = new AtlasCloudProvider();
    }
    return AtlasCloudProvider.instance;
  }

  static isAtlasCloudModel(model: string): boolean {
    return model.startsWith(ATLASCLOUD_MODEL_PREFIX);
  }

  static stripModelPrefix(model: string): string {
    return AtlasCloudProvider.isAtlasCloudModel(model)
      ? model.slice(ATLASCLOUD_MODEL_PREFIX.length)
      : model;
  }

  static toPublicModelId(model: string): string {
    return AtlasCloudProvider.isAtlasCloudModel(model)
      ? model
      : `${ATLASCLOUD_MODEL_PREFIX}${model}`;
  }

  async fetchModels(): Promise<AIModelSchema[]> {
    const response = await fetch(ATLASCLOUD_MODELS_URL, {
      headers: { Accept: 'application/json', 'User-Agent': 'InsForge Model Gateway' },
    });

    if (!response.ok) {
      throw new AppError(
        `Failed to fetch Atlas Cloud models: ${response.statusText}`,
        503,
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }

    const payload = (await response.json()) as AtlasCloudModelResponse;
    return (payload.data ?? [])
      .map((rawModel) => this.mapModel(rawModel))
      .filter((model): model is AIModelSchema => Boolean(model));
  }

  async sendRequest<T>(
    request: (client: OpenAI) => Promise<T>
  ): Promise<{ result: T; source: 'self-hosted' }> {
    const client = this.getClient();

    try {
      return { result: await request(client), source: 'self-hosted' };
    } catch (error) {
      if (error instanceof OpenAI.APIError) {
        if (error.status === 401 || error.status === 403) {
          throw new AppError(
            'Atlas Cloud authentication failed. Check ATLASCLOUD_API_KEY.',
            401,
            ERROR_CODES.AI_INVALID_API_KEY,
            'Set a valid ATLASCLOUD_API_KEY in the self-hosted environment.'
          );
        }
        if (error.status === 429) {
          throw new AppError(
            'Atlas Cloud rate limit exceeded. Please wait before retrying.',
            429,
            ERROR_CODES.RATE_LIMITED,
            'Wait a moment and retry, or check your Atlas Cloud API limits.'
          );
        }
        throw new UpstreamError(
          error,
          'Atlas Cloud request failed.',
          ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
        );
      }

      throw new UpstreamError(
        error,
        'Atlas Cloud request failed.',
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }
  }

  async generateImage(options: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const apiKey = this.getApiKey();
    const model = AtlasCloudProvider.stripModelPrefix(options.model);
    const body: Record<string, unknown> = {
      model,
      prompt: options.prompt,
      enable_sync_mode: false,
      enable_base64_output: false,
    };
    const firstImageUrl = options.images?.[0]?.url;
    if (firstImageUrl) {
      body.image_url = firstImageUrl;
    }

    const taskResponse = await this.fetchJson<AtlasCloudTaskResponse>('/model/generateImage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const taskId = extractTaskId(taskResponse);
    if (!taskId) {
      throw new AppError(
        'Atlas Cloud image generation did not return a task id.',
        502,
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }

    const result = await this.pollImageTask(taskId, apiKey);
    const imageUrls = collectImageUrls(result);
    if (imageUrls.length === 0) {
      throw new AppError(
        'Atlas Cloud image generation completed without image output.',
        502,
        ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
      );
    }

    return {
      images: imageUrls.map((imageUrl) => ({ type: 'imageUrl' as const, imageUrl })),
      metadata: {
        model: options.model,
      },
    };
  }

  private getApiKey(): string {
    const apiKey = process.env.ATLASCLOUD_API_KEY ?? process.env.ATLAS_CLOUD_API_KEY;
    if (!apiKey) {
      throw new AppError(
        'Atlas Cloud API key not configured. Set ATLASCLOUD_API_KEY.',
        500,
        ERROR_CODES.AI_INVALID_API_KEY
      );
    }
    return apiKey;
  }

  private getLlmBaseUrl(): string {
    return process.env.ATLASCLOUD_API_BASE ?? ATLASCLOUD_DEFAULT_LLM_BASE_URL;
  }

  private getMediaBaseUrl(): string {
    return process.env.ATLASCLOUD_MEDIA_API_BASE ?? ATLASCLOUD_DEFAULT_MEDIA_BASE_URL;
  }

  private getClient(): OpenAI {
    const apiKey = this.getApiKey();
    if (!this.atlasCloudClient || this.currentApiKey !== apiKey) {
      this.currentApiKey = apiKey;
      this.atlasCloudClient = new OpenAI({
        baseURL: this.getLlmBaseUrl(),
        apiKey,
        defaultHeaders: {
          'HTTP-Referer': 'https://insforge.dev',
          'X-Title': 'InsForge',
        },
      });
    }
    return this.atlasCloudClient;
  }

  private mapModel(rawModel: RawAtlasCloudModel): AIModelSchema | undefined {
    const modelId = rawModel.model ?? rawModel.id;
    if (!modelId) {
      return undefined;
    }

    if (rawModel.type === 'Text') {
      return {
        id: AtlasCloudProvider.toPublicModelId(modelId),
        created: rawModel.created,
        modelId: AtlasCloudProvider.toPublicModelId(modelId),
        provider: 'atlascloud',
        inputModality: ['text'],
        outputModality: ['text'],
      };
    }

    if (rawModel.type === 'Image') {
      return {
        id: AtlasCloudProvider.toPublicModelId(modelId),
        created: rawModel.created,
        modelId: AtlasCloudProvider.toPublicModelId(modelId),
        provider: 'atlascloud',
        inputModality: modelId.includes('/edit') ? ['text', 'image'] : ['text'],
        outputModality: ['image'],
      };
    }

    return undefined;
  }

  private async pollImageTask(taskId: string, apiKey: string): Promise<unknown> {
    const startedAt = Date.now();
    let latestPayload: unknown;

    while (Date.now() - startedAt < IMAGE_POLL_TIMEOUT_MS) {
      const payload = await this.fetchJson<unknown>(`/model/prediction/${taskId}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      latestPayload = payload;

      const object = asObject(payload);
      const data = asObject(object?.data);
      const status = getString(data?.status) ?? getString(object?.status);
      if (isFailedStatus(status)) {
        throw new AppError(
          'Atlas Cloud image generation failed.',
          502,
          ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
        );
      }
      if (isCompletedStatus(status) || collectImageUrls(payload).length > 0) {
        return payload;
      }

      await delay(IMAGE_POLL_INTERVAL_MS);
    }

    logger.warn('Atlas Cloud image task timed out', { taskId, latestPayload });
    throw new AppError(
      'Atlas Cloud image generation timed out.',
      504,
      ERROR_CODES.AI_UPSTREAM_UNAVAILABLE
    );
  }

  private async fetchJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.getMediaBaseUrl()}${path}`, init);
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AppError(
          'Atlas Cloud authentication failed. Check ATLASCLOUD_API_KEY.',
          401,
          ERROR_CODES.AI_INVALID_API_KEY
        );
      }
      if (response.status === 429) {
        throw new AppError(
          'Atlas Cloud rate limit exceeded. Please wait before retrying.',
          429,
          ERROR_CODES.RATE_LIMITED
        );
      }
      const message =
        (await response.text()) || response.statusText || 'Atlas Cloud request failed';
      throw new AppError(message, response.status, ERROR_CODES.AI_UPSTREAM_UNAVAILABLE);
    }
    return (await response.json()) as T;
  }
}
