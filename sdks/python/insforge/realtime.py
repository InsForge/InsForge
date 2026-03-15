"""
Realtime module for the InsForge Python SDK.

Provides WebSocket-based pub/sub using Socket.IO protocol.

Usage:
    client.realtime.connect()
    client.realtime.subscribe("chat:room-1")
    client.realtime.on("new_message", lambda payload: print(payload))
    client.realtime.publish("chat:room-1", "new_message", {"text": "Hello!"})
    client.realtime.unsubscribe("chat:room-1")
    client.realtime.disconnect()

Requirements:
    pip install "insforge[realtime]"
    # or: pip install python-socketio[client]
"""

from __future__ import annotations

import threading
from typing import Any, Callable


class RealtimeClient:
    """
    WebSocket-based realtime pub/sub client.

    Requires python-socketio to be installed:
        pip install "python-socketio[client]"
    """

    _CONNECT_TIMEOUT = 10  # seconds

    def __init__(self, http: Any) -> None:
        self._http = http
        self._sio: Any | None = None
        self._state: str = "disconnected"
        self._subscribed_channels: set[str] = set()
        self._listeners: dict[str, list[Callable]] = {}
        self._connect_lock = threading.Lock()
        self._connect_event = threading.Event()
        self._socket_id: str | None = None

    # ------------------------------------------------------------------
    # Connection
    # ------------------------------------------------------------------

    def connect(self) -> None:
        """
        Establish a WebSocket connection to the realtime server.

        Blocks until connected or raises on timeout (10 s).

        Raises:
            RuntimeError: If python-socketio is not installed.
            TimeoutError: If the server is unreachable within 10 seconds.
        """
        try:
            import socketio  # type: ignore
        except ImportError:
            raise RuntimeError(
                "python-socketio is required for realtime support. "
                'Install it with: pip install "python-socketio[client]"'
            )

        with self._connect_lock:
            if self._state == "connected":
                return
            if self._state == "connecting":
                # Wait for the pending connection
                if not self._connect_event.wait(timeout=self._CONNECT_TIMEOUT):
                    raise TimeoutError("Connection timeout after 10 seconds")
                return

            self._state = "connecting"
            self._connect_event.clear()

            token = self._http._state.access_token or self._http.anon_key
            base_url = self._http.base_url

            sio = socketio.Client(reconnection=True)
            self._sio = sio

            @sio.event
            def connect():
                self._state = "connected"
                self._socket_id = sio.get_sid()
                self._connect_event.set()
                self._dispatch("connect", None)

            @sio.event
            def connect_error(data):
                self._state = "disconnected"
                self._connect_event.set()
                self._dispatch("connect_error", data)

            @sio.event
            def disconnect(reason):
                self._state = "disconnected"
                self._subscribed_channels.clear()
                self._dispatch("disconnect", reason)

            @sio.on("*")
            def catch_all(event, data):
                self._dispatch(event, data)

            try:
                sio.connect(
                    base_url,
                    headers={"Authorization": f"Bearer {token}"},
                    wait_timeout=self._CONNECT_TIMEOUT,
                )
            except Exception as exc:
                self._state = "disconnected"
                self._connect_event.set()
                raise

            if not self._connect_event.wait(timeout=self._CONNECT_TIMEOUT):
                raise TimeoutError("Connection timeout after 10 seconds")

            if self._state != "connected":
                raise ConnectionError("Failed to connect to realtime server")

    def disconnect(self) -> None:
        """Disconnect from the realtime server and clear all subscriptions."""
        if self._sio:
            self._sio.disconnect()
            self._sio = None
        self._state = "disconnected"
        self._subscribed_channels.clear()

    # ------------------------------------------------------------------
    # Subscriptions
    # ------------------------------------------------------------------

    def subscribe(self, channel: str) -> dict[str, Any]:
        """
        Subscribe to a channel.

        Auto-connects if not already connected.

        Args:
            channel: Channel name (e.g., 'orders:123').

        Returns:
            Dict with keys: ok (bool), channel (str), error (optional dict).
        """
        if self._state != "connected":
            try:
                self.connect()
            except Exception as exc:
                return {
                    "ok": False,
                    "channel": channel,
                    "error": {"code": "CONNECTION_FAILED", "message": str(exc)},
                }

        result_event = threading.Event()
        result_container: dict[str, Any] = {}

        def ack(data: dict[str, Any]) -> None:
            result_container.update(data)
            result_event.set()

        self._sio.emit("subscribe", {"channel": channel}, callback=ack)

        if result_event.wait(timeout=10):
            ok = result_container.get("ok", False)
            if ok:
                self._subscribed_channels.add(channel)
            return result_container
        return {
            "ok": False,
            "channel": channel,
            "error": {"code": "TIMEOUT", "message": "Subscribe acknowledgement timed out"},
        }

    def unsubscribe(self, channel: str) -> None:
        """Unsubscribe from a channel (fire-and-forget)."""
        self._subscribed_channels.discard(channel)
        if self._sio and self._state == "connected":
            self._sio.emit("unsubscribe", {"channel": channel})

    def get_subscribed_channels(self) -> list[str]:
        """Return a list of currently subscribed channels."""
        return list(self._subscribed_channels)

    # ------------------------------------------------------------------
    # Publish
    # ------------------------------------------------------------------

    def publish(self, channel: str, event: str, payload: dict[str, Any]) -> None:
        """
        Publish a message to a channel.

        You must be subscribed to the channel before publishing.

        Args:
            channel: Target channel name.
            event: Event name.
            payload: Message payload dict.

        Raises:
            RuntimeError: If not connected.
        """
        if self._state != "connected" or not self._sio:
            raise RuntimeError("Not connected to realtime server. Call connect() first.")
        self._sio.emit(event, {"channel": channel, **payload})

    # ------------------------------------------------------------------
    # Event listeners
    # ------------------------------------------------------------------

    def on(self, event: str, callback: Callable) -> None:
        """
        Register a listener for an event.

        Reserved events: 'connect', 'connect_error', 'disconnect', 'error'.

        Args:
            event: Event name.
            callback: Callable invoked with the event payload.
        """
        self._listeners.setdefault(event, []).append(callback)

    def off(self, event: str, callback: Callable) -> None:
        """
        Remove a previously registered listener.

        Args:
            event: Event name.
            callback: The exact callback to remove.
        """
        listeners = self._listeners.get(event, [])
        try:
            listeners.remove(callback)
        except ValueError:
            pass

    def once(self, event: str, callback: Callable) -> None:
        """
        Register a one-time listener that auto-removes after first invocation.

        Args:
            event: Event name.
            callback: Callable invoked once with the payload.
        """
        def _wrapper(payload: Any) -> None:
            self.off(event, _wrapper)
            callback(payload)

        self.on(event, _wrapper)

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def is_connected(self) -> bool:
        """True when connected to the realtime server."""
        return self._state == "connected"

    @property
    def connection_state(self) -> str:
        """Current state: 'disconnected', 'connecting', or 'connected'."""
        return self._state

    @property
    def socket_id(self) -> str | None:
        """Socket ID, available when connected."""
        return self._socket_id

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _dispatch(self, event: str, payload: Any) -> None:
        for cb in list(self._listeners.get(event, [])):
            try:
                cb(payload)
            except Exception:
                pass
