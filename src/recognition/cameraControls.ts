type FacingMode = 'environment' | 'user';

type MediaTrackCapabilitiesLike = {
  zoom?: { min?: number; max?: number };
  torch?: boolean;
  focusMode?: string[];
  exposureMode?: string[];
  whiteBalanceMode?: string[];
};

type MediaTrackSettingsLike = {
  deviceId?: string;
  facingMode?: string;
  width?: number;
  height?: number;
  frameRate?: number;
};

export type CameraProfile = {
  label: string;
  facingMode: string;
  resolution: string;
  frameRate: number | null;
  supportsContinuousFocus: boolean;
  supportsTorch: boolean;
  supportsZoom: boolean;
  zoomRange: string | null;
};

export type LivePreviewTuning = {
  minBrightness: number;
  maxBrightness: number;
  minContrast: number;
  minSharpness: number;
  maxMotion: number;
  minCoverage: number;
  maxCoverage: number;
  minCenteredness: number;
  minAspectRatio: number;
  requiredStableFrames: number;
  burstFrames: number;
  burstIntervalMs: number;
  capturePadding: number;
  profileName: string;
};

const environmentPatterns = /(back|rear|environment|world)/i;
const userPatterns = /(front|user|facetime|selfie|internal|built-?in)/i;
const iphonePatterns = /(iphone|continuity|desk view|ultra wide|main camera|wide camera)/i;

export const isContinuityCameraLabel = (label: string) => iphonePatterns.test(label);

const getCapabilities = (track: MediaStreamTrack): MediaTrackCapabilitiesLike => {
  const candidate = track as MediaStreamTrack & {
    getCapabilities?: () => MediaTrackCapabilitiesLike;
  };
  return candidate.getCapabilities?.() || {};
};

const getSettings = (track: MediaStreamTrack): MediaTrackSettingsLike => {
  const candidate = track as MediaStreamTrack & {
    getSettings?: () => MediaTrackSettingsLike;
  };
  return candidate.getSettings?.() || {};
};

export const pickPreferredVideoDevice = (
  devices: MediaDeviceInfo[],
  preferredFacingMode: FacingMode,
) => {
  const videoDevices = devices.filter((device) => device.kind === 'videoinput');
  if (videoDevices.length === 0) return null;

  if (preferredFacingMode === 'environment') {
    const iphoneDevice = videoDevices.find((device) => iphonePatterns.test(device.label));
    if (iphoneDevice) return iphoneDevice;
  }

  const preferredPattern = preferredFacingMode === 'environment' ? environmentPatterns : userPatterns;
  const preferred = videoDevices.find((device) => preferredPattern.test(device.label));
  if (preferred) return preferred;

  const fallbackPattern = preferredFacingMode === 'environment' ? userPatterns : environmentPatterns;
  const fallback = videoDevices.find((device) => fallbackPattern.test(device.label));
  return fallback || videoDevices[0];
};

export const applyPreferredTrackConstraints = async (track: MediaStreamTrack) => {
  const capabilities = getCapabilities(track);
  const advanced: Array<Record<string, unknown>> = [];

  if (capabilities.focusMode?.includes('continuous')) {
    advanced.push({ focusMode: 'continuous' });
  }
  if (capabilities.exposureMode?.includes('continuous')) {
    advanced.push({ exposureMode: 'continuous' });
  }
  if (capabilities.whiteBalanceMode?.includes('continuous')) {
    advanced.push({ whiteBalanceMode: 'continuous' });
  }
  if (capabilities.zoom && typeof capabilities.zoom.max === 'number' && capabilities.zoom.max > 1) {
    advanced.push({ zoom: Math.min(1.2, capabilities.zoom.max) });
  }

  if (advanced.length === 0) return;

  try {
    await track.applyConstraints({ advanced });
  } catch (error) {
    console.warn('Track constraints were not fully applied', error);
  }
};

export const describeCameraProfile = (track: MediaStreamTrack): CameraProfile => {
  const capabilities = getCapabilities(track);
  const settings = getSettings(track);
  const label = track.label || 'Unknown camera';
  const resolution =
    settings.width && settings.height ? `${settings.width}x${settings.height}` : 'n/a';
  const zoomRange =
    capabilities.zoom && typeof capabilities.zoom.min === 'number' && typeof capabilities.zoom.max === 'number'
      ? `${capabilities.zoom.min.toFixed(1)}-${capabilities.zoom.max.toFixed(1)}`
      : null;

  return {
    label,
    facingMode: settings.facingMode || 'unknown',
    resolution,
    frameRate: settings.frameRate || null,
    supportsContinuousFocus: Boolean(capabilities.focusMode?.includes('continuous')),
    supportsTorch: Boolean(capabilities.torch),
    supportsZoom: Boolean(capabilities.zoom && typeof capabilities.zoom.max === 'number' && capabilities.zoom.max > 1),
    zoomRange,
  };
};

export const resolveLivePreviewTuning = (
  defaults: Omit<LivePreviewTuning, 'profileName'>,
  profile: CameraProfile | null,
): LivePreviewTuning => {
  const label = profile?.label || '';
  const iphoneContinuityCamera = iphonePatterns.test(label);
  const builtInLaptopCamera = /(facetime|built-?in|internal|macbook)/i.test(label);

  if (iphoneContinuityCamera) {
    return {
      ...defaults,
      minBrightness: Math.max(50, defaults.minBrightness - 2),
      minContrast: defaults.minContrast,
      minSharpness: Math.max(9.5, defaults.minSharpness - 1),
      maxMotion: defaults.maxMotion,
      minCoverage: Math.max(0.07, defaults.minCoverage - 0.01),
      maxCoverage: Math.min(0.88, defaults.maxCoverage + 0.12),
      minCenteredness: Math.max(0.62, defaults.minCenteredness - 0.04),
      minAspectRatio: defaults.minAspectRatio,
      requiredStableFrames: Math.max(5, defaults.requiredStableFrames - 2),
      burstFrames: Math.max(4, defaults.burstFrames - 2),
      burstIntervalMs: Math.max(70, defaults.burstIntervalMs - 30),
      capturePadding: Math.max(0.03, defaults.capturePadding - 0.03),
      profileName: 'continuity-iphone',
    };
  }

  if (builtInLaptopCamera) {
    return {
      ...defaults,
      minBrightness: Math.max(46, defaults.minBrightness - 6),
      minContrast: Math.max(16, defaults.minContrast - 2),
      minSharpness: Math.max(5.2, defaults.minSharpness - 5.3),
      maxMotion: defaults.maxMotion * 1.25,
      minCoverage: Math.max(0.05, defaults.minCoverage - 0.03),
      minCenteredness: Math.max(0.6, defaults.minCenteredness - 0.04),
      minAspectRatio: Math.max(0.32, defaults.minAspectRatio - 0.04),
      requiredStableFrames: Math.max(6, defaults.requiredStableFrames - 2),
      burstFrames: defaults.burstFrames,
      burstIntervalMs: defaults.burstIntervalMs,
      capturePadding: defaults.capturePadding + 0.05,
      profileName: 'built-in-laptop',
    };
  }

  return {
    ...defaults,
    profileName: 'default',
  };
};
