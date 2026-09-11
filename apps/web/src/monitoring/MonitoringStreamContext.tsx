import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type StreamState = {
  deviceRevision: number;
  eventRevision: number;
  connectionState:
    | 'connecting'
    | 'connected'
    | 'reconnecting';
};

const Context = createContext<
  StreamState | undefined
>(undefined);

export function MonitoringStreamProvider({
  children,
  onAccessEnded,
}: {
  children: ReactNode;
  onAccessEnded: () => void;
}) {
  const [deviceRevision, setDeviceRevision] =
    useState(0);

  const [eventRevision, setEventRevision] =
    useState(0);

  const [
    connectionState,
    setConnectionState,
  ] = useState<StreamState['connectionState']>(
    'connecting',
  );

  useEffect(() => {
    const source = new EventSource('/api/stream');

    source.onopen = () =>
      setConnectionState('connected');

    source.addEventListener(
      'devices-changed',
      () =>
        setDeviceRevision((v) => v + 1),
    );

    source.addEventListener(
      'events-changed',
      () =>
        setEventRevision((v) => v + 1),
    );

    source.addEventListener(
      'access-ended',
      () => {
        source.close();
        onAccessEnded();
      },
    );

    source.onerror = () =>
      setConnectionState('reconnecting');

    return () => source.close();
  }, [onAccessEnded]);

  const value = useMemo(
    () => ({
      deviceRevision,
      eventRevision,
      connectionState,
    }),
    [
      deviceRevision,
      eventRevision,
      connectionState,
    ],
  );

  return (
    <Context.Provider value={value}>
      {children}
    </Context.Provider>
  );
}

export function useMonitoringStream() {
  const value = useContext(Context);

  if (!value) {
    throw new Error(
      'useMonitoringStream must be used inside MonitoringStreamProvider',
    );
  }

  return value;
}