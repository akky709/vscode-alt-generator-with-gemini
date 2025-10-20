/**
 * Default prompts for ALT text and aria-label generation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CHAR_CONSTRAINTS, PROMPT_CONSTRAINTS } from '../constants';

// Custom prompts interface
interface CustomPrompts {
    seo?: string;
    a11y?: {
        standard?: string;
        detailed?: string;
    };
    video?: {
        standard?: string;
        detailed?: string;
    };
}

// Cache for custom prompts
let customPromptsCache: CustomPrompts | null = null;
let lastPromptsFilePath: string | null = null;

// Context instruction template for avoiding redundancy with surrounding text
function getContextInstruction(surroundingText: string, isSEO: boolean): string {
    const purpose = isSEO ? 'SEO value' : 'information';
    const avoidReason = isSEO
        ? '(avoiding duplicate content)'
        : '(avoiding double reading by screen readers)';

    return `

[SURROUNDING TEXT CONTEXT]
The following text appears near the image in the page (including sibling elements at the same level and parent elements):

${surroundingText}

[IMPORTANT - AVOID REDUNDANCY]
- Carefully read the text from both sibling elements (before/after the image) and parent elements.
- If the surrounding text already fully describes the image content, return "DECORATIVE" (without quotes) to indicate that alt="" should be used ${avoidReason}.
- If the surrounding text partially describes the image, provide only a brief supplementary description (maximum ${PROMPT_CONSTRAINTS.MAX_SUPPLEMENTARY_CHARS} characters) that adds ${purpose} not mentioned in the text.
- If the surrounding text does not describe the image at all, provide a complete description following the standard constraints below.
`;
}

/**
 * Build SEO prompt with language-specific constraints
 */
function buildSeoPrompt(lang: 'en' | 'ja', surroundingText?: string): string {
    const contextInstruction = surroundingText ? getContextInstruction(surroundingText, true) : '';
    const japaneseConstraint = lang === 'ja' ? '\n5. Respond only in Japanese.' : '';

    return `You are an SEO expert. Analyze the provided image and generate the most effective single-sentence ALT text for SEO purposes.${contextInstruction}

[CONSTRAINTS]
1. Include ${PROMPT_CONSTRAINTS.SEO_KEYWORDS_MIN}-${PROMPT_CONSTRAINTS.SEO_KEYWORDS_MAX} key search terms naturally.
2. The description must be a single, concise sentence.
3. Avoid unnecessary phrases like "image of" or "photo of" at the end.
4. Do not include any information unrelated to the image.${japaneseConstraint}

Return only the generated ALT text, without any further conversation or explanation.`;
}

/**
 * Build A11Y prompt with language-specific constraints
 * Note: 'standard' and 'detailed' modes use the same prompt template, differentiated only by charConstraint value
 */
function buildA11yPrompt(lang: 'en' | 'ja', charConstraint: string, surroundingText?: string): string {
    const contextInstruction = surroundingText ? getContextInstruction(surroundingText, false) : '';
    const japaneseConstraint = lang === 'ja' ? '\n5. Respond only in Japanese.' : '';

    return `You are a web accessibility expert. Analyze the provided image's content and the role it plays within the page's context in detail. Your task is to generate ALT text that is completely understandable for users with visual impairments.${contextInstruction}

[CONSTRAINTS]
1. Completely describe the image content and do not omit any details.
2. Where necessary, include the image's background, colors, actions, and emotions.
3. The description must be a single, cohesive sentence between ${charConstraint}.
4. Do not include the words "image" or "photo".${japaneseConstraint}

Return only the generated ALT text. No other conversation or explanation is required.`;
}

/**
 * Build Video prompt with language-specific constraints
 * @param lang - Output language
 * @param mode - 'standard' for short aria-label, 'detailed' for comprehensive description
 * @param surroundingText - Optional surrounding text context
 */
