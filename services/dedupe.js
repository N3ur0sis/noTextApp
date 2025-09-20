/**
 * Request deduplication service to prevent duplicate API calls
 */

const inFlight = {}

export function dedupe(key, fn) {
  if (inFlight[key]) {
    console.log(`🔒 [DEDUPE] Using in-flight request for: ${key}`)
    return inFlight[key]
  }
  
  console.log(`🚀 [DEDUPE] Starting new request for: ${key}`)
  inFlight[key] = fn().finally(() => {
    console.log(`✅ [DEDUPE] Completed request for: ${key}`)
    delete inFlight[key]
  })
  
  return inFlight[key]
}

export default { dedupe }
