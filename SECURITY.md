# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.2.x   | :white_check_mark: |
| < 0.2   | :x:                |

## Reporting a Vulnerability

This project parses untrusted `.doc` (OLE2/CFB) files entirely in the browser.
While the parser is designed to handle malformed input gracefully, please report any
security issues you find.

**Please do NOT file a public issue for security vulnerabilities.**

Send a private report to the project maintainer with:

- A clear description of the vulnerability
- Steps to reproduce
- The impact (DoS, arbitrary code execution, information disclosure, etc.)
- Any suggested fixes

You should receive a response within 7 days. If the issue is confirmed, a fix
will be prepared and released as soon as possible, typically within 30 days.

## Scope

In scope for this project:

- Buffer overflows or memory issues in the OLE2/FIB parser
- ReDoS (Regular Expression Denial of Service) in text cleaning or search
- XSS via document content rendering
- Web Worker security issues

Out of scope:

- Issues in browser implementations of the FileReader, fetch, or Worker APIs
- Issues in `vue`, `vite`, or other upstream dependencies (please report upstream)
