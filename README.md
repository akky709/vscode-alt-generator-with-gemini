# ALT Generator with Gemini

Automatically generate ALT attributes for img tags and aria-label attributes for video tags using Gemini API.

## Features

### 🖼️ Image ALT Attribute Generation
- Automatically generate ALT attributes for `<img>` and `<Image>` tags
- Two generation modes: **SEO** (search engine optimized) and **A11Y** (accessibility optimized)
- Batch processing support
- Automatic decorative image detection (sets `alt=""`)

### 🎬 Video aria-label Generation
- Generate aria-label attributes for `<video>` tags
- Analyzes video content to create descriptions

#### ⚠️ Important Accessibility Notice

The `aria-label` attribute is **insufficient** as alternative text (like `alt` for images) to visually describe video content.

This is an alternative way to convey titles or brief functions to assistive technology users, and **lacks the information needed** to convey visual information or detailed content within the video.

**Recommended accessibility approaches:**

1. **Detailed Information**: Provide visual titles and detailed descriptions before/after the video
2. **Audio Descriptions**: Use `<track kind="descriptions">` to provide detailed audio descriptions of the video content

**Use this feature only as a last resort when `aria-label` is your only option.**

### 🎯 Smart Features
- **Decorative Image Detection**: Automatically identifies decorative images by filename keywords (e.g., `icon-`, `bg-`)
- **Context-Aware Generation**: Analyzes surrounding text to generate more accurate descriptions
- **Batch Processing Optimization**: Efficiently processes multiple tags with memory-efficient chunking
- **Cancel Support**: Stop processing anytime during batch operations

### 🔒 Security & Performance
- **Secure API Key Storage**: API keys are encrypted using VSCode's Secrets API
- **ReDoS Protection**: Regex patterns optimized to prevent catastrophic backtracking attacks
- **Memory Efficient**: Processes large batches in chunks (10 items per chunk) to minimize memory usage
- **Document Caching**: Smart caching reduces redundant DOM parsing during batch operations
- **Type-Safe API Responses**: Fully typed Gemini API response handling prevents runtime errors

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
- **Gemini API Model**: Choose from Pro 2.5 (most advanced), Flash 2.5 (fast & intelligent, recommended), or Flash-Lite 2.5 (ultra-fast)
- **Generation Mode**: SEO or A11Y
- **Insertion Mode**: Auto (insert immediately) or Confirm (review before insertion)
- **Output Language**: Auto, Japanese, or English
- **Context Enabled**: Enable/disable surrounding text analysis (default: enabled)
- **Context Range**: How much surrounding text to analyze - Narrow (500 chars), Standard (1500 chars), Wide (3000 chars), or Very Wide (5000 chars)
- **Decorative Keywords**: Customize keywords for decorative image detection

Or edit `settings.json`:
```json
{
  "altGenGemini.geminiApiKey": "YOUR_API_KEY",
  "altGenGemini.geminiApiModel": "gemini-2.5-flash",
  "altGenGemini.generationMode": "SEO",
  "altGenGemini.insertionMode": "auto",
  "altGenGemini.outputLanguage": "auto",
  "altGenGemini.contextEnabled": true,
  "altGenGemini.contextRange": "standard",
  "altGenGemini.decorativeKeywords": ["icon-", "bg-", "deco-"]
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
- **Reduce Context Range**: Switch from "Very Wide" to "Standard" or "Narrow"
- **Disable Context**: Turn off context analysis for faster processing
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
- **Context Optimization**: Nearby tags share context extraction, reducing API calls

### Context-Aware Generation
When **Context Enabled** is on, the extension analyzes surrounding HTML elements to generate more accurate descriptions:
- Considers text in parent elements (div, section, article, etc.)
- Analyzes sibling elements before and after the image
- Intelligently detects redundant descriptions (returns `alt=""` when context already describes the image)

### Recommended Settings
- **For best accuracy**: Context Range = "Wide" or "Very Wide"
- **For faster processing**: Context Range = "Narrow" or disable context
- **For large batches**: Use "Confirm" insertion mode to review before applying

## Notes

- Internet connection required
- Video files: Recommended 10MB or less (max 20MB)
- Processing time depends on number of images and API model
- Free tier has usage limits - see Gemini API documentation
- API keys are securely stored and never transmitted except to Google's Gemini API

## License

MIT
