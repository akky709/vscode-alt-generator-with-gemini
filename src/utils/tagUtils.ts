/**
 * HTML tag detection and extraction utilities
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { TAG_DETECTION } from '../constants';

/**
 * Detect tag type at cursor position
 */
export function detectTagType(editor: vscode.TextEditor, selection: vscode.Selection): 'img' | 'video' | null {
    const document = editor.document;
    const offset = document.offsetAt(selection.active);
    const text = document.getText();

    // カーソル位置から後方検索してタグの開始を見つける
    let startIndex = offset;
    while (startIndex > 0 && text[startIndex] !== '<') {
        startIndex--;
    }

    // 前方検索してタグの終了を見つける
    let endIndex = offset;
    while (endIndex < text.length && text[endIndex] !== '>') {
        endIndex++;
    }

    // タグテキストを取得
    const tagText = text.substring(startIndex, endIndex + 1);

    // タグタイプを判定
    if (/<img\s/i.test(tagText) || /<Image\s/i.test(tagText)) {
        return 'img';
    } else if (/<video\s/i.test(tagText) || /<source\s/i.test(tagText)) {
        return 'video';
    }

    return null;
}

/**
 * Detect all tags (img and video) in selection
 */
export function detectAllTags(
    editor: vscode.TextEditor,
    selection: vscode.Selection
): Array<{type: 'img' | 'video', range: vscode.Range, text: string}> {
    const document = editor.document;
    const selectedText = document.getText(selection);
    const startOffset = document.offsetAt(selection.start);
    const tags: Array<{type: 'img' | 'video', range: vscode.Range, text: string}> = [];

    // 最大検索長（ReDoS対策）
    const maxSearchLength = 100000;
    if (selectedText.length > maxSearchLength) {
        vscode.window.showWarningMessage('Selected text is too large for tag detection');
        return tags;
    }

    // imgとImageタグを検出（属性長を制限してReDoS対策）
    const imgRegex = new RegExp(`<(img|Image)\\s[^>]{0,${TAG_DETECTION.MAX_ATTRIBUTE_LENGTH}}>`, 'gi');
    let match;
    const startTime = Date.now();

    while ((match = imgRegex.exec(selectedText)) !== null) {
        if (Date.now() - startTime > TAG_DETECTION.SEARCH_TIMEOUT_MS) {
            vscode.window.showWarningMessage('Tag detection timeout - text may be too complex');
            break;
        }
        const tagStart = startOffset + match.index;
        const tagEnd = tagStart + match[0].length;
        const range = new vscode.Range(
            document.positionAt(tagStart),
            document.positionAt(tagEnd)
        );
        tags.push({ type: 'img', range, text: match[0] });
    }

    // videoタグを検出（より安全な2パスアプローチ）
    const videoOpenRegex = /<video\s[^>]{0,500}>/gi;
    while ((match = videoOpenRegex.exec(selectedText)) !== null) {
        if (Date.now() - startTime > TAG_DETECTION.SEARCH_TIMEOUT_MS) {
            vscode.window.showWarningMessage('Tag detection timeout - text may be too complex');
            break;
        }
        const openStart = match.index;
        const openEnd = openStart + match[0].length;

        // 閉じタグを探す（最大長制限）
        const closeTag = '</video>';
        const closeIndex = selectedText.indexOf(closeTag, openEnd);

        let tagEnd: number;
        if (closeIndex !== -1 && closeIndex - openStart < 50000) {
            tagEnd = closeIndex + closeTag.length;
        } else {
            // 自己閉じタグの場合
            if (match[0].endsWith('/>')) {
                tagEnd = openEnd;
            } else {
                continue; // 閉じタグが見つからない
            }
        }

        const tagStart = startOffset + openStart;
        const range = new vscode.Range(
            document.positionAt(tagStart),
            document.positionAt(startOffset + tagEnd)
        );
        tags.push({ type: 'video', range, text: selectedText.substring(openStart, tagEnd) });
    }

    return tags;
}

/**
 * Extract image filename from img/Image tag
 */
export function extractImageFileName(tagText: string): string {
    // 通常の引用符形式を試行
    let match = tagText.match(/src=(["'])([^"']+)\1/);
    if (match) {
        return path.basename(match[2]);
    }

    // JSX形式を試行
    const jsxMatch = tagText.match(/src=\{["']?([^"'}]+)["']?\}/);
    if (jsxMatch) {
        return path.basename(jsxMatch[1]);
    }

    return 'unknown';
}

/**
 * Extract video filename from video tag
 */
export function extractVideoFileName(tagText: string): string {
    const match = tagText.match(/src=["']([^"']+)["']/);
    if (match) {
        return path.basename(match[1]);
    }
    return 'unknown';
}
