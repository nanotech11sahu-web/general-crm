import request from 'supertest';
import { createApp } from '../app';
import { createOwnerContext } from '../test/helpers';

const app = createApp();

describe('Vault — media library, folders, storage usage', () => {
  it('uploads a file into a folder and reports real storage usage', async () => {
    const { token } = await createOwnerContext();
    const dataBase64 = Buffer.from('hello world').toString('base64');

    const upload = await request(app)
      .post('/api/vault/files')
      .set('Authorization', `Bearer ${token}`)
      .send({ folder: 'Brand Assets', filename: 'logo.png', mimeType: 'image/png', dataBase64 });
    expect(upload.status).toBe(201);

    const files = await request(app).get('/api/vault/files').set('Authorization', `Bearer ${token}`);
    expect(files.body.files).toHaveLength(1);
    expect(files.body.storageUsedBytes).toBeGreaterThan(0);

    const folders = await request(app).get('/api/vault/folders').set('Authorization', `Bearer ${token}`);
    expect(folders.body.folders).toContain('Brand Assets');
  });
});
