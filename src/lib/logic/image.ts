// Optional single image per card side, compressed to under 100 KB and stored as a data URL
// in localStorage (never uploaded anywhere).
//
// Strategy: draw the picture onto a canvas at a capped size, then step the JPEG quality
// down until the encoded data URL fits the budget. If it still will not fit, the caller
// shows an error rather than silently storing an oversized blob.

export const IMAGE_BUDGET_BYTES = 100_000;
const MAX_EDGE = 900;

export interface ImageResult {
	ok: boolean;
	dataUrl?: string;
	bytes?: number;
	error?: string;
}

export async function compressImage(file: File): Promise<ImageResult> {
	if (!file.type.startsWith('image/')) {
		return { ok: false, error: 'That file is not an image.' };
	}
	let bitmap: ImageBitmap;
	try {
		bitmap = await createImageBitmap(file);
	} catch {
		return { ok: false, error: 'The image could not be read. Try a JPG, PNG or WebP file.' };
	}

	const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
	const width = Math.max(1, Math.round(bitmap.width * scale));
	const height = Math.max(1, Math.round(bitmap.height * scale));

	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) return { ok: false, error: 'This browser cannot process images.' };
	// White backdrop so transparent PNGs do not become black after JPEG encoding.
	ctx.fillStyle = '#ffffff';
	ctx.fillRect(0, 0, width, height);
	ctx.drawImage(bitmap, 0, 0, width, height);
	bitmap.close?.();

	for (const quality of [0.82, 0.7, 0.6, 0.5, 0.4, 0.3]) {
		const url = canvas.toDataURL('image/jpeg', quality);
		// A data URL is base64: roughly 3 bytes per 4 characters.
		const bytes = Math.round((url.length - url.indexOf(',') - 1) * 0.75);
		if (bytes <= IMAGE_BUDGET_BYTES) return { ok: true, dataUrl: url, bytes };
	}
	return {
		ok: false,
		error: 'That image is too large to store under 100 KB. Crop it or use a smaller picture.'
	};
}
