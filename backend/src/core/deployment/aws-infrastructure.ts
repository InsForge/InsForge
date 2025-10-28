/**
 * AWS Infrastructure Manager
 * Manages CloudFront and Route53 configuration for deployments
 */

import {
  CloudFrontClient,
  GetDistributionConfigCommand,
  UpdateDistributionCommand,
  ListDistributionsCommand,
  type DistributionConfig,
  type DistributionSummary,
} from '@aws-sdk/client-cloudfront';
import {
  Route53Client,
  ListHostedZonesByNameCommand,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand,
} from '@aws-sdk/client-route-53';
import { logger } from '@/utils/logger.js';

const DEFAULT_AWS_REGION = 'us-east-1';

export class AWSInfrastructureManager {
  private cloudFrontClient: CloudFrontClient;
  private route53Client: Route53Client;
  private distributionId: string;
  private cloudFrontDomainName: string;
  private domain: string;

  constructor() {
    const cloudFrontUrl = process.env.AWS_CLOUDFRONT_URL;
    const domain = process.env.AWS_CLOUDFRONT_DOMAIN;

    if (!cloudFrontUrl || !domain) {
      throw new Error(
        'AWS_CLOUDFRONT_URL and AWS_CLOUDFRONT_DOMAIN are required for CloudFront deployments'
      );
    }

    // Extract CloudFront domain name from URL
    // Supports: https://d123abc.cloudfront.net or d123abc.cloudfront.net
    const urlMatch = cloudFrontUrl.match(/([a-z0-9]+\.cloudfront\.net)/i);
    if (!urlMatch) {
      throw new Error(`Invalid AWS_CLOUDFRONT_URL format: ${cloudFrontUrl}`);
    }
    const cloudFrontDomainName = urlMatch[1];

    // Distribution ID will be fetched lazily when needed
    this.distributionId = '';
    this.cloudFrontDomainName = cloudFrontDomainName;
    this.domain = domain;

    const awsConfig = {
      region: process.env.AWS_REGION || DEFAULT_AWS_REGION,
      credentials:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
          : undefined,
    };

    this.cloudFrontClient = new CloudFrontClient(awsConfig);
    this.route53Client = new Route53Client(awsConfig);
  }

