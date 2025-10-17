/**
 * Abstract base class for media processors
 * Provides a common interface for processing images and videos
 */

import * as vscode from 'vscode';

/**
 * Base result interface for all media processors
 */
export interface MediaProcessResult {
    newText: string;
    generatedText: string; // ALT text or aria-label
    success: boolean;
}

/**
 * Configuration for media processing
 */
export interface MediaProcessConfig {
    editor: vscode.TextEditor;
    selection: vscode.Selection;
    context: vscode.ExtensionContext;
    token?: vscode.CancellationToken;
    progress?: vscode.Progress<{message?: string; increment?: number}>;
    processedCount?: number;
    totalCount?: number;
    insertionMode?: string;
}

/**
 * Abstract base class for media processors
 */
export abstract class MediaProcessor {
    protected config: MediaProcessConfig;

    constructor(config: MediaProcessConfig) {
        this.config = config;
    }

    /**
     * Extract tag information from selection
     * @returns Tag information or null if extraction fails
     */
    protected abstract extractTagInfo(): Promise<any | null>;

    /**
     * Load media data from file or URL
     * @param src Media source path or URL
     * @returns Media data or null if loading fails
     */
    protected abstract loadMediaData(src: string): Promise<any | null>;

    /**
     * Generate text (ALT or aria-label) using AI
     * @param mediaData Loaded media data
     * @param surroundingText Optional surrounding text context
     * @returns Generated text
     */
    protected abstract generateText(mediaData: any, surroundingText?: string): Promise<string>;

    /**
     * Apply generated text to tag
     * @param selectedText Original tag text
     * @param generatedText Generated ALT text or aria-label
     * @returns Modified tag text
     */
    protected abstract applyTextToTag(selectedText: string, generatedText: string): string;

    /**
     * Get media file name for progress display
     * @param tagInfo Extracted tag information
     * @returns File name
     */
    protected abstract getMediaFileName(tagInfo: any): string;

    /**
     * Get media type prefix for progress messages
     * @returns Prefix string like '[IMG]' or '[VIDEO]'
     */
    protected abstract getMediaTypePrefix(): string;

    /**
     * Check if media should be treated as decorative
     * @param fileName Media file name
     * @returns True if decorative
     */
    protected isDecorativeMedia(fileName: string): boolean {
        return false; // Override in subclasses if needed
    }

    /**
     * Generate decorative text (e.g., empty alt="" for images)
     * @param tagInfo Tag information
     * @returns Object with newText and generatedText
     */
    protected generateDecorativeText(tagInfo: any): { newText: string; generatedText: string } | null {
        return null; // Override in subclasses if needed
    }

    /**
     * Update progress indicator
     * @param fileName Media file name
     */
    protected updateProgress(fileName: string): void {
        const { progress, processedCount, totalCount } = this.config;

        if (progress && typeof processedCount === 'number' && typeof totalCount === 'number') {
            const message = totalCount === 1
                ? fileName
                : `${this.getMediaTypePrefix()} ${processedCount + 1}/${totalCount} - ${fileName}`;
            progress.report({
                message,
                increment: (100 / totalCount)
            });
        }
    }

    /**
     * Get surrounding text context if enabled
     * @param actualSelection Selection range for context extraction
     * @returns Surrounding text or undefined
     */
    protected getSurroundingText(actualSelection: vscode.Selection): string | undefined {
        const config = vscode.workspace.getConfiguration('altGenGemini');
        const contextEnabled = config.get<boolean>('contextEnabled', true);

        if (!contextEnabled) {
            return undefined;
        }

        // Import here to avoid circular dependency
        const { extractSurroundingText } = require('../utils/textUtils');
        const { getContextRangeValue } = require('../utils/config');
        const contextRange = getContextRangeValue();

        return extractSurroundingText(
            this.config.editor.document,
            actualSelection,
            contextRange
        );
    }

    /**
     * Process media tag
     * Main template method that orchestrates the processing workflow
     */
    public async process(): Promise<MediaProcessResult | void> {
        const { token } = this.config;

        // Extract tag information
        const tagInfo = await this.extractTagInfo();
        if (!tagInfo) {
            return;
        }

        const fileName = this.getMediaFileName(tagInfo);

        // Update progress
        this.updateProgress(fileName);

        // Check if decorative
        if (this.isDecorativeMedia(fileName)) {
            const decorativeResult = this.generateDecorativeText(tagInfo);
            if (decorativeResult) {
                return this.handleResult(
                    tagInfo,
                    decorativeResult.newText,
                    decorativeResult.generatedText,
                    true
                );
            }
        }

        // Load media data
        const mediaData = await this.loadMediaData(tagInfo.src);
        if (!mediaData) {
            return;
        }

        // Check cancellation
        if (token?.isCancellationRequested) {
            return;
        }

        // Get surrounding text
        const surroundingText = this.getSurroundingText(tagInfo.actualSelection);

        // Generate text
        try {
            const generatedText = await this.generateText(mediaData, surroundingText);

            if (token?.isCancellationRequested) {
                return;
            }

            // Apply text to tag
            const newText = this.applyTextToTag(tagInfo.selectedText, generatedText);

            return this.handleResult(tagInfo, newText, generatedText, false);
        } catch (error) {
            throw error; // Re-throw to be handled by caller
        }
    }

    /**
     * Handle processing result
     * @param tagInfo Tag information
     * @param newText Modified tag text
     * @param generatedText Generated ALT/aria-label text
     * @param isDecorative Whether this is decorative media
     */
    protected async handleResult(
        tagInfo: any,
        newText: string,
        generatedText: string,
        isDecorative: boolean
    ): Promise<MediaProcessResult | void> {
        const insertionMode = this.config.insertionMode || 'auto';

        if (insertionMode === 'auto') {
            const { safeEditDocument } = require('../utils/security');
            const success = await safeEditDocument(
                this.config.editor,
                tagInfo.actualSelection,
                newText
            );

            if (success && !isDecorative) {
                // Show success message
                const prefix = this.getMediaTypePrefix() === '[IMG]' ? 'ALT' : 'aria-label';
                vscode.window.showInformationMessage(`✅ ${prefix}: ${generatedText}`);
            }

            return {
                newText,
                generatedText,
                success: true
            };
        } else {
            // Confirm mode - return result for confirmation dialog
            return {
                newText,
                generatedText,
                success: true
            };
        }
    }
}
