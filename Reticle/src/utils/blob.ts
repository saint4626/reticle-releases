/**
 * Convert binary data (Uint8Array or number[]) to a Blob URL.
 */
export function binaryToBlobUrl(bytes: Uint8Array | number[], type = 'image/png'): string {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const blob = new Blob([data as unknown as BlobPart], { type });
    return URL.createObjectURL(blob);
}

/**
 * Manages Blob URL lifecycle to prevent memory leaks.
 * Register every created ObjectURL, then cleanup on unmount.
 */
export class BlobUrlManager {
    private urls: string[] = [];

    register(url: string): string {
        this.urls.push(url);
        return url;
    }

    cleanup(): void {
        this.urls.forEach(url => URL.revokeObjectURL(url));
        this.urls.length = 0;
    }
}
