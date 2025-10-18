import * as vscode from 'vscode';

// Utils
import { safeEditDocument } from './utils/security';
import { formatMessage } from './utils/textUtils';
import { detectTagType, detectAllTags, extractImageFileName, extractVideoFileName } from './utils/tagUtils';
import { getContextRangeValue, getInsertionMode } from './utils/config';
import { getUserFriendlyErrorMessage } from './utils/errorHandler';
import { CancellationError } from './utils/errors';
import { createContextCache } from './utils/contextGrouping';

// Services
import { processSingleImageTag } from './services/imageProcessor';
import { processSingleVideoTag } from './services/videoProcessor';

// Constants
import { UI_MESSAGES, SELECTION_THRESHOLDS, MASKING, BATCH_PROCESSING } from './constants';

export async function activate(context: vscode.ExtensionContext) {
    // Mask API key on startup
    await maskApiKeyInSettings(context);

    // Watch for configuration changes to save and mask API key
    const configWatcher = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('altGenGemini.geminiApiKey')) {
            await handleApiKeyChange(context);
        }
    });
    context.subscriptions.push(configWatcher);

    // Smart ALT/aria-label generation command (auto-detect tag type)
    let disposable = vscode.commands.registerCommand('alt-generator.generateAlt', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('❌ No active editor');
            return;
        }

        const selections = editor.selections;
        const firstSelection = selections[0];

        // Check if selection is empty (cursor only)
        const isEmptySelection = firstSelection.isEmpty || editor.document.getText(firstSelection).trim().length < SELECTION_THRESHOLDS.MIN_SELECTION_LENGTH;

        if (isEmptySelection) {
            // Detect tag at cursor position (traditional behavior)
            const tagType = detectTagType(editor, firstSelection);

            if (tagType === 'video') {
                await vscode.commands.executeCommand('alt-generator.generateVideoAriaLabel');
                return;
            } else if (tagType === 'img') {
                await generateAltForImages(context, editor, selections);
                return;
            } else {
                vscode.window.showErrorMessage('❌ No img or video tag found');
                return;
            }
        } else {
            // Detect all tags within selection
            const allTags = detectAllTags(editor, firstSelection);

            if (allTags.length === 0) {
                vscode.window.showErrorMessage('❌ No img or video tag found');
                return;
            }

            // Separate img tags and video tags
            const imgTags = allTags.filter(tag => tag.type === 'img');
            const videoTags = allTags.filter(tag => tag.type === 'video');

            // Process tags
            await processMultipleTags(context, editor, imgTags, videoTags);
        }
    });

    context.subscriptions.push(disposable);

    // Video tag aria-label generation command
    let videoDisposable = vscode.commands.registerCommand('alt-generator.generateVideoAriaLabel', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('❌ No active editor');
            return;
        }

        const selection = editor.selection;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating...',
            cancellable: true
        }, async (_progress, token) => {
            try {
                await processSingleVideoTag(context, editor, selection, token, 'auto');
            } catch (error) {
                // Cancellation errors are already handled
                if (error instanceof CancellationError || token.isCancellationRequested) {
                    return;
                }
                const errorMessage = getUserFriendlyErrorMessage(error);
                vscode.window.showErrorMessage(errorMessage);
            }
        });
    });

    context.subscriptions.push(videoDisposable);

    // Command to completely delete API key (for debugging)
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

// Handle API key changes in configuration
async function handleApiKeyChange(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const displayedKey = config.get<string>('geminiApiKey', '');

    // Debug: API key change event
    // console.log('[ALT Generator] handleApiKeyChange called');
    // console.log('[ALT Generator] displayedKey:', displayedKey ? `${displayedKey.substring(0, 4)}...` : 'empty');

    // Delete API key if empty
    if (!displayedKey || displayedKey.trim() === '') {
        // console.log('[ALT Generator] Deleting API key from secrets...');
        await context.secrets.delete('altGenGemini.geminiApiKey');
        await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Global);
        await config.update('geminiApiKey', undefined, vscode.ConfigurationTarget.Workspace);
        // console.log('[ALT Generator] API key deleted successfully');
        vscode.window.showInformationMessage('✅ API Key deleted from settings');
        return;
    }

    // Skip if already masked (contains * or .)
    if (displayedKey.includes('*') || /^\.+/.test(displayedKey)) {
        // console.log('[ALT Generator] API key is already masked, skipping...');
        return;
    }

    // console.log('[ALT Generator] Storing new API key...');
    // Save as new API key
    await context.secrets.store('altGenGemini.geminiApiKey', displayedKey);

    // Display with mask (fixed-length mask for better security)
    const maskedKey = displayedKey.length > MASKING.MIN_LENGTH_FOR_VISIBLE
        ? MASKING.MASK_CHAR + displayedKey.substring(displayedKey.length - MASKING.VISIBLE_CHARS)
        : MASKING.MASK_CHAR;

    await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Global);
    await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Workspace);
    // console.log('[ALT Generator] New API key stored and masked');
}

