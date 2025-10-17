import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

// Core modules
import { generateAltText, generateVideoAriaLabel } from './core/gemini';

// Utils
import { safeEditDocument, escapeHtml, sanitizeFilePath, validateImageSrc } from './utils/security';
import { getMimeType, getVideoMimeType } from './utils/fileUtils';
import { formatMessage, extractSurroundingText } from './utils/textUtils';
import { detectTagType, detectAllTags, extractImageFileName, extractVideoFileName } from './utils/tagUtils';
import { getContextRangeValue } from './utils/config';
import { waitForRateLimit } from './utils/rateLimit';

// Services
import { detectStaticFileDirectory } from './services/frameworkDetector';

export async function activate(context: vscode.ExtensionContext) {
    // 起動時にAPIキーを伏せ字表示に変換
    await maskApiKeyInSettings(context);

    // 設定変更を監視してAPIキーを保存・マスク化
    const configWatcher = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('altGenGemini.geminiApiKey')) {
            await handleApiKeyChange(context);
        }
    });
    context.subscriptions.push(configWatcher);

    // スマートALT/aria-label生成コマンド（タグタイプを自動検出）
    let disposable = vscode.commands.registerCommand('alt-generator.generateAlt', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const selections = editor.selections;
        const firstSelection = selections[0];

        // 選択が空（カーソルのみ）かどうかを確認
        const isEmptySelection = firstSelection.isEmpty || editor.document.getText(firstSelection).trim().length < 5;

        if (isEmptySelection) {
            // カーソル位置のタグを検出（従来の動作）
            const tagType = detectTagType(editor, firstSelection);

            if (tagType === 'video') {
                await vscode.commands.executeCommand('alt-generator.generateVideoAriaLabel');
                return;
            } else if (tagType === 'img') {
                await generateAltForImages(context, editor, selections);
                return;
            } else {
                vscode.window.showErrorMessage('No img or video tag found at cursor position');
                return;
            }
        } else {
            // 選択範囲内のすべてのタグを検出
            const allTags = detectAllTags(editor, firstSelection);

            if (allTags.length === 0) {
                vscode.window.showErrorMessage('No img or video tag found at cursor position');
                return;
            }

            // imgタグとvideoタグを分離
            const imgTags = allTags.filter(tag => tag.type === 'img');
            const videoTags = allTags.filter(tag => tag.type === 'video');

            // タグを処理
            await processMultipleTags(context, editor, imgTags, videoTags);
        }
    });

    context.subscriptions.push(disposable);

    // videoタグのaria-label生成コマンド
    let videoDisposable = vscode.commands.registerCommand('alt-generator.generateVideoAriaLabel', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        await generateAriaLabelForVideo(context, editor);
    });

    context.subscriptions.push(videoDisposable);

    // APIキーを完全に削除するコマンド（デバッグ用）
    let clearApiKeyDisposable = vscode.commands.registerCommand('alt-generator.clearApiKey', async () => {
        await context.secrets.delete('altGenGemini.geminiApiKey');
        const config = vscode.workspace.getConfiguration('altGenGemini');
        await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Global);
        await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage('✅ API Key cleared from all storage locations');
        console.log('[ALT Generator] API key manually cleared');
    });

    context.subscriptions.push(clearApiKeyDisposable);
}

// 設定変更時のAPIキー処理
async function handleApiKeyChange(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const displayedKey = config.get<string>('geminiApiKey', '');

    // Debug: API key change event
    // console.log('[ALT Generator] handleApiKeyChange called');
    // console.log('[ALT Generator] displayedKey:', displayedKey ? `${displayedKey.substring(0, 4)}...` : 'empty');

    // 空の場合はAPIキーを削除
    if (!displayedKey || displayedKey.trim() === '') {
        // console.log('[ALT Generator] Deleting API key from secrets...');
        await context.secrets.delete('altGenGemini.geminiApiKey');
        await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Global);
        await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Workspace);
        // console.log('[ALT Generator] API key deleted successfully');
        vscode.window.showInformationMessage('✅ API Key deleted from settings');
        return;
    }

    // 既にマスク済みの場合は何もしない（*や.を含む場合）
    if (displayedKey.includes('*') || /^\.+/.test(displayedKey)) {
        // console.log('[ALT Generator] API key is already masked, skipping...');
        return;
    }

    // console.log('[ALT Generator] Storing new API key...');
    // 新しいAPIキーとして保存
    await context.secrets.store('altGenGemini.geminiApiKey', displayedKey);

    // 設定画面に伏せ字で表示
    const maskedKey = displayedKey.length > 4
        ? '.'.repeat(displayedKey.length - 4) + displayedKey.substring(displayedKey.length - 4)
        : '.'.repeat(displayedKey.length);

    await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Global);
    await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Workspace);
    // console.log('[ALT Generator] New API key stored and masked');
}

