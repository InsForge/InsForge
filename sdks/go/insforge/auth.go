package insforge

import (
	"context"
	"encoding/json"
)

// Auth provides authentication and user management operations.
type Auth struct {
	http *httpClient
}

func newAuth(h *httpClient) *Auth { return &Auth{http: h} }

func decode[T any](raw interface{}) (T, error) {
	var out T
	b, err := json.Marshal(raw)
	if err != nil {
		return out, err
	}
	if err := json.Unmarshal(b, &out); err != nil {
		return out, err
	}
	return out, nil
}

// SignUp creates a new user account.
func (a *Auth) SignUp(ctx context.Context, email, password string, opts ...map[string]interface{}) Result[map[string]interface{}] {
	body := map[string]interface{}{"email": email, "password": password}
	if len(opts) > 0 {
		for k, v := range opts[0] {
			body[k] = v
		}
	}
	raw, err := a.http.post(ctx, "/api/auth/users", body, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// SignInWithPassword authenticates with email and password.
// On success the access token is stored automatically.
func (a *Auth) SignInWithPassword(ctx context.Context, email, password string) Result[*Session] {
	raw, err := a.http.post(ctx, "/api/auth/sessions", map[string]interface{}{
		"email": email, "password": password,
	}, nil)
	if err != nil {
		return fail[*Session](err)
	}
	session, decErr := decode[Session](raw)
	if decErr != nil {
		return fail[*Session](decErr)
	}
	if session.AccessToken != "" {
		a.http.setAccessToken(session.AccessToken)
	}
	return ok(&session)
}

// SignOut logs out the current user and clears the stored token.
func (a *Auth) SignOut(ctx context.Context) Result[map[string]interface{}] {
	raw, err := a.http.post(ctx, "/api/auth/logout", nil, nil)
	a.http.setAccessToken("")
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// SignInWithOAuth initiates an OAuth sign-in. Returns a URL to redirect the user.
func (a *Auth) SignInWithOAuth(ctx context.Context, provider string, redirectTo string) Result[map[string]interface{}] {
	body := map[string]interface{}{"provider": provider}
	if redirectTo != "" {
		body["redirectTo"] = redirectTo
	}
	raw, err := a.http.post(ctx, "/api/auth/oauth/"+provider, body, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// ExchangeOAuthCode exchanges an OAuth authorization code for an access token.
func (a *Auth) ExchangeOAuthCode(ctx context.Context, code, codeVerifier string) Result[*Session] {
	body := map[string]interface{}{"code": code}
	if codeVerifier != "" {
		body["codeVerifier"] = codeVerifier
	}
	raw, err := a.http.post(ctx, "/api/auth/oauth/exchange", body, nil)
	if err != nil {
		return fail[*Session](err)
	}
	session, decErr := decode[Session](raw)
	if decErr != nil {
		return fail[*Session](decErr)
	}
	if session.AccessToken != "" {
		a.http.setAccessToken(session.AccessToken)
	}
	return ok(&session)
}

// GetCurrentUser refreshes the session and returns the current user.
func (a *Auth) GetCurrentUser(ctx context.Context) Result[*User] {
	raw, err := a.http.post(ctx, "/api/auth/refresh", nil, nil)
	if err != nil {
		return fail[*User](err)
	}
	session, decErr := decode[Session](raw)
	if decErr != nil {
		return fail[*User](decErr)
	}
	if session.AccessToken != "" {
		a.http.setAccessToken(session.AccessToken)
	}
	return ok(session.User)
}

// RefreshSession refreshes the current session, optionally with an explicit refresh token.
func (a *Auth) RefreshSession(ctx context.Context, refreshToken string) Result[*Session] {
	var body interface{}
	if refreshToken != "" {
		body = map[string]interface{}{"refreshToken": refreshToken}
	}
	raw, err := a.http.post(ctx, "/api/auth/refresh", body, nil)
	if err != nil {
		return fail[*Session](err)
	}
	session, decErr := decode[Session](raw)
	if decErr != nil {
		return fail[*Session](decErr)
	}
	if session.AccessToken != "" {
		a.http.setAccessToken(session.AccessToken)
	}
	return ok(&session)
}

// GetProfile returns the profile for the given user ID.
func (a *Auth) GetProfile(ctx context.Context, userID string) Result[map[string]interface{}] {
	raw, err := a.http.get(ctx, "/api/auth/profiles/"+userID, nil, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// SetProfile updates the current user's profile.
func (a *Auth) SetProfile(ctx context.Context, profile map[string]interface{}) Result[map[string]interface{}] {
	raw, err := a.http.patch(ctx, "/api/auth/profiles/current", profile, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// ResendVerificationEmail resends the email verification message.
func (a *Auth) ResendVerificationEmail(ctx context.Context, email string) Result[map[string]interface{}] {
	raw, err := a.http.post(ctx, "/api/auth/email/send-verification", map[string]interface{}{"email": email}, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// VerifyEmail verifies an email address using an OTP code.
func (a *Auth) VerifyEmail(ctx context.Context, email, otp string) Result[map[string]interface{}] {
	raw, err := a.http.post(ctx, "/api/auth/email/verify", map[string]interface{}{"email": email, "otp": otp}, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// SendResetPasswordEmail sends a password reset email.
func (a *Auth) SendResetPasswordEmail(ctx context.Context, email string) Result[map[string]interface{}] {
	raw, err := a.http.post(ctx, "/api/auth/email/send-reset-password", map[string]interface{}{"email": email}, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// ResetPassword resets the password using an OTP received via email.
func (a *Auth) ResetPassword(ctx context.Context, newPassword, otp string) Result[map[string]interface{}] {
	raw, err := a.http.post(ctx, "/api/auth/email/reset-password", map[string]interface{}{
		"newPassword": newPassword, "otp": otp,
	}, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}

// GetPublicAuthConfig returns the public authentication configuration.
func (a *Auth) GetPublicAuthConfig(ctx context.Context) Result[map[string]interface{}] {
	raw, err := a.http.get(ctx, "/api/auth/config/public", nil, nil)
	if err != nil {
		return fail[map[string]interface{}](err)
	}
	m, _ := raw.(map[string]interface{})
	return ok(m)
}
