import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Eye, Link2, LoaderCircle, LockKeyhole, Monitor, Moon, Radio, Sun, Unplug, UserRound } from 'lucide-react';
import { Button } from '@workspace/corrotrans-design-system/components/ui/button';
import { Spinner } from '@workspace/corrotrans-design-system/components/ui/spinner';
import {
  customFetchRaw,
  createVehicleDisplayPairingRequest,
  getVehicleDisplaySession,
  getVehicleDisplayPairingRequestStatus,
  unpairVehicleDisplay,
  type VehicleDisplayPairingRequestResponse,
  type VehicleDisplaySessionResponse,
} from './api-client';
import logoPath from './assets/logo_corrotrans_uploaded.png';
import ctLogoPath from './assets/splash_ct_logo.png';
import { tripPreview, tripPreviewCoordinates } from './vehicle-preview';
import './vehicle-display-minimal.css';

const LazyVehicleTripMap = lazy(() =>
  import('./VehicleTripMap').then((module) => ({ default: module.VehicleTripMap })),
);
const LazyPairingQrCode = lazy(() => import('./components/PairingQrCode'));

type Language = 'id' | 'en';
type PreviewPaymentMethod = 'cash' | 'qris';
const SESSION_KEY = 'corrotrans_vehicle_display_session';
const THEME_KEY = 'corrotrans_vehicle_display_theme';
type ThemeMode = 'light' | 'dark';
interface StoredVehicleDisplaySession {
  sessionToken: string;
  pairingId: string;
  vehicleId: string;
  vehicleLabel: string;
  pairedAt: string;
}

function readStoredSession(): StoredVehicleDisplaySession | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (!stored) return null;
  try {
    const value: unknown = JSON.parse(stored);
    if (value && typeof value === 'object') {
      const session = value as Partial<StoredVehicleDisplaySession>;
      if (typeof session.sessionToken === 'string'
        && /^[a-f0-9]{64}$/i.test(session.sessionToken)
        && typeof session.pairingId === 'string'
        && typeof session.vehicleId === 'string'
        && typeof session.vehicleLabel === 'string'
        && typeof session.pairedAt === 'string') {
        return session as StoredVehicleDisplaySession;
      }
    }
  } catch {
    // Discard older token-only or malformed display sessions.
  }
  localStorage.removeItem(SESSION_KEY);
  return null;
}

function readTheme(): ThemeMode {
  return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
}

