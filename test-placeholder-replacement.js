/**
 * Test placeholder replacement in custom prompts
 */

// Simulate the getDefaultPrompt function behavior
function testPlaceholderReplacement() {
    console.log('\n🧪 Testing Placeholder Replacement\n');
    console.log('='*60);

    // Simulate custom prompt with {contextRule} and {contextData}
    const customPromptWithRule = `## Role
You are a Technical SEO Specialist.

{contextRule}

## Output
{languageConstraint}
Output only the alt text.`;

    const contextRule = `## IMPORTANT - Avoid Redundancy
- If the surrounding text fully describes the image, return "DECORATIVE"`;

    const contextData = `## Surrounding Text Context
The surrounding text information is as follows.

<section>Example content</section>`;

    const languageConstraint = ' Respond only in Japanese.';

    // Test 1: Replace {contextRule}
    console.log('\n📝 Test 1: Replacing {contextRule}');
    console.log('-'*60);
    let result1 = customPromptWithRule.replace(/{contextRule}/g, contextRule);
    console.log('Input prompt:', customPromptWithRule);
    console.log('\nAfter replacement:');
    console.log(result1);
    console.log('\n✅ {contextRule} replaced:', result1.includes('IMPORTANT - Avoid Redundancy'));

    // Test 2: Replace {languageConstraint}
    console.log('\n📝 Test 2: Replacing {languageConstraint}');
    console.log('-'*60);
    result1 = result1.replace(/{languageConstraint}/g, languageConstraint);
    console.log('After replacement:');
    console.log(result1);
    console.log('\n✅ {languageConstraint} replaced:', result1.includes('Respond only in Japanese'));

    // Test 3: What happens if placeholder is missing?
    console.log('\n📝 Test 3: Missing placeholder (should be empty)');
    console.log('-'*60);
    const promptWithoutRule = `## Role
You are a SEO expert.

## Output
Output only the alt text.`;

    const result3 = promptWithoutRule.replace(/{contextRule}/g, contextRule);
    console.log('Input:', promptWithoutRule);
    console.log('\nAfter replacement:');
    console.log(result3);
    console.log('\n✅ No change (expected):', result3 === promptWithoutRule);

    // Test 4: Check if needsSurroundingText is false, contextRule should be empty
    console.log('\n📝 Test 4: needsSurroundingText = false scenario');
    console.log('-'*60);
    const needsContext = false;
    const surroundingText = '<section>Example</section>';

    const contextRuleReplacement = needsContext && surroundingText ? contextRule : '';
    const result4 = customPromptWithRule.replace(/{contextRule}/g, contextRuleReplacement);

    console.log('needsContext:', needsContext);
    console.log('surroundingText:', surroundingText);
    console.log('\nAfter replacement:');
    console.log(result4);
    console.log('\n✅ {contextRule} replaced with empty string:', !result4.includes('IMPORTANT'));

    console.log('\n' + '='*60);
    console.log('🎉 All placeholder tests completed\n');
}

testPlaceholderReplacement();
