# Custom Prompts for ALT Generator

This directory can contain a custom prompts JSON file to override the default prompts sent to Gemini API.

## Setup

1. Copy `alt-prompts.json.example` to `alt-prompts.json`
2. Edit the prompts according to your needs
3. Configure the path in VSCode settings if using a different location

## File Structure

```json
{
  "seo": {
    "en": "Your custom SEO prompt in English",
    "ja": "Your custom SEO prompt in Japanese"
  },
  "a11y": {
    "standard": {
      "en": "Your custom A11Y standard prompt in English",
      "ja": "Your custom A11Y standard prompt in Japanese"
    },
    "detailed": {
      "en": "Your custom A11Y detailed prompt in English",
      "ja": "Your custom A11Y detailed prompt in Japanese"
    }
  },
  "video": {
    "en": "Your custom video prompt in English",
    "ja": "Your custom video prompt in Japanese"
  }
}
```

## Placeholders

For A11Y prompts, you can use the following placeholder:
- `{charConstraint}` - Will be replaced with the character constraint based on the selected description length

## Features

- **Partial Override**: You don't need to provide all prompts. Only the prompts you define will override the defaults.
- **Automatic Context**: The extension automatically appends context instructions for surrounding text when enabled.
- **Caching**: Prompts are cached for performance. The cache is cleared when the file path changes.

## Example: Custom SEO Prompt

```json
{
  "seo": {
    "en": "Generate a concise ALT text focusing on product features and benefits. Include relevant keywords naturally. Maximum 150 characters."
  }
}
```

This will override only the English SEO prompt while keeping all other defaults.

## Tips

- Test your prompts with a few images before applying to many files
- Keep prompts concise to reduce token usage
- Include clear instructions about constraints (length, format, etc.)
- Specify the output language in Japanese prompts (e.g., "Respond only in Japanese")