// Mask API key on startup
async function maskApiKeyInSettings(context: vscode.ExtensionContext): Promise<void> {
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const displayedKey = config.get<string>('geminiApiKey', '');
    const storedKey = await context.secrets.get('altGenGemini.geminiApiKey');

    // Debug: API key masking on startup
    // console.log('[ALT Generator] maskApiKeyInSettings called');
    // console.log('[ALT Generator] displayedKey length:', displayedKey.length);
    // console.log('[ALT Generator] storedKey exists:', !!storedKey);

    // Delete from Secrets if settings screen is empty (handles direct settings.json edit)
    if (!displayedKey || displayedKey.trim() === '') {
        if (storedKey && storedKey.trim() !== '') {
            await context.secrets.delete('altGenGemini.geminiApiKey');
        }
        return;
    }

    // Check if unmasked raw API key exists in settings
    const isAlreadyMasked = displayedKey.includes('*') || /^\.+/.test(displayedKey);
    // console.log('[ALT Generator] isAlreadyMasked:', isAlreadyMasked);

    if (!isAlreadyMasked) {
        // console.log('[ALT Generator] Masking API key...');
        // Save to Secrets
        await context.secrets.store('altGenGemini.geminiApiKey', displayedKey);

        // Convert to masked display (fixed-length mask for better security)
        const maskedKey = displayedKey.length > MASKING.MIN_LENGTH_FOR_VISIBLE
            ? MASKING.MASK_CHAR + displayedKey.substring(displayedKey.length - MASKING.VISIBLE_CHARS)
            : MASKING.MASK_CHAR;

        // console.log('[ALT Generator] Masked key:', maskedKey);

        // Update both Global and Workspace
        await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Global);
        await config.update('geminiApiKey', maskedKey, vscode.ConfigurationTarget.Workspace);

        // console.log('[ALT Generator] API key masked successfully');
    }
}

