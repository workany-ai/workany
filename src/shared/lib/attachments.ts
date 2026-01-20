/**
 * Attachment storage utilities
 *
 * Stores attachment files in the session folder instead of database
 * to avoid bloating the database with large binary data.
 *
 * Structure: ~/.workany/sessions/{sessionId}/attachments/{filename}
 */

import type { MessageAttachment } from '@/shared/hooks/useAgent';

/**
 * Check if running in Tauri environment
 */
function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/**
 * Generate a unique filename for an attachment
 */
function generateAttachmentFilename(
  originalName: string,
  mimeType?: string
): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);

  // Get extension from original name or mime type
  let ext = '';
  if (originalName.includes('.')) {
    ext = originalName.split('.').pop() || '';
  } else if (mimeType) {
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'application/pdf': 'pdf',
    };
    ext = mimeToExt[mimeType] || 'bin';
  }

  return `${timestamp}-${random}${ext ? '.' + ext : ''}`;
}

/**
 * Convert base64 data URL to Uint8Array
 */
function base64ToUint8Array(base64Data: string): Uint8Array {
  // Remove data URL prefix if present
  const base64 = base64Data.includes(',')
    ? base64Data.split(',')[1]
    : base64Data;

  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * Convert Uint8Array to base64 data URL
 */
function uint8ArrayToBase64(bytes: Uint8Array, mimeType: string): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Save attachment to file system
 * Returns the file path (relative to session folder)
 */
export async function saveAttachmentToFile(
  sessionFolder: string,
  attachment: MessageAttachment
): Promise<string> {
  if (!isTauri() || !attachment.data) {
    // In browser mode, return the original data (can't save to file system)
    return attachment.data;
  }

  try {
    const { mkdir, writeFile } = await import('@tauri-apps/plugin-fs');

    // Create attachments directory
    const attachmentsDir = `${sessionFolder}/attachments`;
    try {
      await mkdir(attachmentsDir, { recursive: true });
    } catch {
      // Directory may already exist
    }

    // Generate unique filename
    const filename = generateAttachmentFilename(
      attachment.name,
      attachment.mimeType
    );
    const filePath = `${attachmentsDir}/${filename}`;

    // Convert base64 to binary and write
    const bytes = base64ToUint8Array(attachment.data);
    await writeFile(filePath, bytes);

    console.log('[Attachments] Saved attachment to:', filePath);
    return filePath;
  } catch (error) {
    console.error('[Attachments] Failed to save attachment:', error);
    // Return original data as fallback
    return attachment.data;
  }
}

/**
 * Load attachment from file system
 * Takes a file path and returns base64 data URL
 */
export async function loadAttachmentFromFile(
  filePath: string,
  mimeType?: string
): Promise<string> {
  // If it's already a data URL, return as-is
  if (filePath.startsWith('data:')) {
    return filePath;
  }

  if (!isTauri()) {
    // In browser mode, can't read from file system
    return filePath;
  }

  try {
    const { readFile } = await import('@tauri-apps/plugin-fs');

    const bytes = await readFile(filePath);
    const mime = mimeType || guessMimeType(filePath);
    const dataUrl = uint8ArrayToBase64(bytes, mime);

    return dataUrl;
  } catch (error) {
    console.error('[Attachments] Failed to load attachment:', error);
    return filePath;
  }
}

/**
 * Guess MIME type from file extension
 */
function guessMimeType(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  const extToMime: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    pdf: 'application/pdf',
    txt: 'text/plain',
    json: 'application/json',
  };
  return extToMime[ext || ''] || 'application/octet-stream';
}

/**
 * Attachment reference stored in database
 * Contains path instead of actual data
 */
export interface AttachmentReference {
  id: string;
  type: 'image' | 'file';
  name: string;
  path: string; // File path instead of data
  mimeType?: string;
}

/**
 * Convert MessageAttachment to AttachmentReference (for database storage)
 */
export async function attachmentToReference(
  sessionFolder: string,
  attachment: MessageAttachment
): Promise<AttachmentReference> {
  const filePath = await saveAttachmentToFile(sessionFolder, attachment);

  return {
    id: attachment.id,
    type: attachment.type,
    name: attachment.name,
    path: filePath,
    mimeType: attachment.mimeType,
  };
}

/**
 * Convert AttachmentReference back to MessageAttachment (for display)
 */
export async function referenceToAttachment(
  ref: AttachmentReference
): Promise<MessageAttachment> {
  const data = await loadAttachmentFromFile(ref.path, ref.mimeType);

  return {
    id: ref.id,
    type: ref.type,
    name: ref.name,
    data,
    mimeType: ref.mimeType,
  };
}

/**
 * Save multiple attachments and return references
 */
export async function saveAttachments(
  sessionFolder: string,
  attachments: MessageAttachment[]
): Promise<AttachmentReference[]> {
  const references: AttachmentReference[] = [];

  for (const attachment of attachments) {
    const ref = await attachmentToReference(sessionFolder, attachment);
    references.push(ref);
  }

  return references;
}

/**
 * Load multiple attachments from references
 */
export async function loadAttachments(
  references: AttachmentReference[]
): Promise<MessageAttachment[]> {
  const attachments: MessageAttachment[] = [];

  for (const ref of references) {
    const attachment = await referenceToAttachment(ref);
    attachments.push(attachment);
  }

  return attachments;
}
