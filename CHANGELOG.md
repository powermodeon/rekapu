# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2025-12-13

### Added
- Anki .apkg file import support with full template rendering
- Support for zstd-compressed Anki databases (Anki 2.1.50+)
- Automatic quick-start page opening on first installation
- Media file extraction and storage from .apkg files
- Advanced Anki template syntax support (conditionals, hints, type-in fields)

### Fixed
- Domain list now updates correctly when removing domains
- Markdown list rendering improved
- Card snapshot consistency in tests

## [1.0.1] - 2025-11-20

### Fixed
- Improved markdown rendering consistency across blocking interface and card editor
- Fixed markdown image styling (centered images with proper width)
- Extracted markdown renderer to centralized utility for better maintainability

### Changed
- Updated Chrome Web Store extension name to full descriptive title
- Updated package.json author information

## [1.0.0] - 2025-11-19

### Added
- Initial release of Rekapu browser extension
- Spaced repetition algorithm with 4 difficulty ratings (Again, Hard, Good, Easy)
- Overlay-based website blocking that preserves page state and scroll position
- Two card types: Basic (Show Answer) and Cloze Deletion
- Markdown support with live preview for card formatting
- Text-to-Speech integration with Google TTS provider
- Daily goals and activity calendar with streak tracking
- Anki import functionality for plain text (.txt) files
- Multi-language support (English, Russian, Ukrainian)
- IndexedDB storage for local data persistence
- Backup and restore functionality
- Statistics tracking and visualization
- Per-domain and global cooldown configuration
- Quick card creation from text selection via context menu
- Standalone study mode without blocking
- Dark theme with Material Design 3-inspired UI
- Chrome Web Store publication

[Unreleased]: https://github.com/powermodeon/rekapu/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/powermodeon/rekapu/compare/v1.0.1...v1.1.0
[1.0.1]: https://github.com/powermodeon/rekapu/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/powermodeon/rekapu/releases/tag/v1.0.0
