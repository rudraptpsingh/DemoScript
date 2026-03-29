import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import fs from 'fs'

const isTestMode = process.env.NODE_ENV === 'test'

const s3 = isTestMode
  ? null
  : new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })

const BUCKET = process.env.R2_BUCKET_NAME || 'demoscript-outputs'
const LOCAL_STORAGE_DIR = process.env.LOCAL_STORAGE_DIR || '.demoscript/server-output'

export async function uploadFile(
  key: string,
  filePath: string,
  contentType: string
): Promise<void> {
  if (isTestMode || !s3) {
    // In test mode, just copy to local directory
    const dest = `${LOCAL_STORAGE_DIR}/${key}`
    const dir = dest.substring(0, dest.lastIndexOf('/'))
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(filePath, dest)
    return
  }

  const body = fs.readFileSync(filePath)
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  )
}

export async function deleteFile(key: string): Promise<void> {
  if (isTestMode || !s3) {
    const localPath = `${LOCAL_STORAGE_DIR}/${key}`
    if (fs.existsSync(localPath)) fs.unlinkSync(localPath)
    return
  }

  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

export async function getPresignedUrl(
  key: string,
  expiresInSeconds: number
): Promise<string> {
  if (isTestMode || !s3) {
    return `http://localhost:3001/v1/local-storage/${encodeURIComponent(key)}`
  }

  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key })
  return getSignedUrl(s3, command, { expiresIn: expiresInSeconds })
}

export function getContentType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'mp4': return 'video/mp4'
    case 'gif': return 'image/gif'
    case 'png': return 'image/png'
    case 'webm': return 'video/webm'
    default: return 'application/octet-stream'
  }
}
