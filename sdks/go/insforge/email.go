package insforge

import "context"

// Emails sends transactional emails.
type Emails struct {
	http *httpClient
}

func newEmails(h *httpClient) *Emails { return &Emails{http: h} }

// Send sends a transactional email.
func (e *Emails) Send(ctx context.Context, req SendEmailRequest) Result[interface{}] {
	raw, err := e.http.post(ctx, "/api/email/send-raw", req, nil)
	if err != nil {
		return fail[interface{}](err)
	}
	return ok[interface{}](raw)
}
