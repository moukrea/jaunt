"""Standard Web Push sent directly by the host; no third-party notification account."""
from __future__ import annotations

import asyncio
import json
import time
from urllib.parse import urlparse

from .crypto import unb64


def validate_subscription(value: dict) -> None:
    endpoint = value.get("subscription", {}).get("endpoint", "")
    url = urlparse(endpoint)
    # Prevent a malformed subscription from turning this into an arbitrary HTTP client.
    allowed = ("fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com",
               "web.push.apple.com", "notify.windows.com")
    if url.scheme != "https" or not any(url.hostname == h or (url.hostname or "").endswith("." + h) for h in allowed):
        raise ValueError("Unsupported Web Push endpoint")
    if len(unb64(value.get("vapidPrivate", ""))) != 32:
        raise ValueError("Invalid push sender key")
    keys = value["subscription"].get("keys", {})
    if len(unb64(keys.get("p256dh", ""))) != 65 or len(unb64(keys.get("auth", ""))) != 16:
        raise ValueError("Invalid push subscription keys")


async def deliver(value: dict, payload: dict) -> str:
    def send() -> str:
        try:
            from pywebpush import webpush, WebPushException
        except ImportError:
            return "Push dependency missing: reinstall Jaunt with its dependencies"
        try:
            webpush(subscription_info=value["subscription"],
                    data=json.dumps(payload, separators=(",", ":")),
                    vapid_private_key=value["vapidPrivate"],
                    vapid_claims={"sub": "mailto:jaunt@localhost.invalid",
                                  "exp": int(time.time()) + 6 * 3600},
                    ttl=3600, timeout=12)
            return "sent"
        except WebPushException as exc:
            code = getattr(getattr(exc, "response", None), "status_code", None)
            return "expired" if code in (404, 410) else f"Push service rejected the message ({code or 'network error'})"
        except Exception as exc:
            return f"Push delivery failed ({type(exc).__name__})"
    return await asyncio.to_thread(send)
