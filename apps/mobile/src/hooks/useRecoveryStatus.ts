import { useCallback, useEffect, useRef, useState } from 'react';
import { strideApi } from '../services/api';
import { useStrideStore } from '../store/useStrideStore';

export function useRecoveryStatus() {
  const isInjured = useStrideStore((state) => state.isInjured);
  const setIsInjured = useStrideStore((state) => state.setIsInjured);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const lock = useRef(false);

  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setError('');
    setReady(false);
    try {
      const profile = await strideApi.getProfile();
      if (generation.current !== request) return;
      if (typeof profile?.is_injured !== 'boolean') throw new Error('Recovery status unavailable');
      setIsInjured(profile.is_injured);
      setReady(true);
    } catch {
      if (generation.current === request) setError('Could not check your recovery preference. Sprint prescriptions are paused until it is confirmed.');
    }
  }, [setIsInjured]);

  useEffect(() => {
    refresh();
    return () => { generation.current++; };
  }, [refresh]);

  const toggle = async (next: boolean) => {
    if (!ready || lock.current) return;
    const request = generation.current;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const profile = await strideApi.updateInjuryStatus(next);
      if (generation.current !== request) return;
      if (profile?.is_injured !== next) throw new Error('Recovery update not confirmed');
      setIsInjured(next);
    } catch {
      if (generation.current === request) {
        setReady(false);
        setError('Could not confirm your recovery update. Refresh before trying again.');
      }
    } finally {
      lock.current = false;
      if (generation.current === request) setBusy(false);
    }
  };

  return { isInjured, ready, busy, error, refresh, toggle };
}
