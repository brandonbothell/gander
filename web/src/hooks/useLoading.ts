import { createContext, useContext } from 'react';

export const LoadingContext = createContext<{
  loading: boolean;
  setLoading: (v: boolean) => void;
}>({ loading: false, setLoading: () => {} });

export function useLoading() {
  return useContext(LoadingContext);
}
