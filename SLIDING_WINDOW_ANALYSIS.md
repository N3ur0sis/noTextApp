# Sliding Window Carousel Analysis

## Issue Description
When a conversation has fewer than 10 images (< SLIDING_WINDOW_SIZE), there are bugs with:
1. Optimistic message handling during send operations
2. Loading states for new messages
3. Gesture navigation consistency
4. Carousel positioning accuracy

## Root Cause Analysis

### 1. Carousel Width Calculations
- Each message item has `width: width` (screen width)
- Carousel uses `translateX: -currentIndex * width`
- When messages.length < 10, the carousel container is narrower than expected
- This can cause positioning issues when swiping or during optimistic updates

### 2. Index Clamping Logic
```javascript
// In ChatScreen.js line 143-146
if (currentIndex >= len) {
  const newIndex = Math.max(0, len - 1)
  setCurrentIndex(newIndex)
  // Carousel position updated
}
```
- This logic works correctly for length changes
- But may cause flicker during optimistic message transitions

### 3. Gesture Navigation Boundaries
```javascript
// In horizontal gesture handler
let newIndex = currentIndex
if (translationX > width * 0.3 || velocity > 500) {
  newIndex = Math.max(0, currentIndex - 1)  // Go to previous
} else if (translationX < -width * 0.3 || velocity < -500) {
  newIndex = Math.min(messages.length - 1, currentIndex + 1)  // Go to next
}
```
- Works correctly but may feel different with fewer messages
- Less "resistance" when at boundaries

### 4. Optimistic Message Window Size Logic
```javascript
// In useSlidingWindowMessages.js line 1205-1210
const optimisticCount = dedupedFiltered.filter(m => m._isSending).length;

if (optimisticCount > 0) {
  const windowSize = Math.max(SLIDING_WINDOW_SIZE, optimisticCount + SLIDING_WINDOW_SIZE - 1);
  slidingWindow = dedupedFiltered.slice(-windowSize);
} else {
  slidingWindow = dedupedFiltered.slice(-SLIDING_WINDOW_SIZE);
}
```
- When sending optimistic messages, window size can grow beyond 10
- This can cause index misalignment when messages.length was < 10

## Identified Issues

### Issue 1: Dynamic Window Size with Optimistic Messages
When a conversation has 5 messages and user sends a message:
1. Original array: [msg1, msg2, msg3, msg4, msg5] (length=5, currentIndex=4)
2. With optimistic: window grows to accommodate optimistic message
3. New array: [msg1, msg2, msg3, msg4, msg5, optimistic] (length=6, currentIndex=5)
4. When real message comes back, array might shift unexpectedly

### Issue 2: Carousel Position Drift
With fewer messages, the carousel container is physically smaller:
- 5 messages = 5 * width total width
- 10 messages = 10 * width total width
- Gesture calculations assume full-size container

### Issue 3: Index Reset During Transitions
When optimistic messages are replaced with real ones:
- Index clamping may trigger unnecessarily
- Carousel position may reset to wrong location
- User loses their current viewing position

## Fixes Needed

### 1. Consistent Window Size Behavior
Ensure sliding window behaves identically regardless of message count

### 2. Stable Index Management
Prevent index jumping during optimistic → real message transitions

### 3. Gesture Navigation Consistency
Make gesture thresholds and behavior identical for any message count

### 4. Position Preservation
Maintain user's current viewing position during all state changes