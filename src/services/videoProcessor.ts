/**
 * Video processing service for aria-label generation
 * Handles video tag detection, data loading, and aria-label application
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { generateVideoAriaLabelWithRetry } from '../core/gemini';
import { needsSurroundingText, getGeminiApiModel, loadCustomPrompts } from '../core/prompts';
import { safeEditDocument, escapeHtml, sanitizeFilePath } from '../utils/security';
import { getVideoMimeType, getCommentFormat } from '../utils/fileUtils';
import { formatMessage, extractSurroundingText } from '../utils/textUtils';
import { detectStaticFileDirectory } from './frameworkDetector';
import { API_CONFIG, SPECIAL_KEYWORDS, CONTEXT_RANGE_VALUES } from '../constants';

/**
 * Video tag information
 */
interface VideoTagInfo {
    selectedText: string;
    actualSelection: vscode.Selection;
    videoSrc: string;
    videoFileName: string;
}

/**
 * Video data loaded from file
 */
interface VideoData {
    base64Video: string;
    mimeType: string;
    fileSizeMB: number;
}

/**
 * Result of aria-label generation
 */
interface AriaLabelResult {
    newText: string;
    ariaLabel: string;
    actualSelection: vscode.Selection;
    success: boolean;
    replacedLength?: number; // Length of the original text that was replaced
}

/**
 * Extract video tag information from selection
 */
async function extractVideoTagInfo(
    editor: vscode.TextEditor,
    selection: vscode.Selection
): Promise<VideoTagInfo | null> {
    const document = editor.document;
    let selectedText = document.getText(selection);
    let actualSelection = selection;

    // カーソル位置または最小限の選択の場合、videoタグ全体を検出
    if (selectedText.trim().length < 10 || !selectedText.includes('>')) {
        const cursorPosition = selection.active;
        const fullText = document.getText();
        const offset = document.offsetAt(cursorPosition);

        // <videoを後方検索
        const videoStartIndex = fullText.lastIndexOf('<video', offset);

        if (videoStartIndex === -1) {
            vscode.window.showErrorMessage('❌ video tag not found');
            return null;
        }

        // </video>または自己閉じ/>を前方検索
        let endIndex = fullText.indexOf('</video>', videoStartIndex);
        if (endIndex !== -1) {
            endIndex += '</video>'.length;
        } else {
            endIndex = fullText.indexOf('/>', videoStartIndex);
            if (endIndex !== -1) {
                endIndex += 2;
            } else {
                vscode.window.showErrorMessage('❌ video tag end not found');
                return null;
            }
        }

        // Get the start and end positions of the video tag
        const startPos = document.positionAt(videoStartIndex);
        const endPos = document.positionAt(endIndex);

        // Create selection for the video tag itself (not including preceding whitespace)
        actualSelection = new vscode.Selection(startPos, endPos);
        selectedText = document.getText(actualSelection);
    }

    // videoタグからsrc属性を抽出
    let videoSrc = selectedText.match(/src=["']([^"']+)["']/)?.[1];

    // src属性がない場合、<source>タグから取得
    if (!videoSrc) {
        videoSrc = selectedText.match(/<source[^>]+src=["']([^"']+)["']/)?.[1];
    }

    if (!videoSrc) {
        vscode.window.showErrorMessage('❌ video src not found');
        return null;
    }

    const videoFileName = path.basename(videoSrc);

    return {
        selectedText,
        actualSelection,
        videoSrc,
        videoFileName
    };
}

/**
 * Load video data from file
 */
async function loadVideoData(
    videoSrc: string,
    editor: vscode.TextEditor
): Promise<VideoData | null> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('❌ Workspace not opened');
        return null;
    }

    // 動画の絶対パスを取得
    let videoPath: string | null;
    if (videoSrc.startsWith('/')) {
        const staticDir = detectStaticFileDirectory(workspaceFolder.uri.fsPath);
        const basePath = staticDir
            ? path.join(workspaceFolder.uri.fsPath, staticDir)
            : workspaceFolder.uri.fsPath;
        videoPath = sanitizeFilePath(videoSrc, basePath);
    } else {
        const documentDir = path.dirname(editor.document.uri.fsPath);
        videoPath = sanitizeFilePath(videoSrc, documentDir);
    }

    if (!videoPath) {
        vscode.window.showErrorMessage('🚫 Invalid file path');
        return null;
    }

    if (!fs.existsSync(videoPath)) {
        const displayPath = path.basename(videoPath);
        vscode.window.showErrorMessage(formatMessage('❌ Video not found: {0}', displayPath));
        return null;
    }

    // ファイルサイズチェック
    const stats = fs.statSync(videoPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > API_CONFIG.MAX_VIDEO_SIZE_MB) {
        vscode.window.showErrorMessage(formatMessage('❌ Video too large ({0}MB). Max {1}MB.', fileSizeMB.toFixed(2), API_CONFIG.MAX_VIDEO_SIZE_MB));
        return null;
    }

    const videoBuffer = fs.readFileSync(videoPath);
    const base64Video = videoBuffer.toString('base64');
    const mimeType = getVideoMimeType(videoPath);

    return {
        base64Video,
        mimeType,
        fileSizeMB
    };
}

/**
 * Apply aria-label to video tag
 */