// 起動時にAPIキーを伏せ字表示
async function maskApiKeyInSettings(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const displayedKey = config.get<string>('geminiApiKey', '');
    const storedKey = await context.secrets.get('altGenGemini.geminiApiKey');

    // Debug: API key masking on startup
    // console.log('[ALT Generator] maskApiKeyInSettings called');
    // console.log('[ALT Generator] displayedKey length:', displayedKey.length);
    // console.log('[ALT Generator] storedKey exists:', !!storedKey);

    // 設定画面が空の場合、Secretsも削除（settings.jsonを直接編集して削除した場合に対応）
    if (!displayedKey || displayedKey.trim() === '') {
        if (storedKey && storedKey.trim() !== '') {
            await context.secrets.delete('altGenGemini.geminiApiKey');
        }
        return;
    }

    // 設定画面にマスクされていない生のAPIキーがある場合
    const isAlreadyMasked = displayedKey.includes('*') || /^\.+/.test(displayedKey);
    // console.log('[ALT Generator] isAlreadyMasked:', isAlreadyMasked);

    if (!isAlreadyMasked) {
        // console.log('[ALT Generator] Masking API key...');
        // Secretsに保存
        await context.secrets.store('altGenGemini.geminiApiKey', displayedKey);

        // マスク表示に変換
        const maskedKey = displayedKey.length > 4
            ? '.'.repeat(displayedKey.length - 4) + displayedKey.substring(displayedKey.length - 4)
            : '.'.repeat(displayedKey.length);

        // console.log('[ALT Generator] Masked key:', maskedKey);

        // GlobalとWorkspace両方を更新
        await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Global);
        await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Workspace);

        // console.log('[ALT Generator] API key masked successfully');
    }
}

// 安全なストレージからAPIキーを取得
async function getApiKey(context: vscode.ExtensionContext): Promise<string | undefined> {
    return await context.secrets.get('altGenGemini.geminiApiKey');
}

