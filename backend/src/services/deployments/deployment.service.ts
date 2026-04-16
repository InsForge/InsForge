import { Pool, type PoolClient } from 'pg';
import AdmZip from 'adm-zip';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Transform, type Readable, type TransformCallback } from 'stream';
import { DatabaseManager } from '@/infra/database/database.manager.js';
import {
  VercelProvider,
  type VercelDomainConfig,
} from '@/providers/deployments/vercel.provider.js';
import { S3StorageProvider } from '@/providers/storage/s3.provider.js';
import { AppError } from '@/api/middlewares/error.js';
import { ERROR_CODES } from '@/types/error-constants.js';
import { isCloudEnvironment } from '@/utils/environment.js';
import {
  DeploymentStatus,
  type DeploymentRecord,
  type DeploymentStatusType,
} from '@/types/deployments.js';
import logger from '@/utils/logger.js';
import type {
  CreateDeploymentResponse,
  CreateDirectDeploymentRequest,
  CreateDirectDeploymentResponse,
  DeploymentManifestFile,
  UploadDeploymentFileResponse,
  StartDeploymentRequest,
  UpdateSlugResponse,
  DeploymentMetadataResponse,
  CustomDomain,
  ListCustomDomainsResponse,
  AddCustomDomainResponse,
  VerifyCustomDomainResponse,
} from '@insforge/shared-schemas';

export type {
  DeploymentRecord,
  UpdateSlugResponse,
  DeploymentMetadataResponse,
  CustomDomain,
  ListCustomDomainsResponse,
  AddCustomDomainResponse,
  VerifyCustomDomainResponse,
};

const DEFAULT_MAX_DEPLOYMENT_FILES = 5000;
const DEFAULT_MAX_DEPLOYMENT_TOTAL_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_DEPLOYMENT_FILE_BYTES = 100 * 1024 * 1024;
const DEPLOYMENT_BUCKET = '_deployments';
const getDeploymentKey = (id: string) => `${id}.zip`;

interface DeploymentFileRow {
  fileId: string;
  deploymentId: string;
  path: string;
  sha: string;
  size: number;
  uploadedAt: Date | null;
}

export class DeploymentService {
  private static instance: DeploymentService;
  private pool: Pool | null = null;
  private vercelProvider: VercelProvider;
  private s3Provider: S3StorageProvider | null = null;

  private constructor() {
    this.vercelProvider = VercelProvider.getInstance();
    this.initializeS3Provider();
  }

  private initializeS3Provider(): void {
    const s3Bucket = process.env.AWS_S3_BUCKET;
    const appKey = process.env.APP_KEY || 'local';

    if (s3Bucket) {
      this.s3Provider = new S3StorageProvider(
        s3Bucket,
        appKey,
        process.env.AWS_REGION || 'us-east-2'
      );
      this.s3Provider.initialize();
    }
  }

  public static getInstance(): DeploymentService {
    if (!DeploymentService.instance) {
      DeploymentService.instance = new DeploymentService();
    }
    return DeploymentService.instance;
  }

  private getPool(): Pool {
    if (!this.pool) {
      this.pool = DatabaseManager.getInstance().getPool();
    }
    return this.pool;
  }

  private isReservedHostedDomain(domain: string): boolean {
    return domain.endsWith('.vercel.app') || domain.endsWith('.insforge.site');
  }

  private pickPreferredARecord(config: VercelDomainConfig): string | null {
    const rankOneValues = (config.recommendedIPv4 ?? [])
      .filter((record) => record.rank === 1)
      .flatMap((record) => record.value ?? []);

    if (rankOneValues.length === 0) {
      return null;
    }

    return rankOneValues.find((value) => value === '216.150.16.1') ?? rankOneValues[0];
  }

  private toCustomDomainResponse(
    domain: {
      name: string;
      apexName: string;
      verified: boolean;
      verification?: Array<{ type: string; domain: string; value: string; reason: string }>;
    },
    config: VercelDomainConfig
  ): CustomDomain {
    return {
      domain: domain.name,
      apexDomain: domain.apexName,
      verified: domain.verified,
      misconfigured: config.misconfigured ?? false,
      verification: (domain.verification ?? []).map((record) => ({
        type: record.type,
        domain: record.domain,
        value: record.value,
      })),
      cnameTarget: config.recommendedCNAME?.find((record) => record.rank === 1)?.value ?? null,
      aRecordValue: this.pickPreferredARecord(config),
    };
  }

