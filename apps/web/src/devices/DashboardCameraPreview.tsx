import { useEffect, useRef, useState } from 'react';
import { CameraViewer } from './CameraViewer';

export function DashboardCameraPreview({
  deviceId,
  online,
  streamVersion,
}: {
  deviceId: string;
  online: boolean;
  streamVersion: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || !online || !streamVersion) {
      setNearViewport(false);
      return;
    }

    if (!('IntersectionObserver' in window)) {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => setNearViewport(Boolean(entry?.isIntersecting)),
      { rootMargin: '160px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [online, streamVersion]);

  return (
    <div ref={containerRef} className="dashboard-camera-preview">
      {!online || !streamVersion ? (
        <div className="dashboard-camera-placeholder">
          <span aria-hidden="true">◉</span>
          <small>Camera offline</small>
        </div>
      ) : nearViewport ? (
        <CameraViewer
          deviceId={deviceId}
          online
          streamVersion={streamVersion}
          compact
        />
      ) : (
        <div className="dashboard-camera-placeholder">
          <span aria-hidden="true">◉</span>
          <small>Live preview loads when visible</small>
        </div>
      )}
    </div>
  );
}
