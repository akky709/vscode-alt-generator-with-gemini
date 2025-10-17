/**
 * Rate limiting utilities for API calls
 */

// Track the last API request time
let lastRequestTime = 0;

/**
 * Wait for rate limit based on RPM (Requests Per Minute)
 * Ensures requests don't exceed the specified rate
 */
export async function waitForRateLimit(): Promise<void> {
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
