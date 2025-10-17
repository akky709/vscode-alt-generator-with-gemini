/**
 * Text processing and HTML parsing utilities
 */

import * as vscode from 'vscode';

/**
 * Format a message with placeholders {0}, {1}, etc.
 */
export function formatMessage(message: string, ...args: any[]): string {
    args.forEach((arg, index) => {
        message = message.replace(`{${index}}`, String(arg));
    });
    return message;
}

/**
 * Strip HTML tags from text and return clean text content
 */
export function stripHtmlTags(text: string): string {
    return text
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ') // scriptタグとその内容を削除
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ') // styleタグとその内容を削除
        .replace(/<[^>]+>/g, ' ') // その他のHTMLタグを削除
        .replace(/\s+/g, ' ') // 連続する空白を1つにまとめる
        .trim();
}

/**
 * Find parent element containing the image
 */
export function findParentElement(
    fullText: string,
    imageStart: number,
    imageEnd: number,
    maxSearch: number = 5000
): { start: number; end: number; tagName: string } | null {
    // 画像位置から前後に検索（最大maxSearch文字まで）
    const searchStart = Math.max(0, imageStart - maxSearch);
    const searchEnd = Math.min(fullText.length, imageEnd + maxSearch);
    const searchText = fullText.substring(searchStart, searchEnd);
    const relativeImageStart = imageStart - searchStart;
    const relativeImageEnd = imageEnd - searchStart;

    // 一般的なブロック要素のパターン
    const blockTags = ['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav', 'figure', 'li', 'td', 'th', 'p', 'blockquote'];
    const tagPattern = new RegExp(`<(${blockTags.join('|')})[\\s>]`, 'gi');

    let closestParent: { start: number; end: number; tagName: string } | null = null;
    let closestDistance = Infinity;

    // 開始タグを探す
    let match;
    while ((match = tagPattern.exec(searchText)) !== null) {
        const openTagStart = match.index;
        const tagName = match[1].toLowerCase();

        // 画像より後ろの開始タグ、または画像の直後の開始タグは無視
        // （画像を含む親要素を探すため）
        if (openTagStart >= relativeImageEnd) {
            continue;
        }

        // 対応する終了タグを探す
        const closeTagPattern = new RegExp(`</${tagName}>`, 'i');
        const remainingText = searchText.substring(openTagStart);
        const closeMatch = closeTagPattern.exec(remainingText);

        if (closeMatch) {
            const relativeCloseTagEnd = openTagStart + closeMatch.index + closeMatch[0].length;
            const absoluteOpenTagStart = searchStart + openTagStart;
            const absoluteCloseTagEnd = searchStart + relativeCloseTagEnd;

            // 画像がこの要素内に含まれているか確認
            if (absoluteOpenTagStart <= imageStart && absoluteCloseTagEnd >= imageEnd) {
                const distance = relativeImageStart - openTagStart;
                if (distance >= 0 && distance < closestDistance) {
                    closestDistance = distance;
                    closestParent = {
                        start: absoluteOpenTagStart,
                        end: absoluteCloseTagEnd,
                        tagName: tagName
                    };
                }
            }
        }
    }

    return closestParent;
}

/**
 * Find sibling elements before and after the image
 */
