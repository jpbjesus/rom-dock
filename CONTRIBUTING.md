# Contributing to ROM Dock

Before starting a substantial change, open an issue describing the problem and intended behavior. Support for other consoles and protocols is on the roadmap; new integrations should state the capabilities and limitations of their protocol.

## Setup

Follow the installation and development instructions in the README. Use your own test data; do not include ROMs, BIOS files, credentials, or commercial content in the repository.

## Checks

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend run build
# With the server running on port 8765 and Chromium installed:
cd frontend && npm test
```

Pull request descriptions should identify the problem, resulting behavior, validation performed, and any limitations. Visual changes should include desktop and mobile screenshots in the affected themes, using demonstration data.

## Conventions

- Write public documentation, issues, and pull requests in English, using formal, objective language.
- The interface is currently in Portuguese; keep its labels consistent until localization is implemented.
- Do not commit credentials or machine-specific data.
- Validate paths and the connection generation for remote operations.
- Preserve original files if transfers or publication fail.
- Respect reduced motion preferences and keyboard navigation.
- Distinguish available functionality from planned improvements.
