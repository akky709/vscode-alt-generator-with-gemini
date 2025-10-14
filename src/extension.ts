import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

// レートリミット用の変数
let lastRequestTime = 0;

// HTMLエスケープ関数（XSS対策）
function escapeHtml(unsafe: string): string {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// パストラバーサル対策関数
function sanitizeFilePath(filePath: string, basePath: string): string | null {
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

// 入力検証：危険なプロトコルとパターンをチェック
function validateImageSrc(src: string): { valid: boolean; reason?: string } {
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

// プレースホルダーを置き換える関数
function formatMessage(message: string, ...args: any[]): string {
    args.forEach((arg, index) => {
        message = message.replace(`{${index}}`, String(arg));
    });
    return message;
}

// ALT生成言語を取得する関数
function getOutputLanguage(): string {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const langSetting = config.get<string>('outputLanguage', 'auto');

    if (langSetting === 'auto') {
        const vscodeLang = vscode.env.language;
        return vscodeLang.startsWith('ja') ? 'ja' : 'en';
    }

    return langSetting;
}

// HTMLタグを除去してテキストコンテンツのみを取得
function stripHtmlTags(text: string): string {
    return text
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ') // scriptタグとその内容を削除
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ') // styleタグとその内容を削除
        .replace(/<[^>]+>/g, ' ') // その他のHTMLタグを削除
        .replace(/\s+/g, ' ') // 連続する空白を1つにまとめる
        .trim();
}

// 親要素を検出して範囲を返す
function findParentElement(fullText: string, imageStart: number, imageEnd: number, maxSearch: number = 5000): { start: number; end: number; tagName: string } | null {
    // 画像位置から後方に検索（最大maxSearch文字まで）
    const searchStart = Math.max(0, imageStart - maxSearch);
    const searchText = fullText.substring(searchStart, imageEnd);
    const relativeImageStart = imageStart - searchStart;

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

        // 画像より後ろのタグは無視
        if (openTagStart >= relativeImageStart) {
            continue;
        }

        // 対応する終了タグを探す
        const closeTagPattern = new RegExp(`</${tagName}>`, 'i');
        const remainingText = fullText.substring(searchStart + openTagStart);
        const closeMatch = closeTagPattern.exec(remainingText);

        if (closeMatch) {
            const closeTagEnd = openTagStart + closeMatch.index + closeMatch[0].length;
            const absoluteCloseTagEnd = searchStart + closeTagEnd;

            // 画像がこの要素内に含まれているか確認
            if (absoluteCloseTagEnd > imageEnd) {
                const distance = relativeImageStart - openTagStart;
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestParent = {
                        start: searchStart + openTagStart,
                        end: absoluteCloseTagEnd,
                        tagName: tagName
                    };
                }
            }
        }
    }

    return closestParent;
}

// 画像タグの周辺テキストを取得（構造的アプローチ）
function extractSurroundingText(
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
            collectedTexts.push(`[Text in <${parent.tagName}> before image]: ${cleanedBefore}`);
        }
        if (cleanedAfter.length > 0) {
            collectedTexts.push(`[Text in <${parent.tagName}> after image]: ${cleanedAfter}`);
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

// カーソル位置のタグタイプを検出
function detectTagType(editor: vscode.TextEditor, selection: vscode.Selection): 'img' | 'video' | null {
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

// 選択範囲内のすべてのタグを検出する関数（ReDoS対策版）
function detectAllTags(editor: vscode.TextEditor, selection: vscode.Selection): Array<{type: 'img' | 'video', range: vscode.Range, text: string}> {
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
    const imgRegex = /<(img|Image)\s[^>]{0,1000}>/gi;
    let match;
    const startTime = Date.now();
    const timeout = 5000; // 5秒タイムアウト

    while ((match = imgRegex.exec(selectedText)) !== null) {
        if (Date.now() - startTime > timeout) {
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
        if (Date.now() - startTime > timeout) {
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

    console.log('[ALT Generator] handleApiKeyChange called');
    console.log('[ALT Generator] displayedKey:', displayedKey ? `${displayedKey.substring(0, 4)}...` : 'empty');

    // 空の場合はAPIキーを削除
    if (!displayedKey || displayedKey.trim() === '') {
        console.log('[ALT Generator] Deleting API key from secrets...');
        await context.secrets.delete('altGenGemini.geminiApiKey');
        await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Global);
        await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Workspace);
        console.log('[ALT Generator] API key deleted successfully');
        vscode.window.showInformationMessage('✅ API Key deleted from settings');
        return;
    }

    // 既にマスク済みの場合は何もしない（*や.を含む場合）
    if (displayedKey.includes('*') || /^\.+/.test(displayedKey)) {
        console.log('[ALT Generator] API key is already masked, skipping...');
        return;
    }

    console.log('[ALT Generator] Storing new API key...');
    // 新しいAPIキーとして保存
    await context.secrets.store('altGenGemini.geminiApiKey', displayedKey);

    // 設定画面に伏せ字で表示
    const maskedKey = displayedKey.length > 4
        ? '.'.repeat(displayedKey.length - 4) + displayedKey.substring(displayedKey.length - 4)
        : '.'.repeat(displayedKey.length);

    await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Global);
    await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Workspace);
    console.log('[ALT Generator] New API key stored and masked');
}

// 起動時にAPIキーを伏せ字表示
async function maskApiKeyInSettings(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const displayedKey = config.get<string>('geminiApiKey', '');
    const storedKey = await context.secrets.get('altGenGemini.geminiApiKey');

    console.log('[ALT Generator] maskApiKeyInSettings called');
    console.log('[ALT Generator] displayedKey length:', displayedKey.length);
    console.log('[ALT Generator] storedKey exists:', !!storedKey);

    // 設定画面が空の場合、Secretsも削除（settings.jsonを直接編集して削除した場合に対応）
    if (!displayedKey || displayedKey.trim() === '') {
        if (storedKey && storedKey.trim() !== '') {
            await context.secrets.delete('altGenGemini.geminiApiKey');
        }
        return;
    }

    // 設定画面にマスクされていない生のAPIキーがある場合
    const isAlreadyMasked = displayedKey.includes('*') || /^\.+/.test(displayedKey);
    console.log('[ALT Generator] isAlreadyMasked:', isAlreadyMasked);

    if (!isAlreadyMasked) {
        console.log('[ALT Generator] Masking API key...');
        // Secretsに保存
        await context.secrets.store('altGenGemini.geminiApiKey', displayedKey);

        // マスク表示に変換
        const maskedKey = displayedKey.length > 4
            ? '.'.repeat(displayedKey.length - 4) + displayedKey.substring(displayedKey.length - 4)
            : '.'.repeat(displayedKey.length);

        console.log('[ALT Generator] Masked key:', maskedKey);

        // GlobalとWorkspace両方を更新
        await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Global);
        await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Workspace);

        console.log('[ALT Generator] API key masked successfully');
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
                        // エディタが有効かチェック
                        if (editor && !editor.document.isClosed) {
                            await editor.edit(editBuilder => {
                                editBuilder.replace(result.actualSelection, result.newText);
                            });
                        } else {
                            vscode.window.showWarningMessage('Editor was closed during ALT generation. Please try again.');
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
                    // エディタが有効かチェック
                    if (editor && !editor.document.isClosed) {
                        await editor.edit(editBuilder => {
                            editBuilder.replace(selection, result.newText);
                        });
                    } else {
                        vscode.window.showWarningMessage('Editor was closed during ALT generation. Please try again.');
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

// 画像ファイル名を抽出
function extractImageFileName(tagText: string): string {
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

// 動画ファイル名を抽出
function extractVideoFileName(tagText: string): string {
    const match = tagText.match(/src=["']([^"']+)["']/);
    if (match) {
        return path.basename(match[1]);
    }
    return 'unknown';
}

// フレームワークの静的ファイルディレクトリを検出
function detectStaticFileDirectory(workspacePath: string): string | null {
    try {
        const packageJsonPath = path.join(workspacePath, 'package.json');

        if (!fs.existsSync(packageJsonPath)) {
            return null;
        }

        const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

        // Next.js - publicディレクトリ
        if (dependencies['next']) {
            return 'public';
        }

        // Astro - publicディレクトリ
        if (dependencies['astro']) {
            return 'public';
        }

        // Remix - publicディレクトリ
        if (dependencies['@remix-run/react'] || dependencies['remix']) {
            return 'public';
        }

        // Vite (一般的にはpublicディレクトリ)
        if (dependencies['vite']) {
            return 'public';
        }

        // Create React App - publicディレクトリ
        if (dependencies['react-scripts']) {
            return 'public';
        }

        return null;
    } catch (error) {
        console.error('Failed to detect framework:', error);
        return null;
    }
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
                            // エディタが有効かチェック
                            if (editor && !editor.document.isClosed) {
                                await editor.edit(editBuilder => {
                                    editBuilder.replace(result.actualSelection, result.newText);
                                });
                            } else {
                                vscode.window.showWarningMessage('Editor was closed during ALT generation. Please try again.');
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
        // エディタが有効かチェック
        if (editor && !editor.document.isClosed) {
            await editor.edit(editBuilder => {
                editBuilder.replace(selection, newText);
            });
            vscode.window.showInformationMessage(formatMessage('aria-label generated: {0}', ariaLabel));
        } else {
            vscode.window.showWarningMessage('Editor was closed during aria-label generation. Please try again.');
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
                // エディタが有効かチェック
                if (editor && !editor.document.isClosed) {
                    await editor.edit(editBuilder => {
                        editBuilder.replace(actualSelection, newText);
                    });
                    vscode.window.showInformationMessage(formatMessage('aria-label generated: {0}', ariaLabel));
                } else {
                    vscode.window.showWarningMessage('Editor was closed during aria-label generation. Please try again.');
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
            // エディタが有効かチェック
            if (editor && !editor.document.isClosed) {
                await editor.edit(editBuilder => {
                    editBuilder.replace(actualSelection, newText);
                });
                vscode.window.showInformationMessage('Detected as decorative image: alt="" was set');
            } else {
                vscode.window.showWarningMessage('Editor was closed during ALT generation. Please try again.');
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

    // 周辺テキストを取得（A11Yモードかつ設定が有効な場合）
    let surroundingText: string | undefined;
    if (generationMode === 'A11Y') {
        const contextEnabled = config.get<boolean>('a11yContextEnabled', true);
        const contextRange = config.get<number>('a11yContextRange', 1500);

        if (contextEnabled) {
            surroundingText = extractSurroundingText(document, actualSelection, contextRange);
        }
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
                // エディタが有効かチェック
                if (editor && !editor.document.isClosed) {
                    await editor.edit(editBuilder => {
                        editBuilder.replace(actualSelection, newText);
                    });
                    vscode.window.showInformationMessage('Image is already described by surrounding text: alt="" was set');
                } else {
                    vscode.window.showWarningMessage('Editor was closed during ALT generation. Please try again.');
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
            // エディタが有効かチェック
            if (editor && !editor.document.isClosed) {
                await editor.edit(editBuilder => {
                    editBuilder.replace(actualSelection, newText);
                });
                vscode.window.showInformationMessage(formatMessage('ALT attribute generated: {0}', altText));
            } else {
                vscode.window.showWarningMessage('Editor was closed during ALT generation. Please try again.');
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

async function generateAltText(apiKey: string, base64Image: string, mimeType: string, mode: string, model: string, token?: vscode.CancellationToken, surroundingText?: string): Promise<string> {
    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // 出力言語を取得
    const outputLang = getOutputLanguage();

    // 設定からプロンプトを取得
    const config = vscode.workspace.getConfiguration('altGenGemini');
    let prompt: string;
    const languageConstraint = outputLang === 'ja' ? '\n5. Respond only in Japanese.' : '';

    if (mode === 'A11Y') {
        // A11Yモード - 設定からプロンプトを取得
        const customPrompt = config.get<string>('promptA11y', '');
        if (customPrompt && customPrompt.trim() !== '') {
            prompt = customPrompt + languageConstraint;
        } else {
            // デフォルトプロンプト
            // 文字数設定を取得
            const descriptionLength = config.get<string>('a11yDescriptionLength', 'standard');

            let charLengthConstraint: string;
            if (outputLang === 'ja') {
                if (descriptionLength === 'detailed') {
                    charLengthConstraint = '100 and 200 Japanese characters (full-width characters)';
                } else {
                    // standard
                    charLengthConstraint = '50 and 120 Japanese characters (full-width characters)';
                }
            } else {
                if (descriptionLength === 'detailed') {
                    charLengthConstraint = '100 and 200 characters';
                } else {
                    // standard
                    charLengthConstraint = '60 and 130 characters';
                }
            }

            // 周辺テキストがある場合は、重複判定のための指示を追加
            let contextInstruction = '';
            if (surroundingText) {
                contextInstruction = `

[SURROUNDING TEXT CONTEXT]
The following text appears near the image in the page:

${surroundingText}

[IMPORTANT - AVOID REDUNDANCY]
- If the surrounding text already fully describes the image content, return "DECORATIVE" (without quotes) to indicate that alt="" should be used (avoiding double reading by screen readers).
- If the surrounding text partially describes the image, provide only a brief supplementary description (maximum 50 characters) that adds essential information not mentioned in the text.
- If the surrounding text does not describe the image at all, provide a complete description following the standard constraints below.
`;
            }

            prompt = `You are a web accessibility expert. Analyze the provided image's content and the role it plays within the page's context in detail. Your task is to generate ALT text that is completely understandable for users with visual impairments.${contextInstruction}

[CONSTRAINTS]
1. Completely describe the image content and do not omit any details.
2. Where necessary, include the image's background, colors, actions, and emotions.
3. The description must be a single, cohesive sentence between ${charLengthConstraint}.
4. Do not include the words "image" or "photo".${languageConstraint}

Return only the generated ALT text. No other conversation or explanation is required.`;
        }
    } else {
        // SEOモード - 設定からプロンプトを取得
        const customPrompt = config.get<string>('promptSeo', '');
        if (customPrompt && customPrompt.trim() !== '') {
            prompt = customPrompt + languageConstraint;
        } else {
            // デフォルトプロンプト
            prompt = `You are an SEO expert. Analyze the provided image and generate the most effective single-sentence ALT text for SEO purposes.

[CONSTRAINTS]
1. Include 3-5 key search terms naturally.
2. The description must be a single, concise sentence.
3. Avoid unnecessary phrases like "image of" or "photo of" at the end.
4. Do not include any information unrelated to the image.${languageConstraint}

Return only the generated ALT text, without any further conversation or explanation.`;
        }
    }

    const requestBody = {
        contents: [{
            parts: [
                {
                    text: prompt
                },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: base64Image
                    }
                }
            ]
        }]
    };

    console.log('[ALT Generator] ========== Gemini API Request (Image ALT) ==========');
    console.log('[ALT Generator] Mode:', mode);
    console.log('[ALT Generator] Model:', model);
    console.log('[ALT Generator] MIME Type:', mimeType);
    console.log('[ALT Generator] Prompt:');
    console.log(prompt);
    console.log('[ALT Generator] =====================================================');

    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify(requestBody)
    });

    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    if (!response.ok) {
        const errorBody = await response.text();

        // 429エラー（レート制限）の場合、詳細メッセージを表示
        if (response.status === 429) {
            throw new Error('Rate limit exceeded (429 Too Many Requests).\n\nPossible causes:\n1. Too many requests per minute (RPM limit)\n2. Too many tokens per minute (TPM limit)\n\nSolutions:\n• Wait 1 minute and try again\n• Use Economy or Balanced image resize mode to reduce tokens\n• Process fewer images at once\n• Use decorative keywords to skip unnecessary images');
        }

        // その他のエラー
        throw new Error(formatMessage('API Error {0}: {1}\n\nDetails: {2}', response.status.toString(), response.statusText, errorBody));
    }

    const data: any = await response.json();

    // promptFeedbackのブロック理由をチェック
    if (data.promptFeedback && data.promptFeedback.blockReason) {
        console.error('API blocked the request:', JSON.stringify(data, null, 2));
        const blockReason = data.promptFeedback.blockReason;
        let errorMessage = 'Gemini API blocked the request.\n\n';

        switch (blockReason) {
            case 'SAFETY':
                errorMessage += 'Reason: Safety filter triggered.\nThe image may contain content that violates safety policies.';
                break;
            case 'OTHER':
                errorMessage += 'Reason: Content was blocked for unspecified reasons.\nThis may happen with certain types of images or content.';
                break;
            case 'BLOCKLIST':
                errorMessage += 'Reason: Content matches a blocklist.';
                break;
            default:
                errorMessage += `Reason: ${blockReason}`;
        }

        throw new Error(errorMessage);
    }

    // レスポンス構造の検証
    if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new Error('API returned an unexpected response format. Please check console for details.');
    }

    if (!data.candidates[0].content || !data.candidates[0].content.parts || !Array.isArray(data.candidates[0].content.parts) || data.candidates[0].content.parts.length === 0) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new Error('API response is missing expected content. Please check console for details.');
    }

    const altText = data.candidates[0].content.parts[0].text.trim();

    console.log('[ALT Generator] ========== Gemini API Response (Image ALT) ==========');
    console.log('[ALT Generator] Generated ALT:', altText);
    console.log('[ALT Generator] =====================================================');

    return altText;
}

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.bmp': 'image/bmp'
    };
    return mimeTypes[ext] || 'image/jpeg';
}

async function generateVideoAriaLabel(apiKey: string, base64Video: string, mimeType: string, model: string, token?: vscode.CancellationToken): Promise<string> {
    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // 出力言語を取得
    const outputLang = getOutputLanguage();
    const languageConstraint = outputLang === 'ja' ? '\n5. Respond only in Japanese.' : '';

    // 設定からプロンプトを取得
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const customPrompt = config.get<string>('promptVideo', '');

    let prompt: string;
    if (customPrompt && customPrompt.trim() !== '') {
        // カスタムプロンプトに言語指定を追加
        prompt = customPrompt + languageConstraint;
    } else {
        // デフォルトプロンプト
        prompt = `You are a Web Accessibility and UX expert. Analyze the provided video content in detail and identify the role it plays within the page's context. Your task is to generate the optimal ARIA-LABEL text that briefly explains the video's purpose or function.

[CONSTRAINTS]
1. The generated ARIA-LABEL text must be a very short phrase, **no more than 10 words**.
2. Focus on the video's **purpose or function**, not its **content or visual description**. (e.g., product demo, operation tutorial, background animation, etc.)
3. Prioritize conciseness and use common language that will be easily understood by the user.
4. Do not include the words "video," "movie," or "clip".${languageConstraint}

Return only the generated ARIA-LABEL text. No other conversation or explanation is required.`;
    }

    const requestBody = {
        contents: [{
            parts: [
                {
                    text: prompt
                },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: base64Video
                    }
                }
            ]
        }]
    };

    console.log('[ALT Generator] ========== Gemini API Request (Video aria-label) ==========');
    console.log('[ALT Generator] Model:', model);
    console.log('[ALT Generator] MIME Type:', mimeType);
    console.log('[ALT Generator] Prompt:');
    console.log(prompt);
    console.log('[ALT Generator] =====================================================');

    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey
        },
        body: JSON.stringify(requestBody)
    });

    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    if (!response.ok) {
        const errorBody = await response.text();

        // 429エラー（レート制限）の場合、詳細メッセージを表示
        if (response.status === 429) {
            throw new Error('Rate limit exceeded (429 Too Many Requests).\n\nPossible causes:\n1. Too many requests per minute (RPM limit)\n2. Too many tokens per minute (TPM limit)\n\nSolutions:\n• Wait 1 minute and try again\n• Use Economy or Balanced image resize mode to reduce tokens\n• Process fewer images at once\n• Use decorative keywords to skip unnecessary images');
        }

        // その他のエラー
        throw new Error(formatMessage('API Error {0}: {1}\n\nDetails: {2}', response.status.toString(), response.statusText, errorBody));
    }

    const data: any = await response.json();

    // promptFeedbackのブロック理由をチェック
    if (data.promptFeedback && data.promptFeedback.blockReason) {
        console.error('API blocked the request:', JSON.stringify(data, null, 2));
        const blockReason = data.promptFeedback.blockReason;
        let errorMessage = 'Gemini API blocked the request.\n\n';

        switch (blockReason) {
            case 'SAFETY':
                errorMessage += 'Reason: Safety filter triggered.\nThe video may contain content that violates safety policies.';
                break;
            case 'OTHER':
                errorMessage += 'Reason: Content was blocked for unspecified reasons.\nThis may happen with certain types of videos or content.';
                break;
            case 'BLOCKLIST':
                errorMessage += 'Reason: Content matches a blocklist.';
                break;
            default:
                errorMessage += `Reason: ${blockReason}`;
        }

        throw new Error(errorMessage);
    }

    // レスポンス構造の検証
    if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new Error('API returned an unexpected response format. Please check console for details.');
    }

    if (!data.candidates[0].content || !data.candidates[0].content.parts || !Array.isArray(data.candidates[0].content.parts) || data.candidates[0].content.parts.length === 0) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new Error('API response is missing expected content. Please check console for details.');
    }

    const ariaLabel = data.candidates[0].content.parts[0].text.trim();

    console.log('[ALT Generator] ========== Gemini API Response (Video aria-label) ==========');
    console.log('[ALT Generator] Generated aria-label:', ariaLabel);
    console.log('[ALT Generator] =====================================================');

    return ariaLabel;
}

function getVideoMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: { [key: string]: string } = {
        '.mp4': 'video/mp4',
        '.webm': 'video/webm',
        '.ogg': 'video/ogg',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo'
    };
    return mimeTypes[ext] || 'video/mp4';
}

// RPM制限に基づくレート制限関数
async function waitForRateLimit(): Promise<void> {
    const requestsPerMinute = 10; // 固定値: 10 RPM（無料枠推奨）
    const minInterval = (60 * 1000) / requestsPerMinute; // ミリ秒単位の最小間隔
    const now = Date.now();
    const timeSinceLastRequest = now - lastRequestTime;

    if (timeSinceLastRequest < minInterval) {
        const waitTime = minInterval - timeSinceLastRequest;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    lastRequestTime = Date.now();
}

export function deactivate() {}
