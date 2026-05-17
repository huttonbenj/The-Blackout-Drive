# Contributing to The Blackout Drive

Thank you for your interest in The Blackout Drive.

## License

This project is licensed under the **Business Source License 1.1 (BSL 1.1)**. By submitting a contribution (pull request, patch, or otherwise), you agree that your contribution will be licensed under the same terms and that Hutton Technologies LLC retains all rights to the contributed code under the BSL.

## How to Contribute

### Bug Reports

Open a [GitHub Issue](https://github.com/huttonbenj/The-Blackout-Drive/issues) with:

- A clear description of the bug
- Steps to reproduce
- Expected vs. actual behavior
- OS and hardware details (the drive runs on Windows, macOS, and Linux)

### Security Issues

**Do not open public issues for security vulnerabilities.** See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

### Feature Requests

Open a GitHub Issue tagged `enhancement`. Include:

- What problem the feature solves
- How you envision it working
- Whether it's compatible with the offline-first architecture (no internet dependency)

### Pull Requests

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Make your changes
4. Test locally — see [Getting Started](README.md#getting-started-dev-setup) for setup instructions
5. Submit a PR with a clear description of what changed and why

### Code Standards

- **Python (server.py):** Standard library only — no pip dependencies. Follow PEP 8.
- **JavaScript (UI):** Vanilla JS — no frameworks, no CDN imports. Everything must work offline.
- **CSS:** Vanilla CSS — no preprocessors, no Tailwind.
- **General:** All code must function in a fully air-gapped environment with zero network access.

## Development Notes

- Large files (AI models, Ollama binaries, library content) are **not** tracked in git. Use the scripts in `scripts/` to download them.
- The `_factory/` directory contains factory-default copies of all system files. If you modify a system file, update the corresponding factory copy.
- The `profiles/` directory contains BEACON's system prompt layers. Changes here require a model rebuild (`scripts/rebuild_model.sh`).
