import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, RefreshCcw } from 'lucide-react';
import { getFallbackBox, type CircleBox, detectCircleBox, smoothCircleBox } from './circleDetector';
import { useAppVersionLabel } from '../appVersion';

const isContinuityLabel = (label: string) => /iphone|continuity/i.test(label);

const pickPreferredDevice = (devices: MediaDeviceInfo[]) => {
  return devices.find((device) => isContinuityLabel(device.label)) || devices[0] || null;
};

export const CircleCameraPage = () => {
  const versionLabel = useAppVersionLabel();
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [isReady, setIsReady] = useState(false);
  const [status, setStatus] = useState('Подключаю камеру...');
  const [frameBox, setFrameBox] = useState<CircleBox>(getFallbackBox());
  const [hasCircle, setHasCircle] = useState(false);

  const resolvedDeviceId = useMemo(() => {
    if (selectedDeviceId) return selectedDeviceId;
    return pickPreferredDevice(devices)?.deviceId || '';
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    let cancelled = false;

    const loadDevices = async () => {
      const all = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      const videos = all.filter((device) => device.kind === 'videoinput');
      setDevices(videos);
      if (!selectedDeviceId) {
        setSelectedDeviceId(pickPreferredDevice(videos)?.deviceId || '');
      }
    };

    void loadDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', loadDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', loadDevices);
    };
  }, [selectedDeviceId]);

  useEffect(() => {
    let cancelled = false;

    const startCamera = async () => {
      try {
        setStatus('Подключаю камеру...');
        setIsReady(false);
        streamRef.current?.getTracks().forEach((track) => track.stop());

        const constraints: MediaStreamConstraints = {
          audio: false,
          video: resolvedDeviceId
            ? {
                deviceId: { ideal: resolvedDeviceId },
                width: { ideal: 1440 },
                height: { ideal: 1080 },
              }
            : {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1440 },
                height: { ideal: 1080 },
              },
        };

        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();
        setIsReady(true);
        setStatus('Ищу круг в кадре...');
      } catch {
        setStatus('Не удалось подключить камеру');
      }
    };

    void startCamera();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, [resolvedDeviceId]);

  useEffect(() => {
    if (!isReady) return undefined;

    let cancelled = false;
    let missCount = 0;

    const tick = () => {
      const video = videoRef.current;
      if (cancelled || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      const detected = detectCircleBox(video);
      if (detected) {
        missCount = 0;
        setHasCircle(true);
        setFrameBox((previous) => smoothCircleBox(previous, detected, 0.24));
        setStatus('Круг найден. Держите объект в кадре.');
      } else {
        missCount += 1;
        if (missCount >= 3) {
          setHasCircle(false);
          setFrameBox((previous) => smoothCircleBox(previous, getFallbackBox(), 0.12));
          setStatus('Ищу круг в кадре...');
        }
      }
    };

    tick();
    const timer = window.setInterval(tick, 160);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [isReady]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col bg-slate-950 text-slate-50">
      <header className="border-b border-slate-800 bg-slate-900 px-6 py-5">
        <div className="text-[11px] uppercase tracking-[0.28em] text-slate-400">{versionLabel}</div>
        <h1 className="mt-3 text-3xl font-semibold">Camera Circle Baseline</h1>
        <p className="mt-2 text-sm text-slate-400">Только один сценарий: поток камеры, поиск круга, рамка по кругу.</p>
      </header>

      <main className="flex flex-1 flex-col gap-6 p-6">
        <section className="rounded-[28px] border border-slate-800 bg-slate-900 p-5 shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
          <div className="relative overflow-hidden rounded-[24px] border border-slate-700 bg-black">
            <div className="aspect-[4/3] w-full">
              <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
              <div className="pointer-events-none absolute inset-0">
                <div
                  className={`absolute rounded-full border-[3px] transition-all duration-150 ${
                    hasCircle ? 'border-emerald-400 shadow-[0_0_0_1px_rgba(52,211,153,0.45)]' : 'border-emerald-500/60'
                  }`}
                  style={{
                    left: `${frameBox.x * 100}%`,
                    top: `${frameBox.y * 100}%`,
                    width: `${frameBox.width * 100}%`,
                    height: `${frameBox.height * 100}%`,
                  }}
                >
                  <div className="absolute inset-[8%] rounded-full border border-emerald-300/25" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-4 rounded-[28px] border border-slate-800 bg-slate-900 p-5 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">Статус</div>
            <div className="mt-3 text-xl font-medium">{status}</div>
            <div className="mt-2 text-sm text-slate-400">
              {hasCircle ? 'Рамка села на найденный круг.' : 'Рамка в поиске, ждёт устойчивую фигуру.'}
            </div>
          </div>
          <div className="flex flex-col gap-3 md:w-80">
            <label className="text-xs uppercase tracking-[0.24em] text-slate-500">Активная камера</label>
            <div className="flex gap-2">
              <select
                value={resolvedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
                className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-sm text-slate-50"
              >
                {devices.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Камера ${device.deviceId.slice(0, 6)}`}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setSelectedDeviceId('')}
                className="rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-slate-300"
              >
                <RefreshCcw size={18} />
              </button>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 px-4 py-3 text-sm text-slate-400">
              <div className="flex items-center gap-2">
                <Camera size={16} />
                <span>{devices.find((device) => device.deviceId === resolvedDeviceId)?.label || 'Камера не выбрана'}</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
};