function buildVideoPrompt(lang: 'en' | 'ja', mode: 'standard' | 'detailed' = 'standard', surroundingText?: string): string {
    const japaneseConstraint = lang === 'ja' ? '\n5. Respond only in Japanese.' : '';

    if (mode === 'standard') {
        // Standard mode - original behavior for aria-label
        const contextInstruction = surroundingText ? `

[SURROUNDING TEXT CONTEXT]
The following text appears near the video in the page (including sibling elements at the same level and parent elements):

${surroundingText}

[IMPORTANT - AVOID REDUNDANCY]
- Carefully read the text from both sibling elements (before/after the video) and parent elements.
- If the surrounding text already fully describes the video's purpose or function, return "DECORATIVE" (without quotes) to indicate that aria-label should NOT be added (avoiding double reading by screen readers).
- If the surrounding text partially describes the video, provide only a brief supplementary phrase (maximum ${PROMPT_CONSTRAINTS.MAX_SUPPLEMENTARY_WORDS_VIDEO} words) that adds information not mentioned in the text.
- If the surrounding text does not describe the video at all, provide a complete description following the standard constraints below.
` : '';

        return `You are a Web Accessibility and UX expert. Analyze the provided video content in detail and identify the role it plays within the page's context. Your task is to generate the optimal ARIA-LABEL text that briefly explains the video's purpose or function.${contextInstruction}

[CONSTRAINTS]
1. The generated ARIA-LABEL text must be a very short phrase, **no more than ${PROMPT_CONSTRAINTS.MAX_VIDEO_ARIA_LABEL_WORDS} words**.
2. Focus on the video's **purpose or function**, not its **content or visual description**. (e.g., product demo, operation tutorial, background animation, etc.)
3. Prioritize conciseness and use common language that will be easily understood by the user.
4. Do not include the words "video," "movie," or "clip".${japaneseConstraint}

Return only the generated ARIA-LABEL text. No other conversation or explanation is required.`;
    } else {
        // Detailed mode - comprehensive description for HTML comment
        const contextWarning = surroundingText ? `

[SURROUNDING TEXT CONTEXT]
The following text appears near the video in the page:

${surroundingText}

Note: This context is provided for reference. Generate a comprehensive description regardless of surrounding text, as this will be output as an HTML comment for documentation purposes.
` : '';

        return `You are a video content analyst. Analyze the provided video in detail and generate a comprehensive description that captures all important visual and content elements.${contextWarning}

[CONSTRAINTS]
1. Provide a detailed description of the video content (maximum ${PROMPT_CONSTRAINTS.MAX_VIDEO_DETAILED_WORDS} words).
2. Include visual elements, actions, settings, and key content shown in the video.
3. Focus on describing what is shown and what happens in the video.
4. Use clear, descriptive language that paints a complete picture.${japaneseConstraint}

Return only the generated description. No other conversation or explanation is required.`;
    }
}

// Export DEFAULT_PROMPTS for backward compatibility
// Now uses builder functions to eliminate redundancy
export const DEFAULT_PROMPTS = {
    seo: {
        en: (surroundingText?: string) => buildSeoPrompt('en', surroundingText),
        ja: (surroundingText?: string) => buildSeoPrompt('ja', surroundingText)
    },

    a11y: {
        standard: {
            en: (charConstraint: string, surroundingText?: string) => buildA11yPrompt('en', charConstraint, surroundingText),
            ja: (charConstraint: string, surroundingText?: string) => buildA11yPrompt('ja', charConstraint, surroundingText)
        },

        detailed: {
            en: (charConstraint: string, surroundingText?: string) => buildA11yPrompt('en', charConstraint, surroundingText),
            ja: (charConstraint: string, surroundingText?: string) => buildA11yPrompt('ja', charConstraint, surroundingText)
        }
    },

    video: {
        standard: {
            en: (surroundingText?: string) => buildVideoPrompt('en', 'standard', surroundingText),
            ja: (surroundingText?: string) => buildVideoPrompt('ja', 'standard', surroundingText)
        },
        detailed: {
            en: (surroundingText?: string) => buildVideoPrompt('en', 'detailed', surroundingText),
            ja: (surroundingText?: string) => buildVideoPrompt('ja', 'detailed', surroundingText)
        }
    }
} as const;

