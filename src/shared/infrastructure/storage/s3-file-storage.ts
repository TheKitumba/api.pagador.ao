import type { Readable } from 'node:stream';

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { FileStorage } from '../../application/ports';
import { NotFoundError } from '../../domain/errors';
import { AppConfig } from '../config/app-config';

/** MinIO (S3-compatible) adapter. The bucket is private: files are served through the API. */
@Injectable()
export class S3FileStorage extends FileStorage implements OnModuleInit {
  private readonly logger = new Logger(S3FileStorage.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    super();
    const env = config.env;
    this.bucket = env.S3_BUCKET;
    this.client = new S3Client({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    });
  }

  async onModuleInit() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
        this.logger.log(`Bucket "${this.bucket}" criado`);
      } catch (error) {
        this.logger.error(`Armazenamento indisponível: ${(error as Error).message}`);
      }
    }
  }

  async put(key: string, body: Buffer, contentType: string) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }));
  }

  async get(key: string) {
    try {
      const object = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { body: object.Body as Readable, contentType: object.ContentType ?? 'application/octet-stream', size: object.ContentLength };
    } catch {
      throw new NotFoundError('Ficheiro', key);
    }
  }

  async remove(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
