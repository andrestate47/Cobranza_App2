import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { getBucketConfig, createS3Client } from "./aws-config"

export const uploadFile = async (buffer: Buffer, fileName: string) => {
  const { bucketName, folderPrefix } = getBucketConfig()
  const s3Client = createS3Client()

  const key = `${folderPrefix}uploads/${Date.now()}-${fileName}`

  try {
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: getContentType(fileName),
    })

    await s3Client.send(command)

    const fileUrl = `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`
    console.log("✅ Archivo subido correctamente:", fileUrl)

    return { key, url: fileUrl }
  } catch (error) {
    console.error("❌ Error al subir archivo a S3:", error)
    if (process.env.NODE_ENV !== "production") {
      console.warn("⚠️ Entorno local: omitiendo error de S3 y simulando URL")
      return {
        key,
        url: `local://${fileName}`,
      }
    }
    throw error
  }
}

export const downloadFile = async (key: string) => {
  const { bucketName } = getBucketConfig()
  const s3Client = createS3Client()

  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    })

    // URL firmada válida por 1 hora
    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 })
    return signedUrl
  } catch (error) {
    console.error("❌ Error al generar URL firmada:", error)
    throw error
  }
}

export const deleteFile = async (key: string) => {
  const { bucketName } = getBucketConfig()
  const s3Client = createS3Client()

  try {
    const command = new DeleteObjectCommand({
      Bucket: bucketName,
      Key: key,
    })
    await s3Client.send(command)
    console.log(`🗑️ Archivo eliminado correctamente: ${key}`)
  } catch (error) {
    console.error("❌ Error al eliminar archivo:", error)
    throw error
  }
}

export const renameFile = async (oldKey: string, newKey: string) => {
  // S3 no soporta rename directo: requiere copiar y eliminar
  throw new Error("🚧 Operación rename no implementada")
}

const getContentType = (fileName: string): string => {
  const ext = fileName.split(".").pop()?.toLowerCase()
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "png":
      return "image/png"
    case "gif":
      return "image/gif"
    case "webp":
      return "image/webp"
    case "pdf":
      return "application/pdf"
    case "doc":
      return "application/msword"
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    default:
      return "application/octet-stream"
  }
}
