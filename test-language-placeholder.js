// Test script for {languageConstraint} placeholder replacement
// Run with: node test-language-placeholder.js

// Simulate getLanguageConstraint function
function getLanguageConstraint(lang) {
    if (lang === 'ja') {
        return ' Respond only in Japanese.';
    }
    return '';
}

// Test cases
const testCases = [
    {
        name: 'With placeholder (Japanese)',
        prompt: 'You are an expert.\n\n## Output Format\n{languageConstraint}\nOutput only the result.',
        lang: 'ja',
        expected: 'You are an expert.\n\n## Output Format\n Respond only in Japanese.\nOutput only the result.'
    },
    {
        name: 'With placeholder (English)',
        prompt: 'You are an expert.\n\n## Output Format\n{languageConstraint}\nOutput only the result.',
        lang: 'en',
        expected: 'You are an expert.\n\n## Output Format\n\nOutput only the result.'
    },
    {
        name: 'Without placeholder (Japanese) - backward compatibility',
        prompt: 'You are an expert.\n\nOutput only the result.',
        lang: 'ja',
        expected: 'You are an expert.\n\nOutput only the result. Respond only in Japanese.'
    },
    {
        name: 'Without placeholder (English)',
        prompt: 'You are an expert.\n\nOutput only the result.',
        lang: 'en',
        expected: 'You are an expert.\n\nOutput only the result.'
    },
    {
        name: 'Multiple placeholders (Japanese)',
        prompt: '{languageConstraint}\nInstruction 1.\n{languageConstraint}\nInstruction 2.',
        lang: 'ja',
        expected: ' Respond only in Japanese.\nInstruction 1.\n Respond only in Japanese.\nInstruction 2.'
    }
];

console.log('Testing {languageConstraint} Placeholder Replacement\n');
console.log('='.repeat(70));

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
    const languageConstraint = getLanguageConstraint(testCase.lang);
    let result = testCase.prompt;

    // Replace logic (same as prompts.ts)
    if (result.includes('{languageConstraint}')) {
        result = result.replace(/{languageConstraint}/g, languageConstraint);
    } else {
        // Fallback: Add to end if placeholder not found
        if (languageConstraint) {
            result = result + languageConstraint;
        }
    }

    const success = result === testCase.expected;

    if (success) {
        console.log(`✅ ${testCase.name}`);
        passed++;
    } else {
        console.log(`❌ ${testCase.name}`);
        console.log(`   Expected: ${JSON.stringify(testCase.expected)}`);
        console.log(`   Got:      ${JSON.stringify(result)}`);
        failed++;
    }
}

console.log('\n' + '='.repeat(70));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    console.log('🎉 All tests passed!');
}
