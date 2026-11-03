const CROP_VIEW_SIZE = 200;
const OUTPUT_SIZE = 160;

export interface AvatarCropperController {
  destroy(): void;
  getCroppedDataUrl(): string;
}

/**
 * モーダル内の Canvas とズームスライダーにバインドし、ドラッグ移動＋拡大縮小で円形トリミングを行う
 */
export function attachAvatarCropper(
  canvas: HTMLCanvasElement,
  zoomInput: HTMLInputElement,
  imageSrc: string,
  onUpdate: (dataUrl: string) => void,
): Promise<AvatarCropperController> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = CROP_VIEW_SIZE;
      canvas.height = CROP_VIEW_SIZE;
      const ctx = canvas.getContext('2d')!;

      const minScale = Math.max(CROP_VIEW_SIZE / img.width, CROP_VIEW_SIZE / img.height);
      let zoom = 1;
      let offsetX = 0;
      let offsetY = 0;
      let isDragging = false;
      let dragStartX = 0;
      let dragStartY = 0;

      const clampOffsets = () => {
        const scale = minScale * zoom;
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const maxOffX = Math.max(0, (drawW - CROP_VIEW_SIZE) / 2);
        const maxOffY = Math.max(0, (drawH - CROP_VIEW_SIZE) / 2);
        offsetX = Math.max(-maxOffX, Math.min(maxOffX, offsetX));
        offsetY = Math.max(-maxOffY, Math.min(maxOffY, offsetY));
      };

      const drawPreview = () => {
        clampOffsets();
        ctx.clearRect(0, 0, CROP_VIEW_SIZE, CROP_VIEW_SIZE);

        const scale = minScale * zoom;
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const x = (CROP_VIEW_SIZE - drawW) / 2 + offsetX;
        const y = (CROP_VIEW_SIZE - drawH) / 2 + offsetY;

        ctx.save();
        ctx.drawImage(img, x, y, drawW, drawH);

        // 円形マスク外の暗転オーバーレイ
        ctx.fillStyle = 'rgba(0, 0, 0, 0.58)';
        ctx.beginPath();
        ctx.rect(0, 0, CROP_VIEW_SIZE, CROP_VIEW_SIZE);
        ctx.arc(CROP_VIEW_SIZE / 2, CROP_VIEW_SIZE / 2, CROP_VIEW_SIZE / 2 - 4, 0, Math.PI * 2, true);
        ctx.fill();

        // 円形ガイド枠線
        ctx.strokeStyle = '#f2c14e';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(CROP_VIEW_SIZE / 2, CROP_VIEW_SIZE / 2, CROP_VIEW_SIZE / 2 - 4, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      };

      const getCroppedDataUrl = (): string => {
        const outCanvas = document.createElement('canvas');
        outCanvas.width = OUTPUT_SIZE;
        outCanvas.height = OUTPUT_SIZE;
        const outCtx = outCanvas.getContext('2d')!;

        const ratio = OUTPUT_SIZE / CROP_VIEW_SIZE;
        const scale = minScale * zoom * ratio;
        const drawW = img.width * scale;
        const drawH = img.height * scale;
        const x = (OUTPUT_SIZE - drawW) / 2 + offsetX * ratio;
        const y = (OUTPUT_SIZE - drawH) / 2 + offsetY * ratio;

        outCtx.save();
        outCtx.beginPath();
        outCtx.arc(OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, OUTPUT_SIZE / 2, 0, Math.PI * 2);
        outCtx.closePath();
        outCtx.clip();
        outCtx.drawImage(img, x, y, drawW, drawH);
        outCtx.restore();

        const webp = outCanvas.toDataURL('image/webp', 0.85);
        if (webp.startsWith('data:image/webp')) return webp;
        return outCanvas.toDataURL('image/png');
      };

      const onPointerDown = (e: PointerEvent) => {
        isDragging = true;
        dragStartX = e.clientX - offsetX;
        dragStartY = e.clientY - offsetY;
        canvas.setPointerCapture(e.pointerId);
      };

      const onPointerMove = (e: PointerEvent) => {
        if (!isDragging) return;
        offsetX = e.clientX - dragStartX;
        offsetY = e.clientY - dragStartY;
        drawPreview();
      };

      const onPointerUp = (e: PointerEvent) => {
        if (!isDragging) return;
        isDragging = false;
        canvas.releasePointerCapture(e.pointerId);
        onUpdate(getCroppedDataUrl());
      };

      const onZoomInput = () => {
        zoom = Math.max(1, Math.min(3, Number(zoomInput.value) || 1));
        drawPreview();
        onUpdate(getCroppedDataUrl());
      };

      canvas.addEventListener('pointerdown', onPointerDown);
      canvas.addEventListener('pointermove', onPointerMove);
      canvas.addEventListener('pointerup', onPointerUp);
      canvas.addEventListener('pointercancel', onPointerUp);
      zoomInput.addEventListener('input', onZoomInput);

      drawPreview();
      onUpdate(getCroppedDataUrl());

      resolve({
        destroy() {
          canvas.removeEventListener('pointerdown', onPointerDown);
          canvas.removeEventListener('pointermove', onPointerMove);
          canvas.removeEventListener('pointerup', onPointerUp);
          canvas.removeEventListener('pointercancel', onPointerUp);
          zoomInput.removeEventListener('input', onZoomInput);
        },
        getCroppedDataUrl,
      });
    };
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = imageSrc;
  });
}

