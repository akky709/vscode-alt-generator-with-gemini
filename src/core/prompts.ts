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
    a11y?: string;
    video?: {
        standard?: string;
        detailed?: string;
    };
    context?: string;
}

// Cache for custom prompts
let customPromptsCache: CustomPrompts | null = null;
let lastPromptsFilePath: string | null = null;

// Default context instruction template (unified for all media types)
const DEFAULT_CONTEXT_PROMPT = `

The surrounding text information is as follows.
{surroundingText}

Refer to the surrounding text information; if the surrounding text fully describes the {mediaType} content, return the special keyword: DECORATIVE
`;

/**
 * Get context instruction for avoiding redundancy with surrounding text
 * @param surroundingText - Text surrounding the image/video
 * @param type - Type of media: 'seo', 'a11y', or 'video'
 * @returns Context instruction string or empty string if no meaningful context
 */
function getContextInstruction(surroundingText: string, type: 'seo' | 'a11y' | 'video'): string {
    // If no meaningful surrounding text, don't add context instruction
    if (!surroundingText || surroundingText.trim() === '' || surroundingText === '[No surrounding text found]') {
        return '';
    }

    // Determine media type for placeholder replacement
    const mediaType = type === 'video' ? 'video' : 'image';
    const mediaTypeUpper = mediaType.toUpperCase();

    // Replace BEFORE_MEDIA/AFTER_MEDIA with BEFORE_IMAGE/AFTER_IMAGE or BEFORE_VIDEO/AFTER_VIDEO
    const formattedSurroundingText = surroundingText
        .replace(/BEFORE_MEDIA/g, `BEFORE_${mediaTypeUpper}`)
        .replace(/AFTER_MEDIA/g, `AFTER_${mediaTypeUpper}`);

    // Try to load custom context prompts
    const customPrompts = loadCustomPrompts();
    const customContextPrompt = customPrompts?.context;

    // If custom context prompt exists, use it with placeholders
    if (customContextPrompt) {
        return customContextPrompt
            .replace(/{surroundingText}/g, formattedSurroundingText)
            .replace(/{mediaType}/g, mediaType);
    }

    // Otherwise use default context prompt with placeholders
    return DEFAULT_CONTEXT_PROMPT
        .replace(/{surroundingText}/g, formattedSurroundingText)
        .replace(/{mediaType}/g, mediaType);
}

/**
 * Get language constraint instruction
 */
function getLanguageConstraint(lang: 'en' | 'ja'): string {
    return lang === 'ja' ? '\nRespond only in Japanese.' : '';
}

/**
 * Build SEO prompt with language-specific constraints
 */
function buildSeoPrompt(lang: 'en' | 'ja', surroundingText?: string): string {
    const contextInstruction = surroundingText ? getContextInstruction(surroundingText, 'seo') : '';
    const languageConstraint = getLanguageConstraint(lang);

    return `Generate SEO-optimized alt text. Be specific, naturally incorporate relevant keywords, avoid keyword stuffing.${contextInstruction} Output only the alt text.${languageConstraint}`;
}

/**
 * Build A11Y prompt with language-specific constraints
 */
function buildA11yPrompt(lang: 'en' | 'ja', charConstraint: string, surroundingText?: string): string {
    const contextInstruction = surroundingText ? getContextInstruction(surroundingText, 'a11y') : '';
    const languageConstraint = getLanguageConstraint(lang);

    return `Generate alt text for users with visual impairments. Be specific, fully describe the image, avoid redundancy. Length: ${charConstraint}.${contextInstruction} Output only the alt text.${languageConstraint}`;
}

/**
 * Build Video prompt with language-specific constraints
 * @param lang - Output language
 * @param mode - 'standard' for short aria-label, 'detailed' for comprehensive description
 * @param surroundingText - Optional surrounding text context
 */
function buildVideoPrompt(lang: 'en' | 'ja', mode: 'standard' | 'detailed' = 'standard', surroundingText?: string): string {
    const languageConstraint = getLanguageConstraint(lang);

    if (mode === 'standard') {
        const contextInstruction = surroundingText ? getContextInstruction(surroundingText, 'video') : '';

        return `Generate a concise aria-label describing the video's function or purpose. Maximum ${PROMPT_CONSTRAINTS.MAX_VIDEO_ARIA_LABEL_WORDS} words. Don't include "video" or "movie".${contextInstruction} Output only the aria-label.${languageConstraint}`;
    } else {
        // Detailed mode - comprehensive description for HTML comment
        const contextInstruction = surroundingText ? getContextInstruction(surroundingText, 'video') : '';

        return `Generate a comprehensive description covering all visual elements, actions, and key content. Maximum ${PROMPT_CONSTRAINTS.MAX_VIDEO_DETAILED_WORDS} words.${contextInstruction} Output only the description.${languageConstraint}`;
    }
}