/**
 * Helper function to get the appropriate prompt based on type, language, and options
 *
 * @param type - Type of prompt: 'seo', 'a11y', or 'video'
 * @param lang - Output language: 'en' or 'ja'
 * @param options - Additional options for prompt generation
 * @param options.mode - For A11Y: 'standard' or 'detailed'; For Video: 'standard' or 'detailed'
 * @param options.charConstraint - Character constraint string for A11Y prompts
 * @param options.surroundingText - Surrounding text context for image prompts
 * @returns The generated prompt string
 */
export function getDefaultPrompt(
    type: 'seo' | 'a11y' | 'video',
    lang: 'en' | 'ja',
    options?: {
        mode?: 'standard' | 'detailed';
        charConstraint?: string;
        surroundingText?: string;
    }
): string {
    // Try to load custom prompts
    const customPrompts = loadCustomPrompts();

    if (type === 'seo') {
        // Check if custom prompt exists
        const customPrompt = customPrompts?.seo;
        if (customPrompt) {
            // If custom prompt doesn't include context instruction, append it
            const contextInstruction = options?.surroundingText
                ? getContextInstruction(options.surroundingText, true)
                : '';
            return customPrompt + contextInstruction;
        }
        return buildSeoPrompt(lang, options?.surroundingText);
    }

    if (type === 'video') {
        const videoMode = options?.mode === 'detailed' ? 'detailed' : 'standard';

        // Check if custom prompt exists
        const customPrompt = customPrompts?.video?.[videoMode];
        if (customPrompt) {
            // For custom prompts, use standard mode context instruction
            const contextInstruction = options?.surroundingText
                ? `\n\n[SURROUNDING TEXT CONTEXT]\nThe following text appears near the video:\n\n${options.surroundingText}\n\n[IMPORTANT - AVOID REDUNDANCY]\n- If the surrounding text already fully describes the video's purpose or function, return "DECORATIVE" (without quotes) to indicate that aria-label should NOT be added.\n- Otherwise, provide a brief description following the constraints.`
                : '';
            return customPrompt + contextInstruction;
        }
        return buildVideoPrompt(lang, videoMode, options?.surroundingText);
    }

    if (type === 'a11y') {
        // For A11Y, mode can only be 'standard' or 'detailed'
        const a11yMode = (options?.mode === 'standard' || options?.mode === 'detailed') ? options.mode : 'standard';
        const charConstraint = options?.charConstraint || CHAR_CONSTRAINTS.DEFAULT;

        // Check if custom prompt exists
        const customPrompt = customPrompts?.a11y?.[a11yMode];
        if (customPrompt) {
            // Replace {charConstraint} placeholder with actual constraint
            let prompt = customPrompt.replace(/{charConstraint}/g, charConstraint);

            // If custom prompt doesn't include context instruction, append it
            const contextInstruction = options?.surroundingText
                ? getContextInstruction(options.surroundingText, false)
                : '';
            return prompt + contextInstruction;
        }

        return buildA11yPrompt(lang, charConstraint, options?.surroundingText);
    }

    throw new Error(`Unknown prompt type: ${type}`);
}

/**
 * Load custom prompts from external JSON file
 * Returns null if file doesn't exist or cannot be parsed
 */
function loadCustomPrompts(): CustomPrompts | null {
    try {
        const config = vscode.workspace.getConfiguration('altGenGemini');
        const customPromptsPath = config.get<string>('customPromptsPath', '.vscode/alt-prompts.json');

        // Get workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return null;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const absolutePath = path.resolve(workspaceRoot, customPromptsPath);

        // Check if file path changed
        if (lastPromptsFilePath !== absolutePath) {
            customPromptsCache = null;
            lastPromptsFilePath = absolutePath;
        }

        // Return cached prompts if available
        if (customPromptsCache !== null) {
            return customPromptsCache;
        }

        // Check if file exists
        if (!fs.existsSync(absolutePath)) {
            return null;
        }

        // Read and parse JSON file
        const fileContent = fs.readFileSync(absolutePath, 'utf-8');
        const customPrompts = JSON.parse(fileContent) as CustomPrompts;

        // Cache the prompts
        customPromptsCache = customPrompts;

        return customPrompts;
    } catch (error) {
        console.error('[ALT Generator] Failed to load custom prompts:', error);
        return null;
    }
}
