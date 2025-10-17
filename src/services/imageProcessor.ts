/**
 * Image processing service for ALT text generation
 * Handles image tag detection, data loading, and ALT text application
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';
import { generateAltTextWithRetry } from '../core/gemini';
import { safeEditDocument, escapeHtml, sanitizeFilePath, validateImageSrc } from '../utils/security';
import { getMimeType } from '../utils/fileUtils';
import { formatMessage, extractSurroundingText } from '../utils/textUtils';
import { getContextRangeValue } from '../utils/config';
import { detectStaticFileDirectory } from './frameworkDetector';
import { API_CONFIG, SPECIAL_KEYWORDS } from '../constants';

/**
 * Tag information extracted from document
 */
export interface TagInfo {
    selectedText: string;
    actualSelection: vscode.Selection;
    imageSrc: string;
    imageFileName: string;
    tagType: 'img' | 'Image';
}

/**
 * Image data loaded from file or URL
 */
export interface ImageData {
    base64Image: string;
    mimeType: string;
}

/**
 * Result of ALT text generation
 */
export interface AltTextResult {
    selection: vscode.Selection;
    altText: string;
    newText: string;
    actualSelection: vscode.Selection;
    success: boolean;
}

/**
 * Extract tag information from selection
 */
export async function extractTagInfo(
    editor: vscode.TextEditor,
    selection: vscode.Selection
): Promise<TagInfo | null> {
    const document = editor.document;
    let selectedText = document.getText(selection);
    let actualSelection = selection;

    // カーソル位置または最小限の選択の場合、imgまたはImageタグ全体を検出
    if (selectedText.trim().length < 10 || !selectedText.includes('>')) {
        const cursorPosition = selection.active;
        const fullText = document.getText();
        const offset = document.offsetAt(cursorPosition);

        // <imgまたは<Imageを後方検索
        const imgIndex = fullText.lastIndexOf('<img', offset);
        const ImageIndex = fullText.lastIndexOf('<Image', offset);

        let startIndex = -1;
        let tagType: 'img' | 'Image' = 'img';

        // より近いタグを選択
        if (imgIndex === -1 && ImageIndex === -1) {
            vscode.window.showErrorMessage('❌ img tag not found');
            return null;
        } else if (imgIndex > ImageIndex) {
            startIndex = imgIndex;
            tagType = 'img';
        } else {
            startIndex = ImageIndex;
            tagType = 'Image';
        }

        // >または/>を前方検索（自己閉じまたは通常閉じ）
        let endIndex = fullText.indexOf('>', startIndex);
        if (endIndex === -1) {
            vscode.window.showErrorMessage(formatMessage('❌ {0} tag end not found', tagType));
            return null;
        }
        endIndex++; // '>'を含める

        // 新しい選択範囲を作成
        const startPos = document.positionAt(startIndex);
        const endPos = document.positionAt(endIndex);
        actualSelection = new vscode.Selection(startPos, endPos);
        selectedText = document.getText(actualSelection);
    }

    // imgまたはImageタグからsrc属性を抽出
    let srcMatch = selectedText.match(/src=(["'])([^"']+)\1/);
    let imageSrc: string;

    if (srcMatch) {
        imageSrc = srcMatch[2];
    } else {
        // JSX形式を試行
        const jsxMatch = selectedText.match(/src=\{["']?([^"'}]+)["']?\}/);
        if (jsxMatch) {
            imageSrc = jsxMatch[1];
        } else {
            vscode.window.showErrorMessage('❌ img src not found');
            return null;
        }
    }

    // 入力検証
    const validation = validateImageSrc(imageSrc);
    if (!validation.valid) {
        vscode.window.showErrorMessage(formatMessage('🚫 Invalid image source: {0}', validation.reason || 'Unknown error'));
        return null;
    }

    // 動的src属性を検出
    const isDynamic =
        imageSrc.includes('$') ||
        imageSrc.includes('(') ||
        (imageSrc.match(/^[a-zA-Z_][a-zA-Z0-9_.]*$/) && !imageSrc.includes('/') && !imageSrc.includes('.'));

    if (isDynamic) {
        vscode.window.showErrorMessage(formatMessage('🚫 Dynamic src not supported: {0}', imageSrc));
        return null;
    }

    const imageFileName = path.basename(imageSrc);
    const tagType = selectedText.includes('<Image') ? 'Image' : 'img';

    return {
        selectedText,
        actualSelection,
        imageSrc,
        imageFileName,
        tagType
    };
}

/**
 * Check if image is decorative based on filename
 */
export function isDecorativeImage(imageFileName: string): boolean {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const decorativeKeywords = config.get<string[]>('decorativeKeywords', ['icon-', 'bg-', 'deco-']);

    return decorativeKeywords.some(keyword =>
        imageFileName.toLowerCase().includes(keyword.toLowerCase())
    );
}

/**
 * Load image data from file or URL
 */
export async function loadImageData(
    imageSrc: string,
    editor: vscode.TextEditor
): Promise<ImageData | null> {
    let base64Image: string;
    let mimeType: string;

    // 絶対URLの場合
    if (imageSrc.toLowerCase().startsWith('http://') || imageSrc.toLowerCase().startsWith('https://')) {
        try {
            const response = await fetch(imageSrc);
            if (!response.ok) {
                vscode.window.showErrorMessage(formatMessage('❌ Failed to fetch image: {0}', response.statusText));
                return null;
            }
            const buffer = await response.buffer();
            base64Image = buffer.toString('base64');

            const contentType = response.headers.get('content-type');
            if (contentType && contentType.startsWith('image/')) {
                mimeType = contentType;
            } else {
                mimeType = getMimeType(imageSrc);
            }
        } catch (error) {
            vscode.window.showErrorMessage(formatMessage('❌ Error fetching image: {0}', error instanceof Error ? error.message : String(error)));
            return null;
        }
    } else {
        // ローカルファイルの場合
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('❌ Workspace not opened');
            return null;
        }

        let imagePath: string | null;
        if (imageSrc.startsWith('/')) {
            const staticDir = detectStaticFileDirectory(workspaceFolder.uri.fsPath);
            const basePath = staticDir
                ? path.join(workspaceFolder.uri.fsPath, staticDir)
                : workspaceFolder.uri.fsPath;
            imagePath = sanitizeFilePath(imageSrc, basePath);
        } else {
            const documentDir = path.dirname(editor.document.uri.fsPath);
            imagePath = sanitizeFilePath(imageSrc, documentDir);
        }

        if (!imagePath) {
            vscode.window.showErrorMessage('🚫 Invalid file path');
            return null;
        }

        if (!fs.existsSync(imagePath)) {
            const displayPath = path.basename(imagePath);
            vscode.window.showErrorMessage(formatMessage('❌ Image not found: {0}', displayPath));
            return null;
        }

        if (path.extname(imagePath).toLowerCase() === '.svg') {
            vscode.window.showErrorMessage('🚫 SVG not supported. Convert to PNG/JPG first.');
            return null;
        }

        const imageBuffer = fs.readFileSync(imagePath);
        base64Image = imageBuffer.toString('base64');
        mimeType = getMimeType(imagePath);
    }

    return {
        base64Image,
        mimeType
    };
}

/**
 * Generate decorative ALT text (empty alt="")
 */
export function generateDecorativeAlt(
    tagInfo: TagInfo,
    insertionMode: string
): { newText: string; altText: string } {
    const hasAlt = /alt=["'{][^"'}]*["'}]/.test(tagInfo.selectedText);
    let newText: string;

    if (hasAlt) {
        newText = tagInfo.selectedText.replace(/alt=["'{][^"'}]*["'}]/, 'alt=""');
    } else {
        if (tagInfo.tagType === 'Image') {
            newText = tagInfo.selectedText.replace(/<Image/, '<Image alt=""');
        } else {
            newText = tagInfo.selectedText.replace(/<img/, '<img alt=""');
        }
    }

    const altText = insertionMode === 'auto' ? 'Decorative image' : 'Decorative image (alt="")';
    return { newText, altText };
}