const copy = {
  id: {
    display: 'Tampilan Kendaraan', connected: 'KENDARAAN TERHUBUNG', verifying: 'Memverifikasi sesi…', registered: 'PENGEMUDI TERDAFTAR',
    driverProfile: 'PROFIL PENGEMUDI',
    active: 'PERJALANAN AKTIF', order: 'PESANAN CUSTOMER', pickup: 'JEMPUT', destination: 'TUJUAN', payment: 'PEMBAYARAN',
    ready: 'Siap menerima perjalanan', readyDesc: 'Pesanan aktif dari kendaraan ini akan tampil otomatis di sini.',
    waiting: 'Menunggu pesanan', readOnly: 'Hanya lihat', synced: 'Sinkronisasi', waitingServer: 'Menunggu verifikasi server',
    disconnect: 'Putuskan perangkat', pairingTitle: 'Hubungkan Tablet',
    pairingDesc: 'QR pairing tampil di tablet ini. Driver yang sudah disetujui memindainya dari aplikasi Driver.',
    pair: 'Buat QR pairing baru', pairing: 'Membuat QR…', qrLoading: 'Menyiapkan QR…', scanHint: 'Pindai QR ini melalui menu Pemasangan Tablet di aplikasi Driver.',
    qrExpires: 'QR sekali pakai berlaku sampai', cancel: 'Batal',
    previewButton: 'Lihat pratinjau tampilan', previewLabel: 'PRATINJAU · DATA CONTOH',
    previewNotice: 'Ini hanya contoh: foto, nomor kode, dan perjalanan bukan data kendaraan terhubung. CASH/QRIS hanya pilihan pratinjau, bukan pembayaran nyata.',
    previewStandby: 'Mode siaga', previewTrip: 'Saat perjalanan', previewExit: 'Kembali ke layar awal',
    invalid: 'Permintaan pairing tidak valid.', expired: 'QR pairing kedaluwarsa. Buat QR baru.',
    revokedCode: 'QR pairing sudah dicabut. Buat QR baru.', alreadyUsed: 'QR pairing sudah digunakan. Buat QR baru.',
    photoMissing: 'FOTO BELUM DIUNGGAH',
    booker: 'NAMA PEMESAN', vehicleNumber: 'NOMOR KODE KENDARAAN', paymentMethod: 'METODE PEMBAYARAN', paymentStatus: 'STATUS PEMBAYARAN',
    pending: 'MENUNGGU', paid: 'LUNAS', failed: 'GAGAL', refunded: 'DIKEMBALIKAN',
    paymentHint: 'Informasi pembayaran dikelola dari aplikasi driver atau backend.',
    temporary: 'Pembaruan sementara gagal. Informasi terakhir yang berhasil dimuat tetap ditampilkan.',
    status: 'STATUS', service: 'LAYANAN', amount: 'TOTAL', tripFare: 'BIAYA PERJALANAN', distance: 'JARAK', eta: 'ESTIMASI',
    rejected: 'Sesi layar berakhir. Hubungkan kembali.', error: 'Tidak dapat menghubungkan layar. Buat QR baru lalu coba lagi.', noProfile: 'Profil kendaraan belum dapat dimuat.',
  },
  en: {
    display: 'Vehicle Display', connected: 'VEHICLE CONNECTED', verifying: 'Verifying session…', registered: 'REGISTERED DRIVER',
    driverProfile: 'DRIVER PROFILE',
    active: 'ACTIVE TRIP', order: 'CUSTOMER ORDER', pickup: 'PICKUP', destination: 'DESTINATION', payment: 'PAYMENT',
    ready: 'Ready for the next trip', readyDesc: 'Active orders for this vehicle will appear here automatically.',
    waiting: 'Waiting for orders', readOnly: 'Read-only', synced: 'Synced', waitingServer: 'Waiting for server verification',
    disconnect: 'Disconnect display', pairingTitle: 'Pair this tablet',
    pairingDesc: 'The pairing QR appears on this tablet. An approved driver scans it from the Driver app.',
    pair: 'Generate a new pairing QR', pairing: 'Generating QR…', qrLoading: 'Preparing QR…', scanHint: 'Scan this QR from Tablet Pairing in the Driver app.',
    qrExpires: 'One-time QR expires at', cancel: 'Cancel',
    previewButton: 'Preview the display', previewLabel: 'PREVIEW · SAMPLE DATA',
    previewNotice: 'Sample only: the photo, vehicle code, and trip are not from a paired vehicle. CASH/QRIS are preview choices, not real payments.',
    previewStandby: 'Standby', previewTrip: 'During a trip', previewExit: 'Back to start',
    invalid: 'Pairing request is invalid.', expired: 'Pairing QR expired. Generate a new one.',
    revokedCode: 'Pairing QR was revoked. Generate a new one.', alreadyUsed: 'Pairing QR was already used. Generate a new one.',
    photoMissing: 'PHOTO NOT UPLOADED',
    booker: 'BOOKER', vehicleNumber: 'VEHICLE CODE', paymentMethod: 'PAYMENT METHOD', paymentStatus: 'PAYMENT STATUS',
    pending: 'PENDING', paid: 'PAID', failed: 'FAILED', refunded: 'REFUNDED',
    paymentHint: 'Payment information is managed in the driver app or backend.',
    temporary: 'A refresh temporarily failed. The last successfully loaded information remains visible.',
    status: 'STATUS', service: 'SERVICE', amount: 'FARE', tripFare: 'TRIP FARE', distance: 'DISTANCE', eta: 'ETA',
    rejected: 'Display session ended. Pair again.', error: 'Could not pair this display. Generate a new QR and try again.', noProfile: 'Vehicle profile could not be loaded.',
  },
} as const;

type CopyText = { [Key in keyof typeof copy.id]: string };

function paymentStatusText(text: CopyText, status: string): string {
  return status in text ? text[status as keyof CopyText] : status;
}

