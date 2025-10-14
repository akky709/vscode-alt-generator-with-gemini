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
- **Gemini API Model**: Choose from Pro 2.5 (most advanced), Flash 2.5 (fast & intelligent, recommended), or Flash-Lite 2.5 (ultra-fast)
- **Generation Mode**: SEO or A11Y
- **Insertion Mode**: Auto (insert immediately) or Manual (review before insertion)
- **Output Language**: Auto, Japanese, or English
- **Decorative Keywords**: Customize keywords for decorative image detection
- **Custom Prompts**: Override default prompts for SEO, A11Y, or video modes

Or edit `settings.json`:
```json
{
  "altGenGemini.geminiApiKey": "YOUR_API_KEY",
  "altGenGemini.geminiApiModel": "gemini-2.5-flash",
  "altGenGemini.generationMode": "SEO",
  "altGenGemini.insertionMode": "auto",
  "altGenGemini.outputLanguage": "auto",
  "altGenGemini.decorativeKeywords": ["icon-", "bg-", "deco-"]
}
```

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

## Custom Prompts

You can customize the prompts used for generating ALT text and aria-labels. Leave empty to use the built-in defaults.

### Default Prompt for SEO Mode

```
You are an SEO expert. Analyze the provided image and generate the most effective single-sentence ALT text for SEO purposes.

[CONSTRAINTS]
1. Include 3-5 key search terms naturally.
2. The description must be a single, concise sentence.
3. Avoid unnecessary phrases like "image of" or "photo of" at the end.
4. Do not include any information unrelated to the image.

Return only the generated ALT text, without any further conversation or explanation.
```

### Default Prompt for A11Y Mode

```
You are a web accessibility expert. Analyze the provided image's content and the role it plays within the page's context in detail. Your task is to generate ALT text that is completely understandable for users with visual impairments.

[CONSTRAINTS]
1. Completely describe the image content and do not omit any details.
2. Where necessary, include the image's background, colors, actions, and emotions.
3. The description must be a single, cohesive sentence between 100 and 200 characters.
4. Do not include the words "image" or "photo".

Return only the generated ALT text. No other conversation or explanation is required.
```

### Default Prompt for Video aria-label

```
You are a Web Accessibility and UX expert. Analyze the provided video content in detail and identify the role it plays within the page's context. Your task is to generate the optimal ARIA-LABEL text that briefly explains the video's purpose or function.

[CONSTRAINTS]
1. The generated ARIA-LABEL text must be a very short phrase, **no more than 10 words**.
2. Focus on the video's **purpose or function**, not its **content or visual description**. (e.g., product demo, operation tutorial, background animation, etc.)
3. Prioritize conciseness and use common language that will be easily understood by the user.
4. Do not include the words "video," "movie," or "clip".

Return only the generated ARIA-LABEL text. No other conversation or explanation is required.
```

**Note:** Custom prompts completely replace the default prompts. Language constraints (Japanese/English) are automatically added based on your Output Language setting.

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

## API Limits

The extension automatically manages API rate limits. For details about Gemini API limits and pricing, see the [official documentation](https://ai.google.dev/gemini-api/docs/quota).

## Notes

- Internet connection required
- Video files: Recommended 10MB or less (max 20MB)
- Processing time depends on number of images and API model
- Free tier has usage limits - see Gemini API documentation

## License

MIT
