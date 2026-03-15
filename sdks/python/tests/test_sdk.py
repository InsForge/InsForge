"""
Tests for the InsForge Python SDK.

Run with: pytest tests/
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest
import responses as rsps

from insforge import create_client
from insforge.http import InsForgeError

BASE_URL = "https://test.insforge.app"
ANON_KEY = "test-anon-key"


@pytest.fixture
def client():
    return create_client(base_url=BASE_URL, anon_key=ANON_KEY)


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------


class TestAuth:
    @rsps.activate
    def test_sign_up_success(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/auth/users",
            json={
                "user": {"id": "usr_1", "email": "user@example.com", "emailVerified": False},
                "accessToken": "tok_abc",
                "refreshToken": "ref_xyz",
                "requireEmailVerification": False,
            },
            status=201,
        )
        result = client.auth.sign_up(email="user@example.com", password="pass123")
        assert result["user"]["id"] == "usr_1"
        assert result["accessToken"] == "tok_abc"
        # Token should be persisted
        assert client._http._state.access_token == "tok_abc"

    @rsps.activate
    def test_sign_in_success(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/auth/sessions",
            json={
                "user": {"id": "usr_1", "email": "user@example.com"},
                "accessToken": "tok_def",
                "refreshToken": "ref_ghi",
            },
            status=200,
        )
        result = client.auth.sign_in_with_password(
            email="user@example.com", password="pass123"
        )
        assert result["accessToken"] == "tok_def"
        assert client._http._state.access_token == "tok_def"

    @rsps.activate
    def test_sign_in_invalid_credentials(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/auth/sessions",
            json={
                "error": "INVALID_CREDENTIALS",
                "message": "Invalid email or password",
                "statusCode": 401,
            },
            status=401,
        )
        with pytest.raises(InsForgeError) as exc_info:
            client.auth.sign_in_with_password(email="bad@example.com", password="wrong")
        err = exc_info.value
        assert err.status_code == 401
        assert err.error_code == "INVALID_CREDENTIALS"

    @rsps.activate
    def test_sign_out(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/auth/logout",
            json={"success": True, "message": "Logged out successfully"},
            status=200,
        )
        # Pre-populate session
        client._http._state.set(access_token="tok_abc", refresh_token="ref_xyz")
        client.auth.sign_out()
        assert client._http._state.access_token is None

    @rsps.activate
    def test_get_profile(self, client):
        rsps.add(
            rsps.GET,
            f"{BASE_URL}/api/auth/profiles/usr_1",
            json={"id": "usr_1", "name": "Alice", "avatar_url": None},
            status=200,
        )
        result = client.auth.get_profile("usr_1")
        assert result["name"] == "Alice"

    @rsps.activate
    def test_set_profile(self, client):
        rsps.add(
            rsps.PATCH,
            f"{BASE_URL}/api/auth/profiles/current",
            json={"id": "usr_1", "name": "Bob"},
            status=200,
        )
        result = client.auth.set_profile({"name": "Bob"})
        assert result["name"] == "Bob"


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


class TestDatabase:
    @rsps.activate
    def test_select_all(self, client):
        rsps.add(
            rsps.GET,
            f"{BASE_URL}/api/database/records/posts",
            json=[{"id": "1", "title": "Hello"}, {"id": "2", "title": "World"}],
            status=200,
        )
        result = client.database.from_("posts").select().execute()
        assert result["error"] is None
        assert len(result["data"]) == 2

    @rsps.activate
    def test_select_with_eq_filter(self, client):
        rsps.add(
            rsps.GET,
            f"{BASE_URL}/api/database/records/posts",
            json=[{"id": "1", "title": "Active Post", "status": "active"}],
            status=200,
        )
        result = (
            client.database.from_("posts")
            .select("id, title")
            .eq("status", "active")
            .execute()
        )
        assert result["error"] is None
        assert result["data"][0]["title"] == "Active Post"

    @rsps.activate
    def test_insert(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/database/records/posts",
            json=[{"id": "3", "title": "New Post"}],
            status=201,
        )
        result = client.database.from_("posts").insert({"title": "New Post"}).execute()
        assert result["error"] is None
        assert result["data"][0]["id"] == "3"

    @rsps.activate
    def test_update(self, client):
        rsps.add(
            rsps.PATCH,
            f"{BASE_URL}/api/database/records/posts",
            json=[{"id": "1", "title": "Updated"}],
            status=200,
        )
        result = (
            client.database.from_("posts")
            .update({"title": "Updated"})
            .eq("id", "1")
            .execute()
        )
        assert result["error"] is None
        assert result["data"][0]["title"] == "Updated"

    @rsps.activate
    def test_delete(self, client):
        rsps.add(
            rsps.DELETE,
            f"{BASE_URL}/api/database/records/posts",
            body=b"",
            status=204,
        )
        result = client.database.from_("posts").delete().eq("id", "1").execute()
        assert result["error"] is None

    @rsps.activate
    def test_rpc(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/database/rpc/get_user_stats",
            json={"total_posts": 42},
            status=200,
        )
        result = client.database.rpc("get_user_stats", {"user_id": "123"}).execute()
        assert result["error"] is None
        assert result["data"]["total_posts"] == 42

    def test_single_modifier_multiple_rows(self, client):
        with rsps.RequestsMock() as rm:
            rm.add(
                rsps.GET,
                f"{BASE_URL}/api/database/records/posts",
                json=[{"id": "1"}, {"id": "2"}],
                status=200,
            )
            result = client.database.from_("posts").select().single().execute()
            assert result["data"] is None
            assert result["error"] is not None

    def test_maybe_single_no_rows(self, client):
        with rsps.RequestsMock() as rm:
            rm.add(
                rsps.GET,
                f"{BASE_URL}/api/database/records/posts",
                json=[],
                status=200,
            )
            result = client.database.from_("posts").select().maybe_single().execute()
            assert result["data"] is None
            assert result["error"] is None


# ---------------------------------------------------------------------------
# Storage
# ---------------------------------------------------------------------------


class TestStorage:
    @rsps.activate
    def test_upload_direct(self, client):
        # Strategy response: local/direct
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/storage/buckets/images/upload-strategy",
            json={
                "method": "direct",
                "uploadUrl": "/api/storage/buckets/images/objects/cover.jpg",
                "key": "cover.jpg",
                "confirmRequired": False,
            },
            status=200,
        )
        # Confirm upload
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/storage/buckets/images/objects/cover.jpg/confirm-upload",
            json={
                "bucket": "images",
                "key": "cover.jpg",
                "size": 11,
                "mimeType": "image/jpeg",
                "uploadedAt": "2024-01-15T10:30:00Z",
                "url": f"{BASE_URL}/api/storage/buckets/images/objects/cover.jpg",
            },
            status=200,
        )
        # Direct PUT target
        rsps.add(rsps.PUT, f"{BASE_URL}/api/storage/buckets/images/objects/cover.jpg", status=200)

        result = client.storage.from_("images").upload("cover.jpg", b"hello world", "image/jpeg")
        assert result["bucket"] == "images"
        assert result["key"] == "cover.jpg"

    @rsps.activate
    def test_remove(self, client):
        rsps.add(
            rsps.DELETE,
            f"{BASE_URL}/api/storage/buckets/images/objects/cover.jpg",
            json={"message": "Object deleted successfully"},
            status=200,
        )
        result = client.storage.from_("images").remove("cover.jpg")
        assert result["error"] is None
        assert result["data"]["message"] == "Object deleted successfully"


# ---------------------------------------------------------------------------
# AI
# ---------------------------------------------------------------------------


class TestAI:
    @rsps.activate
    def test_chat_completion(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/ai/chat/completions",
            json={
                "id": "chatcmpl-123",
                "object": "chat.completion",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "Paris"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 10, "completion_tokens": 1, "total_tokens": 11},
            },
            status=200,
        )
        response = client.ai.chat.completions.create(
            model="anthropic/claude-3.5-haiku",
            messages=[{"role": "user", "content": "Capital of France?"}],
        )
        assert response["choices"][0]["message"]["content"] == "Paris"

    @rsps.activate
    def test_image_generation(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/ai/images/generate",
            json={
                "created": 1705315200,
                "data": [{"b64_json": "iVBORw0KGgo="}],
            },
            status=200,
        )
        response = client.ai.images.generate(
            model="google/gemini-3-pro-image-preview",
            prompt="A sunset",
        )
        assert response["data"][0]["b64_json"] == "iVBORw0KGgo="

    @rsps.activate
    def test_embeddings(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/api/ai/embeddings",
            json={
                "object": "list",
                "data": [{"object": "embedding", "embedding": [0.1, 0.2, 0.3], "index": 0}],
                "metadata": {"model": "openai/text-embedding-3-small"},
            },
            status=200,
        )
        response = client.ai.embeddings.create(
            model="openai/text-embedding-3-small",
            input="Hello world",
        )
        assert response["data"][0]["embedding"] == [0.1, 0.2, 0.3]


# ---------------------------------------------------------------------------
# Functions
# ---------------------------------------------------------------------------


class TestFunctions:
    @rsps.activate
    def test_invoke_post(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/functions/hello-world",
            json={"message": "Hello, World!"},
            status=200,
        )
        result = client.functions.invoke("hello-world", body={"name": "World"})
        assert result["error"] is None
        assert result["data"]["message"] == "Hello, World!"

    @rsps.activate
    def test_invoke_get(self, client):
        rsps.add(
            rsps.GET,
            f"{BASE_URL}/functions/get-stats",
            json={"posts": 500},
            status=200,
        )
        result = client.functions.invoke("get-stats", method="GET")
        assert result["data"]["posts"] == 500

    @rsps.activate
    def test_invoke_error(self, client):
        rsps.add(
            rsps.POST,
            f"{BASE_URL}/functions/bad-fn",
            json={"error": "Function not found"},
            status=404,
        )
        result = client.functions.invoke("bad-fn")
        assert result["data"] is None
        assert result["error"] is not None


# ---------------------------------------------------------------------------
# HTTP error handling
# ---------------------------------------------------------------------------


class TestHttpClient:
    @rsps.activate
    def test_raises_insforge_error_on_4xx(self, client):
        rsps.add(
            rsps.GET,
            f"{BASE_URL}/api/database/records/nonexistent",
            json={
                "error": "TABLE_NOT_FOUND",
                "message": "Table 'nonexistent' does not exist",
                "statusCode": 404,
                "nextActions": "Check table name",
            },
            status=404,
        )
        with pytest.raises(InsForgeError) as exc_info:
            client.database.from_("nonexistent").select().execute()
        # execute() catches and returns error in the result dict
        # The raw HTTP layer raises InsForgeError which execute() wraps
        # Let's verify the error is propagated in result
        result = client.database.from_("nonexistent").select().execute()
        assert result["error"] is not None

    def test_auth_header_uses_anon_key_when_no_session(self, client):
        headers = client._http._build_headers()
        assert headers["Authorization"] == f"Bearer {ANON_KEY}"

    def test_auth_header_uses_access_token_when_session_set(self, client):
        client._http._state.set(access_token="user_token")
        headers = client._http._build_headers()
        assert headers["Authorization"] == "Bearer user_token"
        client._http._state.clear()