  private async getCustomDomainConfigOrEmpty(
    configDomain: string,
    requestedDomain: string
  ): Promise<VercelDomainConfig> {
    try {
      return await this.vercelProvider.getCustomDomainConfig(configDomain);
    } catch (error) {
      logger.warn('Vercel domain config lookup failed; continuing without DNS hints', {
        requestedDomain,
        configDomain,
        error: error instanceof Error ? error.message : String(error),
      });
      return {};
    }
  }

  /**
   * Check if deployment service is configured
   * Cloud deployments use credentials from the cloud API.
   * Self-hosted deployments use Vercel credentials from environment variables.
   */
  isConfigured(): boolean {
    return this.vercelProvider.isConfigured();
  }

  private assertDeploymentServiceConfigured(): void {
    if (!this.isConfigured()) {
      throw new AppError(
        'Deployment service is not configured. Please set VERCEL_TOKEN, VERCEL_TEAM_ID, and VERCEL_PROJECT_ID environment variables.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Create a new deployment record with WAITING status
   * Returns presigned S3 upload info for the legacy zip upload flow
   */
  async createDeployment(): Promise<CreateDeploymentResponse> {
    this.assertDeploymentServiceConfigured();

    if (!this.s3Provider) {
      throw new AppError(
        'S3 storage is required for legacy deployments. Please configure AWS_S3_BUCKET.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    try {
      // Create deployment record in database with WAITING status
      const result = await this.getPool().query(
        `INSERT INTO deployments.runs (provider, status, metadata)
         VALUES ($1, $2, $3)
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        ['vercel', DeploymentStatus.WAITING, JSON.stringify({ uploadMode: 'legacy' })]
      );

      const deployment = result.rows[0] as DeploymentRecord;

      const deploymentMaxBytes = this.getMaxDeploymentTotalBytes();
      const uploadInfo = await this.s3Provider.getUploadStrategy(
        DEPLOYMENT_BUCKET,
        getDeploymentKey(deployment.id),
        { size: deploymentMaxBytes },
        deploymentMaxBytes
      );

      logger.info('Deployment record created', {
        id: deployment.id,
        status: deployment.status,
        uploadMode: 'legacy',
      });

      return {
        id: deployment.id,
        uploadUrl: uploadInfo.uploadUrl,
        uploadFields: uploadInfo.fields || {},
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to create deployment', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to create deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Create a new direct-upload deployment record with WAITING status and file manifest
   */
  async createDirectDeployment(
    input: CreateDirectDeploymentRequest
  ): Promise<CreateDirectDeploymentResponse> {
    this.assertDeploymentServiceConfigured();

    try {
      const files = this.validateDeploymentManifest(input.files);
      const totalSizeBytes = files.reduce((sum, file) => sum + file.size, 0);
      const client = await this.getPool().connect();

      try {
        await client.query('BEGIN');

        const result = await client.query(
          `INSERT INTO deployments.runs (provider, status, metadata)
           VALUES ($1, $2, $3)
           RETURNING
             id,
             provider_deployment_id as "providerDeploymentId",
             provider,
             status,
             url,
             metadata,
             created_at as "createdAt",
             updated_at as "updatedAt"`,
          [
            'vercel',
            DeploymentStatus.WAITING,
            JSON.stringify({
              uploadMode: 'direct',
              fileCount: files.length,
              totalSizeBytes,
              manifestCreatedAt: new Date().toISOString(),
            }),
          ]
        );

        const deployment = result.rows[0] as DeploymentRecord;
        const insertedFiles = await this.insertDeploymentFiles(client, deployment.id, files);

        await client.query('COMMIT');

        logger.info('Direct deployment record created', {
          id: deployment.id,
          status: deployment.status,
          fileCount: files.length,
          totalSizeBytes,
        });

        return {
          id: deployment.id,
          status: deployment.status,
          files: insertedFiles.map((row) => this.toDeploymentFileResponse(row)),
        };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to create direct deployment', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to create direct deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Stream one registered deployment file through the backend to Vercel.
   */
  async uploadDeploymentFileContent(
    id: string,
    fileId: string,
    content: Readable,
    options: { signal?: AbortSignal } = {}
  ): Promise<UploadDeploymentFileResponse> {
    this.assertDeploymentServiceConfigured();

    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
      }

      if (
        deployment.status !== DeploymentStatus.WAITING &&
        deployment.status !== DeploymentStatus.UPLOADING
      ) {
        throw new AppError(
          `Deployment files can only be uploaded while status is WAITING or UPLOADING. Current status: ${deployment.status}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const file = await this.getDeploymentFileById(id, fileId);

      if (!file) {
        throw new AppError(`Deployment file not found: ${fileId}`, 404, ERROR_CODES.NOT_FOUND);
      }

      if (this.getUploadMode(deployment, 1) !== 'direct') {
        throw new AppError(
          'Deployment files can only be uploaded for direct deployments.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING, {
        lastFileUploadStartedAt: new Date().toISOString(),
      });

      await this.vercelProvider.uploadFileStream({
        content: this.createValidatedFileStream(content, file.sha, file.size),
        sha: file.sha,
        size: file.size,
        signal: options.signal,
      });

      const updateResult = await this.getPool().query<DeploymentFileRow>(
        `UPDATE deployments.files
         SET uploaded_at = NOW()
         WHERE deployment_id = $1 AND id = $2
         RETURNING
           id as "fileId",
           deployment_id as "deploymentId",
           file_path as "path",
           sha,
           size_bytes as "size",
           uploaded_at as "uploadedAt"`,
        [id, fileId]
      );

      const uploadedFile = updateResult.rows[0];
      if (!uploadedFile?.uploadedAt) {
        throw new AppError(
          'Failed to mark deployment file as uploaded',
          500,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING, {
        lastFileUploadedAt: new Date().toISOString(),
      });

      logger.info('Deployment file uploaded', {
        deploymentId: id,
        fileId,
        path: uploadedFile.path,
        size: uploadedFile.size,
      });

      const response = this.toDeploymentFileResponse(uploadedFile);
      return {
        ...response,
        uploadedAt: response.uploadedAt ?? uploadedFile.uploadedAt.toISOString(),
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      logger.error('Failed to upload deployment file', {
        error: error instanceof Error ? error.message : String(error),
        id,
        fileId,
      });
      throw new AppError('Failed to upload deployment file', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Start a deployment - create deployment on Vercel from uploaded file SHAs
   */
  async startDeployment(id: string, input: StartDeploymentRequest = {}): Promise<DeploymentRecord> {
    this.assertDeploymentServiceConfigured();

    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
      }

      if (
        deployment.status !== DeploymentStatus.WAITING &&
        deployment.status !== DeploymentStatus.UPLOADING
      ) {
        throw new AppError(
          `Deployment is not ready to start. Current status: ${deployment.status}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      const files = await this.getDeploymentFiles(id);
      const uploadMode = this.getUploadMode(deployment, files.length);

      if (uploadMode === 'direct') {
        return await this.startDirectDeployment(id, input, files);
      }

      return await this.startLegacyDeployment(id, input);
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to start deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      // Update status to ERROR
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: error instanceof Error ? error.message : 'Unknown error',
      }).catch(() => {});
      throw new AppError('Failed to start deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  private getUploadMode(
    deployment: DeploymentRecord,
    registeredFileCount: number = 0
  ): 'direct' | 'legacy' {
    const uploadMode = deployment.metadata?.uploadMode;
    if (uploadMode === 'direct' || uploadMode === 'legacy') {
      return uploadMode;
    }

    return registeredFileCount > 0 ? 'direct' : 'legacy';
  }

  private async startDirectDeployment(
    id: string,
    input: StartDeploymentRequest,
    files: DeploymentFileRow[]
  ): Promise<DeploymentRecord> {
    if (files.length === 0) {
      throw new AppError(
        'Deployment files have not been registered.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const missingFiles = files.filter((file) => !file.uploadedAt);
    if (missingFiles.length > 0) {
      throw new AppError(
        `Deployment has ${missingFiles.length} file(s) that have not been uploaded yet.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING);

    if (input.envVars && input.envVars.length > 0) {
      await this.vercelProvider.upsertEnvironmentVariables(input.envVars);
    }

    const uploadedFiles = files.map((file) => ({
      file: file.path,
      sha: file.sha,
      size: file.size,
    }));

    return await this.createVercelDeploymentFromUploadedFiles(id, input, uploadedFiles, 'direct');
  }

  private async startLegacyDeployment(
    id: string,
    input: StartDeploymentRequest
  ): Promise<DeploymentRecord> {
    if (!this.s3Provider) {
      throw new AppError(
        'S3 storage is required for legacy deployments. Please configure AWS_S3_BUCKET.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    await this.updateDeploymentStatus(id, DeploymentStatus.UPLOADING);

    const { exists: zipExists } = await this.s3Provider.verifyObjectExists(
      DEPLOYMENT_BUCKET,
      getDeploymentKey(id)
    );
    if (!zipExists) {
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: 'Source zip file not found. Please upload the source files first.',
      });
      throw new AppError(
        'Source zip file not found. Please upload the source files first.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const zipBuffer = await this.s3Provider.getObject(DEPLOYMENT_BUCKET, getDeploymentKey(id));
    if (!zipBuffer) {
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: 'Failed to download source zip file.',
      });
      throw new AppError('Failed to download source zip file.', 500, ERROR_CODES.INTERNAL_ERROR);
    }

    const files = this.extractFilesFromZip(zipBuffer);
    if (files.length === 0) {
      await this.updateDeploymentStatus(id, DeploymentStatus.ERROR, {
        error: 'No files found in source zip.',
      });
      throw new AppError('No files found in source zip.', 400, ERROR_CODES.INVALID_INPUT);
    }

    if (input.envVars && input.envVars.length > 0) {
      await this.vercelProvider.upsertEnvironmentVariables(input.envVars);
    }

    const uploadedFiles = await this.vercelProvider.uploadFiles(files);
    const deployment = await this.createVercelDeploymentFromUploadedFiles(
      id,
      input,
      uploadedFiles,
      'legacy'
    );

    await this.s3Provider.deleteObject(DEPLOYMENT_BUCKET, getDeploymentKey(id)).catch((error) => {
      logger.warn('Failed to clean up deployment zip', {
        deploymentId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return deployment;
  }

  private extractFilesFromZip(zipBuffer: Buffer): Array<{ path: string; content: Buffer }> {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();
    const files: Array<{ path: string; content: Buffer }> = [];

    for (const entry of entries) {
      if (entry.isDirectory) {
        continue;
      }

      let filePath = entry.entryName;
      filePath = filePath.replace(/\\/g, '/');
      while (filePath.startsWith('/')) {
        filePath = filePath.substring(1);
      }
      while (filePath.startsWith('./')) {
        filePath = filePath.substring(2);
      }

      files.push({
        path: this.normalizeDeploymentFilePath(filePath),
        content: entry.getData(),
      });
    }

    return files;
  }

  private async createVercelDeploymentFromUploadedFiles(
    id: string,
    input: StartDeploymentRequest,
    uploadedFiles: Array<{ file: string; sha: string; size: number }>,
    uploadMode: 'direct' | 'legacy'
  ): Promise<DeploymentRecord> {
    const totalSizeBytes = uploadedFiles.reduce((sum, file) => sum + file.size, 0);

    const vercelDeployment = await this.vercelProvider.createDeploymentWithFiles(uploadedFiles, {
      projectSettings: input.projectSettings,
      meta: input.meta,
    });

    const vercelStatus = (
      vercelDeployment.readyState ||
      vercelDeployment.state ||
      'BUILDING'
    ).toUpperCase();

    const envVarKeys = await this.vercelProvider.getEnvironmentVariableKeys();

    const updateResult = await this.getPool().query(
      `UPDATE deployments.runs
       SET provider_deployment_id = $1,
           status = $2,
           url = $3,
           metadata = COALESCE(metadata, '{}'::jsonb) || $4::jsonb
       WHERE id = $5
       RETURNING
         id,
         provider_deployment_id as "providerDeploymentId",
         provider,
         status,
         url,
         metadata,
         created_at as "createdAt",
         updated_at as "updatedAt"`,
      [
        vercelDeployment.id,
        vercelStatus,
        this.getDeploymentUrl(vercelDeployment.url),
        JSON.stringify({
          vercelName: vercelDeployment.name,
          fileCount: uploadedFiles.length,
          totalSizeBytes,
          envVarKeys,
          uploadMode,
          startedAt: new Date().toISOString(),
        }),
        id,
      ]
    );

    logger.info('Deployment started', {
      id,
      providerDeploymentId: vercelDeployment.id,
      status: vercelStatus,
      uploadMode,
    });

    return updateResult.rows[0] as DeploymentRecord;
  }

  /**
   * Get the deployment URL - uses custom domain if APP_KEY is set, otherwise falls back to provider URL
   */
  private getDeploymentUrl(providerUrl: string | null): string | null {
    const appKey = process.env.APP_KEY;
    if (appKey) {
      return `https://${appKey}.insforge.site`;
    }
    return providerUrl;
  }

  private getPositiveIntegerEnv(name: string, fallback: number): number {
    const parsed = Number.parseInt(process.env[name] ?? '', 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
  }

  private getMaxDeploymentFiles(): number {
    return this.getPositiveIntegerEnv('MAX_DEPLOYMENT_FILES', DEFAULT_MAX_DEPLOYMENT_FILES);
  }

  private getMaxDeploymentTotalBytes(): number {
    return this.getPositiveIntegerEnv(
      'MAX_DEPLOYMENT_TOTAL_BYTES',
      DEFAULT_MAX_DEPLOYMENT_TOTAL_BYTES
    );
  }

  private getMaxDeploymentFileBytes(): number {
    return this.getPositiveIntegerEnv(
      'MAX_DEPLOYMENT_FILE_BYTES',
      DEFAULT_MAX_DEPLOYMENT_FILE_BYTES
    );
  }

  private normalizeDeploymentFilePath(filePath: string): string {
    if (filePath.includes('\0')) {
      throw new AppError(
        'Deployment file path cannot contain null bytes.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    if (filePath.includes('\\')) {
      throw new AppError(
        'Deployment file path must use forward slashes.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }
    if (filePath.startsWith('/')) {
      throw new AppError('Deployment file path must be relative.', 400, ERROR_CODES.INVALID_INPUT);
    }

    const parts = filePath.split('/');
    if (parts.some((part) => part === '' || part === '.' || part === '..')) {
      throw new AppError(
        'Deployment file path cannot contain empty, current, or parent directory segments.',
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    return filePath;
  }

  private validateDeploymentManifest(
    files: CreateDirectDeploymentRequest['files']
  ): CreateDirectDeploymentRequest['files'] {
    const maxFiles = this.getMaxDeploymentFiles();
    const maxTotalBytes = this.getMaxDeploymentTotalBytes();
    const maxFileBytes = this.getMaxDeploymentFileBytes();

    if (files.length > maxFiles) {
      throw new AppError(
        `Deployment files exceed the maximum of ${maxFiles} files.`,
        400,
        ERROR_CODES.INVALID_INPUT
      );
    }

    const seenPaths = new Set<string>();
    let totalSizeBytes = 0;

    return files.map((file) => {
      const normalizedPath = this.normalizeDeploymentFilePath(file.path);

      if (seenPaths.has(normalizedPath)) {
        throw new AppError(
          `Duplicate deployment file path: ${normalizedPath}`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }
      seenPaths.add(normalizedPath);

      if (file.size > maxFileBytes) {
        throw new AppError(
          `Deployment file ${normalizedPath} exceeds the maximum size of ${maxFileBytes} bytes.`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      totalSizeBytes += file.size;
      if (totalSizeBytes > maxTotalBytes) {
        throw new AppError(
          `Deployment files exceed the maximum total size of ${maxTotalBytes} bytes.`,
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      return {
        path: normalizedPath,
        sha: file.sha.toLowerCase(),
        size: file.size,
      };
    });
  }

  private async insertDeploymentFiles(
    client: PoolClient,
    deploymentId: string,
    files: CreateDirectDeploymentRequest['files']
  ): Promise<DeploymentFileRow[]> {
    const insertResult = await client.query<DeploymentFileRow>(
      `INSERT INTO deployments.files (deployment_id, file_path, sha, size_bytes)
       SELECT $1::uuid, file_input.file_path, file_input.sha, file_input.size_bytes
       FROM unnest($2::text[], $3::text[], $4::int[]) AS file_input(file_path, sha, size_bytes)
       RETURNING
         id as "fileId",
         deployment_id as "deploymentId",
         file_path as "path",
         sha,
         size_bytes as "size",
         uploaded_at as "uploadedAt"`,
      [
        deploymentId,
        files.map((file) => file.path),
        files.map((file) => file.sha),
        files.map((file) => file.size),
      ]
    );

    return insertResult.rows;
  }

  private toDeploymentFileResponse(row: DeploymentFileRow): DeploymentManifestFile {
    return {
      fileId: row.fileId,
      path: row.path,
      sha: row.sha,
      size: row.size,
      uploadedAt: row.uploadedAt ? row.uploadedAt.toISOString() : null,
    };
  }

  private createFileValidationTransform(expectedSha: string, expectedSize: number): Transform {
    const hash = crypto.createHash('sha1');
    let receivedBytes = 0;

    return new Transform({
      transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback) {
        receivedBytes += chunk.length;

        if (receivedBytes > expectedSize) {
          callback(
            new AppError(
              'Uploaded file is larger than the registered deployment file size.',
              400,
              ERROR_CODES.INVALID_INPUT
            )
          );
          return;
        }

        hash.update(chunk);
        callback(null, chunk);
      },
      flush(callback: TransformCallback) {
        if (receivedBytes !== expectedSize) {
          callback(
            new AppError(
              'Uploaded file size does not match the registered deployment file.',
              400,
              ERROR_CODES.INVALID_INPUT
            )
          );
          return;
        }

        const actualSha = hash.digest('hex');
        if (actualSha !== expectedSha) {
          callback(
            new AppError(
              'Uploaded file content does not match the registered deployment file.',
              400,
              ERROR_CODES.INVALID_INPUT
            )
          );
          return;
        }

        callback();
      },
    });
  }

  private createValidatedFileStream(
    content: Readable,
    expectedSha: string,
    expectedSize: number
  ): Readable {
    return content.pipe(this.createFileValidationTransform(expectedSha, expectedSize));
  }

  private async getDeploymentFileById(
    deploymentId: string,
    fileId: string
  ): Promise<DeploymentFileRow | null> {
    const result = await this.getPool().query<DeploymentFileRow>(
      `SELECT
         id as "fileId",
         deployment_id as "deploymentId",
         file_path as "path",
         sha,
         size_bytes as "size",
         uploaded_at as "uploadedAt"
       FROM deployments.files
       WHERE deployment_id = $1 AND id = $2`,
      [deploymentId, fileId]
    );

    return result.rows[0] ?? null;
  }

  private async getDeploymentFiles(deploymentId: string): Promise<DeploymentFileRow[]> {
    const result = await this.getPool().query<DeploymentFileRow>(
      `SELECT
         id as "fileId",
         deployment_id as "deploymentId",
         file_path as "path",
         sha,
         size_bytes as "size",
         uploaded_at as "uploadedAt"
       FROM deployments.files
       WHERE deployment_id = $1
       ORDER BY file_path ASC`,
      [deploymentId]
    );

    return result.rows;
  }

  /**
   * Update deployment status
   */
  private async updateDeploymentStatus(
    id: string,
    status: DeploymentStatusType,
    additionalMetadata?: Record<string, unknown>
  ): Promise<void> {
    const metadataUpdate = additionalMetadata
      ? `, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb`
      : '';
    const params = additionalMetadata
      ? [status, id, JSON.stringify(additionalMetadata)]
      : [status, id];

    await this.getPool().query(
      `UPDATE deployments.runs SET status = $1${metadataUpdate} WHERE id = $2`,
      params
    );
  }

  /**
   * Get deployment by database ID
   */
  async getDeploymentById(id: string): Promise<DeploymentRecord | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          provider_deployment_id as "providerDeploymentId",
          provider,
          status,
          url,
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM deployments.runs
         WHERE id = $1`,
        [id]
      );

      if (!result.rows.length) {
        return null;
      }

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to get deployment by ID', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to get deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment by Vercel deployment ID
   */
  async getDeploymentByVercelId(vercelDeploymentId: string): Promise<DeploymentRecord | null> {
    try {
      const result = await this.getPool().query(
        `SELECT
          id,
          provider_deployment_id as "providerDeploymentId",
          provider,
          status,
          url,
          metadata,
          created_at as "createdAt",
          updated_at as "updatedAt"
         FROM deployments.runs
         WHERE provider_deployment_id = $1`,
        [vercelDeploymentId]
      );

      if (!result.rows.length) {
        return null;
      }

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to get deployment by Vercel ID', {
        error: error instanceof Error ? error.message : String(error),
        vercelDeploymentId,
      });
      throw new AppError('Failed to get deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Sync deployment status from provider and update database
   */
  async syncDeploymentById(id: string): Promise<DeploymentRecord | null> {
    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        return null;
      }

      if (!deployment.providerDeploymentId) {
        throw new AppError(
          'Cannot sync deployment: no provider deployment ID yet. Deployment may still be in WAITING status.',
          400,
          ERROR_CODES.INVALID_INPUT
        );
      }

      // Fetch latest status from Vercel
      const vercelDeployment = await this.vercelProvider.getDeployment(
        deployment.providerDeploymentId
      );

      // Use Vercel's status directly (uppercase to match our enum)
      const vercelStatus = (
        vercelDeployment.readyState ||
        vercelDeployment.state ||
        'BUILDING'
      ).toUpperCase();

      // Update database with latest status
      const result = await this.getPool().query(
        `UPDATE deployments.runs
         SET status = $1, url = $2, metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE id = $4
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          vercelStatus,
          this.getDeploymentUrl(vercelDeployment.url),
          JSON.stringify({
            lastSyncedAt: new Date().toISOString(),
            ...(vercelDeployment.error && { error: vercelDeployment.error }),
          }),
          id,
        ]
      );

      logger.info('Deployment synced', { id, status: vercelStatus });

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to sync deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to sync deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * List all deployments with total count for pagination
   */
  async listDeployments(
    limit: number = 50,
    offset: number = 0
  ): Promise<{ deployments: DeploymentRecord[]; total: number }> {
    try {
      const [dataResult, countResult] = await Promise.all([
        this.getPool().query(
          `SELECT
            id,
            provider_deployment_id as "providerDeploymentId",
            provider,
            status,
            url,
            metadata,
            created_at as "createdAt",
            updated_at as "updatedAt"
           FROM deployments.runs
           ORDER BY created_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        ),
        this.getPool().query(`SELECT COUNT(*)::int as count FROM deployments.runs`),
      ]);

      return {
        deployments: dataResult.rows,
        total: countResult.rows[0]?.count ?? 0,
      };
    } catch (error) {
      logger.error('Failed to list deployments', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to list deployments', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Cancel a deployment by database ID
   */
  async cancelDeploymentById(id: string): Promise<void> {
    try {
      const deployment = await this.getDeploymentById(id);

      if (!deployment) {
        throw new AppError(`Deployment not found: ${id}`, 404, ERROR_CODES.NOT_FOUND);
      }

      // If deployment has a Vercel ID, cancel it on Vercel
      if (deployment.providerDeploymentId) {
        await this.vercelProvider.cancelDeployment(deployment.providerDeploymentId);
      }

      if (
        deployment.status === DeploymentStatus.WAITING &&
        this.getUploadMode(deployment) === 'legacy' &&
        this.s3Provider
      ) {
        await this.s3Provider
          .deleteObject(DEPLOYMENT_BUCKET, getDeploymentKey(id))
          .catch((error) => {
            logger.warn('Failed to clean up deployment zip on cancel', {
              id,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }

      await this.getPool().query(
        `UPDATE deployments.runs
         SET status = $1
         WHERE id = $2`,
        [DeploymentStatus.CANCELED, id]
      );

      logger.info('Deployment cancelled', {
        id,
        providerDeploymentId: deployment.providerDeploymentId,
      });
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to cancel deployment', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      throw new AppError('Failed to cancel deployment', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Update deployment status from webhook event
   * Uses Vercel deployment ID to find the deployment
   *
   * Note: For ERROR status, we fetch deployment details from Vercel API
   * to get error information since webhooks don't include error reasons.
   */
  async updateDeploymentFromWebhook(
    vercelDeploymentId: string,
    status: string,
    url: string | null,
    webhookMetadata: Record<string, unknown>
  ): Promise<DeploymentRecord | null> {
    try {
      // For ERROR status, fetch deployment details to get error information
      // Vercel webhooks don't include error reasons in the payload
      let errorInfo: { errorCode?: string; errorMessage?: string } | undefined;
      if (status === 'ERROR') {
        try {
          const vercelDeployment = await this.vercelProvider.getDeployment(vercelDeploymentId);
          if (vercelDeployment.error) {
            errorInfo = {
              errorCode: vercelDeployment.error.code,
              errorMessage: vercelDeployment.error.message,
            };
            logger.info('Fetched error details from Vercel API', {
              vercelDeploymentId,
              errorCode: errorInfo.errorCode,
            });
          }
        } catch (fetchError) {
          // Log but don't fail the webhook update if we can't fetch error details
          logger.warn('Failed to fetch error details from Vercel API', {
            vercelDeploymentId,
            error: fetchError instanceof Error ? fetchError.message : String(fetchError),
          });
        }
      }

      const result = await this.getPool().query(
        `UPDATE deployments.runs
         SET status = $1, url = COALESCE($2, url), metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb
         WHERE provider_deployment_id = $4
         RETURNING
           id,
           provider_deployment_id as "providerDeploymentId",
           provider,
           status,
           url,
           metadata,
           created_at as "createdAt",
           updated_at as "updatedAt"`,
        [
          status,
          this.getDeploymentUrl(url),
          JSON.stringify({
            lastWebhookAt: new Date().toISOString(),
            ...webhookMetadata,
            ...(errorInfo && { error: errorInfo }),
          }),
          vercelDeploymentId,
        ]
      );

      if (!result.rows.length) {
        logger.warn('Deployment not found for webhook update', { vercelDeploymentId });
        return null;
      }

      logger.info('Deployment updated from webhook', {
        vercelDeploymentId,
        status,
        ...(errorInfo && { errorCode: errorInfo.errorCode }),
      });

      return result.rows[0] as DeploymentRecord;
    } catch (error) {
      logger.error('Failed to update deployment from webhook', {
        error: error instanceof Error ? error.message : String(error),
        vercelDeploymentId,
      });
      throw new AppError(
        'Failed to update deployment from webhook',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }
  }

  /**
   * Update the custom slug for the project
   * Calls cloud API: PUT /sites/v1/:projectId/slug
   */
  async updateSlug(slug: string | null): Promise<UpdateSlugResponse> {
    if (!isCloudEnvironment()) {
      throw new AppError(
        'Custom slugs are only available in cloud environment.',
        503,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const projectId = process.env.PROJECT_ID;
    if (!projectId) {
      throw new AppError(
        'PROJECT_ID not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new AppError(
        'JWT_SECRET not found in environment variables',
        500,
        ERROR_CODES.INTERNAL_ERROR
      );
    }

    try {
      const signature = jwt.sign({ projectId }, jwtSecret, { expiresIn: '1h' });
      const cloudApiHost = process.env.CLOUD_API_HOST || 'https://api.insforge.dev';

      const response = await fetch(`${cloudApiHost}/sites/v1/${projectId}/slug`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sign: signature,
          slug: slug,
        }),
      });

      if (response.status === 409) {
        const errorData = (await response.json()) as { error?: string };
        throw new AppError(
          errorData.error || 'Slug is already taken',
          409,
          ERROR_CODES.ALREADY_EXISTS
        );
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new AppError(
          `Failed to update slug: ${response.statusText} - ${errorText}`,
          response.status,
          ERROR_CODES.INTERNAL_ERROR
        );
      }

      const data = (await response.json()) as UpdateSlugResponse;

      // Update cached slug in VercelProvider so subsequent calls get the correct value
      this.vercelProvider.updateCachedSlug(data.slug);

      logger.info('Custom domain slug updated', {
        projectId,
        slug: data.slug,
        domain: data.domain,
      });

      return data;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to update slug', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to update slug', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  // ============================================================================
  // Custom Domain Management (user-owned domains)
  // ============================================================================

  /**
   * Add a user-owned custom domain on Vercel and return DNS instructions
   */
  async addCustomDomain(domain: string): Promise<AddCustomDomainResponse> {
    this.assertDeploymentServiceConfigured();

    const vercelData = await this.vercelProvider.addCustomDomain(domain);
    const config = await this.getCustomDomainConfigOrEmpty(vercelData.name, domain);

    logger.info('Custom domain added', { domain, verified: vercelData.verified });
    return this.toCustomDomainResponse(vercelData, config);
  }

  /**
   * List all custom domains
   */
  async listCustomDomains(): Promise<ListCustomDomainsResponse> {
    this.assertDeploymentServiceConfigured();

    try {
      const domains = (await this.vercelProvider.listCustomDomains()).filter(
        (domain) => !this.isReservedHostedDomain(domain.name)
      );
      const configs = new Map(
        await Promise.all(
          domains.map(
            async (domain) =>
              [
                domain.name,
                await this.getCustomDomainConfigOrEmpty(domain.name, domain.name),
              ] as const
          )
        )
      );

      return {
        domains: domains.map((domain) =>
          this.toCustomDomainResponse(domain, configs.get(domain.name) ?? {})
        ),
      };
    } catch (error) {
      logger.error('Failed to list custom domains', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to list custom domains', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Remove a custom domain directly from Vercel
   */
  async removeCustomDomain(domain: string): Promise<void> {
    this.assertDeploymentServiceConfigured();

    await this.vercelProvider.removeCustomDomain(domain);

    logger.info('Custom domain removed', { domain });
  }

  /**
   * Re-verify a custom domain's DNS configuration via Vercel
   */
  async verifyCustomDomain(domain: string): Promise<VerifyCustomDomainResponse> {
    this.assertDeploymentServiceConfigured();

    try {
      const [vercelResult, projectDomain] = await Promise.all([
        this.vercelProvider.verifyCustomDomain(domain),
        this.vercelProvider.getCustomDomain(domain),
      ]);

      logger.info('Custom domain verification result', { domain, verified: vercelResult.verified });

      const config = await this.getCustomDomainConfigOrEmpty(domain, domain);

      return this.toCustomDomainResponse(
        {
          name: domain,
          apexName: projectDomain.apexName,
          verified: vercelResult.verified,
          verification: vercelResult.verification,
        },
        config
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to verify custom domain', {
        error: error instanceof Error ? error.message : String(error),
        domain,
      });
      throw new AppError('Failed to verify custom domain', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }

  /**
   * Get deployment metadata including current deployment and domain URLs
   */
  async getMetadata(): Promise<DeploymentMetadataResponse> {
    try {
      // Get the latest READY deployment
      const result = await this.getPool().query(
        `SELECT
          id,
          url
         FROM deployments.runs
         WHERE status = 'READY'
         ORDER BY created_at DESC
         LIMIT 1`
      );

      const latestReadyDeployment = result.rows[0] as
        | { id: string; url: string | null }
        | undefined;

      // Get the custom domain URL from Vercel provider (which has the slug from cloud credentials)
      const customDomainUrl = await this.vercelProvider.getCustomDomainUrl();

      return {
        currentDeploymentId: latestReadyDeployment?.id ?? null,
        defaultDomainUrl: latestReadyDeployment?.url ?? null,
        customDomainUrl,
      };
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      logger.error('Failed to get deployment metadata', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new AppError('Failed to get deployment metadata', 500, ERROR_CODES.INTERNAL_ERROR);
    }
  }
}
