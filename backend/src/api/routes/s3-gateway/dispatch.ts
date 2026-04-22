export type S3Op =
  | 'ListBuckets'
  | 'CreateBucket'
  | 'DeleteBucket'
  | 'HeadBucket'
  | 'ListObjectsV2'
  | 'PutObject'
  | 'GetObject'
  | 'HeadObject'
  | 'DeleteObject'
  | 'DeleteObjects'
  | 'CopyObject'
  | 'CreateMultipartUpload'
  | 'UploadPart'
  | 'CompleteMultipartUpload'
  | 'AbortMultipartUpload'
  | 'ListParts'
  | 'GetBucketLocation'
  | 'GetBucketVersioning';

interface Req {
  method: string;
  path: string;
  query: Record<string, string | string[] | undefined>;
  headers: Record<string, string | string[] | undefined>;
}

function header(h: Req['headers'], name: string): string | undefined {
  const direct = h[name] ?? h[name.toLowerCase()];
  if (Array.isArray(direct)) return direct[0];
  return direct;
}

function hasKey(path: string): boolean {
  const trimmed = path.replace(/^\/+/, '');
  return trimmed.includes('/');
}

function bucketOnly(path: string): boolean {
  const trimmed = path.replace(/^\/+/, '').replace(/\/+$/, '');
  return trimmed.length > 0 && !trimmed.includes('/');
}

export function dispatchOp(req: Req): S3Op | null {
  const { method, path, query } = req;
  const m = method.toUpperCase();
  const q = new Set(Object.keys(query));

  // Root — ListBuckets only
  if (path === '/' || path === '') {
    return m === 'GET' ? 'ListBuckets' : null;
  }

  // Bucket-level (no object key)
  if (bucketOnly(path)) {
    if (m === 'GET') {
      if (q.has('location')) return 'GetBucketLocation';
      if (q.has('versioning')) return 'GetBucketVersioning';
      return 'ListObjectsV2';
    }
    if (m === 'HEAD') return 'HeadBucket';
    if (m === 'PUT') return 'CreateBucket';
    if (m === 'DELETE') return 'DeleteBucket';
    if (m === 'POST' && q.has('delete')) return 'DeleteObjects';
    return null;
  }

  // Object-level
  if (hasKey(path)) {
    if (m === 'PUT') {
      if (q.has('uploadId') && q.has('partNumber')) return 'UploadPart';
      if (header(req.headers, 'x-amz-copy-source')) return 'CopyObject';
      return 'PutObject';
    }
    if (m === 'POST') {
      if (q.has('uploads')) return 'CreateMultipartUpload';
      if (q.has('uploadId')) return 'CompleteMultipartUpload';
      return null;
    }
    if (m === 'GET') {
      if (q.has('uploadId')) return 'ListParts';
      return 'GetObject';
    }
    if (m === 'HEAD') return 'HeadObject';
    if (m === 'DELETE') {
      if (q.has('uploadId')) return 'AbortMultipartUpload';
      return 'DeleteObject';
    }
  }

  return null;
}

export function parseBucketAndKey(path: string): { bucket: string | null; key: string | null } {
  const trimmed = path.replace(/^\/+/, '');
  if (!trimmed) return { bucket: null, key: null };
  const slash = trimmed.indexOf('/');
  if (slash === -1) return { bucket: trimmed.replace(/\/+$/, ''), key: null };
  return { bucket: trimmed.slice(0, slash), key: trimmed.slice(slash + 1) };
}
