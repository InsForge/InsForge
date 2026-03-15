package insforge

import "net/url"

// AuthClient handles authentication and user management.
type AuthClient struct {
	http *httpClient
}

func newAuthClient(h *httpClient) *AuthClient {
	return &AuthClient{http: h}
}

// AuthUser represents a user object returned by the API.
type AuthUser struct {
	ID        string         `json:"id"`
	Email     string         `json:"email"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
	Profile   map[string]any `json:"profile,omitempty"`
}

// AuthSession is the response from sign-in / sign-up operations.
type AuthSession struct {
	AccessToken  string   `json:"accessToken"`
	RefreshToken string   `json:"refreshToken"`
	ExpiresIn    int      `json:"expiresIn"`
	TokenType    string   `json:"tokenType"`
	User         AuthUser `json:"user"`
}

// SignUp registers a new user with email and password.
// Optional metadata can include display_name, avatar_url, etc.
func (a *AuthClient) SignUp(email, password string, metadata map[string]any) (*AuthSession, error) {
	body := map[string]any{
		"email":       email,
		"password":    password,
		"client_type": "server",
	}
	if len(metadata) > 0 {
		body["metadata"] = metadata
	}
	var session AuthSession
	if err := a.http.do("POST", "/api/auth/users", body, nil, &session, nil); err != nil {
		return nil, err
	}
	a.http.state.setTokens(session.AccessToken, session.RefreshToken, "", nil)
	return &session, nil
}

// SignInWithPassword authenticates using email and password.
func (a *AuthClient) SignInWithPassword(email, password string) (*AuthSession, error) {
	body := map[string]any{
		"email":       email,
		"password":    password,
		"client_type": "server",
	}
	var session AuthSession
	if err := a.http.do("POST", "/api/auth/sessions", body, nil, &session, nil); err != nil {
		return nil, err
	}
	a.http.state.setTokens(session.AccessToken, session.RefreshToken, "", nil)
	return &session, nil
}

// OAuthURL holds the redirect URL for OAuth sign-in.
type OAuthURL struct {
	URL string `json:"url"`
}

// SignInWithOAuth returns the OAuth provider redirect URL.
// provider is e.g. "google" or "github".
func (a *AuthClient) SignInWithOAuth(provider, redirectURL string) (*OAuthURL, error) {
	params := url.Values{}
	params.Set("redirect_url", redirectURL)
	params.Set("client_type", "server")
	var result OAuthURL
	if err := a.http.do("GET", "/api/auth/oauth/"+provider, nil, params, &result, nil); err != nil {
		return nil, err
	}
	return &result, nil
}

// ExchangeOAuthCode exchanges an OAuth authorization code for a session.
func (a *AuthClient) ExchangeOAuthCode(provider, code, state string) (*AuthSession, error) {
	body := map[string]any{
		"provider":    provider,
		"code":        code,
		"state":       state,
		"client_type": "server",
	}
	var session AuthSession
	if err := a.http.do("POST", "/api/auth/oauth/exchange", body, nil, &session, nil); err != nil {
		return nil, err
	}
	a.http.state.setTokens(session.AccessToken, session.RefreshToken, "", nil)
	return &session, nil
}

// SignOut invalidates the current session.
func (a *AuthClient) SignOut() error {
	err := a.http.do("POST", "/api/auth/logout", map[string]any{}, nil, nil, nil)
	a.http.state.clear()
	return err
}

// GetCurrentSession returns the currently authenticated session from the server.
func (a *AuthClient) GetCurrentSession() (*AuthSession, error) {
	var session AuthSession
	if err := a.http.do("GET", "/api/auth/sessions/current", nil, nil, &session, nil); err != nil {
		return nil, err
	}
	return &session, nil
}

// GetCurrentUser returns the currently authenticated user.
func (a *AuthClient) GetCurrentUser() (*AuthUser, error) {
	session, err := a.GetCurrentSession()
	if err != nil {
		return nil, err
	}
	return &session.User, nil
}

// RefreshSession exchanges the stored refresh token for a new access token.
func (a *AuthClient) RefreshSession() (*AuthSession, error) {
	refreshToken := a.http.state.getRefreshToken()
	if refreshToken == "" {
		return nil, &InsForgeError{Message: "no refresh token available", StatusCode: 0}
	}
	body := map[string]any{"refreshToken": refreshToken}
	var session AuthSession
	if err := a.http.do("POST", "/api/auth/refresh", body, nil, &session, nil); err != nil {
		return nil, err
	}
	a.http.state.setTokens(session.AccessToken, session.RefreshToken, "", nil)
	return &session, nil
}

// GetProfile returns the profile for the given user ID.
func (a *AuthClient) GetProfile(userID string) (map[string]any, error) {
	var profile map[string]any
	if err := a.http.do("GET", "/api/auth/profiles/"+userID, nil, nil, &profile, nil); err != nil {
		return nil, err
	}
	return profile, nil
}

// SetProfile updates the profile for the given user ID.
func (a *AuthClient) SetProfile(userID string, updates map[string]any) (map[string]any, error) {
	var profile map[string]any
	if err := a.http.do("PATCH", "/api/auth/profiles/"+userID, updates, nil, &profile, nil); err != nil {
		return nil, err
	}
	return profile, nil
}

// ResendVerificationEmail resends the email verification link.
func (a *AuthClient) ResendVerificationEmail(email string) error {
	return a.http.do("POST", "/api/auth/email/resend-verification", map[string]any{"email": email}, nil, nil, nil)
}

// VerifyEmail verifies an email using a token from the verification link.
func (a *AuthClient) VerifyEmail(token string) error {
	return a.http.do("POST", "/api/auth/email/verify", map[string]any{"token": token}, nil, nil, nil)
}

// SendResetPasswordEmail sends a password reset email.
func (a *AuthClient) SendResetPasswordEmail(email string) error {
	return a.http.do("POST", "/api/auth/email/reset-password", map[string]any{"email": email}, nil, nil, nil)
}

// ExchangeResetPasswordToken exchanges a password reset token for a session.
func (a *AuthClient) ExchangeResetPasswordToken(token string) (*AuthSession, error) {
	var session AuthSession
	if err := a.http.do("POST", "/api/auth/email/exchange-reset-token", map[string]any{"token": token}, nil, &session, nil); err != nil {
		return nil, err
	}
	a.http.state.setTokens(session.AccessToken, session.RefreshToken, "", nil)
	return &session, nil
}

// ResetPassword sets a new password for the current user (after exchanging reset token).
func (a *AuthClient) ResetPassword(newPassword string) error {
	return a.http.do("POST", "/api/auth/email/change-password", map[string]any{"password": newPassword}, nil, nil, nil)
}

// PublicConfig holds public authentication configuration (enabled providers, etc.).
type PublicConfig struct {
	Providers []string       `json:"providers"`
	Extra     map[string]any `json:"-"`
}

// GetPublicConfig returns the public auth configuration for this backend.
func (a *AuthClient) GetPublicConfig() (map[string]any, error) {
	var cfg map[string]any
	if err := a.http.do("GET", "/api/auth/config/public", nil, nil, &cfg, nil); err != nil {
		return nil, err
	}
	return cfg, nil
}
