"""Broker adapter boundary (broker-agnostic).

This package defines the adapter contract used by all broker integrations.
Concrete brokers (Angel/Zerodha/Fyers) must implement the contract and keep
broker-specific details encapsulated behind it.
"""
