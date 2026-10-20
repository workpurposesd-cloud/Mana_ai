import fetch from 'node-fetch'

const BASE_URL = 'https://mana-ai-local.netlify.app'

async function run() {
  console.log('=== TEST 1: Health & Netlify Blobs Status ===')
  const healthRes = await fetch(`${BASE_URL}/api/health`)
  const health = await healthRes.json()
  console.log('Health response:', JSON.stringify(health, null, 2))

  const testBlobsRes = await fetch(`${BASE_URL}/api/test-blobs`)
  const testBlobs = await testBlobsRes.json()
  console.log('Blobs write/read roundtrip:', JSON.stringify(testBlobs, null, 2))

  console.log('\n=== TEST 2: Image Generation (FLUX.1 - Watermark Free) ===')
  const imgRes = await fetch(`${BASE_URL}/api/generate/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'A picturesque sunrise over a rural Andhra village with lush green paddy fields and palm trees',
      aspectRatio: '16:9',
      provider: 'pollinations',
    }),
  })
  const imgData = await imgRes.json()
  console.log('Image generation status:', imgRes.status)
  console.log('Image response success:', imgData.success)
  if (imgData.image) {
    console.log('Generated image URL:', imgData.image.url)
    console.log('Has base64 backup:', Boolean(imgData.image.base64Data))
    console.log('Provider:', imgData.image.provider)
  }

  console.log('\n=== TEST 3: Video Generation Job Submission & Error Handling ===')
  const vidRes = await fetch(`${BASE_URL}/api/generate/video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: 'A gentle river flowing past an Indian village at dusk',
      provider: 'luma',
    }),
  })
  const vidData = await vidRes.json()
  console.log('Video generation status:', vidRes.status)
  console.log('Video response:', vidData)

  console.log('\n=== TEST 4: Cross-Device Auth & History Sync ===')
  const testEmail = `devtest_${Date.now()}@testmana.com`
  const testPassword = 'Password123!'
  
  // 1. Device A: Sign up
  console.log(`Step 4a: Sign up user ${testEmail} on Device A...`)
  const signupRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      name: 'Verification Bot',
    }),
  })
  const signupData = await signupRes.json()
  console.log('Signup result:', signupData.success, 'User ID:', signupData.user?.id)

  if (signupData.success && signupData.token) {
    // 2. Device A: Create a chat session with Authorization header
    console.log('Step 4b: Creating chat session on Device A with token...')
    const createSessionRes = await fetch(`${BASE_URL}/api/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${signupData.token}`,
      },
      body: JSON.stringify({
        title: 'Cross-Device Verification Session',
        firstMessage: 'హలో మావా! బాగున్నావా?',
      }),
    })
    const sessionData = await createSessionRes.json()
    console.log('Session creation result:', sessionData.success, 'Session ID:', sessionData.session?.id)

    // Save a message into the session
    if (sessionData.session?.id) {
      const msgRes = await fetch(`${BASE_URL}/api/chats/${sessionData.session.id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${signupData.token}`,
        },
        body: JSON.stringify({
          messages: [
            { id: 'm1', role: 'user', content: 'హలో మావా! బాగున్నావా?', timestamp: new Date().toISOString() },
            { id: 'm2', role: 'assistant', content: 'అరేయ్ మావా! నమస్కారం! నేను చాలా బాగున్నాను!', timestamp: new Date().toISOString() },
          ],
        }),
      })
      const msgData = await msgRes.json()
      console.log('Messages appended:', msgData.success, 'Message count:', msgData.session?.messages?.length)
    }

    // 3. Device B: Log in with credentials
    console.log(`Step 4c: Simulate Device B logging in with ${testEmail}...`)
    const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    })
    const loginData = await loginRes.json()
    console.log('Device B Login response:', JSON.stringify(loginData, null, 2))
    console.log('Device B Login result:', loginData.success, 'User ID match:', loginData.user?.id === signupData.user.id)

    // 4. Device B: Retrieve chat sessions from cloud using Device B's new token
    console.log('Step 4d: Device B fetching chat sessions from cloud...')
    const fetchSessionsRes = await fetch(`${BASE_URL}/api/chats`, {
      headers: {
        'Authorization': `Bearer ${loginData.token}`,
      },
    })
    const historyData = await fetchSessionsRes.json()
    console.log('Device B History fetch result:', historyData.success, 'Sessions count:', historyData.sessions?.length)
    if (historyData.sessions?.length > 0) {
      console.log('Device B retrieved session title:', historyData.sessions[0].title)
      console.log('Device B retrieved messages:', historyData.sessions[0].messages?.length)
    }
  }

  console.log('\n=== ALL PRODUCTION SUITE TESTS COMPLETE ===')
}

run().catch(console.error)
