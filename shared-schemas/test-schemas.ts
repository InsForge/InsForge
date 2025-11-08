import { chatMessageSchema } from './src/ai-api.schema';

console.log('🧪 Testing Chat Message Schema Validation\n');

// Test 1: Simple text message
const test1 = chatMessageSchema.safeParse({
  role: 'user',
  content: 'Hello!'
});
console.log('Test 1 (simple text):', test1.success ? '✅ PASS' : '❌ FAIL', test1.success ? '' : test1.error);

// Test 2: Legacy format (content + images)
const test2 = chatMessageSchema.safeParse({
  role: 'user',
  content: 'What is this?',
  images: [{ url: 'https://example.com/image.jpg' }]
});
console.log('Test 2 (legacy format):', test2.success ? '✅ PASS' : '❌ FAIL');

// Test 3: New OpenAI format (content array)
const test3 = chatMessageSchema.safeParse({
  role: 'user',
  content: [
    { type: 'text', text: 'What is this?' },
    { type: 'image_url', image_url: { url: 'https://example.com/image.jpg' } }
  ]
});
console.log('Test 3 (OpenAI format):', test3.success ? '✅ PASS' : '❌ FAIL');

// Test 4: New format with detail
const test4 = chatMessageSchema.safeParse({
  role: 'user',
  content: [
    { type: 'text', text: 'Analyze this' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,abc', detail: 'high' } }
  ]
});
console.log('Test 4 (with detail):', test4.success ? '✅ PASS' : '❌ FAIL');

// Test 5: Multiple images
const test5 = chatMessageSchema.safeParse({
  role: 'user',
  content: [
    { type: 'text', text: 'Compare these' },
    { type: 'image_url', image_url: { url: 'https://example.com/1.jpg' } },
    { type: 'image_url', image_url: { url: 'https://example.com/2.jpg' } }
  ]
});
console.log('Test 5 (multiple images):', test5.success ? '✅ PASS' : '❌ FAIL');

console.log('\n✨ All tests completed!');
