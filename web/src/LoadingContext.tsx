import React, { createContext, useContext, useState } from 'react';

const LoadingContext = createContext<{
  loading: boolean;
  setLoading: (v: boolean) => void;
}>({ loading: false, setLoading: () => { } });

export function LoadingProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(false);
  return (
    <LoadingContext.Provider value={{ loading, setLoading }}>
      {children}
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  return useContext(LoadingContext);
}
