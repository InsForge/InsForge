# InsForge Python SDK

Official Python SDK for [InsForge](https://insforge.app) – Backend as a Service.

## Installation

```bash
pip install insforge
```

Requires Python 3.9+.

## Quick Start

```python
import asyncio
from insforge import create_client

client = create_client(
    base_url="https://your-app.region.insforge.app",
    anon_key="your-anon-key",
)

async def main():
    # Auth
    result = await client.auth.sign_in_with_password(
        email="user@example.com",
        password="password123",
    )
    if result["error"]:
        print("Login failed:", result["error"].message)
        return
    print("Logged in:", result["data"])

    # Database
    result = await client.database.from_("posts").select("*").limit(10).execute()
    print("Posts:", result["data"])

    # Storage
    with open("avatar.png", "rb") as f:
        result = await client.storage.from_("avatars").upload(
            "user/avatar.png", f.read(), content_type="image/png"
        )
    print("Uploaded:", result["data"])

    # AI
    response = await client.ai.chat.completions.create(
        model="openai/gpt-4o",
        messages=[{"role": "user", "content": "Hello!"}],
    )
    print(response["choices"][0]["message"]["content"])

asyncio.run(main())
```

## Modules

### `client.auth`

| Method | Description |
|--------|-------------|
| `sign_up(email, password, ...)` | Register a new user |
| `sign_in_with_password(email, password)` | Login with email/password |
| `sign_out()` | Logout |
| `sign_in_with_o_auth(provider, redirect_to)` | OAuth sign-in |
| `exchange_o_auth_code(code, code_verifier)` | Exchange OAuth code |
| `get_current_user()` | Get the logged-in user |
| `refresh_session(refresh_token)` | Refresh the session |
| `get_profile(user_id)` | Get user profile |
| `set_profile(profile)` | Update current user's profile |
| `resend_verification_email(email)` | Resend verification email |
| `verify_email(email, otp)` | Verify email with OTP |
| `send_reset_password_email(email)` | Send password reset email |
| `reset_password(new_password, otp)` | Reset password |
| `get_public_auth_config()` | Get auth configuration |

### `client.database`

```python
# SELECT
result = await client.database.from_("users") \
    .select("id, name, email") \
    .eq("active", True) \
    .order("created_at", ascending=False) \
    .limit(20) \
    .execute()

# INSERT
result = await client.database.from_("posts") \
    .insert([{"title": "Hello", "body": "World"}])

# UPDATE
result = await client.database.from_("posts") \
    .eq("id", 5) \
    .update({"title": "Updated"})

# DELETE
result = await client.database.from_("posts") \
    .eq("id", 5) \
    .delete()

# RPC
result = await client.database.rpc("get_stats", {"user_id": "abc"})

# Raw SQL (admin only)
result = await client.database.query(
    "SELECT * FROM users WHERE email = $1", ["user@example.com"]
)
```

### `client.storage`

```python
bucket = client.storage.from_("my-bucket")

# Upload
result = await bucket.upload("path/file.png", file_bytes, content_type="image/png")

# Download
result = await bucket.download("path/file.png")
file_bytes = result["data"]

# List
result = await bucket.list(prefix="path/", limit=50)

# Delete
result = await bucket.remove("path/file.png")

# Get public URL
url = bucket.get_public_url("path/file.png")
```

### `client.ai`

```python
# Chat completion
response = await client.ai.chat.completions.create(
    model="openai/gpt-4o",
    messages=[
        {"role": "system", "content": "You are a helpful assistant."},
        {"role": "user", "content": "What is 2+2?"},
    ],
    temperature=0.7,
)

# Streaming
stream = await client.ai.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Tell me a story"}],
    stream=True,
)
async for chunk in stream:
    delta = chunk["choices"][0].get("delta", {}).get("content", "")
    print(delta, end="", flush=True)

# Embeddings
result = await client.ai.embeddings.create(
    model="openai/text-embedding-3-small",
    input="Hello world",
)

# Image generation
result = await client.ai.images.generate(
    model="openai/dall-e-3",
    prompt="A sunset over the ocean",
    size="1024x1024",
)
```

### `client.realtime`

```python
# Connect
await client.realtime.connect()

# Subscribe to a channel
result = await client.realtime.subscribe("chat:room-1")

# Listen for events
def on_message(data):
    print("Received:", data)

client.realtime.on("chat:room-1", on_message)

# Publish
await client.realtime.publish("chat:room-1", "message", {"text": "Hello!"})

# Unsubscribe
await client.realtime.unsubscribe("chat:room-1")

# Disconnect
await client.realtime.disconnect()
```

### `client.functions`

```python
result = await client.functions.invoke(
    "my-function",
    body={"key": "value"},
    method="POST",
)
```

### `client.emails`

```python
result = await client.emails.send(
    to="recipient@example.com",
    subject="Hello",
    html="<p>Hello from InsForge!</p>",
)
```

## Error Handling

All methods return `{"data": ..., "error": ...}`. Check `error` before using `data`:

```python
result = await client.auth.sign_up(email="a@b.com", password="pass")
if result["error"]:
    print(result["error"].message)      # Human-readable message
    print(result["error"].status_code)  # HTTP status code
    print(result["error"].error)        # Error code string
else:
    print(result["data"])
```

## Async Context Manager

```python
async with create_client(...) as client:
    result = await client.auth.get_current_user()
```

## License

Apache-2.0
