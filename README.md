# Rekapu

<div align="center">
  <img src="website/public/hero_screenshot.png" alt="Rekapu Screenshot" width="600">
  
  <h3>Learn while procrastinating</h3>
  <p>Transform your distractions into learning moments with scientifically-proven spaced repetition.</p>
  
  <p>
    <a href="#features">Features</a> •
    <a href="#installation">Installation</a> •
    <a href="#usage">Usage</a> •
    <a href="#development">Development</a> •
    <a href="CONTRIBUTING.md">Contributing</a> •
    <a href="CHANGELOG.md">Changelog</a>
  </p>
</div>

---

## What is Rekapu?

Rekapu is a browser extension that combines spaced repetition learning with website access control. Instead of blocking you with a wall, it shows you flashcards when you visit distracting websites. Your knowledge grows while your focus improves - no extra apps, no dedicated study time, just learning integrated into your day.

**The key difference:** Unlike traditional website blockers that redirect you to a new page (losing your scroll position and context), Rekapu uses an **overlay approach**. After answering a card, you continue exactly where you left off - no reload, no lost context.

## Features

### 🧠 Spaced Repetition
Science-backed algorithm that shows cards at optimal intervals. Rate difficulty (Again, Hard, Good, Easy) and let the algorithm handle scheduling for maximum retention.

### 🔊 Text-to-Speech
Listen to your cards with natural voice synthesis powered by Google TTS. Perfect for audio learners and language practice. *Requires your own API key.*

### 📊 Daily Goals & Streaks  
Activity calendar visualizes your consistency. Build learning streaks, hit daily goals, and watch your progress compound over time.

### 📦 Anki Import
Already have decks in Anki? Import plain text (.txt) or Anki package (.apkg) files instantly. No need to recreate your cards - bring your existing knowledge base.

### ✍️ Markdown Support
Format cards with markdown syntax. Add code blocks, lists, bold text, links, and embed images. Live preview while editing ensures cards look exactly as intended.

### 🎴 Multiple Card Types
- **Basic (Show Answer)**: Traditional flashcard with front/back
- **Cloze Deletion**: Fill-in-the-blank with `{{c1::text}}` syntax, supporting multiple deletions per card

### 🔒 100% Private
All data stored locally in your browser using IndexedDB. No servers, no tracking, no accounts. Your cards and browsing habits stay completely private.

### 🌍 Multi-language Support
Currently available in **English**, **Russian**, and **Ukrainian**. [More translations welcome!](CONTRIBUTING.md)

## Installation

### From Chrome Web Store

Install Rekapu directly from the Chrome Web Store:

**[→ Add to Chrome](https://chromewebstore.google.com/detail/rekapu/lbbjjejkepnemhcbhcccjcenkhmkkbdm)**

### Supported Browsers
Any Chromium-based browser: Chrome, Brave, Edge, Opera, Vivaldi (version 88 or higher)

### From Source (For Developers)

If you want to contribute or modify the extension:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/k-tkachov/rekapu.git
   cd rekapu
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Build the extension:**
   ```bash
   npm run build
   ```

4. **Load in your browser:**
   - Open Chrome/Brave/Edge and navigate to `chrome://extensions/`
   - Enable "Developer mode" in the top right
   - Click "Load unpacked" and select the `dist` folder
   - The Rekapu extension is now installed!

## Usage

### Quick Start

1. **Add domains to block**
   - Click the Rekapu extension icon
   - Go to "Domains" tab
   - Add sites you want to block (e.g., `twitter.com`, `reddit.com`)

2. **Create your first cards**
   - Go to "Cards" tab
   - Click "Add Card"
   - Write your question and answer
   - Use markdown for rich formatting

3. **Configure settings** (optional)
   - Adjust cooldown periods (global or per-domain)
   - Set daily study goals
   - Customize theme and display options

### Creating Cards

**Three ways to add cards:**

1. **Manual creation:** Click "Add Card" in the extension popup
2. **Quick capture:** Select text on any page, right-click, and choose "Add selection as card"
3. **Import from Anki:** Import Anki decks in plain text format (.txt) or Anki package format (.apkg)

**Card types:**

```markdown
# Basic Card
Front: What is the capital of France?
Back: Paris

# Cloze Deletion Card
The capital of {{c1::France}} is {{c2::Paris}}.
```

### Studying Without Blocking

Open the extension popup and click "Study Due Cards" to review all cards in one focused session. When you're done, all blocked sites become accessible again.

## Development

### Project Structure

```
src/
├── background/         # Background service worker
├── content/           # Content scripts (overlay blocking)
├── popup/             # Extension popup UI (React + Chakra UI)
├── dashboard/         # Main dashboard UI (React)
├── storage/           # IndexedDB storage management
├── spaced-repetition/ # SR algorithm implementation
├── tts/               # Text-to-speech providers
├── utils/             # Shared utilities
└── _locales/          # Translation files (en, ru, uk)
```

### Tech Stack

- **Framework:** React + TypeScript
- **UI Library:** Chakra UI (Material Design 3-inspired dark theme)
- **Storage:** IndexedDB (100MB+ capacity)
- **Markdown:** marked.js with live preview
- **Build:** Webpack
- **Extension:** Chrome Manifest V3

### Development Commands

```bash
npm run build       # Production build
npm run build:dev   # Development build
npm run watch       # Development with file watching
npm test           # Run test suite
npm run lint       # Check code style
npm run type-check # TypeScript validation
```

### Architecture Highlights

#### Overlay Blocking System
Rekapu uses an innovative iframe overlay approach that preserves page state, scroll position, and JavaScript context. This provides a seamless experience compared to traditional redirect-based blocking.

**Benefits:**
- ✅ Page state preserved
- ✅ Zero additional load time  
- ✅ Seamless user experience

#### Universal Markdown Rendering
- Same renderer (marked.js) used in card editor and blocking interface
- Isolated CSS prevents theme conflicts
- Live preview with scroll synchronization
- Consistent rendering across all contexts

#### Efficient Storage
- IndexedDB for high-performance local storage
- Indexed queries for spaced repetition optimization
- Storage usage monitoring and intelligent cleanup
- Supports 100MB+ capacity

## Contributing

We welcome contributions! However, **at this time we are only accepting:**

- 🌍 **Translations** - Help localize Rekapu for more languages
- 🐛 **Bug Fixes** - Fix existing issues and improve stability

**We are NOT currently accepting:**
- ❌ New features
- ❌ Major refactoring or architectural changes

Please read our [Contributing Guidelines](CONTRIBUTING.md) for detailed information on how to contribute translations or bug fixes.

## License

Rekapu is licensed under **GNU General Public License v3.0 (GPL-3.0)**.

This means:
- ✅ Free to use, modify, and distribute
- ✅ Derivatives must also be open source (GPL-3.0)
- ✅ Commercial use is allowed
- ✅ You must disclose source code of any modifications

See [LICENSE](LICENSE) file for full details.

---

<div align="center">
  <p>Made with ❤️ for learners everywhere</p>
  <p>Licensed under GPL-3.0</p>
</div>
