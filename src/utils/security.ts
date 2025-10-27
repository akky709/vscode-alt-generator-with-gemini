/**
 * Security and validation utilities
 */

import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Safely edit a document with error handling
 * Ensures the document is still open before applying changes
 */
export async function safeEditDocument(
    editor: vscode.TextEditor,
    range: vscode.Range,
    newText: string
): Promise<boolean> {
    try {
        // ドキュメントが閉じられていないかチェック
        if (!editor || editor.document.isClosed) {
            vscode.window.showWarningMessage('Editor was closed during ALT generation. Please try again.');
            return false;
        }

        // WorkspaceEditを使用して編集を適用（エディタがアクティブでなくても動作する）
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.replace(editor.document.uri, range, newText);

        const success = await vscode.workspace.applyEdit(workspaceEdit);

        if (!success) {
            vscode.window.showWarningMessage('Failed to edit document. The file may have been closed or modified.');
            return false;
        }

        return true;
    } catch (error) {
        // 編集中に例外が発生した場合
        console.error('[ALT Generator] Error during document edit:', error);
        vscode.window.showWarningMessage('An error occurred while editing the document. Please try again.');
        return false;
    }
}

/**
 * Escape HTML special characters to prevent XSS attacks
 */
export function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Sanitize file path to prevent path traversal attacks
 * Returns null if the path is suspicious
 */
export function sanitizeFilePath(filePath: string, basePath: string): string | null {
    try {
        // パストラバーサルシーケンスを明示的に拒否
        if (filePath.includes('..') || filePath.includes('~')) {
            return null;
        }

        // ルートパス（/で始まる）の場合は先頭の/を削除
        let cleanPath = filePath;
        if (cleanPath.startsWith('/')) {
            cleanPath = cleanPath.substring(1);
        }

        // 絶対パスに解決
        const resolved = path.resolve(basePath, cleanPath);
        const normalized = path.normalize(resolved);
        const normalizedBase = path.normalize(basePath);

        // ワークスペース外へのアクセスを拒否
        if (!normalized.startsWith(normalizedBase)) {
            return null;
        }

        return normalized;
    } catch {
        return null;
    }
}

/**
 * Validation result for image src attribute
 */
interface ValidationResult {
    valid: boolean;
    reason?: string;
}

/**
 * Validate image src attribute for dangerous protocols and patterns
 */
export function validateImageSrc(src: string): ValidationResult {
    // 危険なプロトコルを拒否
    const dangerousProtocols = [
        'javascript:', 'data:', 'vbscript:', 'file:',
        'about:', 'chrome:', 'jar:', 'wyciwyg:'
    ];

    const lowerSrc = src.toLowerCase();
    for (const protocol of dangerousProtocols) {
        if (lowerSrc.startsWith(protocol)) {
            return { valid: false, reason: `Dangerous protocol: ${protocol}` };
        }
    }

    // UNCパス（Windows）を拒否（//で始まる場合でもhttp://やhttps://は除外）
    if (src.startsWith('\\\\') || (src.startsWith('//') && !lowerSrc.startsWith('http://') && !lowerSrc.startsWith('https://'))) {
        return { valid: false, reason: 'UNC paths not supported' };
    }

    // 動的表現を拒否
    const dynamicPatterns = [
        /\$\{/,           // テンプレートリテラル
        /\$\(/,           // コマンド置換
        /<\?php/i,        // PHPタグ
        /<%/,             // ASP/JSPタグ
        /@@/,             // Angular式
        /\[\[/,           // Vue式
    ];

    for (const pattern of dynamicPatterns) {
        if (pattern.test(src)) {
            return { valid: false, reason: 'Dynamic expression detected' };
        }
    }

    // http://またはhttps://で始まる場合は絶対URLとして許可
    if (lowerSrc.startsWith('http://') || lowerSrc.startsWith('https://')) {
        // URLとして妥当かチェック（基本的な検証）
        try {
            new URL(src);
            return { valid: true };
        } catch {
            return { valid: false, reason: 'Invalid URL format' };
        }
    }

    // ローカルパスの場合は許可された文字のみ
    const allowedChars = /^[a-zA-Z0-9\/_.\-~]+$/;
    if (!allowedChars.test(src)) {
        return { valid: false, reason: 'Invalid characters in path' };
    }

    return { valid: true };
}
