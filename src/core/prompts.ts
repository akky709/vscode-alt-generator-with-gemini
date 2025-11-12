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
        summary?: string;
        transcript?: string;
        // Legacy support
        standard?: string;
        detailed?: string;
    };
    context?: string | {
        rule?: string;
        data?: string;
    };
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
 * @param part - Which part to return: 'legacy' (old string format), 'rule', or 'data'
 * @returns Context instruction string or empty string if no meaningful context
 */
function getContextInstruction(surroundingText: string, type: 'seo' | 'a11y' | 'video', part: 'legacy' | 'rule' | 'data' = 'legacy'): string {
    // Determine media type for placeholder replacement
    const mediaType = type === 'video' ? 'video' : 'image';
    const mediaTypeUpper = mediaType.toUpperCase();

    // Replace BEFORE_MEDIA/AFTER_MEDIA with BEFORE_IMAGE/AFTER_IMAGE or BEFORE_VIDEO/AFTER_VIDEO
    // If no surrounding text found, use the placeholder text as-is
    const formattedSurroundingText = surroundingText
        .replace(/BEFORE_MEDIA/g, `BEFORE_${mediaTypeUpper}`)
        .replace(/AFTER_MEDIA/g, `AFTER_${mediaTypeUpper}`);

    // Try to load custom context prompts
    const customPrompts = loadCustomPrompts();
    const customContextPrompt = customPrompts?.context;

    // Handle object format (new format with rule and data)
    if (customContextPrompt && typeof customContextPrompt === 'object') {
        if (part === 'rule') {
            const rulePrompt = customContextPrompt.rule || '';
            return rulePrompt
                .replace(/{surroundingText}/g, formattedSurroundingText)
                .replace(/{mediaType}/g, mediaType);
        } else if (part === 'data') {
            const dataPrompt = customContextPrompt.data || '';
            return dataPrompt
                .replace(/{surroundingText}/g, formattedSurroundingText)
                .replace(/{mediaType}/g, mediaType);
        }
        // For 'legacy' part with object format, combine rule and data
        const rulePrompt = customContextPrompt.rule || '';
        const dataPrompt = customContextPrompt.data || '';
        const combined = rulePrompt + dataPrompt;
        return combined
            .replace(/{surroundingText}/g, formattedSurroundingText)
            .replace(/{mediaType}/g, mediaType);
    }

    // Handle string format (legacy format or default)
    if (customContextPrompt && typeof customContextPrompt === 'string' && customContextPrompt.trim() !== '') {
        // Legacy string format - return only for 'legacy' part
        if (part === 'legacy') {
            return customContextPrompt
                .replace(/{surroundingText}/g, formattedSurroundingText)
                .replace(/{mediaType}/g, mediaType);
        }
        return ''; // No rule/data for legacy string format
    }

    // Priority: Use default context prompt (when VS Code setting is enabled but no custom prompt)
    if (part === 'legacy') {
        return DEFAULT_CONTEXT_PROMPT
            .replace(/{surroundingText}/g, formattedSurroundingText)
            .replace(/{mediaType}/g, mediaType);
    }

    return '';
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
 * @param mode - 'summary' for short aria-label, 'transcript' for comprehensive description
 */
function buildVideoPrompt(lang: 'en' | 'ja', mode: 'summary' | 'transcript' = 'summary'): string {
    const languageConstraint = getLanguageConstraint(lang);

    if (mode === 'summary') {
        // Summary mode - short aria-label with word limit
        return `You are an Accessibility expert. Generate a concise video aria-label. Maximum ${PROMPT_CONSTRAINTS.MAX_VIDEO_ARIA_LABEL_WORDS} words. Do not include "video". Output only the aria-label.${languageConstraint}`;
    } else {
        // Transcript mode - comprehensive description with character limit
        return `You are a video content analyst. Generate a detailed narrative description of the video's content. Integrate all spoken dialogue and narration with essential visual information into a single, flowing text. Output only the resulting narrative text.${languageConstraint}`;
    }
}

/**
 * Check if surrounding text context is needed for prompt generation
 * @param type - Type of prompt: 'seo', 'a11y', or 'video'
 * @param mode - For video: 'summary' or 'transcript'
 * @param customPrompts - Pre-loaded custom prompts (optional, will load if not provided)
 * @returns true if context analysis is enabled via VS Code settings OR custom prompts contain {surroundingText} placeholder
 */
export function needsSurroundingText(
    type: 'seo' | 'a11y' | 'video',
    mode?: 'summary' | 'transcript',
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
    if (prompts.context) {
        if (typeof prompts.context === 'string') {
            if (prompts.context.includes('{surroundingText}')) {
                return true;
            }
        } else if (typeof prompts.context === 'object') {
            // Check both rule and data for {surroundingText}
            if (prompts.context.rule?.includes('{surroundingText}') || prompts.context.data?.includes('{surroundingText}')) {
                return true;
            }
        }
    }

    // Check type-specific prompts for {surroundingText} or {contextRule}/{contextData} or {context} (legacy)
    if (type === 'seo') {
        const prompt = prompts.imageAlt?.seo || '';
        return prompt.includes('{surroundingText}') || prompt.includes('{contextRule}') || prompt.includes('{contextData}') || prompt.includes('{context}');
    }
    if (type === 'a11y') {
        const prompt = prompts.imageAlt?.a11y || '';
        return prompt.includes('{surroundingText}') || prompt.includes('{contextRule}') || prompt.includes('{contextData}') || prompt.includes('{context}');
    }
    if (type === 'video') {
        // Support both new (summary/transcript) and legacy (standard/detailed) naming
        const videoMode = mode === 'transcript' ? 'transcript' : 'summary';
        const prompt = prompts.videoDescription?.[videoMode]
            || prompts.videoDescription?.['standard'] // Legacy fallback
            || prompts.videoDescription?.['detailed'] // Legacy fallback
            || '';
        return prompt.includes('{surroundingText}') || prompt.includes('{contextRule}') || prompt.includes('{contextData}') || prompt.includes('{context}');
    }

    return false;
}

/**
 * Helper function to get the appropriate prompt based on type, language, and options
 *
 * @param type - Type of prompt: 'seo', 'a11y', or 'video'
 * @param lang - Output language: 'en' or 'ja'
 * @param options - Additional options for prompt generation
 * @param options.mode - For Video: 'summary' or 'transcript' (not used for seo/a11y)
 * @param options.charConstraint - Character constraint string for A11Y prompts
 * @param options.surroundingText - Surrounding text context for prompts
 * @param options.customPrompts - Pre-loaded custom prompts (optional, will load if not provided)
 * @returns The generated prompt string
 */
export function getDefaultPrompt(
    type: 'seo' | 'a11y' | 'video',
    lang: 'en' | 'ja',
    options?: {
        mode?: 'summary' | 'transcript';
        charConstraint?: string;
        surroundingText?: string;
        customPrompts?: CustomPrompts | null;
    }
): string {
    // Use pre-loaded custom prompts if provided, otherwise load
    const customPrompts = options?.customPrompts !== undefined ? options.customPrompts : loadCustomPrompts();

    // Get character constraint (used by all prompt types)
    const charConstraint = options?.charConstraint || CHAR_CONSTRAINTS.DEFAULT;

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
            const needsContext = needsSurroundingText('seo', undefined, customPrompts);
            let result = customPrompt;

            // Replace {surroundingText} placeholder directly in prompt
            if (needsContext && options?.surroundingText) {
                const mediaType = 'image';
                const mediaTypeUpper = mediaType.toUpperCase();
                const formattedSurroundingText = options.surroundingText
                    .replace(/BEFORE_MEDIA/g, `BEFORE_${mediaTypeUpper}`)
                    .replace(/AFTER_MEDIA/g, `AFTER_${mediaTypeUpper}`);
                result = result.replace(/{surroundingText}/g, formattedSurroundingText);
            } else {
                result = result.replace(/{surroundingText}/g, '');
            }

            // Replace {contextRule} and {contextData} placeholders
            if (needsContext && options?.surroundingText) {
                const contextRule = getContextInstruction(options.surroundingText, 'seo', 'rule');
                const contextData = getContextInstruction(options.surroundingText, 'seo', 'data');
                result = result.replace(/{contextRule}/g, contextRule);
                result = result.replace(/{contextData}/g, contextData);
            } else {
                // Remove placeholders if no context available
                result = result.replace(/{contextRule}/g, '');
                result = result.replace(/{contextData}/g, '');
            }

            // Check if prompt contains legacy {context} placeholder
            if (result.includes('{context}')) {
                // Custom prompt with {context} placeholder - replace it with context instruction
                const contextInstruction = (needsContext && options?.surroundingText)
                    ? getContextInstruction(options.surroundingText, 'seo', 'legacy')
                    : '';
                result = result.replace(/{context}/g, contextInstruction);
            }

            // Replace {languageConstraint} placeholder
            const languageConstraint = getLanguageConstraint(lang);
            if (result.includes('{languageConstraint}')) {
                result = result.replace(/{languageConstraint}/g, languageConstraint);
            } else {
                // Fallback: Add to end if placeholder not found (backward compatibility)
                result = result + getLanguageConstraint(customPrompt);
            }

            return result;
        }

        // Use default prompt with context instruction if enabled (always append to end)
        const basePrompt = buildSeoPrompt(lang);
        const needsContext = needsSurroundingText('seo', undefined, customPrompts);
        const contextInstruction = (needsContext && options?.surroundingText)
            ? getContextInstruction(options.surroundingText, 'seo', 'legacy')
            : '';
        return basePrompt + contextInstruction;
    }

    if (type === 'video') {
        const videoMode = options?.mode === 'transcript' ? 'transcript' : 'summary';

        // Check if custom prompt exists (with legacy fallback)
        const customPrompt = customPrompts?.videoDescription?.[videoMode]
            || customPrompts?.videoDescription?.[videoMode === 'transcript' ? 'detailed' : 'standard']; // Legacy fallback
        if (customPrompt) {
            const needsContext = needsSurroundingText('video', videoMode, customPrompts);
            // Replace {charConstraint} placeholder with actual constraint
            let result = customPrompt.replace(/{charConstraint}/g, charConstraint);

            // Replace {surroundingText} placeholder directly in prompt
            if (needsContext && options?.surroundingText) {
                const mediaType = 'video';
                const mediaTypeUpper = mediaType.toUpperCase();
                const formattedSurroundingText = options.surroundingText
                    .replace(/BEFORE_MEDIA/g, `BEFORE_${mediaTypeUpper}`)
                    .replace(/AFTER_MEDIA/g, `AFTER_${mediaTypeUpper}`);
                result = result.replace(/{surroundingText}/g, formattedSurroundingText);
            } else {
                result = result.replace(/{surroundingText}/g, '');
            }

            // Replace {contextRule} and {contextData} placeholders
            if (needsContext && options?.surroundingText) {
                const contextRule = getContextInstruction(options.surroundingText, 'video', 'rule');
                const contextData = getContextInstruction(options.surroundingText, 'video', 'data');
                result = result.replace(/{contextRule}/g, contextRule);
                result = result.replace(/{contextData}/g, contextData);
            } else {
                // Remove placeholders if no context available
                result = result.replace(/{contextRule}/g, '');
                result = result.replace(/{contextData}/g, '');
            }

            // Check if prompt contains legacy {context} placeholder
            if (result.includes('{context}')) {
                // Custom prompt with {context} placeholder - replace it with context instruction
                const contextInstruction = (needsContext && options?.surroundingText)
                    ? getContextInstruction(options.surroundingText, 'video', 'legacy')
                    : '';
                result = result.replace(/{context}/g, contextInstruction);
            }

            // Replace {languageConstraint} placeholder
            const languageConstraint = getLanguageConstraint(lang);
            if (result.includes('{languageConstraint}')) {
                result = result.replace(/{languageConstraint}/g, languageConstraint);
            } else {
                // Fallback: Add to end if placeholder not found (backward compatibility)
                result = result + getLanguageConstraint(customPrompt);
            }

            return result;
        }

        // Use default prompt with context instruction if enabled (always append to end)
        const basePrompt = buildVideoPrompt(lang, videoMode);
        const needsContext = needsSurroundingText('video', videoMode, customPrompts);
        const contextInstruction = (needsContext && options?.surroundingText)
            ? getContextInstruction(options.surroundingText, 'video', 'legacy')
            : '';
        return basePrompt + contextInstruction;
    }

    if (type === 'a11y') {
        // Check if custom prompt exists
        const customPrompt = customPrompts?.imageAlt?.a11y;
        if (customPrompt) {
            // Replace {charConstraint} placeholder with actual constraint
            let result = customPrompt.replace(/{charConstraint}/g, charConstraint);
            const needsContext = needsSurroundingText('a11y', undefined, customPrompts);

            // Replace {surroundingText} placeholder directly in prompt
            if (needsContext && options?.surroundingText) {
                const mediaType = 'image';
                const mediaTypeUpper = mediaType.toUpperCase();
                const formattedSurroundingText = options.surroundingText
                    .replace(/BEFORE_MEDIA/g, `BEFORE_${mediaTypeUpper}`)
                    .replace(/AFTER_MEDIA/g, `AFTER_${mediaTypeUpper}`);
                result = result.replace(/{surroundingText}/g, formattedSurroundingText);
            } else {
                result = result.replace(/{surroundingText}/g, '');
            }

            // Replace {contextRule} and {contextData} placeholders
            if (needsContext && options?.surroundingText) {
                const contextRule = getContextInstruction(options.surroundingText, 'a11y', 'rule');
                const contextData = getContextInstruction(options.surroundingText, 'a11y', 'data');
                result = result.replace(/{contextRule}/g, contextRule);
                result = result.replace(/{contextData}/g, contextData);
            } else {
                // Remove placeholders if no context available
                result = result.replace(/{contextRule}/g, '');
                result = result.replace(/{contextData}/g, '');
            }

            // Check if prompt contains legacy {context} placeholder
            if (result.includes('{context}')) {
                // Custom prompt with {context} placeholder - replace it with context instruction
                const contextInstruction = (needsContext && options?.surroundingText)
                    ? getContextInstruction(options.surroundingText, 'a11y', 'legacy')
                    : '';
                result = result.replace(/{context}/g, contextInstruction);
            }

            // Replace {languageConstraint} placeholder
            const languageConstraint = getLanguageConstraint(lang);
            if (result.includes('{languageConstraint}')) {
                result = result.replace(/{languageConstraint}/g, languageConstraint);
            } else {
                // Fallback: Add to end if placeholder not found (backward compatibility)
                result = result + getLanguageConstraint(result);
            }

            return result;
        }

        // Use default prompt with context instruction if enabled (always append to end)
        const basePrompt = buildA11yPrompt(lang, charConstraint);
        const needsContext = needsSurroundingText('a11y', undefined, customPrompts);
        const contextInstruction = (needsContext && options?.surroundingText)
            ? getContextInstruction(options.surroundingText, 'a11y', 'legacy')
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
 * Normalize section title for flexible matching
 * Removes leading #, spaces, hyphens, underscores, and converts to lowercase
 */
function normalizeSectionTitle(title: string): string {
    return title.toLowerCase()
        .replace(/^#+\s*/, '') // Remove leading # symbols
        .replace(/[\s\-_]+/g, '') // Remove spaces, hyphens, underscores
        .trim();
}

/**
 * Section name patterns with multiple aliases for flexible matching
 * Each entry supports:
 * - Full descriptive names (e.g., "image alt - seo")
 * - Shorthand aliases (e.g., "seo")
 * - CamelCase variations (e.g., "ImageAltSEO")
 */
const SECTION_MAPPING_FLEXIBLE: Array<{ patterns: string[]; path: string; displayName: string }> = [
    {
        patterns: ['imagealtseo', 'seo'],
        path: 'imageAlt.seo',
        displayName: 'Image ALT - SEO'
    },
    {
        patterns: ['imagealta11y', 'a11y', 'accessibility'],
        path: 'imageAlt.a11y',
        displayName: 'Image ALT - A11Y'
    },
    {
        patterns: ['videodescriptionsummary', 'video', 'videosummary', 'summary', 'videodescriptionstandard', 'videostandard'],
        path: 'videoDescription.summary',
        displayName: 'Video Description - Summary'
    },
    {
        patterns: ['videodescriptiontranscript', 'videotranscript', 'transcript', 'videodescriptiondetailed', 'videodetailed'],
        path: 'videoDescription.transcript',
        displayName: 'Video Description - Transcript'
    },
    {
        patterns: ['contextrule', 'rule'],
        path: 'context.rule',
        displayName: 'Context Rule'
    },
    {
        patterns: ['contextdata', 'data'],
        path: 'context.data',
        displayName: 'Context Data'
    },
    {
        patterns: ['context'],
        path: 'context',
        displayName: 'Context'
    },
    {
        patterns: ['geminiapimodel', 'model'],
        path: 'geminiApiModel',
        displayName: 'Gemini API Model'
    }
];

/**
 * Find matching section mapping for a given title
 * @param title - Section title from markdown
 * @returns Matched section info or null if not found
 */
function findSectionMapping(title: string): { path: string; displayName: string } | null {
    const normalized = normalizeSectionTitle(title);

    for (const section of SECTION_MAPPING_FLEXIBLE) {
        if (section.patterns.includes(normalized)) {
            return { path: section.path, displayName: section.displayName };
        }
    }

    return null;
}

/**
 * Clean markdown content by removing horizontal lines and HTML comments
 * @param content - Raw section content
 * @returns Cleaned content
 */
function cleanMarkdownContent(content: string): string {
    // Remove HTML comments: <!-- ... -->
    let cleaned = content.replace(/<!--[\s\S]*?-->/g, '');

    // Remove horizontal lines (---, ***, ___ with 3+ characters)
    // Must be on their own line
    cleaned = cleaned.replace(/^[\s]*[-*_]{3,}[\s]*$/gm, '');

    // Normalize multiple blank lines to single blank line
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

    return cleaned.trim();
}

/**
 * Parse Markdown file and extract prompts by H1 sections
 * @param content - Raw markdown file content
 * @returns Parsed CustomPrompts object or null if invalid
 */
function parseMarkdownPrompts(content: string): CustomPrompts | null {
    if (!content || content.trim() === '') {
        console.error('[ALT Generator] Empty markdown content');
        return null;
    }

    const result: CustomPrompts = {};

    // Split by H1 headers (# Section Name)
    // Use regex to find all H1 headers and their content
    const h1Regex = /^# (.+)$/gm;
    const sections: Array<{ title: string; content: string }> = [];

    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = h1Regex.exec(content)) !== null) {
        // Save previous section if exists
        if (sections.length > 0) {
            const prevSection = sections[sections.length - 1];
            const rawContent = content.substring(lastIndex, match.index).trim();
            prevSection.content = cleanMarkdownContent(rawContent);
        }

        // Add new section
        sections.push({
            title: match[1].trim(),
            content: '' // Will be filled in next iteration or at end
        });

        lastIndex = match.index + match[0].length;
    }

    // Handle last section
    if (sections.length > 0) {
        const lastSection = sections[sections.length - 1];
        const rawContent = content.substring(lastIndex).trim();
        lastSection.content = cleanMarkdownContent(rawContent);
    }

    if (sections.length === 0) {
        console.error('[ALT Generator] No H1 sections found in markdown');
        return null;
    }

    // Map sections to CustomPrompts structure
    for (const section of sections) {
        const sectionMatch = findSectionMapping(section.title);

        if (!sectionMatch) {
            // Generate helpful error message with suggestions
            const allValidPatterns = SECTION_MAPPING_FLEXIBLE.map(s => s.displayName);
            console.warn(
                `[ALT Generator] Unknown section title: "${section.title}"\n` +
                `Valid section names (case-insensitive, spaces/hyphens optional):\n` +
                allValidPatterns.map(p => `  - ${p}`).join('\n')
            );
            continue;
        }

        if (section.content.trim() === '') {
            console.warn(`[ALT Generator] Empty content for section: "${section.title}"`);
            continue;
        }

        // Set value in result object using dot notation path
        const mappedPath = sectionMatch.path;
        const pathParts = mappedPath.split('.');

        if (pathParts.length === 1) {
            // Top-level property (e.g., "geminiApiModel" or "context" string)
            const key = pathParts[0] as keyof CustomPrompts;
            if (key === 'geminiApiModel') {
                const modelValue = section.content.trim();
                if (modelValue === 'gemini-2.5-pro' || modelValue === 'gemini-2.5-flash') {
                    result[key] = modelValue;
                } else {
                    console.warn(`[ALT Generator] Invalid Gemini API model: "${modelValue}"`);
                }
            } else if (key === 'context') {
                // Legacy string format for context
                result[key] = section.content;
            }
        } else if (pathParts.length === 2) {
            // Nested property (e.g., "imageAlt.seo" or "context.rule")
            const parentKey = pathParts[0] as 'imageAlt' | 'videoDescription' | 'context';
            const childKey = pathParts[1];

            if (parentKey === 'imageAlt') {
                if (!result.imageAlt) {
                    result.imageAlt = {};
                }
                if (childKey === 'seo' || childKey === 'a11y') {
                    result.imageAlt[childKey] = section.content;
                }
            } else if (parentKey === 'videoDescription') {
                if (!result.videoDescription) {
                    result.videoDescription = {};
                }
                if (childKey === 'summary' || childKey === 'transcript' || childKey === 'standard' || childKey === 'detailed') {
                    result.videoDescription[childKey as 'summary' | 'transcript' | 'standard' | 'detailed'] = section.content;
                }
            } else if (parentKey === 'context') {
                // Object format for context
                if (typeof result.context !== 'object' || result.context === null) {
                    result.context = {};
                }
                if (childKey === 'rule' || childKey === 'data') {
                    (result.context as { rule?: string; data?: string })[childKey] = section.content;
                }
            }
        }
    }

    // Return null if no valid prompts were found
    if (Object.keys(result).length === 0) {
        console.error('[ALT Generator] No valid prompts found in markdown');
        return null;
    }

    return result;
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
 * Load custom prompts from external Markdown file
 * Returns null if file doesn't exist or cannot be parsed
 *
 * Security features:
 * - Path traversal protection: Only loads files within workspace
 * - File size limit: Maximum 10MB to prevent memory exhaustion
 * - Structure validation: Only accepts expected H1 section names
 */
export function loadCustomPrompts(): CustomPrompts | null {
    try {
        const config = vscode.workspace.getConfiguration('altGenGemini');
        const customPromptsPath = config.get<string>('customPromptsPath', '.vscode/custom-prompts.md');

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

        // Security: File size limit (10MB maximum)
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        if (stat.size > MAX_FILE_SIZE) {
            console.error('[ALT Generator] Prompt file too large (max 10MB)');
            return null;
        }

        // Read and parse Markdown file
        const fileContent = fs.readFileSync(absolutePath, 'utf-8');
        const parsedPrompts = parseMarkdownPrompts(fileContent);

        if (!parsedPrompts) {
            console.error('[ALT Generator] Invalid custom prompts structure');
            return null;
        }

        // Cache the prompts
        customPromptsCache = parsedPrompts;

        return parsedPrompts;
    } catch (error) {
        // Only log errors for actual problems (not "file not found")
        if (error instanceof Error && !error.message.includes('ENOENT')) {
            console.error('[ALT Generator] Failed to load custom prompts:', error);
        }
        return null;
    }
}