// 複数タグ（imgとvideoの混在）を処理する関数
async function processMultipleTags(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    imgTags: Array<{type: 'img' | 'video', range: vscode.Range, text: string}>,
    videoTags: Array<{type: 'img' | 'video', range: vscode.Range, text: string}>
) {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const insertionMode = config.get<string>('insertionMode', 'auto');
    const totalCount = imgTags.length + videoTags.length;

    // 初期タイトルを決定
    let progressTitle: string;
    const isMixed = imgTags.length > 0 && videoTags.length > 0;

    if (imgTags.length > 0 && videoTags.length === 0) {
        progressTitle = 'Generating ALT attributes...';
    } else if (imgTags.length === 0 && videoTags.length > 0) {
        progressTitle = 'Generating aria-labels...';
    } else {
        // 混在の場合は固定タイトル（詳細はメッセージに表示）
        progressTitle = 'Processing...';
    }

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: progressTitle,
        cancellable: true
    }, async (progress, token) => {
        let processedCount = 0;

        // imgタグを処理
        for (const tag of imgTags) {
            if (token.isCancellationRequested) {
                vscode.window.showWarningMessage(formatMessage('ALT attribute generation cancelled ({0}/{1} items processed)', processedCount, totalCount));
                return;
            }

            const fileName = extractImageFileName(tag.text);

            // imgタグ処理中のメッセージ
            const prefix = isMixed ? 'Generating ALT attributes...: ' : '';
            progress.report({
                message: prefix + formatMessage('All {0} items - {1}/{2} - {3}', totalCount, processedCount + 1, totalCount, fileName),
                increment: (100 / totalCount)
            });

            const selection = new vscode.Selection(tag.range.start, tag.range.end);
            const result = await processImgTag(context, editor, selection, token, undefined, processedCount, totalCount, insertionMode);

            if (result) {
                if (insertionMode === 'confirm') {
                    // 個別確認ダイアログを表示
                    const choice = await vscode.window.showInformationMessage(
                        `Generated ALT attribute:\n${result.altText}\n\nInsert this ALT attribute?`,
                        'Insert',
                        'Skip',
                        'Cancel'
                    );

                    if (choice === 'Insert') {
                        const success = await safeEditDocument(editor, result.actualSelection, result.newText);
                        if (!success) {
                            return;
                        }
                    } else if (choice === 'Cancel') {
                        vscode.window.showWarningMessage(formatMessage('ALT attribute generation cancelled ({0}/{1} items processed)', processedCount + 1, totalCount));
                        return;
                    }
                    // 'Skip'の場合は何もせず次へ
                }
            }

            processedCount++;
        }

        // videoタグを処理
        for (const tag of videoTags) {
            if (token.isCancellationRequested) {
                vscode.window.showWarningMessage(formatMessage('ALT attribute generation cancelled ({0}/{1} items processed)', processedCount, totalCount));
                return;
            }

            const fileName = extractVideoFileName(tag.text);

            // videoタグ処理中のメッセージ
            const prefix = isMixed ? 'Generating aria-labels...: ' : '';
            progress.report({
                message: prefix + formatMessage('All {0} items - {1}/{2} - {3}', totalCount, processedCount + 1, totalCount, fileName),
                increment: (100 / totalCount)
            });

            const selection = new vscode.Selection(tag.range.start, tag.range.end);
            const result = await processVideoTag(context, editor, selection, token);

            if (result && insertionMode === 'confirm') {
                // 個別確認ダイアログを表示
                const choice = await vscode.window.showInformationMessage(
                    `aria-label generated: ${result.ariaLabel}\n\nInsert this ALT attribute?`,
                    'Insert',
                    'Skip',
                    'Cancel'
                );

                if (choice === 'Insert') {
                    const success = await safeEditDocument(editor, selection, result.newText);
                    if (!success) {
                        return;
                    }
                } else if (choice === 'Cancel') {
                    vscode.window.showWarningMessage(formatMessage('ALT attribute generation cancelled ({0}/{1} items processed)', processedCount + 1, totalCount));
                    return;
                }
                // 'Skip'の場合は何もせず次へ
            }

            processedCount++;
        }

        // autoモードの場合のみ完了メッセージを表示
        if (insertionMode === 'auto' && totalCount > 1) {
            vscode.window.showInformationMessage(formatMessage('{0} ALT attributes generated successfully', totalCount));
        } else if (insertionMode === 'confirm' && totalCount > 1) {
            vscode.window.showInformationMessage(formatMessage('Processed {0} images', totalCount));
        }
    });
}

// imgタグのALT生成処理
async function generateAltForImages(context: vscode.ExtensionContext, editor: vscode.TextEditor, selections: readonly vscode.Selection[]) {

        // 挿入モード設定を取得
        const config = vscode.workspace.getConfiguration('altGenGemini');
        const insertionMode = config.get<string>('insertionMode', 'auto');

        // 常に進捗ダイアログを表示
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating ALT tags...',
            cancellable: true
        }, async (progress, token) => {
            let processedCount = 0;
            const totalCount = selections.length;

            for (const selection of selections) {
                // キャンセルチェック
                if (token?.isCancellationRequested) {
                    vscode.window.showWarningMessage(formatMessage('ALT tag generation cancelled ({0}/{1} items processed)', processedCount, totalCount));
                    return;
                }

                const result = await processImgTag(context, editor, selection, token, progress, processedCount, totalCount, insertionMode);

                if (result) {
                    if (insertionMode === 'confirm') {
                        // 各画像について即座に確認ダイアログを表示
                        const choice = await vscode.window.showInformationMessage(
                            `Generated ALT tag:\n${result.altText}\n\nInsert this ALT tag?`,
                            'Insert',
                            'Skip',
                            'Cancel'
                        );

                        if (choice === 'Insert') {
                            const success = await safeEditDocument(editor, result.actualSelection, result.newText);
                            if (!success) {
                                return;
                            }
                        } else if (choice === 'Cancel') {
                            vscode.window.showWarningMessage(formatMessage('ALT tag generation cancelled ({0}/{1} items processed)', processedCount + 1, totalCount));
                            return;
                        }
                        // 'Skip'の場合は次の画像へ続行
                    }
                }

                processedCount++;
            }

            if (insertionMode === 'auto' && totalCount > 1) {
                vscode.window.showInformationMessage(formatMessage('{0} ALT tags generated successfully', totalCount));
            } else if (insertionMode === 'confirm' && totalCount > 1) {
                vscode.window.showInformationMessage(formatMessage('Processed {0} images', totalCount));
            }
        });
}

