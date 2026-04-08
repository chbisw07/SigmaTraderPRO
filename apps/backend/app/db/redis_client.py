from __future__ import annotations

import redis

from app.core.config import settings


def get_redis() -> redis.Redis:
    return redis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
        socket_connect_timeout=1,
        socket_timeout=1,
    )

