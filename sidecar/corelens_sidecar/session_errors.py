"""The one error a session raises: a contract status and a message."""
from __future__ import annotations


class SessionError(Exception):
    def __init__(self, status: str, message: str):
        super().__init__(message)
        self.status = status
