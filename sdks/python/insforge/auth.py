"""
Authentication module for the InsForge Python SDK.

Usage:
    result = client.auth.sign_up(email="user@example.com", password="pass123")
    result = client.auth.sign_in_with_password(email="...", password="...")
    result = client.auth.sign_out()
    session = client.auth.get_current_session()
"""

from __future__ import annotations

from typing import Any

from .http import HttpClient, InsForgeError


class AuthClient:
    """Provides authentication and user management operations."""

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    def sign_up(
        self,
        *,
        email: str,
        password: str,
        name: str | None = None,
        email_redirect_to: str | None = None,
    ) -> dict[str, Any]:
        """
        Create a new user account.

        Args:
            email: User's email address.
            password: User's password.
            name: Optional display name.
            email_redirect_to: Custom redirect URL after email verification.

        Returns:
            Dict with keys: user, access_token, require_email_verification,
            redirect_to, csrf_token.

        Raises:
            InsForgeError: On API error.
        """
        payload: dict[str, Any] = {"email": email, "password": password}
        if name is not None:
            payload["name"] = name
        if email_redirect_to is not None:
            payload["emailRedirectTo"] = email_redirect_to

        data = self._http.post(
            "/api/auth/users",
            data=payload,
            params={"client_type": "server"},
        )
        self._persist_session(data)
        return data

    # ------------------------------------------------------------------
    # Sign in / out
    # ------------------------------------------------------------------

    def sign_in_with_password(
        self,
        *,
        email: str,
        password: str,
    ) -> dict[str, Any]:
        """
        Sign in with email and password.

        Returns:
            Dict with keys: user, access_token, refresh_token.

        Raises:
            InsForgeError: On invalid credentials or other API error.
        """
        data = self._http.post(
            "/api/auth/sessions",
            data={"email": email, "password": password},
            params={"client_type": "server"},
        )
        self._persist_session(data)
        return data

    def sign_in_with_oauth(
        self,
        *,
        provider: str,
        redirect_to: str,
        code_challenge: str,
    ) -> dict[str, Any]:
        """
        Initiate an OAuth flow (PKCE). Returns the provider auth URL.

        Args:
            provider: OAuth provider (e.g., 'google', 'github').
            redirect_to: Redirect URI after authentication.
            code_challenge: Base64-URL-encoded SHA-256 hash of code_verifier.

        Returns:
            Dict with key: auth_url.
        """
        data = self._http.get(
            f"/api/auth/oauth/{provider}",
            params={"redirect_uri": redirect_to, "code_challenge": code_challenge},
        )
        return data

    def exchange_oauth_code(
        self,
        *,
        code: str,
        code_verifier: str,
    ) -> dict[str, Any]:
        """
        Exchange an OAuth authorization code (PKCE) for tokens.

        Args:
            code: The insforge_code received in the OAuth callback.
            code_verifier: The original code_verifier used to generate code_challenge.

        Returns:
            Dict with keys: user, access_token, refresh_token, redirect_to.
        """
        data = self._http.post(
            "/api/auth/oauth/exchange",
            data={"code": code, "code_verifier": code_verifier},
            params={"client_type": "server"},
        )
        self._persist_session(data)
        return data

    def sign_out(self) -> dict[str, Any]:
        """
        Sign out the current user and clear the local session.

        Returns:
            Dict with keys: success, message.
        """
        try:
            result = self._http.post("/api/auth/logout")
        except InsForgeError:
            result = {"success": False}
        finally:
            self._http._state.clear()
        return result or {"success": True, "message": "Logged out successfully"}

    # ------------------------------------------------------------------
    # Session management
    # ------------------------------------------------------------------

    def get_current_session(self) -> dict[str, Any]:
        """
        Return the current session by calling the server with the stored token.

        Returns:
            Dict with key: session (containing access_token, user, expires_at).
        """
        try:
            data = self._http.get("/api/auth/sessions/current")
            user = data.get("user")
            token = self._http._state.access_token
            return {
                "session": {
                    "access_token": token,
                    "user": user,
                }
                if user
                else None
            }
        except InsForgeError:
            return {"session": None}

    def get_current_user(self) -> dict[str, Any]:
        """
        Return the currently authenticated user.

        Returns:
            Dict with key: user.
        """
        data = self._http.get("/api/auth/sessions/current")
        return {"user": data.get("user") if data else None}

    def refresh_session(
        self,
        refresh_token: str | None = None,
    ) -> dict[str, Any]:
        """
        Refresh the access token using the stored (or provided) refresh token.

        Args:
            refresh_token: Override the stored refresh token.

        Returns:
            Dict with keys: user, access_token, refresh_token.
        """
        token = refresh_token or self._http._state.refresh_token
        if not token:
            raise InsForgeError("No refresh token available")
        data = self._http.post(
            "/api/auth/refresh",
            data={"refreshToken": token},
            params={"client_type": "server"},
        )
        self._persist_session(data)
        return data

    # ------------------------------------------------------------------
    # Profile
    # ------------------------------------------------------------------

    def get_profile(self, user_id: str) -> dict[str, Any]:
        """
        Fetch a public user profile by ID.

        Args:
            user_id: The user's ID.

        Returns:
            Profile dict with id, name, avatar_url, and custom fields.
        """
        data = self._http.get(f"/api/auth/profiles/{user_id}")
        return data

    def set_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        """
        Update the current user's profile.

        Args:
            profile: Key-value map of profile fields. Common: name, avatar_url.

        Returns:
            Updated profile dict.
        """
        data = self._http.patch("/api/auth/profiles/current", data={"profile": profile})
        return data

    # ------------------------------------------------------------------
    # Email verification
    # ------------------------------------------------------------------

    def resend_verification_email(
        self,
        *,
        email: str,
        email_redirect_to: str | None = None,
    ) -> dict[str, Any]:
        """
        Resend an email verification message.

        Returns:
            Dict with keys: success, message.
        """
        payload: dict[str, Any] = {"email": email}
        if email_redirect_to:
            payload["emailRedirectTo"] = email_redirect_to
        return self._http.post("/api/auth/email/send-verification", data=payload)

    def verify_email(
        self,
        *,
        otp: str,
        email: str | None = None,
    ) -> dict[str, Any]:
        """
        Verify an email address with a code or magic link token.

        Args:
            otp: 6-digit code (code method) or 64-char hex token (link method).
            email: User email (required for code method).

        Returns:
            Dict with keys: user, access_token, refresh_token, redirect_to.
        """
        payload: dict[str, Any] = {"otp": otp}
        if email:
            payload["email"] = email
        data = self._http.post(
            "/api/auth/email/verify",
            data=payload,
            params={"client_type": "server"},
        )
        self._persist_session(data)
        return data

    # ------------------------------------------------------------------
    # Password reset
    # ------------------------------------------------------------------

    def send_reset_password_email(self, *, email: str) -> dict[str, Any]:
        """
        Send a password reset email.

        Returns:
            Dict with keys: success, message.
        """
        return self._http.post(
            "/api/auth/email/send-reset-password", data={"email": email}
        )

    def exchange_reset_password_token(
        self,
        *,
        email: str,
        code: str,
    ) -> dict[str, Any]:
        """
        Exchange a 6-digit reset code for a reset token (code method only).

        Returns:
            Dict with keys: token, expires_at.
        """
        return self._http.post(
            "/api/auth/email/exchange-reset-password-token",
            data={"email": email, "code": code},
        )

    def reset_password(
        self,
        *,
        new_password: str,
        otp: str,
    ) -> dict[str, Any]:
        """
        Reset the user's password with a token.

        Args:
            new_password: The new password.
            otp: Reset token from exchange_reset_password_token or magic link.

        Returns:
            Dict with keys: message, redirect_to.
        """
        return self._http.post(
            "/api/auth/email/reset-password",
            data={"newPassword": new_password, "otp": otp},
        )

    # ------------------------------------------------------------------
    # Public config
    # ------------------------------------------------------------------

    def get_public_config(self) -> dict[str, Any]:
        """
        Fetch public authentication configuration (no auth required).

        Returns:
            Dict with provider list, password requirements, etc.
        """
        return self._http.get("/api/auth/public-config")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _persist_session(self, data: dict[str, Any] | None) -> None:
        """Store tokens from an auth response into the shared session state."""
        if not data:
            return
        kwargs: dict[str, Any] = {}
        if "accessToken" in data:
            kwargs["access_token"] = data["accessToken"]
        if "refreshToken" in data:
            kwargs["refresh_token"] = data["refreshToken"]
        if "csrfToken" in data:
            kwargs["csrf_token"] = data["csrfToken"]
        if "user" in data:
            kwargs["user"] = data["user"]
        if kwargs:
            self._http._state.set(**kwargs)