function getStatus(error: unknown) {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; response?: { status?: unknown } };
  if (typeof candidate.status === 'number') return candidate.status;
  return typeof candidate.response?.status === 'number' ? candidate.response.status : undefined;
}

async function consumeVehicleDisplayEvents(
  sessionToken: string,
  signal: AbortSignal,
  handlers: {
    onConnected: () => void;
    onActivity: () => void;
    onSession: (session: VehicleDisplaySessionResponse) => void;
    onSessionEnded: () => void;
  },
): Promise<void> {
  const response = await customFetchRaw('/api/vehicle-display/events', {
    headers: {
      Accept: 'text/event-stream',
      Authorization: `Bearer ${sessionToken}`,
    },
    signal,
  });
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
    throw new Error('Vehicle display Realtime stream returned an unexpected response.');
  }
  if (!response.body) {
    throw new Error('This browser cannot read the vehicle display Realtime stream.');
  }

  handlers.onConnected();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let sessionEnded = false;

  const dispatchBlock = (block: string) => {
    let event = 'message';
    const data: string[] = [];
    for (const line of block.replace(/\r\n/g, '\n').split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const separator = line.indexOf(':');
      const field = separator < 0 ? line : line.slice(0, separator);
      const value = separator < 0 ? '' : line.slice(separator + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      if (field === 'data') data.push(value);
    }
    if (data.length === 0) return;

    const payload: unknown = JSON.parse(data.join('\n'));
    if (event === 'session') {
      if (!payload || typeof payload !== 'object' || typeof (payload as { vehicleId?: unknown }).vehicleId !== 'string') {
        throw new Error('Vehicle display Realtime event is invalid.');
      }
      handlers.onSession(payload as VehicleDisplaySessionResponse);
    } else if (event === 'session-ended') {
      sessionEnded = true;
      handlers.onSessionEnded();
    } else if (event === 'stream-error') {
      const message = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Vehicle display Realtime connection was interrupted.';
      throw new Error(message);
    }
  };

  try {
    while (!signal.aborted && !sessionEnded) {
      const { done, value } = await reader.read();
      if (done) break;
      handlers.onActivity();
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.search(/\r?\n\r?\n/);
      while (separator >= 0) {
        const block = buffer.slice(0, separator);
        const separatorLength = buffer.slice(separator).startsWith('\r\n\r\n') ? 4 : 2;
        buffer = buffer.slice(separator + separatorLength);
        dispatchBlock(block);
        if (sessionEnded) break;
        separator = buffer.search(/\r?\n\r?\n/);
      }
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

function errorText(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function money(price: number, currency: string) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency, maximumFractionDigits: 0 }).format(price);
}

function VehicleDisplay() {
  const [language, setLanguage] = useState<Language>('id');
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [previewPaymentMethod, setPreviewPaymentMethod] = useState<PreviewPaymentMethod>('cash');
  const [session, setSession] = useState<StoredVehicleDisplaySession | null>(readStoredSession);
  const sessionToken = session?.sessionToken ?? '';
  const [previewMode, setPreviewMode] = useState(() =>
    !session && ['standby', 'trip'].includes(new URLSearchParams(window.location.search).get('preview') ?? ''),
  );
  const [previewTrip, setPreviewTrip] = useState(() => new URLSearchParams(window.location.search).get('preview') === 'trip');
  const [pairing, setPairing] = useState(false);
  const [pairingRequest, setPairingRequest] = useState<VehicleDisplayPairingRequestResponse | null>(null);
  const [pairError, setPairError] = useState('');
  const pairingRequestAttempted = useRef(false);
  const [current, setCurrent] = useState<VehicleDisplaySessionResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(session));
  const [refreshError, setRefreshError] = useState('');
  const [revoked, setRevoked] = useState(false);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);
  const t: CopyText = copy[language];

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, [theme]);

  const clearSession = useCallback((wasRevoked: boolean) => {
    localStorage.removeItem(SESSION_KEY);
    setSession(null);
    setCurrent(null);
    setLoading(false);
    setRefreshError('');
    setRevoked(wasRevoked);
    setSyncedAt(null);
  }, []);

  useEffect(() => {
    if (!sessionToken) {
      setCurrent(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let retryTimer = 0;
    let fallbackTimer = 0;
    let fallbackActive = false;
    let streamController: AbortController | null = null;

    const stopFallback = () => {
      fallbackActive = false;
      window.clearTimeout(fallbackTimer);
    };

    const refreshFallback = async () => {
      if (cancelled || !fallbackActive) return;
      try {
        const response = await getVehicleDisplaySession({
          // Explicit display-session credential; never inherit a driver/app identity.
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        if (cancelled) return;
        setCurrent(response);
        setRevoked(false);
        setSyncedAt(new Date());
      } catch (error) {
        if (cancelled) return;
        if ([401, 403, 404].includes(getStatus(error) ?? 0)) {
          clearSession(true);
          return;
        }
        setRefreshError(errorText(error, t.temporary));
      } finally {
        if (!cancelled) {
          setLoading(false);
          if (fallbackActive) fallbackTimer = window.setTimeout(() => { void refreshFallback(); }, 10_000);
        }
      }
    };

    const startFallback = () => {
      if (fallbackActive || cancelled) return;
      fallbackActive = true;
      void refreshFallback();
    };

    const handleStreamFailure = (error: unknown) => {
      if (cancelled) return;
      if ([401, 403, 404].includes(getStatus(error) ?? 0)) {
        clearSession(true);
        return;
      }
      setRefreshError(errorText(error, t.temporary));
      startFallback();
      retryTimer = window.setTimeout(() => { void connect(); }, 20_000);
    };

    const connect = async () => {
      if (cancelled) return;
      const controller = new AbortController();
      streamController = controller;
      let connected = false;
      let connectTimer = 0;
      let idleTimer = 0;
      const resetIdleTimer = () => {
        window.clearTimeout(idleTimer);
        idleTimer = window.setTimeout(() => {
          controller.abort();
          handleStreamFailure(new Error(t.temporary));
        }, 55_000);
      };
      connectTimer = window.setTimeout(() => {
        if (!connected) controller.abort();
      }, 12_000);
      try {
        await consumeVehicleDisplayEvents(sessionToken, controller.signal, {
          onConnected: () => {
            connected = true;
            window.clearTimeout(connectTimer);
            resetIdleTimer();
            stopFallback();
          },
          onActivity: resetIdleTimer,
          onSession: (response) => {
            if (cancelled) return;
            setCurrent(response);
            setRefreshError('');
            setRevoked(false);
            setSyncedAt(new Date());
            setLoading(false);
          },
          onSessionEnded: () => clearSession(true),
        });
        if (!cancelled && !controller.signal.aborted) {
          handleStreamFailure(new Error(t.temporary));
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          handleStreamFailure(error);
        } else if (!cancelled && !connected) {
          handleStreamFailure(new Error(t.temporary));
        }
      } finally {
        window.clearTimeout(connectTimer);
        window.clearTimeout(idleTimer);
      }
    };

    setLoading(true);
    void connect();
    return () => {
      cancelled = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(fallbackTimer);
      streamController?.abort();
    };
  }, [sessionToken, clearSession, t.temporary]);

  const requestPairingQr = useCallback(async () => {
    setPairing(true);
    setPairError('');
    setPairingRequest(null);
    try {
      setPairingRequest(await createVehicleDisplayPairingRequest());
    } catch (error) {
      setPairError(errorText(error, t.error));
    } finally {
      setPairing(false);
    }
  }, [t.error]);

  useEffect(() => {
    if (sessionToken) {
      pairingRequestAttempted.current = false;
      setPairingRequest(null);
      return;
    }
    if (pairingRequestAttempted.current) return;
    pairingRequestAttempted.current = true;
    void requestPairingQr();
  }, [sessionToken, requestPairingQr]);

  useEffect(() => {
    if (!pairingRequest || sessionToken) return;
    let cancelled = false;
    let finished = false;
    let timer = 0;

    const pollPairingRequest = async () => {
      try {
        const status = await getVehicleDisplayPairingRequestStatus(pairingRequest.requestId, {
          headers: { Authorization: `Bearer ${pairingRequest.sessionToken}` },
        });
        if (cancelled) return;
        if (status.status === 'claimed'
            && status.pairingId
            && status.vehicleId
            && status.pairedAt) {
          finished = true;
          const savedSession: StoredVehicleDisplaySession = {
            sessionToken: pairingRequest.sessionToken,
            pairingId: status.pairingId,
            vehicleId: status.vehicleId,
            vehicleLabel: status.vehicleLabel ?? 'Kendaraan',
            pairedAt: new Date(status.pairedAt).toISOString(),
          };
          localStorage.setItem(SESSION_KEY, JSON.stringify(savedSession));
          setPairingRequest(null);
          setPairError('');
          setSession(savedSession);
          setCurrent(null);
          setRevoked(false);
          return;
        }
        if (status.status !== 'pending') {
          finished = true;
          setPairingRequest(null);
          setPairError(status.status === 'expired'
            ? t.expired
            : status.status === 'revoked' ? t.revokedCode : t.invalid);
          return;
        }
        setPairError('');
      } catch (error) {
        if (!cancelled) setPairError(errorText(error, t.error));
      } finally {
        if (!cancelled && !finished) timer = window.setTimeout(pollPairingRequest, 2_000);
      }
    };

    void pollPairingRequest();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pairingRequest, sessionToken, t.error, t.expired, t.invalid, t.revokedCode]);

  const unpair = async () => {
    const activeSession = session;
    clearSession(false);
    if (!activeSession) return;
    try {
      await unpairVehicleDisplay(
        { pairingId: activeSession.pairingId },
        { headers: { Authorization: `Bearer ${activeSession.sessionToken}` } },
      );
    } catch (error) {
      console.warn('Failed to revoke vehicle display session during unpair', error);
    }
  };

  const setPreview = (trip: boolean) => {
    setPreviewMode(true);
    setPreviewTrip(trip);
    const url = new URL(window.location.href);
    url.searchParams.set('preview', trip ? 'trip' : 'standby');
    window.history.replaceState(null, '', url);
  };
  const closePreview = () => {
    setPreviewMode(false);
    setPreviewTrip(false);
    const url = new URL(window.location.href);
    url.searchParams.delete('preview');
    window.history.replaceState(null, '', url);
  };
  const activeTrip = previewMode
    ? previewTrip && tripPreview.order ? {
        id: tripPreview.order.id,
        bookerName: 'Customer Example',
        fare: tripPreview.order.price,
        currency: 'IDR',
        paymentMethod: previewPaymentMethod,
        paymentStatus: 'pending' as const,
      } : null
    : current?.activeTrip ?? null;
  const previewOrder = previewMode ? tripPreview.order : null;
  const hasDisplayData = previewMode || Boolean(current);

  return (
    <main className={`vehicle-display-minimal${theme === 'dark' ? ' dark' : ''}${sessionToken || previewMode ? ' vd-connected' : ''}${previewMode ? ' vd-preview-mode' : ''}`}>
      {(sessionToken || previewMode) && <header className="vd-header">
        <img src={logoPath} className="vd-logo" alt="Corrotrans" />
        <div className="vd-header-side">
          <span className="vd-header-tag"><Monitor size={16} /> {t.display}</span>
          <div className="vd-language" role="group" aria-label="Language">
            <button type="button" onClick={() => setLanguage('id')} className={language === 'id' ? 'active' : ''} aria-pressed={language === 'id'} data-testid="button-language-id">ID</button>
            <button type="button" onClick={() => setLanguage('en')} className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} data-testid="button-language-en">EN</button>
          </div>
            <button
              type="button"
              className="vd-theme-toggle"
              onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
              aria-label={theme === 'dark' ? 'Gunakan mode terang' : 'Gunakan mode gelap'}
              aria-pressed={theme === 'dark'}
              title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
              data-testid="button-theme-toggle"
            >
              {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
              <span>{theme === 'dark' ? 'LIGHT' : 'DARK'}</span>
            </button>
        </div>
      </header>}

      {!sessionToken && !previewMode ? (
        <section className="vd-splash">
          <button
            type="button"
            className="vd-theme-toggle vd-splash-theme-toggle"
            onClick={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Gunakan mode terang' : 'Gunakan mode gelap'}
            aria-pressed={theme === 'dark'}
            title={theme === 'dark' ? 'Mode terang' : 'Mode gelap'}
            data-testid="button-theme-toggle"
          >
            {theme === 'dark' ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
            <span>{theme === 'dark' ? 'LIGHT' : 'DARK'}</span>
          </button>
          <div className="vd-splash-center">
            <img src={ctLogoPath} className="vd-ct-logo" alt="Logo CT Corrotrans" />
            <strong className="vd-splash-brand">CORROTRANS</strong>
            <span className="vd-splash-subtitle">{t.pairingTitle}</span>
            <div className="vd-splash-action">
              <p>{t.pairingDesc}</p>
              {revoked && <p className="vd-splash-error" role="status">{t.rejected}</p>}
              {pairError && <p className="vd-splash-error" role="alert">{pairError}</p>}
              {pairingRequest && (
                <div className="vd-pairing-qr-card">
                    <Suspense
                      fallback={
                        <div className="vd-pairing-qr vd-pairing-qr-loading" role="status" aria-live="polite">
                          <Spinner role="presentation" aria-hidden="true" />
                          <small>{t.qrLoading}</small>
                        </div>
                      }
                    >
                      <LazyPairingQrCode value={pairingRequest.pairingCode} />
                    </Suspense>
                  <strong className="vd-pairing-code">{pairingRequest.pairingCode}</strong>
                  <small>{t.qrExpires} {new Date(pairingRequest.expiresAt).toLocaleTimeString()}</small>
                </div>
              )}
              {!pairingRequest && (
                <Button
                  type="button"
                  size="lg"
                  className="vd-pairing-button"
                  onClick={() => { void requestPairingQr(); }}
                  disabled={pairing}
                  aria-busy={pairing}
                  data-testid="button-create-vehicle-display-pairing-qr"
                >
                  {pairing
                    ? <LoaderCircle className="animate-spin" aria-hidden="true" />
                    : <Link2 aria-hidden="true" />}
                  {pairing ? t.pairing : t.pair}
                </Button>
              )}
              {pairingRequest && <small>{t.scanHint}</small>}
              <button type="button" className="vd-preview-open" onClick={() => setPreview(false)}>{t.previewButton}</button>
            </div>
          </div>
          <div className="vd-splash-language" role="group" aria-label="Language">
            <button type="button" onClick={() => setLanguage('id')} aria-pressed={language === 'id'}>ID</button>
            <span>·</span>
            <button type="button" onClick={() => setLanguage('en')} aria-pressed={language === 'en'}>EN</button>
          </div>
        </section>
      ) : (
        <div className="vd-display-shell">
          {previewMode && (
            <div className="vd-preview-banner" role="status">
              <div><strong>{t.previewLabel}</strong><p>{t.previewNotice}</p></div>
              <div className="vd-preview-switch" role="group" aria-label={t.previewLabel}>
                <button type="button" className={!previewTrip ? 'active' : ''} onClick={() => setPreview(false)} aria-pressed={!previewTrip}>{t.previewStandby}</button>
                <button type="button" className={previewTrip ? 'active' : ''} onClick={() => setPreview(true)} aria-pressed={previewTrip}>{t.previewTrip}</button>
              </div>
            </div>
          )}
          <div className="vd-topline">
            <div>
              <span className="vd-overline">{previewMode ? t.previewLabel : t.connected}</span>
              <h1>{loading && !current ? t.verifying : previewMode ? t.previewLabel : current?.vehicleLabel ?? session?.vehicleLabel ?? t.display}</h1>
            </div>
            <span className={`vd-live-badge ${refreshError && !previewMode ? 'is-warning' : ''}`}><span /> {previewMode ? t.previewLabel : refreshError ? (language === 'id' ? 'Koneksi terganggu' : 'Connection interrupted') : t.readOnly}</span>
          </div>

          {!previewMode && current?.driver && (
            <article className="vd-driver-card" data-testid="vehicle-display-driver-profile">
              <div className="vd-photo-frame">
                {current.driver.photoUrl ? (
                  <img
                    className="vd-driver-photo"
                    src={current.driver.photoUrl}
                    alt={`${t.registered}: ${current.driver.name}`}
                  />
                ) : (
                  <div className="vd-photo-missing" aria-label={t.photoMissing}>
                    <UserRound size={34} aria-hidden="true" />
                    <span>{t.photoMissing}</span>
                  </div>
                )}
              </div>
              <div className="vd-driver-info">
                <span className="vd-overline">{t.driverProfile}</span>
                <h2>{current.driver.name}</h2>
                <div className="vd-vehicle-line">
                  <div className="vd-serial-group">
                    <small>{t.vehicleNumber}</small>
                    <strong className="vd-serial">{current.driver.plate}</strong>
                  </div>
                  <span className="vd-model">{current.driver.vehicleModel}</span>
                </div>
              </div>
            </article>
          )}

          {!previewMode && refreshError && <div className="vd-refresh-notice" role="status"><AlertTriangle size={16} /><span>{current ? t.temporary : t.noProfile}</span></div>}

          {previewMode && (
            <article className="vd-driver-card vd-preview-driver-card" data-testid="vehicle-display-preview-driver">
              <div className="vd-photo-frame">
                {tripPreview.driver.photoUrl ? (
                  <img className="vd-driver-photo" src={tripPreview.driver.photoUrl} alt={`${t.registered}: ${tripPreview.driver.name}`} />
                ) : (
                  <div className="vd-photo-missing"><UserRound size={27} /><span>{t.photoMissing}</span></div>
                )}
              </div>
              <div className="vd-driver-info">
                <span className="vd-overline">{t.registered}</span>
                <h2>{tripPreview.driver.name}</h2>
                <div className="vd-vehicle-line">
                  <div className="vd-serial-group">
                    <small>{t.vehicleNumber}</small>
                    <strong className="vd-serial">{tripPreview.driver.plate}</strong>
                  </div>
                  <span className="vd-model">{tripPreview.driver.vehicleModel}</span>
                </div>
              </div>
            </article>
          )}

           {!previewMode && loading && !current ? (
            <section className="vd-state-panel" aria-live="polite">
              <div className="vd-skeleton vd-skeleton-icon" /><div className="vd-skeleton vd-skeleton-title" /><div className="vd-skeleton vd-skeleton-copy" />
              <span>{t.verifying}</span>
            </section>
           ) : !previewMode && !current && refreshError ? (
            <section className="vd-error-panel" role="alert"><AlertTriangle size={25} /><strong>{t.noProfile}</strong><p>{refreshError}</p><button type="button" onClick={() => { void unpair(); }}>{t.disconnect}</button></section>
           ) : activeTrip ? (
             previewMode && previewOrder ? (
             <section className="vd-trip-preview-layout" aria-label={language === 'id' ? 'Peta dan ringkasan perjalanan contoh' : 'Sample trip map and summary'}>
                <Suspense
                  fallback={
                    <section className="vd-state-panel" role="status" aria-live="polite">
                      {language === 'id' ? 'Memuat peta Google Maps…' : 'Loading Google Maps…'}
                    </section>
                  }
                >
                  <LazyVehicleTripMap
                    language={language}
                    pickup={previewOrder.pickup.address}
                    pickupCoordinates={tripPreviewCoordinates.pickup}
                    destination={previewOrder.destination.address}
                    destinationCoordinates={tripPreviewCoordinates.destination}
                  />
                </Suspense>
               <aside className="vd-preview-fare-card" data-testid="vehicle-display-preview-trip-summary">
                 <div className="vd-preview-fare-heading">
                   <span className="vd-overline">{t.tripFare}</span>
                   <span className="vd-preview-active"><i aria-hidden="true" />{t.active}</span>
                 </div>
                 <strong className="vd-preview-fare-amount" data-testid="text-order-price">{money(previewOrder.price, 'IDR')}</strong>
                 <div className="vd-preview-order-id"><small>{t.order}</small><strong>#{activeTrip.id.toUpperCase()}</strong></div>
                 <div className="vd-preview-booker"><small>{t.booker}</small><strong data-testid="text-booker-name">{activeTrip.bookerName}</strong></div>
                 <div className="vd-preview-payment-grid">
                    <div>
                      <small>{t.paymentMethod}</small>
                      <span className="vd-visually-hidden" data-testid="text-order-payment">{activeTrip.paymentMethod.toUpperCase()}</span>
                      <div className="vd-preview-payment-options" role="group" aria-label={t.paymentMethod}>
                        <button
                          type="button"
                          className={activeTrip.paymentMethod === 'cash' ? 'active' : ''}
                          aria-pressed={activeTrip.paymentMethod === 'cash'}
                          data-testid="button-preview-payment-cash"
                          onClick={() => setPreviewPaymentMethod('cash')}
                        >
                          CASH
                        </button>
                        <button
                          type="button"
                          className={activeTrip.paymentMethod === 'qris' ? 'active' : ''}
                          aria-pressed={activeTrip.paymentMethod === 'qris'}
                          data-testid="button-preview-payment-qris"
                          onClick={() => setPreviewPaymentMethod('qris')}
                        >
                          QRIS
                        </button>
                      </div>
                    </div>
                   <div><small>{t.paymentStatus}</small><strong data-testid="text-payment-status">{paymentStatusText(t, activeTrip.paymentStatus)}</strong></div>
                 </div>
                 <p className="vd-preview-readonly"><Eye size={15} />{t.readOnly}</p>
               </aside>
             </section>
             ) : (
            <section className="vd-order-layout">
              <div className="vd-order-main">
                <div className="vd-order-banner">
                  <div className="vd-order-icon"><Radio size={21} /></div>
                  <div className="vd-banner-copy"><span>{t.active}</span><strong data-testid="text-order-status">{t.active}</strong></div>
                  <div className="vd-price"><small><span className="vd-price-label-default">{t.amount}</span><span className="vd-price-label-tablet">{t.tripFare}</span></small><strong data-testid="text-order-price">{money(activeTrip.fare, activeTrip.currency)}</strong></div>
                </div>
                <article className="vd-route-card">
                  <div className="vd-card-heading">
                    <div><span className="vd-overline">{t.booker}</span><h2 data-testid="text-booker-name">{activeTrip.bookerName}</h2></div>
                    <span className="vd-service-pill">#{activeTrip.id.slice(0, 8).toUpperCase()}</span>
                  </div>
                  <div className="vd-metrics">
                    <div><small>{t.paymentMethod}</small><strong data-testid="text-order-payment">{activeTrip.paymentMethod.toUpperCase()}</strong></div>
                     <div><small>{t.paymentStatus}</small><strong data-testid="text-payment-status">{paymentStatusText(t, activeTrip.paymentStatus)}</strong></div>
                  </div>
                </article>
              </div>
              <aside className="vd-side-column">
                <article className="vd-payment-card">
                  <span className="vd-payment-icon"><LockKeyhole size={21} /></span>
                   <div><small>{t.paymentStatus}</small><h3>{paymentStatusText(t, activeTrip.paymentStatus)}</h3><p>{activeTrip.paymentMethod.toUpperCase()} · {t.paymentHint}</p></div>
                </article>
                <div className="vd-readonly-note"><Eye size={18} /><p>{language === 'id' ? 'Layar ini hanya menampilkan informasi kendaraan yang dipasangkan.' : 'This screen only displays information for the paired vehicle.'}</p></div>
              </aside>
            </section>
             )
           ) : hasDisplayData ? (
            <section className="vd-standby">
              <div className="vd-standby-art"><Monitor size={38} /><span className="vd-orbit" /></div>
              <div className="vd-standby-copy">
                <span className="vd-overline">{language === 'id' ? 'MODE SIAGA' : 'STANDBY MODE'}</span>
                <h2>{t.ready}</h2>
                <p>{t.readyDesc}</p>
                <div className="vd-waiting"><span className="vd-green-dot" />{t.waiting}</div>
              </div>
            </section>
          ) : null}

          <footer className="vd-footer">
            <span>{previewMode ? t.previewLabel : syncedAt ? `${t.synced} · ${syncedAt.toLocaleTimeString()}` : t.waitingServer}</span>
            <button type="button" onClick={previewMode ? closePreview : () => { void unpair(); }} data-testid="button-disconnect"><Unplug size={15} /> {previewMode ? t.previewExit : t.disconnect}</button>
          </footer>
        </div>
      )}
    </main>
  );
}

export default VehicleDisplay;