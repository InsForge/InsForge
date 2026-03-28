"""Unit tests for the Auth module."""
import pytest
import httpx
import respx

from insforge import create_client
from insforge.errors import InsForgeError

BASE_URL = "http://localhost:7130"


@pytest.fixture
def client():
    return create_client(base_url=BASE_URL, anon_key="test-key")


@respx.mock
@pytest.mark.asyncio
async def test_sign_up_success(client):
    respx.post(f"{BASE_URL}/api/auth/users").mock(
        return_value=httpx.Response(201, json={"id": "user-1", "email": "a@b.com"})
    )
    result = await client.auth.sign_up(email="a@b.com", password="secret")
    assert result["error"] is None
    assert result["data"]["id"] == "user-1"


@respx.mock
@pytest.mark.asyncio
async def test_sign_up_error(client):
    respx.post(f"{BASE_URL}/api/auth/users").mock(
        return_value=httpx.Response(400, json={"error": {"message": "Email taken", "code": "EMAIL_EXISTS"}})
    )
    result = await client.auth.sign_up(email="a@b.com", password="secret")
    assert result["data"] is None
    assert isinstance(result["error"], InsForgeError)
    assert result["error"].message == "Email taken"


@respx.mock
@pytest.mark.asyncio
async def test_sign_in_stores_token(client):
    respx.post(f"{BASE_URL}/api/auth/sessions").mock(
        return_value=httpx.Response(200, json={"accessToken": "jwt-abc", "user": {"id": "u1"}})
    )
    result = await client.auth.sign_in_with_password(email="a@b.com", password="secret")
    assert result["error"] is None
    assert client._http._access_token == "jwt-abc"


@respx.mock
@pytest.mark.asyncio
async def test_sign_out_clears_token(client):
    client._http.set_access_token("jwt-abc")
    respx.post(f"{BASE_URL}/api/auth/logout").mock(
        return_value=httpx.Response(200, json={"message": "ok"})
    )
    result = await client.auth.sign_out()
    assert client._http._access_token is None
