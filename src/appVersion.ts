import { useEffect, useState } from 'react';

declare const __APP_BUILD_STAMP__: string;

type VersionState = {
  buildStamp: string;
  loadStamp: string;
  hmrCount: number;
  listeners: Set<() => void>;
  hotBound: boolean;
};

declare global {
  interface Window {
    __ETIKET_APP_VERSION__?: VersionState;
  }
}

const getVersionState = () => {
  if (!window.__ETIKET_APP_VERSION__) {
    window.__ETIKET_APP_VERSION__ = {
      buildStamp: __APP_BUILD_STAMP__,
      loadStamp: new Date().toISOString(),
      hmrCount: 0,
      listeners: new Set(),
      hotBound: false,
    };
  }

  const state = window.__ETIKET_APP_VERSION__;
  if (import.meta.hot && !state.hotBound) {
    state.hotBound = true;
    import.meta.hot.on('vite:beforeUpdate', () => {
      state.hmrCount += 1;
      state.listeners.forEach((listener) => listener());
    });
  }

  return state;
};

const formatShortStamp = (value: string) => value.replace('T', ' ').replace(/\..+$/, '');

export const getAppVersionLabel = () => {
  const state = getVersionState();
  const modeLabel = import.meta.env.DEV ? 'dev' : 'build';
  return `${modeLabel} ${formatShortStamp(state.buildStamp)} · load ${formatShortStamp(state.loadStamp)} · hmr ${state.hmrCount}`;
};

export const useAppVersionLabel = () => {
  const [label, setLabel] = useState(() => getAppVersionLabel());

  useEffect(() => {
    const state = getVersionState();
    const handleChange = () => setLabel(getAppVersionLabel());
    state.listeners.add(handleChange);
    return () => {
      state.listeners.delete(handleChange);
    };
  }, []);

  return label;
};
