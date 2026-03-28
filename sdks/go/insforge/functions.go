package insforge

import "context"

// Functions invokes deployed serverless edge functions.
type Functions struct {
	http *httpClient
}

func newFunctions(h *httpClient) *Functions { return &Functions{http: h} }

// InvokeOptions configures a function invocation.
type InvokeOptions struct {
	Body    interface{}
	Headers map[string]string
	Method  string // default: POST
}

// Invoke calls a deployed edge function by its slug.
func (f *Functions) Invoke(ctx context.Context, slug string, opts *InvokeOptions) Result[interface{}] {
	method := "POST"
	var body interface{}
	var headers map[string]string

	if opts != nil {
		if opts.Method != "" {
			method = opts.Method
		}
		body = opts.Body
		headers = opts.Headers
	}

	path := "/functions/" + slug

	var (
		raw interface{}
		err error
	)
	switch method {
	case "GET":
		raw, err = f.http.get(ctx, path, nil, headers)
	case "POST":
		raw, err = f.http.post(ctx, path, body, headers)
	case "PUT":
		raw, err = f.http.put(ctx, path, body, headers)
	case "PATCH":
		raw, err = f.http.patch(ctx, path, body, headers)
	case "DELETE":
		raw, err = f.http.delete(ctx, path, nil, headers)
	default:
		raw, err = f.http.post(ctx, path, body, headers)
	}

	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}
