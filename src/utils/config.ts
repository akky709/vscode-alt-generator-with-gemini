/**
 * Configuration helper utilities
 */

import * as vscode from 'vscode';
import { CONTEXT_RANGE_VALUES } from '../constants';

/**
 * Valid insertion modes
 */
export type InsertionMode = 'auto' | 'confirm';

/**
 * Valid generation modes
 */
export type GenerationMode = 'SEO' | 'A11Y';

/**
 * Get output language for ALT text generation
 * Returns 'ja' for Japanese or 'en' for English
 */
export function getOutputLanguage(): string {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const langSetting = config.get<string>('outputLanguage', 'auto');

    if (langSetting === 'auto') {
        const vscodeLang = vscode.env.language;
        return vscodeLang.startsWith('ja') ? 'ja' : 'en';
    }

    return langSetting;
}

/**
 * Get context range value in characters
 * Converts the setting string to actual numeric value
 */
export function getContextRangeValue(): number {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const rangeSetting = config.get<string>('contextRange', 'standard');

    return CONTEXT_RANGE_VALUES[rangeSetting as keyof typeof CONTEXT_RANGE_VALUES] || CONTEXT_RANGE_VALUES.default;
}

/**
 * Get insertion mode with type safety and validation
 * Returns 'auto' or 'confirm', defaults to 'auto' for invalid values
 */
export function getInsertionMode(): InsertionMode {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const mode = config.get<string>('insertionMode', 'auto');

    if (mode !== 'auto' && mode !== 'confirm') {
        console.warn(`[ALT Generator] Invalid insertionMode: ${mode}, using 'auto'`);
        return 'auto';
    }

    return mode;
}

/**
 * Get generation mode with type safety and validation
 * Returns 'SEO' or 'A11Y', defaults to 'SEO' for invalid values
 */
export function getGenerationMode(): GenerationMode {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const mode = config.get<string>('generationMode', 'SEO');

    if (mode !== 'SEO' && mode !== 'A11Y') {
        console.warn(`[ALT Generator] Invalid generationMode: ${mode}, using 'SEO'`);
        return 'SEO';
    }

    return mode;
}