// videoタグを処理する関数（processMultipleTagsから呼ばれる）
async function processVideoTag(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    token?: vscode.CancellationToken
): Promise<{newText: string, ariaLabel: string} | void> {
    const document = editor.document;
    const selectedText = document.getText(selection);

    // videoタグからsrc属性を抽出
    let videoSrc = selectedText.match(/src=["']([^"']+)["']/)?.[1];

    // src属性がない場合、<source>タグから取得
    if (!videoSrc) {
        videoSrc = selectedText.match(/<source[^>]+src=["']([^"']+)["']/)?.[1];
    }

    if (!videoSrc) {
        vscode.window.showErrorMessage('video/source tag src attribute not found');
        return;
    }

    // 現在のドキュメントが属するワークスペースフォルダを取得（マルチルートワークスペース対応）
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('Workspace not opened');
        return;
    }

    // 動画の絶対パスを取得（パストラバーサル対策）
    let videoPath: string | null;
    if (videoSrc.startsWith('/')) {
        // ルートパス（/で始まる）の場合、フレームワークの静的ファイルディレクトリを検出
        const staticDir = detectStaticFileDirectory(workspaceFolder.uri.fsPath);
        const basePath = staticDir
            ? path.join(workspaceFolder.uri.fsPath, staticDir)
            : workspaceFolder.uri.fsPath;
        videoPath = sanitizeFilePath(videoSrc, basePath);
    } else {
        // 相対パスの場合、ドキュメントディレクトリからの相対パスとして解決
        const documentDir = path.dirname(editor.document.uri.fsPath);
        videoPath = sanitizeFilePath(videoSrc, documentDir);
    }

    if (!videoPath) {
        vscode.window.showErrorMessage('Invalid file path: Path traversal attempt detected');
        return;
    }

    if (!fs.existsSync(videoPath)) {
        const displayPath = path.basename(videoPath);
        vscode.window.showErrorMessage(formatMessage('Video not found: {0}', displayPath));
        return;
    }

    const stats = fs.statSync(videoPath);
    const fileSizeMB = stats.size / (1024 * 1024);
    if (fileSizeMB > 20) {
        vscode.window.showErrorMessage(formatMessage('Video file is too large ({0}MB). Please use a video under 20MB.', fileSizeMB.toFixed(2)));
        return;
    }

    const videoBuffer = fs.readFileSync(videoPath);
    const base64Video = videoBuffer.toString('base64');
    const mimeType = getVideoMimeType(videoPath);

    const apiKey = await getApiKey(context);
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const geminiModel = config.get<string>('geminiApiModel', 'gemini-2.5-flash');

    if (!apiKey) {
        vscode.window.showErrorMessage('Gemini API key is not configured. Please set your API key in VSCode settings.');
        return;
    }

    if (token?.isCancellationRequested) {
        return;
    }

    await waitForRateLimit();

    if (token?.isCancellationRequested) {
        return;
    }

    const ariaLabel = await generateVideoAriaLabel(apiKey, base64Video, mimeType, geminiModel, token);

    if (token?.isCancellationRequested) {
        return;
    }

    // XSS対策: APIレスポンスをエスケープ
    const safeAriaLabel = escapeHtml(ariaLabel);

    const hasAriaLabel = /aria-label=["'][^"']*["']/.test(selectedText);
    let newText: string;
    if (hasAriaLabel) {
        newText = selectedText.replace(/aria-label=["'][^"']*["']/, `aria-label="${safeAriaLabel}"`);
    } else {
        newText = selectedText.replace(/<video/, `<video aria-label="${safeAriaLabel}"`);
    }

    // autoモードの場合は自動挿入
    const insertionMode = config.get<string>('insertionMode', 'auto');
    if (insertionMode === 'auto') {
        const success = await safeEditDocument(editor, selection, newText);
        if (success) {
            vscode.window.showInformationMessage(formatMessage('aria-label generated: {0}', ariaLabel));
        }
    } else {
        // confirmモード用に結果を返す
        return { newText, ariaLabel };
    }
}

