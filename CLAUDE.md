# ALT Generator with Gemini - Development Guide

This document provides technical context for AI assistants (Claude) working on this VS Code extension project.

## Project Overview

**ALT Generator with Gemini** is a VS Code extension that automatically generates ALT attributes for images and aria-label attributes for videos using Google's Gemini API.

- **Language**: TypeScript
- **Platform**: VS Code Extension (>= v1.80.0)
- **External API**: Google Gemini API (2.5 Pro/Flash)
- **Repository**: https://github.com/akky709/vscode-alt-generator-with-gemini

## Core Features

1. **Image ALT Generation**: Analyzes images and generates descriptive ALT attributes
2. **Video aria-label Generation**: Creates accessibility labels for video elements
3. **Batch Processing**: Handles multiple tags in a single operation (10 items/chunk)
4. **Context-Aware AI**: Analyzes surrounding HTML elements for better descriptions
5. **Framework Detection**: Auto-detects Next.js, Vite, CRA, Astro, Remix for path resolution
6. **Decorative Image Detection**: Identifies decorative images by filename keywords
7. **Custom Prompts**: Advanced users can customize AI prompts via JSON config

## Architecture

### Directory Structure

```
src/
├── extension.ts              # Main entry point, command registration
├── constants.ts              # Constants (regex patterns, file extensions, etc.)
├── core/
│   ├── gemini.ts            # Gemini API client and request handling
│   └── prompts.ts           # Prompt templates for different modes
├── services/
│   ├── imageProcessor.ts    # Image ALT generation logic
│   ├── videoProcessor.ts    # Video aria-label generation logic
│   └── frameworkDetector.ts # Framework detection (Next.js, Vite, etc.)
└── utils/
    ├── config.ts            # Extension settings management
    ├── security.ts          # API key encryption/decryption (Secrets API)
    ├── tagUtils.ts          # HTML/JSX tag parsing utilities
    ├── fileUtils.ts         # File path resolution and image loading
    ├── textUtils.ts         # Text processing and sanitization
    ├── contextGrouping.ts   # Context analysis and tag grouping
    ├── errorHandler.ts      # Centralized error handling
    └── errors.ts            # Custom error classes
```

### Key Design Patterns

#### 1. **Service Layer Pattern**
- `imageProcessor.ts` and `videoProcessor.ts` handle domain-specific processing
- Separation of concerns between tag detection, API calls, and insertion

#### 2. **Strategy Pattern**
- Different generation modes (SEO vs A11Y)
- Different insertion modes (Auto vs Manual)
- Different context ranges (Narrow, Standard, Wide)

#### 3. **Secure Storage**
- API keys stored using VS Code's `SecretStorage` API (not in settings.json)
- Keys are encrypted at rest by VS Code

#### 4. **Memory Management**
- Batch processing in chunks (10 items max per chunk)
- Document cache cleared after each chunk
- Prevents memory buildup during large batch operations

## Critical Implementation Details

### Security Considerations

1. **ReDoS Protection**: All regex patterns are optimized to prevent catastrophic backtracking
   - See `constants.ts` for safe regex patterns
   - Never use user input directly in regex without sanitization

2. **API Key Handling**:
   ```typescript
   // NEVER store API keys in plain text
   // ALWAYS use SecretStorage API
   context.secrets.store('geminiApiKey', apiKey);
   const apiKey = await context.secrets.get('geminiApiKey');
   ```

3. **Input Validation**:
   - All user inputs must be sanitized before processing
   - File paths must be validated before reading
   - URL validation for external image sources

### Framework Detection

The extension detects React frameworks by checking for specific files:
- **Next.js**: `next.config.js`, `next.config.mjs`, `next.config.ts`
- **Vite**: `vite.config.js`, `vite.config.ts`
- **Create React App**: `react-scripts` in package.json
- **Astro**: `astro.config.mjs`, `astro.config.ts`
- **Remix**: `remix.config.js`

Path resolution for frameworks:
```
/image.png → [workspace]/public/image.png
```

### Context Analysis

When context analysis is enabled (via `contextAnalysisEnabled` setting or custom prompts with `{surroundingText}` placeholder), the extension analyzes surrounding elements:

