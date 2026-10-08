/** Image attachments are read in the browser and sent inline to the vision model (never indexed). */

export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];
export const isImage = (file: File) => IMAGE_TYPES.includes(file.type);

export interface PickedImage {
  /** Sent to the model: longest side ≤ 1600 px, enough to read text in screenshots and charts. */
  full: string;
  /** Kept with the message for display and saved history: small enough for localStorage. */
  thumb: string;
}

async function toJpeg(bitmap: ImageBitmap, maxSide: number, quality: number): Promise<string> {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.fillStyle = "#fff"; // transparent PNGs would otherwise turn black in JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export async function readImage(file: File): Promise<PickedImage> {
  const bitmap = await createImageBitmap(file);
  try {
    return { full: await toJpeg(bitmap, 1600, 0.85), thumb: await toJpeg(bitmap, 360, 0.7) };
  } finally {
    bitmap.close();
  }
}
