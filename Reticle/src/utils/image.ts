/**
 * Crop a region from an image loaded from a Blob URL.
 * Returns a new Blob URL with the cropped result.
 */
export function cropImage(
    sourceUrl: string,
    rect: { x: number; y: number; width: number; height: number }
): Promise<string> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = rect.width;
            canvas.height = rect.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                reject('No canvas context');
                return;
            }

            ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);

            canvas.toBlob((blob) => {
                if (blob) {
                    resolve(URL.createObjectURL(blob));
                } else {
                    reject('Failed to create blob');
                }
            }, 'image/png');
        };
        img.onerror = reject;
        img.src = sourceUrl;
    });
}
