/**
 * Gemini API integration
 */

import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { getDefaultPrompt, getCharConstraint } from './prompts';
import { getOutputLanguage } from '../utils/config';
import { formatMessage } from '../utils/textUtils';
import { waitForRateLimit } from '../utils/rateLimit';

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
    token?: vscode.CancellationToken
): Promise<string> {
    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // 出力言語を取得
    const outputLang = getOutputLanguage();

    // プロンプトを取得
    const prompt = getDefaultPrompt('video', outputLang as 'en' | 'ja');

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

    return ariaLabel;
}
