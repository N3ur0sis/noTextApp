/**
 * Performance Monitor - Track API call patterns and optimization effectiveness
 */

class PerformanceMonitor {
  constructor() {
    this.apiCalls = new Map(); // Track API call frequency
    this.eventCounts = new Map(); // Track event emission frequency  
    this.throttleStats = new Map(); // Track throttle effectiveness
    this.startTime = Date.now();
  }

  // Track an API call
  trackAPICall(endpoint, userId = 'unknown') {
    const key = `${endpoint}:${userId}`;
    const now = Date.now();
    
    if (!this.apiCalls.has(key)) {
      this.apiCalls.set(key, []);
    }
    
    this.apiCalls.get(key).push(now);
    
    // Keep only last 10 calls per endpoint
    const calls = this.apiCalls.get(key);
    if (calls.length > 10) {
      calls.shift();
    }
  }

  // Track event emission
  trackEvent(eventType, data = {}) {
    const key = eventType;
    const now = Date.now();
    
    if (!this.eventCounts.has(key)) {
      this.eventCounts.set(key, []);
    }
    
    this.eventCounts.get(key).push(now);
    
    // Keep only last 20 events per type
    const events = this.eventCounts.get(key);
    if (events.length > 20) {
      events.shift();
    }
  }

  // Track throttling effectiveness
  trackThrottle(operation, wasThrottled, timeSinceLastCall = 0) {
    if (!this.throttleStats.has(operation)) {
      this.throttleStats.set(operation, {
        totalAttempts: 0,
        throttled: 0,
        allowed: 0
      });
    }
    
    const stats = this.throttleStats.get(operation);
    stats.totalAttempts++;
    
    if (wasThrottled) {
      stats.throttled++;
    } else {
      stats.allowed++;
    }
  }

  // Get performance summary
  getPerformanceReport() {
    const now = Date.now();
    const sessionDuration = now - this.startTime;
    
    // Analyze API call patterns
    const apiReport = {};
    for (const [endpoint, calls] of this.apiCalls) {
      const recentCalls = calls.filter(time => now - time < 60000); // Last minute
      const callFrequency = recentCalls.length;
      
      apiReport[endpoint] = {
        totalCalls: calls.length,
        recentCalls: callFrequency,
        avgTimeBetween: calls.length > 1 ? 
          (calls[calls.length - 1] - calls[0]) / (calls.length - 1) : 0
      };
    }
    
    // Analyze event patterns
    const eventReport = {};
    for (const [eventType, events] of this.eventCounts) {
      const recentEvents = events.filter(time => now - time < 60000);
      
      eventReport[eventType] = {
        totalEvents: events.length,
        recentEvents: recentEvents.length,
        avgTimeBetween: events.length > 1 ?
          (events[events.length - 1] - events[0]) / (events.length - 1) : 0
      };
    }
    
    // Throttling effectiveness
    const throttleReport = {};
    for (const [operation, stats] of this.throttleStats) {
      throttleReport[operation] = {
        ...stats,
        throttleRate: stats.totalAttempts > 0 ? 
          (stats.throttled / stats.totalAttempts * 100).toFixed(1) + '%' : '0%'
      };
    }
    
    return {
      sessionDuration: Math.round(sessionDuration / 1000) + 's',
      apiCalls: apiReport,
      events: eventReport,
      throttling: throttleReport,
      timestamp: new Date().toISOString()
    };
  }

  // Reset all stats
  reset() {
    this.apiCalls.clear();
    this.eventCounts.clear();
    this.throttleStats.clear();
    this.startTime = Date.now();
  }
}

// Create global instance
const performanceMonitor = new PerformanceMonitor();

// Export for use in other services
export { performanceMonitor };

// Development helper - log performance report every 30 seconds
if (__DEV__) {
  setInterval(() => {
    const report = performanceMonitor.getPerformanceReport();
    console.log('📊 [PERFORMANCE REPORT]', report);
  }, 30000);
}
