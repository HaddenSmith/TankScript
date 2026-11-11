import { useEffect, useRef } from 'react';

export function StatusMessage({ type, children }) {
  const messageRef = useRef(null);
  const isUrgent = type === 'warning' || type === 'danger';

  useEffect(() => {
    messageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [children]);

  return (
    <div
      ref={messageRef}
      className={`alert alert-${type}`}
      role={isUrgent ? 'alert' : 'status'}
      aria-live={isUrgent ? 'assertive' : 'polite'}
    >
      {children}
    </div>
  );
}
