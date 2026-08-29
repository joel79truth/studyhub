export function useMemoryPressure() {
  const deviceMemory = navigator.deviceMemory || 4; // GB
  // Return a cache limit: 10 for low-end (<=2GB), 20 for mid, 40 for high
  if (deviceMemory <= 2) return 10;
  if (deviceMemory <= 4) return 20;
  return 40;
}