/**
 * Helper function to get the appropriate prompt based on type, language, and options
 *
 * @param type - Type of prompt: 'seo', 'a11y', or 'video'
 * @param lang - Output language: 'en' or 'ja'
 * @param options - Additional options for prompt generation
 * @param options.mode - For Video: 'standard' or 'detailed' (not used for seo/a11y)
 * @param options.charConstraint - Character constraint string for A11Y prompts
 * @param options.surroundingText - Surrounding text context for prompts
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

    // Language constraint to append to custom prompts
    const japaneseConstraint = lang === 'ja' ? '\n\nIMPORTANT: Respond only in Japanese.' : '';

    if (type === 'seo') {
        // Check if custom prompt exists
        const customPrompt = customPrompts?.seo;
        if (customPrompt) {
            console.log('[ALT Generator] Using custom SEO prompt');
            // If custom prompt doesn't include context instruction, append it
            const contextInstruction = options?.surroundingText
                ? getContextInstruction(options.surroundingText, 'seo')
                : '';
            return customPrompt + contextInstruction + japaneseConstraint;
        }
        console.log('[ALT Generator] Using default SEO prompt');
        return buildSeoPrompt(lang, options?.surroundingText);
    }

    if (type === 'video') {
        const videoMode = options?.mode === 'detailed' ? 'detailed' : 'standard';

        // Check if custom prompt exists
        const customPrompt = customPrompts?.video?.[videoMode];
        if (customPrompt) {
            console.log(`[ALT Generator] Using custom Video prompt (${videoMode} mode)`);
            // For custom prompts, add context instruction if surrounding text exists
            const contextInstruction = options?.surroundingText
                ? getContextInstruction(options.surroundingText, 'video')
                : '';
            return customPrompt + contextInstruction + japaneseConstraint;
        }
        console.log(`[ALT Generator] Using default Video prompt (${videoMode} mode)`);
        return buildVideoPrompt(lang, videoMode, options?.surroundingText);
    }

    if (type === 'a11y') {
        const charConstraint = options?.charConstraint || CHAR_CONSTRAINTS.DEFAULT;

        // Check if custom prompt exists
        const customPrompt = customPrompts?.a11y;
        if (customPrompt) {
            console.log('[ALT Generator] Using custom A11Y prompt');
            // Replace {charConstraint} placeholder with actual constraint
            let prompt = customPrompt.replace(/{charConstraint}/g, charConstraint);

            // If custom prompt doesn't include context instruction, append it
            const contextInstruction = options?.surroundingText
                ? getContextInstruction(options.surroundingText, 'a11y')
                : '';
            return prompt + contextInstruction + japaneseConstraint;
        }

        console.log('[ALT Generator] Using default A11Y prompt');
        return buildA11yPrompt(lang, charConstraint, options?.surroundingText);
    }

    throw new Error(`Unknown prompt type: ${type}`);
}

/**
 * Validate that a path is within the workspace (prevent path traversal attacks)
 */
function isPathInWorkspace(absolutePath: string, workspaceRoot: string): boolean {
    const normalizedPath = path.normalize(absolutePath);
    const normalizedRoot = path.normalize(workspaceRoot);
    return normalizedPath.startsWith(normalizedRoot);
}

/**
 * Validate custom prompts structure and sanitize against prototype pollution
 */
