import { Response } from 'express';
import { toXml } from './xml.js';

export type S3ErrorCode =
  | 'SignatureDoesNotMatch'
  | 'InvalidAccessKeyId'
  | 'RequestTimeTooSkewed'
  | 'AuthorizationHeaderMalformed'
  | 'NoSuchBucket'
  | 'NoSuchKey'
  | 'BucketAlreadyOwnedByYou'
  | 'BucketNotEmpty'
  | 'InvalidBucketName'
  | 'EntityTooLarge'
  | 'EntityTooSmall'
  | 'NotImplemented'
  | 'InternalError'
  | 'InvalidRequest'
  | 'InvalidArgument'
  | 'InvalidPart'
  | 'MalformedXML'
  | 'MethodNotAllowed';

const statusMap: Record<S3ErrorCode, number> = {
  SignatureDoesNotMatch: 403,
  InvalidAccessKeyId: 403,
  RequestTimeTooSkewed: 403,
  AuthorizationHeaderMalformed: 400,
  NoSuchBucket: 404,
  NoSuchKey: 404,
  BucketAlreadyOwnedByYou: 409,
  BucketNotEmpty: 409,
  InvalidBucketName: 400,
  EntityTooLarge: 400,
  EntityTooSmall: 400,
  NotImplemented: 501,
  InternalError: 500,
  InvalidRequest: 400,
  InvalidArgument: 400,
  InvalidPart: 400,
  MalformedXML: 400,
  MethodNotAllowed: 405,
};

export function sendS3Error(
  res: Response,
  code: S3ErrorCode,
  message: string,
  opts?: { resource?: string; requestId?: string }
): void {
  const status = statusMap[code];
  const xml = toXml({
    Error: {
      Code: code,
      Message: message,
      Resource: opts?.resource ?? '',
      RequestId: opts?.requestId ?? '',
    },
  });
  res.status(status).type('application/xml').send(xml);
}

export class S3ProtocolError extends Error {
  constructor(
    public readonly code: S3ErrorCode,
    message: string
  ) {
    super(message);
  }
}
