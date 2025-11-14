// Test script to verify 3-star rating workflow
const axios = require('axios');

const API_BASE = 'http://localhost:5000/api'; // Adjust if your API runs on different port

async function test3StarRatingFlow() {
  try {
    console.log('🧪 Testing 3-Star Rating Flow...\n');

    // Step 1: Check if we can get some existing tokens
    console.log('📋 Step 1: Checking existing tokens...');
    
    // You'll need to replace this with actual token and auth details from your system
    const mockTokenId = 'your-token-id-here'; // Replace with actual token ID
    const mockTeleshopManagerToken = 'your-teleshop-manager-jwt-here'; // Replace with actual JWT
    
    console.log('⚠️  To properly test this, you need to:');
    console.log('1. Find an existing token ID from your database');
    console.log('2. Get a valid teleshop manager JWT token');
    console.log('3. Update the mockTokenId and mockTeleshopManagerToken variables above');
    console.log('4. Run this script again\n');

    // Step 2: Submit 3-star feedback
    console.log('⭐ Step 2: Submitting 3-star feedback...');
    
    // Uncomment and modify these when you have real data
    /*
    const feedbackResponse = await axios.post(`${API_BASE}/feedback/submit`, {
      tokenId: mockTokenId,
      rating: 3,
      comment: 'Test 3-star feedback for teleshop manager notification'
    });
    
    console.log('✅ Feedback submitted:', feedbackResponse.data);
    
    // Step 3: Check alerts for teleshop manager
    console.log('🔔 Step 3: Checking teleshop manager alerts...');
    
    const alertsResponse = await axios.get(`${API_BASE}/teleshop-manager/alerts?isRead=false`, {
      headers: {
        'Authorization': `Bearer ${mockTeleshopManagerToken}`
      }
    });
    
    console.log('📬 Teleshop Manager Alerts:', alertsResponse.data);
    
    // Step 4: Check feedback in teleshop manager feedback page
    console.log('📊 Step 4: Checking teleshop manager feedback list...');
    
    const feedbackListResponse = await axios.get(`${API_BASE}/teleshop-manager/feedback?resolved=false`, {
      headers: {
        'Authorization': `Bearer ${mockTeleshopManagerToken}`
      }
    });
    
    console.log('📝 Teleshop Manager Feedback List:', feedbackListResponse.data);
    */

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data || error.message);
  }
}

// Manual verification steps
console.log('🔧 MANUAL VERIFICATION STEPS:\n');
console.log('1. Start your backend server (npm run dev)');
console.log('2. Find a token ID from your database that has a teleshop manager assigned');
console.log('3. Get a teleshop manager JWT token (login via frontend or use existing)');
console.log('4. Update this script with the actual values');
console.log('5. Run the script: node test-3-star-rating.js\n');

console.log('🐛 THE BUG WAS:');
console.log('- Alert was created with type "moderate_feedback"');
console.log('- Teleshop manager alerts endpoint was filtering for "TELESHOP_MANAGER_FEEDBACK_ALERT"');
console.log('- Fixed by changing filter to use "moderate_feedback"\n');

console.log('✅ EXPECTED BEHAVIOR AFTER FIX:');
console.log('- 3-star feedback creates alert with type "moderate_feedback"');
console.log('- Teleshop manager alerts endpoint now filters for "moderate_feedback"');
console.log('- Notification bell should show unread count');
console.log('- Feedback should appear in teleshop manager feedback page\n');

test3StarRatingFlow();