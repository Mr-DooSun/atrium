// Stand-in for `react` in store tests: useSyncExternalStore just records the subscribe function,
// so tests can subscribe to the store without rendering anything.
export const captured: { subscribe: ((listener: () => void) => () => void) | null } = { subscribe: null };

export function useSyncExternalStore<T>(
  subscribe: (listener: () => void) => () => void,
  getSnapshot: () => T,
): T {
  captured.subscribe = subscribe;
  return getSnapshot();
}
