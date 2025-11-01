# ALT Generator with Gemini

Automatically generate ALT attributes for img tags and aria-label attributes for video tags using Gemini API.

## Features

### 🎯 Basic Features (Available to All Users)

#### 🖼️ Image ALT Attribute Generation
- Automatically generate ALT attributes for `<img>` and `<Image>` tags
- Two generation modes: **SEO** (search engine optimized) and **A11Y** (accessibility optimized)
- Batch processing support
- Automatic decorative image detection by filename keywords (e.g., `icon-`, `bg-`)

#### 🎬 Video aria-label Generation
- Generate aria-label attributes for `<video>` tags
- Two modes: **Standard** (short aria-label) and **Detailed** (comprehensive description as HTML comment)
- Supports `<source>` tags within `<video>` elements
- File-type aware comments (HTML, JSX/TSX, PHP)

##### ⚠️ Important Accessibility Notice

The `aria-label` attribute is **insufficient** as alternative text (like `alt` for images) to visually describe video content.

This is an alternative way to convey titles or brief functions to assistive technology users, and **lacks the information needed** to convey visual information or detailed content within the video.

**Recommended accessibility approaches:**

1. **Detailed Information**: Provide visual titles and detailed descriptions before/after the video
2. **Audio Descriptions**: Use `<track kind="descriptions">` to provide detailed audio descriptions of the video content

**Use this feature only as a last resort when `aria-label` is your only option.**

### 🚀 Advanced Features

#### 📝 Context-Aware Generation (Optional)

Enable context analysis to generate more accurate descriptions by analyzing surrounding HTML elements:

**How to Enable:**
1. Open Settings (`Cmd+,` or `Ctrl+,`)
2. Search for "Alt Generator: Context Analysis Enabled"
3. Check the box to enable

**What it does:**
- Analyzes text in parent elements (div, section, article, etc.)
- Considers sibling elements before and after the image
- Detects redundant descriptions (returns `alt=""` when context already describes the image)

**When to use:**
- ✅ For better accuracy and context-aware descriptions
- ❌ When you need faster processing (context analysis adds overhead)

#### 🎨 Custom Prompts (Advanced)

Want even more control? Use **Custom Prompts** to unlock:

- **Fine-tuned AI Instructions**: Write your own prompts tailored to your needs
- **SEO Optimization**: Control keyword usage and description style
- **Advanced Context Rules**: Define custom redundancy detection logic
- **Model Selection**: Choose between `gemini-2.5-flash` (fast) and `gemini-2.5-pro` (accurate)

