import { describe, it, expect } from 'vitest';
import { dispatchOp, parseBucketAndKey } from '@/api/routes/s3-gateway/dispatch.js';

function make(method: string, pathPlusQuery: string, headers: Record<string, string> = {}) {
  const [path, qs = ''] = pathPlusQuery.split('?');
  const query: Record<string, string> = {};
  for (const pair of qs.split('&').filter(Boolean)) {
    const [k, v = ''] = pair.split('=');
    query[k] = decodeURIComponent(v);
  }
  return { method, path, query, headers };
}

describe('dispatchOp', () => {
  it('ListBuckets', () => expect(dispatchOp(make('GET', '/'))).toBe('ListBuckets'));
  it('CreateBucket', () => expect(dispatchOp(make('PUT', '/mybucket'))).toBe('CreateBucket'));
  it('DeleteBucket', () => expect(dispatchOp(make('DELETE', '/mybucket'))).toBe('DeleteBucket'));
  it('HeadBucket', () => expect(dispatchOp(make('HEAD', '/mybucket'))).toBe('HeadBucket'));
  it('ListObjectsV2 explicit', () =>
    expect(dispatchOp(make('GET', '/mybucket?list-type=2'))).toBe('ListObjectsV2'));
  it('ListObjectsV2 default', () =>
    expect(dispatchOp(make('GET', '/mybucket'))).toBe('ListObjectsV2'));
  it('PutObject', () => expect(dispatchOp(make('PUT', '/mybucket/key.jpg'))).toBe('PutObject'));
  it('CopyObject', () =>
    expect(dispatchOp(make('PUT', '/mybucket/key.jpg', { 'x-amz-copy-source': '/src/k' }))).toBe(
      'CopyObject'
    ));
  it('UploadPart', () =>
    expect(dispatchOp(make('PUT', '/mybucket/key.jpg?partNumber=3&uploadId=X'))).toBe(
      'UploadPart'
    ));
  it('CreateMultipartUpload', () =>
    expect(dispatchOp(make('POST', '/mybucket/key.jpg?uploads'))).toBe('CreateMultipartUpload'));
  it('CompleteMultipartUpload', () =>
    expect(dispatchOp(make('POST', '/mybucket/key.jpg?uploadId=X'))).toBe(
      'CompleteMultipartUpload'
    ));
  it('DeleteObjects', () =>
    expect(dispatchOp(make('POST', '/mybucket?delete'))).toBe('DeleteObjects'));
  it('DeleteObject', () => expect(dispatchOp(make('DELETE', '/mybucket/k'))).toBe('DeleteObject'));
  it('AbortMultipartUpload', () =>
    expect(dispatchOp(make('DELETE', '/mybucket/k?uploadId=X'))).toBe('AbortMultipartUpload'));
  it('GetObject', () => expect(dispatchOp(make('GET', '/mybucket/k'))).toBe('GetObject'));
  it('ListParts', () =>
    expect(dispatchOp(make('GET', '/mybucket/k?uploadId=X'))).toBe('ListParts'));
  it('HeadObject', () => expect(dispatchOp(make('HEAD', '/mybucket/k'))).toBe('HeadObject'));
  it('GetBucketLocation stub', () =>
    expect(dispatchOp(make('GET', '/mybucket?location'))).toBe('GetBucketLocation'));
  it('GetBucketVersioning stub', () =>
    expect(dispatchOp(make('GET', '/mybucket?versioning'))).toBe('GetBucketVersioning'));
  it('unknown method → null', () => expect(dispatchOp(make('PATCH', '/mybucket/k'))).toBeNull());
  it('unknown POST without delete/uploads → null', () =>
    expect(dispatchOp(make('POST', '/mybucket/k'))).toBeNull());
});

describe('parseBucketAndKey', () => {
  it('root → null,null', () => expect(parseBucketAndKey('/')).toEqual({ bucket: null, key: null }));
  it('bucket only', () =>
    expect(parseBucketAndKey('/mybucket')).toEqual({ bucket: 'mybucket', key: null }));
  it('bucket only with trailing slash', () =>
    expect(parseBucketAndKey('/mybucket/')).toEqual({ bucket: 'mybucket', key: '' }));
  it('bucket + simple key', () =>
    expect(parseBucketAndKey('/mybucket/photo.jpg')).toEqual({
      bucket: 'mybucket',
      key: 'photo.jpg',
    }));
  it('bucket + nested key', () =>
    expect(parseBucketAndKey('/mybucket/a/b/c.txt')).toEqual({
      bucket: 'mybucket',
      key: 'a/b/c.txt',
    }));
});
