import * as vscode from 'vscode';

// Utils
import { safeEditDocument } from './utils/security';
import { formatMessage } from './utils/textUtils';
import { detectTagType, detectAllTags } from './utils/tagUtils';
import { getInsertionMode, clearOutputLanguageCache } from './utils/config';
import { getUserFriendlyErrorMessage } from './utils/errorHandler';
import { CancellationError } from './utils/errors';
import { createContextCache } from './utils/contextGrouping';

// Services
import { processSingleImageTag } from './services/imageProcessor';
import { processSingleVideoTag } from './services/videoProcessor';

// Core
import { needsSurroundingText } from './core/prompts';

// Constants
import { SELECTION_THRESHOLDS, MASKING, BATCH_PROCESSING, CONTEXT_RANGE_VALUES } from './constants';

export async function activate(context: vscode.ExtensionContext) {
    // Mask API key on startup
    await maskApiKeyInSettings(context);

    // Watch for configuration changes to save and mask API key
    const configWatcher = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('altGenGemini.geminiApiKey')) {
            await handleApiKeyChange(context);
        }
        // Clear output language cache when output language setting changes
        if (e.affectsConfiguration('altGenGemini.outputLanguage')) {
            clearOutputLanguageCache();
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

        // Get insertion mode from settings
        const config = vscode.workspace.getConfiguration('altGenGemini');
        const insertionMode = config.get<'auto' | 'confirm'>('insertionMode', 'confirm');

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating...',
            cancellable: true
        }, async (progress, token) => {
            try {
                const result = await processSingleVideoTag(context, editor, selection, token, insertionMode, undefined, progress);

                // Show result dialog for confirm mode
                if (result && insertionMode === 'confirm') {
                    // For DECORATIVE case (no aria-label added), just show info message
                    if (result.ariaLabel.includes('not added')) {
                        vscode.window.showInformationMessage('📝 aria-label: Already described by surrounding text (not added)');
                    } else {
                        // Get video description length mode to customize message
                        const config = vscode.workspace.getConfiguration('altGenGemini');
                        const videoDescriptionLength = config.get<string>('videoDescriptionLength', 'standard');

                        // Show confirmation dialog with appropriate message
                        const message = videoDescriptionLength === 'detailed'
                            ? `✅ Video description (as comment): ${result.ariaLabel}`
                            : `✅ aria-label: ${result.ariaLabel}`;

                        // Single item: show only Insert and Cancel (no Skip)
                        const choice = await vscode.window.showInformationMessage(
                            message,
                            'Insert',
                            'Cancel'
                        );

                        if (choice === 'Insert') {
                            // Use actualSelection from result to insert at correct position
                            await safeEditDocument(editor, result.actualSelection, result.newText);
                        }
                    }
                }
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

    // Skip if already masked (contains *, ., or •)
    if (displayedKey.includes('*') || displayedKey.includes('•') || /^\.+/.test(displayedKey)) {
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
    const isAlreadyMasked = displayedKey.includes('*') || displayedKey.includes('•') || /^\.+/.test(displayedKey);
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

/**
 * Show confirmation dialog for generated content
 * Returns user's choice: 'Insert', 'Skip', or 'Cancel'
 */
async function showConfirmationDialog(
    message: string,
    totalCount: number,
    processedCount: number
): Promise<string | undefined> {
    // Single item: show only Insert and Cancel (no Skip)
    if (totalCount === 1) {
        return await vscode.window.showInformationMessage(
            message,
            'Insert',
            'Cancel'
        );
    } else {
        return await vscode.window.showInformationMessage(
            message,
            'Insert',
            'Skip',
            'Cancel'
        );
    }
}

/**
 * Handle user's choice from confirmation dialog
 * Returns true if processing should continue, false if cancelled
 */
async function handleUserChoice(
    choice: string | undefined,
    editor: vscode.TextEditor,
    actualSelection: vscode.Selection,
    newText: string,
    processedCount: number,
    totalCount: number
): Promise<boolean> {
    if (choice === 'Insert') {
        const success = await safeEditDocument(editor, actualSelection, newText);
        if (!success) {
            return false;
        }
    } else if (choice === 'Cancel') {
        vscode.window.showWarningMessage(formatMessage('⏸️ Cancelled ({0}/{1} processed)', processedCount + 1, totalCount));
        return false;
    }
    // Skip: continue processing
    return true;
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
    const generationMode = config.get<string>('generationMode', 'SEO');
    const videoDescriptionLength = config.get<string>('videoDescriptionLength', 'standard') as 'standard' | 'detailed';

    // Check if any custom prompts need surrounding text
    const promptType = generationMode === 'SEO' ? 'seo' : 'a11y';
    const needsContext = needsSurroundingText(promptType) || needsSurroundingText('video', videoDescriptionLength);
    const contextRange = needsContext ? CONTEXT_RANGE_VALUES.default : 0;

    const totalCount = imgTags.length + videoTags.length;

    await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: totalCount === 1 ? 'Generating...' : formatMessage('Processing {0} items...', totalCount),
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

            // Create context cache for this chunk only if needed
            const contextCache = await createContextCache(editor.document, chunk, contextRange, needsContext);

            // Process each tag in the chunk
            for (const tag of chunk) {
                if (token.isCancellationRequested) {
                    vscode.window.showWarningMessage(formatMessage('⏸️ Cancelled ({0}/{1} processed)', processedCount, totalCount));
                    return;
                }

                const isImageTag = tag.type === 'img';

                const selection = new vscode.Selection(tag.range.start, tag.range.end);

                try {
                    // Get cached surrounding text for optimization
                    const cachedContext = contextCache?.getSurroundingText(tag.range);

                    // Process based on tag type
                    if (isImageTag) {
                        const result = await processSingleImageTag(context, editor, selection, token, progress, processedCount, totalCount, insertionMode, cachedContext);

                        // Count success/failure
                        if (result && result.success !== false) {
                            successCount++;
                        } else if (!result) {
                            failureCount++;
                        }

                        if (result && insertionMode === 'confirm') {
                            const choice = await showConfirmationDialog(
                                `✅ ALT: ${result.altText}`,
                                totalCount,
                                processedCount
                            );

                            const shouldContinue = await handleUserChoice(
                                choice,
                                editor,
                                result.actualSelection,
                                result.newText,
                                processedCount,
                                totalCount
                            );

                            if (!shouldContinue) {
                                return;
                            }
                        }
                    } else {
                        // Video tag processing
                        const result = await processSingleVideoTag(context, editor, selection, token, insertionMode, cachedContext, progress);

                        // Count success/failure
                        if (result && result.success !== false) {
                            successCount++;
                        } else if (!result) {
                            failureCount++;
                        }

                        if (result && insertionMode === 'confirm') {
                            // For DECORATIVE case (no aria-label added), skip confirmation dialog
                            if (!result.ariaLabel.includes('not added')) {
                                // Get video description length mode to customize message
                                const videoDescriptionLength = config.get<string>('videoDescriptionLength', 'standard');

                                // Show individual confirmation dialog with appropriate message
                                const message = videoDescriptionLength === 'detailed'
                                    ? `✅ Video description (as comment): ${result.ariaLabel}`
                                    : `✅ aria-label: ${result.ariaLabel}`;

                                const choice = await showConfirmationDialog(
                                    message,
                                    totalCount,
                                    processedCount
                                );

                                const shouldContinue = await handleUserChoice(
                                    choice,
                                    editor,
                                    result.actualSelection,
                                    result.newText,
                                    processedCount,
                                    totalCount
                                );

                                if (!shouldContinue) {
                                    return;
                                }
                            }
                        }
                    }
                } catch (error) {
                    // Increment failure count on error
                    failureCount++;

                    // Display error message
                    if (!(error instanceof CancellationError) && !token?.isCancellationRequested) {
                        const errorMessage = getUserFriendlyErrorMessage(error);
                        vscode.window.showErrorMessage(errorMessage);
                    }
                }

                processedCount++;
            }

            // Clear cache after processing chunk to free memory
            contextCache?.clear();
        }

        // Display completion message (only for multiple items)
        if (totalCount > 1) {
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

        // Always display progress dialog with indeterminate animation
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating...',
            cancellable: true
        }, async (progress, token) => {
            let processedCount = 0;
            let successCount = 0;
            let failureCount = 0;
            const totalCount = selections.length;

            // Cache for surrounding text to avoid redundant extraction
            let lastSurroundingText: string | undefined;
            let lastSelectionLine: number | undefined;

            for (const selection of selections) {
                // Check for cancellation
                if (token?.isCancellationRequested) {
                    vscode.window.showWarningMessage(formatMessage('⏸️ Cancelled ({0}/{1} processed)', processedCount, totalCount));
                    return;
                }

                try {
                    // Determine if we can reuse cached surrounding text
                    // Only reuse if selections are close (within 10 lines)
                    const currentLine = selection.start.line;
                    const canReuseCachedText = lastSelectionLine !== undefined &&
                                              Math.abs(currentLine - lastSelectionLine) <= 10;

                    const cachedSurroundingText = canReuseCachedText ? lastSurroundingText : undefined;

                    // Report progress to show animation
                    const result = await processSingleImageTag(
                        context,
                        editor,
                        selection,
                        token,
                        progress,
                        processedCount,
                        totalCount,
                        insertionMode,
                        cachedSurroundingText
                    );

                    // Update cache for next iteration
                    if (result && 'surroundingText' in result) {
                        lastSurroundingText = (result as any).surroundingText;
                        lastSelectionLine = currentLine;
                    }

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
                            // Single item: show only Insert and Cancel (no Skip)
                            const choice = await vscode.window.showInformationMessage(
                                `✅ ALT: ${result.altText}`,
                                'Insert',
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

                    // Display error message
                    if (!(error instanceof CancellationError) && !token?.isCancellationRequested) {
                        const errorMessage = getUserFriendlyErrorMessage(error);
                        vscode.window.showErrorMessage(errorMessage);
                    }
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
