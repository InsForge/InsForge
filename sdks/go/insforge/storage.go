package insforge

import (
	"io"
	"net/url"
	"path/filepath"
)

// StorageClient manages storage buckets.
type StorageClient struct {
	http *httpClient
}

func newStorageClient(h *httpClient) *StorageClient {
	return &StorageClient{http: h}
}

// From returns a StorageBucket handle for the given bucket name.
func (s *StorageClient) From(bucket string) *StorageBucket {
	return &StorageBucket{http: s.http, bucket: bucket}
}

// StorageBucket provides file operations for a specific bucket.
type StorageBucket struct {
	http   *httpClient
	bucket string
}

// uploadStrategyRequest is the body sent to request an upload strategy.
type uploadStrategyRequest struct {
	Key         string `json:"key"`
	ContentType string `json:"contentType"`
	Size        int    `json:"size"`
}

// uploadStrategyResponse describes how to upload the file.
type uploadStrategyResponse struct {
	Method    string            `json:"method"`   // "presigned" or "direct"
	UploadURL string            `json:"uploadUrl"`
	Fields    map[string]string `json:"fields,omitempty"`
	Key       string            `json:"key"`
}

// confirmUploadResponse is the response from a confirmed upload.
type confirmUploadResponse struct {
	URL string `json:"url"`
}

// Upload uploads data to the bucket at the given key.
// contentType should be e.g. "image/png".
// Returns the public URL of the uploaded file.
func (b *StorageBucket) Upload(key string, data []byte, contentType string) (string, error) {
	strategyPath := "/api/storage/buckets/" + b.bucket + "/upload-strategy"
	reqBody := uploadStrategyRequest{
		Key:         key,
		ContentType: contentType,
		Size:        len(data),
	}
	var strategy uploadStrategyResponse
	if err := b.http.do("POST", strategyPath, reqBody, nil, &strategy, nil); err != nil {
		return "", err
	}

	switch strategy.Method {
	case "presigned":
		if err := b.http.doPostExternal(strategy.UploadURL, strategy.Fields, "file", filepath.Base(key), data, contentType); err != nil {
			return "", err
		}
	default:
		// "direct" or any other strategy
		if err := b.http.doPutExternal(strategy.UploadURL, data, contentType); err != nil {
			return "", err
		}
	}

	// Confirm the upload
	confirmPath := "/api/storage/buckets/" + b.bucket + "/objects/" + key + "/confirm-upload"
	var confirmed confirmUploadResponse
	if err := b.http.do("POST", confirmPath, map[string]string{"key": key}, nil, &confirmed, nil); err != nil {
		return "", err
	}
	return confirmed.URL, nil
}

// downloadStrategyResponse describes how to download the file.
type downloadStrategyResponse struct {
	Method      string `json:"method"`
	DownloadURL string `json:"downloadUrl"`
}

// Download retrieves the bytes of the file at the given key.
func (b *StorageBucket) Download(key string) ([]byte, error) {
	strategyPath := "/api/storage/buckets/" + b.bucket + "/objects/" + key + "/download-strategy"
	var strategy downloadStrategyResponse
	if err := b.http.do("POST", strategyPath, map[string]any{}, nil, &strategy, nil); err != nil {
		return nil, err
	}

	switch strategy.Method {
	case "presigned":
		resp, err := b.http.client.Get(strategy.DownloadURL)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode >= 400 {
			return nil, &InsForgeError{Message: "download failed", StatusCode: resp.StatusCode}
		}
		return io.ReadAll(resp.Body)
	default:
		// direct download via InsForge API
		return b.http.doRaw("GET", "/api/storage/buckets/"+b.bucket+"/objects/"+key, nil, nil, nil)
	}
}

// StorageObject represents a file listing entry.
type StorageObject struct {
	Key          string `json:"key"`
	Size         int64  `json:"size"`
	LastModified string `json:"lastModified"`
	ContentType  string `json:"contentType"`
	URL          string `json:"url"`
}

// List returns all objects in the bucket under the given prefix.
func (b *StorageBucket) List(prefix string) ([]StorageObject, error) {
	listPath := "/api/storage/buckets/" + b.bucket + "/objects"
	params := url.Values{}
	if prefix != "" {
		params.Set("prefix", prefix)
	}
	var objects []StorageObject
	if err := b.http.do("GET", listPath, nil, params, &objects, nil); err != nil {
		return nil, err
	}
	return objects, nil
}

// Remove deletes the file at the given key.
func (b *StorageBucket) Remove(key string) error {
	deletePath := "/api/storage/buckets/" + b.bucket + "/objects/" + key
	return b.http.do("DELETE", deletePath, nil, nil, nil, nil)
}