📚 **Learn how to set up Custom Prompts:** [https://note.com/akky709](https://note.com/akky709)

> **Note:** By default, this extension focuses on **direct image/video analysis** for simplicity and speed. Context analysis can be enabled via settings or through custom prompts configuration.

### 🔒 Security & Performance
- **Secure API Key Storage**: API keys are encrypted using VSCode's Secrets API
- **ReDoS Protection**: Regex patterns optimized to prevent catastrophic backtracking attacks
- **Memory Efficient**: Processes large batches in chunks (10 items per chunk) to minimize memory usage
- **Smart Caching**: Multiple caching strategies reduce redundant operations
  - Document text caching with version validation
  - Custom prompts caching
  - Surrounding text caching for nearby images (10-line proximity)
  - Regex pattern caching
- **Optimized Performance**: Pre-compiled regex patterns and memoized functions
- **Type-Safe API Responses**: Fully typed Gemini API response handling prevents runtime errors
- **Cancel Support**: Stop processing anytime during batch operations

## Supported Files

- **HTML** (.html) - Full support
- **PHP** (.php) - Static paths only
- **JavaScript/JSX** (.js, .jsx) - Static paths only
- **TypeScript/TSX** (.ts, .tsx) - Static paths only

### Supported Image Formats

- **Raster images**: JPG, PNG, GIF, WebP, BMP
- **⚠️ SVG not supported**: SVG files must be manually converted to PNG/JPG before processing (Gemini API limitation)

### Supported Image Paths

**✅ Supported:**
```html
<!-- Relative paths (from current file location) -->
<img src="./images/photo.jpg">
<img src="images/banner.png">

<!-- Root paths (from workspace root or framework's public directory) -->
<img src="/static/hero.jpg">

<!-- Absolute URLs -->
<img src="https://example.com/image.jpg">
<img src="http://example.com/photo.png">

<!-- JSX/TSX with static paths -->
<Image src="/static/hero.jpg" width={500} height={300} />
```

**❌ Not Supported (Dynamic values):**
```jsx
<Image src={imageUrl} />
<Image src={`/uploads/${id}.jpg`} />
<img src="<?php echo $url; ?>">
```

### 🚀 Framework-Specific Path Resolution

The extension automatically detects modern React frameworks and resolves root paths (`/`) to their `public` directory:

**Supported Frameworks:**
- **Next.js** - `/image.png` → `public/image.png`
- **Create React App** - `/image.png` → `public/image.png`
- **Vite** - `/image.png` → `public/image.png`
- **Astro** - `/image.png` → `public/image.png`
- **Remix** - `/image.png` → `public/image.png`

**⚠️ Important:** For framework projects, **always use root paths (starting with `/`)** for public directory files:

```tsx
// ✅ Correct - Root path (framework automatically detects)
<Image src="/logo.png" alt="" />  // Resolves to: public/logo.png

// ❌ Wrong - Relative path (looks in src directory)
<Image src="logo.png" alt="" />   // Error: Image not found
```

## Quick Start

### 1. Get Gemini API Key

1. Visit [Google AI Studio](https://aistudio.google.com/app/api-keys)
2. Click "Create API Key"
3. Copy the API key

### 2. Configure Extension

Press `Cmd+,` (Windows: `Ctrl+,`) and search for "Alt Generator"

**Required:**
- **Gemini API Key**: Paste your API key

**Optional:**
- **Generation Mode**: SEO or A11Y (default: SEO)
- **Insertion Mode**: Auto or Manual (default: Manual - review before insertion)
- **Output Language**: Auto, Japanese, or English (default: Auto)
- **Context Analysis Enabled**: Enable context-aware generation (default: false)
- **Decorative Keywords**: Customize keywords for decorative image detection
- **Video Description Length**: Standard (aria-label) or Detailed (HTML comment) (default: Standard)
- **Custom Prompts Path**: Path to custom prompts JSON file (default: `.vscode/alt-generator.settings.json`)

Or edit `settings.json`:
```json
{
  "altGenGemini.geminiApiKey": "YOUR_API_KEY",
  "altGenGemini.generationMode": "SEO",
  "altGenGemini.insertionMode": "confirm",
  "altGenGemini.outputLanguage": "auto",
  "altGenGemini.contextAnalysisEnabled": false,
  "altGenGemini.decorativeKeywords": ["icon-", "bg-", "deco-"],
  "altGenGemini.videoDescriptionLength": "standard",
  "altGenGemini.customPromptsPath": ".vscode/alt-generator.settings.json"
}
```

**🔐 API Key Security Note:**
After entering your API key in settings, it will be automatically:
- Encrypted and stored in VSCode's secure storage (Secrets API)
- Masked in the settings UI (displayed as `••••••••xxxx`)
- Never stored in plain text in `settings.json`

## Usage

### Generate ALT for Images

**Single Image:**
1. Place cursor anywhere in an `<img>` or `<Image>` tag
2. Press `Cmd+Alt+A` (Windows: `Ctrl+Alt+A`)

**Multiple Images (Batch Processing):**
1. Select a range of text containing multiple `<img>` or `<Image>` tags
2. Press `Cmd+Alt+A` (Windows: `Ctrl+Alt+A`)
3. All images in the selection will be processed automatically

**Via Command Palette:**
1. Place cursor in a tag or select multiple tags
2. Press `Cmd+Shift+P` (Windows: `Ctrl+Shift+P`)
3. Select "Generate ALT attribute for img tags"

### Generate aria-label for Videos

**Single Video:**
1. Place cursor anywhere in a `<video>` tag
2. Press `Cmd+Alt+V` (Windows: `Ctrl+Alt+V`)

**Multiple Videos (Batch Processing):**
1. Select a range of text containing multiple `<video>` tags
2. Press `Cmd+Alt+V` (Windows: `Ctrl+Alt+V`)
3. All videos in the selection will be processed automatically

**Via Command Palette:**
1. Place cursor in a tag or select multiple tags
2. Press `Cmd+Shift+P` (Windows: `Ctrl+Shift+P`)
3. Select "Generate aria-label attribute for video tags"

### Insertion Modes

The extension supports two insertion modes for both **images (ALT)** and **videos (aria-label/descriptions)**:

**Manual Mode (Default):**
- Generated text is shown in a preview dialog before insertion
- You can review and edit the text before applying
- Allows you to accept, modify, or reject each suggestion
- Recommended for quality control and batch processing

**Auto Mode:**
- Generated text is inserted immediately into your code
- Best for quick workflows and when you trust the AI output
- No additional confirmation required

**To change the insertion mode:**
1. Press `Cmd+,` (Windows: `Ctrl+,`) to open Settings
2. Search for "Alt Generator: Insertion Mode"
3. Choose "Auto" or "Manual"

### Video Description Modes

**Standard Mode (Default):**
- Generates a short aria-label (max 10 words) describing the video's purpose or function
- Inserted as `aria-label` attribute on the `<video>` tag
- Follows accessibility best practices

**Detailed Mode:**
- Generates comprehensive description (max 100 words) with accurate transcription of all dialogue and narration, plus important visual information
- Inserted as an HTML comment near the video tag (not as aria-label)
- Comment format automatically adapts to file type:
  - HTML: `<!-- Video description: ... -->`
  - JSX/TSX: `{/* Video description: ... */}`
  - PHP: `<?php /* Video description: ... */ ?>`
- Useful for creating text manuscripts for audio descriptions

## Decorative Images

Images with these keywords in filename are automatically assigned `alt=""`:
- `icon-`
- `bg-`
- `deco-`

Customize keywords in settings to match your project's naming conventions.

## Troubleshooting

### "Image not found" Error
- **For framework projects (Next.js, Vite, etc.):** Use root paths starting with `/` for public directory files
  - ✅ Correct: `<Image src="/logo.png" />`
  - ❌ Wrong: `<Image src="logo.png" />`
- Verify image path is correct
- Check that workspace folder is opened in VSCode
- Ensure the correct project folder (not parent directory) is opened

### "429 Too Many Requests" Error
- Wait 1 minute before retrying
- Process fewer images at once
- Add decorative keywords to skip unnecessary images

### Dynamic src Attributes Error
- Only static string paths are supported
- Variables, template literals, and function calls are not supported
- Use static paths like `"/images/photo.jpg"` instead

### "Content Blocked" Error
- Gemini API may block certain images due to safety filters
- This typically occurs with adult content, violence, or other sensitive material
- The API's safety policies cannot be overridden
- If an image is blocked, you'll need to manually write the alt text or use a different image

### Slow Performance with Large Files
- **Disable Context**: Turn off "Context Analysis Enabled" in settings for faster processing
- **Process in Smaller Batches**: Select fewer tags at once
- **Check File Size**: Large HTML files (>500KB) may slow down parsing

### Memory Issues
- The extension automatically processes batches in chunks of 10 items
- If you still experience issues, try processing fewer items at once
- Close other resource-intensive applications

## API Limits

The extension automatically manages API rate limits. For details about Gemini API limits and pricing, see the [official documentation](https://ai.google.dev/gemini-api/docs/quota).

## Performance & Best Practices

### Batch Processing
- **Chunk Size**: Large batches are automatically processed in chunks of 10 items
- **Memory Management**: Cache is cleared after each chunk to prevent memory buildup
- **Context Optimization**: Nearby tags (within 10 lines) share context extraction, reducing redundant analysis
- **Smart Prompts Loading**: Custom prompts are loaded once per operation instead of multiple times, reducing file I/O by 75-85%

### Context-Aware Generation
When **Context Analysis Enabled** is turned on in settings, the extension analyzes surrounding HTML elements to generate more accurate descriptions:
- Considers text in parent elements (div, section, article, etc.)
- Analyzes sibling elements before and after the image
- Intelligently detects redundant descriptions (returns `alt=""` when context already describes the image)

**Note:** Context analysis can also be enabled through custom prompts by including the `{surroundingText}` placeholder.

### Recommended Settings
- **For best accuracy**: Enable "Context Analysis Enabled"
- **For faster processing**: Disable context analysis
- **For large batches**: Use "Manual" insertion mode to review before applying

### Custom Prompts (Advanced)

For advanced users, this extension supports custom prompt configuration to fine-tune AI-generated text according to your specific requirements.

You can specify a custom settings JSON file path in the extension settings. By default, the extension looks for `.vscode/alt-generator.settings.json` in your workspace.

**Example Structure:**

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

**Explanation:**

- **`imageAlt`**: Custom prompts for image ALT text generation
  - `seo`: Prompt for SEO-optimized ALT text
  - `a11y`: Prompt for accessibility-optimized ALT text (supports `{charConstraint}` placeholder)

- **`videoDescription`**: Custom prompts for video description generation
  - `standard`: Prompt for short aria-label (max 10 words)
  - `detailed`: Prompt for comprehensive description (max 100 words)

- **`context`**: Shared prompt for context-aware generation (applies to both images and videos)
  - Available placeholders: `{surroundingText}`, `{mediaType}`
  - This prompt is **appended** to `imageAlt` and `videoDescription` prompts when context analysis is enabled
  - **Enabling Context Mode**: Context analysis is **automatically enabled** when any prompt contains the `{surroundingText}` placeholder. To disable, remove this placeholder from all prompts or delete the `context` field entirely.
  - **Important**: Redundancy detection (returning `DECORATIVE` for empty alt) should **only** be defined in the `context` prompt, not in `imageAlt`/`videoDescription` prompts, to avoid conflicting instructions

- **`geminiApiModel`**: Gemini API model to use (optional)
  - Valid values: `"gemini-2.5-pro"` or `"gemini-2.5-flash"`
  - Default: `"gemini-2.5-flash"` (if not specified)
  - Use `"gemini-2.5-pro"` for higher accuracy at the cost of slower speed

All fields are optional. If a field is not provided or empty, the default value will be used.

## Notes

- Internet connection required
- Video files: Recommended 10MB or less (max 20MB)
- Processing time depends on number of images and API model
- Free tier has usage limits - see Gemini API documentation
- API keys are securely stored and never transmitted except to Google's Gemini API

## License

MIT
