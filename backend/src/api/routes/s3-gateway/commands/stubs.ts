import { Response } from 'express';
import { toXml } from '../xml.js';
import { S3AuthenticatedRequest } from '@/api/middlewares/s3-sigv4.js';

// These stubs don't need async work but the router awaits every handler
// uniformly. Declaring them as Promise-returning (rather than async) keeps
// the call-site shape consistent without tripping require-await.
export function getBucketLocation(_req: S3AuthenticatedRequest, res: Response): Promise<void> {
  res
    .status(200)
    .type('application/xml')
    .send(
      toXml({
        LocationConstraint: {
          $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
          _: 'us-east-2',
        },
      })
    );
  return Promise.resolve();
}

export function getBucketVersioning(_req: S3AuthenticatedRequest, res: Response): Promise<void> {
  res
    .status(200)
    .type('application/xml')
    .send(
      toXml({
        VersioningConfiguration: {
          $: { xmlns: 'http://s3.amazonaws.com/doc/2006-03-01/' },
          Status: 'Disabled',
        },
      })
    );
  return Promise.resolve();
}
