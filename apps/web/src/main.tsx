import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './styles.css';

function SetupPage() {
  const [message, setMessage] = useState('Checking backend and database…');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/health', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Database unavailable. Check PostgreSQL and backend configuration.');
        setReady(true);
        setMessage('Backend and PostgreSQL are connected.');
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Connection failed.');
      });
    return () => controller.abort();
  }, []);
  return <main>
    <p className="eyebrow">CAMERA MONITORING SYSTEM</p>
    <h1>Project environment</h1>
    <p>The development foundation is ready for authentication, cameras, and monitoring events.</p>
    <section aria-live="polite" className={ready ? 'status ready' : 'status'}>
      <h2>{ready ? 'Connected' : 'Connection status'}</h2>
      <p>{message}</p>
    </section>
    <p className="note">This is a setup page. Application features will be added in the next milestones.</p>
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><BrowserRouter><Routes><Route path="*" element={<SetupPage />} /></Routes></BrowserRouter></StrictMode>,
);
