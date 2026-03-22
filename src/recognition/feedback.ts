import { recognitionConfig } from '../config/recognition';
import type { AggregationSummary, CameraFeedback, RecognitionRunResult } from './types';

const pushFeedback = (
  list: CameraFeedback[],
  entry: CameraFeedback,
) => {
  if (!list.some((item) => item.reason === entry.reason)) {
    list.push(entry);
  }
};

export const deriveCameraFeedback = (
  result: RecognitionRunResult | null,
  aggregation: AggregationSummary | null,
): CameraFeedback[] => {
  const feedback: CameraFeedback[] = [];

  if (!result) {
    if (aggregation && aggregation.framesSeen > 0 && aggregation.acceptedFrames === 0) {
      pushFeedback(feedback, {
        severity: 'warning',
        reason: 'stabilizing',
        message: 'Пока нет пригодных кадров',
      });
    }
    return feedback;
  }

  if (result.quality.resolutionScore < 1 || result.quality.reasons.includes('low-resolution')) {
    pushFeedback(feedback, {
      severity: 'warning',
      reason: 'move-closer',
      message: 'Поднесите ближе',
    });
  }

  const barcodeLocked = Boolean(aggregation && aggregation.barcodeStability >= 0.95);

  if (
    !barcodeLocked &&
    (result.quality.reasons.includes('blurry') || result.quality.sharpness < recognitionConfig.quality.minSharpness * 1.25)
  ) {
    pushFeedback(feedback, {
      severity: 'warning',
      reason: 'blurry',
      message: 'Слишком размыто',
    });
  }

  if (result.quality.reasons.includes('too-dark') || result.quality.brightness < recognitionConfig.quality.minBrightness * 1.15) {
    pushFeedback(feedback, {
      severity: 'warning',
      reason: 'low-light',
      message: 'Недостаточно света',
    });
  }

  if (result.quality.reasons.includes('glare') || result.quality.glareScore > 0.015) {
    pushFeedback(feedback, {
      severity: 'warning',
      reason: 'glare',
      message: 'Есть блики, слегка измените угол',
    });
  }

  if (result.quality.reasons.includes('low-contrast')) {
    pushFeedback(feedback, {
      severity: 'info',
      reason: 'low-contrast',
      message: 'Добавьте контраст: уберите блики и выровняйте этикетку',
    });
  }

  if (aggregation && !aggregation.stable) {
    if (aggregation.framesSeen < recognitionConfig.aggregation.minAcceptedFrames) {
      pushFeedback(feedback, {
        severity: 'info',
        reason: 'stabilizing',
        message: 'Удерживайте камеру, идет стабилизация',
      });
    }

    if (aggregation.barcodeStability > 0 && aggregation.barcodeStability < 0.65) {
      pushFeedback(feedback, {
        severity: 'info',
        reason: 'barcode-unstable',
        message: 'Штрихкод читается нестабильно, не смещайте камеру',
      });
    }

    if (aggregation.candidateStability > 0 && aggregation.candidateStability < 0.65) {
      pushFeedback(feedback, {
        severity: 'info',
        reason: 'candidate-unstable',
        message: 'Результат пока прыгает между похожими этикетками',
      });
    }
  }

  return feedback.slice(0, 3);
};