export function findSiblingElements(
    fullText: string,
    imageStart: number,
    imageEnd: number,
    maxSearch: number = 5000
): Array<{ position: 'before' | 'after'; tagName: string; text: string }> {
    const siblings: Array<{ position: 'before' | 'after'; tagName: string; text: string }> = [];

    // 画像位置から前後に検索（最大maxSearch文字まで）
    const searchStart = Math.max(0, imageStart - maxSearch);
    const searchEnd = Math.min(fullText.length, imageEnd + maxSearch);

    // 一般的なブロック要素とインライン要素のパターン
    const blockTags = ['div', 'section', 'article', 'main', 'aside', 'header', 'footer', 'nav', 'figure', 'li', 'td', 'th', 'p', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'figcaption', 'caption', 'span', 'a'];
    const tagPattern = new RegExp(`<(${blockTags.join('|')})[\\s>]`, 'gi');

    // 画像の前にある兄弟要素を検索（最大3つまで）
    const beforeText = fullText.substring(searchStart, imageStart);
    const beforeMatches: Array<{ tagName: string; start: number; end: number }> = [];

    let match;
    const beforeTagPattern = new RegExp(`<(${blockTags.join('|')})[\\s>]`, 'gi');
    while ((match = beforeTagPattern.exec(beforeText)) !== null) {
        const tagName = match[1].toLowerCase();
        const openTagStart = searchStart + match.index;

        // 対応する終了タグを探す
        const closeTagPattern = new RegExp(`</${tagName}>`, 'i');
        const remainingText = fullText.substring(openTagStart);
        const closeMatch = closeTagPattern.exec(remainingText);

        if (closeMatch) {
            const closeTagEnd = openTagStart + closeMatch.index + closeMatch[0].length;
            // 画像の前で終了している要素のみ（兄弟要素）
            if (closeTagEnd <= imageStart) {
                beforeMatches.push({ tagName, start: openTagStart, end: closeTagEnd });
            }
        }
    }

    // 画像に最も近い前の兄弟要素を最大3つ取得
    beforeMatches.sort((a, b) => b.end - a.end);
    for (let i = 0; i < Math.min(3, beforeMatches.length); i++) {
        const element = beforeMatches[i];
        const elementText = fullText.substring(element.start, element.end);
        const cleanedText = stripHtmlTags(elementText).trim();
        if (cleanedText.length > 0) {
            siblings.push({
                position: 'before',
                tagName: element.tagName,
                text: cleanedText
            });
        }
    }

    // 画像の後にある兄弟要素を検索（最大3つまで）
    const afterText = fullText.substring(imageEnd, searchEnd);
    const afterMatches: Array<{ tagName: string; start: number; end: number }> = [];

    const afterTagPattern = new RegExp(`<(${blockTags.join('|')})[\\s>]`, 'gi');
    while ((match = afterTagPattern.exec(afterText)) !== null) {
        const tagName = match[1].toLowerCase();
        const openTagStart = imageEnd + match.index;

        // 対応する終了タグを探す
        const closeTagPattern = new RegExp(`</${tagName}>`, 'i');
        const remainingText = fullText.substring(openTagStart);
        const closeMatch = closeTagPattern.exec(remainingText);

        if (closeMatch) {
            const closeTagEnd = openTagStart + closeMatch.index + closeMatch[0].length;
            // 画像の後に開始している要素のみ（兄弟要素）
            afterMatches.push({ tagName, start: openTagStart, end: closeTagEnd });
        }
    }

    // 画像に最も近い後の兄弟要素を最大3つ取得
    afterMatches.sort((a, b) => a.start - b.start);
    for (let i = 0; i < Math.min(3, afterMatches.length); i++) {
        const element = afterMatches[i];
        const elementText = fullText.substring(element.start, element.end);
        const cleanedText = stripHtmlTags(elementText).trim();
        if (cleanedText.length > 0) {
            siblings.push({
                position: 'after',
                tagName: element.tagName,
                text: cleanedText
            });
        }
    }

    return siblings;
}

/**
 * Extract surrounding text context for the image using structural approach
 */
export function extractSurroundingText(
    document: vscode.TextDocument,
    tagRange: vscode.Range,
    contextRange: number
): string {
    const fullText = document.getText();
    const imageStart = document.offsetAt(tagRange.start);
    const imageEnd = document.offsetAt(tagRange.end);

    const collectedTexts: string[] = [];
    let currentImageStart = imageStart;
    let currentImageEnd = imageEnd;
    let level = 0;
    const maxLevels = 3;

    // まず兄弟要素からテキストを収集
    const siblings = findSiblingElements(fullText, imageStart, imageEnd, contextRange);
    for (const sibling of siblings) {
        const prefix = sibling.position === 'before' ? 'before' : 'after';
        collectedTexts.push(`[Text in <${sibling.tagName}> sibling ${prefix} image]: ${sibling.text}`);
    }

    // 最大3階層まで親要素をさかのぼる
    while (level < maxLevels) {
        const parent = findParentElement(fullText, currentImageStart, currentImageEnd, contextRange);

        if (!parent) {
            break; // これ以上親要素が見つからない
        }

        // 親要素内のテキストを抽出（画像タグ自体は除外）
        const beforeImage = fullText.substring(parent.start, imageStart);
        const afterImage = fullText.substring(imageEnd, parent.end);

        // HTMLタグを除去
        const cleanedBefore = stripHtmlTags(beforeImage).trim();
        const cleanedAfter = stripHtmlTags(afterImage).trim();

        // テキストを収集
        if (cleanedBefore.length > 0) {
            collectedTexts.push(`[Text in <${parent.tagName}> parent before image]: ${cleanedBefore}`);
        }
        if (cleanedAfter.length > 0) {
            collectedTexts.push(`[Text in <${parent.tagName}> parent after image]: ${cleanedAfter}`);
        }

        // 十分なテキストが集まったら終了（最低50文字）
        const totalLength = cleanedBefore.length + cleanedAfter.length;
        if (totalLength >= 50) {
            break;
        }

        // 次の階層へ（親の親を探す）
        currentImageStart = parent.start;
        currentImageEnd = parent.end;
        level++;
    }

    // テキストが見つからなかった場合
    if (collectedTexts.length === 0) {
        return '[No surrounding text found]';
    }

    return '[IMAGE LOCATION]\n' + collectedTexts.join('\n');
}
