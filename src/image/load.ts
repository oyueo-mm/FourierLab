// Decodes an uploaded image file into a downscaled RGBA raster. Everything stays in the browser:
// the file is read through an object URL and a canvas, never sent anywhere.

import type { RasterInput } from './contour';

export const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ACCEPT_ATTR = ACCEPTED_TYPES.join(',');
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Images with more pixels than this are refused before they are decoded into a canvas. */
export const MAX_SOURCE_PIXELS = 100_000_000;
/** Working resolution (longer side) for contour extraction. */
export const WORKING_SIDE = 384;

export interface LoadedImage extends RasterInput {
  /** Original size, for information. */
  sourceWidth: number;
  sourceHeight: number;
  /** Downscaled copy for previews (same pixels as `data`). */
  canvas: HTMLCanvasElement;
  name: string;
}

export class ImageLoadError extends Error {}

export function checkFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type as (typeof ACCEPTED_TYPES)[number])) return 'PNG, JPG, WebP 이미지만 사용할 수 있습니다.';
  if (file.size === 0) return '빈 파일입니다.';
  if (file.size > MAX_FILE_BYTES) return `파일이 너무 큽니다(최대 ${MAX_FILE_BYTES / 1024 / 1024}MB).`;
  return null;
}

function decode(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageLoadError('이미지를 읽을 수 없습니다. 손상된 파일일 수 있습니다.'));
    };
    img.src = url;
  });
}

export async function loadImage(file: File): Promise<LoadedImage> {
  const problem = checkFile(file);
  if (problem) throw new ImageLoadError(problem);
  const img = await decode(file);
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;
  if (!sw || !sh) throw new ImageLoadError('이미지 크기를 알 수 없습니다.');
  if (sw * sh > MAX_SOURCE_PIXELS) throw new ImageLoadError('이미지 해상도가 너무 큽니다.');

  const scale = Math.min(1, WORKING_SIDE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new ImageLoadError('캔버스를 만들 수 없습니다.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, width, height);
  const { data } = ctx.getImageData(0, 0, width, height);
  return { width, height, data, sourceWidth: sw, sourceHeight: sh, canvas, name: file.name };
}
