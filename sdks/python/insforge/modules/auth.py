"""Auth module - authentication and user management."""
from __future__ import annotations

from typing import Any

from insforge.errors import InsForgeError
from insforge.lib.http_client import HttpClient


def _ok(data: Any) -> dict[str, Any]:
    return {"data": data, "error": None}


def _err(e: InsForgeError) -> dict[str, Any]:
    return {"data": None, "error": e}


class Auth:
    def __init__(self, http: HttpClient) -> None:
        self._http = http

    # ------------------------------------------------------------------ #
    # Registration / Login
    # ------------------------------------------------------------------ #

    async def sign_up(
        self,
        *,
        email: str,
        password: str,
        profile: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Create a new user account."""
        body: dict[str, Any] = {"email": email, "password": password}
        if profile:
            body["profile"] = profile
        if metadata:
            body["metadata"] = metadata
        try:
            data = await self._http.post("/api/auth/users", body)
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    async def sign_in_with_password(self, *, email: str, password: str) -> dict[str, Any]:
        """Sign in with email and password. Stores the access token automatically."""
        try:
            data = await self._http.post("/api/auth/sessions", {"email": email, "password": password})
            token = (data or {}).get("accessToken")
            if token:
                self._http.set_access_token(token)
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    async def sign_out(self) -> dict[str, Any]:
        """Sign out and clear the stored token."""
        try:
            data = await self._http.post("/api/auth/logout")
            self._http.set_access_token(None)
            return {"data": data, "error": None}
        except InsForgeError as e:
            self._http.set_access_token(None)
            return _err(e)

    # ------------------------------------------------------------------ #
    # OAuth
    # ------------------------------------------------------------------ #

    async def sign_in_with_o_auth(
        self,
        *,
        provider: str,
        redirect_to: str | None = None,
        skip_browser_redirect: bool = False,
    ) -> dict[str, Any]:
        """Initiate an OAuth sign-in flow. Returns a URL to redirect the user to."""
        body: dict[str, Any] = {"provider": provider}
        if redirect_to:
            body["redirectTo"] = redirect_to
        try:
            data = await self._http.post(f"/api/auth/oauth/{provider}", body)
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    async def exchange_o_auth_code(
        self, code: str, code_verifier: str | None = None
    ) -> dict[str, Any]:
        """Exchange an OAuth authorization code for an access token."""
        body: dict[str, Any] = {"code": code}
        if code_verifier:
            body["codeVerifier"] = code_verifier
        try:
            data = await self._http.post("/api/auth/oauth/exchange", body)
            token = (data or {}).get("accessToken")
            if token:
                self._http.set_access_token(token)
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    # ------------------------------------------------------------------ #
    # Session / User
    # ------------------------------------------------------------------ #

    async def get_current_user(self) -> dict[str, Any]:
        """Get the currently authenticated user by refreshing the session."""
        try:
            data = await self._http.post("/api/auth/refresh")
            token = (data or {}).get("accessToken")
            if token:
                self._http.set_access_token(token)
            return _ok({"user": (data or {}).get("user")})
        except InsForgeError as e:
            return _err(e)

    async def refresh_session(self, refresh_token: str | None = None) -> dict[str, Any]:
        """Refresh the current session. Optionally pass a refresh token."""
        body: dict[str, Any] = {}
        if refresh_token:
            body["refreshToken"] = refresh_token
        try:
            data = await self._http.post("/api/auth/refresh", body or None)
            token = (data or {}).get("accessToken")
            if token:
                self._http.set_access_token(token)
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    # ------------------------------------------------------------------ #
    # Profile
    # ------------------------------------------------------------------ #

    async def get_profile(self, user_id: str) -> dict[str, Any]:
        """Get a user's profile by ID."""
        try:
            data = await self._http.get(f"/api/auth/profiles/{user_id}")
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    async def set_profile(self, profile: dict[str, Any]) -> dict[str, Any]:
        """Update the current user's profile."""
        try:
            data = await self._http.patch("/api/auth/profiles/current", profile)
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    # ------------------------------------------------------------------ #
    # Email Verification
    # ------------------------------------------------------------------ #

    async def resend_verification_email(self, email: str) -> dict[str, Any]:
        """Resend email verification."""
        try:
            data = await self._http.post("/api/auth/email/send-verification", {"email": email})
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    async def verify_email(self, *, email: str, otp: str) -> dict[str, Any]:
        """Verify email address with OTP code."""
        try:
            data = await self._http.post("/api/auth/email/verify", {"email": email, "otp": otp})
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    # ------------------------------------------------------------------ #
    # Password Reset
    # ------------------------------------------------------------------ #

    async def send_reset_password_email(self, email: str) -> dict[str, Any]:
        """Send a password reset email."""
        try:
            data = await self._http.post("/api/auth/email/send-reset-password", {"email": email})
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    async def reset_password(self, *, new_password: str, otp: str) -> dict[str, Any]:
        """Reset password using OTP received via email."""
        try:
            data = await self._http.post(
                "/api/auth/email/reset-password", {"newPassword": new_password, "otp": otp}
            )
            return _ok(data)
        except InsForgeError as e:
            return _err(e)

    # ------------------------------------------------------------------ #
    # Config
    # ------------------------------------------------------------------ #

    async def get_public_auth_config(self) -> dict[str, Any]:
        """Fetch the public auth configuration (OAuth providers, password rules, etc.)."""
        try:
            data = await self._http.get("/api/auth/config/public")
            return _ok(data)
        except InsForgeError as e:
            return _err(e)
