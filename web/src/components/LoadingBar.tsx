import { useLoading } from '../hooks/useLoading';

export function LoadingBar() {
  const { loading } = useLoading();
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: loading ? '100%' : '0%',
        height: 4,
        background: 'linear-gradient(90deg, #1976d2, #8ef)',
        transition: 'width 0.3s cubic-bezier(.4,2,.6,1)',
        zIndex: 9999,
        pointerEvents: 'none',
      }}
    />
  );
}
