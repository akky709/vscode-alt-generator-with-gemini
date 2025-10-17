/**
 * Gemini API integration
 */

import * as vscode from 'vscode';
import fetch, { Response } from 'node-fetch';
import { getDefaultPrompt, getCharConstraint } from './prompts';
import { getOutputLanguage } from '../utils/config';
import { CancellationError, NetworkError } from '../utils/errors';
import { handleHttpError, handleContentBlocked, validateResponseStructure, isRetryableError } from '../utils/errorHandler';

/**
 * Generate ALT text for an image using Gemini API
 */
export async function generateAltText(
    apiKey: string,
    base64Image: string,
    mimeType: string,
    mode: string,
    model: string,
    token?: vscode.CancellationToken,
    surroundingText?: string
): Promise<string> {
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

    if (mode === 'A11Y') {
        // A11Yモード
        // 文字数設定を取得
        const descriptionLength = config.get<string>('a11yDescriptionLength', 'standard') as 'standard' | 'detailed';
        const charLengthConstraint = getCharConstraint(outputLang as 'en' | 'ja', descriptionLength);

        prompt = getDefaultPrompt('a11y', outputLang as 'en' | 'ja', {
            mode: descriptionLength,
            charConstraint: charLengthConstraint,
            surroundingText
        });
    } else {
        // SEOモード
        prompt = getDefaultPrompt('seo', outputLang as 'en' | 'ja', {
            surroundingText
        });
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

    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(requestBody)
        });
    } catch (error: any) {
        // Network errors (connection failed, DNS errors, etc.)
        throw new NetworkError(
            'Failed to connect to Gemini API.\n\n' +
            'Possible causes:\n' +
            '1. No internet connection\n' +
            '2. Network firewall blocking the request\n' +
            '3. DNS resolution failed\n\n' +
            `Error details: ${error.message}`
        );
    }

    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }

    // Handle HTTP errors
    if (!response.ok) {
        await handleHttpError(response);
    }

    const data: any = await response.json();

    // Check for content blocked by safety filters
    if (data.promptFeedback && data.promptFeedback.blockReason) {
        console.error('API blocked the request:', JSON.stringify(data, null, 2));
        handleContentBlocked(data.promptFeedback.blockReason, 'image');
    }

    // Validate response structure
    validateResponseStructure(data);

    const altText = data.candidates[0].content.parts[0].text.trim();

    return altText;
}

/**
 * Generate aria-label for video using Gemini API
 */
export async function generateVideoAriaLabel(
    apiKey: string,
    base64Video: string,
    mimeType: string,
    model: string,
    token?: vscode.CancellationToken,
    surroundingText?: string
): Promise<string> {
    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // 出力言語を取得
    const outputLang = getOutputLanguage();

    // プロンプトを取得
    const prompt = getDefaultPrompt('video', outputLang as 'en' | 'ja', {
        surroundingText
    });

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

    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }

    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(requestBody)
        });
    } catch (error: any) {
        // Network errors (connection failed, DNS errors, etc.)
        throw new NetworkError(
            'Failed to connect to Gemini API.\n\n' +
            'Possible causes:\n' +
            '1. No internet connection\n' +
            '2. Network firewall blocking the request\n' +
            '3. DNS resolution failed\n\n' +
            `Error details: ${error.message}`
        );
    }

    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }

    // Handle HTTP errors
    if (!response.ok) {
        await handleHttpError(response);
    }

    const data: any = await response.json();

    // Check for content blocked by safety filters
    if (data.promptFeedback && data.promptFeedback.blockReason) {
        console.error('API blocked the request:', JSON.stringify(data, null, 2));
        handleContentBlocked(data.promptFeedback.blockReason, 'video');
    }

    // Validate response structure
    validateResponseStructure(data);

    const ariaLabel = data.candidates[0].content.parts[0].text.trim();

    return ariaLabel;
}

/**
 * Generate ALT text with automatic retry for retryable errors
 * Only retries network errors and server errors (5xx)
 * Does NOT retry rate limit errors (429) - user must wait
 */
export async function generateAltTextWithRetry(
    apiKey: string,
    base64Image: string,
    mimeType: string,
    mode: string,
    model: string,
    token?: vscode.CancellationToken,
    surroundingText?: string,
    maxRetries: number = 2
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // キャンセルチェック
            if (token?.isCancellationRequested) {
                throw new CancellationError();
            }

            return await generateAltText(
                apiKey,
                base64Image,
                mimeType,
                mode,
                model,
                token,
                surroundingText
            );
        } catch (error) {
            lastError = error as Error;

            // キャンセルエラーは即座に投げる
            if (error instanceof CancellationError || token?.isCancellationRequested) {
                throw error;
            }

            // リトライ不可能なエラーは即座に投げる
            if (!isRetryableError(error)) {
                throw error;
            }

            // 最後の試行でエラーが出た場合は投げる
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // Short wait for network/server errors: 1秒, 2秒
            const waitTime = 1000 * (attempt + 1);
            console.log(`[ALT Generator] Retrying after network/server error (attempt ${attempt + 1}/${maxRetries}, waiting ${waitTime}ms)`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    throw lastError || new Error('Unknown error during retry');
}

/**
 * Generate aria-label with automatic retry for retryable errors
 * Only retries network errors and server errors (5xx)
 * Does NOT retry rate limit errors (429) - user must wait
 */
export async function generateVideoAriaLabelWithRetry(
    apiKey: string,
    base64Video: string,
    mimeType: string,
    model: string,
    token?: vscode.CancellationToken,
    surroundingText?: string,
    maxRetries: number = 2
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // キャンセルチェック
            if (token?.isCancellationRequested) {
                throw new CancellationError();
            }

            return await generateVideoAriaLabel(
                apiKey,
                base64Video,
                mimeType,
                model,
                token,
                surroundingText
            );
        } catch (error) {
            lastError = error as Error;

            // キャンセルエラーは即座に投げる
            if (error instanceof CancellationError || token?.isCancellationRequested) {
                throw error;
            }

            // リトライ不可能なエラーは即座に投げる
            if (!isRetryableError(error)) {
                throw error;
            }

            // 最後の試行でエラーが出た場合は投げる
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // Short wait for network/server errors: 1秒, 2秒
            const waitTime = 1000 * (attempt + 1);
            console.log(`[ALT Generator] Retrying after network/server error (attempt ${attempt + 1}/${maxRetries}, waiting ${waitTime}ms)`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    throw lastError || new Error('Unknown error during retry');
}
