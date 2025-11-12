// Quick test script for section matching flexibility
// Run with: node test-section-matching.js

// Normalize function (same logic as prompts.ts)
function normalizeSectionTitle(title) {
    return title.toLowerCase()
        .replace(/^#+\s*/, '') // Remove leading # symbols
        .replace(/[\s\-_]+/g, '') // Remove spaces, hyphens, underscores
        .trim();
}

// Test cases
const testCases = [
    // SEO variations
    { input: '# SEO', expected: 'imagealtseo' },
    { input: '# Image ALT - SEO', expected: 'imagealtseo' },
    { input: '# ImageAltSEO', expected: 'imagealtseo' },
    { input: '# image_alt_seo', expected: 'imagealtseo' },
    { input: '# image-alt-seo', expected: 'imagealtseo' },

    // A11Y variations
    { input: '# A11Y', expected: 'imagealta11y' },
    { input: '# Accessibility', expected: 'accessibility' },
    { input: '# Image ALT - A11Y', expected: 'imagealta11y' },
    { input: '# ImageAltA11Y', expected: 'imagealta11y' },

    // Video variations
    { input: '# Video', expected: 'video' },
    { input: '# Video Detailed', expected: 'videodetailed' },
    { input: '# VideoDetailed', expected: 'videodetailed' },
    { input: '# video-detailed', expected: 'videodetailed' },

    // Model variations
    { input: '# Model', expected: 'model' },
    { input: '# Gemini API Model', expected: 'geminiapimodel' },
    { input: '# gemini_api_model', expected: 'geminiapimodel' },
];

// Mapping (from prompts.ts)
const validPatterns = {
    'imagealtseo': 'Image ALT - SEO',
    'seo': 'Image ALT - SEO',
    'imagealta11y': 'Image ALT - A11Y',
    'a11y': 'Image ALT - A11Y',
    'accessibility': 'Image ALT - A11Y',
    'videodescriptionstandard': 'Video Description - Standard',
    'video': 'Video Description - Standard',
    'videostandard': 'Video Description - Standard',
    'videodescriptiondetailed': 'Video Description - Detailed',
    'videodetailed': 'Video Description - Detailed',
    'contextrule': 'Context Rule',
    'rule': 'Context Rule',
    'contextdata': 'Context Data',
    'data': 'Context Data',
    'context': 'Context',
    'geminiapimodel': 'Gemini API Model',
    'model': 'Gemini API Model'
};

console.log('Testing Section Title Normalization\n');
console.log('='.repeat(60));

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
    const normalized = normalizeSectionTitle(testCase.input);
    const isValid = validPatterns.hasOwnProperty(normalized);
    const mappedTo = validPatterns[normalized] || 'UNKNOWN';

    if (isValid) {
        console.log(`✅ "${testCase.input}" → "${normalized}" → ${mappedTo}`);
        passed++;
    } else {
        console.log(`❌ "${testCase.input}" → "${normalized}" (NOT RECOGNIZED)`);
        failed++;
    }
}

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log('🎉 All tests passed!');
}
