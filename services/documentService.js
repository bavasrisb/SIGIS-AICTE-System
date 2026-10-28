const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const { db } = require('../db');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads', 'documents');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Allowed MIME types and extensions
const ALLOWED_MIME_TYPES = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg']
};

// Magic bytes signatures
const MAGIC_NUMBERS = {
  pdf: Buffer.from([0x25, 0x50, 0x44, 0x46]), // %PDF
  png: Buffer.from([0x89, 0x50, 0x4E, 0x47]), // .PNG
  jpeg: Buffer.from([0xFF, 0xD8, 0xFF])        // JPEG SOI
};

// Validate file magic bytes against allowed formats
function validateMagicBytes(filePath, mimeType) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    if (mimeType === 'application/pdf') {
      return buffer.subarray(0, 4).equals(MAGIC_NUMBERS.pdf);
    }
    if (mimeType === 'image/png') {
      return buffer.subarray(0, 4).equals(MAGIC_NUMBERS.png);
    }
    if (mimeType === 'image/jpeg') {
      return buffer.subarray(0, 3).equals(MAGIC_NUMBERS.jpeg);
    }
    return false;
  } catch (err) {
    return false;
  }
}

// Multer disk storage with UUID generation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `doc-${crypto.randomUUID()}${ext}`;
    cb(null, uniqueName);
  }
});

// Multer upload middleware
const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5 MB configurable limit
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const validExtensions = ALLOWED_MIME_TYPES[file.mimetype];

    if (!validExtensions || !validExtensions.includes(ext)) {
      return cb(new Error('Invalid file format. Only PDF, PNG, and JPG/JPEG files are accepted.'));
    }
    cb(null, true);
  }
});

// Database operations for complaint documents
function saveDocumentRecord(complaintId, file, uploadedBy) {
  const id = `DOC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const insert = db.prepare(`
    INSERT INTO complaint_documents (
      id, complaint_id, original_filename, stored_filename, file_size, mime_type, uploaded_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    id,
    complaintId,
    file.originalname,
    file.filename,
    file.size,
    file.mimetype,
    uploadedBy || 'AICTE Officer'
  );

  return db.prepare('SELECT * FROM complaint_documents WHERE id = ?').get(id);
}

function getDocumentsForComplaint(complaintId) {
  return db.prepare(`
    SELECT id, complaint_id, original_filename, file_size, mime_type, uploaded_by, created_at
    FROM complaint_documents
    WHERE complaint_id = ?
    ORDER BY created_at DESC
  `).all(complaintId);
}

function getDocumentRecord(docId) {
  return db.prepare('SELECT * FROM complaint_documents WHERE id = ?').get(docId);
}

function getDocumentFilePath(storedFilename) {
  // Only accept a plain filename (no separators, no traversal sequences).
  // This blocks '../', absolute paths, and Windows/POSIX separators outright.
  if (typeof storedFilename !== 'string' || storedFilename.length === 0) {
    return null;
  }
  if (storedFilename.includes('/') || storedFilename.includes('\\') || storedFilename.includes('..')) {
    return null;
  }

  const uploadsRoot = path.resolve(UPLOADS_DIR);
  const resolved = path.resolve(UPLOADS_DIR, storedFilename);

  // Containment: the resolved path must sit strictly inside the uploads root.
  // Appending path.sep prevents sibling-prefix bypasses such as
  // 'uploads/documents2' matching a startsWith('uploads/documents') check.
  // Comparison is case-insensitive on Windows to avoid case-based bypasses.
  const rootWithSep = uploadsRoot.endsWith(path.sep) ? uploadsRoot : uploadsRoot + path.sep;
  const compareRoot = process.platform === 'win32' ? rootWithSep.toLowerCase() : rootWithSep;
  const compareResolved = process.platform === 'win32' ? resolved.toLowerCase() : resolved;

  if (!compareResolved.startsWith(compareRoot)) {
    return null;
  }
  return resolved;
}

module.exports = {
  upload,
  UPLOADS_DIR,
  validateMagicBytes,
  saveDocumentRecord,
  getDocumentsForComplaint,
  getDocumentRecord,
  getDocumentFilePath
};