/**
 * Apply generated ALT text to tag
 */
export function applyAltTextToTag(
    selectedText: string,
    altText: string,
    tagType: 'img' | 'Image'
): string {
    const safeAltText = escapeHtml(altText);
    const hasAlt = /alt=["'{][^"'}]*["'}]/.test(selectedText);

    if (hasAlt) {
        return selectedText.replace(/alt=["'{][^"'}]*["'}]/, `alt="${safeAltText}"`);
    } else {
        if (tagType === 'Image') {
            return selectedText.replace(/<Image/, `<Image alt="${safeAltText}"`);
        } else {
            return selectedText.replace(/<img/, `<img alt="${safeAltText}"`);
        }
    }
}

/**
 * Process single image tag
 * Main entry point for image processing
 */
export async function processSingleImageTag(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    token?: vscode.CancellationToken,
    progress?: vscode.Progress<{message?: string; increment?: number}>,
    processedCount?: number,
    totalCount?: number,
    insertionMode?: string,
    cachedSurroundingText?: string
): Promise<AltTextResult | void> {
    // Extract tag information
    const tagInfo = await extractTagInfo(editor, selection);
    if (!tagInfo) {
        return;
    }

    // Update progress
    if (progress && typeof processedCount === 'number' && typeof totalCount === 'number') {
        const message = totalCount === 1
            ? tagInfo.imageFileName
            : formatMessage('{0} {1}/{2} - {3}', '[IMG]', processedCount + 1, totalCount, tagInfo.imageFileName);
        progress.report({
            message,
            increment: (100 / totalCount)
        });
    }

    // Check if decorative image
    if (isDecorativeImage(tagInfo.imageFileName)) {
        const { newText, altText } = generateDecorativeAlt(tagInfo, insertionMode || 'auto');

        if (insertionMode === 'auto') {
            const success = await safeEditDocument(editor, tagInfo.actualSelection, newText);
            if (success) {
                vscode.window.showInformationMessage('🎨 ALT: Decorative image (alt="")');
            }
            return {
                selection,
                altText,
                newText,
                actualSelection: tagInfo.actualSelection,
                success: true
            };
        } else {
            return {
                selection,
                altText,
                newText,
                actualSelection: tagInfo.actualSelection,
                success: true
            };
        }
    }

    // Load image data
    const imageData = await loadImageData(tagInfo.imageSrc, editor);
    if (!imageData) {
        return;
    }

    // Get API configuration
    const apiKey = await context.secrets.get('altGenGemini.geminiApiKey');
    if (!apiKey) {
        vscode.window.showErrorMessage('🔑 API key not configured');
        return;
    }

    const config = vscode.workspace.getConfiguration('altGenGemini');
    const generationMode = config.get<string>('generationMode', 'SEO');
    const geminiModel = config.get<string>('geminiApiModel', API_CONFIG.DEFAULT_MODEL);

    // Get surrounding text (use cached if available, otherwise extract)
    let surroundingText: string | undefined;
    if (cachedSurroundingText !== undefined) {
        // Use cached surrounding text for batch processing optimization
        surroundingText = cachedSurroundingText;
    } else {
        // Extract surrounding text if not cached
        const contextEnabled = config.get<boolean>('contextEnabled', true);
        const contextRange = getContextRangeValue();

        if (contextEnabled) {
            surroundingText = extractSurroundingText(editor.document, tagInfo.actualSelection, contextRange);
        }
    }

    // Generate ALT text
    try {
        if (token?.isCancellationRequested) {
            return;
        }

        const altText = await generateAltTextWithRetry(
            apiKey,
            imageData.base64Image,
            imageData.mimeType,
            generationMode,
            geminiModel,
            token,
            surroundingText,
            API_CONFIG.MAX_RETRIES
        );

        if (token?.isCancellationRequested) {
            return;
        }

        // Handle DECORATIVE response
        if (altText.trim() === SPECIAL_KEYWORDS.DECORATIVE) {
            const { newText, altText: decorativeAlt } = generateDecorativeAlt(tagInfo, insertionMode || 'auto');

            if (insertionMode === 'auto') {
                const success = await safeEditDocument(editor, tagInfo.actualSelection, newText);
                if (success) {
                    vscode.window.showInformationMessage('📝 ALT: Already described by surrounding text (alt="")');
                }
                return {
                    selection,
                    altText: 'Already described by surrounding text',
                    newText,
                    actualSelection: tagInfo.actualSelection,
                    success: true
                };
            } else {
                return {
                    selection,
                    altText: 'Already described by surrounding text (alt="")',
                    newText,
                    actualSelection: tagInfo.actualSelection,
                    success: true
                };
            }
        }

        // Apply ALT text
        const newText = applyAltTextToTag(tagInfo.selectedText, altText, tagInfo.tagType);

        if (insertionMode === 'auto') {
            const success = await safeEditDocument(editor, tagInfo.actualSelection, newText);
            if (success) {
                vscode.window.showInformationMessage(formatMessage('✅ ALT: {0}', altText));
            }
            return {
                selection,
                altText,
                newText,
                actualSelection: tagInfo.actualSelection,
                success: true
            };
        } else {
            return {
                selection,
                altText,
                newText,
                actualSelection: tagInfo.actualSelection,
                success: true
            };
        }
    } catch (error) {
        throw error; // Re-throw to be handled by caller
    }
}
