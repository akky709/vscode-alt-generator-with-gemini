/**
 * Configuration helper utilities
 */

import * as vscode from 'vscode';
import { CONTEXT_RANGE_VALUES } from '../constants';

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
