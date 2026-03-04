async function testSmsLength() {
  console.log('📱 Testing SMS Message Lengths...\n');
  
  // Mock data that would typically cause long URLs
  const testData = {
    firstName: 'Ojitha',
    tokenNumber: 1,
    counterNumber: 1,
    outletName: 'Matara HQ',
    refNumber: 'SLT/2024/12/30/MAT/00001',
    services: 'Bill Payment, Document Collection',
    // Simulate the old long URL vs new short URL
    longRecoveryUrl: 'https://digital-queue-management-platform.vercel.app/s/bc1a1846-2f21-4c58-95d8-19a2efc94964',
    shortRecoveryUrl: 'https://digital-queue-management-platform.vercel.app/t/bc1a1846',
    shortFeedbackUrl: 'https://digital-queue-management-platform.vercel.app/f?r=00001234'
  };

  console.log('🔍 Testing with LONG URLs (old format):');
  console.log('======================================================');
  
  // Test skip message with long URL
  const skipMsgLong = `SLT DQMS: Dear ${testData.firstName}, Token #${testData.tokenNumber} skipped at ${testData.outletName}. Check status: ${testData.longRecoveryUrl} -SLT`;
  console.log(`[SKIP - LONG] Length: ${skipMsgLong.length} chars`);
  console.log(`[SKIP - LONG] Message: "${skipMsgLong}"`);
  if (skipMsgLong.length > 160) console.warn('❌ EXCEEDS 160 CHARS!');
  console.log('');

  // Test completion message with long URL
  const completeMsgLong = `SLT DQMS: Dear ${testData.firstName}, service completed. Ref: ${testData.refNumber}. Feedback: ${testData.longRecoveryUrl} -SLT`;
  console.log(`[COMPLETE - LONG] Length: ${completeMsgLong.length} chars`);
  console.log(`[COMPLETE - LONG] Message: "${completeMsgLong}"`);
  if (completeMsgLong.length > 160) console.warn('❌ EXCEEDS 160 CHARS!');
  console.log('');

  console.log('✨ Testing with SHORT URLs (new format):');
  console.log('======================================================');
  
  // Test skip message with short URL
  const skipMsgShort = `SLT DQMS: Dear ${testData.firstName}, Token #${testData.tokenNumber} skipped at ${testData.outletName}. Check status: ${testData.shortRecoveryUrl} -SLT`;
  console.log(`[SKIP - SHORT] Length: ${skipMsgShort.length} chars`);
  console.log(`[SKIP - SHORT] Message: "${skipMsgShort}"`);
  if (skipMsgShort.length <= 160) console.log('✅ UNDER 160 CHARS!');
  else console.warn('❌ STILL EXCEEDS 160 CHARS!');
  console.log('');

  // Test completion message with short URL
  const completeMsgShort = `SLT DQMS: Dear ${testData.firstName}, service completed. Ref: ${testData.refNumber}. Feedback: ${testData.shortFeedbackUrl} -SLT`;
  console.log(`[COMPLETE - SHORT] Length: ${completeMsgShort.length} chars`);
  console.log(`[COMPLETE - SHORT] Message: "${completeMsgShort}"`);
  if (completeMsgShort.length <= 160) console.log('✅ UNDER 160 CHARS!');
  else console.warn('❌ STILL EXCEEDS 160 CHARS!');
  console.log('');

  console.log('📊 SUMMARY:');
  console.log('======================================================');
  console.log(`Skip Message: ${skipMsgLong.length} → ${skipMsgShort.length} chars (saved ${skipMsgLong.length - skipMsgShort.length})`);
  console.log(`Complete Message: ${completeMsgLong.length} → ${completeMsgShort.length} chars (saved ${completeMsgLong.length - completeMsgShort.length})`);
  
  if (skipMsgShort.length <= 160 && completeMsgShort.length <= 160) {
    console.log('🎉 All messages are now under 160 character limit!');
  } else {
    console.log('⚠️  Some messages still exceed the limit - need further optimization');
  }
}

testSmsLength()
  .catch(console.error);