import { describe, it, expect } from 'vitest';
import {
  getS3Bucket,
  getS3Key,
  type S3GatewayRequest,
} from '../../src/api/routes/s3-gateway/request';
import { S3ProtocolError } from '../../src/api/routes/s3-gateway/errors';

function makeReq(over: Partial<S3GatewayRequest>): S3GatewayRequest {
  return { s3Bucket: null, s3Key: null, ...over } as S3GatewayRequest;
}

describe('s3-gateway request accessors', () => {
  it('returns the bucket when present', () => {
    expect(getS3Bucket(makeReq({ s3Bucket: 'my-bucket' }))).toBe('my-bucket');
  });

  it('throws an S3 protocol error when the bucket is missing', () => {
    expect(() => getS3Bucket(makeReq({ s3Bucket: null }))).toThrow(S3ProtocolError);
  });

  it('returns the key when present', () => {
    expect(getS3Key(makeReq({ s3Key: 'path/to/object' }))).toBe('path/to/object');
  });

  it('throws an S3 protocol error when the key is missing', () => {
    expect(() => getS3Key(makeReq({ s3Key: null }))).toThrow(S3ProtocolError);
  });
});