  /**
   * Add subdomain to CloudFront distribution and create Route53 record
   */
  async addSubdomain(subdomain: string): Promise<void> {
    const fullDomain = `${subdomain}.${this.domain}`;

    try {
      logger.info('Adding subdomain to infrastructure', { subdomain, fullDomain });

      // Get distribution ID if not already fetched
      if (!this.distributionId) {
        await this.fetchDistributionId();
      }

      //  Get hosted zone ID
      const hostedZoneId = await this.getHostedZoneId(this.domain);

      // Check if subdomain already exists and delete it
      await this.removeExistingRecord(hostedZoneId, fullDomain);

      // Get current CloudFront distribution config
      const { config, etag } = await this.getDistributionConfig();

      // Add subdomain to alternate domain names if not already present
      if (!config.Aliases?.Items?.includes(fullDomain)) {
        config.Aliases = config.Aliases || { Quantity: 0, Items: [] };
        config.Aliases.Items = config.Aliases.Items || [];
        config.Aliases.Items.push(fullDomain);
        config.Aliases.Quantity = config.Aliases.Items.length;

        // Update CloudFront distribution
        await this.updateDistribution(config, etag);
        logger.info('Added subdomain to CloudFront', { fullDomain });
      } else {
        logger.info('Subdomain already in CloudFront', { fullDomain });
      }

      // Create Route53 A record pointing to CloudFront
      await this.createRoute53Record(hostedZoneId, fullDomain);

      logger.info('Successfully configured infrastructure', { subdomain, fullDomain });
    } catch (error) {
      logger.error('Failed to add subdomain to infrastructure', {
        subdomain,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error(
        `Failed to configure infrastructure: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Remove subdomain from CloudFront distribution and delete Route53 record
   */
  async removeSubdomain(subdomain: string): Promise<void> {
    const fullDomain = `${subdomain}.${this.domain}`;

    try {
      logger.info('Removing subdomain from infrastructure', { subdomain, fullDomain });

      // Get distribution ID if not already fetched
      if (!this.distributionId) {
        await this.fetchDistributionId();
      }

      // Step 1: Get hosted zone ID
      const hostedZoneId = await this.getHostedZoneId(this.domain);

      // Step 2: Delete Route53 record
      await this.deleteRoute53Record(hostedZoneId, fullDomain);

      // Step 3: Get current CloudFront distribution config
      const { config, etag } = await this.getDistributionConfig();

      // Step 4: Remove subdomain from alternate domain names
      if (config.Aliases?.Items?.includes(fullDomain)) {
        config.Aliases.Items = config.Aliases.Items.filter((item) => item !== fullDomain);
        config.Aliases.Quantity = config.Aliases.Items.length;

        // Update CloudFront distribution
        await this.updateDistribution(config, etag);
        logger.info('Removed subdomain from CloudFront', { fullDomain });
      }

      logger.info('Successfully removed subdomain from infrastructure', { subdomain, fullDomain });
    } catch (error) {
      logger.error('Failed to remove subdomain from infrastructure', {
        subdomain,
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't throw - allow deployment deletion to continue even if cleanup fails
    }
  }

  /**
   * Fetch distribution ID from AWS by domain name
   */
  private async fetchDistributionId(): Promise<void> {
    const command = new ListDistributionsCommand({});
    const response = await this.cloudFrontClient.send(command);

    const distribution = response.DistributionList?.Items?.find(
      (dist: DistributionSummary) => dist.DomainName === this.cloudFrontDomainName
    );

    if (!distribution || !distribution.Id) {
      throw new Error(`CloudFront distribution not found for domain: ${this.cloudFrontDomainName}`);
    }

    this.distributionId = distribution.Id;
    logger.info('Fetched CloudFront distribution ID', {
      distributionId: this.distributionId,
      domainName: this.cloudFrontDomainName,
    });
  }

  /**
   * Get hosted zone ID for domain
   */
  private async getHostedZoneId(domain: string): Promise<string> {
    const command = new ListHostedZonesByNameCommand({
      DNSName: domain,
      MaxItems: 1,
    });

    const response = await this.route53Client.send(command);

    if (!response.HostedZones || response.HostedZones.length === 0) {
      throw new Error(`Hosted zone not found for domain: ${domain}`);
    }

    const hostedZone = response.HostedZones[0];
    if (!hostedZone.Id) {
      throw new Error(`Invalid hosted zone for domain: ${domain}`);
    }

    // Extract ID from /hostedzone/Z1234567890ABC format
    return hostedZone.Id.split('/').pop() || '';
  }

  /**
   * Get CloudFront distribution configuration
   */
  private async getDistributionConfig(): Promise<{ config: DistributionConfig; etag: string }> {
    const command = new GetDistributionConfigCommand({
      Id: this.distributionId,
    });

    const response = await this.cloudFrontClient.send(command);

    if (!response.DistributionConfig || !response.ETag) {
      throw new Error('Failed to get CloudFront distribution config');
    }

    return {
      config: response.DistributionConfig,
      etag: response.ETag,
    };
  }

  /**
   * Update CloudFront distribution
   */
  private async updateDistribution(config: DistributionConfig, etag: string): Promise<void> {
    const command = new UpdateDistributionCommand({
      Id: this.distributionId,
      DistributionConfig: config,
      IfMatch: etag,
    });

    await this.cloudFrontClient.send(command);
    logger.info('CloudFront distribution updated', { distributionId: this.distributionId });
  }

  /**
   * Remove existing Route53 record if it exists
   */
  private async removeExistingRecord(hostedZoneId: string, fullDomain: string): Promise<void> {
    try {
      const listCommand = new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        StartRecordName: fullDomain,
        StartRecordType: 'A',
        MaxItems: 1,
      });

      const listResponse = await this.route53Client.send(listCommand);

      if (
        listResponse.ResourceRecordSets &&
        listResponse.ResourceRecordSets.length > 0 &&
        listResponse.ResourceRecordSets[0].Name === `${fullDomain}.`
      ) {
        await this.deleteRoute53Record(hostedZoneId, fullDomain);
        logger.info('Removed existing Route53 record', { fullDomain });
      }
    } catch {
      // Ignore errors - record might not exist
      logger.debug('No existing record to remove', { fullDomain });
    }
  }

  /**
   * Create Route53 A record pointing to CloudFront
   */
  private async createRoute53Record(hostedZoneId: string, fullDomain: string): Promise<void> {
    const command = new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: fullDomain,
              Type: 'A',
              AliasTarget: {
                HostedZoneId: 'Z2FDTNDATAQYW2', // CloudFront hosted zone ID (constant for all regions)
                DNSName: this.cloudFrontDomainName,
                EvaluateTargetHealth: false,
              },
            },
          },
        ],
      },
    });

    await this.route53Client.send(command);
    logger.info('Created Route53 A record', { fullDomain, dnsName: this.cloudFrontDomainName });
  }

  /**
   * Delete Route53 A record
   */
  private async deleteRoute53Record(hostedZoneId: string, fullDomain: string): Promise<void> {
    const command = new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'DELETE',
            ResourceRecordSet: {
              Name: fullDomain,
              Type: 'A',
              AliasTarget: {
                HostedZoneId: 'Z2FDTNDATAQYW2', // CloudFront hosted zone ID (constant)
                DNSName: this.cloudFrontDomainName,
                EvaluateTargetHealth: false,
              },
            },
          },
        ],
      },
    });

    await this.route53Client.send(command);
    logger.info('Deleted Route53 A record', { fullDomain });
  }
}