function applyAriaLabelToTag(
    selectedText: string,
    ariaLabel: string
): string {
    const safeAriaLabel = escapeHtml(ariaLabel);
    const hasAriaLabel = /aria-label=["'][^"']*["']/.test(selectedText);

    if (hasAriaLabel) {
        return selectedText.replace(/aria-label=["'][^"']*["']/, `aria-label="${safeAriaLabel}"`);
    } else {
        return selectedText.replace(/<video/, `<video aria-label="${safeAriaLabel}"`);
    }
}

/**
 * Process single video tag
 * Main entry point for video processing
 */
export async function processSingleVideoTag(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    token?: vscode.CancellationToken,
    insertionMode?: string,
    cachedSurroundingText?: string,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<AriaLabelResult | void> {
    // Extract video tag information
    const videoTagInfo = await extractVideoTagInfo(editor, selection);
    if (!videoTagInfo) {
        return;
    }

    // Update progress with filename
    if (progress) {
        progress.report({ message: `[VIDEO] ${videoTagInfo.videoFileName}` });
    }

    // Load video data
    const videoData = await loadVideoData(videoTagInfo.videoSrc, editor);
    if (!videoData) {
        return;
    }

    // Get API configuration
    const apiKey = await context.secrets.get('altGenGemini.geminiApiKey');
    if (!apiKey) {
        vscode.window.showErrorMessage('🔑 API key not configured');
        return;
    }

    const config = vscode.workspace.getConfiguration('altGenGemini');
    const videoDescriptionLength = config.get<string>('videoDescriptionMode', 'summary') as 'summary' | 'transcript';

    // Load custom prompts once for all subsequent operations
    const customPrompts = loadCustomPrompts();
    const geminiModel = getGeminiApiModel(customPrompts);

    // Get surrounding text (use cached if available, otherwise extract)
    // Only extract if custom prompts require it
    let surroundingText: string | undefined;
    if (cachedSurroundingText !== undefined) {
        // Use cached surrounding text for batch processing optimization
        surroundingText = cachedSurroundingText;
    } else {
        // Extract surrounding text only if custom prompts contain {surroundingText} placeholder
        if (needsSurroundingText('video', videoDescriptionLength, customPrompts)) {
            const contextRange = CONTEXT_RANGE_VALUES.default; // Use default context range
            surroundingText = extractSurroundingText(editor.document, videoTagInfo.actualSelection, contextRange);
        }
    }

    if (token?.isCancellationRequested) {
        return;
    }

    // Generate aria-label or description
    const description = await generateVideoAriaLabelWithRetry(
        apiKey,
        videoData.base64Video,
        videoData.mimeType,
        geminiModel,
        token,
        surroundingText,
        API_CONFIG.MAX_RETRIES,
        videoDescriptionLength
    );

    if (token?.isCancellationRequested) {
        return;
    }

    // Handle DECORATIVE response (don't add aria-label)
    if (description.trim() === SPECIAL_KEYWORDS.DECORATIVE) {
        if (insertionMode === 'auto') {
            vscode.window.showInformationMessage('📝 aria-label: Already described by surrounding text (not added)');
        }
        return {
            newText: videoTagInfo.selectedText,
            ariaLabel: 'Already described by surrounding text (not added)',
            actualSelection: videoTagInfo.actualSelection,
            success: true
        };
    }

    // Handle transcript mode - output as comment (format based on file type)
    if (videoDescriptionLength === 'transcript') {
        const comment = getCommentFormat(editor.document.fileName, `Video description: ${description}`);

        // Get indentation from the line where the video tag starts
        const videoTagLine = editor.document.lineAt(videoTagInfo.actualSelection.start.line);
        const videoTagStartColumn = videoTagInfo.actualSelection.start.character;

        // Extract indentation (whitespace before <video tag)
        const indentation = videoTagLine.text.substring(0, videoTagStartColumn);

        // Create expanded selection that includes preceding indentation on the same line
        const expandedStart = new vscode.Position(videoTagInfo.actualSelection.start.line, 0);
        const expandedSelection = new vscode.Selection(expandedStart, videoTagInfo.actualSelection.end);

        // Get the full text being replaced (including indentation)
        const replacedText = editor.document.getText(expandedSelection);

        // Add comment with same indentation, then the full replaced text (which includes the video tag)
        const newText = `${indentation}${comment}\n${replacedText}`;

        // Calculate the length of text being replaced
        const replacedLength = replacedText.length;

        if (insertionMode === 'auto') {
            const success = await safeEditDocument(editor, expandedSelection, newText);
            if (success) {
                vscode.window.showInformationMessage(formatMessage('✅ Video description added as comment: {0}', description));
            }
        }

        return { newText, ariaLabel: description, actualSelection: expandedSelection, success: true, replacedLength };
    }

    // Standard mode - Apply aria-label
    const newText = applyAriaLabelToTag(videoTagInfo.selectedText, description);

    if (insertionMode === 'auto') {
        const success = await safeEditDocument(editor, videoTagInfo.actualSelection, newText);
        if (success) {
            vscode.window.showInformationMessage(formatMessage('✅ aria-label: {0}', description));
        }
        return { newText, ariaLabel: description, actualSelection: videoTagInfo.actualSelection, success: true };
    } else {
        return { newText, ariaLabel: description, actualSelection: videoTagInfo.actualSelection, success: true };
    }
}