1. **Parent Elements**: Extracts text from container elements (div, section, article, etc.)
2. **Sibling Elements**: Analyzes adjacent elements for context clues
3. **Search Range**: Fixed at ±150 characters (default)
4. **Context Caching**: Nearby tags (within 10 lines) share extracted context to reduce redundant analysis

### Batch Processing Flow

```
User Selection
    ↓
Tag Detection (regex)
    ↓
Filter Decorative Images
    ↓
Group by Context (if enabled)
    ↓
Chunk into groups of 10
    ↓
Process Each Chunk:
    - Load images/videos
    - Call Gemini API
    - Display confirmation (if Manual mode)
    - Insert attributes
    - Clear cache
    ↓
Complete
```

## Common Development Tasks

### Adding a New Generation Mode

1. Update `package.json` configuration schema
2. Add new enum value to settings
3. Create new prompt template in `prompts.ts`
4. Update `imageProcessor.ts` or `videoProcessor.ts` to handle new mode

### Modifying Regex Patterns

⚠️ **WARNING**: Always test regex patterns for ReDoS vulnerabilities
- Use online tools like https://devina.io/redos-checker
- Avoid nested quantifiers: `(a+)+`, `(a*)*`
- Use atomic groups or possessive quantifiers when possible

### Adding Support for New File Types

1. Update `SUPPORTED_EXTENSIONS` in `constants.ts`
2. Add file-specific comment format in `videoProcessor.ts` (if needed)
3. Test tag detection with new file type

### Customizing Prompts

Advanced users can provide custom prompts via `.vscode/alt-generator.settings.json`:

```json
{
  "imageAlt": {
    "seo": "Your custom SEO prompt...",
    "a11y": "Your custom A11Y prompt..."
  },
  "videoDescription": {
    "standard": "Your custom standard prompt...",
    "detailed": "Your custom detailed prompt..."
  },
  "context": "Instructions for how to use surrounding context...",
  "geminiApiModel": "gemini-2.5-pro"
}
```

**Structure Explanation:**

- **`imageAlt`**: Custom prompts for image ALT text generation
  - `seo`: Prompt for SEO-optimized ALT text
  - `a11y`: Prompt for accessibility-optimized ALT text

- **`videoDescription`**: Custom prompts for video description generation
  - `standard`: Prompt for short aria-label (max 10 words)
  - `detailed`: Prompt for comprehensive description (max 50 words)

- **`context`**: Shared prompt for context-aware generation (applies to both images and videos)
  - Available placeholders: `{surroundingText}`, `{mediaType}`
  - This prompt is **appended** to `imageAlt` and `videoDescription` prompts when context analysis is enabled
  - **Activation Logic**: Context analysis is automatically enabled when `needsSurroundingText()` returns `true`, which happens when any prompt (including `context`) contains the `{surroundingText}` placeholder
  - **Critical Design Rule**: Redundancy detection (returning `DECORATIVE` for empty alt) must **only** be defined in the `context` prompt. Never add redundancy instructions to `imageAlt` or `videoDescription` prompts to avoid conflicting AI instructions

- **`geminiApiModel`**: Gemini API model to use (optional)
  - Valid values: `"gemini-2.5-pro"` or `"gemini-2.5-flash"`
  - Default: `"gemini-2.5-flash"` (if not specified)
  - Use `"gemini-2.5-pro"` for higher accuracy at the cost of slower speed

## Testing Guidelines

### Manual Testing Checklist

- [ ] Single image ALT generation
- [ ] Batch image ALT generation (>10 images)
- [ ] Single video aria-label generation
- [ ] Batch video aria-label generation
- [ ] Decorative image detection
- [ ] Framework path resolution (Next.js, Vite, etc.)
- [ ] Context-aware generation (enabled via settings or custom prompts)
- [ ] Manual vs Auto insertion modes
- [ ] API error handling (429, 500, network errors)
- [ ] API key encryption/decryption
- [ ] Custom prompts loading

### Test Files

Create test HTML files with:
- Images with static paths (relative, absolute, URL)
- Images with dynamic paths (template literals, variables) - should show error
- Decorative images (filename with `icon-`, `bg-`, `deco-`)
- Videos with `<source>` tags
- Nested HTML structures for context testing

## Common Issues & Solutions

### "Image not found" Error
- **Cause**: Incorrect path resolution or missing workspace folder
- **Solution**: Ensure workspace is opened, check path format (relative vs absolute)

