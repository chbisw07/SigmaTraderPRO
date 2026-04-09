"""Canonical instrument registry (broker-agnostic).

Downstream code must rely on canonical instrument IDs and resolve broker-specific
symbols/tokens through mapping records, not the other way around.
"""
