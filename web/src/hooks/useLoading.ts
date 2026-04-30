import { createContext, useContext } from 'react'

export const LoadingContext = createContext<{
  loading: boolean
  setLoading: (v: boolean) => void
}>({
  loading: false,
  setLoading: () => {
    /* empty */
  },
})

export function useLoading() {
  return useContext(LoadingContext)
}
