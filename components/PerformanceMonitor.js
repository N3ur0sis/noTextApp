/**
 * Performance Monitor Component
 * Shows memory usage and render metrics in development
 * Enable by setting SHOW_PERFORMANCE_MONITOR=true in ChatScreenOptimized
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Spacing, Typography } from '../constants/Design';

const PerformanceMonitor = ({ 
  messagesCount = 0, 
  renderCount = 0, 
  cacheHits = 0,
  windowSize = 5 
}) => {
  const [memoryUsage, setMemoryUsage] = useState(0);
  const [renderTime, setRenderTime] = useState(0);

  useEffect(() => {
    if (!__DEV__) return;

    const startTime = performance.now();
    
    // Estimate memory usage (rough calculation)
    const estimatedMemory = messagesCount * 0.5; // ~0.5MB per message estimate
    setMemoryUsage(estimatedMemory);

    // Calculate render time
    const endTime = performance.now();
    setRenderTime(endTime - startTime);

    // Log performance metrics
    console.log('📊 [PERFORMANCE]', {
      messagesInMemory: messagesCount,
      windowSize,
      renderCount,
      cacheHits,
      estimatedMemoryMB: estimatedMemory.toFixed(1),
      renderTimeMs: (endTime - startTime).toFixed(2)
    });
  }, [messagesCount, renderCount, cacheHits, windowSize]);

  if (!__DEV__) return null;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>Messages:</Text>
        <Text style={styles.value}>{messagesCount}/{windowSize}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Memory:</Text>
        <Text style={styles.value}>{memoryUsage.toFixed(1)}MB</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Renders:</Text>
        <Text style={styles.value}>{renderCount}</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Cache:</Text>
        <Text style={styles.value}>{cacheHits} hits</Text>
      </View>
      <View style={styles.row}>
        <Text style={styles.label}>Render:</Text>
        <Text style={styles.value}>{renderTime.toFixed(1)}ms</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 100,
    right: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    padding: Spacing.sm,
    borderRadius: 8,
    minWidth: 120,
    zIndex: 1000,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  label: {
    color: Colors.gray400,
    fontSize: Typography.xs,
    fontWeight: Typography.light,
  },
  value: {
    color: Colors.white,
    fontSize: Typography.xs,
    fontWeight: Typography.medium,
  },
});

export default PerformanceMonitor;