### "429 Too Many Requests"
- **Cause**: Gemini API rate limit exceeded
- **Solution**: Implement exponential backoff, reduce batch size

### "Content Blocked" Error
- **Cause**: Gemini's safety filters triggered
- **Solution**: This is expected behavior, user must manually write ALT text

### Memory Issues with Large Batches
- **Cause**: Too many images loaded in memory simultaneously
- **Solution**: Already handled via chunking (10 items/chunk), but can be reduced further

### ReDoS Attack
- **Cause**: Malicious input with nested patterns
- **Solution**: All patterns in `constants.ts` are already protected. Never add new patterns without testing.

## API Reference

### Gemini API Models

| Model | Speed | Quality | Use Case |
|-------|-------|---------|----------|
| gemini-2.5-pro | Slow | Highest | Best accuracy, batch processing |
| gemini-2.5-flash | Fast | High | Balanced (default) |

### Gemini API Limits

- **Free tier**: 15 RPM (requests per minute)
- **Paid tier**: 1000 RPM
- **Max image size**: 20MB (recommended: <10MB)
- **Max video duration**: N/A (uploaded as video file)

## Development Commands

```bash
# Compile TypeScript
npm run compile

# Watch mode (auto-compile on save)
npm run watch

# Lint code
npm run lint

# Package extension for distribution
npm run vscode:prepublish
vsce package
```

## Extension Configuration Schema

All settings are under the `altGenGemini.*` namespace:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `geminiApiKey` | string | "" | Encrypted API key (stored in SecretStorage) |
| `generationMode` | enum | "SEO" | SEO or A11Y optimization |
| `insertionMode` | enum | "confirm" | Auto or Manual insertion |
| `outputLanguage` | enum | "auto" | Auto, Japanese, or English |
| `contextAnalysisEnabled` | boolean | false | Enable context-aware generation |
| `decorativeKeywords` | array | ["icon-", "bg-", "deco-"] | Keywords for decorative image detection |
| `videoDescriptionLength` | enum | "standard" | Standard (aria-label) or Detailed (comment) |
| `customSettingsFilePath` | string | ".vscode/alt-generator.settings.json" | Path to custom settings file |

**Note:** The Gemini API model is no longer configurable via settings. By default, the extension uses `gemini-2.5-flash`. To use `gemini-2.5-pro`, specify `"geminiApiModel": "gemini-2.5-pro"` in your custom prompts JSON file.

## Code Style Guidelines

- **TypeScript**: Strict mode enabled
- **Naming**: camelCase for functions/variables, PascalCase for classes
- **Error Handling**: Always use try-catch for async operations
- **Comments**: JSDoc for public APIs, inline comments for complex logic
- **Security**: Never log API keys or sensitive data

## Performance Optimizations

The extension implements several performance optimizations:

### 1. Custom Prompts Loading Optimization
- **Before**: `loadCustomPrompts()` called 4-6 times per operation
- **After**: Loaded once per operation and passed to dependent functions
- **Impact**: 75-85% reduction in file I/O (from 400-600 reads to ~100 for 100 images)

### 2. Regex Pattern Pre-compilation
- **Implementation**: Module-level pre-compiled patterns for common HTML tags
- **Pattern Caching**: Close tag patterns cached using `Map<string, RegExp>`
- **Impact**: ~100ms saved per batch operation

### 3. Duplicate Detection Optimization
- **Before**: O(n²) complexity in `isDuplicateOrSubstring()`
- **After**: Centralized cache array to avoid redundant iterations
- **Impact**: Linear time complexity for duplicate text detection

### 4. Configuration Memoization
- **Implementation**: `getOutputLanguage()` result cached with automatic invalidation
- **Impact**: Eliminates redundant VS Code configuration API calls

### 5. Context Analysis Caching
- **Implementation**: Nearby images (within 10 lines) share extracted surrounding text
- **Impact**: Reduces redundant DOM parsing during batch operations

## Resources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [VS Code SecretStorage API](https://code.visualstudio.com/api/references/vscode-api#SecretStorage)
- [ReDoS Prevention Guide](https://owasp.org/www-community/attacks/Regular_expression_Denial_of_Service_-_ReDoS)

---

**Last Updated**: 2025-10-30
