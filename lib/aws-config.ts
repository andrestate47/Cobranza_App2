import { S3Client } from "@aws-sdk/client-s3"
import { fromEnv } from "@aws-sdk/credential-providers"

export const getBucketConfig = () => {
  const bucketName = process.env.AWS_BUCKET_NAME
  const folderPrefix = process.env.AWS_FOLDER_PREFIX ?? ""
  const region = process.env.AWS_REGION ?? "us-west-2"

  if (!bucketName) throw new Error("❌ Falta AWS_BUCKET_NAME en .env")
  return { bucketName, folderPrefix, region }
}

export const createS3Client = () => {
  const { region } = getBucketConfig()

  return new S3Client({
    region,
    credentials: fromEnv() // ✅ Toma las claves del .env
  })
}
