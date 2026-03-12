#!/usr/bin/env python3
"""
Test file for TruffleHog ignore functionality.

This file contains fake secrets to test the # trufflehog:ignore comment feature.
"""

# This should be detected (no ignore comment)
fake_aws_key = "AKIAIOSFODNN7EXAMPLE"

# This should be ignored (has trufflehog:ignore comment)
fake_github_token = "ghp_1234567890abcdefghijklmnopqrstuvwxyz"  # trufflehog:ignore

# Another test case - this should be detected
test_secret = "sk_test_1234567890abcdefghijklmnopqrstuvwxyz"

# This should be ignored
another_fake = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"  # trufflehog:ignore
