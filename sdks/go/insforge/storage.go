package insforge

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Storage provides file storage operations.
type Storage struct {
	http *httpClient
}

func newStorage(h *httpClient) *Storage { return &Storage{http: h} }

// From returns a StorageBucket for the given bucket name.
func (s *Storage) From(bucketName string) *StorageBucket {
	return &StorageBucket{http: s.http, bucket: bucketName}
}

// StorageBucket wraps operations for a specific bucket.
type StorageBucket struct {
	http   *httpClient
	bucket string
}

func (b *StorageBucket) base() string {
	return "/api/storage/buckets/" + b.bucket
}

// GetPublicURL returns the public URL for an object in the bucket.
func (b *StorageBucket) GetPublicURL(path string) string {
	clean := strings.TrimLeft(path, "/")
	return fmt.Sprintf("%s%s/objects/%s", b.http.baseURL, b.base(), clean)
}

// Upload uploads raw bytes to the given path in the bucket.
func (b *StorageBucket) Upload(ctx context.Context, path string, data []byte, contentType string) Result[interface{}] {
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	clean := strings.TrimLeft(path, "/")

	// Request upload strategy
	stratRaw, err := b.http.post(ctx, b.base()+"/upload-strategy", map[string]interface{}{
		"filename": clean, "contentType": contentType, "size": len(data),
	}, nil)
	if err != nil {
		return fail[interface{}](err)
	}

	strategy, _ := stratRaw.(map[string]interface{})
	method, _ := strategy["method"].(string)
	uploadURL, _ := strategy["uploadUrl"].(string)
	key, _ := strategy["key"].(string)
	if key == "" {
		key = clean
	}

	if method == "presigned" && uploadURL != "" {
		req, err := http.NewRequestWithContext(ctx, http.MethodPut, uploadURL, strings.NewReader(string(data)))
		if err != nil {
			return fail[interface{}](err)
		}
		req.Header.Set("Content-Type", contentType)
		resp, err := b.http.client.Do(req)
		if err != nil {
			return fail[interface{}](err)
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			return fail[interface{}](&InsForgeError{StatusCode: resp.StatusCode, Message: "presigned upload failed"})
		}
		// Confirm if required
		confirmReq, _ := strategy["confirmRequired"].(bool)
		if confirmReq {
			confirmURL, _ := strategy["confirmUrl"].(string)
			confirmPath := strings.Replace(confirmURL, b.http.baseURL, "", 1)
			raw, err := b.http.post(ctx, confirmPath, map[string]interface{}{"size": len(data), "contentType": contentType}, nil)
			if err != nil {
				return fail[interface{}](err)
			}
			return ok[interface{}](raw)
		}
		return ok[interface{}](map[string]interface{}{"key": key})
	}

	// Direct upload
	raw, err := b.http.uploadRaw(ctx, b.base()+"/objects/"+key, data, contentType)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// UploadReader uploads from an io.Reader.
func (b *StorageBucket) UploadReader(ctx context.Context, path string, r io.Reader, contentType string) Result[interface{}] {
	data, err := io.ReadAll(r)
	if err != nil {
		return fail[interface{}](&InsForgeError{Message: "failed to read upload data: " + err.Error()})
	}
	return b.Upload(ctx, path, data, contentType)
}

// Download downloads an object and returns its raw bytes.
func (b *StorageBucket) Download(ctx context.Context, path string) Result[[]byte] {
	clean := strings.TrimLeft(path, "/")

	// Try download strategy first
	stratRaw, err := b.http.post(ctx, b.base()+"/objects/"+clean+"/download-strategy", map[string]interface{}{}, nil)
	if err != nil {
		// Fallback: direct download
		data, derr := b.http.downloadBytes(ctx, b.base()+"/objects/"+clean)
		if derr != nil {
			return fail[[]byte](err)
		}
		return ok(data)
	}

	strategy, _ := stratRaw.(map[string]interface{})
	downloadURL, _ := strategy["downloadUrl"].(string)

	if downloadURL != "" && !strings.HasPrefix(downloadURL, b.http.baseURL) {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, downloadURL, nil)
		if err != nil {
			return fail[[]byte](err)
		}
		resp, err := b.http.client.Do(req)
		if err != nil {
			return fail[[]byte](err)
		}
		defer resp.Body.Close()
		data, err := io.ReadAll(resp.Body)
		if err != nil {
			return fail[[]byte](err)
		}
		return ok(data)
	}

	data, err := b.http.downloadBytes(ctx, b.base()+"/objects/"+clean)
	if err != nil {
		return fail[[]byte](err)
	}
	return ok(data)
}

// List lists objects in the bucket.
func (b *StorageBucket) List(ctx context.Context, opts *ListOptions) Result[interface{}] {
	params := url.Values{}
	params.Set("limit", "100")
	params.Set("offset", "0")
	if opts != nil {
		if opts.Prefix != "" {
			params.Set("prefix", opts.Prefix)
		}
		if opts.Search != "" {
			params.Set("search", opts.Search)
		}
		if opts.Limit > 0 {
			params.Set("limit", strconv.Itoa(opts.Limit))
		}
		if opts.Offset > 0 {
			params.Set("offset", strconv.Itoa(opts.Offset))
		}
	}
	raw, err := b.http.get(ctx, b.base()+"/objects", params, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// Remove deletes an object from the bucket.
func (b *StorageBucket) Remove(ctx context.Context, path string) Result[interface{}] {
	clean := strings.TrimLeft(path, "/")
	raw, err := b.http.delete(ctx, b.base()+"/objects/"+clean, nil, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}

// ListOptions controls list pagination and filtering.
type ListOptions struct {
	Prefix string
	Search string
	Limit  int
	Offset int
}
