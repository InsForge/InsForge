import { Response } from 'express';
import { toXml } from '../xml.js';
import { S3GatewayRequest } from '../request.js';

export function handle(_req: S3GatewayRequest, res: Response): Promise<void> {
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
