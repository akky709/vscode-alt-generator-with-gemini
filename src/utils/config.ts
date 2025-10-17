/**
 * Configuration helper utilities
 */

import * as vscode from 'vscode';

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

    const rangeMap: { [key: string]: number } = {
        'narrow': 500,
        'standard': 1500,
        'wide': 3000,
        'very-wide': 5000
    };

    return rangeMap[rangeSetting] || 1500;
}
