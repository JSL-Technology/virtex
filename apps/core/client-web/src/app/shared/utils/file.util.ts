
export class FileUtil {
  /**
   * Reads a file and returns its content as a Data URL (base64).
   * @param file The file to read.
   * @returns A promise that resolves with the Data URL.
   */
  static readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  }

  /**
   * Validates if a file is an image and within size limits.
   * @param file The file to validate.
   * @param maxSizeMB Maximum size in MB (default 5MB).
   * @returns null if valid, or an error string.
   */
  static validateImage(file: File, maxSizeMB = 5): string | null {
    if (!file.type.match(/image\/*/)) {
      return 'Only image files are allowed';
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `File size must be less than ${maxSizeMB}MB`;
    }
    return null;
  }
}
