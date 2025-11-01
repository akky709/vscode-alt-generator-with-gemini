/**
 * Default prompts for ALT text and aria-label generation
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { CHAR_CONSTRAINTS, PROMPT_CONSTRAINTS } from '../constants';

// Custom prompts interface
interface CustomPrompts {
    imageAlt?: {
        seo?: string;
        a11y?: string;
    };
    videoDescription?: {
        standard?: string;
        detailed?: string;
    };
    context?: string;
    geminiApiModel?: string;
}

// Cache for custom prompts
let customPromptsCache: CustomPrompts | null = null;
let lastPromptsFilePath: string | null = null;

// Default context instruction template (unified for all media types)
const DEFAULT_CONTEXT_PROMPT = `

Surrounding text is below:
{surroundingText}

If surrounding text fully describes the {mediaType}, return the special keyword: DECORATIVE
`;

/**
 * Get context instruction for avoiding redundancy with surrounding text
 * @param surroundingText - Text surrounding the image/video
 * @param type - Type of media: 'seo', 'a11y', or 'video'
 * @returns Context instruction string or empty string if no meaningful context
 */
function getContextInstruction(surroundingText: string, type: 'seo' | 'a11y' | 'video'): string {
    // If no surrounding text provided at all, don't add context instruction
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

    // Priority 1: If custom context prompt exists, use it
    if (customContextPrompt && customContextPrompt.trim() !== '') {
        return customContextPrompt
            .replace(/{surroundingText}/g, formattedSurroundingText)
            .replace(/{mediaType}/g, mediaType);
    }

    // Priority 2: Use default context prompt (when VS Code setting is enabled but no custom prompt)
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
function buildSeoPrompt(lang: 'en' | 'ja'): string {
    const languageConstraint = getLanguageConstraint(lang);

    return `You are an SEO expert. Generate alt text. Output only the alt text.${languageConstraint}`;
}

/**
 * Build A11Y prompt with language-specific constraints
 */
function buildA11yPrompt(lang: 'en' | 'ja', charConstraint: string): string {
    const languageConstraint = getLanguageConstraint(lang);

    return `You are an Accessibility expert. Generate alt text for visual impairments. Length: ${charConstraint}. Output only the alt text.${languageConstraint}`;
}

/**
 * Build Video prompt with language-specific constraints
 * @param lang - Output language
 * @param mode - 'standard' for short aria-label, 'detailed' for comprehensive description
 */
function buildVideoPrompt(lang: 'en' | 'ja', mode: 'standard' | 'detailed' = 'standard'): string {
    const languageConstraint = getLanguageConstraint(lang);

    if (mode === 'standard') {
        return `You are an Accessibility expert. Generate a concise video aria-label. Maximum ${PROMPT_CONSTRAINTS.MAX_VIDEO_ARIA_LABEL_WORDS} words. Do not include "video". Output only the aria-label.${languageConstraint}`;
    } else {
        // Detailed mode - comprehensive description for HTML comment
        return `You are a video content analyst. Generate a comprehensive video description. Accurately transcribe all dialogue and narration. Add descriptions of important visual information that cannot be understood from audio alone. Maximum ${PROMPT_CONSTRAINTS.MAX_VIDEO_DETAILED_WORDS} words. Output only the description.${languageConstraint}`;
    }
}

/**
 * Check if surrounding text context is needed for prompt generation
 * @param type - Type of prompt: 'seo', 'a11y', or 'video'
 * @param mode - For video: 'standard' or 'detailed'
 * @param customPrompts - Pre-loaded custom prompts (optional, will load if not provided)
 * @returns true if context analysis is enabled via VS Code settings OR custom prompts contain {surroundingText} placeholder
 */
export function needsSurroundingText(
    type: 'seo' | 'a11y' | 'video',
    mode?: 'standard' | 'detailed',
    customPrompts?: CustomPrompts | null
): boolean {
    // Priority 1: Check VS Code settings
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const contextAnalysisEnabled = config.get<boolean>('contextAnalysisEnabled', false);

    if (contextAnalysisEnabled) {
        return true; // Context analysis explicitly enabled
    }

    // Priority 2: Check if custom prompts contain {surroundingText} placeholder
    const prompts = customPrompts !== undefined ? customPrompts : loadCustomPrompts();
    if (!prompts) {
        return false; // No custom prompts and settings disabled
    }

    // Check if context prompt contains {surroundingText}
    if (prompts.context?.includes('{surroundingText}')) {
        return true;
    }

    // Check type-specific prompts
    if (type === 'seo') {
        return prompts.imageAlt?.seo?.includes('{surroundingText}') || false;
    }
    if (type === 'a11y') {
        return prompts.imageAlt?.a11y?.includes('{surroundingText}') || false;
    }
    if (type === 'video') {
        const videoMode = mode === 'detailed' ? 'detailed' : 'standard';
        return prompts.videoDescription?.[videoMode]?.includes('{surroundingText}') || false;
    }

    return false;
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
 * @param options.customPrompts - Pre-loaded custom prompts (optional, will load if not provided)
 * @returns The generated prompt string
 */
export function getDefaultPrompt(
    type: 'seo' | 'a11y' | 'video',
    lang: 'en' | 'ja',
    options?: {
        mode?: 'standard' | 'detailed';
        charConstraint?: string;
        surroundingText?: string;
        customPrompts?: CustomPrompts | null;
    }
): string {
    // Use pre-loaded custom prompts if provided, otherwise load
    const customPrompts = options?.customPrompts !== undefined ? options.customPrompts : loadCustomPrompts();

    // Language constraint to append to custom prompts
    // Only add if the custom prompt doesn't already contain language instructions
    const getLanguageConstraint = (customPrompt?: string): string => {
        if (lang !== 'ja') {
            return '';
        }
        // Check if custom prompt already has Japanese language instruction
        if (customPrompt && (
            customPrompt.includes('Respond only in Japanese') ||
            customPrompt.includes('日本語で') ||
            customPrompt.includes('Japanese only')
        )) {
            return '';
        }
        return ' Respond only in Japanese.';
    };

    if (type === 'seo') {
        // Check if custom prompt exists
        const customPrompt = customPrompts?.imageAlt?.seo;
        if (customPrompt) {
            // Add language constraint first
            const promptWithLang = customPrompt + getLanguageConstraint(customPrompt);
            // Then add context instruction if needed
            const needsContext = needsSurroundingText('seo', undefined, customPrompts);
            const contextInstruction = (needsContext && options?.surroundingText)
                ? getContextInstruction(options.surroundingText, 'seo')
                : '';
            return promptWithLang + contextInstruction;
        }

        // Use default prompt with context instruction if enabled
        const basePrompt = buildSeoPrompt(lang);
        const needsContext = needsSurroundingText('seo', undefined, customPrompts);
        const contextInstruction = (needsContext && options?.surroundingText)
            ? getContextInstruction(options.surroundingText, 'seo')
            : '';
        return basePrompt + contextInstruction;
    }

    if (type === 'video') {
        const videoMode = options?.mode === 'detailed' ? 'detailed' : 'standard';

        // Check if custom prompt exists
        const customPrompt = customPrompts?.videoDescription?.[videoMode];
        if (customPrompt) {
            // Add language constraint first
            const promptWithLang = customPrompt + getLanguageConstraint(customPrompt);
            // Then add context instruction if needed
            const needsContext = needsSurroundingText('video', videoMode, customPrompts);
            const contextInstruction = (needsContext && options?.surroundingText)
                ? getContextInstruction(options.surroundingText, 'video')
                : '';
            return promptWithLang + contextInstruction;
        }

        // Use default prompt with context instruction if enabled
        const basePrompt = buildVideoPrompt(lang, videoMode);
        const needsContext = needsSurroundingText('video', videoMode, customPrompts);
        const contextInstruction = (needsContext && options?.surroundingText)
            ? getContextInstruction(options.surroundingText, 'video')
            : '';
        return basePrompt + contextInstruction;
    }

    if (type === 'a11y') {
        const charConstraint = options?.charConstraint || CHAR_CONSTRAINTS.DEFAULT;

        // Check if custom prompt exists
        const customPrompt = customPrompts?.imageAlt?.a11y;
        if (customPrompt) {
            // Replace {charConstraint} placeholder with actual constraint
            let prompt = customPrompt.replace(/{charConstraint}/g, charConstraint);

            // Add language constraint first
            const promptWithLang = prompt + getLanguageConstraint(prompt);

            // Then add context instruction if needed
            const needsContext = needsSurroundingText('a11y', undefined, customPrompts);
            const contextInstruction = (needsContext && options?.surroundingText)
                ? getContextInstruction(options.surroundingText, 'a11y')
                : '';
            return promptWithLang + contextInstruction;
        }

        // Use default prompt with context instruction if enabled
        const basePrompt = buildA11yPrompt(lang, charConstraint);
        const needsContext = needsSurroundingText('a11y', undefined, customPrompts);
        const contextInstruction = (needsContext && options?.surroundingText)
            ? getContextInstruction(options.surroundingText, 'a11y')
            : '';
        return basePrompt + contextInstruction;
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

    // Validate imageAlt (must be object with seo/a11y strings)
    if ('imageAlt' in obj) {
        if (typeof obj.imageAlt === 'object' && obj.imageAlt !== null) {
            const imageAltObj = obj.imageAlt as Record<string, unknown>;

            // Check for dangerous keys in nested object
            for (const key of dangerousKeys) {
                if (Object.prototype.hasOwnProperty.call(imageAltObj, key)) {
                    console.error(`[ALT Generator] Security: Dangerous key "${key}" found in imageAlt prompts`);
                    return null;
                }
            }

            validated.imageAlt = {};

            if ('seo' in imageAltObj && typeof imageAltObj.seo === 'string' && imageAltObj.seo.trim() !== '') {
                validated.imageAlt.seo = imageAltObj.seo;
            }

            if ('a11y' in imageAltObj && typeof imageAltObj.a11y === 'string' && imageAltObj.a11y.trim() !== '') {
                validated.imageAlt.a11y = imageAltObj.a11y;
            }
        } else {
            console.error('[ALT Generator] Invalid type for "imageAlt" prompt (must be object)');
        }
    }

    // Validate videoDescription (must be object with standard/detailed strings)
    if ('videoDescription' in obj) {
        if (typeof obj.videoDescription === 'object' && obj.videoDescription !== null) {
            const videoObj = obj.videoDescription as Record<string, unknown>;

            // Check for dangerous keys in nested object
            for (const key of dangerousKeys) {
                if (Object.prototype.hasOwnProperty.call(videoObj, key)) {
                    console.error(`[ALT Generator] Security: Dangerous key "${key}" found in videoDescription prompts`);
                    return null;
                }
            }

            validated.videoDescription = {};

            if ('standard' in videoObj && typeof videoObj.standard === 'string' && videoObj.standard.trim() !== '') {
                validated.videoDescription.standard = videoObj.standard;
            }

            if ('detailed' in videoObj && typeof videoObj.detailed === 'string' && videoObj.detailed.trim() !== '') {
                validated.videoDescription.detailed = videoObj.detailed;
            }
        } else {
            console.error('[ALT Generator] Invalid type for "videoDescription" prompt (must be object)');
        }
    }

    // Validate context (must be string and not empty)
    if ('context' in obj) {
        if (typeof obj.context === 'string' && obj.context.trim() !== '') {
            validated.context = obj.context;
        } else if (typeof obj.context !== 'string') {
            console.error('[ALT Generator] Invalid type for "context" prompt (must be string)');
        }
    }

    // Validate geminiApiModel (must be string, either "gemini-2.5-pro" or "gemini-2.5-flash")
    if ('geminiApiModel' in obj) {
        if (typeof obj.geminiApiModel === 'string') {
            const modelValue = obj.geminiApiModel.trim();
            if (modelValue === 'gemini-2.5-pro' || modelValue === 'gemini-2.5-flash') {
                validated.geminiApiModel = modelValue;
            } else if (modelValue !== '') {
                console.warn('[ALT Generator] Invalid Gemini API model (must be "gemini-2.5-pro" or "gemini-2.5-flash"):', modelValue);
            }
        } else {
            console.error('[ALT Generator] Invalid type for "geminiApiModel" (must be string)');
        }
    }

    // Return null if no valid prompts were found
    if (Object.keys(validated).length === 0) {
        return null;
    }

    return validated;
}

/**
 * Get Gemini API model from custom prompts or return default
 * @param customPrompts - Pre-loaded custom prompts (optional, will load if not provided)
 * @returns The Gemini API model string (either from custom prompts or default)
 */
export function getGeminiApiModel(customPrompts?: CustomPrompts | null): string {
    const prompts = customPrompts !== undefined ? customPrompts : loadCustomPrompts();
    if (prompts?.geminiApiModel) {
        return prompts.geminiApiModel;
    }
    return 'gemini-2.5-flash';
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
export function loadCustomPrompts(): CustomPrompts | null {
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

        // Security: Prevent path traversal attacks
        if (!isPathInWorkspace(absolutePath, workspaceRoot)) {
            console.error('[ALT Generator] Security: Custom prompts path is outside workspace');
            return null;
        }

        // Check if file path changed
        if (lastPromptsFilePath !== absolutePath) {
            customPromptsCache = null;
            lastPromptsFilePath = absolutePath;
        }

        // Return cached prompts if available
        if (customPromptsCache !== null) {
            return customPromptsCache;
        }

        // Check if file exists and is a file (not a directory)
        if (!fs.existsSync(absolutePath)) {
            return null; // File doesn't exist, use defaults (this is normal)
        }

        const stat = fs.statSync(absolutePath);
        if (!stat.isFile()) {
            return null; // Path is a directory, not a file (this is normal)
        }

        // Read and parse JSON file
        const fileContent = fs.readFileSync(absolutePath, 'utf-8');
        const parsedData = JSON.parse(fileContent);

        // Security: Validate and sanitize the JSON structure
        const validatedPrompts = validateCustomPrompts(parsedData);
        if (!validatedPrompts) {
            console.error('[ALT Generator] Invalid custom prompts structure');
            return null;
        }

        // Cache the prompts
        customPromptsCache = validatedPrompts;

        return validatedPrompts;
    } catch (error) {
        // Only log errors for actual problems (not "file not found")
        if (error instanceof Error && !error.message.includes('ENOENT')) {
            console.error('[ALT Generator] Failed to load custom prompts:', error);
        }
        return null;
    }
}
