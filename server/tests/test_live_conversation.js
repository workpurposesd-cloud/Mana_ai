async function runTests() {
  const cases = [
    { 
      name: '1. Greeting', 
      prompt: 'hello hay', 
      history: [] 
    },
    { 
      name: '2. Casual Telugu / Still Alive', 
      prompt: 'nenu inka bathike unna', 
      history: [
        { role: 'user', content: 'hello hay' },
        { role: 'assistant', content: "Hey mama! What's up ra? Cheppu, what are we getting into today? 😊" }
      ] 
    },
    { 
      name: '3. What are you doing', 
      prompt: 'em chestunnav ra', 
      history: [] 
    },
    { 
      name: '4. Boredom', 
      prompt: "I'm bored bro", 
      history: [] 
    },
    { 
      name: '5. Swear Words Education', 
      prompt: 'Teach me common English swear words.', 
      history: [] 
    },
    { 
      name: '6. Web Search Request', 
      prompt: 'What is the latest news about AI? Search the web.', 
      history: [] 
    },
    { 
      name: '7. Direct Conceptual (No Search)', 
      prompt: 'what is photosynthesis in plants?', 
      history: [] 
    }
  ]

  for (const c of cases) {
    console.log('\n========================================')
    console.log(`TEST: ${c.name}`)
    console.log(`PROMPT: "${c.prompt}"`)
    const start = Date.now()
    const res = await fetch('http://localhost:3001/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: c.prompt, history: c.history })
    })
    const data = await res.json()
    console.log(`SEARCH PERFORMED?: ${data.isSearchPerformed}`)
    console.log(`INTENT CATEGORY: ${data.intent?.category}`)
    console.log(`RESPONSE (${Date.now() - start}ms):`)
    console.log(data.content)
  }
}

runTests().catch(console.error)