function validateCustomPrompts(data: unknown): CustomPrompts | null {
    console.log('[ALT Generator] Validating custom prompts, data type:', typeof data);

    if (typeof data !== 'object' || data === null) {
        console.error('[ALT Generator] Invalid data type for custom prompts');
        return null;
    }

    // Prevent prototype pollution attacks
    // Use hasOwnProperty to check only own properties, not prototype chain
    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
    for (const key of dangerousKeys) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
            console.error(`[ALT Generator] Security: Dangerous key "${key}" found in custom prompts`);
            return null;
        }
    }

    const obj = data as Record<string, unknown>;
    const validated: CustomPrompts = {};

    console.log('[ALT Generator] Keys in data:', Object.keys(obj));

    // Validate seo (must be string and not empty)
    if ('seo' in obj) {
        console.log('[ALT Generator] Found "seo" key, type:', typeof obj.seo);
        if (typeof obj.seo === 'string' && obj.seo.trim() !== '') {
            validated.seo = obj.seo;
            console.log('[ALT Generator] SEO prompt validated');
        } else if (typeof obj.seo === 'string' && obj.seo.trim() === '') {
            console.log('[ALT Generator] SEO prompt is empty, will use default');
        } else {
            console.error('[ALT Generator] Invalid type for "seo" prompt (must be string)');
        }
    }

    // Validate a11y (must be string and not empty)
    if ('a11y' in obj) {
        console.log('[ALT Generator] Found "a11y" key, type:', typeof obj.a11y);
        if (typeof obj.a11y === 'string' && obj.a11y.trim() !== '') {
            validated.a11y = obj.a11y;
            console.log('[ALT Generator] A11Y prompt validated');
        } else if (typeof obj.a11y === 'string' && obj.a11y.trim() === '') {
            console.log('[ALT Generator] A11Y prompt is empty, will use default');
        } else {
            console.error('[ALT Generator] Invalid type for "a11y" prompt (must be string)');
        }
    }

    // Validate video (must be object with standard/detailed strings)
    if ('video' in obj) {
        if (typeof obj.video === 'object' && obj.video !== null) {
            const videoObj = obj.video as Record<string, unknown>;

            // Check for dangerous keys in nested object
            for (const key of dangerousKeys) {
                if (Object.prototype.hasOwnProperty.call(videoObj, key)) {
                    console.error(`[ALT Generator] Security: Dangerous key "${key}" found in video prompts`);
                    return null;
                }
            }

            validated.video = {};

            if ('standard' in videoObj && typeof videoObj.standard === 'string' && videoObj.standard.trim() !== '') {
                validated.video.standard = videoObj.standard;
                console.log('[ALT Generator] Video standard prompt validated');
            } else if ('standard' in videoObj && typeof videoObj.standard === 'string' && videoObj.standard.trim() === '') {
                console.log('[ALT Generator] Video standard prompt is empty, will use default');
            }

            if ('detailed' in videoObj && typeof videoObj.detailed === 'string' && videoObj.detailed.trim() !== '') {
                validated.video.detailed = videoObj.detailed;
                console.log('[ALT Generator] Video detailed prompt validated');
            } else if ('detailed' in videoObj && typeof videoObj.detailed === 'string' && videoObj.detailed.trim() === '') {
                console.log('[ALT Generator] Video detailed prompt is empty, will use default');
            }
        } else {
            console.error('[ALT Generator] Invalid type for "video" prompt (must be object)');
        }
    }

    // Validate context (must be string and not empty)
    if ('context' in obj) {
        console.log('[ALT Generator] Found "context" key, type:', typeof obj.context);
        if (typeof obj.context === 'string' && obj.context.trim() !== '') {
            validated.context = obj.context;
            console.log('[ALT Generator] Context prompt validated');
        } else if (typeof obj.context === 'string' && obj.context.trim() === '') {
            console.log('[ALT Generator] Context prompt is empty, will use default');
        } else {
            console.error('[ALT Generator] Invalid type for "context" prompt (must be string)');
        }
    }

    // Return null if no valid prompts were found
    if (Object.keys(validated).length === 0) {
        console.log('[ALT Generator] No valid custom prompts found in file');
        return null;
    }

    return validated;
}

/**
 * Load custom prompts from external JSON file
 * Returns null if file doesn't exist or cannot be parsed
 *
 * Security features:
 * - Path traversal protection: Only loads files within workspace
 * - Prototype pollution protection: Rejects dangerous keys
 * - Structure validation: Only accepts expected string types
 */
function loadCustomPrompts(): CustomPrompts | null {
    try {
        const config = vscode.workspace.getConfiguration('altGenGemini');
        const customPromptsPath = config.get<string>('customPromptsPath', '.vscode/custom-prompts.json');

        // Get workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            console.log('[ALT Generator] No workspace folder found');
            return null;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const absolutePath = path.resolve(workspaceRoot, customPromptsPath);

        console.log('[ALT Generator] Loading custom prompts from:', absolutePath);

        // Security: Prevent path traversal attacks
        if (!isPathInWorkspace(absolutePath, workspaceRoot)) {
            console.error('[ALT Generator] Security: Custom prompts path is outside workspace');
            return null;
        }

        // Check if file path changed
        if (lastPromptsFilePath !== absolutePath) {
            customPromptsCache = null;
            lastPromptsFilePath = absolutePath;
            console.log('[ALT Generator] Cache cleared due to path change');
        }

        // Return cached prompts if available
        if (customPromptsCache !== null) {
            console.log('[ALT Generator] Returning cached custom prompts');
            return customPromptsCache;
        }

        // Check if file exists
        if (!fs.existsSync(absolutePath)) {
            console.log('[ALT Generator] Custom prompts file not found');
            return null;
        }

        // Read and parse JSON file
        const fileContent = fs.readFileSync(absolutePath, 'utf-8');
        console.log('[ALT Generator] File content loaded, length:', fileContent.length);

        const parsedData = JSON.parse(fileContent);
        console.log('[ALT Generator] JSON parsed successfully');

        // Security: Validate and sanitize the JSON structure
        const validatedPrompts = validateCustomPrompts(parsedData);
        if (!validatedPrompts) {
            console.error('[ALT Generator] Invalid custom prompts structure');
            return null;
        }

        console.log('[ALT Generator] Custom prompts validated and cached:', Object.keys(validatedPrompts));

        // Cache the prompts
        customPromptsCache = validatedPrompts;

        return validatedPrompts;
    } catch (error) {
        console.error('[ALT Generator] Failed to load custom prompts:', error);
        return null;
    }
}