// videoタグのaria-label生成処理
async function generateAriaLabelForVideo(context: vscode.ExtensionContext, editor: vscode.TextEditor) {
        const document = editor.document;
        const selection = editor.selection;
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
                vscode.window.showErrorMessage('video/source tag src attribute not found');
                return;
            }

            // </video>（または自己閉じ/>）を前方検索
            let endIndex = fullText.indexOf('</video>', videoStartIndex);
            if (endIndex !== -1) {
                endIndex += '</video>'.length;
            } else {
                // 自己閉じタグを検索
                endIndex = fullText.indexOf('/>', videoStartIndex);
                if (endIndex !== -1) {
                    endIndex += 2;
                } else {
                    vscode.window.showErrorMessage(formatMessage('{0} tag end not found', 'video'));
                    return;
                }
            }

            // 新しい選択範囲を作成
            const startPos = document.positionAt(videoStartIndex);
            const endPos = document.positionAt(endIndex);
            actualSelection = new vscode.Selection(startPos, endPos);
            selectedText = document.getText(actualSelection);
        }

        // videoタグからsrc属性を抽出（<video src="...">形式）
        let videoSrc = selectedText.match(/src=["']([^"']+)["']/)?.[1];

        // src属性がない場合、<source>タグから取得
        if (!videoSrc) {
            videoSrc = selectedText.match(/<source[^>]+src=["']([^"']+)["']/)?.[1];
        }

        if (!videoSrc) {
            vscode.window.showErrorMessage('video/source tag src attribute not found');
            return;
        }

        // 現在のドキュメントが属するワークスペースフォルダを取得（マルチルートワークスペース対応）
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Workspace not opened');
            return;
        }

        // 動画の絶対パスを取得（パストラバーサル対策）
        let videoPath: string | null;
        if (videoSrc.startsWith('/')) {
            // ルートパス（/で始まる）の場合、フレームワークの静的ファイルディレクトリを検出
            const staticDir = detectStaticFileDirectory(workspaceFolder.uri.fsPath);
            const basePath = staticDir
                ? path.join(workspaceFolder.uri.fsPath, staticDir)
                : workspaceFolder.uri.fsPath;
            videoPath = sanitizeFilePath(videoSrc, basePath);
        } else {
            // 相対パスの場合、ドキュメントディレクトリからの相対パスとして解決
            const documentDir = path.dirname(editor.document.uri.fsPath);
            videoPath = sanitizeFilePath(videoSrc, documentDir);
        }

        if (!videoPath) {
            vscode.window.showErrorMessage('Invalid file path: Path traversal attempt detected');
            return;
        }

        if (!fs.existsSync(videoPath)) {
            const displayPath = path.basename(videoPath);
            vscode.window.showErrorMessage(formatMessage('Video not found: {0}', displayPath));
            return;
        }

        // 動画ファイルサイズをチェック（20MBまで）
        const stats = fs.statSync(videoPath);
        const fileSizeMB = stats.size / (1024 * 1024);
        if (fileSizeMB > 20) {
            vscode.window.showErrorMessage(formatMessage('Video file is too large ({0}MB). Please use a video under 20MB.', fileSizeMB.toFixed(2)));
            return;
        }

        // 動画をBase64エンコード
        const videoBuffer = fs.readFileSync(videoPath);
        const base64Video = videoBuffer.toString('base64');
        const mimeType = getVideoMimeType(videoPath);

        // Gemini APIキーとモデル設定を取得
        const apiKey = await getApiKey(context);
        const config = vscode.workspace.getConfiguration('altGenGemini');
        const geminiModel = config.get<string>('geminiApiModel', 'gemini-2.5-flash');

        if (!apiKey) {
            vscode.window.showErrorMessage('Gemini API key is not configured. Please run "Set Gemini API Key" command.');
            return;
        }

        // Gemini APIを呼び出してaria-labelテキストを生成
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Analyzing video and generating aria-label...',
            cancellable: true
        }, async (_progress, token) => {
            try {
                // キャンセルチェック
                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage('aria-label generation cancelled');
                    return;
                }

                // レートリミット
                await waitForRateLimit();

                // キャンセルチェック
                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage('aria-label generation cancelled');
                    return;
                }

                const ariaLabel = await generateVideoAriaLabel(apiKey, base64Video, mimeType, geminiModel, token);

                // キャンセルチェック
                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage('aria-label generation cancelled');
                    return;
                }

                // XSS対策: APIレスポンスをエスケープ
                const safeAriaLabel = escapeHtml(ariaLabel);

                // 既存のaria-label属性をチェック
                const hasAriaLabel = /aria-label=["'][^"']*["']/.test(selectedText);

                let newText: string;
                if (hasAriaLabel) {
                    // 既存のaria-labelを置換
                    newText = selectedText.replace(/aria-label=["'][^"']*["']/, `aria-label="${safeAriaLabel}"`);
                } else {
                    // aria-label属性を追加（開始<video>タグに）
                    newText = selectedText.replace(/<video/, `<video aria-label="${safeAriaLabel}"`);
                }

                // テキストを置換
                const success = await safeEditDocument(editor, actualSelection, newText);
                if (success) {
                    vscode.window.showInformationMessage(formatMessage('aria-label generated: {0}', ariaLabel));
                }
            } catch (error) {
                // キャンセルエラーは無視
                if (token.isCancellationRequested) {
                    return;
                }
                vscode.window.showErrorMessage(formatMessage('Error: {0}', error instanceof Error ? error.message : String(error)));
            }
        });
}