// Process multiple tags (mixed img and video tags)
async function processMultipleTags(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    imgTags: Array<{type: 'img' | 'video', range: vscode.Range, text: string}>,
    videoTags: Array<{type: 'img' | 'video', range: vscode.Range, text: string}>
): Promise<void> {
    // Pre-fetch configuration for batch processing optimization
    const insertionMode = getInsertionMode();
    const config = vscode.workspace.getConfiguration('altGenGemini');
    const contextEnabled = config.get<boolean>('contextEnabled', true);
    const contextRange = getContextRangeValue();

    const totalCount = imgTags.length + videoTags.length;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: formatMessage('Processing {0} items...', totalCount),
        cancellable: true
    }, async (progress, token) => {
        let processedCount = 0;
        let successCount = 0;
        let failureCount = 0;

        // Combine all tags for chunk processing
        const allTags = [...imgTags, ...videoTags];

        // Process in chunks for memory efficiency
        for (let i = 0; i < allTags.length; i += BATCH_PROCESSING.CHUNK_SIZE) {
            const chunk = allTags.slice(i, i + BATCH_PROCESSING.CHUNK_SIZE);

            // Create context cache for this chunk only
            const contextCache = await createContextCache(editor.document, chunk, contextRange, contextEnabled);

            // Process each tag in the chunk
            for (const tag of chunk) {
                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage(formatMessage('⏸️ Cancelled ({0}/{1} processed)', processedCount, totalCount));
                    return;
                }

                const isImageTag = tag.type === 'img';
                const fileName = isImageTag ? extractImageFileName(tag.text) : extractVideoFileName(tag.text);

                // Progress message
                progress.report({
                    message: formatMessage('{0} {1}/{2} - {3}',
                        isImageTag ? UI_MESSAGES.IMAGE_PREFIX : UI_MESSAGES.VIDEO_PREFIX,
                        processedCount + 1,
                        totalCount,
                        fileName),
                    increment: (100 / totalCount)
                });

                const selection = new vscode.Selection(tag.range.start, tag.range.end);

                try {
                    // Get cached surrounding text for optimization
                    const cachedContext = contextCache?.getSurroundingText(tag.range);

                    // Process based on tag type
                    if (isImageTag) {
                        const result = await processSingleImageTag(context, editor, selection, token, undefined, processedCount, totalCount, insertionMode, cachedContext);

                        // Count success/failure
                        if (result && result.success !== false) {
                            successCount++;
                        } else if (!result) {
                            failureCount++;
                        }

                        if (result && insertionMode === 'confirm') {
                            // Show individual confirmation dialog
                            const choice = await vscode.window.showInformationMessage(
                                `✅ ALT: ${result.altText}\n\nInsert this ALT?`,
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
                                vscode.window.showWarningMessage(formatMessage('⏸️ Cancelled ({0}/{1} processed)', processedCount + 1, totalCount));
                                return;
                            }
                        }
                    } else {
                        // Video tag processing
                        const result = await processSingleVideoTag(context, editor, selection, token, insertionMode, cachedContext);

                        // Count success/failure
                        if (result && result.success !== false) {
                            successCount++;
                        } else if (!result) {
                            failureCount++;
                        }

                        if (result && insertionMode === 'confirm') {
                            // For DECORATIVE case (no aria-label added), skip confirmation dialog
                            if (!result.ariaLabel.includes('not added')) {
                                // Show individual confirmation dialog
                                const choice = await vscode.window.showInformationMessage(
                                    `✅ aria-label: ${result.ariaLabel}\n\nInsert this aria-label?`,
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
                                    vscode.window.showWarningMessage(formatMessage('⏸️ Cancelled ({0}/{1} processed)', processedCount + 1, totalCount));
                                    return;
                                }
                            }
                        }
                    }
                } catch (error) {
                    // Increment failure count on error
                    failureCount++;
                    // Error already displayed in processor functions, ignore here
                }

                processedCount++;
            }

            // Clear cache after processing chunk to free memory
            contextCache?.clear();
        }

        // Display completion message
        const imgCount = imgTags.length;
        const videoCount = videoTags.length;

        if (failureCount === 0) {
            // All successful
            const itemsText = imgCount > 0 && videoCount > 0
                ? formatMessage('{0} images, {1} video', imgCount, videoCount)
                : imgCount > 0
                    ? formatMessage('{0} image' + (imgCount > 1 ? 's' : ''), imgCount)
                    : formatMessage('{0} video' + (videoCount > 1 ? 's' : ''), videoCount);
            vscode.window.showInformationMessage(formatMessage('✅ {0} items processed ({1})', totalCount, itemsText));
        } else {
            // Had errors
            vscode.window.showWarningMessage(formatMessage('⚠️ Completed with errors: {0} succeeded, {1} failed', successCount, failureCount));
        }
    });
}

// ALT text generation for img tags
async function generateAltForImages(
    context: vscode.ExtensionContext,
    editor: vscode.TextEditor,
    selections: readonly vscode.Selection[]
): Promise<void> {
        // Pre-fetch configuration for optimization
        const insertionMode = getInsertionMode();

        // Always display progress dialog
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating...',
            cancellable: true
        }, async (progress, token) => {
            let processedCount = 0;
            let successCount = 0;
            let failureCount = 0;
            const totalCount = selections.length;

            for (const selection of selections) {
                // Check for cancellation
                if (token?.isCancellationRequested) {
                    vscode.window.showWarningMessage(formatMessage('⏸️ Cancelled ({0}/{1} processed)', processedCount, totalCount));
                    return;
                }

                try {
                    const result = await processSingleImageTag(context, editor, selection, token, progress, processedCount, totalCount, insertionMode);

                    // Count success/failure
                    if (result && result.success !== false) {
                        successCount++;
                    } else if (!result) {
                        // Void returned (error or cancellation)
                        failureCount++;
                    }

                    if (result) {
                        if (insertionMode === 'confirm') {
                            // Show confirmation dialog for each image immediately
                            const choice = await vscode.window.showInformationMessage(
                                `✅ ALT: ${result.altText}\n\nInsert this ALT?`,
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
                                vscode.window.showWarningMessage(formatMessage('⏸️ Cancelled ({0}/{1} processed)', processedCount + 1, totalCount));
                                return;
                            }
                            // If 'Skip', continue to next image
                        }
                    }
                } catch (error) {
                    // Increment failure count on error
                    failureCount++;
                    // Error already displayed in processSingleImageTag, ignore here
                }

                processedCount++;
            }

            // Display completion message
            if (totalCount > 1) {
                if (failureCount === 0) {
                    // All successful
                    vscode.window.showInformationMessage(formatMessage('✅ {0} images processed', totalCount));
                } else {
                    // Had errors
                    vscode.window.showWarningMessage(formatMessage('⚠️ Completed with errors: {0} succeeded, {1} failed', successCount, failureCount));
                }
            }
        });
}

export function deactivate() {}
