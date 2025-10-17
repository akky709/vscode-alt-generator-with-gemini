/**
 * Default prompts for ALT text and aria-label generation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

// Custom prompts interface
interface CustomPrompts {
    seo?: {
        en?: string;
        ja?: string;
    };
    a11y?: {
        standard?: {
            en?: string;
            ja?: string;
        };
        detailed?: {
            en?: string;
            ja?: string;
        };
    };
    video?: {
        en?: string;
        ja?: string;
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
- If the surrounding text partially describes the image, provide only a brief supplementary description (maximum 50 characters) that adds ${purpose} not mentioned in the text.
- If the surrounding text does not describe the image at all, provide a complete description following the standard constraints below.
`;
}

export const DEFAULT_PROMPTS = {
    seo: {
        en: (surroundingText?: string) => {
            const contextInstruction = surroundingText ? getContextInstruction(surroundingText, true) : '';

            return `You are an SEO expert. Analyze the provided image and generate the most effective single-sentence ALT text for SEO purposes.${contextInstruction}

[CONSTRAINTS]
1. Include 3-5 key search terms naturally.
2. The description must be a single, concise sentence.
3. Avoid unnecessary phrases like "image of" or "photo of" at the end.
4. Do not include any information unrelated to the image.

Return only the generated ALT text, without any further conversation or explanation.`;
        },

        ja: (surroundingText?: string) => {
            const contextInstruction = surroundingText ? getContextInstruction(surroundingText, true) : '';

            return `You are an SEO expert. Analyze the provided image and generate the most effective single-sentence ALT text for SEO purposes.${contextInstruction}

[CONSTRAINTS]
1. Include 3-5 key search terms naturally.
2. The description must be a single, concise sentence.
3. Avoid unnecessary phrases like "image of" or "photo of" at the end.
4. Do not include any information unrelated to the image.
5. Respond only in Japanese.

Return only the generated ALT text, without any further conversation or explanation.`;
        }
    },

    a11y: {
        standard: {
            en: (charConstraint: string, surroundingText?: string) => {
                const contextInstruction = surroundingText ? getContextInstruction(surroundingText, false) : '';

                return `You are a web accessibility expert. Analyze the provided image's content and the role it plays within the page's context in detail. Your task is to generate ALT text that is completely understandable for users with visual impairments.${contextInstruction}

[CONSTRAINTS]
1. Completely describe the image content and do not omit any details.
2. Where necessary, include the image's background, colors, actions, and emotions.
3. The description must be a single, cohesive sentence between ${charConstraint}.
4. Do not include the words "image" or "photo".

Return only the generated ALT text. No other conversation or explanation is required.`;
            },

            ja: (charConstraint: string, surroundingText?: string) => {
                const contextInstruction = surroundingText ? getContextInstruction(surroundingText, false) : '';

                return `You are a web accessibility expert. Analyze the provided image's content and the role it plays within the page's context in detail. Your task is to generate ALT text that is completely understandable for users with visual impairments.${contextInstruction}

[CONSTRAINTS]
1. Completely describe the image content and do not omit any details.
2. Where necessary, include the image's background, colors, actions, and emotions.
3. The description must be a single, cohesive sentence between ${charConstraint}.
4. Do not include the words "image" or "photo".
5. Respond only in Japanese.

Return only the generated ALT text. No other conversation or explanation is required.`;
            }
        },

        detailed: {
            en: (charConstraint: string, surroundingText?: string) => {
                const contextInstruction = surroundingText ? getContextInstruction(surroundingText, false) : '';

                return `You are a web accessibility expert. Analyze the provided image's content and the role it plays within the page's context in detail. Your task is to generate ALT text that is completely understandable for users with visual impairments.${contextInstruction}

[CONSTRAINTS]
1. Completely describe the image content and do not omit any details.
2. Where necessary, include the image's background, colors, actions, and emotions.
3. The description must be a single, cohesive sentence between ${charConstraint}.
4. Do not include the words "image" or "photo".

Return only the generated ALT text. No other conversation or explanation is required.`;
            },

            ja: (charConstraint: string, surroundingText?: string) => {
                const contextInstruction = surroundingText ? getContextInstruction(surroundingText, false) : '';

                return `You are a web accessibility expert. Analyze the provided image's content and the role it plays within the page's context in detail. Your task is to generate ALT text that is completely understandable for users with visual impairments.${contextInstruction}

[CONSTRAINTS]
1. Completely describe the image content and do not omit any details.
2. Where necessary, include the image's background, colors, actions, and emotions.
3. The description must be a single, cohesive sentence between ${charConstraint}.
4. Do not include the words "image" or "photo".
5. Respond only in Japanese.

Return only the generated ALT text. No other conversation or explanation is required.`;
            }
        }
    },

    video: {
        en: () => `You are a Web Accessibility and UX expert. Analyze the provided video content in detail and identify the role it plays within the page's context. Your task is to generate the optimal ARIA-LABEL text that briefly explains the video's purpose or function.

[CONSTRAINTS]
1. The generated ARIA-LABEL text must be a very short phrase, **no more than 10 words**.
2. Focus on the video's **purpose or function**, not its **content or visual description**. (e.g., product demo, operation tutorial, background animation, etc.)
3. Prioritize conciseness and use common language that will be easily understood by the user.
4. Do not include the words "video," "movie," or "clip".

Return only the generated ARIA-LABEL text. No other conversation or explanation is required.`,

        ja: () => `You are a Web Accessibility and UX expert. Analyze the provided video content in detail and identify the role it plays within the page's context. Your task is to generate the optimal ARIA-LABEL text that briefly explains the video's purpose or function.

[CONSTRAINTS]
1. The generated ARIA-LABEL text must be a very short phrase, **no more than 10 words**.
2. Focus on the video's **purpose or function**, not its **content or visual description**. (e.g., product demo, operation tutorial, background animation, etc.)
3. Prioritize conciseness and use common language that will be easily understood by the user.
4. Do not include the words "video," "movie," or "clip".
5. Respond only in Japanese.

Return only the generated ARIA-LABEL text. No other conversation or explanation is required.`
    }
} as const;

/**
 * Helper function to get the appropriate prompt based on type, language, and options
 *
 * @param type - Type of prompt: 'seo', 'a11y', or 'video'
 * @param lang - Output language: 'en' or 'ja'
 * @param options - Additional options for prompt generation
 * @param options.mode - For A11Y type: 'standard' or 'detailed'
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
        const customPrompt = customPrompts?.seo?.[lang];
        if (customPrompt) {
            // If custom prompt doesn't include context instruction, append it
            const contextInstruction = options?.surroundingText
                ? getContextInstruction(options.surroundingText, true)
                : '';
            return customPrompt + contextInstruction;
        }
        return DEFAULT_PROMPTS.seo[lang](options?.surroundingText);
    }

    if (type === 'video') {
        // Check if custom prompt exists
        const customPrompt = customPrompts?.video?.[lang];
        if (customPrompt) {
            return customPrompt;
        }
        return DEFAULT_PROMPTS.video[lang]();
    }

    if (type === 'a11y') {
        const mode = options?.mode || 'standard';
        const charConstraint = options?.charConstraint || '50 and 120 characters';

        // Check if custom prompt exists
        const customPrompt = customPrompts?.a11y?.[mode]?.[lang];
        if (customPrompt) {
            // Replace {charConstraint} placeholder with actual constraint
            let prompt = customPrompt.replace(/{charConstraint}/g, charConstraint);

            // If custom prompt doesn't include context instruction, append it
            const contextInstruction = options?.surroundingText
                ? getContextInstruction(options.surroundingText, false)
                : '';
            return prompt + contextInstruction;
        }

        return DEFAULT_PROMPTS.a11y[mode][lang](charConstraint, options?.surroundingText);
    }

    throw new Error(`Unknown prompt type: ${type}`);
}

/**
 * Helper function to get character length constraint for A11Y mode
 *
 * @param lang - Output language: 'en' or 'ja'
 * @param descriptionLength - Description length: 'standard' or 'detailed'
 * @returns The character constraint string
 */
export function getCharConstraint(lang: 'en' | 'ja', descriptionLength: 'standard' | 'detailed'): string {
    if (lang === 'ja') {
        if (descriptionLength === 'detailed') {
            return '100 and 200 Japanese characters (full-width characters)';
        } else {
            return '50 and 120 Japanese characters (full-width characters)';
        }
    } else {
        if (descriptionLength === 'detailed') {
            return '100 and 200 characters';
        } else {
            return '60 and 130 characters';
        }
    }
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