// imgタグを処理する関数
async function processImgTag(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    selection: vscode.Selection,
    token?: vscode.CancellationToken,
    progress?: vscode.Progress<{message?: string; increment?: number}>,
    processedCount?: number,
    totalCount?: number,
    insertionMode?: string
): Promise<{selection: vscode.Selection, altText: string, newText: string, actualSelection: vscode.Selection} | void> {
    const document = editor.document;
    let selectedText = document.getText(selection);
    let actualSelection = selection;

    // カーソル位置または最小限の選択の場合、imgまたはImageタグ全体を検出
    if (selectedText.trim().length < 10 || !selectedText.includes('>')) {
        const cursorPosition = selection.active;
        const fullText = document.getText();

        // カーソル位置周辺でimgまたはImageタグを検索
        const offset = document.offsetAt(cursorPosition);

        // <imgまたは<Imageを後方検索
        const imgIndex = fullText.lastIndexOf('<img', offset);
        const ImageIndex = fullText.lastIndexOf('<Image', offset);

        let startIndex = -1;
        let tagType = '';

        // より近いタグを選択
        if (imgIndex === -1 && ImageIndex === -1) {
            vscode.window.showErrorMessage('img tag not found');
            return;
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
            vscode.window.showErrorMessage(formatMessage('{0} tag end not found', tagType));
            return;
        }
        endIndex++; // '>'を含める

        // 新しい選択範囲を作成
        const startPos = document.positionAt(startIndex);
        const endPos = document.positionAt(endIndex);
        actualSelection = new vscode.Selection(startPos, endPos);
        selectedText = document.getText(actualSelection);
    }

    // imgまたはImageタグからsrc属性を抽出（通常の引用符とJSX形式の両方に対応）
    let srcMatch = selectedText.match(/src=(["'])([^"']+)\1/);
    let imageSrc: string;

    if (srcMatch) {
        // 通常の引用符形式: src="..." または src='...'
        imageSrc = srcMatch[2];
    } else {
        // JSX形式を試行: src={...}
        const jsxMatch = selectedText.match(/src=\{["']?([^"'}]+)["']?\}/);
        if (jsxMatch) {
            imageSrc = jsxMatch[1];
        } else {
            vscode.window.showErrorMessage('img tag src attribute not found');
            return;
        }
    }

    // 入力検証：危険なプロトコルとパターンをチェック
    const validation = validateImageSrc(imageSrc);
    if (!validation.valid) {
        vscode.window.showErrorMessage(formatMessage('Invalid image source: {0}', validation.reason || 'Unknown error'));
        return;
    }

    // 動的src属性を検出（変数、テンプレートリテラル、関数呼び出しなど）
    // 例: {imageUrl}, {props.src}, {`/path/${id}`}, {getImage()}など
    const isDynamic =
        imageSrc.includes('$') || // テンプレートリテラル内の変数
        imageSrc.includes('(') || // 関数呼び出し
        (imageSrc.match(/^[a-zA-Z_][a-zA-Z0-9_.]*$/) && !imageSrc.includes('/') && !imageSrc.includes('.')); // 変数名（パス区切りや拡張子のない単純な識別子）

    if (isDynamic) {
        vscode.window.showErrorMessage(formatMessage('Dynamic src attributes are not supported. Only static paths (string literals) are supported. Detected: {0}', imageSrc));
        return;
    }

    const imageFileName = path.basename(imageSrc);

    // 進捗メッセージを更新
    if (progress && typeof processedCount === 'number' && typeof totalCount === 'number') {
        progress.report({
            message: formatMessage('All {0} items - {1}/{2} - {3}', totalCount, processedCount + 1, totalCount, imageFileName),
            increment: (100 / totalCount)
        });
    }

    // 装飾画像の検出
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const decorativeKeywords = config.get<string[]>('decorativeKeywords', ['icon-', 'bg-', 'deco-']);

    const isDecorativeImage = decorativeKeywords.some(keyword =>
        imageFileName.toLowerCase().includes(keyword.toLowerCase())
    );

    if (isDecorativeImage) {
        // 装飾画像の場合、空のalt属性を設定
        const hasAlt = /alt=["'{][^"'}]*["'}]/.test(selectedText);
        let newText: string;
        if (hasAlt) {
            newText = selectedText.replace(/alt=["'{][^"'}]*["'}]/, 'alt=""');
        } else {
            // <imgと<Imageタグの両方に対応
            if (selectedText.includes('<Image')) {
                newText = selectedText.replace(/<Image/, '<Image alt=""');
            } else {
                newText = selectedText.replace(/<img/, '<img alt=""');
            }
        }

        if (insertionMode === 'auto') {
            const success = await safeEditDocument(editor, actualSelection, newText);
            if (success) {
                vscode.window.showInformationMessage('Detected as decorative image: alt="" was set');
            }
        } else {
            return {selection, altText: 'Detected as decorative image. Empty alt will be inserted.', newText, actualSelection};
        }

        return;
    }

    // 画像を読み込み、Base64エンコード
    let base64Image: string;
    let mimeType: string;

    // 絶対URL（http://またはhttps://）の場合
    if (imageSrc.toLowerCase().startsWith('http://') || imageSrc.toLowerCase().startsWith('https://')) {
        try {
            const response = await fetch(imageSrc);
            if (!response.ok) {
                vscode.window.showErrorMessage(formatMessage('Failed to fetch image from URL: {0} ({1})', imageSrc, response.statusText));
                return;
            }
            const buffer = await response.buffer();
            base64Image = buffer.toString('base64');

            // Content-TypeヘッダーからMIMEタイプを取得
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.startsWith('image/')) {
                mimeType = contentType;
            } else {
                // URLの拡張子からMIMEタイプを推測
                mimeType = getMimeType(imageSrc);
            }
        } catch (error) {
            vscode.window.showErrorMessage(formatMessage('Error fetching image from URL: {0}', error instanceof Error ? error.message : String(error)));
            return;
        }
    } else {
        // ローカルファイルの場合
        // 現在のドキュメントが属するワークスペースフォルダを取得（マルチルートワークスペース対応）
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Workspace not opened');
            return;
        }

        // 画像の絶対パスを取得（パストラバーサル対策）
        let imagePath: string | null;
        if (imageSrc.startsWith('/')) {
            // ルートパス（/で始まる）の場合、フレームワークの静的ファイルディレクトリを検出
            const staticDir = detectStaticFileDirectory(workspaceFolder.uri.fsPath);
            const basePath = staticDir
                ? path.join(workspaceFolder.uri.fsPath, staticDir)
                : workspaceFolder.uri.fsPath;
            imagePath = sanitizeFilePath(imageSrc, basePath);
        } else {
            // 相対パスの場合、ドキュメントディレクトリからの相対パスとして解決
            const documentDir = path.dirname(editor.document.uri.fsPath);
            imagePath = sanitizeFilePath(imageSrc, documentDir);
        }

        if (!imagePath) {
            vscode.window.showErrorMessage('Invalid file path: Path traversal attempt detected');
            return;
        }

        if (!fs.existsSync(imagePath)) {
            const displayPath = path.basename(imagePath);
            console.error('[ALT Generator Debug] Image not found:', {
                src: imageSrc,
                workspace: workspaceFolder.uri.fsPath,
                staticDir: detectStaticFileDirectory(workspaceFolder.uri.fsPath),
                resolvedPath: imagePath
            });
            vscode.window.showErrorMessage(formatMessage('Image not found: {0}\nPath: {1}', displayPath, imagePath));
            return;
        }

        // SVG画像を検出してエラーを表示
        if (path.extname(imagePath).toLowerCase() === '.svg') {
            vscode.window.showErrorMessage('SVG images are not supported by Gemini API. Please convert to PNG/JPG manually or use raster images.');
            return;
        }

        // 画像を読み込み、Base64エンコード
        const imageBuffer = fs.readFileSync(imagePath);
        base64Image = imageBuffer.toString('base64');
        mimeType = getMimeType(imagePath);
    }

    // Gemini APIキー、生成モード、モデル設定を取得
    const apiKey = await getApiKey(context);
    const generationMode = config.get<string>('generationMode', 'SEO');
    const geminiModel = config.get<string>('geminiApiModel', 'gemini-2.5-flash');

    if (!apiKey) {
        vscode.window.showErrorMessage('Gemini API key is not configured. Please set your API key in VSCode settings.');
        return;
    }

    // 周辺テキストを取得（設定が有効な場合）
    let surroundingText: string | undefined;
    const contextEnabled = config.get<boolean>('contextEnabled', true);
    const contextRange = getContextRangeValue();

    if (contextEnabled) {
        surroundingText = extractSurroundingText(document, actualSelection, contextRange);
    }

    // Gemini APIを呼び出してALTテキストを生成
    try {
        // キャンセルチェック
        if (token?.isCancellationRequested) {
            return;
        }

        // レートリミット
        await waitForRateLimit();

        // キャンセルチェック
        if (token?.isCancellationRequested) {
            return;
        }

        const altText = await generateAltText(apiKey, base64Image, mimeType, generationMode, geminiModel, token, surroundingText);

        // キャンセルチェック
        if (token?.isCancellationRequested) {
            return;
        }

        // "DECORATIVE"判定の場合は空のALTを設定
        if (altText.trim() === 'DECORATIVE') {
            const hasAlt = /alt=["'{][^"'}]*["'}]/.test(selectedText);
            let newText: string;
            if (hasAlt) {
                newText = selectedText.replace(/alt=["'{][^"'}]*["'}]/, 'alt=""');
            } else {
                // <imgと<Imageタグの両方に対応
                if (selectedText.includes('<Image')) {
                    newText = selectedText.replace(/<Image/, '<Image alt=""');
                } else {
                    newText = selectedText.replace(/<img/, '<img alt=""');
                }
            }

            if (insertionMode === 'auto') {
                const success = await safeEditDocument(editor, actualSelection, newText);
                if (success) {
                    vscode.window.showInformationMessage('Image is already described by surrounding text: alt="" was set');
                }
            } else {
                return {selection, altText: 'Image is already described by surrounding text. Empty alt will be inserted.', newText, actualSelection};
            }

            return;
        }

        // XSS対策: APIレスポンスをエスケープ
        const safeAltText = escapeHtml(altText);

        // 既存のalt属性をチェック
        const hasAlt = /alt=["'{][^"'}]*["'}]/.test(selectedText);

        let newText: string;
        if (hasAlt) {
            // 既存のaltを置換
            newText = selectedText.replace(/alt=["'{][^"'}]*["'}]/, `alt="${safeAltText}"`);
        } else {
            // alt属性を追加（<imgと<Imageタグの両方に対応）
            if (selectedText.includes('<Image')) {
                newText = selectedText.replace(/<Image/, `<Image alt="${safeAltText}"`);
            } else {
                newText = selectedText.replace(/<img/, `<img alt="${safeAltText}"`);
            }
        }

        // 挿入モードによって処理を分岐
        if (insertionMode === 'auto') {
            // 自動挿入モード
            const success = await safeEditDocument(editor, actualSelection, newText);
            if (success) {
                vscode.window.showInformationMessage(formatMessage('ALT attribute generated: {0}', altText));
            }
        } else {
            // 確認後挿入モード
            return {selection, altText, newText, actualSelection};
        }
    } catch (error) {
        // キャンセルエラーは無視
        if (token?.isCancellationRequested) {
            return;
        }
        vscode.window.showErrorMessage(formatMessage('Error: {0}', error instanceof Error ? error.message : String(error)));
    }
}

export function deactivate() {}
