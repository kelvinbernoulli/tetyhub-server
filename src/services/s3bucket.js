import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import mime from 'mime-types';
import dotenv from 'dotenv';
dotenv.config();
// Set up AWS credentials
const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

export const getBase64Extension = (base64Data) => {
    const matches = base64Data.match(/^data:(.+);base64,/);
    if (matches && matches[1]) {
        const contentType = matches[1];
        const extension = contentType.split("/")[1];
        return extension;
    }
};

export const S3upload = async (file, filename) => {
    let fileBuffer;
    let contentType = 'application/octet-stream';

    try {
        if (!file) {
            throw new Error('File is required');
        }

        if (!filename) {
            throw new Error('Filename is required');
        }

        // Handle base64 string (e.g., from data URL)
        if (typeof file === 'string' && file.startsWith('data:')) {
            const matches = file.match(/^data:(.+);base64,/);
            if (matches && matches[1]) {
                contentType = matches[1];
            }

            const base64Parts = file.split(',');
            if (base64Parts.length !== 2) {
                throw new Error('Invalid base64 data format');
            }

            const base64String = base64Parts[1];
            fileBuffer = Buffer.from(base64String, 'base64');
        }
        // Handle multer file object (from multipart/form-data)
        else if (file && typeof file === 'object' && file.buffer) {
            fileBuffer = file.buffer;
            contentType = file.mimetype || 'application/octet-stream';
        }
        // Handle raw Buffer
        else if (Buffer.isBuffer(file)) {
            fileBuffer = file;
        }
        else {
            throw new Error('File must be a base64 string, multer file object, or Buffer');
        }

        if (!fileBuffer || fileBuffer.length === 0) {
            throw new Error('File buffer is empty');
        }

        const uploadParams = {
            Bucket: process.env.S3_BUCKET,
            Key: filename,
            Body: fileBuffer,
            ContentType: contentType,
        };

        const upload = new Upload({
            client: s3Client,
            params: uploadParams,
        });

        await upload.done();

        // Construct and return the S3 URL
        const s3Url = `https://${process.env.S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${filename}`;
        
        console.log(`Successfully uploaded file to S3: ${s3Url}`);
        return { error: false, url: s3Url };

    } catch (err) {
        console.error('Error uploading file to S3:', err);
        return { 
            error: true, 
            message: err.message || 'Unknown upload error'
        };
    }
};

export const S3delete = async (key) => {
    const deleteParams = {
        Bucket: process.env.S3_BUCKET,
        Key: key
    };

    try {
        const deleteResponse = await s3Client.send(new DeleteObjectCommand(deleteParams));
        console.log('File deleted successfully');
        return { error: false };
    } catch (err) {
        console.error('Error deleting file:', err);
        return { error: true, message: err.message };
    }
}

export default { 
    S3upload,
    S3delete,
    getBase64Extension,
};