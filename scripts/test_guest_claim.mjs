import fetch from 'node-fetch'

const BASE_URL = 'https://mana-ai-local.netlify.app'

async function run() {
  console.log('=== TEST: Guest Session Auto-Claiming ===')
  const guestId = `guest_test_${Date.now()}`

  // 1. Create a session as a guest with x-guest-id header
  console.log('Step 1: Creating session as guest with ID:', guestId)
  const guestSessionRes = await fetch(`${BASE_URL}/api/chats`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-guest-id': guestId,
    },
    body: JSON.stringify({
      title: 'Unclaimed Guest Conversation',
      firstMessage: 'This was created before signing up',
    }),
  })
  const guestSession = await guestSessionRes.json()
  console.log('Guest session created:', guestSession.success, 'ID:', guestSession.session?.id)

  // 2. Sign up and provide x-guest-id header so guest sessions are auto-claimed
  const testEmail = `claimed_user_${Date.now()}@testmana.com`
  console.log('Step 2: Signing up new user and passing x-guest-id...')
  const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-guest-id': guestId,
    },
    body: JSON.stringify({
      email: testEmail,
      password: 'ClaimPassword123!',
      name: 'Claimed User',
    }),
  })
  const signupData = await signupRes.json()
  console.log('Signup success:', signupData.success, 'User ID:', signupData.user?.id)

  // 3. Fetch user sessions to verify the guest session was adopted
  console.log('Step 3: Fetching user sessions with auth token...')
  const userSessionsRes = await fetch(`${BASE_URL}/api/chats`, {
    headers: {
      'Authorization': `Bearer ${signupData.token}`,
    },
  })
  const userSessions = await userSessionsRes.json()
  console.log('User sessions found:', userSessions.sessions?.length)
  const foundClaimed = userSessions.sessions?.some((s) => s.id === guestSession.session?.id)
  console.log('Claimed session present in user account:', foundClaimed)

  if (foundClaimed) {
    console.log('SUCCESS: Guest session was claimed and persisted to user account!')
  }
}

run().catch(console.error)
